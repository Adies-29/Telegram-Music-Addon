const path = require('path');
const fs = require('fs');
const { utils } = require('telegram');

let teledriveEntity = null;
let botUsername = '';

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let logCliFn = null;
function setLogCli(fn) {
  logCliFn = fn;
}

function logSync(sourceId, destId) {
  if (logCliFn) {
    logCliFn('SYNC', `TeleDrive ID: ${BOLD}${sourceId}${RESET} -> Music Library ID: ${BOLD}${destId}${RESET}`);
  } else {
    console.log(`[TeleDrive Sync] TeleDrive ID: ${sourceId} -> Music Library ID: ${destId}`);
  }
}

const STATE_FILE = path.join(__dirname, 'teledrive_state.json');

function cleanEnv(val) {
  if (!val) return '';
  return String(val).trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Normalizes channel IDs for the Telegram Bot API.
 * Private channel numeric IDs MUST start with -100 in the Bot API.
 */
function formatChatIdForBot(chatId) {
  if (!chatId) return '';
  const str = String(chatId).trim();
  if (str.startsWith('@')) return str;
  if (/^\d+$/.test(str)) {
    return `-100${str}`;
  }
  if (/^-\d+$/.test(str) && !str.startsWith('-100')) {
    return `-100${str.slice(1)}`;
  }
  return str;
}

/**
 * Normalizes peer IDs to bare numeric strings without -100 or minus signs
 * for reliable equality comparison between events and entity instances.
 */
function getRawPeerId(entityOrPeer) {
  if (!entityOrPeer) return '';
  try {
    const pid = utils.getPeerId(entityOrPeer).toString();
    return pid.replace(/^-100/, '').replace(/^-/, '');
  } catch (_) {
    return String(entityOrPeer.id || entityOrPeer).replace(/^-100/, '').replace(/^-/, '');
  }
}

function loadTeleDriveState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) {}
  return { lastSyncedId: 0 };
}

function saveTeleDriveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Strict Quality Gate:
 * Music Library accepts ONLY Lossless (FLAC, ALAC, WAV) and Dolby Atmos tracks.
 * Rejects standard MP3, AAC, lossy M4A, and Opus formats.
 */
function isLosslessOrAtmos(track) {
  if (!track) return false;
  const fmt = (track.format || '').toLowerCase();
  const isLossless = ['flac', 'alac', 'wav'].includes(fmt);
  const isAtmos = Boolean(
    track.isAtmos ||
    fmt === 'eac3-joc' ||
    (track.quality && track.quality.toLowerCase().includes('atmos'))
  );
  return isLossless || isAtmos;
}

/**
 * Copies a message from the TeleDrive source channel to the Music Library destination channel.
 * Primary: Telegram Bot API copyMessage (server-side, 0 KB bandwidth, drops author header).
 * Fallback: GramJS MTProto client.forwardMessages with dropAuthor: true (drops author header).
 */
async function copyMessageViaBot(srcChatId, destChatId, messageId) {
  const token = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is missing in environment variables');
  }

  const formattedSrc = formatChatIdForBot(srcChatId);
  const formattedDest = formatChatIdForBot(destChatId);

  const res = await fetch(`https://api.telegram.org/bot${token}/copyMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: formattedDest,
      from_chat_id: formattedSrc,
      message_id: messageId,
      caption: '',
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.description || 'Telegram Bot copyMessage failed');
  }

  return data.result.message_id;
}

/**
 * Robust track transfer: tries Bot API first, falls back to MTProto forwardMessages with dropAuthor: true.
 */
async function transferTrack(client, teledriveEntity, channelEntity, messageId) {
  const TELEDRIVE_CHANNEL = cleanEnv(process.env.TELEDRIVE_CHANNEL);
  const MUSIC_CHANNEL = cleanEnv(process.env.TELEGRAM_CHANNEL);
  const token = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);

  // Strategy 1: Telegram Bot API copyMessage
  if (token && TELEDRIVE_CHANNEL && MUSIC_CHANNEL) {
    try {
      const botMsgId = await copyMessageViaBot(TELEDRIVE_CHANNEL, MUSIC_CHANNEL, messageId);
      if (botMsgId) return botMsgId;
    } catch (botErr) {
      console.warn(`[TeleDrive Sync] Bot API copyMessage failed (${botErr.message}), falling back to MTProto forwardMessages...`);
    }
  }

  // Strategy 2: GramJS MTProto forwardMessages with dropAuthor (clean copy without forward attribution)
  try {
    const sent = await client.forwardMessages(channelEntity, {
      messages: [messageId],
      fromPeer: teledriveEntity,
      dropAuthor: true,
    });
    const flattened = Array.isArray(sent) ? sent.flat(Infinity) : [sent];
    const forwardedMsg = flattened.find((m) => m && m.id);
    if (forwardedMsg && forwardedMsg.id) {
      // Clear TeleDrive caption JSON (td1:{"id":...}) from the transferred message in Music Library
      try {
        await client.editMessage(channelEntity, { message: forwardedMsg.id, text: '' });
      } catch (_) {}
      return forwardedMsg.id;
    }
  } catch (mtprotoErr) {
    throw new Error(`Both Bot API and MTProto transfer failed. MTProto error: ${mtprotoErr.message}`);
  }

  throw new Error('Transfer failed: no destination message ID returned');
}

/**
 * Connect to the source TeleDrive channel if TELEDRIVE_CHANNEL is defined.
 */
async function initTeleDrive(client, channelEntity, resolveChannelFn) {
  const TELEDRIVE_CHANNEL = cleanEnv(process.env.TELEDRIVE_CHANNEL);
  if (!TELEDRIVE_CHANNEL) return null;

  try {
    teledriveEntity = await resolveChannelFn(TELEDRIVE_CHANNEL);
  } catch (err) {
    console.warn(`[TeleDrive Sync] Could not resolve TELEDRIVE_CHANNEL "${TELEDRIVE_CHANNEL}": ${err.message}`);
    return null;
  }

  const token = cleanEnv(process.env.TELEGRAM_BOT_TOKEN);
  let botInfo = '';
  if (token) {
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const meData = await meRes.json();
      if (meData.ok && meData.result?.username) {
        botUsername = meData.result.username;
        botInfo = ` • Bot: ${BOLD}@${botUsername}${RESET}`;
      }
    } catch (_) {}
  }

  if (teledriveEntity && logCliFn) {
    const teleTitle = teledriveEntity.title || teledriveEntity.username || TELEDRIVE_CHANNEL;
    const teleId = teledriveEntity.id ? ` ${DIM}(ID: ${teledriveEntity.id})${RESET}` : '';
    logCliFn('TELEDRIVE', `Connected to source channel: ${BOLD}${teleTitle}${RESET}${teleId}${botInfo}`);
  }

  return teledriveEntity;
}

let isSyncInProgress = false;

/**
 * Scans the last 100 messages in the TeleDrive source channel for any audio tracks
 * that are missing from trackIndex, and automatically forwards them to the Music Library channel.
 * Adheres strictly to the Lossless & Dolby Atmos quality gate.
 */
async function syncTeleDriveExistingTracks(client, channelEntity, helpers) {
  if (!teledriveEntity || !channelEntity) return;
  if (isSyncInProgress) return;
  isSyncInProgress = true;

  const { isAudioDocument, parseTrackMessage, isDuplicate, trackIndex, processTrackUpload } = helpers;
  const state = loadTeleDriveState();
  let maxSeenId = state.lastSyncedId || 0;

  let scannedCount = 0;
  let copiedCount = 0;
  let skippedLossyCount = 0;
  let alreadyHaveCount = 0;

  try {
    for await (const msg of client.iterMessages(teledriveEntity, { limit: 100, waitTime: 0 })) {
      if (msg.id > maxSeenId) {
        maxSeenId = msg.id;
      }

      const doc = msg.media?.document;
      if (!doc || !isAudioDocument(doc)) continue;

      scannedCount++;

      // Quick parse of the candidate track without caching media in primary cache
      const candidateTrack = await parseTrackMessage(msg, false);
      if (!candidateTrack) continue;

      // Quality Gate: Only sync Lossless (FLAC, ALAC, WAV) and Dolby Atmos tracks
      if (!isLosslessOrAtmos(candidateTrack)) {
        skippedLossyCount++;
        continue;
      }

      // Check if duplicate or already existing in trackIndex
      const alreadyHave = trackIndex.some((t) => {
        if (t.sizeBytes && candidateTrack.sizeBytes && t.sizeBytes === candidateTrack.sizeBytes && Math.abs((t.duration || 0) - (candidateTrack.duration || 0)) <= 3) {
          return true;
        }
        return isDuplicate(t, candidateTrack);
      });
      if (alreadyHave) {
        alreadyHaveCount++;
        continue;
      }

      try {
        const newMsgId = await transferTrack(client, teledriveEntity, channelEntity, msg.id);

        if (newMsgId) {
          logSync(msg.id, newMsgId);
          const [destMsg] = await client.getMessages(channelEntity, { ids: [newMsgId] });
          if (destMsg) {
            const newTrack = await parseTrackMessage(destMsg, true);
            if (newTrack) {
              await processTrackUpload(newTrack);
              copiedCount++;
            }
          }
        }
      } catch (fwdErr) {
        console.warn(`[TeleDrive Sync Error] Failed to transfer track ${msg.id}:`, fwdErr.message);
      }
    }

    state.lastSyncedId = Math.max(state.lastSyncedId || 0, maxSeenId);
    saveTeleDriveState(state);

    if (copiedCount > 0 && logCliFn) {
      logCliFn('SYNC', `Scanned last 100 messages: forwarded ${BOLD}${copiedCount}${RESET} missing track(s) to Music Library`);
    }
  } catch (err) {
    console.error(`[TeleDrive Sync Error] 100-message scan failed:`, err.message);
  } finally {
    isSyncInProgress = false;
  }
}

/**
 * Event hook: intercepts audio uploads appearing in the TeleDrive channel
 * and automatically forwards them to the Music Library channel.
 * Filters out lossy tracks and updates watermark.
 */
async function handleTeleDriveUpload(message, client, channelEntity, helpers) {
  if (!teledriveEntity || !channelEntity) return false;

  const isTeleDriveChannel = getRawPeerId(message.peerId) === getRawPeerId(teledriveEntity);
  if (!isTeleDriveChannel) return false;

  const { isAudioDocument, parseTrackMessage } = helpers;
  const doc = message.media?.document;
  if (!doc || !isAudioDocument(doc)) return false;

  // Quality Gate: Parse candidate and verify it is Lossless or Dolby Atmos
  const candidateTrack = await parseTrackMessage(message, false);
  if (!candidateTrack) return false;

  if (!isLosslessOrAtmos(candidateTrack)) {
    console.log(`[TeleDrive Sync] Skipping lossy upload "${candidateTrack.title}" (${candidateTrack.format || 'lossy'} / ${candidateTrack.quality || 'Standard'}): Music Library accepts only Lossless & Dolby Atmos.`);
    return false;
  }

  try {
    const newMsgId = await transferTrack(client, teledriveEntity, channelEntity, message.id);
    if (newMsgId) {
      logSync(message.id, newMsgId);
      const state = loadTeleDriveState();
      state.lastSyncedId = Math.max(state.lastSyncedId || 0, message.id);
      saveTeleDriveState(state);
    }
  } catch (syncErr) {
    console.error(`[TeleDrive Sync Error]: Failed to transfer message ${message.id}:`, syncErr.message);
  }

  return true;
}

module.exports = {
  setLogCli,
  initTeleDrive,
  syncTeleDriveExistingTracks,
  handleTeleDriveUpload,
  copyMessageViaBot,
  transferTrack,
  formatChatIdForBot,
  getRawPeerId,
  getTeleDriveEntity: () => teledriveEntity,
  isLosslessOrAtmos,
};

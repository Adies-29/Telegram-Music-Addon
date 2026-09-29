const express = require('express');
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const QRCode = require('qrcode');
const tunnel = require('./tunnel');

const router = express.Router();
const envPath = path.join(__dirname, '.env');

let activeSetup = null;
let setupTimeout = null;
let onConfigSavedCallback = null;
let onRestartCallback = null;
let getActiveClientFn = null;
let getTracksCountFn = null;

function setOnConfigSaved(fn) {
  onConfigSavedCallback = fn;
}

function setOnRestart(fn) {
  onRestartCallback = fn;
}

function setGetActiveClient(fn) {
  getActiveClientFn = fn;
}

function setGetTracksCount(fn) {
  getTracksCountFn = fn;
}

function getLibraryTracksCount() {
  if (typeof getTracksCountFn === 'function') {
    const c = getTracksCountFn();
    if (typeof c === 'number' && c >= 0) return c;
  }
  try {
    const cachePath = path.join(__dirname, 'tracks_cache.json');
    if (fs.existsSync(cachePath)) {
      const arr = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (Array.isArray(arr)) return arr.length;
    }
  } catch (_) {}
  return 0;
}

function readEnvMap() {
  const map = {};
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        map[key] = val;
      }
    }
  }
  return map;
}

function writeEnvKeys(updates) {
  let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8').split('\n') : [];
  const handled = new Set();
  const newLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      newLines.push(line);
      continue;
    }
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      if (updates.hasOwnProperty(key)) {
        const val = updates[key];
        const safeVal = (typeof val === 'string' && (val.includes(' ') || val.includes('"'))) ? `"${val.replace(/"/g, '\\"')}"` : val;
        newLines.push(`${key}=${safeVal}`);
        handled.add(key);
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }

  for (const [key, val] of Object.entries(updates)) {
    if (!handled.has(key) && val !== undefined && val !== null && val !== '') {
      const safeVal = (typeof val === 'string' && (val.includes(' ') || val.includes('"'))) ? `"${val.replace(/"/g, '\\"')}"` : val;
      newLines.push(`${key}=${safeVal}`);
    }
  }

  fs.writeFileSync(envPath, newLines.join('\n').trim() + '\n', 'utf-8');
}

function isConfigured() {
  const env = readEnvMap();
  return Boolean(env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH && env.TELEGRAM_SESSION_STRING && env.TELEGRAM_CHANNEL);
}

function clearActiveSetup() {
  if (setupTimeout) clearTimeout(setupTimeout);
  if (activeSetup && activeSetup.client) {
    activeSetup.client.disconnect().catch(() => {});
  }
  activeSetup = null;
  setupTimeout = null;
}

router.get('/status', (req, res) => {
  const env = readEnvMap();
  const configured = Boolean(env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH && env.TELEGRAM_SESSION_STRING && env.TELEGRAM_CHANNEL);
  res.json({
    configured,
    tracksCount: getLibraryTracksCount(),
    apiId: env.TELEGRAM_API_ID || (activeSetup?.apiId ? activeSetup.apiId.toString() : null),
    apiHash: env.TELEGRAM_API_HASH || activeSetup?.apiHash || null,
    phoneNumber: env.TELEGRAM_PHONE || activeSetup?.phoneNumber || null,
    channel: env.TELEGRAM_CHANNEL || null,
    teledriveChannel: env.TELEDRIVE_CHANNEL || null,
    port: parseInt(env.PORT || '3000', 10),
    enableBotSync: env.ENABLE_BOT_SYNC === 'true',
    botToken: env.TELEGRAM_BOT_TOKEN || null,
    hasSecret: Boolean(env.URL_SECRET || env.ACCESS_TOKEN),
    urlSecret: env.URL_SECRET || null,
    customPublicUrl: env.PUBLIC_URL || null,
    enableTunnel: env.ENABLE_CLOUDFLARE_TUNNEL !== 'false',
    tunnelActive: Boolean(tunnel.getTunnelUrl()),
    tunnelUrl: tunnel.getTunnelUrl(),
    tunnelInstalled: tunnel.isInstalled(),
  });
});

router.get('/tunnel', (req, res) => {
  res.json({
    active: Boolean(tunnel.getTunnelUrl()),
    url: tunnel.getTunnelUrl(),
    isInstalled: tunnel.isInstalled(),
  });
});

router.post('/tunnel', async (req, res) => {
  const env = readEnvMap();
  const port = parseInt(req.body.port || env.PORT || '3000', 10);
  try {
    const url = await tunnel.startTunnel(port);
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to start tunnel' });
  }
});

router.post('/send-code', async (req, res) => {
  const { apiId, apiHash, phoneNumber } = req.body || {};

  if (!apiId || !apiHash || !phoneNumber) {
    return res.status(400).json({ error: 'apiId, apiHash, and phoneNumber are required' });
  }

  const parsedApiId = parseInt(String(apiId).trim(), 10);
  const cleanApiHash = String(apiHash).trim();
  const cleanPhone = String(phoneNumber).trim();

  if (isNaN(parsedApiId) || !cleanApiHash || !cleanPhone) {
    return res.status(400).json({ error: 'Invalid API credentials or phone number format' });
  }

  try {
    clearActiveSetup();

    const client = new TelegramClient(new StringSession(''), parsedApiId, cleanApiHash, {
      connectionRetries: 10,
      useWSS: true,
    });

    await client.connect();

    const sendResult = await client.sendCode({
      apiId: parsedApiId,
      apiHash: cleanApiHash,
    }, cleanPhone);

    activeSetup = {
      client,
      apiId: parsedApiId,
      apiHash: cleanApiHash,
      phoneNumber: cleanPhone,
      phoneCodeHash: sendResult.phoneCodeHash,
      isAuthorized: false,
    };

    setupTimeout = setTimeout(() => {
      clearActiveSetup();
    }, 10 * 60 * 1000);

    return res.json({
      ok: true,
      phoneCodeHash: sendResult.phoneCodeHash,
      isCodeViaApp: Boolean(sendResult.isCodeViaApp),
    });
  } catch (err) {
    clearActiveSetup();
    return res.status(500).json({ error: err.message || 'Failed to send verification code' });
  }
});

router.post('/verify-code', async (req, res) => {
  const { phoneCode } = req.body || {};

  if (!activeSetup || !activeSetup.client) {
    return res.status(400).json({ error: 'No pending login session. Please request a code first.' });
  }

  if (!phoneCode) {
    return res.status(400).json({ error: 'phoneCode is required' });
  }

  try {
    const cleanCode = String(phoneCode).trim();
    const result = await activeSetup.client.invoke(new Api.auth.SignIn({
      phoneNumber: activeSetup.phoneNumber,
      phoneCodeHash: activeSetup.phoneCodeHash,
      phoneCode: cleanCode,
    }));

    activeSetup.sessionString = activeSetup.client.session.save();
    activeSetup.isAuthorized = true;

    return res.json({
      ok: true,
      user: {
        id: result.user ? result.user.id.toString() : null,
        firstName: result.user?.firstName || '',
        username: result.user?.username || null,
      },
    });
  } catch (err) {
    if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return res.json({
        ok: false,
        requires2FA: true,
        message: 'Two-factor authentication password required',
      });
    }
    return res.status(400).json({ error: err.message || 'Invalid code' });
  }
});

router.post('/verify-2fa', async (req, res) => {
  const { password } = req.body || {};

  if (!activeSetup || !activeSetup.client) {
    return res.status(400).json({ error: 'No pending login session.' });
  }

  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  try {
    const result = await activeSetup.client.signInWithPassword({
      apiId: activeSetup.apiId,
      apiHash: activeSetup.apiHash,
    }, {
      password: () => String(password),
      onError: (err) => {
        throw err;
      },
    });

    activeSetup.sessionString = activeSetup.client.session.save();
    activeSetup.isAuthorized = true;

    return res.json({
      ok: true,
      user: {
        id: result ? (result.id ? result.id.toString() : null) : null,
        firstName: result?.firstName || '',
        username: result?.username || null,
      },
    });
  } catch (err) {
    const msg = err.errorMessage || err.message || 'Invalid 2FA password';
    if (msg.includes('PASSWORD_HASH_INVALID')) {
      return res.status(400).json({ error: 'Incorrect 2FA password. Please check your password and try again.' });
    }
    return res.status(400).json({ error: msg });
  }
});

router.get('/channels', async (req, res) => {
  let currentClient = (activeSetup && activeSetup.client && activeSetup.isAuthorized) ? activeSetup.client : null;
  if (!currentClient && getActiveClientFn) {
    const active = getActiveClientFn();
    if (active && active.connected) {
      currentClient = active;
    }
  }

  if (!currentClient) {
    return res.status(401).json({ error: 'Please authorize Telegram first' });
  }

  try {
    const dialogs = await currentClient.getDialogs({ limit: 100 });
    const channels = [];

    for (const d of dialogs) {
      if (d.isChannel || d.isGroup) {
        const entityId = d.entity.id ? d.entity.id.toString() : '';
        const fullId = entityId.startsWith('-100') ? entityId : `-100${entityId}`;
        const isPrivate = !d.entity.username;
        const isCreator = Boolean(d.entity.creator);
        channels.push({
          id: fullId,
          title: d.title || 'Untitled Channel',
          username: d.entity.username ? `@${d.entity.username}` : null,
          isChannel: Boolean(d.isChannel),
          isGroup: Boolean(d.isGroup),
          isPrivate,
          isCreator,
        });
      }
    }

    return res.json({ ok: true, channels });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch channels' });
  }
});

router.get('/qr', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const svg = await QRCode.toString(targetUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    return res.send(svg);
  } catch (err) {
    return res.status(500).send('Failed to generate QR code');
  }
});

async function resolveAndValidateChannel(client, channelInput) {
  if (!channelInput) throw new Error('Channel input cannot be empty.');
  const rawInput = String(channelInput).trim();
  let cleanInput = rawInput;

  // Handle t.me URLs
  if (cleanInput.includes('t.me/c/')) {
    // Private channel link: https://t.me/c/1234567890/123
    const match = cleanInput.match(/t\.me\/c\/(\d+)/);
    if (match) {
      cleanInput = `-100${match[1]}`;
    }
  } else if (cleanInput.includes('t.me/joinchat/')) {
    cleanInput = cleanInput.trim();
  } else if (cleanInput.startsWith('https://t.me/')) {
    cleanInput = '@' + cleanInput.replace('https://t.me/', '').split('/')[0].replace(/^@/, '');
  } else if (cleanInput.startsWith('t.me/')) {
    cleanInput = '@' + cleanInput.replace('t.me/', '').split('/')[0].replace(/^@/, '');
  }

  const stripped = cleanInput.replace(/^-100/, '').replace(/^@/, '').toLowerCase();

  // 1. Check user dialogs (populates access hashes for private channels)
  try {
    const dialogs = await client.getDialogs({ limit: 100 });
    for (const d of dialogs) {
      const entity = d.entity;
      if (!entity) continue;
      const entityId = entity.id ? entity.id.toString() : '';
      const username = (entity.username || '').toLowerCase();
      const title = (entity.title || '').toLowerCase();

      if (
        entityId === cleanInput ||
        `-100${entityId}` === cleanInput ||
        entityId === stripped ||
        (username && username === stripped) ||
        title === cleanInput.toLowerCase()
      ) {
        const fullId = entityId.startsWith('-100') ? entityId : `-100${entityId}`;
        return {
          id: fullId,
          title: d.title || entity.title || 'Channel',
          username: entity.username ? `@${entity.username}` : null,
          matched: true,
        };
      }
    }
  } catch (_) {}

  // 2. Direct getEntity resolution fallback
  try {
    const entity = await client.getEntity(cleanInput);
    if (entity) {
      const entityId = entity.id ? entity.id.toString() : '';
      const fullId = entityId.startsWith('-100') ? entityId : `-100${entityId}`;
      return {
        id: fullId,
        title: entity.title || entity.username || 'Channel',
        username: entity.username ? `@${entity.username}` : null,
        matched: true,
      };
    }
  } catch (err) {
    throw new Error(`Wrong channel ID, URL, or username. Could not find or access "${rawInput}". Please check that your Telegram account is a member or admin.`);
  }

  throw new Error(`Wrong channel ID, URL, or username. Could not find or access "${rawInput}". Please check that your Telegram account is a member or admin.`);
}

router.post('/validate-channel', async (req, res) => {
  let currentClient = (activeSetup && activeSetup.client && activeSetup.isAuthorized) ? activeSetup.client : null;
  if (!currentClient && getActiveClientFn) {
    const active = getActiveClientFn();
    if (active && active.connected) {
      currentClient = active;
    }
  }

  if (!currentClient) {
    return res.status(401).json({ error: 'Please authorize Telegram first.' });
  }

  const { channel } = req.body || {};
  if (!channel || !String(channel).trim()) {
    return res.status(400).json({ error: 'Please enter your channel ID, URL, or username.' });
  }

  try {
    const validated = await resolveAndValidateChannel(currentClient, channel);
    return res.json({ ok: true, channel: validated });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.post('/save', async (req, res) => {
  const env = readEnvMap();
  const apiIdToSave = (activeSetup && activeSetup.apiId) ? activeSetup.apiId.toString() : env.TELEGRAM_API_ID;
  const apiHashToSave = (activeSetup && activeSetup.apiHash) ? activeSetup.apiHash : env.TELEGRAM_API_HASH;
  const sessionToSave = (activeSetup && activeSetup.sessionString) ? activeSetup.sessionString : env.TELEGRAM_SESSION_STRING;

  if (!apiIdToSave || !apiHashToSave || !sessionToSave) {
    return res.status(400).json({ error: 'Telegram session not authorized' });
  }

  const { channel, teledriveChannel, enableBotSync, botToken, enableTunnel, customPublicUrl, urlSecret, port } = req.body || {};

  if (!channel) {
    return res.status(400).json({ error: 'Telegram channel is required' });
  }

  if (enableBotSync && (!botToken || !String(botToken).trim())) {
    return res.status(400).json({ error: 'Bot Token is required when Bot Automation is enabled' });
  }

  let currentClient = (activeSetup && activeSetup.client && activeSetup.isAuthorized) ? activeSetup.client : null;
  if (!currentClient && getActiveClientFn) {
    const active = getActiveClientFn();
    if (active && active.connected) {
      currentClient = active;
    }
  }

  let resolvedChannel = String(channel).trim();
  if (currentClient) {
    try {
      const validated = await resolveAndValidateChannel(currentClient, channel);
      resolvedChannel = validated.id || resolvedChannel;
    } catch (valErr) {
      return res.status(400).json({ error: valErr.message });
    }
  }

  try {
    const updates = {
      TELEGRAM_API_ID: apiIdToSave,
      TELEGRAM_API_HASH: apiHashToSave,
      TELEGRAM_SESSION_STRING: sessionToSave,
      TELEGRAM_CHANNEL: resolvedChannel,
    };

    if (activeSetup && activeSetup.phoneNumber) {
      updates.TELEGRAM_PHONE = activeSetup.phoneNumber;
    }
    if (botToken !== undefined) {
      if (String(botToken).trim()) {
        updates.TELEGRAM_BOT_TOKEN = String(botToken).trim();
      } else {
        updates.TELEGRAM_BOT_TOKEN = '';
      }
    }
    if (teledriveChannel !== undefined) {
      if (String(teledriveChannel).trim()) {
        updates.TELEDRIVE_CHANNEL = String(teledriveChannel).trim();
      } else {
        updates.TELEDRIVE_CHANNEL = '';
      }
    }
    if (urlSecret !== undefined) {
      updates.URL_SECRET = String(urlSecret).trim();
    }
    let parsedPort = 3000;
    if (port !== undefined && String(port).trim() !== '') {
      const p = parseInt(port, 10);
      if (!isNaN(p) && p >= 1024 && p <= 65535) {
        parsedPort = p;
      }
    }
    updates.PORT = parsedPort.toString();
    if (enableBotSync !== undefined) {
      updates.ENABLE_BOT_SYNC = enableBotSync ? 'true' : 'false';
    }
    if (enableTunnel !== undefined) {
      updates.ENABLE_CLOUDFLARE_TUNNEL = enableTunnel ? 'true' : 'false';
    }
    if (customPublicUrl !== undefined) {
      updates.PUBLIC_URL = String(customPublicUrl).trim().replace(/\/+$/, '');
    }

    writeEnvKeys(updates);
    for (const [k, v] of Object.entries(updates)) {
      process.env[k] = v;
    }

    let baseOrigin = '';
    if (updates.PUBLIC_URL) {
      baseOrigin = updates.PUBLIC_URL;
    }

    if (enableTunnel) {
      try {
        const tunnelUrl = await tunnel.startTunnel(parseInt(updates.PORT || '3000', 10));
        if (!baseOrigin) {
          baseOrigin = tunnelUrl;
        }
      } catch (tunnelErr) {
        console.warn('Could not auto-start Cloudflare tunnel:', tunnelErr.message);
      }
    } else {
      tunnel.stopTunnel();
    }

    if (!baseOrigin) {
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${updates.PORT || '3000'}`;
      baseOrigin = `${proto}://${host}`;
    }

    const secretPath = updates.URL_SECRET ? `/${updates.URL_SECRET}` : '';
    const manifestUrl = `${baseOrigin}${secretPath}/manifest.json`;

    if (typeof onConfigSavedCallback === 'function') {
      setTimeout(() => {
        onConfigSavedCallback(updates);
      }, 500);
    }

    return res.json({
      ok: true,
      manifestUrl,
      tracksCount: getLibraryTracksCount(),
      config: {
        channel: updates.TELEGRAM_CHANNEL,
        hasSecret: Boolean(updates.URL_SECRET),
        port: updates.PORT || '3000',
        hasTunnel: Boolean(enableTunnel),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save configuration' });
  }
});

router.post('/restart', async (req, res) => {
  try {
    if (typeof onRestartCallback === 'function') {
      const result = await onRestartCallback();
      return res.json({
        ok: true,
        message: 'Server services restarted successfully',
        tracksCount: getLibraryTracksCount(),
        ...(result || {})
      });
    }

    return res.json({
      ok: true,
      message: 'Server services ready',
      tracksCount: getLibraryTracksCount()
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to restart server services' });
  }
});

module.exports = {
  router,
  readEnvMap,
  writeEnvKeys,
  isConfigured,
  setOnConfigSaved,
  setOnRestart,
  setGetActiveClient,
  setGetTracksCount,
};

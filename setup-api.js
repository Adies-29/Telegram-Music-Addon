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

function setOnConfigSaved(fn) {
  onConfigSavedCallback = fn;
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
    channel: env.TELEGRAM_CHANNEL || null,
    port: parseInt(env.PORT || '3000', 10),
    hasSecret: Boolean(env.URL_SECRET || env.ACCESS_TOKEN),
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
      connectionRetries: 5,
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
    }, { password: String(password) });

    activeSetup.sessionString = activeSetup.client.session.save();
    activeSetup.isAuthorized = true;

    return res.json({
      ok: true,
      user: {
        id: result.id ? result.id.toString() : null,
        firstName: result.firstName || '',
        username: result.username || null,
      },
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid 2FA password' });
  }
});

router.get('/channels', async (req, res) => {
  if (!activeSetup || !activeSetup.client || !activeSetup.isAuthorized) {
    return res.status(401).json({ error: 'Please authorize Telegram first' });
  }

  try {
    const dialogs = await activeSetup.client.getDialogs({ limit: 100 });
    const channels = [];

    for (const d of dialogs) {
      if (d.isChannel || d.isGroup) {
        const entityId = d.entity.id ? d.entity.id.toString() : '';
        const fullId = entityId.startsWith('-100') ? entityId : `-100${entityId}`;
        channels.push({
          id: fullId,
          title: d.title || 'Untitled Channel',
          username: d.entity.username ? `@${d.entity.username}` : null,
          isChannel: Boolean(d.isChannel),
          isGroup: Boolean(d.isGroup),
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
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(svg);
  } catch (err) {
    return res.status(500).send('Failed to generate QR code');
  }
});

router.post('/save', async (req, res) => {
  if (!activeSetup || !activeSetup.isAuthorized || !activeSetup.sessionString) {
    return res.status(400).json({ error: 'Telegram session not authorized' });
  }

  const { channel, teledriveChannel, enableBotSync, enableTunnel, customPublicUrl, urlSecret, port } = req.body || {};

  if (!channel) {
    return res.status(400).json({ error: 'Music channel is required' });
  }

  try {
    const updates = {
      TELEGRAM_API_ID: activeSetup.apiId.toString(),
      TELEGRAM_API_HASH: activeSetup.apiHash,
      TELEGRAM_SESSION_STRING: activeSetup.sessionString,
      TELEGRAM_CHANNEL: String(channel).trim(),
    };

    if (teledriveChannel && String(teledriveChannel).trim()) {
      updates.TELEDRIVE_CHANNEL = String(teledriveChannel).trim();
    }
    if (urlSecret && String(urlSecret).trim()) {
      updates.URL_SECRET = String(urlSecret).trim();
    }
    if (port && !isNaN(parseInt(port, 10))) {
      updates.PORT = parseInt(port, 10).toString();
    }
    if (enableBotSync !== undefined) {
      updates.ENABLE_BOT_SYNC = enableBotSync ? 'true' : 'false';
    }
    if (enableTunnel !== undefined) {
      updates.ENABLE_CLOUDFLARE_TUNNEL = enableTunnel ? 'true' : 'false';
    }
    if (customPublicUrl && String(customPublicUrl).trim()) {
      updates.PUBLIC_URL = String(customPublicUrl).trim().replace(/\/+$/, '');
    }

    writeEnvKeys(updates);

    let baseOrigin = '';
    if (enableTunnel) {
      try {
        const tunnelUrl = await tunnel.startTunnel(parseInt(updates.PORT || '3000', 10));
        baseOrigin = tunnelUrl;
      } catch (tunnelErr) {
        console.warn('Could not auto-start Cloudflare tunnel:', tunnelErr.message);
      }
    }

    if (!baseOrigin && updates.PUBLIC_URL) {
      baseOrigin = updates.PUBLIC_URL;
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

module.exports = {
  router,
  readEnvMap,
  writeEnvKeys,
  isConfigured,
  setOnConfigSaved,
};

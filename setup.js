require('dotenv').config();
const readline = require('readline');
const crypto = require('crypto');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { readEnvMap, writeEnvKeys } = require('./setup-api');
const tunnel = require('./tunnel');

function askQuestion(rl, query, hideInput = false) {
  return new Promise((resolve) => {
    if (!hideInput) {
      rl.question(query, (ans) => resolve(ans.trim()));
      return;
    }
    const stdout = process.stdout;
    stdout.write(query);
    let buffer = '';
    const onData = (char) => {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        stdout.write('\n');
        resolve(buffer.trim());
      } else if (char === '\u0008' || char === '\x7f') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        buffer += char;
        stdout.write('*');
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

(async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('=================================================================');
    console.log('             Telegram Music Addon - Setup Wizard                 ');
    console.log('=================================================================\n');

    const env = readEnvMap();

    let apiIdStr = env.TELEGRAM_API_ID || '';
    let apiHash = env.TELEGRAM_API_HASH || '';

    if (!apiIdStr || !apiHash) {
      console.log('1. Telegram API Credentials');
      console.log('   Log in at https://my.telegram.org and open "API development tools"');
      console.log('   to obtain your API ID and API Hash.\n');

      while (!apiIdStr) {
        apiIdStr = await askQuestion(rl, 'Enter TELEGRAM_API_ID: ');
      }
      while (!apiHash) {
        apiHash = await askQuestion(rl, 'Enter TELEGRAM_API_HASH: ');
      }
    } else {
      console.log(`[✔] Using existing Telegram API credentials from .env (ID: ${apiIdStr})`);
    }

    const apiId = parseInt(apiIdStr, 10);
    apiHash = apiHash.trim();

    if (isNaN(apiId) || !apiHash) {
      console.error('Invalid API ID or Hash.');
      process.exit(1);
    }

    let sessionString = env.TELEGRAM_SESSION_STRING || '';
    let client = null;

    if (sessionString) {
      console.log('\nExisting Telegram session found. Testing connection...');
      client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 3,
      });
      client.setLogLevel('error');
      try {
        await client.connect();
        const me = await client.getMe();
        console.log(`[✔] Authenticated as: ${me.firstName || ''} ${me.username ? '(@' + me.username + ')' : ''}`);
      } catch (_) {
        console.log('Session expired or invalid. Starting new login...');
        sessionString = '';
        client = null;
      }
    }

    if (!sessionString) {
      console.log('\n2. Telegram Login');
      const phoneNumber = await askQuestion(rl, 'Enter your phone number (with country code, e.g. +1234567890): ');
      if (!phoneNumber) {
        console.error('Phone number is required.');
        process.exit(1);
      }

      client = new TelegramClient(new StringSession(''), apiId, apiHash, {
        connectionRetries: 5,
      });
      client.setLogLevel('error');
      await client.connect();

      console.log('Sending login code...');
      const sendResult = await client.sendCode({ apiId, apiHash }, phoneNumber);
      const phoneCode = await askQuestion(rl, 'Enter verification code received in Telegram: ');

      try {
        await client.invoke(new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash: sendResult.phoneCodeHash,
          phoneCode,
        }));
      } catch (err) {
        if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          console.log('\nTwo-step verification (2FA) is enabled on this account.');
          const password = await askQuestion(rl, 'Enter your 2FA password: ', true);
          await client.signInWithPassword({ apiId, apiHash }, {
            password: () => password,
            onError: (err) => { throw err; },
          });
        } else {
          throw err;
        }
      }

      sessionString = client.session.save();
      console.log('[✔] Telegram login successful!');
    }

    console.log('\n3. Select Music Channel');
    console.log('Fetching your Telegram channels...');

    const dialogs = await client.getDialogs({ limit: 100 });
    const channels = [];

    for (const d of dialogs) {
      if (d.isChannel || d.isGroup) {
        const entityId = d.entity.id ? d.entity.id.toString() : '';
        const fullId = entityId.startsWith('-100') ? entityId : `-100${entityId}`;
        channels.push({
          id: fullId,
          title: d.title || 'Untitled',
          username: d.entity.username ? `@${d.entity.username}` : '',
        });
      }
    }

    let selectedChannel = '';
    if (channels.length > 0) {
      console.log('\nFound channels:');
      channels.forEach((ch, idx) => {
        console.log(`  [${idx + 1}] ${ch.title} ${ch.username ? '(' + ch.username + ')' : ''}`);
      });
      console.log(`  [${channels.length + 1}] Enter custom Channel ID / Username`);

      const choice = await askQuestion(rl, `\nSelect your channel (1-${channels.length + 1}): `);
      const choiceIdx = parseInt(choice, 10) - 1;

      if (choiceIdx >= 0 && choiceIdx < channels.length) {
        selectedChannel = channels[choiceIdx].id;
      }
    }

    if (!selectedChannel) {
      selectedChannel = await askQuestion(rl, 'Enter Channel Username or numeric ID (e.g. @my_channel or -100...): ');
    }

    if (!selectedChannel) {
      console.error('Music channel is required.');
      process.exit(1);
    }

    console.log('\n4. Bot Automation & Options');
    const botAns = await askQuestion(rl, 'Enable bot automation for lossless search & sync? (Y/n): ');
    const enableBotSync = !botAns || botAns.toLowerCase().startsWith('y');

    const defaultPort = env.PORT || '3000';
    const portAns = await askQuestion(rl, `Server port [default: ${defaultPort}]: `);
    const port = portAns || defaultPort;

    const existingSecret = env.URL_SECRET || '';
    const defaultSecret = existingSecret || crypto.randomBytes(4).toString('hex');
    const secretAns = await askQuestion(rl, `URL Secret protection [default: ${defaultSecret}]: `);
    const urlSecret = secretAns !== '' ? secretAns : defaultSecret;

    const tunnelAns = await askQuestion(rl, 'Enable Cloudflare HTTPS Tunnel for mobile BitChord? (Y/n): ');
    const enableTunnel = !tunnelAns || tunnelAns.toLowerCase().startsWith('y');

    const updates = {
      TELEGRAM_API_ID: apiId.toString(),
      TELEGRAM_API_HASH: apiHash,
      TELEGRAM_SESSION_STRING: sessionString,
      TELEGRAM_CHANNEL: selectedChannel,
      PORT: port,
      ENABLE_BOT_SYNC: enableBotSync ? 'true' : 'false',
      ENABLE_CLOUDFLARE_TUNNEL: enableTunnel ? 'true' : 'false',
      URL_SECRET: urlSecret,
    };

    let tunnelUrl = '';
    if (enableTunnel) {
      console.log('\nConnecting Cloudflare HTTPS Tunnel for mobile streaming...');
      try {
        tunnelUrl = await tunnel.startTunnel(parseInt(port, 10));
        console.log(`[✔] HTTPS Tunnel active: ${tunnelUrl}`);
      } catch (e) {
        console.log(`[!] Cloudflare Tunnel warning: ${e.message}`);
      }
    }

    writeEnvKeys(updates);

    console.log('\n=================================================================');
    console.log('                  SETUP COMPLETE!                                ');
    console.log('=================================================================\n');

    const secretPath = updates.URL_SECRET ? `/${updates.URL_SECRET}` : '';
    if (tunnelUrl) {
      console.log('Your BitChord Addon URL (HTTPS for phone):');
      console.log(`  ${tunnelUrl}${secretPath}/manifest.json\n`);
      console.log('Local Network URL (for PC / LAN):');
      console.log(`  http://localhost:${port}${secretPath}/manifest.json\n`);
    } else {
      console.log('Your BitChord Addon URL:');
      console.log(`  http://localhost:${port}${secretPath}/manifest.json\n`);
    }
    console.log('Configuration saved to .env. You can now start Telegram Music with:');
    console.log('  npm start\n');

    await client.disconnect();
    rl.close();
    process.exit(0);
  } catch (err) {
    console.error('\nSetup error:', err.message || err);
    rl.close();
    process.exit(1);
  }
})();

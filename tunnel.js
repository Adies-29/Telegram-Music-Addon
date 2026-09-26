const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

let tunnelProcess = null;
let tunnelUrl = null;
let startingPromise = null;

function getBinaryName() {
  return process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
}

function getLocalBinPath() {
  return path.join(__dirname, 'bin', getBinaryName());
}

function findCloudflared() {
  const localBin = getLocalBinPath();
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  try {
    const cmd = process.platform === 'win32' ? 'where cloudflared' : 'which cloudflared';
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    if (output) {
      const firstLine = output.split('\n')[0].trim();
      if (fs.existsSync(firstLine)) return firstLine;
    }
  } catch (_) {}

  return null;
}

function isInstalled() {
  return Boolean(findCloudflared());
}

function getDownloadUrl() {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return arch === 'x64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe';
  } else if (platform === 'darwin') {
    return arch === 'arm64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64';
  } else if (platform === 'linux') {
    if (arch === 'arm64') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
    if (arch === 'arm') return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm';
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
  }
  return null;
}

function downloadBinary(destPath) {
  return new Promise((resolve, reject) => {
    const url = getDownloadUrl();
    if (!url) return reject(new Error(`Unsupported platform: ${process.platform} ${process.arch}`));

    const binDir = path.dirname(destPath);
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const file = fs.createWriteStream(destPath);

    function fetchUrl(target) {
      https.get(target, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            if (process.platform !== 'win32') {
              try { fs.chmodSync(destPath, 0o755); } catch (_) {}
            }
            resolve(destPath);
          });
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    fetchUrl(url);
  });
}

async function ensureInstalled(onProgress) {
  const existing = findCloudflared();
  if (existing) return existing;

  const dest = getLocalBinPath();
  if (typeof onProgress === 'function') onProgress('Downloading cloudflared...');
  await downloadBinary(dest);
  return dest;
}

function startTunnel(port = 3000) {
  if (tunnelUrl) {
    return Promise.resolve(tunnelUrl);
  }
  if (startingPromise) {
    return startingPromise;
  }

  startingPromise = new Promise(async (resolve, reject) => {
    try {
      const bin = await ensureInstalled();
      const args = ['tunnel', '--url', `http://localhost:${port}`];

      tunnelProcess = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          startingPromise = null;
          reject(new Error('Tunnel startup timed out (30 seconds)'));
        }
      }, 30000);

      function handleOutput(data) {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          tunnelUrl = match[0];
          startingPromise = null;
          resolve(tunnelUrl);
        }
      }

      tunnelProcess.stdout.on('data', handleOutput);
      tunnelProcess.stderr.on('data', handleOutput);

      tunnelProcess.on('exit', () => {
        tunnelProcess = null;
        tunnelUrl = null;
        startingPromise = null;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error('Tunnel process exited unexpectedly'));
        }
      });
    } catch (err) {
      startingPromise = null;
      reject(err);
    }
  });

  return startingPromise;
}

function stopTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill('SIGTERM');
    } catch (_) {}
    tunnelProcess = null;
  }
  tunnelUrl = null;
  startingPromise = null;
}

function getTunnelUrl() {
  return tunnelUrl;
}

process.on('exit', stopTunnel);
process.on('SIGINT', () => { stopTunnel(); process.exit(); });
process.on('SIGTERM', () => { stopTunnel(); process.exit(); });

module.exports = {
  isInstalled,
  ensureInstalled,
  startTunnel,
  stopTunnel,
  getTunnelUrl,
};

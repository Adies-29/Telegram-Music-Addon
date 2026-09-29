# Telegram Music Addon

Self-hosted [BitChord](https://github.com/kushagrasinghx/BitChord) addon that streams your personal FLAC, Dolby Atmos, and hi-res audio library from a private Telegram channel, using GramJS and Express.

---

## Contents

- [About](#about)
- [Features](#features)
- [Performance benchmark](#performance-benchmark)
- [Quick start](#quick-start)
- [Networking and remote access (local hosting only)](#networking-and-remote-access-local-hosting-only)
- [WebDAV streaming](#webdav-streaming)
- [Channel commands and music search](#channel-commands-and-music-search)
- [How it works](#how-it-works)
- [API Endpoints](#api-endpoints)

---

## About

Telegram Music Addon lets you run a personal streaming backend without a dedicated storage server. It indexes audio files in your own private Telegram channel and streams them directly to BitChord on Android.

ExoPlayer connects with standard HTTP 206 range requests, reading 64 KB to 512 KB chunks on demand. Files stay in your private channel, so you avoid third-party storage fees, bandwidth quotas, and transcoding bottlenecks.

> [!NOTE]
> Keep your Telegram channel **Private**. Public channels get crawled by search engines and copyright bots.

---

## Features

- Personal channel storage with no fixed bandwidth quotas
- Direct FLAC and Dolby Atmos streaming via HTTP 206 range requests, no server-side re-encoding
- Under 10 ms track matching in local benchmarks (in-memory index lookup, not end-to-end playback time)
- Audio streamed directly from Telegram through the addon, no separate storage server needed. Bandwidth and performance are subject to Telegram, your hosting provider, network conditions, and applicable API limits.
- Built-in WebDAV server for BitChord, Symfonium, VLC, and operating system network mounts
- Spatial audio detection for E-AC-3 JOC streams in M4A containers and raw `.ec3` files
- Interactive 4-step web setup wizard at `/setup`, with auto-detected channel dropdown and mobile QR code pairing
- Mobile install page at `/install` that copies the addon URL to your clipboard automatically when opened (including when your phone scans the Step 4 QR code)
- In-channel `/s` and `/song` commands for Deezer search with inline download buttons (requires bot token, see below)
- ISRC lookup endpoints for exact recording code matching
- Audio deduplication: keeps the higher-quality copy when duplicates appear, with a 6-hour grace window before cleanup
- Chat cleaner that removes text chatter and media spam while preserving audio files, bot menus, and admin messages

---

## Performance benchmark

```text
Benchmark: local addon track matching / resolution
Result:    < 10 ms
Method:    terminal / API request timing
Note:      measures only addon-internal lookup, not end-to-end playback time
           (excludes provider switching, network latency, buffering, ExoPlayer startup)

BitChord search request
  ↓
Addon song matching: < 10 ms in local benchmark
  ↓
HTTP response / connection
  ↓
BitChord source switching
  ↓
Previous provider stops
  ↓
ExoPlayer prepares stream
  ↓
Internet / network latency
  ↓
🎵 Playback starts
```

The `< 10 ms` figure is the addon's own request and lookup time. Actual playback start time depends on BitChord's provider switching, network conditions, and player buffering.

---

## Quick start

### 1-Click Installer (Windows)

For Windows users who want a single file without running any commands:

1. Download **`Install-Telegram-Music.bat`** from the latest GitHub Release.
2. Double-click it.
3. The installer automatically:
   - Detects Node.js, installs it silently via Windows Package Manager or PowerShell if missing.
   - Downloads the latest addon package from GitHub.
   - Installs all dependencies.
   - Starts the server and opens `http://localhost:3000/setup` in your browser.

---

### Option A: Easy web setup (for git clones and ZIP downloads)

For users who already cloned the repo or extracted the ZIP:

1. **Start the setup wizard:**
   - **Windows:** Double-click `setup.bat` (runs `npm install` automatically if needed)
   - **Mac / Linux:** Run `npm start`
2. Your browser opens to `http://localhost:3000/setup` automatically. On first run with no configuration, the server opens it on its own. On Mac/Linux, if it does not open, navigate there manually.
3. Follow the 4 steps:
   - **Step 1 (Credentials):** Enter your Telegram `API_ID`, `API_HASH`, and phone number (from [my.telegram.org](https://my.telegram.org)).
   - **Step 2 (Verification):** Enter the login code sent to your Telegram app (and your 2FA password if enabled).
   - **Step 3 (Library):** Select your private music channel from the auto-detected dropdown.
   - **Step 4 (Connect):** Scan the QR code with your phone to open the mobile install page, or tap **Copy Addon URL** to paste into BitChord.

---

### Option B: Manual setup (Linux VPS or headless)

For remote servers, Docker, or terminal-only setups:

1. **Clone and install:**
   ```bash
   git clone https://github.com/Imnotshashwat/Telegram-Music-Addon.git
   cd Telegram-Music-Addon
   npm install
   ```
2. **Generate your session string:**
   ```bash
   npm run login
   ```
   Follow the prompts: API ID, API hash, phone number, login code, channel handle or ID.
3. **Configure `.env`:**
   Copy `env.example` to `.env` and fill in the 4 required Telegram parameters:
   ```env
   TELEGRAM_API_ID=1234567
   TELEGRAM_API_HASH=abcdef0123456789
   TELEGRAM_SESSION_STRING=1ApW...
   TELEGRAM_CHANNEL=-1001234567890
   ```
   Everything else in `env.example` is optional. `PORT` defaults to `3000`. Parameters left blank are unused. See `env.example` for the full list with comments.
4. **Start the server:**
   ```bash
   npm start
   ```

---

## Networking and remote access (local hosting only)

> [!NOTE]
> This section is **only for local hosting** (running on your own PC or home server).
>
> If you deploy to a cloud provider (Render, Fly.io, Railway, etc.), you do not need any of this. Those platforms automatically assign a public HTTPS domain. Just copy your service URL into BitChord and skip this section entirely.

Android ExoPlayer blocks unencrypted `http://` streams. To stream from a local machine to your phone over mobile data or outside your home Wi-Fi, you need a public HTTPS address.

### 1. Automated Cloudflare Quick Tunnel

The setup wizard includes this out of the box:

- Leave **Enable Cloudflare HTTPS Tunnel** checked in Step 3.
- The server provisions an `https://*.trycloudflare.com` address automatically on startup.
- Your phone can scan the Step 4 QR code and stream anywhere over 4G/5G or remote Wi-Fi.
- On Windows, you can also launch tunnel mode anytime with `start-https.bat`.

### 2. Permanent HTTPS with Tailscale Funnel

For a fixed address that survives PC restarts:

1. Install [Tailscale](https://tailscale.com) on your PC and phone.
2. In your [Tailscale Admin Console](https://login.tailscale.com/admin/dns), enable HTTPS Certificates under **DNS** > **HTTPS Certificates**.
3. Run Funnel in the background:
   ```bash
   tailscale funnel --bg 3000
   ```
4. In Step 3 (Advanced Options), enter your Tailscale address under **Custom Public Domain or Host**:
   ```text
   https://your-pc-name.your-tailnet.ts.net
   ```

---

### Protecting your deployment with URL_SECRET (optional)

Restricts your public addon URL with a secret path token so only your own devices can connect:

1. Enter your secret in **Advanced Options > URL Secret** in the setup wizard, or add to `.env`:
   ```env
   URL_SECRET=mysecret123
   ```
2. Your addon URL becomes:
   ```text
   https://<your-domain>/mysecret123/manifest.json
   ```
   Calls without the token receive HTTP `401 Unauthorized`.
3. `/ping` and `/icon.png` stay public so uptime monitors and icons work without the secret.

---

### Keeping it running 24/7 (cloud hosting only)

Free cloud tiers (Render, Fly.io, Railway) spin containers down after idle periods. Use a free monitor like [UptimeRobot](https://uptimerobot.com) or [Cron-Job.org](https://cron-job.org) to keep yours awake:

- Point it at your ping endpoint:
  ```text
  https://<your-service-name>/ping
  ```
- Check interval: **every 5 to 10 minutes**, depending on your provider's inactivity threshold. Render, for example, sleeps free web services after 15 minutes with no traffic.

---

## WebDAV streaming

Telegram Music includes a WebDAV server alongside the BitChord addon manifest. WebDAV streams tracks faster than the addon because it plays files directly without requesting the manifest or running search handshakes:

- Works in BitChord (WebDAV source), Symfonium, VLC, Infuse, and Foobar2000.
- Can be mounted as a network drive in Windows, macOS, or Linux file managers.
- Supports HTTP 206 byte-range requests, seeking, and RAM pre-caching.

### Authentication and credentials

- **When using the secret URL (`https://<host>/<secret>/dav`):** No username or password is required. The secret is authenticated directly from the URL path.
- **When an app prompts for Username and Password (`https://<host>/dav`):**
  - **Username:** `admin` (or any text)
  - **Password:** your `URL_SECRET` value from `.env`
  - If `URL_SECRET` is left blank in your configuration, authentication is disabled and the server accepts anonymous connections.

---

## Channel commands and music search

> [!IMPORTANT]
> **Bot Token Required:** `/s` and `/song` only work when `TELEGRAM_BOT_TOKEN` is set. Without it, these commands do nothing. Configure it in Step 3 of the setup wizard or in `.env` (get one from [@BotFather](https://t.me/BotFather)). The bot posts the button menu; your personal account (MTProto) uploads the downloaded file. Both are needed.

### Song search and downloads

Send `/s` or `/song` in your channel to search and download lossless FLAC files:

- **Interactive search:** `/song <query>` (example: `/song judas`) fetches Deezer results via your bot:
  ```text
  YourBot
  🎧 Search Results for: "judas" [Deezer FLAC]

  1. Lady Gaga - Judas (4:09)
  2. Depeche Mode - Judas (5:14)
  3. Fozzy - Judas (4:09)
  4. Preaching Soul - Judas (Slowed & Reverb) (5:10)
  5. Judas Priest - Breaking the Law (2:33)
  6. Mc Romeu - Judas (4:40)
  7. Josiah Queen - judas (3:31)

  [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ] [ 6 ] [ 7 ]
  [ ❌ ] [ ➡️ ]
  ```
  - Tap `[ 1 ]` through `[ 7 ]` to download the track directly into your channel.
  - Tap `➡️` to load the next page of results without sending new messages.
  - Send `/s <url>` to paste a Spotify, Deezer, Tidal, or Qobuz track link directly.

### Keeping duplicate songs

To keep two versions of the same track (such as a 16-bit FLAC alongside a 24-bit master):

- Add `/keep` to the file caption when uploading.
- When a new file matches an existing track, the server waits **6 hours** before deleting the older copy. Reply to it with `/keep` within that window to save both.
- When `TELEGRAM_BOT_TOKEN` is set, duplicate warnings and digests are posted by your bot, not your personal account.

### User chatter auto-cleaner

The channel listener deletes text messages, images, stickers, and spam from regular members. Audio files, bot menus, admin announcements, system alerts, and slash commands are left alone.

---

## How it works

1. You upload audio (FLAC, ALAC, WAV, MP3, M4A, or Dolby Atmos M4A/EAC3) to your private channel.
2. The server connects to Telegram via MTProto (GramJS) using your user session.
3. It reads file headers, pulls audio metadata, and builds an in-memory search index.
4. BitChord calls `/manifest.json`, `/search?q=...`, and `/stream/:id`.
5. ExoPlayer streams audio from `/audio/:id` via HTTP 206 range requests.

### Playback resolution flow

1. BitChord starts on YouTube Music immediately to prevent buffering pauses.
2. Simultaneously, it queries your Telegram addon and JioSaavn.
3. Priority order:
   - Track found in your Telegram channel: BitChord switches to your **Telegram FLAC / Dolby stream**.
   - Not in Telegram: upgrades to **JioSaavn (320 kbps)**.
   - Not on either: stays on **YouTube Music (160 kbps)**.

---

## API Endpoints

When `URL_SECRET` is set, all routes except `/ping` and `/icon.png` require the secret prefix (for example `/:secret/manifest.json`).

- `GET /manifest.json`: Addon manifest and capabilities.
- `GET /install`: Mobile install page. Auto-copies the addon URL to clipboard on load, including when opened via QR code scan.
- `GET /setup`: Web onboarding wizard.
- `GET /search?q=:query&atmos=auto`: In-memory track search with Atmos preference.
- `GET /isrc/:code`: Exact track match by ISRC (BitChord).
- `GET /resolve-isrc?isrc=:code`: Exact track match by ISRC (Eclipse Music).
- `GET /stream/:id`: Stream descriptors (FLAC or E-AC-3 JOC M4A) and media URL.
- `GET /audio/:id`: HTTP 206 range-enabled audio streaming.
- `GET /artwork/:id`: Album art.
- `OPTIONS /dav`, `PROPFIND /dav`, `GET /dav/:filename`: WebDAV directory listing and direct audio streaming.
- `GET /icon.png`: Addon icon for BitChord source listings (public, no secret required).
- `GET /notifications/status`: Deduplication state and notification settings.
- `GET /notifications/flush`: Triggers an immediate cleanup digest.
- `GET /debug/requests`: Last 50 incoming requests.
- `GET /debug/faststart`: Preamble cache statistics.
- `GET /ping`: Public health check for uptime monitors.

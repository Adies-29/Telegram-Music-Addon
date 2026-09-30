# Telegram Music Server Setup

Stream lossless and hi-res audio from a private Telegram channel into the BitChord Android app. If a track is not in your channel, BitChord falls back to YouTube Music or JioSaavn.

## Architecture

```
┌─────────────────────────────────┐
│     Telegram Private Channel    │ (Audio storage)
└────────────────┬────────────────┘
                 │ MTProto
┌────────────────▼────────────────┐
│   Telegram Music Addon Server   │ (Node.js, GramJS, Express)
│   - /manifest.json              │
│   - /search?q=...               │
│   - /stream/:id                 │
│   - /artwork/:id                │
│   - /audio/:id (HTTP 206 range) │
└────────────────┬────────────────┘
                 │ HTTPS
┌────────────────▼────────────────┐
│      BitChord Android App       │ (Settings → Sources → Add Source)
└─────────────────────────────────┘
```

## Security

* **User session over Bot API:** Bots are capped at 20MB per file, while FLAC files are typically 25MB to 100MB+. Logging in as a user MTProto session removes that limit.
* **Account choice:** For personal daily listening, your main Telegram account works great and carries zero risk since you're just streaming one song at a time. If you plan to test heavy automated downloaders or share the server with friends, using a secondary account is a good habit.
* **Revoking access:** You can end the session anytime from your phone in Telegram Settings > Devices.

## 1. Get Telegram API credentials

1. Log in to [my.telegram.org](https://my.telegram.org) with your phone number.
2. Click **API development tools**.
3. Create an app (any title and short name work).
4. Save your `api_id` and `api_hash`.

## 2. Authenticate and create a session string

Run the login helper:

```bash
npm run login
```

Follow the prompts to enter:
1. `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` (if not already in `.env`)
2. Your phone number with country code (e.g. `+1234567890` or `+919876543210`)
3. The login code sent to your Telegram app
4. Your two-step password, if you have one enabled
5. Your channel username or ID

The script writes your credentials to `.env`.

## 3. Set up your Telegram channel
 
1. Create a channel in Telegram and select **Private Channel** (do NOT create a public channel with a `@handle`).
   * **Why Private:** Public channels are indexed by web search engines and scanned by automated record label copyright bots (IFPI, Sony, T-Series), which can lead to copyright infringement takedowns and channel bans. Private channels are not indexed and remain secure for personal cloud storage.
2. Get the numeric channel ID:
   * Forward any message from your private channel to `@userinfobot` or `@getidsbot` to retrieve the numeric ID (starts with `-100...`, e.g. `-1001234567890`).
3. Upload audio files:
   * Always upload audio as files or documents rather than compressed audio. Telegram compresses standard music uploads, which removes FLAC tags and degrades quality.
   * To keep multiple versions of the same song, add `/keep` in the caption, or reply to the uploaded file with `/keep` within the 6-hour grace window.
   * The server indexes new files as soon as they reach the channel.

## 3.1 (Optional) Add a bot for clean channel notifications

Setting a dedicated bot token allows duplicate notices and digest summaries to be sent by a bot instead of your personal user account:

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Type `/newbot` and follow the prompts to choose a name and username (for example, `MyMusicBot`).
3. Copy the HTTP API token BotFather gives you.
4. Add the token to `.env`:
   ```env
   TELEGRAM_BOT_TOKEN="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
   ```
5. Open your channel settings, go to **Administrators** > **Add Administrator**, search for your bot username, and grant **Post Messages** and **Delete Messages** permissions.

## 4. Run locally

```bash
npm start
```

Startup output looks like this:
```text
================================================================================
  Telegram Music Addon server running on: http://0.0.0.0:3000
  Local Manifest URL: http://localhost:3000/yoursecret123/manifest.json
  [Security] URL_SECRET protection active: unauthorized public requests will be blocked.

04:43:33 |  CACHE   | Loaded 1708 tracks from primary compressed cache
04:43:33 | TELEGRAM | Connected to MTProto session
04:43:33 | CHANNEL  | Connected to Telegram Channel (ID: 1001234567890)
04:43:40 | LIBRARY  | Indexing complete: 1708 tracks loaded • Deduplication 100% clean
```

Test it in your browser:
* `http://localhost:3000/yoursecret123/manifest.json`
* `http://localhost:3000/yoursecret123/search?q=test`

## 5. Expose over HTTPS

ExoPlayer on Android requires HTTPS.

### Environment variables for cloud hosting

You can deploy the addon to any cloud provider or hosting platform (such as Render, Fly.io, Docker, or a Linux VPS). Configure these variables in your provider's dashboard:

| Variable | Required? | Description & Dummy Example |
| :--- | :--- | :--- |
| `TELEGRAM_API_ID` | **Yes** | Telegram API ID (e.g. `1234567`) |
| `TELEGRAM_API_HASH` | **Yes** | Telegram API Hash (e.g. `abcdef0123456789`) |
| `TELEGRAM_SESSION_STRING` | **Yes** | GramJS user session string from `npm run login` |
| `TELEGRAM_CHANNEL` | **Yes** | Private channel ID or handle (e.g. `-1001234567890`) |
| `URL_SECRET` | Default | Secret path protection token (e.g. `yoursecret123`, auto-generated if omitted) |
| `TELEGRAM_BOT_TOKEN` | Optional | Bot Token from BotFather for duplicate alerts & cleaner |
| `PORT` | Optional | Server port (default `3000`) |

### Option A: Cloud Web Service (Render, Fly.io, or VPS - Easiest)

Connect your GitHub repository to a Web Service on Render, Fly.io, Docker, or your Linux VPS. Add the environment variables above in your cloud dashboard.

### Option B: Fly.io or Docker Container

1. Install `flyctl` or use your Docker container workflow.
2. Create the app:
   ```bash
   fly launch --name my-telegram-music --no-deploy
   ```
3. Set your secrets:
   ```bash
   fly secrets set TELEGRAM_API_ID="your_api_id"
   fly secrets set TELEGRAM_API_HASH="your_api_hash"
   fly secrets set TELEGRAM_SESSION_STRING="your_session_string"
   fly secrets set TELEGRAM_CHANNEL="@your_channel_or_id"
   fly secrets set URL_SECRET="yoursecret123"
   ```
4. Deploy:
   ```bash
   fly deploy
   ```

### Option C: Cloudflare Tunnel (Local Deployment)

1. Install `cloudflared`.
2. Start the tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Use the generated `https://...trycloudflare.com` URL in BitChord.

## 6. Connect BitChord

1. Open **BitChord** on your phone.
2. Go to **Settings** > **Sources**.
3. Tap **Add an addon** under Pluggable Sources.
4. Paste your Addon manifest URL including your secret path (e.g. `https://my-telegram-music.onrender.com/yoursecret123/manifest.json`).
5. BitChord verifies `/manifest.json` and adds the source. When you play a track, BitChord looks for a match in your Telegram channel first.

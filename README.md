# Streamer Multichat

A Windows desktop application (Electron + React + TypeScript) that merges live chat from
**Twitch, Kick, YouTube and TikTok** into a single window and provides a separate,
read-only **OBS Studio browser-source overlay**. Everything runs locally on your machine -
no hosted backend, no subscription.

> The application user interface is currently in Polish.

## Contents

- [Supported platforms](#supported-platforms)
- [Features](#features)
- [Requirements](#requirements)
- [Development](#development)
- [Building for Windows](#building-for-windows)
- [Configuration](#configuration)
- [Platform limitations](#platform-limitations)
- [Security model](#security-model)
- [License](#license)
- [Commercial licensing](#commercial-licensing)
- [Third-party notices](#third-party-notices)

## Supported platforms

| Platform | Read chat without login | Optional login / credentials |
|---|---|---|
| Twitch | Yes - anonymous IRC | Twitch app Client ID (Device Code Flow) for badge images and EventSub events of your own channel |
| Kick | Yes - public chat stream | Kick app Client ID/Secret + public HTTPS webhook (Cloudflare Tunnel) for the authorized webhook integration |
| YouTube | Needs a YouTube Data API v3 key **or** Google OAuth | Google API key or OAuth "Desktop app" client |
| TikTok | Yes - by `@username` | Optional Euler Stream API key for the signing service |

## Features

- Unified, live chat window for all four platforms with platform icons and colors.
- **OBS overlay** served on `http://127.0.0.1:<port>/` (default `47311`), updated live over WebSocket.
- Watch any number of additional public Twitch/Kick channels at once ("Channels" section).
- Twitch: real nickname colors, `/me` messages, native emotes, **7TV** and **BTTV** emotes
  (including zero-width), public sub/resub/gift/raid/bits notices; EventSub events
  (Channel Points, subs, raids, cheers, follows, Hype Train) for the logged-in channel owner.
- Optional Twitch JOIN/PART notifications (in chat or in a side activity panel).
- YouTube Super Chats, Super Stickers and memberships; TikTok gifts and subscriptions as events.
- Official badge images where the platform provides them.
- Per-platform ignore lists (matched by stable user ID when available).
- Nickname highlighting, optional timestamps, per-platform message backgrounds, subtle new-message pulse.
- Low-resource mode for streaming alongside games.
- Demo mode that generates labelled sample messages without any network connections (toggle in
  the chat toolbar or in Settings -> General).
- Portable single-file `.exe` - settings survive replacing the executable.

## Requirements

**Running a built executable**

- Windows 11 x64
- Optional: [`cloudflared`](https://github.com/cloudflare/cloudflared/releases) - only for the
  authorized Kick webhook integration

**Building from source**

- Node.js 20 or newer (22 LTS recommended) and npm

## Development

```bash
npm install
npm run dev         # development mode with hot reload
npm run typecheck   # TypeScript checks (main/preload + renderer)
npm test            # unit tests (Vitest)
npm run build       # typecheck + production build into out/
```

The Electron binary is not downloaded by `npm install`; it is fetched automatically the first
time `npm run dev` starts Electron (or manually with `npx install-electron --no`). If your npm
configuration blocks dependency install scripts, allow the script for `esbuild`
(e.g. `npm approve-scripts esbuild`) and reinstall.

## Building for Windows

```bash
npm run build:win
```

Runs the typecheck, compiles main/preload/renderer with electron-vite into `out/`, and packages a
portable executable with electron-builder:

```
release/Streamer Multichat-<version>-portable.exe
```

The executable is **not code-signed**; Windows SmartScreen may show a warning on first launch
("More info" -> "Run anyway"). No installer and no auto-update mechanism are produced.

## Configuration

All configuration is done in the in-app settings wizard (shown on first launch, later via the ⚙
button). No credentials are read from environment variables - see [`.env.example`](.env.example).

**Where data is stored.** Settings, channel lists, ignore lists and encrypted credentials are kept
in the Electron user-data directory, independent of where the executable is located:

```
%APPDATA%\streamer-multichat\
  config.json    # settings (no secrets)
  secrets.json   # tokens / client secrets / API keys, encrypted with Windows DPAPI (safeStorage)
  logs\diagnostics.log   # renderer / helper process crash events (no messages or credentials)
```

### Twitch

1. Create an application at <https://dev.twitch.tv/console/apps>. Redirect URL can be
   `http://localhost` (not used by Device Code Flow). Client type **Public** is recommended.
2. In the app: Settings -> Twitch -> enter the channel name and paste the **Client ID**.
3. Click **Log in** and confirm the code in the browser (only needed for badge images and EventSub).
4. If you use a *Confidential* Twitch application, also enter its Client Secret - otherwise token
   refresh fails after ~4 hours.

Requested scopes: `channel:read:redemptions`, `channel:read:subscriptions`, `bits:read`,
`moderator:read:followers`, `channel:read:hype_train`.

### Kick

- **Public chat:** Settings -> Kick -> enter the channel -> **Connect**. No account needed.
- **Authorized webhook (optional, advanced):** create an application in the Kick developer
  settings (2FA required), set the redirect URI to the one shown in the app (default
  `http://127.0.0.1:47320/callback`), enable the `chat.message.sent` webhook, then paste the
  Client ID and Client Secret in the app, start the Cloudflare tunnel, register the shown webhook
  URL in the Kick panel and log in. Quick-tunnel URLs change on every start.

### YouTube

1. In Google Cloud Console create a project and enable **YouTube Data API v3**.
2. Create an **API key** (restrict it to YouTube Data API v3).
3. In the app: Settings -> YouTube -> paste the key and enter a channel URL, `@handle`, channel ID
   (`UC...`) or live/video URL -> **Connect**.

Optional: Google OAuth with a "Desktop app" client (`youtube.readonly`). OAuth consent screens in
"Testing" mode expire sessions after 7 days.

### TikTok

Settings -> TikTok -> enter `@username` or a `tiktok.com/@username` URL -> **Connect**. Optionally
add your own Euler Stream API key if the shared signing service is rate-limited.

### OBS overlay

Add a **Browser Source** in OBS with URL `http://127.0.0.1:47311/` (or your configured port).
Appearance is configured in the app under "OBS overlay" and applied live.

## Platform limitations

- **TikTok** integration relies on the unofficial
  [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector) library and the
  third-party Euler Stream signing service; protocol changes on TikTok's side can break it.
  Connection requests are sent through that third-party service. The library is pinned to the last
  MIT-licensed release (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- **Kick** public chat uses the same unofficial real-time stream the Kick website uses. Channel
  lookup may be blocked by Kick's Cloudflare protection on some networks; each watched Kick channel
  accepts a manual chat-room ID as a fallback.
- **YouTube** reads are limited by the Data API quota (10,000 units/day per project by default).
- **Twitch JOIN/PART** events are incomplete on large channels (a Twitch IRC limitation), and
  reflect chat-room membership, not video viewers. Channel Points and follows are only available
  for the logged-in channel owner.
- Badge images are shown only where the platform provides official images.

## Security model

- Renderer runs with `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false`; the
  preload exposes only a fixed set of IPC calls. Chat content is rendered through React only (no
  `innerHTML`).
- The main window cannot navigate away from the bundled UI; other links open in the system browser.
- Tokens, client secrets and API keys are entered by the user at runtime and stored encrypted with
  Electron `safeStorage` (Windows DPAPI). **No credentials are embedded in the source code or the
  built executable.**
- The OBS overlay server, OAuth callback listener and Kick webhook server listen on `127.0.0.1` only.
- Kick webhook requests are verified with RSA-SHA256 against Kick's public key before processing.
- OAuth flows use PKCE/state validation (loopback) or Device Code Flow.
- Only `https:` links are opened in the system browser; other schemes (`file:`, `javascript:`,
  custom protocols and so on) are ignored.

## License

Copyright (c) 2026 Streamer.

The source code of Streamer Multichat is licensed under the
**[PolyForm Noncommercial License 1.0.0](LICENSE)**. You may use, modify and share it for
**noncommercial purposes** as defined in that license. See also [`NOTICE`](NOTICE).

## Commercial licensing

Any **commercial use** requires a separate written commercial license from the project owner.
See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Third-party notices

This project depends on third-party open-source software (Electron, React and npm packages) that
is licensed under its own terms, and refers to third-party services and trademarks (Twitch, Kick,
YouTube, TikTok, 7TV, BTTV). The PolyForm license above applies only to this project's own code.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Streamer Multichat is an independent project and is not affiliated with, endorsed by or sponsored by
Twitch, Kick, Google/YouTube, TikTok, 7TV or BetterTTV.

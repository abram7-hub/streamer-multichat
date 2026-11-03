# Changelog

## v1.1.0

- Redesigned Settings with separate pages for platforms, chat appearance, animations, events,
  mentions, filters, OBS Overlay, Gaming Overlay and performance.
- Customizable chat appearance: font, emote, badge and icon sizes, spacing, corner radius,
  message backgrounds, per-platform colors and four chat layouts.
- Message entry animations and new-message effects with adjustable intensity and duration.
- Separate Main / OBS / Gaming appearance overrides on top of shared settings.
- Gaming Overlay: a transparent, always-on-top, click-through chat window for games in windowed
  or borderless mode, with Edit Mode, a global hotkey, message lifetime and filters.
- Mentions: your nicknames and custom phrases are highlighted in the chat and overlays, with an
  optional sound, volume and cooldown, and a "mentions only" filter for the Gaming Overlay.
- Improved autoscroll: a "new messages" counter, jump to latest and optional pause on hover.
- Pinned messages.
- Appearance presets.
- Import and export of visual settings to a JSON file (no channels, credentials or local paths).
- Updated Electron from 33 to 44 and electron-builder from 25 to 26. Existing settings and
  encrypted credentials from v1.0.x are read without changes.
- The renderer now runs sandboxed (`sandbox: true`); the preload is built as CommonJS.
- The main window no longer navigates to external pages.
- Settings and secret values received over IPC are validated in the main process.
- Added a diagnostics log (`logs/diagnostics.log` in the user data directory) for renderer and
  helper process crashes. It contains event types, reasons and exit codes only.
- Removed the unused `electron-updater` dependency.
- The portable executable unpacks into a separate temporary directory on every launch, so
  starting it twice in quick succession no longer removes files from under the running instance.

## v1.0.1

- Pinned the TikTok integration to MIT licensed dependencies: `tiktok-live-connector` 2.4.0 and
  `tiktok-live-proto` 0.2.3. TikTok features are unchanged.
- Hardened external URL handling: only `https:` URLs are opened in the system browser.
- Fixed Demo Mode shutdown and cleanup: turning Demo Mode off stops the sample message generator
  immediately, and changing other settings while it is on no longer starts extra generators.
- Added a quick Demo Mode control to the chat toolbar. It shares its state with the option in
  Settings.
- Expanded tests (TikTok library contract, URL validation, Demo Mode).
- Updated third-party notices.

## v1.0.0

First release.

- Combined live chat from Twitch, Kick, YouTube and TikTok in one window.
- OBS browser-source overlay on `http://127.0.0.1:<port>/` with live updates over WebSocket.
- Watching multiple public Twitch and Kick channels without logging in.
- Twitch: anonymous IRC chat with real nickname colors, `/me` messages, native, 7TV and BTTV
  emotes, public sub/raid/bits notices, optional JOIN/PART notifications, EventSub events for
  the logged-in channel owner (Device Code Flow).
- Kick: public chat stream, official badge images, optional authorized webhook with signature
  verification and Cloudflare quick tunnel.
- YouTube: live chat via Data API key or Google OAuth, Super Chats, Super Stickers and memberships.
- TikTok: live chat by username, badges, gifts and subscriptions.
- Per-platform ignore lists, nickname highlighting, timestamps, message backgrounds and new
  message pulse.
- Low-resource mode for streaming alongside games.
- Demo mode with generated sample messages.
- Credentials stored encrypted with Windows DPAPI in the user data directory.
- Portable Windows x64 executable.

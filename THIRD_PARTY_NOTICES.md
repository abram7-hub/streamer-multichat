# Third-Party Notices

The PolyForm Noncommercial License 1.0.0 in [LICENSE](LICENSE) applies only to the original
source code of Streamer Multichat. Third-party software, services, names and trademarks referenced
or used by this project remain under their own licenses and belong to their respective owners.
Nothing in this repository relicenses them.

The full license texts of npm dependencies are included in each package's directory under
`node_modules/` after installation, and are packaged together with the application by
electron-builder.

## Direct runtime dependencies

| Package | License | Project |
|---|---|---|
| electron (runtime, includes Chromium and Node.js) | MIT (bundles components under their own licenses, see `LICENSES.chromium.html` in the packaged app) | https://github.com/electron/electron |
| @electron-toolkit/preload | MIT | https://github.com/alex8088/electron-toolkit |
| @electron-toolkit/utils | MIT | https://github.com/alex8088/electron-toolkit |
| electron-store | MIT | https://github.com/sindresorhus/electron-store |
| express | MIT | https://github.com/expressjs/express |
| google-auth-library | Apache-2.0 | https://github.com/googleapis/google-auth-library-nodejs |
| tiktok-live-connector 2.4.0 (exact version, see below) | MIT | https://github.com/zerodytrash/TikTok-Live-Connector |
| ws | MIT | https://github.com/websockets/ws |
| zustand | MIT | https://github.com/pmndrs/zustand |
| react | MIT | https://github.com/facebook/react |
| react-dom | MIT | https://github.com/facebook/react |

`react` and `react-dom` are bundled into the renderer build.

## Transitive runtime dependencies (summary)

All production dependencies are under permissive licenses (MIT, ISC, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, 0BSD, BlueOak-1.0.0, Python-2.0, MIT OR CC0-1.0). No package in the production
dependency tree is licensed under the AGPL, GPL, LGPL, SSPL, BUSL, Commons Clause or a
noncommercial license.

Packages used by the TikTok integration:

| Package | Version | License | Project |
|---|---|---|---|
| tiktok-live-connector | 2.4.0 | MIT | https://github.com/zerodytrash/TikTok-Live-Connector |
| tiktok-live-proto | 0.2.3 | MIT | https://github.com/isaackogan/TikTok-Webcast-Protobuf |
| tiktok-live-api-sdk | 0.4.0-beta1 | MIT | https://github.com/EulerStream/Euler-Api-Sdk |
| @bufbuild/protobuf | 2.x | Apache-2.0 AND BSD-3-Clause | https://github.com/bufbuild/protobuf-es |

Apache-2.0 components may include `NOTICE` files that must be preserved when redistributing.

## TikTok integration - pinned versions

`tiktok-live-connector` is pinned to exactly `2.4.0`, which (together with `tiktok-live-proto`
`0.2.3`) is the last release published under the MIT License. Later releases (`2.4.1` and newer,
`tiktok-live-proto` `0.2.4` and newer) are distributed under the GNU Affero General Public License
v3.0 with additional terms. Do not update these packages without reviewing the license of the new
version. A unit test (`electron/main/adapters/tiktok/library-contract.test.ts`) fails if the
installed version or license changes.

The npm packages of `tiktok-live-proto` 0.2.3 and `tiktok-live-api-sdk` 0.4.0-beta1 do not contain
a license file. Their license texts, as published in the upstream repositories, are reproduced
below.

### tiktok-live-proto 0.2.3

```
MIT License

Copyright (c) 2026 Isaac Kogan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### tiktok-live-api-sdk 0.4.0-beta1

```
MIT License

Copyright (c) 2025 EulerStream

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development-only dependencies

Build and test tooling (TypeScript, Vite, electron-vite, electron-builder, Vitest, type
definitions) is used only during development and is not shipped as part of the application.

## Services, trademarks and assets

- **Twitch**, **Kick**, **YouTube** and **TikTok** names and logos are trademarks of their
  respective owners (Twitch Interactive, Inc.; Kick Streaming Pty Ltd; Google LLC; ByteDance Ltd.
  / TikTok). The small platform glyphs in `src/renderer/components/PlatformIcon.tsx` are used only
  to identify the source platform of a message.
- **7TV** and **BetterTTV (BTTV)** emotes, as well as platform badges and emotes, are loaded at
  runtime from the respective services' CDNs and are not included in this repository. Emote and
  badge images remain the property of their creators and the respective services.
- Use of the Twitch, Kick, YouTube Data, TikTok and Euler Stream APIs/services is subject to each
  provider's own terms of service.
- **Cloudflare Tunnel (`cloudflared`)** is an optional external tool, not bundled with the app.

This project is not affiliated with, endorsed by or sponsored by any of the companies or services
listed above.

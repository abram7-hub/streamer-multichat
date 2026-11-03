/** Co użytkownik wpisał w polu YouTube - rozpoznane automatycznie. */
export type YouTubeTarget =
  | { kind: 'video'; videoId: string }
  | { kind: 'channel'; channelId: string }
  | { kind: 'handle'; handle: string }
  | { kind: 'username'; username: string }

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const HANDLE = /^@?([A-Za-z0-9._-]{3,30})$/

/**
 * Rozpoznaje: URL kanału (`/channel/UC...`, `/@handle`, `/c/...`, `/user/...`), sam `@handle`, ID kanału
 * (`UC...`), URL transmisji/filmu (`watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`) oraz samo
 * 11-znakowe ID filmu. Zwraca `undefined` dla niepoprawnych danych.
 */
export function parseYouTubeInput(raw: string): YouTubeTarget | undefined {
  const input = raw.trim()
  if (!input) return undefined
  if (CHANNEL_ID.test(input)) return { kind: 'channel', channelId: input }

  const looksLikeUrl = /^(https?:\/\/)?([a-z0-9-]+\.)*(youtube\.com|youtu\.be)(\/|$)/i.test(input)
  if (looksLikeUrl) {
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
    } catch {
      return undefined
    }
    const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p))
    if (url.hostname.toLowerCase().endsWith('youtu.be')) {
      return parts[0] && VIDEO_ID.test(parts[0]) ? { kind: 'video', videoId: parts[0] } : undefined
    }
    const v = url.searchParams.get('v')
    if (v && VIDEO_ID.test(v)) return { kind: 'video', videoId: v }
    const [first, second] = parts
    if (!first) return undefined
    if (['live', 'shorts', 'embed', 'v'].includes(first) && second && VIDEO_ID.test(second)) {
      return { kind: 'video', videoId: second }
    }
    if (first === 'channel' && second && CHANNEL_ID.test(second)) return { kind: 'channel', channelId: second }
    if (first === 'user' && second) return { kind: 'username', username: second }
    if (first === 'c' && second) return { kind: 'handle', handle: second.toLowerCase() }
    if (first.startsWith('@')) {
      const m = HANDLE.exec(first)
      return m?.[1] ? { kind: 'handle', handle: m[1].toLowerCase() } : undefined
    }
    return undefined
  }

  if (input.startsWith('@')) {
    const m = HANDLE.exec(input)
    return m?.[1] ? { kind: 'handle', handle: m[1].toLowerCase() } : undefined
  }
  // Samo ID filmu: dokładnie 11 znaków i (jak praktycznie każde ID YouTube) wielkie litery - handle
  // wpisywane są zwykle małymi literami, a przy wątpliwości bezpieczniej założyć @handle.
  if (VIDEO_ID.test(input) && /[A-Z]/.test(input)) return { kind: 'video', videoId: input }
  const m = HANDLE.exec(input)
  return m?.[1] ? { kind: 'handle', handle: m[1].toLowerCase() } : undefined
}

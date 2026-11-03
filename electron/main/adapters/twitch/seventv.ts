import { isAllowedEmoteUrl } from '../../../../shared/emote-url'
import { applyThirdPartyEmotes, type ThirdPartyEmote } from './emote-apply'
import { fetchJson } from './emote-http'

export const SEVENTV_API = 'https://7tv.io/v3'
/** Bit 8 w `EmoteData.flags` (EmoteFlagsZeroWidth) - właściwość samej emotki. */
const EMOTE_DATA_ZERO_WIDTH = 1 << 8
/** Bit 0 w `ActiveEmote.flags` (ActiveEmoteFlagZeroWidth) - ustawienie emotki w danym zestawie. */
const ACTIVE_EMOTE_ZERO_WIDTH = 1 << 0

/** Zachowane dla zgodności wstecznej (testy, wcześniejsze importy). */
export type SevenTvEmote = ThirdPartyEmote
export const applySevenTvEmotes = applyThirdPartyEmotes

interface SevenTvFile {
  name?: unknown
  static_name?: unknown
  width?: unknown
  height?: unknown
  format?: unknown
}
interface SevenTvEmoteEntry {
  name?: unknown
  flags?: unknown
  data?: {
    flags?: unknown
    animated?: unknown
    host?: { url?: unknown; files?: unknown }
  }
}

function toEmote(entry: SevenTvEmoteEntry): ThirdPartyEmote | undefined {
  if (typeof entry.name !== 'string' || entry.name.length === 0 || /\s/.test(entry.name)) return undefined
  const host = entry.data?.host
  if (typeof host?.url !== 'string' || !Array.isArray(host.files)) return undefined
  const files = host.files as SevenTvFile[]
  // 2x WEBP (64 px wysokości) - wyświetlamy ~24-32 px, więc 2x jest ostre także na ekranach HiDPI,
  // a dekodowana klatka zajmuje 4x mniej pamięci niż 4x (ważne przy animowanych emotkach).
  const file =
    files.find((f) => f.name === '2x.webp') ?? files.find((f) => f.format === 'WEBP') ?? files[0]
  if (!file || typeof file.name !== 'string') return undefined
  const base = host.url.startsWith('//') ? `https:${host.url}` : host.url
  const url = `${base}/${file.name}`
  if (!isAllowedEmoteUrl(url, '7tv')) return undefined
  const staticName = entry.data?.animated === true && typeof file.static_name === 'string' ? file.static_name : undefined
  const staticUrl = staticName ? `${base}/${staticName}` : undefined
  const dataFlags = typeof entry.data?.flags === 'number' ? entry.data.flags : 0
  const activeFlags = typeof entry.flags === 'number' ? entry.flags : 0
  const width = typeof file.width === 'number' ? file.width : 0
  const height = typeof file.height === 'number' ? file.height : 0
  return {
    name: entry.name,
    url,
    staticUrl: staticUrl && isAllowedEmoteUrl(staticUrl, '7tv') ? staticUrl : undefined,
    isZeroWidth: (dataFlags & EMOTE_DATA_ZERO_WIDTH) !== 0 || (activeFlags & ACTIVE_EMOTE_ZERO_WIDTH) !== 0,
    provider: '7tv',
    ratio: width > 0 && height > 0 ? Math.round((width / height) * 1000) / 1000 : undefined
  }
}

/** Czysta funkcja: parsuje odpowiedź `/emote-sets/{id}` (lub `emote_set` z `/users/twitch/{id}`). */
export function parseSevenTvEmoteSet(json: unknown): ThirdPartyEmote[] {
  const emotes = (json as { emotes?: unknown } | null)?.emotes
  if (!Array.isArray(emotes)) return []
  const out: ThirdPartyEmote[] = []
  for (const entry of emotes) {
    if (!entry || typeof entry !== 'object') continue
    const e = toEmote(entry as SevenTvEmoteEntry)
    if (e) out.push(e)
  }
  return out
}

export async function fetchSevenTvGlobal(): Promise<ThirdPartyEmote[]> {
  const json = await fetchJson(`${SEVENTV_API}/emote-sets/global`)
  if (json === undefined) throw new Error('7TV: nie udało się pobrać globalnych emotek')
  return parseSevenTvEmoteSet(json)
}

/**
 * Emotki kanałowe 7TV po numerycznym ID kanału Twitcha. 404 = kanał nie ma konta 7TV - to NIE jest
 * błąd (zwraca pustą listę). Inne błędy są rzucane, żeby rejestr mógł ponowić próbę później.
 */
export async function fetchSevenTvChannel(twitchUserId: string): Promise<ThirdPartyEmote[]> {
  const json = await fetchJson(`${SEVENTV_API}/users/twitch/${encodeURIComponent(twitchUserId)}`, { notFoundOk: true })
  if (json === undefined) throw new Error('7TV: nie udało się pobrać emotek kanału')
  if (json === null) return []
  return parseSevenTvEmoteSet((json as { emote_set?: unknown }).emote_set)
}

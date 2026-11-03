import { isAllowedEmoteUrl } from '../../../../shared/emote-url'
import type { ThirdPartyEmote } from './emote-apply'
import { fetchJson } from './emote-http'

export const BTTV_API = 'https://api.betterttv.net/3'
const BTTV_CDN = 'https://cdn.betterttv.net/emote'
/** ID BTTV to 24-znakowe heksadecymalne ObjectId - walidujemy przed złożeniem URL-a. */
const BTTV_ID = /^[a-f0-9]{24}$/i

interface BttvEmoteEntry {
  id?: unknown
  code?: unknown
  animated?: unknown
  width?: unknown
  height?: unknown
}

function toEmote(entry: BttvEmoteEntry): ThirdPartyEmote | undefined {
  if (typeof entry.id !== 'string' || !BTTV_ID.test(entry.id)) return undefined
  if (typeof entry.code !== 'string' || entry.code.length === 0 || /\s/.test(entry.code)) return undefined
  // `/2x.webp` - BTTV serwuje WEBP (animowany dla emotek animowanych), statyczną klatkę pod `/static/`.
  const url = `${BTTV_CDN}/${entry.id}/2x.webp`
  if (!isAllowedEmoteUrl(url, 'bttv')) return undefined
  const width = typeof entry.width === 'number' ? entry.width : 0
  const height = typeof entry.height === 'number' ? entry.height : 0
  return {
    name: entry.code,
    url,
    staticUrl: entry.animated === true ? `${BTTV_CDN}/${entry.id}/static/2x.webp` : undefined,
    // BTTV nie ma w API ogólnej flagi zero-width (pole `modifier` dotyczy modyfikatorów tekstowych
    // typu "w!"/"h!", a nie nakładek) - nie zgadujemy, emotki BTTV renderujemy zawsze jako osobne.
    isZeroWidth: false,
    provider: 'bttv',
    ratio: width > 0 && height > 0 ? Math.round((width / height) * 1000) / 1000 : undefined
  }
}

function parseList(list: unknown): ThirdPartyEmote[] {
  if (!Array.isArray(list)) return []
  const out: ThirdPartyEmote[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const e = toEmote(entry as BttvEmoteEntry)
    if (e) out.push(e)
  }
  return out
}

/** Czysta funkcja: `/cached/emotes/global` zwraca tablicę emotek. */
export function parseBttvGlobal(json: unknown): ThirdPartyEmote[] {
  return parseList(json)
}

/** Czysta funkcja: `/cached/users/twitch/{id}` zwraca `{ channelEmotes, sharedEmotes }`. Przy kolizji
 *  wewnątrz kanału wygrywają `channelEmotes` (własne emotki streamera). */
export function parseBttvChannel(json: unknown): ThirdPartyEmote[] {
  const obj = (json ?? {}) as { channelEmotes?: unknown; sharedEmotes?: unknown }
  return [...parseList(obj.sharedEmotes), ...parseList(obj.channelEmotes)]
}

export async function fetchBttvGlobal(): Promise<ThirdPartyEmote[]> {
  const json = await fetchJson(`${BTTV_API}/cached/emotes/global`)
  if (json === undefined) throw new Error('BTTV: nie udało się pobrać globalnych emotek')
  return parseBttvGlobal(json)
}

/** 404 = kanał nie ma konta BTTV (pusta lista, nie błąd). */
export async function fetchBttvChannel(twitchUserId: string): Promise<ThirdPartyEmote[]> {
  const json = await fetchJson(`${BTTV_API}/cached/users/twitch/${encodeURIComponent(twitchUserId)}`, { notFoundOk: true })
  if (json === undefined) throw new Error('BTTV: nie udało się pobrać emotek kanału')
  if (json === null) return []
  return parseBttvChannel(json)
}

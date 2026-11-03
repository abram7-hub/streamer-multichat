import type { EmoteProvider } from './chat-message'
import type { Platform } from './platform'

/**
 * Dozwolone hosty obrazków emotek per provider. URL-e pochodzą z zewnętrznych API (7TV/BTTV) lub
 * są składane z ID z tagów IRC - w obu przypadkach traktujemy je jako niezaufane i przepuszczamy
 * wyłącznie `https:` na spodziewany CDN danego providera.
 */
const EMOTE_HOSTS: Record<EmoteProvider, readonly string[]> = {
  twitch: ['static-cdn.jtvnw.net'],
  '7tv': ['cdn.7tv.app'],
  bttv: ['cdn.betterttv.net']
}

export function isAllowedEmoteUrl(url: string, provider: EmoteProvider): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false
  return EMOTE_HOSTS[provider].includes(parsed.hostname)
}

/**
 * Oficjalne CDN-y obrazków odznak/ikon nagród per platforma (sufiksy domen). Odznaka z innego hosta
 * nie jest renderowana - dane z czatu są niezaufane.
 */
const ASSET_HOST_SUFFIXES: Record<Platform, readonly string[]> = {
  twitch: ['static-cdn.jtvnw.net'],
  kick: ['files.kick.com', 'ext.cdn.kick.com'],
  youtube: ['yt3.ggpht.com', 'yt4.ggpht.com', 'yt3.googleusercontent.com'],
  tiktok: ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibyteimg.com']
}

export function isAllowedAssetUrl(url: string | undefined, platform: Platform): url is string {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false
  const host = parsed.hostname
  return ASSET_HOST_SUFFIXES[platform].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** Ogólna, minimalna kontrola dla obrazków/linków z innych platform (Kick, YouTube, TikTok):
 *  tylko http(s) - odrzuca `javascript:`, `data:`, `file:` itp. */
export function isSafeHttpUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

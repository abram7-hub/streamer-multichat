/**
 * Normalizuje to, co użytkownik wpisał w polu "kanał" (sekcja "Kanały") - akceptuje zarówno samą
 * nazwę/slug, jak i pełny adres URL (np. `https://www.twitch.tv/nazwa` albo `kick.com/nazwa`) -
 * do samej nazwy kanału w małych literach, bez `@`, bez protokołu/domeny/ścieżki.
 */
export function parseChannelInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.includes('/') || trimmed.includes('.')) {
    try {
      const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
      const slug = url.pathname.split('/').filter(Boolean)[0]
      if (slug) return decodeURIComponent(slug).toLowerCase()
    } catch {
      // nie jest poprawnym URL-em - traktujemy jak zwykłą nazwę poniżej
    }
  }
  return trimmed.replace(/^@/, '').toLowerCase()
}

/**
 * Slug kanału Kicka: Kick zamienia `_` z nazwy użytkownika na `-` w adresie kanału (np. użytkownik
 * `Test_Nick` ma kanał `kick.com/test-nick`; `kick.com/api/v2/channels/test_nick` zwraca 404).
 */
export function normalizeKickSlug(raw: string): string {
  return parseChannelInput(raw).replace(/_/g, '-')
}

/** Nazwa użytkownika TikTok z `@nazwa`, samej nazwy albo URL-a `tiktok.com/@nazwa(/live)`. */
export function parseTikTokInput(raw: string): string {
  const trimmed = raw.trim()
  const fromUrl = /tiktok\.com\/@([^/?#\s]+)/i.exec(trimmed)
  const name = fromUrl?.[1] ?? trimmed.replace(/^@/, '')
  return /^[A-Za-z0-9._]{1,64}$/.test(name) ? name.toLowerCase() : ''
}

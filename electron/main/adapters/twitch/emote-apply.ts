import type { MessageFragment } from '../../../../shared/chat-message'

/** Emotka zewnętrznego providera (7TV/BTTV) gotowa do wstawienia w treść wiadomości. */
export interface ThirdPartyEmote {
  name: string
  url: string
  /** Statyczna (nieanimowana) klatka - używana w Trybie niskiego zużycia zasobów. `undefined`, jeśli
   *  provider nie udostępnia osobnego pliku statycznego (emotka i tak nieanimowana). */
  staticUrl?: string
  isZeroWidth: boolean
  provider?: '7tv' | 'bttv'
  /** Szerokość / wysokość, jeśli provider ją podaje. */
  ratio?: number
}

type EmoteFragment = Extract<MessageFragment, { type: 'emote' }>

/**
 * Czysta funkcja: zamienia na obrazki słowa będące kodami emotek zewnętrznych - wyłącznie po pełnych
 * granicach słów (białe znaki), żeby zwykłe słowa nie zmieniały się przypadkiem w emotki. Fragmenty
 * już oznaczone jako emotki (natywne emotki Twitcha z tagu `emotes`) NIGDY nie są nadpisywane.
 * Emotki zero-width tuż po emotce bazowej (również natywnej) stają się jej nakładką (`overlays`).
 */
export function applyThirdPartyEmotes(
  fragments: MessageFragment[],
  emoteMap: ReadonlyMap<string, ThirdPartyEmote>,
  /** Tryb niskiego zużycia zasobów: użyj statycznej klatki zamiast animowanej, jeśli dostępna. */
  preferStatic = false
): MessageFragment[] {
  if (emoteMap.size === 0) return fragments
  const urlFor = (e: ThirdPartyEmote): string => (preferStatic ? (e.staticUrl ?? e.url) : e.url)
  const result: MessageFragment[] = []
  // Ostatnia emotka bazowa, do której można doczepić nakładkę zero-width. Przetrwa same białe znaki
  // ("Pog RainTime"), ale resetuje się po zwykłym słowie / linku.
  let lastBase: { index: number; copied: boolean } | undefined
  const attachOverlay = (emote: ThirdPartyEmote): boolean => {
    if (!lastBase) return false
    const base = result[lastBase.index] as EmoteFragment
    // Kopia przy pierwszej modyfikacji - fragment wejściowy (np. natywna emotka) pozostaje nietknięty.
    const target: EmoteFragment = lastBase.copied ? base : { ...base }
    target.overlays = [...(target.overlays ?? []), { text: emote.name, url: urlFor(emote) }]
    result[lastBase.index] = target
    lastBase.copied = true
    return true
  }

  for (const fragment of fragments) {
    if (fragment.type === 'emote') {
      result.push(fragment)
      lastBase = { index: result.length - 1, copied: false }
      continue
    }
    if (fragment.type !== 'text') {
      result.push(fragment)
      lastBase = undefined
      continue
    }
    for (const token of fragment.text.split(/(\s+)/)) {
      if (token.length === 0) continue
      if (/^\s+$/.test(token)) {
        result.push({ type: 'text', text: token })
        continue
      }
      const emote = emoteMap.get(token)
      if (!emote) {
        result.push({ type: 'text', text: token })
        lastBase = undefined
        continue
      }
      if (emote.isZeroWidth && attachOverlay(emote)) continue
      const next: EmoteFragment = { type: 'emote', text: emote.name, url: urlFor(emote) }
      if (emote.provider) next.provider = emote.provider
      if (emote.ratio) next.ratio = emote.ratio
      result.push(next)
      lastBase = emote.isZeroWidth ? undefined : { index: result.length - 1, copied: true }
    }
  }
  return mergeAdjacentText(result)
}

/** Skleja sąsiednie fragmenty tekstowe powstałe przy tokenizacji - mniej węzłów DOM na wiadomość. */
function mergeAdjacentText(fragments: MessageFragment[]): MessageFragment[] {
  const out: MessageFragment[] = []
  for (const f of fragments) {
    const prev = out[out.length - 1]
    if (f.type === 'text' && prev?.type === 'text') {
      out[out.length - 1] = { type: 'text', text: prev.text + f.text }
    } else {
      out.push(f)
    }
  }
  return out
}

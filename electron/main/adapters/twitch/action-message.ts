import type { MessageFragment } from '../../../../shared/chat-message'

/**
 * Wiadomości /me (klasyczne IRC "CTCP ACTION") są, historycznie i nadal w praktyce, przesyłane jako
 * tekst owinięty w `\x01ACTION ... \x01`. Twitch nie dokumentuje osobnego pola dla tego w EventSub
 * (`message_type` ma wyłącznie udokumentowaną wartość "text" dla zwykłych wiadomości) - dlatego
 * wykrywamy wrapper bezpośrednio w treści. Jeśli go nie ma, funkcja jest no-opem (bezpieczne dla
 * zwykłych wiadomości), więc nie zakładamy niczego, czego nie da się zweryfikować w danych.
 */
const ACTION_PREFIX = '\u0001ACTION '
const ACTION_SUFFIX = '\u0001'

export function stripActionWrapper(
  rawText: string,
  fragments: MessageFragment[]
): { isAction: boolean; rawText: string; fragments: MessageFragment[] } {
  if (!rawText.startsWith(ACTION_PREFIX) || !rawText.endsWith(ACTION_SUFFIX) || rawText.length < ACTION_PREFIX.length + ACTION_SUFFIX.length) {
    return { isAction: false, rawText, fragments }
  }

  const strippedRawText = rawText.slice(ACTION_PREFIX.length, rawText.length - ACTION_SUFFIX.length)
  const next = fragments.map((f) => ({ ...f }))

  const first = next[0]
  if (first && first.type === 'text' && first.text.startsWith(ACTION_PREFIX)) {
    first.text = first.text.slice(ACTION_PREFIX.length)
  }
  const last = next[next.length - 1]
  if (last && last.type === 'text' && last.text.endsWith(ACTION_SUFFIX)) {
    last.text = last.text.slice(0, last.text.length - ACTION_SUFFIX.length)
  }

  return { isAction: true, rawText: strippedRawText, fragments: next }
}

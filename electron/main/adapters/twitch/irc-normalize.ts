import type { ChatMessage, MessageFragment } from '../../../../shared/chat-message'
import { toTwitchBadges, type BadgeResolver } from './badges'
import { type ParsedPrivmsg, parseBadgesTag, parseEmotesTag, twitchDefaultColor } from './irc-tags'
import { stripActionWrapper } from './action-message'

export function twitchEmoteUrl(id: string): string | undefined {
  // ID natywnej emotki: cyfry lub "emotesv2_<hex>" - walidujemy przed złożeniem URL-a.
  if (!/^[A-Za-z0-9_]+$/.test(id)) return undefined
  // `default` = wersja animowana, jeśli emotka ją ma (inaczej statyczna). Skala 2.0 (56 px) - emotki
  // wyświetlamy w ~24-36 px, więc 3.0 (112 px) tylko 4x zwiększałoby pamięć dekodowanych klatek.
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`
}

/**
 * Pozycje w tagu `emotes` (i w `message.emotes` EventSub) są liczone w PUNKTACH KODOWYCH Unicode,
 * nie w jednostkach UTF-16 jak `String.prototype.slice`. Emoji (np. 👋) przed emotką zajmuje dwie
 * jednostki UTF-16, więc naiwne `text.slice(start, end+1)` przesuwało emotkę o znak i rozbijało
 * wiadomość - dlatego tniemy po tablicy punktów kodowych.
 */
export function buildFragmentsFromEmoteRanges(
  text: string,
  ranges: { id: string; start: number; end: number }[]
): MessageFragment[] {
  if (ranges.length === 0) return text ? [{ type: 'text', text }] : []
  const chars = Array.from(text)
  const fragments: MessageFragment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor || range.end < range.start || range.end >= chars.length) continue
    const url = twitchEmoteUrl(range.id)
    if (!url) continue
    if (range.start > cursor) fragments.push({ type: 'text', text: chars.slice(cursor, range.start).join('') })
    fragments.push({ type: 'emote', text: chars.slice(range.start, range.end + 1).join(''), url, provider: 'twitch' })
    cursor = range.end + 1
  }
  if (cursor < chars.length) fragments.push({ type: 'text', text: chars.slice(cursor).join('') })
  return fragments
}

/**
 * Buduje wspólny model `ChatMessage` z wiadomości PRIVMSG Twitch IRC (tagi IRCv3). To jedyna ścieżka
 * wiadomości czatu Twitcha w tej aplikacji - używana zarówno dla skonfigurowanego kanału głównego,
 * jak i dla dowolnych obserwowanych kanałów (sekcja "Kanały"), z tego samego, jednego, współdzielonego
 * połączenia IRC (`irc-client.ts`). W przeciwieństwie do EventSub (poprzednio używanego), IRC
 * rzeczywiście przekazuje CTCP ACTION (`/me`) oraz kolor nicku w tym samym tagu co natywny czat.
 */
export function normalizeTwitchIrcMessage(
  parsed: ParsedPrivmsg,
  channelLogin: string,
  resolveBadge?: BadgeResolver,
  roomId?: string
): ChatMessage {
  const { tags } = parsed
  const emoteRanges = parseEmotesTag(tags.emotes)
  // Dla /me pozycje emotek w tagu `emotes` odnoszą się do treści BEZ opakowania `ACTION ...`
  // - dlatego najpierw zdejmujemy opakowanie, a dopiero potem tniemy tekst na emotki.
  const { isAction, rawText } = stripActionWrapper(parsed.text, [])
  const fragments = buildFragmentsFromEmoteRanges(rawText, emoteRanges)

  const badges = toTwitchBadges(parseBadgesTag(tags.badges), roomId ?? tags['room-id'], resolveBadge)

  const userId = tags['user-id'] || parsed.nick
  // Tag `color` przychodzi pusty, jeśli widz nigdy nie ustawił własnego koloru na Twitchu - w takim
  // wypadku natywny czat Twitcha (i klienty takie jak Chatterino) pokazują kolor domyślny wyliczony
  // deterministycznie z ID użytkownika z tej samej, realnej puli 15 barw Twitcha. Patrz irc-tags.ts.
  const color = tags.color && tags.color.length > 0 ? tags.color : twitchDefaultColor(userId)

  return {
    id: tags.id || `${parsed.nick}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    platform: 'twitch',
    channel: channelLogin,
    author: {
      id: userId,
      username: parsed.nick,
      displayName: tags['display-name'] || parsed.nick,
      color,
      badges,
      isBroadcaster: badges.some((b) => b.type === 'broadcaster'),
      isModerator: badges.some((b) => b.type === 'moderator') || tags.mod === '1',
      isSubscriber: badges.some((b) => b.type === 'subscriber' || b.type === 'founder')
    },
    fragments,
    rawText,
    isAction,
    timestampMs: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false
  }
}

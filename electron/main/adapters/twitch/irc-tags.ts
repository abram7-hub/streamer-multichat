/**
 * Parsowanie surowych linii Twitch IRC (IRCv3 message-tags) - używane przez `irc-client.ts` do
 * budowania wiadomości z anonimowego (lub uwierzytelnionego) połączenia IRC. Wydzielone jako czyste
 * funkcje bez zależności od WebSocketu, żeby dało się je przetestować bez prawdziwego połączenia.
 */

export interface ParsedPrivmsg {
  tags: Record<string, string>
  nick: string
  channel: string
  text: string
}

const TAG_ESCAPES: Record<string, string> = {
  ':': ';',
  's': ' ',
  '\\': '\\',
  'r': '\r',
  'n': '\n'
}

function unescapeTagValue(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      const next = value[i + 1]
      if (next !== undefined) result += TAG_ESCAPES[next] ?? next
      i++
    } else {
      result += value[i]
    }
  }
  return result
}

export function parseIrcTags(tagString: string): Record<string, string> {
  const tags: Record<string, string> = {}
  if (!tagString) return tags
  for (const pair of tagString.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq)
    const value = pair.slice(eq + 1)
    tags[key] = unescapeTagValue(value)
  }
  return tags
}

/**
 * Parsuje jedną linię `PRIVMSG` Twitch IRC, np.:
 * `@badges=broadcaster/1;color=#FF0000;display-name=Foo;id=abc;user-id=1 :foo!foo@foo.tmi.twitch.tv PRIVMSG #bar :hej!`
 * Zwraca `undefined`, jeśli linia nie jest wiadomością PRIVMSG na kanale (np. to PING, NOTICE, itp.).
 */
export function parsePrivmsgLine(line: string): ParsedPrivmsg | undefined {
  let rest = line
  let tags: Record<string, string> = {}
  if (rest.startsWith('@')) {
    const spaceIdx = rest.indexOf(' ')
    if (spaceIdx === -1) return undefined
    tags = parseIrcTags(rest.slice(1, spaceIdx))
    rest = rest.slice(spaceIdx + 1)
  }
  const match = /^:([^!]+)![^ ]+ PRIVMSG (#\S+) :([\s\S]*)$/.exec(rest)
  if (!match) return undefined
  const [, nick, channelWithHash, text] = match
  if (!nick || !channelWithHash) return undefined
  return { tags, nick, channel: channelWithHash.slice(1), text: text ?? '' }
}

export interface IrcBadge {
  id: string
  version: string
}

export function parseBadgesTag(badges: string | undefined): IrcBadge[] {
  if (!badges) return []
  return badges
    .split(',')
    .map((entry) => {
      const [id, version] = entry.split('/')
      return id ? { id, version: version ?? '1' } : undefined
    })
    .filter((b): b is IrcBadge => Boolean(b))
}

export interface IrcEmoteRange {
  id: string
  start: number
  end: number
}

/** Parsuje tag `emotes` w formacie `id:start-end,start-end/id2:start-end`. Zakresy są w jednostkach UTF-16 code unit (jak w tagu Twitcha), posortowane po pozycji startowej. */
export function parseEmotesTag(emotes: string | undefined): IrcEmoteRange[] {
  if (!emotes) return []
  const ranges: IrcEmoteRange[] = []
  for (const emoteEntry of emotes.split('/')) {
    const [id, positions] = emoteEntry.split(':')
    if (!id || !positions) continue
    for (const pos of positions.split(',')) {
      const [startStr, endStr] = pos.split('-')
      const start = Number(startStr)
      const end = Number(endStr)
      if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ id, start, end })
    }
  }
  return ranges.sort((a, b) => a.start - b.start)
}

/**
 * Realna paleta 15 domyślnych kolorów Twitcha (dokładnie te, spośród których użytkownik może wybrać
 * komendą `/color`, gdy nie ma Turbo/Prime) - używana przez natywny klient Twitcha jako kolor
 * zastępczy, gdy dany widz nigdy nie ustawił własnego koloru (tag `color` przychodzi wtedy pusty).
 * Wybór konkretnego koloru z tej puli jest deterministyczny (ten sam użytkownik = zawsze ten sam
 * kolor w tej aplikacji) na podstawie prostego hasha ID/nicku - Twitch nie publikuje swojego
 * dokładnego algorytmu haszującego, więc nie gwarantujemy identycznego wyboru co natywny czat,
 * ale kolor jest stabilny i pochodzi z tej samej, realnej puli barw Twitcha (nie losowej).
 */
export const TWITCH_DEFAULT_COLOR_PALETTE = [
  '#0000FF', // Blue
  '#8A2BE2', // BlueViolet
  '#5F9EA0', // CadetBlue
  '#D2691E', // Chocolate
  '#FF7F50', // Coral
  '#1E90FF', // DodgerBlue
  '#B22222', // Firebrick
  '#DAA520', // GoldenRod
  '#008000', // Green
  '#FF69B4', // HotPink
  '#FF4500', // OrangeRed
  '#FF0000', // Red
  '#2E8B57', // SeaGreen
  '#00FF7F', // SpringGreen
  '#9ACD32' // YellowGreen
] as const

export function twitchDefaultColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % TWITCH_DEFAULT_COLOR_PALETTE.length
  return TWITCH_DEFAULT_COLOR_PALETTE[index]!
}

export interface ParsedTaggedCommand {
  tags: Record<string, string>
  command: 'USERNOTICE' | 'ROOMSTATE'
  channel: string
  /** Opcjonalna treść (np. wiadomość dołączona do resuba). */
  text: string
}

/**
 * Parsuje linie `USERNOTICE` (suby, gifty, raidy - publiczne komunikaty widoczne dla każdego widza
 * czatu) oraz `ROOMSTATE` (zawiera `room-id`, czyli numeryczne ID kanału - bez logowania).
 */
export function parseTaggedCommandLine(line: string): ParsedTaggedCommand | undefined {
  if (!line.startsWith('@')) return undefined
  const spaceIdx = line.indexOf(' ')
  if (spaceIdx === -1) return undefined
  const rest = line.slice(spaceIdx + 1)
  const match = /^:tmi\.twitch\.tv (USERNOTICE|ROOMSTATE) (#\S+)(?: :([\s\S]*))?$/.exec(rest)
  if (!match) return undefined
  const [, command, channelWithHash, text] = match
  if (!command || !channelWithHash) return undefined
  return {
    tags: parseIrcTags(line.slice(1, spaceIdx)),
    command: command as ParsedTaggedCommand['command'],
    channel: channelWithHash.slice(1).toLowerCase(),
    text: text ?? ''
  }
}

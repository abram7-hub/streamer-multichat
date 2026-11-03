import type { ChatMessage } from './chat-message'
import type { Platform } from './platform'
import { isHexColor } from './appearance'

/**
 * Wzmianki: wiadomości zawierające nick użytkownika (wykrywany z ustawień platform) albo jedno
 * z własnych słów/fraz. Frazy są zawsze zwykłym tekstem - znaki specjalne wyrażeń regularnych
 * są escapowane, więc "C++", "A.B" czy "[TEST]" pasują dokładnie do siebie.
 */
export interface MentionHighlightSettings {
  background: string
  /** Krycie tła wyróżnienia w procentach (0-100). */
  backgroundOpacity: number
  border: string
  /** Kolor akcentu (błysk przy pojawieniu się wzmianki). */
  accent: string
  /** Mocniejszy błysk wzmianki - działa także przy wyłączonych zwykłych animacjach. */
  strongerPulse: boolean
  /** Mocniejsze podskoczenie wzmianki - j.w. */
  strongerBounce: boolean
}

export interface MentionSoundSettings {
  enabled: boolean
  /** Głośność w procentach (0-100). */
  volume: number
  /** Minimalny odstęp między dźwiękami w sekundach (spam wzmianek nie odtwarza serii dźwięków). */
  cooldownSec: number
  /** Własny dźwięk jako data URL (bez ścieżki na dysku) i sama nazwa pliku do wyświetlenia. */
  customData: string
  customName: string
}

export interface MentionSettings {
  enabled: boolean
  /** Wykrywaj automatycznie nick z ustawień platform (kanał Twitch, slug Kick, @handle, TikTok). */
  autoNick: boolean
  keywords: string[]
  /** Własne frazy tylko jako całe słowa (nicki są zawsze dopasowywane jako całe słowa). */
  wholeWord: boolean
  caseSensitive: boolean
  highlight: MentionHighlightSettings
  sound: MentionSoundSettings
}

export const MENTION_LIMITS = {
  maxKeywords: 50,
  maxKeywordLength: 60,
  /** Data URL własnego dźwięku (ok. 500 KB pliku po zakodowaniu base64). */
  maxCustomSoundChars: 700_000,
  cooldownSec: [0, 60] as [number, number],
  historySize: 100
}

export const DEFAULT_MENTION_HIGHLIGHT: MentionHighlightSettings = {
  background: '#FFB020',
  backgroundOpacity: 14,
  border: '#FFB020',
  accent: '#FFD27A',
  strongerPulse: true,
  strongerBounce: false
}

export const DEFAULT_MENTION_SETTINGS: MentionSettings = {
  enabled: true,
  autoNick: true,
  keywords: [],
  wholeWord: true,
  caseSensitive: false,
  highlight: DEFAULT_MENTION_HIGHLIGHT,
  sound: { enabled: false, volume: 60, cooldownSec: 3, customData: '', customName: '' }
}

type Raw = Record<string, unknown>
const asObject = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {})
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const num = (value: unknown, fallback: number, [min, max]: [number, number]): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const color = (value: unknown, fallback: string): string => (isHexColor(value) ? value : fallback)

/** Lista fraz: przycięte, bez pustych, bez duplikatów (bez względu na wielkość liter), z limitem. */
export function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const phrase = item.trim().slice(0, MENTION_LIMITS.maxKeywordLength)
    const key = phrase.toLowerCase()
    if (phrase.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(phrase)
    if (out.length >= MENTION_LIMITS.maxKeywords) break
  }
  return out
}

export function normalizeMentionHighlight(value: unknown): MentionHighlightSettings {
  const raw = asObject(value)
  const d = DEFAULT_MENTION_HIGHLIGHT
  return {
    background: color(raw['background'], d.background),
    backgroundOpacity: num(raw['backgroundOpacity'], d.backgroundOpacity, [0, 100]),
    border: color(raw['border'], d.border),
    accent: color(raw['accent'], d.accent),
    strongerPulse: bool(raw['strongerPulse'], d.strongerPulse),
    strongerBounce: bool(raw['strongerBounce'], d.strongerBounce)
  }
}

function isAudioDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MENTION_LIMITS.maxCustomSoundChars && /^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(value)
}

export function normalizeMentionSettings(value: unknown): MentionSettings {
  const raw = asObject(value)
  const d = DEFAULT_MENTION_SETTINGS
  const sound = asObject(raw['sound'])
  const customData = isAudioDataUrl(sound['customData']) ? sound['customData'] : ''
  return {
    enabled: bool(raw['enabled'], d.enabled),
    autoNick: bool(raw['autoNick'], d.autoNick),
    keywords: normalizeKeywords(raw['keywords']),
    wholeWord: bool(raw['wholeWord'], d.wholeWord),
    caseSensitive: bool(raw['caseSensitive'], d.caseSensitive),
    highlight: normalizeMentionHighlight(raw['highlight']),
    sound: {
      enabled: bool(sound['enabled'], d.sound.enabled),
      volume: num(sound['volume'], d.sound.volume, [0, 100]),
      cooldownSec: num(sound['cooldownSec'], d.sound.cooldownSec, MENTION_LIMITS.cooldownSec),
      customData,
      // Tylko nazwa pliku (bez katalogów), i tylko gdy jest też sam dźwięk.
      customName: customData && typeof sound['customName'] === 'string' ? (sound['customName'].split(/[\\/]/).pop() ?? '').slice(0, 120) : ''
    }
  }
}

/** Nicki użytkownika wg platformy, wzięte z ustawień połączeń. */
export type PlatformNicks = Partial<Record<Platform, string>>

export interface NickSources {
  twitch: { channelLogin: string }
  kick: { channelSlug: string }
  youtube: { channelHandle: string }
  tiktok: { uniqueId: string }
}

/** Nick z pola ustawień: bez "@", bez adresu URL; YouTube tylko w formie @handle (ID kanału to nie nick). */
export function platformNicks(sources: NickSources): PlatformNicks {
  const clean = (v: string): string => v.trim().replace(/^@/, '').replace(/\s+/g, '')
  const youtube = sources.youtube.channelHandle.trim().match(/(?:^|\/)@([\w.-]+)/)?.[1] ?? ''
  return {
    twitch: clean(sources.twitch.channelLogin),
    kick: clean(sources.kick.channelSlug),
    youtube,
    tiktok: clean(sources.tiktok.uniqueId)
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

// Granica "całego słowa" dla dowolnego alfabetu (\b w JS zna tylko ASCII). Lookbehind/lookahead
// zamiast \b działają też, gdy fraza zaczyna się lub kończy znakiem innym niż litera (np. "C++").
const WORD_CHAR = '[\\p{L}\\p{N}_]'

function phrasePattern(phrase: string, wholeWord: boolean): string {
  const escaped = escapeRegExp(phrase)
  if (!wholeWord) return escaped
  const first = phrase[0] ?? ''
  const last = phrase[phrase.length - 1] ?? ''
  const isWord = (ch: string): boolean => /[\p{L}\p{N}_]/u.test(ch)
  // Granica jest potrzebna tylko po stronie, gdzie fraza zaczyna/kończy się znakiem słowa:
  // "C++" nie może być częścią "XC++", ale za "+" może stać cokolwiek.
  return `${isWord(first) ? `(?<!${WORD_CHAR})` : ''}${escaped}${isWord(last) ? `(?!${WORD_CHAR})` : ''}`
}

function compile(phrases: { text: string; wholeWord: boolean }[], caseSensitive: boolean): RegExp | null {
  if (phrases.length === 0) return null
  // Dłuższe frazy najpierw - alternatywa wybiera pierwszą pasującą.
  const parts = [...phrases].sort((a, b) => b.text.length - a.text.length).map((p) => phrasePattern(p.text, p.wholeWord))
  return new RegExp(parts.join('|'), caseSensitive ? 'u' : 'iu')
}

export interface MentionMatcher {
  /** Czy wiadomość jest wzmianką (zdarzenia i własne wiadomości użytkownika - nie). */
  matches(message: Pick<ChatMessage, 'platform' | 'rawText' | 'event' | 'author'>): boolean
  /** Sama treść - do testów i podglądu w ustawieniach. */
  test(text: string): boolean
}

/**
 * Kompiluje ustawienia do dopasowania wykonywanego raz na nową wiadomość (jedno wyrażenie,
 * przygotowane z góry). Wywołujący trzyma wynik do następnej zmiany ustawień.
 *
 * Wszystkie nicki z ustawień należą do tego samego użytkownika, więc każdy z nich jest wzmianką na
 * każdej platformie (widz z Kicka może napisać nick z Twitcha). Nicki są zawsze dopasowywane jako
 * całe słowa i bez względu na wielkość liter - pasują też w formie "@nick".
 */
export function compileMentionMatcher(settings: MentionSettings, nicks: PlatformNicks, extraNick = ''): MentionMatcher {
  const lower = (s: string): string => s.toLowerCase()
  const autoNicks = settings.autoNick ? Object.values(nicks).filter((n): n is string => Boolean(n)) : []
  const extra = extraNick.trim().replace(/^@/, '')
  const keywords = compile(
    settings.keywords.map((text) => ({ text, wholeWord: settings.wholeWord })),
    settings.caseSensitive
  )
  const nickRe = compile(
    [...new Set([...autoNicks, extra].filter(Boolean).map(lower))].map((text) => ({ text, wholeWord: true })),
    false
  )
  // Własne wiadomości użytkownika (autor = nick tej platformy) nie są wzmiankami.
  const ownNicks = new Map(Object.entries(nicks).filter(([, n]) => n).map(([p, n]) => [p, lower(n!)]))
  const test = (text: string): boolean => settings.enabled && text.length > 0 && Boolean(nickRe?.test(text) || keywords?.test(text))
  return {
    test,
    matches(message) {
      if (message.event) return false
      if (ownNicks.get(message.platform) === lower(message.author.username)) return false
      return test(message.rawText)
    }
  }
}

/** Ogranicza odtwarzanie dźwięku: najwyżej jeden na `cooldownMs`. */
export class MentionSoundThrottle {
  private last = Number.NEGATIVE_INFINITY
  constructor(private readonly now: () => number = Date.now) {}
  tryPlay(cooldownMs: number): boolean {
    const t = this.now()
    if (t - this.last < cooldownMs) return false
    this.last = t
    return true
  }
}

/** Zmienne CSS wyróżnienia wzmianki (ustawiane na kontenerze listy, jak reszta wyglądu). */
export function mentionCssVars(h: MentionHighlightSettings): Record<string, string> {
  return {
    '--mention-bg': `color-mix(in srgb, ${h.background} ${h.backgroundOpacity}%, transparent)`,
    '--mention-border': h.border,
    '--mention-accent': h.accent
  }
}

export function mentionDataAttributes(h: MentionHighlightSettings): Record<string, string> {
  return {
    'data-mention-pulse': String(h.strongerPulse),
    'data-mention-bounce': String(h.strongerBounce)
  }
}

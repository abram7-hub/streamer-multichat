import { PLATFORMS, type Platform } from './platform'

export type EntryAnimation = 'none' | 'left' | 'right' | 'bottom' | 'expand'
export type MessageEffect = 'none' | 'pulse' | 'bounce' | 'pulse-bounce'
export type EffectIntensity = 'subtle' | 'normal' | 'strong'
/** Krawędź, przy której stoi pierwsza wiadomość. */
export type StackAnchor = 'top' | 'bottom'
/** 'end' - nowa wiadomość dochodzi za poprzednią (dalej od krawędzi), 'anchor' - przy krawędzi, starsze się odsuwają. */
export type NewMessagePosition = 'end' | 'anchor'
export type MessageWidth = 'full' | 'fit'

/** Wygląd listy wiadomości - wspólny dla czatu głównego, nakładki OBS i (później) Gaming Overlay. */
export interface ChatAppearance {
  fontSizePx: number
  /** Rozmiar emotek w % rozmiaru domyślnego. */
  emoteScale: number
  /** Rozmiar odznak w % rozmiaru domyślnego. */
  badgeScale: number
  iconSizePx: number
  messageSpacingPx: number
  borderRadiusPx: number
  backgroundsEnabled: boolean
  /** Mnożnik (w %) krycia teł ustawionego osobno dla każdej platformy. */
  backgroundIntensity: number
  showTimestamps: boolean
  showBadges: boolean
  compact: boolean
  width: MessageWidth
  entryAnimation: EntryAnimation
  effect: MessageEffect
  intensity: EffectIntensity
  animationDurationMs: number
  stackAnchor: StackAnchor
  newMessagePosition: NewMessagePosition
}

export interface PlatformColor {
  /** #rrggbb */
  background: string
  /** Krycie tła 0-100 (przed mnożnikiem `backgroundIntensity`). */
  backgroundOpacity: number
  /** #rrggbb - kolor pulsowania i lewej krawędzi zdarzeń. */
  accent: string
}

export type PlatformColors = Record<Platform, PlatformColor>
export type AppearanceTarget = 'main' | 'obs' | 'gaming'
export const APPEARANCE_TARGETS: readonly AppearanceTarget[] = ['main', 'obs', 'gaming']

/** Wspólne ustawienia + nadpisania per miejsce wyświetlania (tylko pola, które się różnią). */
export interface AppearanceSettings {
  common: ChatAppearance
  overrides: Record<AppearanceTarget, Partial<ChatAppearance>>
  platformColors: PlatformColors
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  fontSizePx: 15,
  emoteScale: 100,
  badgeScale: 100,
  iconSizePx: 14,
  messageSpacingPx: 2,
  borderRadiusPx: 6,
  backgroundsEnabled: true,
  backgroundIntensity: 100,
  showTimestamps: true,
  showBadges: true,
  compact: false,
  width: 'full',
  entryAnimation: 'none',
  effect: 'pulse',
  intensity: 'normal',
  animationDurationMs: 260,
  stackAnchor: 'top',
  newMessagePosition: 'end'
}

export const DEFAULT_PLATFORM_COLORS: PlatformColors = {
  twitch: { background: '#9146FF', backgroundOpacity: 10, accent: '#9146FF' },
  kick: { background: '#53FC18', backgroundOpacity: 10, accent: '#53FC18' },
  youtube: { background: '#FF0000', backgroundOpacity: 10, accent: '#FF0000' },
  tiktok: { background: '#8A8A8E', backgroundOpacity: 10, accent: '#AAAAB0' }
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  common: DEFAULT_CHAT_APPEARANCE,
  overrides: {
    main: {},
    // Nakładka OBS: większa czcionka i klasyczny układ "najnowsza na dole", bez znaczników czasu.
    obs: { fontSizePx: 20, showTimestamps: false, stackAnchor: 'bottom', newMessagePosition: 'anchor', messageSpacingPx: 3 },
    // Gaming Overlay: nowe wiadomości na dole, wjazd od dołu, bez znaczników czasu.
    gaming: { fontSizePx: 16, showTimestamps: false, stackAnchor: 'bottom', newMessagePosition: 'anchor', entryAnimation: 'bottom' }
  },
  platformColors: DEFAULT_PLATFORM_COLORS
}

const ENUMS: { [K in keyof ChatAppearance]?: readonly string[] } = {
  width: ['full', 'fit'],
  entryAnimation: ['none', 'left', 'right', 'bottom', 'expand'],
  effect: ['none', 'pulse', 'bounce', 'pulse-bounce'],
  intensity: ['subtle', 'normal', 'strong'],
  stackAnchor: ['top', 'bottom'],
  newMessagePosition: ['end', 'anchor']
}

export const APPEARANCE_LIMITS: { [K in keyof ChatAppearance]?: readonly [number, number] } = {
  fontSizePx: [10, 40],
  emoteScale: [50, 250],
  badgeScale: [50, 250],
  iconSizePx: [10, 32],
  messageSpacingPx: [0, 16],
  borderRadiusPx: [0, 16],
  backgroundIntensity: [0, 400],
  animationDurationMs: [120, 1000]
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

/** Czy wartość pasuje do typu pola (używane do odrzucania uszkodzonych/obcych wpisów z config.json). */
function validFieldValue<K extends keyof ChatAppearance>(key: K, value: unknown): value is ChatAppearance[K] {
  const expected = DEFAULT_CHAT_APPEARANCE[key]
  if (typeof value !== typeof expected) return false
  const allowed = ENUMS[key]
  if (allowed) return allowed.includes(value as string)
  if (typeof value === 'number') return Number.isFinite(value)
  return true
}

function clampField<K extends keyof ChatAppearance>(key: K, value: ChatAppearance[K]): ChatAppearance[K] {
  const limits = APPEARANCE_LIMITS[key]
  if (!limits || typeof value !== 'number') return value
  return Math.min(limits[1], Math.max(limits[0], Math.round(value))) as ChatAppearance[K]
}

/** Zostawia tylko znane pola o poprawnym typie (z przycięciem wartości liczbowych do zakresu). */
export function sanitizeAppearancePatch(raw: unknown): Partial<ChatAppearance> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Partial<ChatAppearance> = {}
  for (const key of Object.keys(DEFAULT_CHAT_APPEARANCE) as (keyof ChatAppearance)[]) {
    const value = (raw as Record<string, unknown>)[key]
    if (value !== undefined && validFieldValue(key, value)) {
      ;(out as Record<string, unknown>)[key] = clampField(key, value)
    }
  }
  return out
}

function sanitizePlatformColor(raw: unknown, fallback: PlatformColor): PlatformColor {
  const value = raw && typeof raw === 'object' ? (raw as Partial<PlatformColor>) : {}
  const opacity = typeof value.backgroundOpacity === 'number' && Number.isFinite(value.backgroundOpacity)
    ? Math.min(100, Math.max(0, Math.round(value.backgroundOpacity)))
    : fallback.backgroundOpacity
  return {
    background: isHexColor(value.background) ? value.background : fallback.background,
    backgroundOpacity: opacity,
    accent: isHexColor(value.accent) ? value.accent : fallback.accent
  }
}

/** Pełne, poprawne ustawienia wyglądu z dowolnego (również częściowego lub uszkodzonego) wejścia. */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AppearanceSettings>) : {}
  const rawOverrides = value.overrides && typeof value.overrides === 'object' ? value.overrides : undefined
  const overrides = {} as Record<AppearanceTarget, Partial<ChatAppearance>>
  for (const target of APPEARANCE_TARGETS) {
    overrides[target] = rawOverrides ? sanitizeAppearancePatch(rawOverrides[target]) : { ...DEFAULT_APPEARANCE.overrides[target] }
  }
  const rawColors = value.platformColors && typeof value.platformColors === 'object' ? value.platformColors : undefined
  const platformColors = {} as PlatformColors
  for (const platform of PLATFORMS) {
    platformColors[platform] = sanitizePlatformColor(rawColors?.[platform], DEFAULT_PLATFORM_COLORS[platform])
  }
  return {
    common: { ...DEFAULT_CHAT_APPEARANCE, ...sanitizeAppearancePatch(value.common) },
    overrides,
    platformColors
  }
}

export function resolveAppearance(settings: AppearanceSettings, target: AppearanceTarget): ChatAppearance {
  return { ...settings.common, ...settings.overrides[target] }
}

export function setAppearanceValue<K extends keyof ChatAppearance>(
  settings: AppearanceSettings,
  scope: AppearanceTarget | 'common',
  key: K,
  value: ChatAppearance[K]
): AppearanceSettings {
  const clamped = clampField(key, value)
  if (scope === 'common') return { ...settings, common: { ...settings.common, [key]: clamped } }
  return { ...settings, overrides: { ...settings.overrides, [scope]: { ...settings.overrides[scope], [key]: clamped } } }
}

export function clearAppearanceOverride(settings: AppearanceSettings, target: AppearanceTarget, key: keyof ChatAppearance): AppearanceSettings {
  const next = { ...settings.overrides[target] }
  delete next[key]
  return { ...settings, overrides: { ...settings.overrides, [target]: next } }
}

export function setPlatformColor(settings: AppearanceSettings, platform: Platform, patch: Partial<PlatformColor>): AppearanceSettings {
  const merged = sanitizePlatformColor({ ...settings.platformColors[platform], ...patch }, settings.platformColors[platform])
  return { ...settings, platformColors: { ...settings.platformColors, [platform]: merged } }
}

export function resetPlatformColor(settings: AppearanceSettings, platform: Platform): AppearanceSettings {
  return { ...settings, platformColors: { ...settings.platformColors, [platform]: { ...DEFAULT_PLATFORM_COLORS[platform] } } }
}

/**
 * Cztery sposoby układania wiadomości z dwóch ustawień. Wiadomości są zawsze w kolejności
 * chronologicznej; `newestFirst` mówi tylko, czy lista ma być wyświetlona od najnowszej.
 *   A: top + end      - pierwsza u góry, kolejne pod nią
 *   B: bottom + end   - pierwsza na dole, kolejne nad nią
 *   C: top + anchor   - nowe zawsze u góry, starsze schodzą w dół
 *   D: bottom + anchor - nowe zawsze na dole, starsze idą w górę
 */
export function chatLayout(appearance: Pick<ChatAppearance, 'stackAnchor' | 'newMessagePosition'>): {
  newestFirst: boolean
  justifyContent: 'flex-start' | 'safe flex-end'
} {
  const { stackAnchor, newMessagePosition } = appearance
  const newestFirst = (stackAnchor === 'top') === (newMessagePosition === 'anchor')
  // `safe`: gdy wiadomości nie mieszczą się w oknie, lista wraca do wyrównania od początku -
  // inaczej część przy górnej krawędzi byłaby nieosiągalna przewijaniem.
  return { newestFirst, justifyContent: stackAnchor === 'top' ? 'flex-start' : 'safe flex-end' }
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

/** Tło wiadomości danej platformy jako `rgba(...)` (albo `transparent`, gdy tła są wyłączone). */
export function platformBackground(color: PlatformColor, appearance: Pick<ChatAppearance, 'backgroundsEnabled' | 'backgroundIntensity'>): string {
  if (!appearance.backgroundsEnabled) return 'transparent'
  const alpha = Math.min(100, Math.max(0, color.backgroundOpacity * (appearance.backgroundIntensity / 100))) / 100
  const [r, g, b] = hexToRgb(color.background)
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`
}

const INTENSITY: Record<EffectIntensity, { pulseMix: string; bounceUp: string; bounceDown: string; distance: string }> = {
  subtle: { pulseMix: '14%', bounceUp: '1.02', bounceDown: '0.995', distance: '10px' },
  normal: { pulseMix: '22%', bounceUp: '1.04', bounceDown: '0.99', distance: '18px' },
  strong: { pulseMix: '34%', bounceUp: '1.07', bounceDown: '0.985', distance: '28px' }
}

/**
 * Zmienne CSS kontenera listy. Wiersze czytają z nich rozmiary, kolory platform i parametry
 * animacji, więc zmiana wyglądu nie wymaga ponownego renderowania żadnej wiadomości.
 */
export function appearanceCssVars(appearance: ChatAppearance, colors: PlatformColors): Record<string, string> {
  const intensity = INTENSITY[appearance.intensity]
  const vars: Record<string, string> = {
    '--chat-font-size': `${appearance.fontSizePx}px`,
    '--emote-size': `${(1.6 * appearance.emoteScale) / 100}em`,
    '--badge-size': `${(1.15 * appearance.badgeScale) / 100}em`,
    '--icon-size': `${appearance.iconSizePx}px`,
    '--msg-gap': `${appearance.messageSpacingPx}px`,
    '--msg-radius': `${appearance.borderRadiusPx}px`,
    '--enter-duration': `${appearance.animationDurationMs}ms`,
    '--bounce-duration': `${Math.round(appearance.animationDurationMs * 1.7)}ms`,
    '--enter-distance': intensity.distance,
    '--pulse-mix': intensity.pulseMix,
    '--bounce-up': intensity.bounceUp,
    '--bounce-down': intensity.bounceDown
  }
  for (const platform of PLATFORMS) {
    vars[`--pc-${platform}-bg`] = platformBackground(colors[platform], appearance)
    vars[`--pc-${platform}-accent`] = colors[platform].accent
  }
  return vars
}

/** Atrybuty kontenera wybierające reguły CSS animacji i układu wiersza. */
export function appearanceDataAttributes(appearance: ChatAppearance): Record<string, string> {
  return {
    'data-enter': appearance.entryAnimation,
    'data-effect': appearance.effect,
    'data-compact': String(appearance.compact),
    'data-width': appearance.width
  }
}

/** Jak długo wiersz zachowuje klasę "fresh" - dłużej niż najdłuższa animacja (pulsowanie 2 s). */
export function freshClassDurationMs(appearance: Pick<ChatAppearance, 'animationDurationMs'>): number {
  return Math.max(2000, Math.round(appearance.animationDurationMs * 2.7)) + 300
}

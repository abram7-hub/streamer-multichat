import {
  DEFAULT_APPEARANCE,
  DEFAULT_CHAT_APPEARANCE,
  DEFAULT_PLATFORM_COLORS,
  normalizeAppearance,
  sanitizeAppearancePatch,
  type AppearanceSettings,
  type ChatAppearance
} from './appearance'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type AppSettings } from './settings'
import { normalizeGamingSettings } from './gaming'
import { normalizeMentionSettings } from './mentions'

type Raw = Record<string, unknown>

const asObject = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {})

/**
 * Pola wyglądu z wersji 1.0.x (schema 1), zapisane w `ui` i `overlay`. Krycie tła było jednym
 * procentem dla wszystkich platform; teraz każda platforma ma własne krycie (domyślnie 10%),
 * a stary procent przechodzi w mnożnik `backgroundIntensity` (10% -> 100%).
 */
function legacyAppearance(section: Raw, kind: 'ui' | 'overlay'): Partial<ChatAppearance> {
  const legacy: Raw = {
    fontSizePx: section['fontSizePx'],
    backgroundsEnabled: section['messageBackgroundsEnabled']
  }
  const intensity = section['messageBackgroundIntensity']
  if (typeof intensity === 'number') {
    legacy['backgroundIntensity'] = (intensity / DEFAULT_PLATFORM_COLORS.twitch.backgroundOpacity) * 100
  }
  if (kind === 'ui') {
    legacy['showTimestamps'] = section['showTimestamps']
    if (typeof section['pulseNewMessages'] === 'boolean') legacy['effect'] = section['pulseNewMessages'] ? 'pulse' : 'none'
  } else {
    legacy['showBadges'] = section['showBadges']
    if (typeof section['animationsEnabled'] === 'boolean') legacy['effect'] = section['animationsEnabled'] ? 'pulse' : 'none'
  }
  return sanitizeAppearancePatch(legacy)
}

/** Nadpisanie zawiera tylko pola różne od ustawień wspólnych. */
function differences(base: ChatAppearance, values: Partial<ChatAppearance>): Partial<ChatAppearance> {
  const out: Partial<ChatAppearance> = {}
  for (const [key, value] of Object.entries(values) as [keyof ChatAppearance, unknown][]) {
    if (base[key] !== value) (out as Raw)[key] = value
  }
  return out
}

export function migrateAppearanceFromV1(raw: Raw): AppearanceSettings {
  const common = DEFAULT_CHAT_APPEARANCE
  const main = differences(common, legacyAppearance(asObject(raw['ui']), 'ui'))
  const obs = differences(common, { ...DEFAULT_APPEARANCE.overrides.obs, ...legacyAppearance(asObject(raw['overlay']), 'overlay') })
  return {
    common: { ...common },
    overrides: { main, obs, gaming: {} },
    platformColors: structuredClone(DEFAULT_PLATFORM_COLORS)
  }
}

/**
 * Podnosi zapisane ustawienia do bieżącej wersji schematu. Ustawienia już w bieżącej wersji wracają
 * bez zmian (ten sam obiekt), więc wywołujący może po porównaniu referencji zdecydować o zapisie.
 * Pola z poprzedniej wersji zostają w pliku nietknięte - powrót do v1.0.x odczyta je jak dawniej.
 */
export function migrateSettings<T extends object>(raw: T): T {
  let value = raw as Raw
  const version = typeof value['schemaVersion'] === 'number' ? value['schemaVersion'] : 1
  if (version >= SETTINGS_SCHEMA_VERSION) return raw
  // 1 -> 2: wygląd wiadomości z pól ui/overlay do wspólnego modelu z nadpisaniami.
  if (version < 2) value = { ...value, appearance: migrateAppearanceFromV1(value) }
  // 2 -> 3: Gaming Overlay. Nadpisanie wyglądu "gaming" istniało wcześniej, ale nie było używane -
  // puste dostaje wartości domyślne nakładki; reszta ustawień zostaje bez zmian.
  if (version < 3) value = migrateGamingFromV2(value)
  // 3 -> 4: wzmianki (nowa sekcja z wartościami domyślnymi). Dotychczasowy `ui.highlightNick`
  // zostaje na swoim miejscu i dalej jest wyróżniany - teraz przez centralny detektor wzmianek.
  value = { ...value, mentions: normalizeMentionSettings(value['mentions']) }
  return { ...value, schemaVersion: SETTINGS_SCHEMA_VERSION } as T
}

function migrateGamingFromV2(value: Raw): Raw {
  const appearance = asObject(value['appearance'])
  const overrides = asObject(appearance['overrides'])
  const gamingOverride = asObject(overrides['gaming'])
  const nextOverrides = Object.keys(gamingOverride).length === 0 ? { ...overrides, gaming: { ...DEFAULT_APPEARANCE.overrides.gaming } } : overrides
  return {
    ...value,
    appearance: { ...appearance, overrides: nextOverrides },
    gaming: normalizeGamingSettings(value['gaming'])
  }
}

/**
 * Ustawienia z pliku -> kompletny obiekt `AppSettings`. electron-store uzupełnia z wartości
 * domyślnych tylko brakujące klucze NAJWYŻSZEGO poziomu - nowe podpola istniejących sekcji
 * (dodane w nowszej wersji) uzupełnia dopiero to płytkie scalenie po sekcjach, bez utraty
 * zapisanych wartości. Wcześniej wykonywana jest migracja schematu.
 */
export function normalizeSettings(stored: object): AppSettings {
  const raw = migrateSettings(stored) as Partial<AppSettings>
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    twitch: { ...DEFAULT_SETTINGS.twitch, ...raw.twitch },
    kick: { ...DEFAULT_SETTINGS.kick, ...raw.kick },
    youtube: { ...DEFAULT_SETTINGS.youtube, ...raw.youtube },
    tiktok: { ...DEFAULT_SETTINGS.tiktok, ...raw.tiktok },
    overlay: { ...DEFAULT_SETTINGS.overlay, ...raw.overlay },
    ui: { ...DEFAULT_SETTINGS.ui, ...raw.ui },
    ignoreLists: {
      twitch: { ...DEFAULT_SETTINGS.ignoreLists.twitch, ...raw.ignoreLists?.twitch },
      kick: { ...DEFAULT_SETTINGS.ignoreLists.kick, ...raw.ignoreLists?.kick },
      youtube: { ...DEFAULT_SETTINGS.ignoreLists.youtube, ...raw.ignoreLists?.youtube },
      tiktok: { ...DEFAULT_SETTINGS.ignoreLists.tiktok, ...raw.ignoreLists?.tiktok }
    },
    watchedChannels: Array.isArray(raw.watchedChannels) ? raw.watchedChannels : DEFAULT_SETTINGS.watchedChannels,
    appearance: normalizeAppearance(raw.appearance),
    gaming: normalizeGamingSettings(raw.gaming),
    mentions: normalizeMentionSettings(raw.mentions)
  }
}

/**
 * Wartości domyślne przekazywane do electron-store. Bez `schemaVersion` i `appearance`: magazyn
 * dopisałby je do pliku z wersji 1.0.x przy starcie, zanim migracja zdążyłaby przenieść stare pola.
 */
export function storeDefaults(): Omit<AppSettings, 'schemaVersion' | 'appearance'> {
  const { schemaVersion: _version, appearance: _appearance, ...rest } = DEFAULT_SETTINGS
  return rest
}

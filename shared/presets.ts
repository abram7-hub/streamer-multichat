import {
  DEFAULT_APPEARANCE,
  DEFAULT_CHAT_APPEARANCE,
  DEFAULT_PLATFORM_COLORS,
  resolveAppearance,
  setAppearanceValue,
  type AppearanceSettings,
  type AppearanceTarget,
  type ChatAppearance
} from './appearance'
import type { GamingOverlaySettings } from './gaming'

/**
 * Gotowe zestawy wyglądu. Zmieniają wyłącznie wygląd (animacje, intensywność, odstępy, tryb
 * kompaktowy, tło wiadomości, rozmiar czcionki) i - dla Gaming Overlay - czas życia i liczbę
 * widocznych wiadomości. Nie dotykają kanałów, tokenów, listy ignorowanych ani integracji.
 * Bieżący preset jest rozpoznawany przez porównanie wartości: każda ręczna zmiana daje "Własny".
 */
export type PresetId = 'minimal' | 'smooth' | 'dynamic' | 'performance' | 'gaming' | 'obs'
export type PresetState = PresetId | 'custom'
export type PresetScope = AppearanceTarget | 'common'

type PresetFields = Pick<
  ChatAppearance,
  'entryAnimation' | 'effect' | 'intensity' | 'animationDurationMs' | 'messageSpacingPx' | 'compact' | 'backgroundIntensity'
>

interface PresetDefinition {
  label: string
  description: string
  appearance: PresetFields
  /** Rozmiar czcionki względem domyślnego dla danego miejsca (czat 15 px, OBS 20 px, Gaming 16 px). */
  fontDelta: number
  /** Tylko dla Gaming Overlay. */
  gaming: Pick<GamingOverlaySettings, 'lifetimeSec' | 'maxVisible'>
}

export const PRESETS: Record<PresetId, PresetDefinition> = {
  minimal: {
    label: 'Minimal',
    description: 'Bez animacji, ciasne wiersze, delikatne tło.',
    appearance: { entryAnimation: 'none', effect: 'none', intensity: 'subtle', animationDurationMs: 200, messageSpacingPx: 1, compact: true, backgroundIntensity: 60 },
    fontDelta: 0,
    gaming: { lifetimeSec: 8, maxVisible: 4 }
  },
  smooth: {
    label: 'Smooth',
    description: 'Łagodne wejście od dołu i delikatny błysk.',
    appearance: { entryAnimation: 'bottom', effect: 'pulse', intensity: 'subtle', animationDurationMs: 320, messageSpacingPx: 3, compact: false, backgroundIntensity: 100 },
    fontDelta: 0,
    gaming: { lifetimeSec: 12, maxVisible: 5 }
  },
  dynamic: {
    label: 'Dynamic',
    description: 'Wejście z boku, błysk i podskoczenie.',
    appearance: { entryAnimation: 'left', effect: 'pulse-bounce', intensity: 'strong', animationDurationMs: 300, messageSpacingPx: 3, compact: false, backgroundIntensity: 140 },
    fontDelta: 1,
    gaming: { lifetimeSec: 10, maxVisible: 6 }
  },
  performance: {
    label: 'Performance',
    description: 'Najlżejszy: bez animacji wejścia, bez błysku i podskoczenia.',
    appearance: { entryAnimation: 'none', effect: 'none', intensity: 'subtle', animationDurationMs: 120, messageSpacingPx: 1, compact: true, backgroundIntensity: 80 },
    fontDelta: 0,
    gaming: { lifetimeSec: 6, maxVisible: 3 }
  },
  gaming: {
    label: 'Gaming',
    description: 'Lekki, ale czytelny nad grą: krótkie wejście, mocniejsze tło, większa czcionka.',
    appearance: { entryAnimation: 'bottom', effect: 'none', intensity: 'subtle', animationDurationMs: 180, messageSpacingPx: 2, compact: false, backgroundIntensity: 160 },
    fontDelta: 1,
    gaming: { lifetimeSec: 8, maxVisible: 4 }
  },
  obs: {
    label: 'OBS',
    description: 'Pod scenę streamu: wejście od dołu, błysk, czytelne tło.',
    appearance: { entryAnimation: 'bottom', effect: 'pulse', intensity: 'normal', animationDurationMs: 260, messageSpacingPx: 3, compact: false, backgroundIntensity: 120 },
    fontDelta: 0,
    gaming: { lifetimeSec: 15, maxVisible: 6 }
  }
}

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[]

function scopeDefaultFont(scope: PresetScope): number {
  if (scope === 'common') return DEFAULT_CHAT_APPEARANCE.fontSizePx
  return DEFAULT_APPEARANCE.overrides[scope].fontSizePx ?? DEFAULT_CHAT_APPEARANCE.fontSizePx
}

function scopedValues(appearance: AppearanceSettings, scope: PresetScope): ChatAppearance {
  return scope === 'common' ? appearance.common : resolveAppearance(appearance, scope)
}

export interface PresetResult {
  appearance: AppearanceSettings
  /** Zmiany Gaming Overlay - tylko przy zakresie "gaming". */
  gaming?: Pick<GamingOverlaySettings, 'lifetimeSec' | 'maxVisible'>
}

export function applyPreset(appearance: AppearanceSettings, scope: PresetScope, id: PresetId): PresetResult {
  const preset = PRESETS[id]
  let next = appearance
  for (const [key, value] of Object.entries(preset.appearance) as [keyof PresetFields, never][]) {
    next = setAppearanceValue(next, scope, key, value)
  }
  next = setAppearanceValue(next, scope, 'fontSizePx', scopeDefaultFont(scope) + preset.fontDelta)
  return scope === 'gaming' ? { appearance: next, gaming: { ...preset.gaming } } : { appearance: next }
}

export function detectPreset(appearance: AppearanceSettings, scope: PresetScope, gaming?: Pick<GamingOverlaySettings, 'lifetimeSec' | 'maxVisible'>): PresetState {
  const values = scopedValues(appearance, scope)
  for (const id of PRESET_IDS) {
    const preset = PRESETS[id]
    const same =
      (Object.entries(preset.appearance) as [keyof PresetFields, unknown][]).every(([key, value]) => values[key] === value) &&
      values.fontSizePx === scopeDefaultFont(scope) + preset.fontDelta &&
      (scope !== 'gaming' || !gaming || (gaming.lifetimeSec === preset.gaming.lifetimeSec && gaming.maxVisible === preset.gaming.maxVisible))
    if (same) return id
  }
  return 'custom'
}

/** Pola sekcji "Wygląd" i "Animacje" - do przycisków "Przywróć domyślne" danej sekcji. */
export const APPEARANCE_SECTION_FIELDS: readonly (keyof ChatAppearance)[] = [
  'fontSizePx',
  'emoteScale',
  'badgeScale',
  'iconSizePx',
  'showBadges',
  'showTimestamps',
  'stackAnchor',
  'newMessagePosition',
  'messageSpacingPx',
  'borderRadiusPx',
  'compact',
  'width',
  'backgroundsEnabled',
  'backgroundIntensity'
]
export const ANIMATION_SECTION_FIELDS: readonly (keyof ChatAppearance)[] = ['entryAnimation', 'effect', 'intensity', 'animationDurationMs']

/**
 * Przywraca wartości domyślne wybranych pól w danym zakresie: dla ustawień wspólnych - wartości
 * domyślne aplikacji, dla czatu/OBS/Gaming - domyślne nadpisania tego miejsca (np. OBS: większa
 * czcionka, układ od dołu). Pozostałe pola zostają bez zmian.
 */
export function resetAppearanceFields(appearance: AppearanceSettings, scope: PresetScope, fields: readonly (keyof ChatAppearance)[]): AppearanceSettings {
  if (scope === 'common') {
    const common = { ...appearance.common }
    for (const key of fields) (common as Record<string, unknown>)[key] = DEFAULT_CHAT_APPEARANCE[key]
    return { ...appearance, common }
  }
  const override: Partial<ChatAppearance> = { ...appearance.overrides[scope] }
  const defaults = DEFAULT_APPEARANCE.overrides[scope]
  for (const key of fields) {
    if (key in defaults) (override as Record<string, unknown>)[key] = defaults[key]
    else delete override[key]
  }
  return { ...appearance, overrides: { ...appearance.overrides, [scope]: override } }
}

export function resetPlatformColors(appearance: AppearanceSettings): AppearanceSettings {
  return { ...appearance, platformColors: structuredClone(DEFAULT_PLATFORM_COLORS) }
}

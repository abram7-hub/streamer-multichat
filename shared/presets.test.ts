import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, resolveAppearance, setAppearanceValue } from './appearance'
import {
  ANIMATION_SECTION_FIELDS,
  APPEARANCE_SECTION_FIELDS,
  applyPreset,
  detectPreset,
  PRESET_IDS,
  PRESETS,
  resetAppearanceFields,
  resetPlatformColors
} from './presets'
import { DEFAULT_SETTINGS } from './settings'

describe('appearance presets', () => {
  it('each preset is recognised after applying it, in every scope', () => {
    for (const scope of ['main', 'obs', 'gaming', 'common'] as const) {
      for (const id of PRESET_IDS) {
        const result = applyPreset(DEFAULT_APPEARANCE, scope, id)
        expect(detectPreset(result.appearance, scope, result.gaming)).toBe(id)
      }
    }
  })

  it('sets animations, intensity, spacing, compact, background and font size for the scope', () => {
    const { appearance } = applyPreset(DEFAULT_APPEARANCE, 'obs', 'dynamic')
    expect(resolveAppearance(appearance, 'obs')).toMatchObject({ ...PRESETS.dynamic.appearance, fontSizePx: 21 })
    // Inne miejsca bez zmian.
    expect(resolveAppearance(appearance, 'main')).toEqual(resolveAppearance(DEFAULT_APPEARANCE, 'main'))
    // Układ OBS (od dołu) zostaje.
    expect(resolveAppearance(appearance, 'obs').stackAnchor).toBe('bottom')
  })

  it('a manual change afterwards turns the state into Custom', () => {
    const { appearance } = applyPreset(DEFAULT_APPEARANCE, 'main', 'smooth')
    expect(detectPreset(setAppearanceValue(appearance, 'main', 'messageSpacingPx', 7), 'main')).toBe('custom')
  })

  it('Performance is truly light: no entry animation, no pulse, no bounce, short duration', () => {
    const { appearance } = applyPreset(DEFAULT_APPEARANCE, 'main', 'performance')
    const v = resolveAppearance(appearance, 'main')
    expect(v.entryAnimation).toBe('none')
    expect(v.effect).toBe('none')
    expect(v.animationDurationMs).toBeLessThanOrEqual(150)
    expect(v.compact).toBe(true)
  })

  it('Gaming is light but more readable: no pulse/bounce, short entry, bigger font and background', () => {
    const { appearance, gaming } = applyPreset(DEFAULT_APPEARANCE, 'gaming', 'gaming')
    const v = resolveAppearance(appearance, 'gaming')
    expect(v.effect).toBe('none')
    expect(v.animationDurationMs).toBeLessThanOrEqual(200)
    expect(v.fontSizePx).toBeGreaterThan(resolveAppearance(DEFAULT_APPEARANCE, 'gaming').fontSizePx)
    expect(v.backgroundIntensity).toBeGreaterThan(100)
    // Czas życia wiadomości tylko dla Gaming Overlay.
    expect(gaming).toEqual(PRESETS.gaming.gaming)
    expect(applyPreset(DEFAULT_APPEARANCE, 'main', 'gaming').gaming).toBeUndefined()
  })

  it('touches only appearance - never channels, tokens, blacklist or integrations', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      twitch: { ...DEFAULT_SETTINGS.twitch, channelLogin: 'kanal', clientId: 'id' },
      ignoreLists: { ...DEFAULT_SETTINGS.ignoreLists, twitch: { enabled: true, users: [{ username: 'bot' }] } }
    }
    const result = applyPreset(settings.appearance, 'main', 'minimal')
    expect(Object.keys(result)).toEqual(['appearance'])
    const next = { ...settings, appearance: result.appearance }
    expect(next.twitch).toBe(settings.twitch)
    expect(next.ignoreLists).toBe(settings.ignoreLists)
  })
})

describe('section reset', () => {
  it('Appearance reset restores the scope defaults (OBS keeps its own default layout and font)', () => {
    let a = setAppearanceValue(DEFAULT_APPEARANCE, 'obs', 'fontSizePx', 33)
    a = setAppearanceValue(a, 'obs', 'stackAnchor', 'top')
    a = setAppearanceValue(a, 'obs', 'effect', 'bounce')
    const reset = resetAppearanceFields(a, 'obs', APPEARANCE_SECTION_FIELDS)
    expect(resolveAppearance(reset, 'obs')).toMatchObject({ fontSizePx: 20, stackAnchor: 'bottom', effect: 'bounce' })
  })

  it('Animations reset leaves appearance fields alone', () => {
    let a = setAppearanceValue(DEFAULT_APPEARANCE, 'main', 'entryAnimation', 'left')
    a = setAppearanceValue(a, 'main', 'fontSizePx', 22)
    const reset = resetAppearanceFields(a, 'main', ANIMATION_SECTION_FIELDS)
    expect(resolveAppearance(reset, 'main')).toMatchObject({ entryAnimation: 'none', fontSizePx: 22 })
  })

  it('common scope resets to the app defaults; platform colours reset separately', () => {
    const a = setAppearanceValue(DEFAULT_APPEARANCE, 'common', 'messageSpacingPx', 9)
    expect(resetAppearanceFields(a, 'common', APPEARANCE_SECTION_FIELDS).common).toEqual(DEFAULT_APPEARANCE.common)
    const colored = { ...a, platformColors: { ...a.platformColors, kick: { background: '#000000', backgroundOpacity: 50, accent: '#000000' } } }
    const reset = resetPlatformColors(colored)
    expect(reset.platformColors).toEqual(DEFAULT_APPEARANCE.platformColors)
    expect(reset.common.messageSpacingPx).toBe(9)
  })
})

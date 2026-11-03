import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import type { UserSecretKey } from '../../shared/ipc'
import { isValidSecretInput, sanitizeSettingsPatch } from './ipc-validation'

describe('sanitizeSettingsPatch', () => {
  it('keeps known sections and flags with the expected kind of value', () => {
    const patch = {
      demoMode: true,
      ui: { ...DEFAULT_SETTINGS.ui, fontSizePx: 18 },
      watchedChannels: [{ id: '1', platform: 'twitch' as const, channel: 'x', enabled: true }]
    }
    expect(sanitizeSettingsPatch(patch)).toEqual(patch)
  })

  it('drops unknown keys, wrongly typed values and prototype tricks', () => {
    const result = sanitizeSettingsPatch(
      JSON.parse('{"__proto__": {"polluted": true}, "unknown": 1, "demoMode": "yes", "ui": [], "watchedChannels": {}, "twitch": null, "firstRunComplete": true}')
    )
    expect(result).toEqual({ firstRunComplete: true })
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it('never accepts schemaVersion from the renderer', () => {
    expect(sanitizeSettingsPatch({ schemaVersion: 1, demoMode: true })).toEqual({ demoMode: true })
  })

  it('normalizes the appearance section (unknown fields dropped, values clamped, colours validated)', () => {
    const result = sanitizeSettingsPatch({
      appearance: {
        common: { fontSizePx: 999, entryAnimation: 'teleport' },
        overrides: { main: { effect: 'bounce', injected: '<script>' } },
        platformColors: { twitch: { background: 'url(x)', backgroundOpacity: 20, accent: '#00ff00' } }
      }
    })
    expect(result.appearance?.common.fontSizePx).toBe(40)
    expect(result.appearance?.common.entryAnimation).toBe('none')
    expect(result.appearance?.overrides.main).toEqual({ effect: 'bounce' })
    expect(result.appearance?.platformColors.twitch).toEqual({ background: '#9146FF', backgroundOpacity: 20, accent: '#00ff00' })
  })

  it('returns an empty patch for non-object input', () => {
    for (const input of [undefined, null, 'x', 42, [], true]) expect(sanitizeSettingsPatch(input)).toEqual({})
  })
})

describe('isValidSecretInput', () => {
  const allowed: UserSecretKey[] = ['youtube.apiKey', 'tiktok.eulerApiKey']

  it('accepts an allowed key with a string value', () => {
    expect(isValidSecretInput({ key: 'youtube.apiKey', value: 'abc' }, allowed)).toBe(true)
    expect(isValidSecretInput({ key: 'tiktok.eulerApiKey', value: '' }, allowed)).toBe(true)
  })

  it('rejects other keys, non-string values and oversized values', () => {
    expect(isValidSecretInput({ key: 'twitch.accessToken', value: 'abc' }, allowed)).toBe(false)
    expect(isValidSecretInput({ key: 'youtube.apiKey', value: 123 }, allowed)).toBe(false)
    expect(isValidSecretInput({ key: 'youtube.apiKey', value: 'x'.repeat(5000) }, allowed)).toBe(false)
    expect(isValidSecretInput(null, allowed)).toBe(false)
    expect(isValidSecretInput('youtube.apiKey', allowed)).toBe(false)
  })
})

describe('sanitizeSettingsPatch - Gaming Overlay', () => {
  it('validates the section and never lets the renderer overwrite the saved position/monitor', () => {
    const result = sanitizeSettingsPatch({
      gaming: { enabled: true, lifetimeSec: -5, editHotkey: 'notakey', bounds: { x: -99999, y: 0, width: 1, height: 1 }, displayId: 99 }
    })
    expect(result.gaming).toMatchObject({ enabled: true, lifetimeSec: 0, editHotkey: 'CommandOrControl+Alt+Shift+G' })
    expect(result.gaming).not.toHaveProperty('bounds')
    expect(result.gaming).not.toHaveProperty('displayId')
  })
})

describe('sanitizeSettingsPatch - mentions', () => {
  it('normalizes keywords, colours and the custom sound', () => {
    const result = sanitizeSettingsPatch({
      mentions: { ...DEFAULT_SETTINGS.mentions, keywords: [' gg ', 'GG', '', 7], highlight: { background: 'expression(x)' }, sound: { customData: 'file:///C:/a.mp3', customName: 'a.mp3' } }
    })
    expect(result.mentions?.keywords).toEqual(['gg'])
    expect(result.mentions?.highlight.background).toBe(DEFAULT_SETTINGS.mentions.highlight.background)
    expect(result.mentions?.sound).toMatchObject({ customData: '', customName: '' })
  })
})

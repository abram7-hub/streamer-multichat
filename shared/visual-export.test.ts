import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AppSettings } from './settings'
import { normalizeSettings } from './settings-migration'
import { buildVisualExport, parseVisualImport, VISUAL_EXPORT_FORMAT, VISUAL_EXPORT_SCHEMA_VERSION } from './visual-export'

/** Ustawienia z "prawdziwymi" danymi, które nie mogą trafić do eksportu. */
function userSettings(): AppSettings {
  const s = normalizeSettings({})
  return {
    ...s,
    twitch: { ...s.twitch, channelLogin: 'moj_kanal', clientId: 'twitch-client-id-123' },
    kick: { ...s.kick, channelSlug: 'kick-kanal', clientId: 'kick-client-id-456', webhookUrl: 'https://tunel.example.com/hook' },
    youtube: { ...s.youtube, channelHandle: '@yt_handle', clientId: 'yt-client-id-789' },
    tiktok: { ...s.tiktok, uniqueId: 'tt_user' },
    overlay: { ...s.overlay, port: 48123, backgroundOpacity: 35 },
    ui: { ...s.ui, highlightNick: 'tajny_nick', windowX: 100 },
    ignoreLists: { ...s.ignoreLists, twitch: { enabled: true, users: [{ username: 'spam_bot', id: '42' }] } },
    watchedChannels: [{ id: 'w', platform: 'kick', channel: 'obserwowany', enabled: true }],
    gaming: { ...s.gaming, enabled: true, editHotkey: 'Ctrl+Alt+F9', lifetimeSec: 30, bounds: { x: 1, y: 2, width: 300, height: 200 }, displayId: 7 },
    mentions: {
      ...s.mentions,
      keywords: ['prywatna fraza'],
      highlight: { ...s.mentions.highlight, background: '#123456' },
      sound: { ...s.mentions.sound, enabled: true, customData: 'data:audio/mpeg;base64,AAAA', customName: 'moj-dzwiek.mp3' }
    }
  }
}

describe('visual settings export', () => {
  it('contains only visual settings, with a format marker and schemaVersion', () => {
    const data = buildVisualExport(userSettings())
    expect(data.format).toBe(VISUAL_EXPORT_FORMAT)
    expect(data.schemaVersion).toBe(VISUAL_EXPORT_SCHEMA_VERSION)
    expect(Object.keys(data).sort()).toEqual(['appearance', 'format', 'gaming', 'mentions', 'overlay', 'schemaVersion'])
    expect(data.overlay).toEqual({ backgroundOpacity: 35 })
    expect(data.mentions).toEqual({ highlight: expect.objectContaining({ background: '#123456' }) })
    expect(data.gaming.lifetimeSec).toBe(30)
  })

  it('never contains tokens, client ids, channels, blacklist, hotkeys, positions, paths or the custom sound', () => {
    const json = JSON.stringify(buildVisualExport(userSettings()))
    for (const secret of [
      'moj_kanal',
      'twitch-client-id-123',
      'kick-client-id-456',
      'yt-client-id-789',
      'tunel.example.com',
      '@yt_handle',
      'tt_user',
      'kick-kanal',
      'obserwowany',
      'spam_bot',
      'tajny_nick',
      'prywatna fraza',
      'moj-dzwiek',
      'data:audio',
      'Ctrl+Alt+F9',
      '48123'
    ]) {
      expect(json).not.toContain(secret)
    }
    expect(json).not.toMatch(/token|secret|apiKey|clientId|password|cookie|bounds|displayId|userData|[A-Z]:\\\\/i)
  })
})

describe('visual settings import', () => {
  const exported = (): Record<string, any> => JSON.parse(JSON.stringify(buildVisualExport(userSettings())))

  it('round trip: export -> import into fresh settings restores the look', () => {
    const fresh = normalizeSettings({})
    const result = parseVisualImport(JSON.stringify(exported()), fresh)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.appearance).toEqual(userSettings().appearance)
    expect(result.patch.overlay.backgroundOpacity).toBe(35)
    expect(result.patch.gaming.lifetimeSec).toBe(30)
    expect(result.patch.mentions.highlight.background).toBe('#123456')
  })

  it('never overwrites secrets, channels, blacklist, hotkey, position, keywords or sound', () => {
    const current = userSettings()
    const file = exported()
    // Ktoś dopisał do pliku dane, których import nie może przyjąć.
    file['twitch'] = { channelLogin: 'przejety', clientId: 'zly' }
    file['ignoreLists'] = { twitch: { enabled: false, users: [] } }
    file['secrets'] = { 'twitch.accessToken': 'x' }
    file['gaming'] = { ...file['gaming'], enabled: false, editHotkey: 'F1', bounds: { x: 0, y: 0, width: 1, height: 1 }, displayId: 1 }
    file['mentions'] = { ...file['mentions'], keywords: ['podmienione'], sound: { enabled: false, customData: 'data:audio/wav;base64,BBBB' } }
    file['overlay'] = { backgroundOpacity: 10, port: 1 }
    const result = parseVisualImport(JSON.stringify(file), current)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.patch).sort()).toEqual(['appearance', 'gaming', 'mentions', 'overlay'])
    expect(result.patch.overlay).toEqual({ ...current.overlay, backgroundOpacity: 10 })
    expect(result.patch.gaming).toMatchObject({ enabled: true, editHotkey: 'Ctrl+Alt+F9', bounds: current.gaming.bounds, displayId: 7 })
    expect(result.patch.mentions.keywords).toEqual(['prywatna fraza'])
    expect(result.patch.mentions.sound).toEqual(current.mentions.sound)
  })

  it('ignores unknown fields and normalizes invalid values instead of failing', () => {
    const file = exported()
    file['appearance'].common.fontSizePx = 9999
    file['appearance'].common.injected = '<script>'
    file['appearance'].platformColors.twitch.background = 'url(javascript:x)'
    file['gaming'].maxVisible = -3
    file['mentions'].highlight.border = 'red; background: url(x)'
    file['futureFeature'] = { a: 1 }
    const result = parseVisualImport(JSON.stringify(file), userSettings())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.appearance.common.fontSizePx).toBe(40)
    expect(result.patch.appearance.common).not.toHaveProperty('injected')
    expect(result.patch.appearance.platformColors.twitch.background).toBe(DEFAULT_SETTINGS.appearance.platformColors.twitch.background)
    expect(result.patch.gaming.maxVisible).toBeGreaterThanOrEqual(1)
    expect(result.patch.mentions.highlight.border).toBe(DEFAULT_SETTINGS.mentions.highlight.border)
  })

  it('invalid JSON or a different file gives a readable error, not a crash', () => {
    const s = userSettings()
    for (const text of ['', '{', 'null', '[]', '42', '"tekst"', '{"twitch":{}}']) {
      const result = parseVisualImport(text, s)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.length).toBeGreaterThan(5)
    }
    const bad = parseVisualImport('{nie json', s)
    expect(bad).toEqual({ ok: false, error: 'To nie jest poprawny plik JSON.' })
  })

  it('schemaVersion is required; a newer version is refused with a clear message', () => {
    const s = userSettings()
    const file = exported()
    delete file['schemaVersion']
    expect(parseVisualImport(JSON.stringify(file), s).ok).toBe(false)
    file['schemaVersion'] = VISUAL_EXPORT_SCHEMA_VERSION + 1
    const newer = parseVisualImport(JSON.stringify(file), s)
    expect(newer.ok).toBe(false)
    if (!newer.ok) expect(newer.error).toMatch(/nowszej wersji/)
    file['schemaVersion'] = 'abc'
    expect(parseVisualImport(JSON.stringify(file), s).ok).toBe(false)
  })

  it('an oversized file is refused before parsing', () => {
    const result = parseVisualImport(' '.repeat(300 * 1024), userSettings())
    expect(result.ok).toBe(false)
  })
})

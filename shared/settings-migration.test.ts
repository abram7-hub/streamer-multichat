import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, resolveAppearance } from './appearance'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from './settings'
import { migrateSettings, normalizeSettings, storeDefaults } from './settings-migration'

/** Plik config.json zapisany przez v1.0.x (schema 1, bez `appearance`). */
function v1Config(): Record<string, unknown> {
  return {
    firstRunComplete: true,
    demoMode: true,
    twitch: { ...DEFAULT_SETTINGS.twitch, channelLogin: 'some_channel', clientId: 'abc' },
    kick: { ...DEFAULT_SETTINGS.kick, channelSlug: 'kick-channel', enabled: true },
    youtube: { ...DEFAULT_SETTINGS.youtube, channelHandle: '@handle' },
    tiktok: { enabled: true, uniqueId: 'tt_user' },
    overlay: {
      port: 48000,
      maxMessages: 40,
      fontSizePx: 24,
      backgroundOpacity: 30,
      showBadges: false,
      animationsEnabled: false,
      enabledPlatforms: ['twitch', 'kick'],
      messageBackgroundsEnabled: true,
      messageBackgroundIntensity: 20,
      lowResourceMode: true
    },
    ui: {
      fontSizePx: 17,
      windowWidth: 500,
      windowHeight: 800,
      enabledPlatforms: ['twitch'],
      autoScroll: true,
      highlightNick: 'me',
      showTimestamps: false,
      messageBackgroundsEnabled: false,
      messageBackgroundIntensity: 10,
      pulseNewMessages: false,
      lowResourceMode: true
    },
    ignoreLists: { twitch: { enabled: true, users: [{ username: 'spam_bot', id: '42' }] } },
    watchedChannels: [{ id: 'w1', platform: 'kick', channel: 'other', enabled: true }]
  }
}

describe('migration from v1.0.x settings', () => {
  it('moves the old appearance fields into Main Chat / OBS overrides', () => {
    const s = normalizeSettings(v1Config())
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(resolveAppearance(s.appearance, 'main')).toMatchObject({
      fontSizePx: 17,
      showTimestamps: false,
      backgroundsEnabled: false,
      effect: 'none',
      stackAnchor: 'top',
      newMessagePosition: 'end'
    })
    expect(resolveAppearance(s.appearance, 'obs')).toMatchObject({
      fontSizePx: 24,
      showBadges: false,
      effect: 'none',
      backgroundsEnabled: true,
      backgroundIntensity: 200, // 20% krycia przy domyślnym kryciu platformy 10% -> mnożnik 200%
      stackAnchor: 'bottom',
      newMessagePosition: 'anchor'
    })
  })

  it('keeps channels, blacklist, OAuth client ids, OBS port, Demo Mode and other options', () => {
    const s = normalizeSettings(v1Config())
    expect(s.twitch).toMatchObject({ channelLogin: 'some_channel', clientId: 'abc' })
    expect(s.kick).toMatchObject({ channelSlug: 'kick-channel', enabled: true })
    expect(s.youtube.channelHandle).toBe('@handle')
    expect(s.tiktok.uniqueId).toBe('tt_user')
    expect(s.ignoreLists.twitch.users).toEqual([{ username: 'spam_bot', id: '42' }])
    expect(s.ignoreLists.kick).toEqual(DEFAULT_SETTINGS.ignoreLists.kick)
    expect(s.watchedChannels).toHaveLength(1)
    expect(s.overlay).toMatchObject({ port: 48000, maxMessages: 40, backgroundOpacity: 30, enabledPlatforms: ['twitch', 'kick'], lowResourceMode: true })
    expect(s.ui).toMatchObject({ highlightNick: 'me', lowResourceMode: true, windowWidth: 500 })
    expect(s.demoMode).toBe(true)
    expect(s.firstRunComplete).toBe(true)
  })

  it('leaves the v1 fields in the file so v1.0.x can still read them after a rollback', () => {
    const migrated = migrateSettings(v1Config()) as Record<string, any>
    expect(migrated['ui'].fontSizePx).toBe(17)
    expect(migrated['overlay'].showBadges).toBe(false)
  })

  it('a default v1.0.x config migrates to the default appearance', () => {
    const { schemaVersion: _v, appearance: _a, ...v1Defaults } = DEFAULT_SETTINGS
    const legacy = { ...v1Defaults, ui: { ...v1Defaults.ui, fontSizePx: 15, showTimestamps: true, messageBackgroundsEnabled: true, messageBackgroundIntensity: 10, pulseNewMessages: true } }
    expect(normalizeSettings(legacy).appearance).toEqual({ ...DEFAULT_APPEARANCE, overrides: { ...DEFAULT_APPEARANCE.overrides, obs: DEFAULT_APPEARANCE.overrides.obs } })
  })

  it('current settings are returned unchanged (same object) - no write on every start', () => {
    const current = normalizeSettings(v1Config())
    expect(migrateSettings(current)).toBe(current)
  })

  it('store defaults do not contain schemaVersion/appearance, so an old file is still detected as v1', () => {
    const defaults = storeDefaults() as Record<string, unknown>
    expect(defaults['schemaVersion']).toBeUndefined()
    expect(defaults['appearance']).toBeUndefined()
  })
})

describe('save and load after restart', () => {
  it('settings written to config.json read back identically', () => {
    let s = normalizeSettings(v1Config())
    s = {
      ...s,
      appearance: {
        ...s.appearance,
        overrides: { ...s.appearance.overrides, main: { ...s.appearance.overrides.main, entryAnimation: 'right', effect: 'pulse-bounce', intensity: 'strong' } }
      }
    }
    const fromDisk = JSON.parse(JSON.stringify(s)) as object
    const restarted = normalizeSettings(fromDisk)
    expect(restarted).toEqual(s)
    expect(resolveAppearance(restarted.appearance, 'main')).toMatchObject({ entryAnimation: 'right', effect: 'pulse-bounce', intensity: 'strong' })
  })

  it('a damaged appearance section falls back to defaults instead of breaking the app', () => {
    const s = normalizeSettings({ ...normalizeSettings({}), appearance: 'broken' })
    expect(s.appearance).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('Gaming Overlay settings (schema 3)', () => {
  /** Plik z etapu 1 wersji 1.1 (schema 2): wygląd już w nowym modelu, bez sekcji `gaming`. */
  function v2Config(gamingOverride: Record<string, unknown> = {}): Record<string, unknown> {
    const s = normalizeSettings(v1Config()) as unknown as Record<string, any>
    const { gaming: _gaming, ...rest } = s
    return {
      ...rest,
      schemaVersion: 2,
      appearance: { ...s['appearance'], overrides: { ...s['appearance'].overrides, main: { fontSizePx: 13 }, gaming: gamingOverride } }
    }
  }

  it('v2 -> v3: adds Gaming Overlay defaults, keeps everything else', () => {
    const s = normalizeSettings(v2Config())
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(s.gaming).toEqual(DEFAULT_SETTINGS.gaming)
    expect(s.appearance.overrides.main).toEqual({ fontSizePx: 13 })
    expect(s.appearance.overrides.gaming).toEqual(DEFAULT_APPEARANCE.overrides.gaming)
    expect(s.twitch.channelLogin).toBe('some_channel')
    expect(s.ignoreLists.twitch.users).toHaveLength(1)
  })

  it('a gaming appearance override the user already had is not overwritten', () => {
    const s = normalizeSettings(v2Config({ fontSizePx: 22 }))
    expect(s.appearance.overrides.gaming).toEqual({ fontSizePx: 22 })
  })

  it('v1 goes through both steps', () => {
    const s = normalizeSettings(v1Config())
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(s.gaming.enabled).toBe(false)
    expect(resolveAppearance(s.appearance, 'gaming')).toMatchObject({ stackAnchor: 'bottom', showTimestamps: false })
  })

  it('Gaming Overlay settings and its own appearance survive a restart', () => {
    let s = normalizeSettings(v2Config())
    s = {
      ...s,
      gaming: { ...s.gaming, enabled: true, lifetimeSec: 30, maxVisible: 3, textOutline: true, bounds: { x: 2000, y: 100, width: 400, height: 300 }, displayId: 2 },
      appearance: { ...s.appearance, overrides: { ...s.appearance.overrides, gaming: { ...s.appearance.overrides.gaming, effect: 'bounce', intensity: 'strong' } } }
    }
    const restarted = normalizeSettings(JSON.parse(JSON.stringify(s)) as object)
    expect(restarted).toEqual(s)
    expect(resolveAppearance(restarted.appearance, 'gaming')).toMatchObject({ effect: 'bounce', intensity: 'strong' })
  })
})

describe('mentions and chat usability settings (schema 4)', () => {
  /** Plik z etapu Gaming Overlay (schema 3): bez sekcji `mentions` i bez `ui.pauseOnHover`. */
  function v3Config(): Record<string, unknown> {
    const s = normalizeSettings(v1Config()) as unknown as Record<string, any>
    const { mentions: _mentions, ...rest } = s
    const { pauseOnHover: _p, ...ui } = s['ui']
    return {
      ...rest,
      schemaVersion: 3,
      ui,
      gaming: { ...s['gaming'], enabled: true, bounds: { x: 10, y: 20, width: 400, height: 300 }, displayId: 2 },
      appearance: { ...s['appearance'], overrides: { ...s['appearance'].overrides, gaming: {} } }
    }
  }

  it('v3 -> v4: adds mention defaults (sound OFF) and pause-on-hover OFF, keeps everything else', () => {
    const s = normalizeSettings(v3Config())
    expect(s.schemaVersion).toBe(4)
    expect(s.mentions).toEqual(DEFAULT_SETTINGS.mentions)
    expect(s.mentions.sound.enabled).toBe(false)
    expect(s.ui.pauseOnHover).toBe(false)
    expect(s.ui.highlightNick).toBe('me')
    expect(s.twitch.channelLogin).toBe('some_channel')
    expect(s.ignoreLists.twitch.users).toHaveLength(1)
    expect(s.gaming).toMatchObject({ enabled: true, bounds: { x: 10, y: 20, width: 400, height: 300 }, displayId: 2 })
    // Krok 2 -> 3 nie jest powtarzany: pusty override gaming użytkownika zostaje pusty.
    expect(s.appearance.overrides.gaming).toEqual({})
  })

  it('mention settings survive a restart', () => {
    let s = normalizeSettings(v3Config())
    s = {
      ...s,
      ui: { ...s.ui, pauseOnHover: true },
      mentions: { ...s.mentions, keywords: ['C++', '[TEST]'], wholeWord: false, highlight: { ...s.mentions.highlight, strongerBounce: true }, sound: { ...s.mentions.sound, enabled: true, volume: 40 } }
    }
    const restarted = normalizeSettings(JSON.parse(JSON.stringify(s)) as object)
    expect(restarted).toEqual(s)
  })

  it('a damaged mentions section falls back to defaults', () => {
    const s = normalizeSettings({ ...normalizeSettings({}), mentions: 'broken' })
    expect(s.mentions).toEqual(DEFAULT_SETTINGS.mentions)
  })
})

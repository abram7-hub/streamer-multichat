import { describe, expect, it } from 'vitest'
import {
  appearanceCssVars,
  appearanceDataAttributes,
  chatLayout,
  clearAppearanceOverride,
  DEFAULT_APPEARANCE,
  DEFAULT_CHAT_APPEARANCE,
  DEFAULT_PLATFORM_COLORS,
  normalizeAppearance,
  platformBackground,
  resetPlatformColor,
  resolveAppearance,
  setAppearanceValue,
  setPlatformColor,
  type ChatAppearance
} from './appearance'

describe('chatLayout - four message orders from two settings', () => {
  it.each([
    ['A: first on top, next below', 'top', 'end', false, 'flex-start'],
    ['B: first at the bottom, next above', 'bottom', 'end', true, 'safe flex-end'],
    ['C: newest always on top, older move down', 'top', 'anchor', true, 'flex-start'],
    ['D: newest always at the bottom, older move up', 'bottom', 'anchor', false, 'safe flex-end']
  ] as const)('%s', (_name, stackAnchor, newMessagePosition, newestFirst, justifyContent) => {
    expect(chatLayout({ stackAnchor, newMessagePosition })).toEqual({ newestFirst, justifyContent })
  })

  it('defaults: main chat uses A, OBS uses D (the previous behaviour of both)', () => {
    expect(chatLayout(resolveAppearance(DEFAULT_APPEARANCE, 'main'))).toEqual({ newestFirst: false, justifyContent: 'flex-start' })
    expect(chatLayout(resolveAppearance(DEFAULT_APPEARANCE, 'obs'))).toEqual({ newestFirst: false, justifyContent: 'safe flex-end' })
  })
})

describe('defaults + overrides', () => {
  it('Main Chat and OBS resolve to different values without copying the whole object', () => {
    expect(resolveAppearance(DEFAULT_APPEARANCE, 'main').fontSizePx).toBe(15)
    expect(resolveAppearance(DEFAULT_APPEARANCE, 'obs').fontSizePx).toBe(20)
    expect(resolveAppearance(DEFAULT_APPEARANCE, 'gaming')).toEqual({
      ...DEFAULT_CHAT_APPEARANCE,
      fontSizePx: 16,
      showTimestamps: false,
      stackAnchor: 'bottom',
      newMessagePosition: 'anchor',
      entryAnimation: 'bottom'
    })
  })

  it('a main override does not change OBS, and an OBS override does not change main', () => {
    let s = setAppearanceValue(DEFAULT_APPEARANCE, 'main', 'entryAnimation', 'left')
    s = setAppearanceValue(s, 'obs', 'effect', 'pulse-bounce')
    expect(resolveAppearance(s, 'main')).toMatchObject({ entryAnimation: 'left', effect: 'pulse' })
    expect(resolveAppearance(s, 'obs')).toMatchObject({ entryAnimation: 'none', effect: 'pulse-bounce' })
  })

  it('a common change applies everywhere except where a target has its own value', () => {
    const s = setAppearanceValue(DEFAULT_APPEARANCE, 'common', 'fontSizePx', 17)
    expect(resolveAppearance(s, 'main').fontSizePx).toBe(17)
    expect(resolveAppearance(s, 'obs').fontSizePx).toBe(20)
  })

  it('clearing an override falls back to the common value', () => {
    const s = clearAppearanceOverride(DEFAULT_APPEARANCE, 'obs', 'fontSizePx')
    expect(resolveAppearance(s, 'obs').fontSizePx).toBe(DEFAULT_CHAT_APPEARANCE.fontSizePx)
    expect('fontSizePx' in s.overrides.obs).toBe(false)
  })

  it('numeric values are clamped to their limits', () => {
    expect(setAppearanceValue(DEFAULT_APPEARANCE, 'main', 'fontSizePx', 500).overrides.main.fontSizePx).toBe(40)
    expect(setAppearanceValue(DEFAULT_APPEARANCE, 'main', 'animationDurationMs', 1).overrides.main.animationDurationMs).toBe(120)
  })
})

describe('normalizeAppearance', () => {
  it('fills missing parts with defaults and drops invalid values', () => {
    const n = normalizeAppearance({
      common: { fontSizePx: 18, entryAnimation: 'spin', effect: 42, unknown: true },
      overrides: { obs: { compact: true, width: 'huge' } },
      platformColors: { twitch: { background: 'red', backgroundOpacity: 250, accent: '#123456' } }
    })
    expect(n.common).toEqual({ ...DEFAULT_CHAT_APPEARANCE, fontSizePx: 18 })
    expect(n.overrides.obs).toEqual({ compact: true })
    expect(n.overrides.main).toEqual({})
    expect(n.platformColors.twitch).toEqual({ background: DEFAULT_PLATFORM_COLORS.twitch.background, backgroundOpacity: 100, accent: '#123456' })
    expect(n.platformColors.kick).toEqual(DEFAULT_PLATFORM_COLORS.kick)
  })

  it('missing appearance -> defaults (including the OBS override)', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('platform colours', () => {
  it('custom colour, opacity and accent are used for the background and CSS variables', () => {
    const s = setPlatformColor(DEFAULT_APPEARANCE, 'kick', { background: '#000080', backgroundOpacity: 50, accent: '#ffcc00' })
    const vars = appearanceCssVars(resolveAppearance(s, 'main'), s.platformColors)
    expect(vars['--pc-kick-bg']).toBe('rgba(0, 0, 128, 0.500)')
    expect(vars['--pc-kick-accent']).toBe('#ffcc00')
    expect(vars['--pc-twitch-bg']).toBe('rgba(145, 70, 255, 0.100)')
  })

  it('invalid colours are ignored', () => {
    const s = setPlatformColor(DEFAULT_APPEARANCE, 'kick', { background: 'javascript:alert(1)' })
    expect(s.platformColors.kick.background).toBe(DEFAULT_PLATFORM_COLORS.kick.background)
  })

  it('reset restores the default colours of that platform only', () => {
    let s = setPlatformColor(DEFAULT_APPEARANCE, 'youtube', { background: '#111111' })
    s = setPlatformColor(s, 'tiktok', { accent: '#222222' })
    s = resetPlatformColor(s, 'youtube')
    expect(s.platformColors.youtube).toEqual(DEFAULT_PLATFORM_COLORS.youtube)
    expect(s.platformColors.tiktok.accent).toBe('#222222')
  })

  it('background intensity scales the platform opacity; backgrounds can be switched off', () => {
    const twitch = DEFAULT_PLATFORM_COLORS.twitch
    expect(platformBackground(twitch, { backgroundsEnabled: true, backgroundIntensity: 150 })).toBe('rgba(145, 70, 255, 0.150)')
    expect(platformBackground(twitch, { backgroundsEnabled: false, backgroundIntensity: 150 })).toBe('transparent')
  })
})

describe('animation settings -> container attributes and variables', () => {
  const with_ = (patch: Partial<ChatAppearance>): ChatAppearance => ({ ...DEFAULT_CHAT_APPEARANCE, ...patch })

  it.each(['none', 'left', 'right', 'bottom', 'expand'] as const)('entry animation "%s" is selected by data-enter', (entryAnimation) => {
    expect(appearanceDataAttributes(with_({ entryAnimation }))['data-enter']).toBe(entryAnimation)
  })

  it.each([
    ['none', 'none'],
    ['pulse', 'pulse'],
    ['bounce', 'bounce'],
    ['pulse-bounce', 'pulse-bounce']
  ] as const)('effect %s -> data-effect=%s (pulse and bounce can be switched on and off independently)', (effect, attr) => {
    expect(appearanceDataAttributes(with_({ effect }))['data-effect']).toBe(attr)
  })

  it('intensity changes pulse strength, bounce scale and entry distance', () => {
    const subtle = appearanceCssVars(with_({ intensity: 'subtle' }), DEFAULT_PLATFORM_COLORS)
    const normal = appearanceCssVars(with_({ intensity: 'normal' }), DEFAULT_PLATFORM_COLORS)
    const strong = appearanceCssVars(with_({ intensity: 'strong' }), DEFAULT_PLATFORM_COLORS)
    expect(normal['--bounce-up']).toBe('1.04')
    expect(normal['--bounce-down']).toBe('0.99')
    expect(Number(subtle['--bounce-up'])).toBeLessThan(Number(normal['--bounce-up']))
    expect(Number(strong['--bounce-up'])).toBeGreaterThan(Number(normal['--bounce-up']))
    expect(parseInt(subtle['--pulse-mix']!)).toBeLessThan(parseInt(strong['--pulse-mix']!))
    expect(parseInt(subtle['--enter-distance']!)).toBeLessThan(parseInt(strong['--enter-distance']!))
  })

  it('sizes, spacing, radius, compact and width reach the container', () => {
    const a = with_({ fontSizePx: 18, emoteScale: 200, badgeScale: 50, iconSizePx: 20, messageSpacingPx: 6, borderRadiusPx: 0, compact: true, width: 'fit' })
    const vars = appearanceCssVars(a, DEFAULT_PLATFORM_COLORS)
    expect(vars).toMatchObject({
      '--chat-font-size': '18px',
      '--emote-size': '3.2em',
      '--badge-size': '0.575em',
      '--icon-size': '20px',
      '--msg-gap': '6px',
      '--msg-radius': '0px'
    })
    expect(appearanceDataAttributes(a)).toMatchObject({ 'data-compact': 'true', 'data-width': 'fit' })
  })
})

import { describe, expect, it } from 'vitest'
import { platformMessageBackground, MESSAGE_BACKGROUND_BASE_COLORS } from './platform-style'
import { PLATFORMS } from './platform'

describe('platformMessageBackground', () => {
  it('produces a distinct rgba() background for every platform', () => {
    const colors = PLATFORMS.map((p) => platformMessageBackground(p, 10))
    expect(new Set(colors).size).toBe(PLATFORMS.length)
    for (const c of colors) expect(c).toMatch(/^rgba\(\d+, \d+, \d+, 0\.100\)$/)
  })

  it('uses a neutral gray for TikTok, distinct from its cyan brand/icon color', () => {
    expect(MESSAGE_BACKGROUND_BASE_COLORS.tiktok).toBe('#8A8A8E')
  })

  it('scales alpha with the intensity percentage', () => {
    expect(platformMessageBackground('twitch', 0)).toBe('rgba(145, 70, 255, 0.000)')
    expect(platformMessageBackground('twitch', 100)).toBe('rgba(145, 70, 255, 1.000)')
  })

  it('clamps out-of-range intensity to 0-100', () => {
    expect(platformMessageBackground('kick', -20)).toBe(platformMessageBackground('kick', 0))
    expect(platformMessageBackground('kick', 250)).toBe(platformMessageBackground('kick', 100))
  })
})

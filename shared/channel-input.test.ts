import { describe, expect, it } from 'vitest'
import { normalizeKickSlug, parseChannelInput, parseTikTokInput } from './channel-input'

describe('parseChannelInput', () => {
  it('accepts a plain channel name unchanged (lowercased)', () => {
    expect(parseChannelInput('Testnick_')).toBe('testnick_')
  })

  it('strips a leading @', () => {
    expect(parseChannelInput('@testnick_')).toBe('testnick_')
  })

  it('extracts the slug from a full Twitch URL', () => {
    expect(parseChannelInput('https://www.twitch.tv/testnick_')).toBe('testnick_')
  })

  it('extracts the slug from a full Kick URL', () => {
    expect(parseChannelInput('https://kick.com/testnick_')).toBe('testnick_')
  })

  it('extracts the slug from a bare domain without protocol', () => {
    expect(parseChannelInput('kick.com/testnick_')).toBe('testnick_')
  })

  it('ignores trailing query strings / paths', () => {
    expect(parseChannelInput('https://www.twitch.tv/testnick_/about?x=1')).toBe('testnick_')
  })

  it('returns an empty string for empty/whitespace input', () => {
    expect(parseChannelInput('   ')).toBe('')
  })
})

describe('normalizeKickSlug / parseTikTokInput', () => {
  it('Kick: underscores become dashes, URLs accepted', () => {
    expect(normalizeKickSlug('Test_Nick')).toBe('test-nick')
    expect(normalizeKickSlug('kick.com/Test_Nick')).toBe('test-nick')
  })

  it('TikTok: @name, plain name or profile/live URL; rejects garbage', () => {
    expect(parseTikTokInput('@Testnick_TTV')).toBe('testnick_ttv')
    expect(parseTikTokInput('testnick_ttv')).toBe('testnick_ttv')
    expect(parseTikTokInput('https://www.tiktok.com/@some.user/live')).toBe('some.user')
    expect(parseTikTokInput('ala ma kota')).toBe('')
    expect(parseTikTokInput('')).toBe('')
  })
})

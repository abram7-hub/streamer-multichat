import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  compileMentionMatcher,
  DEFAULT_MENTION_SETTINGS,
  escapeRegExp,
  mentionCssVars,
  mentionDataAttributes,
  MentionSoundThrottle,
  normalizeKeywords,
  normalizeMentionSettings,
  platformNicks,
  type MentionSettings
} from './mentions'
import type { ChatMessage } from './chat-message'
import type { Platform } from './platform'

const settings = (patch: Partial<MentionSettings> = {}): MentionSettings => ({ ...DEFAULT_MENTION_SETTINGS, ...patch })

function msg(rawText: string, platform: Platform = 'twitch', username = 'widz', event?: ChatMessage['event']): Pick<ChatMessage, 'platform' | 'rawText' | 'event' | 'author'> {
  return {
    platform,
    rawText,
    event,
    author: { id: 'u', username, displayName: username, badges: [], isBroadcaster: false, isModerator: false, isSubscriber: false }
  }
}

describe('auto-detected nick', () => {
  const nicks = platformNicks({
    twitch: { channelLogin: 'streamer_ttv' },
    kick: { channelSlug: '@streamer_kick' },
    youtube: { channelHandle: 'https://www.youtube.com/@streamer_youtube' },
    tiktok: { uniqueId: '' }
  })

  it('reads the nick from each platform setting (no "@", no URL)', () => {
    expect(nicks).toEqual({ twitch: 'streamer_ttv', kick: 'streamer_kick', youtube: 'streamer_youtube', tiktok: '' })
    // ID kanału YouTube (UC...) to nie nick.
    expect(platformNicks({ twitch: { channelLogin: '' }, kick: { channelSlug: '' }, youtube: { channelHandle: 'UC1234567890' }, tiktok: { uniqueId: '' } }).youtube).toBe('')
  })

  it('matches @nick and the bare nick, case-insensitively, on every platform', () => {
    const m = compileMentionMatcher(settings(), nicks)
    expect(m.matches(msg('hej @streamer_ttv co tam'))).toBe(true)
    expect(m.matches(msg('STREAMER_TTV gramy?'))).toBe(true)
    expect(m.matches(msg('@streamer_kick siema', 'kick'))).toBe(true)
    expect(m.matches(msg('@streamer_youtube super', 'youtube'))).toBe(true)
    // Wszystkie nicki należą do tego samego użytkownika - widz z Kicka może napisać nick z Twitcha.
    expect(m.matches(msg('streamer_ttv hej', 'kick'))).toBe(true)
    expect(m.matches(msg('@STREAMER_YOUTUBE gg', 'tiktok'))).toBe(true)
  })

  it('nick is always a whole word - no false positives inside longer words', () => {
    const m = compileMentionMatcher(settings({ wholeWord: false }), nicks)
    expect(m.matches(msg('streamer_ttvfan pisze'))).toBe(false)
    expect(m.matches(msg('xstreamer_ttv'))).toBe(false)
    expect(m.matches(msg('(streamer_ttv)'))).toBe(true)
  })

  it('auto nick can be switched off; detection as a whole can be switched off', () => {
    expect(compileMentionMatcher(settings({ autoNick: false }), nicks).matches(msg('@streamer_ttv'))).toBe(false)
    expect(compileMentionMatcher(settings({ enabled: false, keywords: ['gg'] }), nicks).matches(msg('@streamer_ttv gg'))).toBe(false)
  })

  it("the streamer's own messages and stream events are not mentions", () => {
    const m = compileMentionMatcher(settings({ keywords: ['raid'] }), nicks)
    expect(m.matches(msg('pozdro streamer_ttv', 'twitch', 'streamer_ttv'))).toBe(false)
    expect(m.matches(msg('raid streamer_ttv', 'twitch', 'widz', { kind: 'raid_in', source: 'irc' }))).toBe(false)
  })

  it('the extra nick from settings is matched on every platform', () => {
    const m = compileMentionMatcher(settings(), {}, '@drugi')
    for (const p of ['twitch', 'kick', 'youtube', 'tiktok'] as const) expect(m.matches(msg('hej drugi', p))).toBe(true)
  })
})

describe('custom keywords', () => {
  it('matches a custom phrase case-insensitively by default', () => {
    const m = compileMentionMatcher(settings({ keywords: ['Giveaway', 'gg wp'] }), {})
    expect(m.test('kiedy GIVEAWAY?')).toBe(true)
    expect(m.test('GG WP ekipa')).toBe(true)
    expect(m.test('nic tu nie ma')).toBe(false)
  })

  it('case-sensitive mode when chosen', () => {
    const m = compileMentionMatcher(settings({ keywords: ['Boss'], caseSensitive: true }), {})
    expect(m.test('ten Boss')).toBe(true)
    expect(m.test('ten boss')).toBe(false)
  })

  it('whole word on: no match inside longer words; off: substring match', () => {
    const whole = compileMentionMatcher(settings({ keywords: ['gra'] }), {})
    expect(whole.test('fajna gra!')).toBe(true)
    expect(whole.test('program')).toBe(false)
    expect(whole.test('grają')).toBe(false) // polskie litery też są częścią słowa
    const part = compileMentionMatcher(settings({ keywords: ['gra'], wholeWord: false }), {})
    expect(part.test('program')).toBe(true)
  })

  it('regex special characters are plain text: C++ A.B [TEST] (hej) *', () => {
    const m = compileMentionMatcher(settings({ keywords: ['C++', 'A.B', '[TEST]', '(hej)', '*'] }), {})
    expect(m.test('kto zna C++?')).toBe(true)
    expect(m.test('wersja A.B')).toBe(true)
    expect(m.test('to jest [TEST] czatu')).toBe(true)
    expect(m.test('no (hej) wszystkim')).toBe(true)
    expect(m.test('gwiazdka * tutaj')).toBe(true)
    // Bez escapowania "A.B" pasowałoby do "AxB", "[TEST]" do pojedynczej litery "T", "C++" rzuciłoby błąd.
    expect(m.test('AxB')).toBe(false)
    expect(m.test('T')).toBe(false)
    expect(m.test('C')).toBe(false)
    expect(m.test('zwykły tekst')).toBe(false)
  })

  it('whole word with phrases that start or end with a symbol', () => {
    const m = compileMentionMatcher(settings({ keywords: ['C++'] }), {})
    expect(m.test('C++ rządzi')).toBe(true)
    expect(m.test('lubię C++.')).toBe(true)
    expect(m.test('ObjC++')).toBe(false)
  })

  it('escapeRegExp escapes every special character', () => {
    const special = '.*+?^${}()|[]\\/'
    expect(new RegExp(escapeRegExp(special), 'u').test(special)).toBe(true)
  })
})

describe('settings normalization', () => {
  it('keyword list: trimmed, no empty entries, no duplicates (any case), limited', () => {
    expect(normalizeKeywords(['  gg ', '', '   ', 'GG', 'raid', 42, null, 'Raid'])).toEqual(['gg', 'raid'])
    expect(normalizeKeywords('nope')).toEqual([])
    expect(normalizeKeywords(Array.from({ length: 80 }, (_, i) => `k${i}`))).toHaveLength(50)
  })

  it('defaults: detection on, auto nick on, whole word on, case-insensitive, sound OFF', () => {
    const s = normalizeMentionSettings(undefined)
    expect(s).toEqual(DEFAULT_MENTION_SETTINGS)
    expect(s.sound.enabled).toBe(false)
    expect(s.caseSensitive).toBe(false)
  })

  it('invalid values fall back; custom sound keeps only a valid data URL and the bare file name', () => {
    const s = normalizeMentionSettings({
      highlight: { background: 'url(x)', backgroundOpacity: 999, border: '#00ff00' },
      sound: { enabled: true, volume: -5, cooldownSec: 9999, customData: 'data:audio/mpeg;base64,AAAA', customName: 'C:\\Users\\ktos\\Music\\ding.mp3' }
    })
    expect(s.highlight.background).toBe(DEFAULT_MENTION_SETTINGS.highlight.background)
    expect(s.highlight.backgroundOpacity).toBe(100)
    expect(s.highlight.border).toBe('#00ff00')
    expect(s.sound).toMatchObject({ enabled: true, volume: 0, cooldownSec: 60, customName: 'ding.mp3' })
    expect(normalizeMentionSettings({ sound: { customData: 'file:///C:/x.mp3', customName: 'x.mp3' } }).sound).toMatchObject({ customData: '', customName: '' })
    expect(normalizeMentionSettings({ sound: { customData: 'javascript:alert(1)' } }).sound.customData).toBe('')
  })
})

describe('mention highlight settings', () => {
  it('colours and opacity go into CSS variables, stronger pulse/bounce into data attributes', () => {
    const h = { ...DEFAULT_MENTION_SETTINGS.highlight, background: '#112233', backgroundOpacity: 30, border: '#445566', accent: '#778899', strongerPulse: false, strongerBounce: true }
    expect(mentionCssVars(h)).toEqual({
      '--mention-bg': 'color-mix(in srgb, #112233 30%, transparent)',
      '--mention-border': '#445566',
      '--mention-accent': '#778899'
    })
    expect(mentionDataAttributes(h)).toEqual({ 'data-mention-pulse': 'false', 'data-mention-bounce': 'true' })
  })

  it('stronger pulse/bounce CSS does not depend on the normal effect setting (works with animations off)', () => {
    const css = readFileSync(resolve(__dirname, '../src/renderer/styles/chat-appearance.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const pulse = ".chat-list[data-mention-pulse='true'] .chat-row.fresh[data-mention='true']::after"
    const bounce = ".chat-list[data-mention-bounce='true'] .chat-row.fresh[data-mention='true']"
    expect(css).toContain(`${pulse} {`)
    expect(css).toContain(`${bounce} {`)
    expect(pulse).not.toContain('data-effect')
    expect(bounce).not.toContain('data-effect')
    // Tylko transform/opacity w animacji wzmianki (bez przeliczania układu).
    const kf = css.slice(css.indexOf('@keyframes row-bounce-mention'), css.indexOf('@media', css.indexOf('@keyframes row-bounce-mention')))
    expect(kf).not.toMatch(/width|height|margin|padding|top|left/)
  })
})

describe('MentionSoundThrottle', () => {
  it('plays at most once per cooldown, however many mentions arrive', () => {
    let now = 0
    const t = new MentionSoundThrottle(() => now)
    const played: number[] = []
    for (let i = 0; i < 50; i++) {
      if (t.tryPlay(3000)) played.push(now)
      now += 100 // spam: 50 wzmianek w 5 s
    }
    expect(played).toEqual([0, 3000])
  })

  it('cooldown 0 plays every time', () => {
    const t = new MentionSoundThrottle(() => 5)
    expect(t.tryPlay(0)).toBe(true)
    expect(t.tryPlay(0)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import {
  parseIrcTags,
  parsePrivmsgLine,
  parseBadgesTag,
  parseEmotesTag,
  twitchDefaultColor,
  TWITCH_DEFAULT_COLOR_PALETTE
} from './irc-tags'

describe('parseIrcTags', () => {
  it('parses key=value pairs separated by semicolons', () => {
    expect(parseIrcTags('color=#FF0000;display-name=Foo;id=abc')).toEqual({
      color: '#FF0000',
      'display-name': 'Foo',
      id: 'abc'
    })
  })

  it('unescapes IRCv3 tag escape sequences', () => {
    expect(parseIrcTags('msg=hello\\sworld;semi=a\\:b')).toEqual({ msg: 'hello world', semi: 'a;b' })
  })

  it('returns an empty object for an empty string', () => {
    expect(parseIrcTags('')).toEqual({})
  })
})

describe('parsePrivmsgLine', () => {
  it('parses a tagged PRIVMSG line into tags/nick/channel/text', () => {
    const line = '@color=#FF0000;display-name=Foo;id=abc :foo!foo@foo.tmi.twitch.tv PRIVMSG #bar :hej wszystkim'
    const result = parsePrivmsgLine(line)
    expect(result).toEqual({
      tags: { color: '#FF0000', 'display-name': 'Foo', id: 'abc' },
      nick: 'foo',
      channel: 'bar',
      text: 'hej wszystkim'
    })
  })

  it('parses a PRIVMSG line without tags', () => {
    const line = ':foo!foo@foo.tmi.twitch.tv PRIVMSG #bar :hej'
    expect(parsePrivmsgLine(line)).toEqual({ tags: {}, nick: 'foo', channel: 'bar', text: 'hej' })
  })

  it('preserves the CTCP ACTION wrapper in the text (needed for /me detection)', () => {
    const line = ':foo!foo@foo.tmi.twitch.tv PRIVMSG #bar :\u0001ACTION macha\u0001'
    expect(parsePrivmsgLine(line)?.text).toBe('\u0001ACTION macha\u0001')
  })

  it('returns undefined for non-PRIVMSG lines (PING, JOIN, NOTICE, etc.)', () => {
    expect(parsePrivmsgLine('PING :tmi.twitch.tv')).toBeUndefined()
    expect(parsePrivmsgLine(':foo!foo@foo.tmi.twitch.tv JOIN #bar')).toBeUndefined()
  })
})

describe('parseBadgesTag', () => {
  it('parses id/version pairs', () => {
    expect(parseBadgesTag('broadcaster/1,subscriber/12')).toEqual([
      { id: 'broadcaster', version: '1' },
      { id: 'subscriber', version: '12' }
    ])
  })

  it('returns an empty array for undefined/empty input', () => {
    expect(parseBadgesTag(undefined)).toEqual([])
    expect(parseBadgesTag('')).toEqual([])
  })
})

describe('parseEmotesTag', () => {
  it('parses a single emote with multiple positions, sorted by start', () => {
    expect(parseEmotesTag('25:6-10,17-21')).toEqual([
      { id: '25', start: 6, end: 10 },
      { id: '25', start: 17, end: 21 }
    ])
  })

  it('parses multiple different emotes and sorts all ranges by start position', () => {
    expect(parseEmotesTag('354:0-2/25:4-8')).toEqual([
      { id: '354', start: 0, end: 2 },
      { id: '25', start: 4, end: 8 }
    ])
  })

  it('returns an empty array for undefined/empty input', () => {
    expect(parseEmotesTag(undefined)).toEqual([])
    expect(parseEmotesTag('')).toEqual([])
  })
})

describe('twitchDefaultColor', () => {
  it('always returns a color from the real 15-color Twitch default palette', () => {
    for (const seed of ['testnick', 'widz123', '999888777', '']) {
      expect(TWITCH_DEFAULT_COLOR_PALETTE).toContain(twitchDefaultColor(seed))
    }
  })

  it('is deterministic: the same seed always yields the same color', () => {
    expect(twitchDefaultColor('some-user-id')).toBe(twitchDefaultColor('some-user-id'))
  })

  it('spreads different seeds across more than one color (not a single flat default)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => twitchDefaultColor(s)))
    expect(colors.size).toBeGreaterThan(1)
  })
})

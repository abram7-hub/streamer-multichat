import { describe, expect, it } from 'vitest'
import { normalizeTwitchIrcMessage } from './irc-normalize'
import type { ParsedPrivmsg } from './irc-tags'
import { TWITCH_DEFAULT_COLOR_PALETTE } from './irc-tags'
import { parseBadgeSets, type BadgeResolver } from './badges'

function privmsg(overrides: Partial<ParsedPrivmsg> = {}): ParsedPrivmsg {
  return {
    tags: { id: 'msg-1', 'user-id': '100', 'display-name': 'Foo', color: '#FF0000' },
    nick: 'foo',
    channel: 'testnick_',
    text: 'hej wszystkim',
    ...overrides
  }
}

describe('normalizeTwitchIrcMessage', () => {
  it('maps a plain message with a real color tag', () => {
    const msg = normalizeTwitchIrcMessage(privmsg(), 'testnick_')
    expect(msg.platform).toBe('twitch')
    expect(msg.id).toBe('msg-1')
    expect(msg.rawText).toBe('hej wszystkim')
    expect(msg.author.color).toBe('#FF0000')
    expect(msg.author.displayName).toBe('Foo')
    expect(msg.isAction).toBe(false)
  })

  it('falls back to a stable default-palette color when the color tag is empty (never a single flat default, never random)', () => {
    const msg = normalizeTwitchIrcMessage(privmsg({ tags: { id: '1', 'user-id': '42', color: '' } }), 'testnick_')
    expect(TWITCH_DEFAULT_COLOR_PALETTE).toContain(msg.author.color)
    const msg2 = normalizeTwitchIrcMessage(privmsg({ tags: { id: '2', 'user-id': '42', color: '' } }), 'testnick_')
    expect(msg2.author.color).toBe(msg.author.color)
  })

  it('detects a /me (CTCP ACTION) message and colors the whole message via isAction, preserving the real nick color', () => {
    const msg = normalizeTwitchIrcMessage(
      privmsg({ text: '\u0001ACTION macha do kamery\u0001', tags: { id: '1', 'user-id': '5', color: '#00FF00' } }),
      'testnick_'
    )
    expect(msg.isAction).toBe(true)
    expect(msg.rawText).toBe('macha do kamery')
    expect(msg.author.color).toBe('#00FF00')
  })

  it('splits native Twitch emotes using the emotes tag positions', () => {
    const msg = normalizeTwitchIrcMessage(
      privmsg({ text: 'hej Kappa tam', tags: { id: '1', 'user-id': '5', emotes: '25:4-8' } }),
      'testnick_'
    )
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'hej ' },
      { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' },
      { type: 'text', text: ' tam' }
    ])
  })

  // Odpowiedź Helix chat/badges w realnym formacie (fragment).
  const CDN = 'https://static-cdn.jtvnw.net/badges/v1'
  const globalBadges = parseBadgeSets({
    data: [
      { set_id: 'broadcaster', versions: [{ id: '1', title: 'Broadcaster', image_url_1x: `${CDN}/b/1`, image_url_2x: `${CDN}/b/2`, image_url_4x: `${CDN}/b/3` }] },
      { set_id: 'moderator', versions: [{ id: '1', title: 'Moderator', image_url_1x: `${CDN}/m/1`, image_url_2x: `${CDN}/m/2`, image_url_4x: `${CDN}/m/3` }] },
      { set_id: 'vip', versions: [{ id: '1', title: 'VIP', image_url_1x: `${CDN}/v/1`, image_url_2x: `${CDN}/v/2`, image_url_4x: `${CDN}/v/3` }] },
      { set_id: 'subscriber', versions: [{ id: '0', title: 'Subscriber', image_url_1x: `${CDN}/s0/1`, image_url_2x: `${CDN}/s0/2`, image_url_4x: `${CDN}/s0/3` }] },
      { set_id: 'evil', versions: [{ id: '1', title: 'Evil', image_url_1x: 'https://evil.example.com/x.png', image_url_2x: '', image_url_4x: '' }] }
    ]
  })
  const channelBadges = parseBadgeSets({
    data: [{ set_id: 'subscriber', versions: [{ id: '6', title: '6-Month Subscriber', image_url_1x: `${CDN}/s6/1`, image_url_2x: `${CDN}/s6/2`, image_url_4x: `${CDN}/s6/3` }] }]
  })
  const resolve: BadgeResolver = (roomId, set, version) =>
    (roomId === '777' ? channelBadges.get(`${set}:${version}`) : undefined) ?? globalBadges.get(`${set}:${version}`)

  it('resolves images for every badge Twitch sends (broadcaster, moderator, VIP, channel subscriber — several at once)', () => {
    const msg = normalizeTwitchIrcMessage(
      privmsg({ tags: { id: '1', 'user-id': '5', 'room-id': '777', badges: 'broadcaster/1,moderator/1,vip/1,subscriber/6' } }),
      'testnick_',
      resolve
    )
    expect(msg.author.badges.map((b) => [b.type, b.label, b.imageUrl])).toEqual([
      ['broadcaster', 'Broadcaster', `${CDN}/b/1`],
      ['moderator', 'Moderator', `${CDN}/m/1`],
      ['vip', 'VIP', `${CDN}/v/1`],
      ['subscriber', '6-Month Subscriber', `${CDN}/s6/1`]
    ])
    expect(msg.author.badges[0]).toMatchObject({ imageUrl2x: `${CDN}/b/2`, imageUrl4x: `${CDN}/b/3`, provider: 'twitch' })
    expect(msg.author.isBroadcaster).toBe(true)
    expect(msg.author.isModerator).toBe(true)
    expect(msg.author.isSubscriber).toBe(true)
  })

  it('channel badges are per channel: another room falls back to the global subscriber badge set', () => {
    const msg = normalizeTwitchIrcMessage(privmsg({ tags: { id: '1', 'user-id': '5', 'room-id': '999', badges: 'subscriber/0' } }), 'x', resolve)
    expect(msg.author.badges[0]?.imageUrl).toBe(`${CDN}/s0/1`)
  })

  it('unknown or not-yet-loaded badges keep only a tooltip label and NO image (renderer hides them — no role text in chat)', () => {
    const msg = normalizeTwitchIrcMessage(privmsg({ tags: { id: '1', 'user-id': '5', badges: 'subscriber/6,some-new-badge/1' } }), 'testnick_')
    expect(msg.author.badges.map((b) => [b.type, b.label, b.imageUrl])).toEqual([
      ['subscriber', 'Subskrybent', undefined],
      ['some-new-badge', 'some-new-badge', undefined]
    ])
    expect(msg.author.isSubscriber).toBe(true)
  })

  it('rejects badge image URLs outside the Twitch CDN', () => {
    expect(globalBadges.has('evil:1')).toBe(false)
  })

  it('no badges tag → empty badge list', () => {
    expect(normalizeTwitchIrcMessage(privmsg(), 'testnick_').author.badges).toEqual([])
  })

  it('/me keeps native emotes (positions are relative to the text without the ACTION wrapper)', () => {
    const msg = normalizeTwitchIrcMessage(
      privmsg({ text: '\u0001ACTION tańczy Kappa\u0001', tags: { id: '1', 'user-id': '5', color: '#00FF00', emotes: '25:7-11' } }),
      'testnick_'
    )
    expect(msg.isAction).toBe(true)
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'tańczy ' },
      { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' }
    ])
  })
})

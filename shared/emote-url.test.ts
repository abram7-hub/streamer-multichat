import { describe, expect, it } from 'vitest'
import { isAllowedAssetUrl, isAllowedEmoteUrl, isSafeHttpUrl } from './emote-url'

describe('isAllowedEmoteUrl', () => {
  it('accepts only https URLs on the provider CDN', () => {
    expect(isAllowedEmoteUrl('https://cdn.7tv.app/emote/01F/2x.webp', '7tv')).toBe(true)
    expect(isAllowedEmoteUrl('https://cdn.betterttv.net/emote/abc/2x.webp', 'bttv')).toBe(true)
    expect(isAllowedEmoteUrl('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', 'twitch')).toBe(true)
  })

  it('rejects other hosts, other providers, non-https and tricky URLs', () => {
    expect(isAllowedEmoteUrl('http://cdn.7tv.app/emote/x/2x.webp', '7tv')).toBe(false)
    expect(isAllowedEmoteUrl('https://cdn.7tv.app/emote/x/2x.webp', 'bttv')).toBe(false)
    expect(isAllowedEmoteUrl('https://cdn.7tv.app.evil.com/x.webp', '7tv')).toBe(false)
    expect(isAllowedEmoteUrl('https://evil.com/?u=cdn.7tv.app', '7tv')).toBe(false)
    expect(isAllowedEmoteUrl('https://user:pass@cdn.7tv.app/x', '7tv')).toBe(false)
    expect(isAllowedEmoteUrl('https://cdn.7tv.app:8443/x', '7tv')).toBe(false)
    expect(isAllowedEmoteUrl('javascript:alert(1)', '7tv')).toBe(false)
    expect(isAllowedEmoteUrl('data:image/png;base64,AAAA', 'twitch')).toBe(false)
    expect(isAllowedEmoteUrl('not a url', 'twitch')).toBe(false)
  })
})

describe('isSafeHttpUrl', () => {
  it('allows only http(s)', () => {
    expect(isSafeHttpUrl('https://files.kick.com/emotes/1/fullsize')).toBe(true)
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeHttpUrl('file:///C:/x')).toBe(false)
    expect(isSafeHttpUrl(undefined)).toBe(false)
  })
})

describe('isAllowedAssetUrl (badges / reward icons)', () => {
  it('accepts only https on the official CDN of the given platform', () => {
    expect(isAllowedAssetUrl('https://static-cdn.jtvnw.net/badges/v1/x/1', 'twitch')).toBe(true)
    expect(isAllowedAssetUrl('https://ext.cdn.kick.com/chat/badges/a.png', 'kick')).toBe(true)
    expect(isAllowedAssetUrl('https://files.kick.com/channel_subscriber_badges/1/original', 'kick')).toBe(true)
    expect(isAllowedAssetUrl('https://p16-webcast.tiktokcdn.com/a.png~tplv-obj.image', 'tiktok')).toBe(true)
    expect(isAllowedAssetUrl('https://static-cdn.jtvnw.net/x', 'kick')).toBe(false)
    expect(isAllowedAssetUrl('http://static-cdn.jtvnw.net/x', 'twitch')).toBe(false)
    expect(isAllowedAssetUrl('https://static-cdn.jtvnw.net.evil.com/x', 'twitch')).toBe(false)
    expect(isAllowedAssetUrl('https://eviltiktokcdn.com/x', 'tiktok')).toBe(false)
    expect(isAllowedAssetUrl('javascript:alert(1)', 'twitch')).toBe(false)
    expect(isAllowedAssetUrl(undefined, 'twitch')).toBe(false)
    expect(isAllowedAssetUrl('not a url', 'twitch')).toBe(false)
  })
})

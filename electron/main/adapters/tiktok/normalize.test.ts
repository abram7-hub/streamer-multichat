import { describe, expect, it } from 'vitest'
import { normalizeTikTokGift, normalizeTikTokMessage, normalizeTikTokSubscribe, type TikTokChatEvent } from './normalize'

describe('normalizeTikTokMessage', () => {
  it('maps the tiktok-live-connector v2.x (protobuf) CHAT event fields', () => {
    const event: TikTokChatEvent = {
      common: { msgId: 'abc123' },
      content: 'siema z tiktoka',
      user: { id: '55', displayId: 'widz_tt', nickname: 'Widz TikTok' }
    }
    const msg = normalizeTikTokMessage(event, 'testnick_ttv')
    expect(msg.platform).toBe('tiktok')
    expect(msg.id).toBe('abc123')
    expect(msg.rawText).toBe('siema z tiktoka')
    expect(msg.author.username).toBe('widz_tt')
    expect(msg.author.displayName).toBe('Widz TikTok')
    expect(msg.author.id).toBe('55')
  })

  it('does NOT read the legacy v1 field names (comment/msgId/uniqueId/profilePicture)', () => {
    // Regresja na prawdziwą przyczynę zepsutego czatu TikToka: biblioteka 2.x zwraca `content`,
    // `common.msgId` i `user.displayId`/`user.avatarThumb`, a nie `comment`/`msgId`/`user.uniqueId`.
    const legacyShapedEvent = {
      comment: 'to pole nie istnieje już w 2.x',
      msgId: 'legacy-id',
      user: { uniqueId: 'legacy_user', profilePicture: { urls: ['https://x/y.png'] } }
    } as unknown as TikTokChatEvent
    const msg = normalizeTikTokMessage(legacyShapedEvent, 'testnick_ttv')
    expect(msg.rawText).toBe('')
    expect(msg.author.username).toBe('widz')
  })

  it('maps userIdentity flags to role flags WITHOUT inventing text badges', () => {
    const event: TikTokChatEvent = {
      common: { msgId: 'a2' },
      content: 'hej',
      user: { id: '1', displayId: 'mod_user' },
      userIdentity: { isModeratorOfAnchor: true, isSubscriberOfAnchor: true }
    }
    const msg = normalizeTikTokMessage(event, 'testnick_ttv')
    expect(msg.author.isModerator).toBe(true)
    expect(msg.author.isSubscriber).toBe(true)
    expect(msg.author.badges).toEqual([])
  })

  // Kształty odznak zarejestrowane na prawdziwym TikTok LIVE (badgeList z proto v3).
  it('uses official badge icons from user.badgeList (image and combine variants), skipping hidden ones', () => {
    const event: TikTokChatEvent = {
      common: { msgId: 'b1' },
      content: 'hej',
      user: {
        id: '1',
        displayId: 'gifter',
        badgeList: [
          {
            sceneType: 8,
            display: true,
            combine: { icon: { urlList: ['https://p16-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv1_v1.png~tplv-obj.image'] }, str: '4' }
          },
          {
            sceneType: 6,
            display: false,
            image: { image: { urlList: ['https://p16-webcast.tiktokcdn.com/webcast-sg/new_top_gifter_version_2.png~tplv-obj.image'] } }
          },
          { sceneType: 1, display: true, image: { image: { urlList: ['https://p16-webcast.tiktokcdn.com/mod.png'] } } },
          { sceneType: 4, display: true, image: { image: { urlList: ['https://evil.example.com/x.png'] } } },
          { sceneType: 10, display: true }
        ]
      }
    }
    const badges = normalizeTikTokMessage(event, 'testnick_ttv').author.badges
    expect(badges.map((b) => [b.type, b.label, b.provider])).toEqual([
      ['scene-8', 'Poziom 4', 'tiktok'],
      ['scene-1', 'Moderator', 'tiktok']
    ])
    expect(badges[0]?.imageUrl).toContain('grade_badge_icon_lite_lv1')
  })

  it('gift: shows only the end of a combo streak with the total count; non-combo gifts immediately', () => {
    const streak = { common: { msgId: 'g1' }, user: { id: '9', displayId: 'fan' }, gift: { name: 'Rose', type: 1 }, repeatCount: 5 }
    expect(normalizeTikTokGift({ ...streak, repeatEnd: 0 }, 'x')).toBeUndefined()
    const end = normalizeTikTokGift({ ...streak, repeatEnd: 1 }, 'x')
    expect(end?.event).toMatchObject({ kind: 'tiktok_gift', itemName: 'Rose', count: 5 })
    const single = normalizeTikTokGift({ common: { msgId: 'g2' }, user: { id: '9' }, gift: { name: 'Lion', type: 2 }, repeatCount: 1 }, 'x')
    expect(single?.event).toMatchObject({ kind: 'tiktok_gift', itemName: 'Lion', count: 1 })
  })

  it('subscribe event becomes a sub stream event', () => {
    const msg = normalizeTikTokSubscribe({ common: { msgId: 's1' }, user: { id: '3', displayId: 'sub', nickname: 'Sub' } }, 'x')
    expect(msg.event?.kind).toBe('sub')
    expect(msg.author.displayName).toBe('Sub')
  })

  it('appends chat emotes as trailing emote fragments using data.image.urlList', () => {
    const event: TikTokChatEvent = {
      common: { msgId: 'a3' },
      content: 'hej',
      user: { id: '1', displayId: 'x' },
      emotes: [{ index: 0, emote: { image: { urlList: ['https://p16.tiktokcdn.com/emote.png'] } } }]
    }
    const msg = normalizeTikTokMessage(event, 'testnick_ttv')
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'hej' },
      { type: 'emote', text: '', url: 'https://p16.tiktokcdn.com/emote.png' }
    ])
  })

  it('falls back to a generated id when common.msgId is missing', () => {
    const event: TikTokChatEvent = { content: 'test', user: { displayId: 'x' } }
    const msg = normalizeTikTokMessage(event, 'testnick_ttv')
    expect(msg.id.length).toBeGreaterThan(0)
  })

  it('degrades gracefully when the user payload is entirely absent', () => {
    const msg = normalizeTikTokMessage({ content: 'brak usera' }, 'testnick_ttv')
    expect(msg.author.username).toBe('widz')
    expect(msg.rawText).toBe('brak usera')
  })
})

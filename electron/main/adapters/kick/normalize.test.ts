import { describe, expect, it } from 'vitest'
import {
  normalizeKickMessage,
  normalizeKickPusherEvent,
  normalizeKickPusherMessage,
  subscriberBadgeFor,
  type KickChatMessageEvent
} from './normalize'

function makeEvent(overrides: Partial<KickChatMessageEvent> = {}): KickChatMessageEvent {
  return {
    message_id: 'msg-1',
    broadcaster: {
      user_id: 100,
      username: 'testnick_'
    },
    sender: {
      user_id: 200,
      username: 'widz1',
      identity: {
        username_color: '#ABCDEF',
        badges: [{ text: 'Moderator', type: 'moderator' }]
      }
    },
    content: 'Hej!',
    created_at: '2025-01-14T16:08:06Z',
    ...overrides
  }
}

describe('normalizeKickMessage', () => {
  it('maps plain text content into a single text fragment', () => {
    const msg = normalizeKickMessage(makeEvent(), 'testnick_')
    expect(msg.platform).toBe('kick')
    expect(msg.rawText).toBe('Hej!')
    expect(msg.fragments).toEqual([{ type: 'text', text: 'Hej!' }])
  })

  it('splits emote placeholders into emote fragments with the files.kick.com CDN URL', () => {
    const event = makeEvent({
      content: 'Hello [emote:4148074:HYPERCLAP] there',
      emotes: [{ emote_id: '4148074', positions: [{ s: 6, e: 30 }] }]
    })
    const msg = normalizeKickMessage(event, 'testnick_')
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'emote', text: 'HYPERCLAP', url: 'https://files.kick.com/emotes/4148074/fullsize' },
      { type: 'text', text: ' there' }
    ])
    expect(msg.rawText).toBe('Hello HYPERCLAP there')
  })

  it('detects the broadcaster by matching sender and broadcaster ids', () => {
    const event = makeEvent()
    event.sender.user_id = event.broadcaster.user_id
    const msg = normalizeKickMessage(event, 'testnick_')
    expect(msg.author.isBroadcaster).toBe(true)
  })

  it('derives moderator/subscriber flags from identity badge types', () => {
    const msg = normalizeKickMessage(makeEvent(), 'testnick_')
    expect(msg.author.isModerator).toBe(true)
    expect(msg.author.isSubscriber).toBe(false)
  })

  it('uses the platform message id for deduplication', () => {
    const msg = normalizeKickMessage(makeEvent({ message_id: 'unique-abc' }), 'testnick_')
    expect(msg.id).toBe('unique-abc')
  })
})

/** Kształt zarejestrowany z prawdziwego publicznego czatu Kicka (Pusher, 2026-10), dane zanonimizowane. */
const PUSHER_MESSAGE = {
  id: '47733a58-c4a7-4145-a9cd-9f54388d7202',
  chatroom_id: 668,
  content: 'gg [emote:37226:KEKW] wp',
  type: 'message',
  created_at: '2026-10-13T19:43:37+00:00',
  sender: {
    id: 84768350,
    username: 'Some_User',
    slug: 'some-user',
    identity: {
      color: '#75FD46',
      badges: [
        { type: 'moderator', text: 'Moderator' },
        { type: 'subscriber', text: 'Subscriber', count: 7, sort_order: 9 },
        { type: 'verified', text: 'Verified' }
      ],
      badges_v2: [
        { name: 'level', badge_type: 'global', image_url: 'https://ext.cdn.kick.com/chat/badges/46_1629c3f5.png', metadata: { level: 46 }, selected: true },
        { name: 'GoldenK', badge_type: 'global', image_url: 'https://ext.cdn.kick.com/chat/badges/GoldenK_019f.png', selected: false },
        { name: 'kick_founder22', badge_type: 'global', image_url: 'https://ext.cdn.kick.com/chat/badges/kick_founder22_2a2d.png', selected: true },
        { name: 'evil', badge_type: 'global', image_url: 'https://evil.example.com/x.png', selected: true }
      ]
    }
  },
  metadata: { message_ref: '1791920636796' }
}

const CHANNEL = {
  subscriberBadges: [
    { months: 1, imageUrl: 'https://files.kick.com/channel_subscriber_badges/1/original' },
    { months: 6, imageUrl: 'https://files.kick.com/channel_subscriber_badges/6/original' },
    { months: 12, imageUrl: 'https://files.kick.com/channel_subscriber_badges/12/original' }
  ]
}

describe('normalizeKickPusherMessage (public chat, no login)', () => {
  it('maps the real public payload: id, colour, inline emotes from [emote:id:name] tokens', () => {
    const msg = normalizeKickPusherMessage(PUSHER_MESSAGE, 'xqc', CHANNEL)!
    expect(msg.id).toBe(PUSHER_MESSAGE.id)
    expect(msg.author).toMatchObject({ id: '84768350', username: 'Some_User', color: '#75FD46', isModerator: true, isSubscriber: true })
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'gg ' },
      { type: 'emote', text: 'KEKW', url: 'https://files.kick.com/emotes/37226/fullsize' },
      { type: 'text', text: ' wp' }
    ])
    expect(msg.rawText).toBe('gg KEKW wp')
  })

  it('badges: official sub badge for 7 months (6-month tier) + selected badges_v2 images; role badges without assets keep only tooltip data', () => {
    const badges = normalizeKickPusherMessage(PUSHER_MESSAGE, 'xqc', CHANNEL)!.author.badges
    const withImages = badges.filter((b) => b.imageUrl)
    expect(withImages.map((b) => [b.type, b.label, b.imageUrl])).toEqual([
      ['subscriber', 'Subskrybent (7 mies.)', 'https://files.kick.com/channel_subscriber_badges/6/original'],
      ['level', 'Poziom 46', 'https://ext.cdn.kick.com/chat/badges/46_1629c3f5.png'],
      ['kick_founder22', 'kick_founder22', 'https://ext.cdn.kick.com/chat/badges/kick_founder22_2a2d.png']
    ])
    expect(badges.find((b) => b.type === 'moderator')?.imageUrl).toBeUndefined()
    expect(badges.find((b) => b.type === 'verified')?.imageUrl).toBeUndefined()
    expect(badges.some((b) => b.imageUrl?.includes('evil'))).toBe(false)
    expect(badges.every((b) => b.provider === 'kick')).toBe(true)
  })

  it('without channel data the subscriber badge has no image (nothing invented)', () => {
    const badges = normalizeKickPusherMessage(PUSHER_MESSAGE, 'xqc')!.author.badges
    expect(badges.find((b) => b.type === 'subscriber')?.imageUrl).toBeUndefined()
  })

  it('incomplete payloads are skipped instead of throwing (old code crashed on missing `broadcaster`)', () => {
    expect(normalizeKickPusherMessage({ content: 'x' }, 'xqc')).toBeUndefined()
    expect(normalizeKickPusherMessage({ id: '1', content: 'x', sender: { id: 1 } }, 'xqc')).toBeUndefined()
  })

  it('subscriberBadgeFor picks the highest tier not above the months', () => {
    expect(subscriberBadgeFor(0, CHANNEL.subscriberBadges)).toBeUndefined()
    expect(subscriberBadgeFor(1, CHANNEL.subscriberBadges)).toContain('/1/')
    expect(subscriberBadgeFor(40, CHANNEL.subscriberBadges)).toContain('/12/')
  })

  it('webhook format also gets the official subscriber badge image', () => {
    const event = makeEvent()
    event.sender.identity!.badges = [{ text: 'Subscriber', type: 'subscriber', count: 12 }]
    const msg = normalizeKickMessage(event, 'testnick_', CHANNEL)
    expect(msg.author.badges[0]?.imageUrl).toContain('/12/')
  })
})

/** Nazwy zdarzeń Pushera mają postać `App\Events\...` (pojedyncze ukośniki wsteczne). */
const ev = (name: string): string => ['App', 'Events', name].join(String.fromCharCode(92))

describe('normalizeKickPusherEvent', () => {
  it('subscription, gifted subscriptions and host become stream events', () => {
    expect(normalizeKickPusherEvent(ev('SubscriptionEvent'), { username: 'Fan', months: 3 }, 'x', 's1')?.event).toMatchObject({ kind: 'resub', months: 3 })
    const gift = normalizeKickPusherEvent(ev('GiftedSubscriptionsEvent'), { gifter_username: 'Hojny', gifted_usernames: ['a', 'b', 'c'] }, 'x', 'g1')
    expect(gift?.event).toMatchObject({ kind: 'community_gift', giftCount: 3 })
    expect(gift?.author.displayName).toBe('Hojny')
    const host = normalizeKickPusherEvent(ev('StreamHostEvent'), { host_username: 'Inny', number_viewers: 12, optional_message: 'hej' }, 'x', 'h1')
    expect(host?.event).toMatchObject({ kind: 'host', viewers: 12 })
    expect(host?.rawText).toBe('hej')
  })

  it('unknown events and missing fields are ignored', () => {
    expect(normalizeKickPusherEvent(ev('MessageDeletedEvent'), { id: 'x' }, 'x', 'd')).toBeUndefined()
    expect(normalizeKickPusherEvent(ev('StreamHostEvent'), {}, 'x', 'h')).toBeUndefined()
  })
})

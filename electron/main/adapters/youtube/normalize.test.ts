import { describe, expect, it } from 'vitest'
import { normalizeYouTubeMessage, type YouTubeChatItem } from './normalize'

function makeItem(overrides: Partial<YouTubeChatItem> = {}): YouTubeChatItem {
  return {
    id: 'msg-1',
    snippet: {
      type: 'textMessageEvent',
      displayMessage: 'Siema z YouTube!',
      textMessageDetails: { messageText: 'Siema z YouTube!' },
      publishedAt: '2025-01-14T16:08:06Z'
    },
    authorDetails: {
      channelId: 'UC123',
      displayName: 'Widz YT',
      isChatModerator: false,
      isChatOwner: false,
      isChatSponsor: false
    },
    ...overrides
  }
}

describe('normalizeYouTubeMessage', () => {
  it('maps a plain text chat message', () => {
    const msg = normalizeYouTubeMessage(makeItem(), '@testnickyt')
    expect(msg?.platform).toBe('youtube')
    expect(msg?.rawText).toBe('Siema z YouTube!')
    expect(msg?.author.displayName).toBe('Widz YT')
    expect(msg?.event).toBeUndefined()
  })

  it('owner / moderator / member / verified become role flags only — never text badges (YouTube gives no official badge images)', () => {
    const item = makeItem({
      authorDetails: { channelId: 'UC1', displayName: 'Mod', isChatOwner: true, isChatModerator: true, isChatSponsor: true, isVerified: true }
    })
    const msg = normalizeYouTubeMessage(item, '@testnickyt')
    expect(msg?.author.isBroadcaster).toBe(true)
    expect(msg?.author.isModerator).toBe(true)
    expect(msg?.author.isSubscriber).toBe(true)
    expect(msg?.author.badges).toEqual([])
  })

  it('Super Chat → superchat event with amount and the user comment as message', () => {
    const msg = normalizeYouTubeMessage(
      makeItem({
        snippet: {
          type: 'superChatEvent',
          publishedAt: '2025-01-14T16:08:06Z',
          superChatDetails: { amountDisplayString: '20,00 zł', userComment: 'Dzięki za stream!' }
        }
      }),
      '@testnickyt'
    )
    expect(msg?.event).toEqual({ kind: 'superchat', source: 'platform', amountFormatted: '20,00 zł' })
    expect(msg?.rawText).toBe('Dzięki za stream!')
  })

  it('Super Sticker, new member, milestone and membership gifting events', () => {
    const sticker = normalizeYouTubeMessage(
      makeItem({ snippet: { type: 'superStickerEvent', superStickerDetails: { amountDisplayString: '5,00 zł', superStickerMetadata: { altText: 'Kot' } } } }),
      'x'
    )
    expect(sticker?.event).toMatchObject({ kind: 'supersticker', itemName: 'Kot', amountFormatted: '5,00 zł' })

    const member = normalizeYouTubeMessage(makeItem({ snippet: { type: 'newSponsorEvent', newSponsorDetails: { memberLevelName: 'VIP' } } }), 'x')
    expect(member?.event).toMatchObject({ kind: 'membership', itemName: 'VIP' })

    const milestone = normalizeYouTubeMessage(
      makeItem({ snippet: { type: 'memberMilestoneChatEvent', memberMilestoneChatDetails: { memberMonth: 12, userComment: 'rok!' } } }),
      'x'
    )
    expect(milestone?.event).toMatchObject({ kind: 'member_milestone', months: 12 })
    expect(milestone?.rawText).toBe('rok!')

    const gifting = normalizeYouTubeMessage(
      makeItem({ snippet: { type: 'membershipGiftingEvent', membershipGiftingDetails: { giftMembershipsCount: 10 } } }),
      'x'
    )
    expect(gifting?.event).toMatchObject({ kind: 'membership_gift', giftCount: 10 })
  })

  it('ignores items we do not show (deleted messages, bans, single received gift memberships)', () => {
    for (const type of ['messageDeletedEvent', 'userBannedEvent', 'giftMembershipReceivedEvent', 'pollEvent']) {
      expect(normalizeYouTubeMessage(makeItem({ snippet: { type } }), 'x')).toBeUndefined()
    }
  })

  it('returns undefined when required fields are missing', () => {
    const msg = normalizeYouTubeMessage({ id: undefined, snippet: undefined, authorDetails: undefined }, '@testnickyt')
    expect(msg).toBeUndefined()
  })
})

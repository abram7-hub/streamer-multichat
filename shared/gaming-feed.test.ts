import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from './chat-message'
import { GAMING_FADE_MS, GamingFeed, type GamingFeedItem } from './gaming-feed'

const msg = (id: string): ChatMessage =>
  ({
    id,
    platform: 'twitch',
    channel: 'c',
    author: { id: 'a', username: 'u', displayName: 'U', badges: [], isBroadcaster: false, isModerator: false, isSubscriber: false },
    fragments: [{ type: 'text', text: id }],
    rawText: id,
    timestampMs: 0,
    receivedAtMs: 0,
    isHighlighted: false
  }) as ChatMessage

function setup(lifetimeMs: number, maxVisible: number) {
  let items: readonly GamingFeedItem[] = []
  const onChange = vi.fn((next: readonly GamingFeedItem[]) => {
    items = next
  })
  const feed = new GamingFeed({ lifetimeMs, maxVisible }, onChange)
  return { feed, onChange, ids: () => items.map((i) => i.message.id), leaving: () => items.filter((i) => i.leaving).map((i) => i.message.id) }
}

describe('GamingFeed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('max visible: only the newest N messages are shown', () => {
    const { feed, ids } = setup(0, 3)
    feed.addMany(['1', '2', '3', '4', '5'].map(msg))
    expect(ids()).toEqual(['3', '4', '5'])
    feed.add(msg('6'))
    expect(ids()).toEqual(['4', '5', '6'])
  })

  it('lifetime: a message fades out, then disappears from the overlay view', async () => {
    const { feed, ids, leaving } = setup(10_000, 5)
    feed.add(msg('1'))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(leaving()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(leaving()).toEqual(['1'])
    expect(ids()).toEqual(['1'])
    await vi.advanceTimersByTimeAsync(GAMING_FADE_MS)
    expect(ids()).toEqual([])
  })

  it('"always" (0) never expires and keeps no timers', async () => {
    const { feed, ids } = setup(0, 5)
    feed.addMany([msg('1'), msg('2')])
    expect(feed.activeTimers()).toBe(0)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(ids()).toEqual(['1', '2'])
  })

  it('timers are cleaned up: at most one per visible message, none after removal or dispose', async () => {
    const { feed } = setup(5_000, 2)
    feed.addMany([msg('1'), msg('2'), msg('3')])
    expect(feed.activeTimers()).toBe(2) // '1' wypadł przez limit - jego timer został wyczyszczony
    expect(vi.getTimerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(5_000 + GAMING_FADE_MS)
    expect(feed.activeTimers()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    feed.add(msg('4'))
    feed.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('expiration never touches the central message objects or the central list', async () => {
    const central = [msg('1'), msg('2')]
    const snapshot = JSON.parse(JSON.stringify(central))
    const { feed, ids } = setup(1_000, 5)
    feed.addMany(central)
    await vi.advanceTimersByTimeAsync(1_000 + GAMING_FADE_MS)
    expect(ids()).toEqual([])
    expect(central).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(central))).toEqual(snapshot)
  })

  it('duplicates are ignored and a batch notifies the view once', () => {
    const { feed, onChange, ids } = setup(0, 5)
    feed.addMany([msg('1'), msg('2'), msg('1')])
    feed.add(msg('2'))
    expect(ids()).toEqual(['1', '2'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('changing lifetime or max visible applies to messages already shown', async () => {
    const { feed, ids } = setup(0, 5)
    feed.addMany(['1', '2', '3', '4'].map(msg))
    feed.setOptions({ lifetimeMs: 2_000, maxVisible: 2 })
    expect(ids()).toEqual(['3', '4'])
    await vi.advanceTimersByTimeAsync(2_000 + GAMING_FADE_MS)
    expect(ids()).toEqual([])
  })
})

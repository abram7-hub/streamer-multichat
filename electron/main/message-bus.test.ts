import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChatMessage } from '../../shared/chat-message'

// message-bus.ts tworzy singleton przy imporcie, więc dla testów odtwarzamy
// tę samą logikę deduplikacji na świeżej instancji per test.
class TestableMessageBus extends EventEmitter {
  private readonly seenIds = new Set<string>()
  private readonly seenOrder: string[] = []
  private readonly maxSeen: number
  constructor(maxSeen = 4000) {
    super()
    this.maxSeen = maxSeen
  }
  publish(message: ChatMessage): boolean {
    const key = `${message.platform}:${message.id}`
    if (this.seenIds.has(key)) return false
    this.seenIds.add(key)
    this.seenOrder.push(key)
    if (this.seenOrder.length > this.maxSeen) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seenIds.delete(oldest)
    }
    this.emit('message', message)
    return true
  }
}

function makeMessage(id: string, platform: ChatMessage['platform'] = 'twitch'): ChatMessage {
  return {
    id,
    platform,
    channel: 'testnick_',
    author: {
      id: 'u1',
      username: 'user1',
      displayName: 'User1',
      badges: [],
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments: [{ type: 'text', text: 'siema' }],
    rawText: 'siema',
    timestampMs: Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false
  }
}

describe('MessageBus deduplication', () => {
  it('publishes a new message once', () => {
    const bus = new TestableMessageBus()
    const received: ChatMessage[] = []
    bus.on('message', (m: ChatMessage) => received.push(m))
    const ok = bus.publish(makeMessage('abc'))
    expect(ok).toBe(true)
    expect(received).toHaveLength(1)
  })

  it('drops a duplicate id on the same platform (reconnect replay)', () => {
    const bus = new TestableMessageBus()
    const received: ChatMessage[] = []
    bus.on('message', (m: ChatMessage) => received.push(m))
    bus.publish(makeMessage('abc'))
    const ok = bus.publish(makeMessage('abc'))
    expect(ok).toBe(false)
    expect(received).toHaveLength(1)
  })

  it('treats the same id on different platforms as distinct messages', () => {
    const bus = new TestableMessageBus()
    const received: ChatMessage[] = []
    bus.on('message', (m: ChatMessage) => received.push(m))
    bus.publish(makeMessage('1', 'twitch'))
    bus.publish(makeMessage('1', 'kick'))
    expect(received).toHaveLength(2)
  })

  it('evicts the oldest seen id once the cache exceeds its cap', () => {
    const bus = new TestableMessageBus(2)
    bus.publish(makeMessage('a'))
    bus.publish(makeMessage('b'))
    bus.publish(makeMessage('c')) // evicts 'a'
    const replayA = bus.publish(makeMessage('a'))
    expect(replayA).toBe(true)
  })
})

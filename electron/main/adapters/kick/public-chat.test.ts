import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChatMessage } from '../../../../shared/chat-message'
import { normalizeKickSlug } from '../../../../shared/channel-input'

class FakeWs extends EventEmitter {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWs[] = []
  readyState = FakeWs.CONNECTING
  sent: { event: string; data: { channel?: string } }[] = []
  constructor(readonly url: string) {
    super()
    FakeWs.instances.push(this)
  }
  send(raw: string): void {
    this.sent.push(JSON.parse(raw))
  }
  server(event: string, data: unknown, channel?: string): void {
    this.emit('message', Buffer.from(JSON.stringify({ event, channel, data: typeof data === 'string' ? data : JSON.stringify(data) })))
  }
  established(): void {
    this.readyState = FakeWs.OPEN
    this.server('pusher:connection_established', { socket_id: '1.2' })
  }
  close(code = 1006): void {
    this.readyState = FakeWs.CLOSED
    this.emit('close', code)
  }
  terminate(): void {
    this.close()
  }
}
vi.mock('ws', () => ({ default: FakeWs }))

const { KickPublicChatClient, parseKickChannelInfo, parseRealtimeConfig } = await import('./public-chat')

const chatMessage = (id: string) =>
  JSON.stringify({ id, chatroom_id: 668, content: 'hej', created_at: '2026-10-13T19:43:37+00:00', sender: { id: 5, username: 'widz', identity: { color: '#fff', badges: [] } } })

describe('Kick realtime config & channel info parsing', () => {
  it('reads the Pusher key/cluster from the official realtime endpoint response', () => {
    const json = { data: { connections: [{ credentials: { app_key: '0000000000', cluster: 'us2' }, provider: 'pusher' }], mode: 'websocket' } }
    expect(parseRealtimeConfig(json)).toEqual({ appKey: '0000000000', cluster: 'us2' })
    expect(parseRealtimeConfig({ data: { connections: [{ provider: 'centrifugo', credentials: { url: 'wss://x' } }] } })).toBeUndefined()
    expect(parseRealtimeConfig({ data: { connections: [{ provider: 'pusher', credentials: { app_key: 'x"/../', cluster: 'us2' } }] } })).toBeUndefined()
  })

  it('channel info: chatroom id, live flag and only official subscriber badge URLs', () => {
    const info = parseKickChannelInfo({
      chatroom: { id: 70873306 },
      livestream: null,
      subscriber_badges: [
        { months: 1, badge_image: { src: 'https://files.kick.com/channel_subscriber_badges/1/original' } },
        { months: 3, badge_image: { src: 'javascript:alert(1)' } }
      ]
    })
    expect(info).toEqual({
      chatroomId: 70873306,
      isLive: false,
      context: { subscriberBadges: [{ months: 1, imageUrl: 'https://files.kick.com/channel_subscriber_badges/1/original' }] }
    })
  })

  it('slug: Kick turns "_" into "-" (Test_Nick → test-nick) and accepts URLs', () => {
    expect(normalizeKickSlug('Test_Nick')).toBe('test-nick')
    expect(normalizeKickSlug('https://kick.com/Test_Nick')).toBe('test-nick')
  })
})

describe('KickPublicChatClient', () => {
  let realtimeCalls = 0
  beforeEach(() => {
    FakeWs.instances = []
    realtimeCalls = 0
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input)
      if (url.includes('realtime/connection')) {
        realtimeCalls++
        return new Response(JSON.stringify({ data: { connections: [{ provider: 'pusher', credentials: { app_key: '1111111111', cluster: 'eu' } }] } }))
      }
      if (url.includes('/v1/channels/xqc')) return new Response(JSON.stringify({ chatroom: { id: 668 }, livestream: { id: 1 }, subscriber_badges: [] }))
      if (url.includes('/v1/channels/inny')) return new Response(JSON.stringify({ chatroom: { id: 777 }, livestream: null }))
      return new Response('{}', { status: 404 })
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function watchXqc(client: InstanceType<typeof KickPublicChatClient>) {
    const messages: ChatMessage[] = []
    const states: string[] = []
    const live: boolean[] = []
    const unwatch = client.watch('https://kick.com/xqc', {
      onMessage: (m) => messages.push(m),
      onStatus: (s) => states.push(s),
      onLive: (l) => live.push(l)
    })
    await vi.waitFor(() => expect(FakeWs.instances).toHaveLength(1))
    return { messages, states, live, unwatch, ws: FakeWs.instances[0]! }
  }

  it('connects with the key fetched from Kick, reports Connected only after subscription_succeeded, delivers messages once', async () => {
    const client = new KickPublicChatClient()
    const { ws, messages, states, live } = await watchXqc(client)
    expect(ws.url).toBe('wss://ws-eu.pusher.com/app/1111111111?protocol=7&client=js&version=8.4.0&flash=false')
    expect(live).toEqual([true])
    ws.established()
    expect(ws.sent).toContainEqual({ event: 'pusher:subscribe', data: { channel: 'chatrooms.668.v2' } })
    expect(states.at(-1)).toBe('connecting')
    ws.server('pusher_internal:subscription_succeeded', '{}', 'chatrooms.668.v2')
    expect(states.at(-1)).toBe('connected')
    ws.server('App\\Events\\ChatMessageEvent', chatMessage('m1'), 'chatrooms.668.v2')
    expect(messages.map((m) => m.id)).toEqual(['m1'])
    client.shutdown()
  })

  it('a rejected app key (close 4001) refetches the config before reconnecting — exactly one new socket', async () => {
    const client = new KickPublicChatClient()
    const { ws, states } = await watchXqc(client)
    ws.established()
    ws.close(4001)
    expect(states.at(-1)).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(3_000)
    await vi.waitFor(() => expect(FakeWs.instances).toHaveLength(2))
    expect(realtimeCalls).toBe(2)
    expect(ws.listenerCount('message')).toBe(0)
    client.shutdown()
  })

  it('switching channel: the old chatroom is unsubscribed and its messages are not delivered; last unwatch tears down', async () => {
    const client = new KickPublicChatClient()
    const first = await watchXqc(client)
    first.ws.established()
    const other: ChatMessage[] = []
    const unwatchOther = client.watch('inny', { onMessage: (m) => other.push(m), onStatus: () => undefined })
    await vi.waitFor(() => expect(first.ws.sent).toContainEqual({ event: 'pusher:subscribe', data: { channel: 'chatrooms.777.v2' } }))
    first.unwatch()
    expect(first.ws.sent).toContainEqual({ event: 'pusher:unsubscribe', data: { channel: 'chatrooms.668.v2' } })
    first.ws.server('App\\Events\\ChatMessageEvent', chatMessage('old'), 'chatrooms.668.v2')
    first.ws.server('App\\Events\\ChatMessageEvent', chatMessage('new'), 'chatrooms.777.v2')
    expect(first.messages).toHaveLength(0)
    expect(other.map((m) => m.id)).toEqual(['new'])
    unwatchOther()
    expect(first.ws.listenerCount('message')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unknown channel → clear error, no socket', async () => {
    const client = new KickPublicChatClient()
    const states: { s: string; m?: string }[] = []
    client.watch('nie-ma-takiego', { onMessage: () => undefined, onStatus: (s, m) => states.push({ s, m }) })
    await vi.waitFor(() => expect(states.at(-1)?.s).toBe('error'))
    expect(states.at(-1)?.m).toMatch(/Nie znaleziono/)
    expect(FakeWs.instances).toHaveLength(0)
    client.shutdown()
  })
})

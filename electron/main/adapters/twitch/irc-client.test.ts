import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChatMessage } from '../../../../shared/chat-message'

class FakeWs extends EventEmitter {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWs[] = []
  readonly CONNECTING = 0
  readonly OPEN = 1
  readyState = FakeWs.CONNECTING
  sent: string[] = []
  constructor(readonly url: string) {
    super()
    FakeWs.instances.push(this)
  }
  send(line: string): void {
    this.sent.push(line)
  }
  open(): void {
    this.readyState = FakeWs.OPEN
    this.emit('open')
  }
  serverLine(line: string): void {
    this.emit('message', Buffer.from(`${line}\r\n`))
  }
  close(): void {
    this.readyState = FakeWs.CLOSED
    this.emit('close')
  }
  terminate(): void {
    this.close()
  }
}

vi.mock('ws', () => ({ default: FakeWs }))

const { TwitchIrcClient } = await import('./irc-client')

function joinLine(ws: FakeWs, channel: string): void {
  const nickLine = ws.sent.find((l) => l.startsWith('NICK '))!
  const nick = nickLine.slice(5)
  ws.serverLine(`:${nick}!${nick}@${nick}.tmi.twitch.tv JOIN #${channel}`)
}

describe('TwitchIrcClient (shared anonymous IRC)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeWs.instances = []
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function setup() {
    const client = new TwitchIrcClient()
    const messages: ChatMessage[] = []
    const roomIds: string[] = []
    const enrichCalls: (string | undefined)[] = []
    let covered = new Set<string>()
    client.setRoomIdListener((_c, id) => roomIds.push(id))
    client.setMessageEnricher((m, roomId) => {
      enrichCalls.push(roomId)
      return m
    })
    client.setEventCoverage((_c, kind) => covered.has(kind))
    const unwatch = client.watch('testnick_', {
      onMessage: (m) => messages.push(m),
      onActivity: () => undefined,
      onStatus: () => undefined
    })
    const ws = FakeWs.instances[0]!
    ws.open()
    joinLine(ws, 'testnick_')
    return { client, messages, roomIds, enrichCalls, ws, unwatch, setCovered: (s: string[]) => (covered = new Set(s)) }
  }

  it('learns room-id from ROOMSTATE without login and passes it to the emote enricher', () => {
    const { ws, roomIds, enrichCalls, messages, client } = setup()
    ws.serverLine('@emote-only=0;room-id=123456;subs-only=0 :tmi.twitch.tv ROOMSTATE #testnick_')
    expect(roomIds).toEqual(['123456'])
    expect(client.getRoomId('testnick_')).toBe('123456')
    ws.serverLine('@id=m1;user-id=5;display-name=Testnick_;room-id=123456 :testnick_!testnick_@testnick_.tmi.twitch.tv PRIVMSG #testnick_ :OMEGALUL ale akcja')
    expect(enrichCalls).toEqual(['123456'])
    expect(messages[0]?.rawText).toBe('OMEGALUL ale akcja')
    client.shutdown()
  })

  it('USERNOTICE sub/raid become event messages; suppressed when EventSub covers that kind', () => {
    const { ws, messages, setCovered, client } = setup()
    ws.serverLine('@id=u1;login=user123;display-name=User123;msg-id=sub;msg-param-sub-plan=1000;room-id=1 :tmi.twitch.tv USERNOTICE #testnick_')
    ws.serverLine('@id=u2;login=xyz;msg-param-displayName=StreamerXYZ;msg-id=raid;msg-param-viewerCount=84;room-id=1 :tmi.twitch.tv USERNOTICE #testnick_')
    expect(messages.map((m) => m.event?.kind)).toEqual(['sub', 'raid_in'])
    setCovered(['sub', 'raid_in'])
    ws.serverLine('@id=u3;login=user123;msg-id=sub;room-id=1 :tmi.twitch.tv USERNOTICE #testnick_')
    expect(messages).toHaveLength(2)
    client.shutdown()
  })

  it('PRIVMSG with bits becomes a cheer event (or is dropped when EventSub delivers cheers)', () => {
    const { ws, messages, setCovered, client } = setup()
    ws.serverLine('@id=b1;bits=500;user-id=5;display-name=User123 :user123!user123@user123.tmi.twitch.tv PRIVMSG #testnick_ :Cheer500 gg')
    expect(messages[0]?.event).toEqual({ kind: 'cheer', source: 'irc', bits: 500 })
    setCovered(['cheer'])
    ws.serverLine('@id=b2;bits=100;user-id=5 :user123!user123@user123.tmi.twitch.tv PRIVMSG #testnick_ :Cheer100')
    expect(messages).toHaveLength(1)
    client.shutdown()
  })

  it('Channel Points reward WITH text (custom-reward-id) becomes a redemption event; dropped when EventSub covers redemptions', () => {
    const { ws, messages, setCovered, client } = setup()
    client.setRewardTitleResolver((_c, id) => (id === 'r-1' ? 'Hydratacja' : undefined))
    ws.serverLine('@id=c1;custom-reward-id=r-1;user-id=5;display-name=Testnick_ :testnick_!testnick_@testnick_.tmi.twitch.tv PRIVMSG #testnick_ :Napij się wody!')
    expect(messages[0]?.event).toEqual({ kind: 'redemption', source: 'irc', rewardTitle: 'Hydratacja' })
    expect(messages[0]?.rawText).toBe('Napij się wody!')
    setCovered(['redemption'])
    ws.serverLine('@id=c2;custom-reward-id=r-1;user-id=5 :testnick_!testnick_@testnick_.tmi.twitch.tv PRIVMSG #testnick_ :drugi raz')
    expect(messages).toHaveLength(1)
    client.shutdown()
  })

  it('resolves badge images with the channel room-id and remembers real nick colours for EventSub events', () => {
    const { ws, messages, client } = setup()
    const asked: (string | undefined)[] = []
    client.setBadgeResolver((roomId, set, version) => {
      asked.push(roomId)
      return set === 'vip' ? { title: 'VIP', url1x: `https://static-cdn.jtvnw.net/badges/v1/vip/${version}` } : undefined
    })
    ws.serverLine('@id=v1;badges=vip/1;color=#1E90FF;user-id=42;room-id=555 :x!x@x.tmi.twitch.tv PRIVMSG #testnick_ :hej')
    expect(asked).toEqual(['555'])
    expect(messages[0]?.author.badges[0]).toMatchObject({ type: 'vip', imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/vip/1' })
    expect(client.getUserColor('42')).toBe('#1E90FF')
    expect(client.knownRoomIds()).toEqual(['555'])
    client.shutdown()
  })

  it('channel change: unwatching the old channel PARTs it and its messages stop arriving', () => {
    const { ws, messages, unwatch, client } = setup()
    const other: ChatMessage[] = []
    client.watch('innykanal', { onMessage: (m) => other.push(m), onActivity: () => undefined, onStatus: () => undefined })
    unwatch()
    expect(ws.sent).toContain('PART #testnick_')
    ws.serverLine('@id=x1;user-id=5 :a!a@a.tmi.twitch.tv PRIVMSG #testnick_ :stary kanał')
    ws.serverLine('@id=x2;user-id=5 :a!a@a.tmi.twitch.tv PRIVMSG #innykanal :nowy kanał')
    expect(messages).toHaveLength(0)
    expect(other.map((m) => m.rawText)).toEqual(['nowy kanał'])
    client.shutdown()
  })

  it('reconnect after a drop creates exactly one new socket, re-joins, and does not duplicate handlers', async () => {
    const { ws, messages, client } = setup()
    ws.close()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(FakeWs.instances).toHaveLength(2)
    const ws2 = FakeWs.instances[1]!
    ws2.open()
    expect(ws2.sent).toContain('JOIN #testnick_')
    joinLine(ws2, 'testnick_')
    ws2.serverLine('@id=m2;user-id=5 :a!a@a.tmi.twitch.tv PRIVMSG #testnick_ :hej')
    expect(messages).toHaveLength(1)
    // Stare gniazdo nie ma już podpiętych listenerów wiadomości.
    expect(ws.listenerCount('message')).toBe(0)
    client.shutdown()
    expect(ws2.listenerCount('message')).toBe(0)
  })

  it('watchdog forces a reconnect after 6+ minutes of complete silence', async () => {
    const { client } = setup()
    await vi.advanceTimersByTimeAsync(7 * 60_000 + 3_000)
    expect(FakeWs.instances.length).toBe(2)
    client.shutdown()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(FakeWs.instances.length).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})

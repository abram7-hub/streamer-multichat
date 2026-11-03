import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { AdapterCallbacks } from '../types'
import type { TikTokSettings } from '../../../../shared/settings'

vi.mock('../../secure-store', () => ({ loadSecret: () => undefined, SecretKeys: { tiktokEulerApiKey: 'tiktok.eulerApiKey' } }))
const { TikTokAdapter } = await import('./index')

class UserOfflineError extends Error {}

/** Atrapa TikTokLiveConnection: kontrolujemy wynik connect() i emitujemy zdarzenia jak biblioteka. */
class FakeConnection extends EventEmitter {
  disconnected = false
  constructor(
    readonly uniqueId: string,
    private readonly outcome: 'live' | 'offline'
  ) {
    super()
  }
  async connect(): Promise<void> {
    if (this.outcome === 'offline') {
      // Jak tiktok-live-connector 2.5: ten sam błąd jako zdarzenie 'error' ORAZ odrzucenie connect().
      const err = new UserOfflineError("The requested user isn't online :(")
      this.emit('error', { info: 'Error while connecting', exception: err })
      throw err
    }
  }
  async disconnect(): Promise<void> {
    this.disconnected = true
  }
}

function setup(initial: string, outcomes: Record<string, 'live' | 'offline'>) {
  const settings: TikTokSettings = { enabled: true, uniqueId: initial }
  const connections: FakeConnection[] = []
  const statuses: { state: string; channel?: string }[] = []
  const callbacks: AdapterCallbacks = {
    onMessage: vi.fn(),
    onStatus: (state, _m, channel) => statuses.push({ state, channel })
  }
  const adapter = new TikTokAdapter(() => settings, callbacks, async () => ({
    factory: (id) => {
      const c = new FakeConnection(id, outcomes[id] ?? 'offline')
      connections.push(c)
      return c
    },
    errors: { UserOfflineError: UserOfflineError as never }
  }))
  return { adapter, settings, connections, statuses, callbacks }
}

const chat = (id: string, text: string) => ({ common: { msgId: id }, content: text, user: { id: '1', displayId: 'widz', nickname: 'Widz' } })

describe('TikTokAdapter — any public @username without login', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('username/URL → connect → Połączono → chat messages', async () => {
    const { adapter, connections, statuses, callbacks } = setup('https://www.tiktok.com/@Some.User/live', { 'some.user': 'live' })
    await adapter.start()
    expect(connections[0]?.uniqueId).toBe('some.user')
    expect(statuses.map((s) => s.state)).toEqual(['connecting', 'connected'])
    connections[0]!.emit('chat', chat('1', 'hej'))
    expect(vi.mocked(callbacks.onMessage).mock.calls[0]![0].rawText).toBe('hej')
    await adapter.stop()
  })

  it('offline user → Offline status and periodic re-check that never stacks connections', async () => {
    const { adapter, connections, statuses } = setup('offline_user', {})
    await adapter.start()
    // Błąd zgłoszony podwójnie przez bibliotekę daje JEDEN status i JEDEN zaplanowany retry.
    expect(statuses.map((s) => s.state)).toEqual(['connecting', 'stream_offline'])
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(connections).toHaveLength(3)
    // Każda poprzednia próba została rozłączona i odpięta przed następną.
    expect(connections.slice(0, -1).every((c) => c.disconnected && c.listenerCount('chat') === 0)).toBe(true)
    await adapter.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(connections).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('changing the username disconnects the old connection, removes its listeners and cancels its retry — no duplicate messages', async () => {
    const { adapter, settings, connections, callbacks } = setup('first', { first: 'live', second: 'live' })
    await adapter.start()
    const old = connections[0]!
    settings.uniqueId = 'second'
    await adapter.start()
    expect(old.disconnected).toBe(true)
    expect(old.listenerCount('chat')).toBe(0)
    old.emit('chat', chat('stale', 'ze starego'))
    connections[1]!.emit('chat', chat('new', 'z nowego'))
    expect(vi.mocked(callbacks.onMessage).mock.calls.map((c) => c[0].rawText)).toEqual(['z nowego'])
    await adapter.stop()
  })

  it('after several reconnects only the current connection delivers messages', async () => {
    const { adapter, connections, callbacks } = setup('live_user', { live_user: 'live' })
    await adapter.start()
    for (let i = 0; i < 3; i++) {
      connections.at(-1)!.emit('disconnected')
      await vi.advanceTimersByTimeAsync(120_000)
    }
    expect(connections).toHaveLength(4)
    for (const c of connections) c.emit('chat', chat(`m-${connections.indexOf(c)}`, 'x'))
    expect(callbacks.onMessage).toHaveBeenCalledTimes(1)
    await adapter.stop()
  })

  it('stop() disconnects, removes listeners, clears timers and ignores late events', async () => {
    const { adapter, connections, statuses, callbacks } = setup('live_user', { live_user: 'live' })
    await adapter.start()
    connections[0]!.emit('disconnected')
    expect(vi.getTimerCount()).toBe(1)
    await adapter.stop()
    expect(connections[0]!.disconnected).toBe(true)
    expect(connections[0]!.listenerCount('chat')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(statuses.at(-1)?.state).toBe('disconnected')
    connections[0]!.emit('chat', chat('late', 'po rozłączeniu'))
    await vi.advanceTimersByTimeAsync(120_000)
    expect(callbacks.onMessage).not.toHaveBeenCalled()
    expect(connections).toHaveLength(1)
  })

  it('stream end -> Offline status and a single re-check after 30 s', async () => {
    const { adapter, connections, statuses } = setup('live_user', { live_user: 'live' })
    await adapter.start()
    connections[0]!.emit('streamEnd')
    expect(statuses.at(-1)?.state).toBe('stream_offline')
    await vi.advanceTimersByTimeAsync(29_000)
    expect(connections).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(connections).toHaveLength(2)
    expect(connections[0]!.disconnected).toBe(true)
    await adapter.stop()
  })

  it('disabled in settings -> no connection', async () => {
    const { adapter, settings, connections, statuses } = setup('live_user', { live_user: 'live' })
    settings.enabled = false
    await adapter.start()
    expect(connections).toHaveLength(0)
    expect(statuses.at(-1)?.state).toBe('disconnected')
  })

  it('invalid username → error without connecting', async () => {
    const { adapter, connections, statuses } = setup('@@ not valid', {})
    await adapter.start()
    expect(statuses.at(-1)?.state).toBe('error')
    expect(connections).toHaveLength(0)
  })
})

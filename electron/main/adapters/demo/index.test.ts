import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterCallbacks } from '../types'
import { DemoAdapter } from './index'

const INTERVAL_MS = 1500

function setup() {
  const callbacks: AdapterCallbacks = { onMessage: vi.fn(), onStatus: vi.fn() }
  const adapter = new DemoAdapter(callbacks, () => '')
  const count = (): number => vi.mocked(callbacks.onMessage).mock.calls.length
  return { adapter, callbacks, count }
}

describe('DemoAdapter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('DEMO_INTERVAL_MS', '')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('A: not started -> no messages and no timers', async () => {
    const { count, adapter } = setup()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)
    expect(count()).toBe(0)
    expect(adapter.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('B: started -> one demo message per interval, all marked as demo', async () => {
    const { adapter, callbacks, count } = setup()
    await adapter.start()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4)
    expect(count()).toBe(4)
    expect(vi.mocked(callbacks.onMessage).mock.calls.every(([m]) => m.isDemo === true)).toBe(true)
    await adapter.stop()
  })

  it('C: stop() -> the message count stops growing immediately', async () => {
    const { adapter, count } = setup()
    await adapter.start()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)
    await adapter.stop()
    const afterStop = count()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 20)
    expect(count()).toBe(afterStop)
    expect(adapter.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start() called again while running does not create a second generator', async () => {
    // Odtworzenie błędu: start() przy każdej zmianie ustawień dokładał kolejny setInterval.
    const { adapter, count } = setup()
    await adapter.start()
    await adapter.start()
    await adapter.start()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4)
    expect(count()).toBe(4)
    await adapter.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)
    expect(count()).toBe(4)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('D: ON -> OFF -> ON runs exactly one generator at the original rate', async () => {
    const { adapter, count } = setup()
    await adapter.start()
    await adapter.stop()
    await adapter.start()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5)
    expect(count()).toBe(5)
    await adapter.stop()
  })

  it('E: ON -> OFF -> ON -> OFF leaves no generator timer', async () => {
    const { adapter, count } = setup()
    for (let i = 0; i < 2; i++) {
      await adapter.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      await adapter.stop()
    }
    expect(vi.getTimerCount()).toBe(0)
    const finalCount = count()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 20)
    expect(count()).toBe(finalCount)
  })
})

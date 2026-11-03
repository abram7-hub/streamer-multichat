import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterCallbacks } from './adapters/types'
import { DemoAdapter } from './adapters/demo'
import { ConnectionModeController } from './connection-mode'

const INTERVAL_MS = 1500

/** Kontroler z prawdziwym DemoAdapterem i atrapą prawdziwych adapterów, których stop() trwa chwilę. */
function setup(initialDemoMode: boolean) {
  const settings = { demoMode: initialDemoMode }
  const callbacks: AdapterCallbacks = { onMessage: vi.fn(), onStatus: vi.fn() }
  const demo = new DemoAdapter(callbacks, () => '')
  const real = { running: false, starts: 0 }
  const controller = new ConnectionModeController({
    isDemoMode: () => settings.demoMode,
    startDemo: () => demo.start(),
    stopDemo: () => demo.stop(),
    stopRealAdapters: async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      real.running = false
    },
    startRealAdapters: () => {
      real.running = true
      real.starts += 1
    }
  })
  const demoMessages = (): number => vi.mocked(callbacks.onMessage).mock.calls.length
  return { settings, demo, real, controller, demoMessages }
}

describe('ConnectionModeController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('DEMO_INTERVAL_MS', '')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('H: persisted demoMode OFF -> generator never starts after app restart', async () => {
    const { demo, real, controller, demoMessages } = setup(false)
    await controller.apply()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)
    expect(demo.isRunning()).toBe(false)
    expect(demoMessages()).toBe(0)
    expect(real.running).toBe(true)
  })

  it('settings changes while demo is ON keep a single generator; OFF stops it completely', async () => {
    const { settings, demo, controller, demoMessages } = setup(true)
    // Każda zmiana ustawień w aplikacji woła apply() - wcześniej każda dokładała timer.
    const runs = Array.from({ length: 5 }, () => controller.apply())
    await vi.advanceTimersByTimeAsync(500)
    await Promise.all(runs)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)
    expect(demoMessages()).toBe(3)

    settings.demoMode = false
    await controller.apply()
    expect(demo.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)
    expect(demoMessages()).toBe(3)
  })

  it('ON immediately followed by OFF ends with demo stopped and real adapters running', async () => {
    const { settings, demo, real, controller, demoMessages } = setup(false)
    settings.demoMode = true
    const on = controller.apply()
    settings.demoMode = false
    const off = controller.apply()
    await vi.advanceTimersByTimeAsync(200)
    await Promise.all([on, off])
    expect(demo.isRunning()).toBe(false)
    expect(real.running).toBe(true)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)
    expect(demoMessages()).toBe(0)
  })

  it('ON -> OFF -> ON -> OFF in quick succession leaves no generator timer', async () => {
    const { settings, demo, controller, demoMessages } = setup(false)
    const runs: Promise<void>[] = []
    for (const value of [true, false, true, false]) {
      settings.demoMode = value
      runs.push(controller.apply())
    }
    await vi.advanceTimersByTimeAsync(500)
    await Promise.all(runs)
    expect(demo.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 10)
    expect(demoMessages()).toBe(0)
  })

  it('a failing switch does not block later switches', async () => {
    const { settings, demo } = setup(true)
    const failing = new ConnectionModeController({
      isDemoMode: () => settings.demoMode,
      startDemo: async () => {
        throw new Error('boom')
      },
      stopDemo: () => demo.stop(),
      stopRealAdapters: async () => undefined,
      startRealAdapters: () => undefined
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(failing.apply()).rejects.toThrow('boom')
    settings.demoMode = false
    await expect(failing.apply()).resolves.toBeUndefined()
  })
})

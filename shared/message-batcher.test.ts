import { describe, expect, it, vi } from 'vitest'
import { MessageBatcher } from './message-batcher'

/** Symuluje np. requestAnimationFrame: zapamiętuje callback zamiast wywoływać go od razu. */
function manualScheduler(): { schedule: (flush: () => void) => void; trigger: () => void; calls: number } {
  let pendingFlush: (() => void) | undefined
  let calls = 0
  return {
    schedule: (flush) => {
      calls++
      pendingFlush = flush
    },
    trigger: () => {
      const flush = pendingFlush
      pendingFlush = undefined
      flush?.()
    },
    get calls() {
      return calls
    }
  }
}

describe('MessageBatcher', () => {
  it('coalesces multiple pushes before a flush into a single onFlush call', () => {
    const scheduler = manualScheduler()
    const onFlush = vi.fn()
    const batcher = new MessageBatcher<number>(scheduler.schedule, onFlush)

    batcher.push(1)
    batcher.push(2)
    batcher.push(3)
    expect(onFlush).not.toHaveBeenCalled()
    expect(batcher.pending).toBe(3)

    scheduler.trigger()
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith([1, 2, 3])
    expect(batcher.pending).toBe(0)
  })

  it('only schedules once per pending batch, not once per push (idle cost stays flat under bursty input)', () => {
    const scheduler = manualScheduler()
    const batcher = new MessageBatcher<number>(scheduler.schedule, () => undefined)
    for (let i = 0; i < 50; i++) batcher.push(i)
    expect(scheduler.calls).toBe(1)
  })

  it('schedules again for a new batch after the previous one flushed', () => {
    const scheduler = manualScheduler()
    const onFlush = vi.fn()
    const batcher = new MessageBatcher<number>(scheduler.schedule, onFlush)

    batcher.push(1)
    scheduler.trigger()
    batcher.push(2)
    scheduler.trigger()

    expect(onFlush).toHaveBeenNthCalledWith(1, [1])
    expect(onFlush).toHaveBeenNthCalledWith(2, [2])
  })

  it('never schedules or flushes when idle (no items pushed)', () => {
    const scheduler = manualScheduler()
    const onFlush = vi.fn()
    // eslint-disable-next-line no-new
    new MessageBatcher<number>(scheduler.schedule, onFlush)
    expect(scheduler.calls).toBe(0)
    expect(onFlush).not.toHaveBeenCalled()
  })

  it('does not lose items: a high-volume burst (50 msg/s worth) all arrive in the flushed batch', () => {
    const scheduler = manualScheduler()
    let received: number[] = []
    const batcher = new MessageBatcher<number>(scheduler.schedule, (batch) => {
      received = received.concat(batch)
    })
    for (let i = 0; i < 200; i++) batcher.push(i)
    scheduler.trigger()
    expect(received).toHaveLength(200)
    expect(received).toEqual(Array.from({ length: 200 }, (_, i) => i))
  })
})

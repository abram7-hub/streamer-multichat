import { describe, expect, it } from 'vitest'
import { ExponentialBackoff } from './backoff'

describe('ExponentialBackoff', () => {
  it('starts at the minimum delay', () => {
    const backoff = new ExponentialBackoff(1000, 30_000)
    expect(backoff.next()).toBe(1000)
  })

  it('doubles the delay on each successive failure', () => {
    const backoff = new ExponentialBackoff(1000, 30_000)
    expect(backoff.next()).toBe(1000)
    expect(backoff.next()).toBe(2000)
    expect(backoff.next()).toBe(4000)
    expect(backoff.next()).toBe(8000)
  })

  it('caps the delay at the configured maximum', () => {
    const backoff = new ExponentialBackoff(1000, 5000)
    backoff.next() // 1000
    backoff.next() // 2000
    backoff.next() // 4000
    expect(backoff.next()).toBe(5000)
    expect(backoff.next()).toBe(5000)
  })

  it('resets back to the minimum after a successful connection', () => {
    const backoff = new ExponentialBackoff(1000, 30_000)
    backoff.next()
    backoff.next()
    backoff.reset()
    expect(backoff.next()).toBe(1000)
  })
})

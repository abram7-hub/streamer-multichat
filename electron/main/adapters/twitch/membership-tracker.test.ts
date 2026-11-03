import { describe, expect, it } from 'vitest'
import { MembershipTracker } from './membership-tracker'

describe('MembershipTracker', () => {
  it('suppresses the initial JOIN burst right after (re)connecting', () => {
    const tracker = new MembershipTracker()
    tracker.startBurstWindow(1000, 4000)
    expect(tracker.handleJoin('widz1', 1000)).toBe(false)
    expect(tracker.handleJoin('widz2', 4999)).toBe(false)
  })

  it('emits JOIN events once the burst window has elapsed', () => {
    const tracker = new MembershipTracker()
    tracker.startBurstWindow(1000, 4000)
    expect(tracker.handleJoin('widz3', 5000)).toBe(true)
  })

  it('does not emit a duplicate JOIN for a user already tracked as present', () => {
    const tracker = new MembershipTracker()
    tracker.startBurstWindow(0, 0)
    expect(tracker.handleJoin('widz1', 10)).toBe(true)
    expect(tracker.handleJoin('widz1', 20)).toBe(false)
  })

  it('only emits PART for a user that was actually tracked as joined', () => {
    const tracker = new MembershipTracker()
    tracker.startBurstWindow(0, 0)
    expect(tracker.handlePart('ghost', 10)).toBe(false)
    tracker.handleJoin('widz1', 10)
    expect(tracker.handlePart('widz1', 20)).toBe(true)
  })

  it('allows a real rejoin after a part to be emitted again', () => {
    const tracker = new MembershipTracker()
    tracker.startBurstWindow(0, 0)
    tracker.handleJoin('widz1', 10)
    tracker.handlePart('widz1', 20)
    expect(tracker.handleJoin('widz1', 30)).toBe(true)
  })

  it('resets tracked membership on reconnect so a fresh burst does not spam parts', () => {
    const tracker = new MembershipTracker()
    tracker.startBurstWindow(0, 0)
    tracker.handleJoin('widz1', 10)
    // reconnect: burst window restarts and clears prior membership
    tracker.startBurstWindow(1000, 4000)
    expect(tracker.handlePart('widz1', 1500)).toBe(false)
    expect(tracker.handleJoin('widz1', 1500)).toBe(false)
  })
})

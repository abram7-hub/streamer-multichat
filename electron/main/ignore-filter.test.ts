import { describe, expect, it } from 'vitest'
import { isIgnored } from './ignore-filter'
import type { IgnoreLists } from '../../shared/settings'

function lists(overrides: Partial<IgnoreLists> = {}): IgnoreLists {
  return {
    twitch: { enabled: true, users: [] },
    kick: { enabled: true, users: [] },
    youtube: { enabled: true, users: [] },
    tiktok: { enabled: true, users: [] },
    ...overrides
  }
}

describe('isIgnored', () => {
  it('returns false when the list is empty', () => {
    expect(isIgnored({ id: '1', username: 'widz' }, 'twitch', lists())).toBe(false)
  })

  it('returns false when filtering is disabled for that platform, even with matching entries', () => {
    const l = lists({ twitch: { enabled: false, users: [{ username: 'widz' }] } })
    expect(isIgnored({ id: '1', username: 'widz' }, 'twitch', l)).toBe(false)
  })

  it('matches by username case-insensitively when no id is stored', () => {
    const l = lists({ twitch: { enabled: true, users: [{ username: 'Widz_Zly' }] } })
    expect(isIgnored({ id: '1', username: 'widz_zly' }, 'twitch', l)).toBe(true)
  })

  it('matches by stable id even if the username has changed since it was ignored', () => {
    const l = lists({ twitch: { enabled: true, users: [{ id: '123', username: 'stary_nick' }] } })
    expect(isIgnored({ id: '123', username: 'nowy_nick' }, 'twitch', l)).toBe(true)
  })

  it('does NOT match by leftover username when the id is stored but differs (prevents a renamed different user from being caught)', () => {
    const l = lists({ twitch: { enabled: true, users: [{ id: '123', username: 'stary_nick' }] } })
    expect(isIgnored({ id: '456', username: 'stary_nick' }, 'twitch', l)).toBe(false)
  })

  it('keeps ignore lists independent per platform', () => {
    const l = lists({ twitch: { enabled: true, users: [{ username: 'troll' }] } })
    expect(isIgnored({ id: '1', username: 'troll' }, 'kick', l)).toBe(false)
  })

  it('falls back to username matching when author id is the "unknown" placeholder', () => {
    const l = lists({ tiktok: { enabled: true, users: [{ id: '999', username: 'widz' }] } })
    expect(isIgnored({ id: 'unknown', username: 'widz' }, 'tiktok', l)).toBe(true)
  })
})

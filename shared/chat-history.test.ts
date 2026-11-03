import { describe, expect, it } from 'vitest'
import {
  appendCapped,
  countNewerThan,
  distanceFromNewest,
  isFollowingNewest,
  lastMessageKey,
  MAX_PINNED,
  messageKey,
  newMessagesArrow,
  newMessagesLabel,
  nextAutoScroll,
  togglePinned
} from './chat-history'
import { chatLayout } from './appearance'
import type { ChatMessage } from './chat-message'

const m = (id: string): ChatMessage =>
  ({ id, platform: 'twitch', rawText: id, author: { displayName: id }, isHighlighted: false }) as unknown as ChatMessage

describe('autoscroll', () => {
  it('scrolling away from the newest edge stops following; back at the edge follows again', () => {
    // Najnowsze na dole: odległość od dolnej krawędzi.
    expect(distanceFromNewest({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }, false)).toBe(0)
    expect(distanceFromNewest({ scrollTop: 200, scrollHeight: 1000, clientHeight: 400 }, false)).toBe(400)
    // Najnowsze na górze: odległość od górnej krawędzi.
    expect(distanceFromNewest({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }, true)).toBe(0)
    expect(distanceFromNewest({ scrollTop: 300, scrollHeight: 1000, clientHeight: 400 }, true)).toBe(300)
  })

  it('pause on hover (off by default) stops following only while the cursor is over the chat', () => {
    expect(isFollowingNewest(true, false, true)).toBe(true) // opcja wyłączona
    expect(isFollowingNewest(true, true, true)).toBe(false)
    expect(isFollowingNewest(true, true, false)).toBe(true)
    expect(isFollowingNewest(false, true, false)).toBe(false) // przewinięte w historię
  })

  it('counts messages that arrived after the pause point', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map(m)
    expect(countNewerThan(list, messageKey(list[4]!))).toBe(0)
    expect(countNewerThan(list, messageKey(list[1]!))).toBe(3)
    // Kotwica wypadła z pamięci (limit historii) - wszystkie widoczne są nowe.
    expect(countNewerThan(list, 'twitch:gone')).toBe(5)
    // Zatrzymanie przy pustym czacie.
    expect(countNewerThan(list, lastMessageKey([]))).toBe(5)
    expect(lastMessageKey(list)).toBe('twitch:e')
  })

  it('"N nowych wiadomości" in correct Polish', () => {
    expect(newMessagesLabel(1)).toBe('1 nowa wiadomość')
    expect(newMessagesLabel(2)).toBe('2 nowe wiadomości')
    expect(newMessagesLabel(4)).toBe('4 nowe wiadomości')
    expect(newMessagesLabel(5)).toBe('5 nowych wiadomości')
    expect(newMessagesLabel(12)).toBe('12 nowych wiadomości')
    expect(newMessagesLabel(22)).toBe('22 nowe wiadomości')
    expect(newMessagesLabel(114)).toBe('114 nowych wiadomości')
  })

  it('the arrow points to where new messages appear (↓ newest at the bottom, ↑ newest on top)', () => {
    expect(newMessagesArrow(chatLayout({ stackAnchor: 'top', newMessagePosition: 'end' }).newestFirst)).toBe('↓')
    expect(newMessagesArrow(chatLayout({ stackAnchor: 'bottom', newMessagePosition: 'anchor' }).newestFirst)).toBe('↓')
    expect(newMessagesArrow(chatLayout({ stackAnchor: 'top', newMessagePosition: 'anchor' }).newestFirst)).toBe('↑')
    expect(newMessagesArrow(chatLayout({ stackAnchor: 'bottom', newMessagePosition: 'end' }).newestFirst)).toBe('↑')
  })
})

describe('pinned messages', () => {
  it('pin and unpin the same message; references, not copies', () => {
    const a = m('a')
    const pinned = togglePinned([], a)
    expect(pinned).toEqual([a])
    expect(pinned[0]).toBe(a)
    expect(togglePinned(pinned, { ...a })).toEqual([]) // to samo platform:id
  })

  it('a small section: oldest pin drops out past the limit', () => {
    let pinned: ChatMessage[] = []
    for (let i = 0; i < MAX_PINNED + 3; i++) pinned = togglePinned(pinned, m(`p${i}`))
    expect(pinned).toHaveLength(MAX_PINNED)
    expect(pinned[0]!.id).toBe('p3')
  })

  it('appendCapped keeps the newest entries and returns the same list for an empty batch', () => {
    const list = [1, 2, 3]
    expect(appendCapped(list, [], 2)).toBe(list)
    expect(appendCapped(list, [4, 5], 4)).toEqual([2, 3, 4, 5])
  })
})

describe('nextAutoScroll', () => {
  it('only a user gesture stops following; reaching the newest edge always resumes', () => {
    expect(nextAutoScroll(true, 500, 40, true)).toBe(false) // użytkownik przewinął w historię
    expect(nextAutoScroll(true, 500, 40, false)).toBe(true) // strona przesunęła widok (np. obrazek) - czat nie staje
    expect(nextAutoScroll(false, 500, 40, false)).toBe(false) // nadal w historii - bez samoczynnego powrotu
    expect(nextAutoScroll(false, 10, 40, true)).toBe(true) // użytkownik wrócił do najnowszych
    expect(nextAutoScroll(false, 10, 40, false)).toBe(true)
  })
})

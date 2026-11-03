import type { ChatMessage } from './chat-message'

/** Ile wiadomości można przypiąć naraz (mała sekcja, nie system zakładek). */
export const MAX_PINNED = 10

export const messageKey = (m: Pick<ChatMessage, 'platform' | 'id'>): string => `${m.platform}:${m.id}`

/** Dopisuje na koniec i obcina najstarsze ponad limit. Zwraca nową tablicę (stan zustand). */
export function appendCapped<T>(list: readonly T[], items: readonly T[], cap: number): T[] {
  if (items.length === 0) return list as T[]
  const next = list.concat(items)
  if (next.length > cap) next.splice(0, next.length - cap)
  return next
}

/**
 * Przypina albo odpina wiadomość. Lista trzyma referencje do tych samych obiektów co historia
 * czatu (bez kopii); po przekroczeniu limitu odpada najstarsza przypięta.
 */
export function togglePinned(pinned: readonly ChatMessage[], message: ChatMessage, max = MAX_PINNED): ChatMessage[] {
  const key = messageKey(message)
  if (pinned.some((m) => messageKey(m) === key)) return pinned.filter((m) => messageKey(m) !== key)
  return appendCapped(pinned, [message], max)
}

/** Odmiana "N nowych wiadomości" (1 nowa wiadomość, 2-4 nowe wiadomości, 5+ nowych wiadomości). */
export function newMessagesLabel(count: number): string {
  if (count === 1) return '1 nowa wiadomość'
  const lastTwo = count % 100
  const last = count % 10
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} nowe wiadomości`
  return `${count} nowych wiadomości`
}

/** Strzałka przycisku powrotu: w stronę, gdzie pojawiają się najnowsze wiadomości. */
export function newMessagesArrow(newestFirst: boolean): '↑' | '↓' {
  return newestFirst ? '↑' : '↓'
}

/**
 * Ile wiadomości przyszło po wiadomości `anchorKey` (najnowszej w chwili zatrzymania
 * autoprzewijania). Liczy od końca listy, więc koszt zależy od liczby nowych, nie całej historii.
 * Gdy kotwica wypadła już z pamięci (limit historii) - wszystkie są nowe.
 */
export function countNewerThan(messages: readonly Pick<ChatMessage, 'platform' | 'id'>[], anchorKey: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messageKey(messages[i]!) === anchorKey) return messages.length - 1 - i
  }
  return messages.length
}

export function lastMessageKey(messages: readonly Pick<ChatMessage, 'platform' | 'id'>[]): string {
  const last = messages[messages.length - 1]
  return last ? messageKey(last) : ''
}

/** Odległość widoku od krawędzi z najnowszymi wiadomościami (górnej lub dolnej - wg kolejności). */
export function distanceFromNewest(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, newestFirst: boolean): number {
  return newestFirst ? el.scrollTop : el.scrollHeight - el.scrollTop - el.clientHeight
}

/** Czy czat ma sam przewijać do najnowszych: nie po przewinięciu w historię i nie przy kursorze nad czatem (opcja). */
export function isFollowingNewest(autoScroll: boolean, pauseOnHover: boolean, hovered: boolean): boolean {
  return autoScroll && !(pauseOnHover && hovered)
}

/**
 * Nowy stan autoprzewijania po zdarzeniu przewinięcia: przy krawędzi z najnowszymi zawsze włączone;
 * dalej od niej wyłącza je tylko ruch użytkownika, a nie przesunięcie wywołane przez samą stronę.
 */
export function nextAutoScroll(current: boolean, distance: number, threshold: number, userGesture: boolean): boolean {
  if (distance < threshold) return true
  return userGesture ? false : current
}

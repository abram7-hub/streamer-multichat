/**
 * Śledzi stan "kto jest w pokoju IRC" i decyduje, czy dane zdarzenie JOIN/PART powinno zostać pokazane
 * użytkownikowi. Wydzielone z `membership.ts` jako czysta logika (bez WebSocketu), żeby dało się ją
 * przetestować jednostkowo bez prawdziwego połączenia z Twitch IRC.
 *
 * Dwa problemy, które to rozwiązuje:
 * 1. Zaraz po dołączeniu do kanału IRC Twitch wysyła "burst" JOIN dla wszystkich obecnych - to NIE są
 *    nowe dołączenia, tylko chwilowy stan początkowy (roster). Trzeba je wyciszyć na krótkie okno.
 * 2. Przy ponownym połączeniu (np. po zerwaniu sieci) ten sam burst powtórzyłby się dla wszystkich
 *    użytkowników już wcześniej pokazanych - stąd też tłumione przez `startBurstWindow`.
 */
export class MembershipTracker {
  private readonly inRoom = new Set<string>()
  private burstUntilMs = 0

  /** Wywoływane zaraz po (re)połączeniu - kolejne `durationMs` JOIN/PART nie są traktowane jako nowe zdarzenia. */
  startBurstWindow(nowMs: number, durationMs: number): void {
    this.burstUntilMs = nowMs + durationMs
    this.inRoom.clear()
  }

  /** Zwraca true, jeśli to dołączenie powinno zostać pokazane użytkownikowi. */
  handleJoin(username: string, nowMs: number): boolean {
    const alreadyIn = this.inRoom.has(username)
    this.inRoom.add(username)
    if (alreadyIn) return false
    return nowMs >= this.burstUntilMs
  }

  /** Zwraca true, jeśli to opuszczenie powinno zostać pokazane użytkownikowi. */
  handlePart(username: string, nowMs: number): boolean {
    const wasIn = this.inRoom.delete(username)
    if (!wasIn) return false
    return nowMs >= this.burstUntilMs
  }
}

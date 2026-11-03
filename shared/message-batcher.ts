/**
 * Łączy szybko napływające elementy (np. wiadomości czatu z kilku kanałów naraz) w krótkie paczki,
 * zamiast wywoływać kosztowną aktualizację stanu/renderowania dla każdego elementu osobno. Bez tego
 * przy 20-50 wiadomościach/s każda z nich osobno wywołuje aktualizację store'u Zustand i pełny
 * przebieg reconciliation Reacta - przy dużym ruchu to dziesiątki zbędnych re-renderów na sekundę.
 *
 * Zero kosztu w spoczynku: `schedule()` (np. `requestAnimationFrame`) wywoływane jest TYLKO gdy coś
 * czeka w kolejce, nigdy jako pętla odpytująca - gdy nie przychodzą nowe elementy, batcher nic nie
 * robi. Kolejny `schedule()` następuje dopiero po opróżnieniu poprzedniej paczki i nadejściu nowego
 * elementu, więc nie ma ryzyka "zgubienia" elementów ani nieograniczonego opóźnienia.
 */
export class MessageBatcher<T> {
  private queue: T[] = []
  private scheduled = false

  constructor(
    private readonly schedule: (flush: () => void) => void,
    private readonly onFlush: (batch: T[]) => void
  ) {}

  push(item: T): void {
    this.queue.push(item)
    if (!this.scheduled) {
      this.scheduled = true
      this.schedule(() => this.flush())
    }
  }

  /** Liczba elementów aktualnie oczekujących w kolejce (do testów/diagnostyki). */
  get pending(): number {
    return this.queue.length
  }

  private flush(): void {
    this.scheduled = false
    if (this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    this.onFlush(batch)
  }
}

/** Prosty licznik opóźnień wykładniczych z górnym limitem, używany przy ponownych połączeniach. */
export class ExponentialBackoff {
  private current: number

  constructor(
    private readonly minMs: number,
    private readonly maxMs: number
  ) {
    this.current = minMs
  }

  /** Zwraca bieżące opóźnienie (ms) i podwaja je (z ograniczeniem do maxMs) na następne wywołanie. */
  next(): number {
    const delay = this.current
    this.current = Math.min(this.current * 2, this.maxMs)
    return delay
  }

  reset(): void {
    this.current = this.minMs
  }
}

const DEFAULT_TIMEOUT_MS = 10_000
/** Twardy limit rozmiaru odpowiedzi - lista emotek kanału to typowo < 2 MB. Chroni RAM przed
 *  wadliwą/wrogą odpowiedzią. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/**
 * GET JSON z limitem czasu i rozmiaru. Zwraca:
 *  - sparsowany JSON przy sukcesie,
 *  - `null` przy 404, jeśli `notFoundOk` (np. kanał bez konta 7TV/BTTV),
 *  - `undefined` przy każdym innym błędzie (sieć, timeout, HTTP 5xx, niepoprawny JSON).
 * Nigdy nie rzuca - błędy zewnętrznych API nie mogą wywrócić aplikacji.
 */
export async function fetchJson(url: string, opts: { notFoundOk?: boolean; timeoutMs?: number } = {}): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) })
    if (res.status === 404 && opts.notFoundOk) return null
    if (!res.ok) {
      console.warn(`[emotes] ${url} → HTTP ${res.status}`)
      return undefined
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_BODY_BYTES) return undefined
    const text = await res.text()
    if (text.length > MAX_BODY_BYTES) return undefined
    return JSON.parse(text) as unknown
  } catch (err) {
    console.warn(`[emotes] ${url} → ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

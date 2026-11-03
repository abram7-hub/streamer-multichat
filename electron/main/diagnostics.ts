import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'

export type DiagnosticFields = Record<string, string | number | boolean | undefined>

const MAX_FILE_BYTES = 256 * 1024
const MAX_EVENTS_PER_MINUTE = 20
const MAX_VALUE_LENGTH = 80

/**
 * Jedna linia diagnostyki: czas, nazwa zdarzenia i krótkie pola techniczne (typ procesu, powód,
 * kod wyjścia). Wartości są skracane i oczyszczane ze znaków nowej linii - do logu nie trafiają
 * treści wiadomości, tokeny ani ścieżki, bo wywołujący przekazuje wyłącznie takie pola.
 */
export function formatDiagnostic(event: string, fields: DiagnosticFields, now: Date): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_').slice(0, MAX_VALUE_LENGTH)}`)
  return [now.toISOString(), event, ...parts].join(' ')
}

/**
 * Lekki log zdarzeń awaryjnych (renderer, procesy potomne, brak odpowiedzi okna). Limit zdarzeń na
 * minutę chroni przed zalaniem logu w pętli awarii, a plik ma stały maksymalny rozmiar (jedna kopia
 * zapasowa .1).
 */
export class DiagnosticsLog {
  private windowStart = 0
  private eventsInWindow = 0
  private suppressed = 0
  private writes: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: () => string,
    private readonly now: () => Date = () => new Date(),
    private readonly echo: (line: string) => void = (line) => console.error(`[diag] ${line}`)
  ) {}

  record(event: string, fields: DiagnosticFields = {}): void {
    const now = this.now()
    if (now.getTime() - this.windowStart >= 60_000) {
      if (this.suppressed > 0) this.emit(formatDiagnostic('diagnostics-suppressed', { count: this.suppressed }, now))
      this.windowStart = now.getTime()
      this.eventsInWindow = 0
      this.suppressed = 0
    }
    if (this.eventsInWindow >= MAX_EVENTS_PER_MINUTE) {
      this.suppressed += 1
      return
    }
    this.eventsInWindow += 1
    this.emit(formatDiagnostic(event, fields, now))
  }

  /** Czeka na zapisanie wszystkich linii (używane przy zamykaniu aplikacji i w testach). */
  flush(): Promise<void> {
    return this.writes
  }

  private emit(line: string): void {
    this.echo(line)
    this.writes = this.writes.then(() => this.append(line)).catch(() => undefined)
  }

  private async append(line: string): Promise<void> {
    const file = this.filePath()
    await mkdir(dirname(file), { recursive: true })
    const size = await stat(file).then((s) => s.size, () => 0)
    if (size > MAX_FILE_BYTES) await rename(file, `${file}.1`)
    await appendFile(file, `${line}\n`, 'utf8')
  }
}

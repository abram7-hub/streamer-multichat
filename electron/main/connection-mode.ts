export interface ConnectionModeDeps {
  isDemoMode: () => boolean
  startDemo: () => Promise<void>
  stopDemo: () => Promise<void>
  stopRealAdapters: () => Promise<void>
  startRealAdapters: () => void
}

/**
 * Przełącza między trybem demo a prawdziwymi adapterami. Wywołania są wykonywane po kolei: każde
 * czyta aktualny stan ustawień dopiero w chwili wykonania, więc szybkie ON -> OFF (np. dwa kliknięcia
 * albo zmiana ustawień w trakcie przełączania) zawsze kończy się stanem zgodnym z ostatnim zapisem,
 * a nie z kolejnością, w jakiej skończyły się asynchroniczne stop()/start().
 */
export class ConnectionModeController {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: ConnectionModeDeps) {}

  apply(): Promise<void> {
    const run = this.queue.then(() => this.run())
    this.queue = run.catch((err: unknown) => {
      console.error('[connection-mode] przełączanie trybu nie powiodło się:', err)
    })
    return run
  }

  private async run(): Promise<void> {
    if (this.deps.isDemoMode()) {
      await this.deps.stopRealAdapters()
      await this.deps.startDemo()
      return
    }
    await this.deps.stopDemo()
    this.deps.startRealAdapters()
  }
}

import type { ChatMessage } from './chat-message'

/** Czas łagodnego wygaszania wiadomości przed usunięciem z widoku (musi pasować do CSS). */
export const GAMING_FADE_MS = 450

export interface GamingFeedItem {
  key: string
  message: ChatMessage
  /** Wiadomość wygasa - wiersz jest wygaszany i za chwilę zniknie z widoku. */
  leaving: boolean
}

interface Entry extends GamingFeedItem {
  addedAt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export interface GamingFeedOptions {
  /** 0 = wiadomości nie wygasają. */
  lifetimeMs: number
  maxVisible: number
}

/**
 * Widok wiadomości Gaming Overlay: wyłącznie stan prezentacji. Trzyma referencje do wiadomości
 * z centralnego strumienia, nigdy ich nie zmienia i nie usuwa z czatu głównego, historii ani OBS -
 * wygaśnięcie usuwa wiadomość tylko z tej listy. Każda widoczna wiadomość ma co najwyżej jeden
 * aktywny timer (wygaśnięcie albo koniec wygaszania), czyszczony przy usunięciu.
 */
export class GamingFeed {
  private entries: Entry[] = []
  private options: GamingFeedOptions

  constructor(
    options: GamingFeedOptions,
    private readonly onChange: (items: readonly GamingFeedItem[]) => void,
    private readonly now: () => number = () => Date.now()
  ) {
    this.options = options
  }

  add(message: ChatMessage): void {
    this.addMany([message])
  }

  /** Paczka wiadomości z jednym powiadomieniem widoku (jak paczki w czacie głównym i OBS). */
  addMany(messages: readonly ChatMessage[]): void {
    let added = false
    for (const message of messages) {
      const key = `${message.platform}:${message.id}`
      if (this.entries.some((e) => e.key === key)) continue
      const entry: Entry = { key, message, leaving: false, addedAt: this.now(), timer: undefined }
      this.entries.push(entry)
      this.schedule(entry)
      added = true
    }
    if (!added) return
    this.trim()
    this.emit()
  }

  setOptions(options: GamingFeedOptions): void {
    const lifetimeChanged = options.lifetimeMs !== this.options.lifetimeMs
    this.options = options
    if (lifetimeChanged) for (const entry of this.entries) if (!entry.leaving) this.schedule(entry)
    this.trim()
    this.emit()
  }

  items(): readonly GamingFeedItem[] {
    return this.entries.map(({ key, message, leaving }) => ({ key, message, leaving }))
  }

  /** Liczba aktywnych timerów - do testów i diagnostyki. */
  activeTimers(): number {
    return this.entries.filter((e) => e.timer !== undefined).length
  }

  dispose(): void {
    for (const entry of this.entries) this.clearTimer(entry)
    this.entries = []
  }

  private schedule(entry: Entry): void {
    this.clearTimer(entry)
    if (this.options.lifetimeMs <= 0) return
    const remaining = Math.max(0, entry.addedAt + this.options.lifetimeMs - this.now())
    entry.timer = setTimeout(() => this.startLeaving(entry), remaining)
  }

  private startLeaving(entry: Entry): void {
    entry.timer = undefined
    if (!this.entries.includes(entry)) return
    entry.leaving = true
    entry.timer = setTimeout(() => this.remove(entry), GAMING_FADE_MS)
    this.emit()
  }

  /** Ponad limit widocznych: najstarsze wiadomości znikają od razu (bez wygaszania). */
  private trim(): void {
    while (this.entries.length > this.options.maxVisible) {
      const oldest = this.entries.shift()
      if (oldest) this.clearTimer(oldest)
    }
  }

  private remove(entry: Entry): void {
    this.clearTimer(entry)
    const index = this.entries.indexOf(entry)
    if (index === -1) return
    this.entries.splice(index, 1)
    this.emit()
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.timer = undefined
  }

  private emit(): void {
    this.onChange(this.items())
  }
}

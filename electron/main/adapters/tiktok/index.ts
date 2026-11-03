import type { TikTokSettings } from '../../../../shared/settings'
import { parseTikTokInput } from '../../../../shared/channel-input'
import type { AdapterCallbacks, PlatformAdapter } from '../types'
import { loadSecret, SecretKeys } from '../../secure-store'
import {
  normalizeTikTokGift,
  normalizeTikTokMessage,
  normalizeTikTokSubscribe,
  type TikTokChatEvent,
  type TikTokGiftEvent
} from './normalize'
import { ExponentialBackoff } from '../common/backoff'

const OFFLINE_RETRY_MS = 30_000
const MIN_ERROR_RETRY_MS = 15_000
const MAX_ERROR_RETRY_MS = 120_000

// Minimalny kontrakt typu z tiktok-live-connector - biblioteka jest zewnętrzna
// i nieoficjalna, więc trzymamy tu tylko to, czego faktycznie używamy.
export interface TikTokLiveConnectionLike {
  connect(): Promise<unknown>
  disconnect(): Promise<void> | void
  on(event: string, handler: (payload: unknown) => void): void
  removeAllListeners?(event?: string): void
}

// Klasy błędów eksportowane przez tiktok-live-connector - używamy `instanceof` zamiast dopasowywania
// treści komunikatu regexem, żeby kategoryzacja statusu przetrwała zmiany tekstu błędów w bibliotece.
interface TikTokErrorClasses {
  UserOfflineError: new (...args: unknown[]) => Error
  SignatureRateLimitError: new (...args: unknown[]) => Error
  SignAPIError: new (...args: unknown[]) => Error
  InvalidUniqueIdError: new (...args: unknown[]) => Error
}

export type TikTokConnectionFactory = (uniqueId: string, options: Record<string, unknown>) => TikTokLiveConnectionLike

interface TikTokModule {
  factory: TikTokConnectionFactory
  errors: Partial<TikTokErrorClasses>
}

async function loadTikTokModule(): Promise<TikTokModule> {
  const mod = (await import('tiktok-live-connector')) as unknown as TikTokErrorClasses & {
    TikTokLiveConnection: new (id: string, opts: Record<string, unknown>) => TikTokLiveConnectionLike
  }
  return {
    factory: (id, opts) => new mod.TikTokLiveConnection(id, opts),
    errors: {
      UserOfflineError: mod.UserOfflineError,
      SignatureRateLimitError: mod.SignatureRateLimitError,
      SignAPIError: mod.SignAPIError,
      InvalidUniqueIdError: mod.InvalidUniqueIdError
    }
  }
}

function isInstance(err: unknown, cls: (new (...args: unknown[]) => Error) | undefined): boolean {
  return Boolean(cls) && err instanceof (cls as new (...args: unknown[]) => Error)
}

/**
 * TikTok LIVE dowolnego użytkownika po samym @username - bez logowania, cookies ani sessionid
 * (tiktok-live-connector + publiczny serwer podpisujący Euler Stream). Gwarancje cyklu życia:
 * w danej chwili istnieje co najwyżej JEDNO połączenie; przy ponownej próbie lub zmianie nazwy
 * poprzednie jest odpinane (listenery) i rozłączane, a zdarzenia "spóźnionych" połączeń są
 * ignorowane dzięki licznikowi generacji - bez podwójnych wiadomości.
 */
export class TikTokAdapter implements PlatformAdapter {
  readonly platform = 'tiktok' as const

  private connection: TikTokLiveConnectionLike | undefined
  private generation = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private readonly backoff = new ExponentialBackoff(MIN_ERROR_RETRY_MS, MAX_ERROR_RETRY_MS)
  private stopped = true
  private module: TikTokModule | undefined
  private lastStartSignature: string | undefined

  constructor(
    private settings: () => TikTokSettings,
    private readonly callbacks: AdapterCallbacks,
    private readonly loadModule: () => Promise<TikTokModule> = loadTikTokModule
  ) {}

  private uniqueId(): string {
    return parseTikTokInput(this.settings().uniqueId)
  }

  async start(): Promise<void> {
    const settings = this.settings()
    if (!settings.enabled) {
      await this.stop()
      return
    }
    // Patrz komentarz w TwitchAdapter.start() - niepowiązana zmiana ustawień nie zrywa połączenia.
    const signature = JSON.stringify(settings)
    if (!this.stopped && signature === this.lastStartSignature) return
    this.lastStartSignature = signature
    this.stopped = false
    this.backoff.reset()
    await this.connect()
  }

  private async connect(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    await this.dropConnection()
    const generation = ++this.generation

    const uniqueId = this.uniqueId()
    if (!uniqueId) {
      this.callbacks.onStatus('error', 'Wpisz poprawną nazwę użytkownika TikTok (@username).')
      return
    }
    this.callbacks.onStatus('connecting', 'Sprawdzam, czy użytkownik jest na żywo…', uniqueId)

    try {
      this.module ??= await this.loadModule()
    } catch (err) {
      this.callbacks.onStatus('error', `Nie udało się załadować biblioteki tiktok-live-connector: ${errMsg(err)}`)
      return
    }
    if (generation !== this.generation || this.stopped) return

    const eulerApiKey = loadSecret(SecretKeys.tiktokEulerApiKey)
    const connection = this.module.factory(uniqueId, {
      enableExtendedGiftInfo: false,
      ...(eulerApiKey ? { signApiKey: eulerApiKey } : {})
    })
    this.connection = connection
    const current = (): boolean => generation === this.generation && !this.stopped
    // Biblioteka potrafi zgłosić ten sam błąd dwa razy (zdarzenie 'error' ORAZ odrzucenie connect()).
    let failed = false
    const fail = (err: unknown): void => {
      if (failed || !current()) return
      failed = true
      this.handleConnectError(err, uniqueId)
    }

    connection.on('chat', (payload) => {
      if (current()) this.callbacks.onMessage(normalizeTikTokMessage(payload as TikTokChatEvent, uniqueId))
    })
    connection.on('gift', (payload) => {
      if (!current()) return
      const message = normalizeTikTokGift(payload as TikTokGiftEvent, uniqueId)
      if (message) this.callbacks.onMessage(message)
    })
    connection.on('subNotify', (payload) => {
      if (current()) this.callbacks.onMessage(normalizeTikTokSubscribe(payload as TikTokChatEvent, uniqueId))
    })
    connection.on('disconnected', () => {
      if (!current()) return
      this.callbacks.onStatus('reconnecting', 'Rozłączono z TikTok LIVE — ponawiam.', uniqueId)
      this.scheduleRetry()
    })
    connection.on('streamEnd', () => {
      if (!current()) return
      this.callbacks.onStatus('stream_offline', 'Transmisja zakończona.', uniqueId)
      this.scheduleRetry(OFFLINE_RETRY_MS)
    })
    // tiktok-live-connector 2.5 nie zawsze odrzuca Promise z connect() przy błędzie (np.
    // UserOfflineError) - potrafi zamiast tego (lub dodatkowo) wyemitować 'error' z `{ info, exception }`.
    connection.on('error', (payload) => fail((payload as { exception?: unknown })?.exception ?? payload))

    try {
      await connection.connect()
      if (!current() || failed) return
      this.backoff.reset()
      this.callbacks.onStatus('connected', undefined, uniqueId)
    } catch (err) {
      fail(err)
    }
  }

  private handleConnectError(err: unknown, uniqueId: string): void {
    const errors = this.module?.errors ?? {}
    const message = errMsg(err)
    if (isInstance(err, errors.UserOfflineError) || /offline|isn't online|not.*live|live has ended/i.test(message)) {
      this.callbacks.onStatus('stream_offline', `@${uniqueId} nie jest teraz na żywo — sprawdzam ponownie co 30 s.`, uniqueId)
      this.scheduleRetry(OFFLINE_RETRY_MS)
      return
    }
    if (isInstance(err, errors.InvalidUniqueIdError)) {
      this.callbacks.onStatus('error', `Nie ma użytkownika TikTok „@${uniqueId}”.`, uniqueId)
      return
    }
    if (isInstance(err, errors.SignatureRateLimitError) || isInstance(err, errors.SignAPIError)) {
      this.callbacks.onStatus(
        'error',
        `Serwer podpisujący TikTok (Euler Stream) odrzucił połączenie: ${message}. Darmowy tier ma ` +
          'współdzielony limit — własny darmowy klucz API z eulerstream.com podnosi limity.',
        uniqueId
      )
      this.scheduleRetry()
      return
    }
    console.error('[tiktok] błąd połączenia:', message)
    this.callbacks.onStatus('error', message, uniqueId)
    this.scheduleRetry()
  }

  private scheduleRetry(fixedDelayMs?: number): void {
    if (this.stopped) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    const delay = fixedDelayMs ?? this.backoff.next()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (!this.stopped) void this.connect()
    }, delay)
  }

  /** Odpina wszystkie listenery i rozłącza bieżące połączenie (jeśli jest). */
  private async dropConnection(): Promise<void> {
    const old = this.connection
    this.connection = undefined
    if (!old) return
    try {
      old.removeAllListeners?.()
      // Po odpięciu listenerów biblioteka może jeszcze wyemitować 'error' - nie może to być "unhandled".
      old.on('error', () => undefined)
      await old.disconnect()
    } catch {
      // Rozłączanie już zamkniętego/zerwanego połączenia nie powinno przerywać zatrzymania adaptera.
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.generation++
    this.lastStartSignature = undefined
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    await this.dropConnection()
    this.callbacks.onStatus('disconnected')
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const uniqueId = this.uniqueId()
    if (!uniqueId) return { ok: false, message: 'Wpisz poprawną nazwę użytkownika TikTok.' }
    try {
      this.module ??= await this.loadModule()
      const eulerApiKey = loadSecret(SecretKeys.tiktokEulerApiKey)
      const test = this.module.factory(uniqueId, eulerApiKey ? { signApiKey: eulerApiKey } : {})
      test.on('error', () => undefined)
      await test.connect()
      await test.disconnect()
      return { ok: true, message: `@${uniqueId} jest teraz na żywo — połączenie bez logowania działa.` }
    } catch (err) {
      const message = errMsg(err)
      if (isInstance(err, this.module?.errors.UserOfflineError) || /offline|isn't online|not.*live/i.test(message)) {
        return { ok: true, message: `@${uniqueId} nie jest teraz na żywo (to nie błąd konfiguracji).` }
      }
      return { ok: false, message }
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

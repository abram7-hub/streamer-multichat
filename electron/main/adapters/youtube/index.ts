import type { YouTubeSettings } from '../../../../shared/settings'
import { parseYouTubeInput, type YouTubeTarget } from '../../../../shared/youtube-input'
import type { AdapterCallbacks, PlatformAdapter } from '../types'
import { loadSecret, SecretKeys } from '../../secure-store'
import { getStoredYouTubeClient, loginToYouTube, logoutYouTube } from './auth'
import { normalizeYouTubeMessage } from './normalize'
import { YouTubeApi, YouTubeApiError, type LiveChatResponse, type YouTubeAuth } from './api'

/** Sprawdzanie, czy kanał zaczął transmisję: 2 jednostki quota (uploads + videos) co 90 s ≈ 1 920/dobę. */
const OFFLINE_RECHECK_MS = 90_000
const QUOTA_BACKOFF_MS = 15 * 60_000
const ERROR_RETRY_MS = 30_000
const MIN_POLL_MS = 2000
const STREAM_MIN_LIFETIME_MS = 5000
/** Przy pierwszym połączeniu YouTube odsyła ostatnie wiadomości - starszych niż to nie pokazujemy. */
const HISTORY_GRACE_MS = 30_000

/** Czy błąd oznacza koniec/brak czatu (wtedy wracamy do szukania transmisji, a nie ponawiamy). */
export function isChatGoneError(err: unknown): boolean {
  return (
    err instanceof YouTubeApiError &&
    (['liveChatEnded', 'liveChatDisabled', 'liveChatNotFound'].includes(err.reason ?? '') || err.status === 404)
  )
}

export function isQuotaError(err: unknown): boolean {
  return err instanceof YouTubeApiError && ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(err.reason ?? '')
}

export function isCredentialError(err: unknown): boolean {
  return (
    err instanceof YouTubeApiError &&
    (err.status === 401 || ['keyInvalid', 'keyExpired', 'accessNotConfigured', 'noCredentials', 'API_KEY_INVALID', 'forbidden'].includes(err.reason ?? ''))
  )
}

/**
 * YouTube: publiczny podgląd czatu DOWOLNEJ aktywnej transmisji (kanał / @handle / ID kanału / URL
 * transmisji lub filmu). Do odczytu publicznych danych wystarcza klucz API YouTube Data API v3 -
 * logowanie Google nie jest wymagane. Jeśli klucza brak, a użytkownik jest zalogowany, te same
 * publiczne zapytania idą z tokenem OAuth (zużywając quota jego projektu).
 *
 * Czat odbierany jest przez `liveChatMessages.streamList` (serwer dosyła wiadomości od razu); gdy
 * strumień jest niedostępny - przez zwykły polling z respektowaniem `pollingIntervalMillis`.
 */
export class YouTubeAdapter implements PlatformAdapter {
  readonly platform = 'youtube' as const

  private readonly api = new YouTubeApi(() => this.resolveAuth())
  private abort: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastStartSignature: string | undefined
  private stopped = true
  /** Cache kanał -> playlista uploads (nie zmienia się), żeby nie płacić za to przy każdym sprawdzeniu. */
  private channelCache = new Map<string, { channelId: string; uploads?: string; title?: string }>()
  private streamUnsupported = false
  private oauthProblem: string | undefined

  constructor(
    private settings: () => YouTubeSettings,
    private readonly callbacks: AdapterCallbacks
  ) {}

  private async resolveAuth(): Promise<YouTubeAuth | undefined> {
    const key = loadSecret(SecretKeys.youtubeApiKey)
    if (key) return { kind: 'apiKey', key }
    const settings = this.settings()
    const clientSecret = loadSecret(SecretKeys.youtubeClientSecret)
    if (!settings.clientId || !clientSecret) return undefined
    const client = getStoredYouTubeClient(settings.clientId, clientSecret)
    if (!client) return undefined
    try {
      const { token } = await withTimeout(client.getAccessToken(), 15_000)
      this.oauthProblem = undefined
      return token ? { kind: 'oauth', token } : undefined
    } catch (err) {
      // Np. `invalid_grant`: ekran zgody OAuth w trybie "Testowanie" -> Google unieważnia sesję po 7 dniach.
      this.oauthProblem = errMsg(err)
      return undefined
    }
  }

  private label(): string {
    return this.settings().channelHandle.trim()
  }

  async start(): Promise<void> {
    const settings = this.settings()
    if (!settings.enabled) {
      await this.stop()
      return
    }
    const signature = JSON.stringify(settings)
    if (!this.stopped && signature === this.lastStartSignature) return
    this.lastStartSignature = signature
    this.stopped = false
    this.cancelSession()

    const target = parseYouTubeInput(settings.channelHandle)
    if (!target) {
      this.callbacks.onStatus('error', 'Wpisz kanał YouTube: URL kanału, @handle, ID kanału (UC…) albo URL transmisji.')
      return
    }
    const abort = new AbortController()
    this.abort = abort
    void this.run(target, abort.signal)
  }

  /** Kończy bieżącą sesję: przerywa zapytania/strumień i timery (zmiana kanału, stop, restart). */
  private cancelSession(): void {
    this.abort?.abort()
    this.abort = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(target: YouTubeTarget, signal: AbortSignal, delayMs: number): void {
    if (signal.aborted) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run(target, signal)
    }, delayMs)
  }

  private async run(target: YouTubeTarget, signal: AbortSignal): Promise<void> {
    const label = this.label()
    try {
      this.callbacks.onStatus('connecting', 'Sprawdzam dane dostępowe…', label)
      if (!(await this.resolveAuth())) {
        if (signal.aborted) return
        this.callbacks.onStatus(
          'auth_required',
          (this.oauthProblem ? `Sesja Google wygasła lub została cofnięta (${this.oauthProblem}). ` : '') +
            'Wpisz klucz API YouTube (publiczny podgląd, bez logowania) albo zaloguj się kontem Google w ustawieniach YouTube.',
          label
        )
        return
      }
      if (signal.aborted) return
      this.callbacks.onStatus('connecting', 'Szukam aktywnej transmisji…', label)
      const live = await this.findLive(target, signal)
      if (signal.aborted) return
      if (!live) {
        this.callbacks.onStatus(
          'stream_offline',
          target.kind === 'video' ? 'Ta transmisja nie jest teraz na żywo (zakończona lub zaplanowana).' : 'Brak aktywnej transmisji na kanale.',
          label
        )
        this.schedule(target, signal, OFFLINE_RECHECK_MS)
        return
      }
      this.callbacks.onStatus('connected', live.title ? `Transmisja: ${live.title}` : undefined, label)
      await this.receiveChat(live.chatId, signal)
      if (signal.aborted) return
      this.callbacks.onStatus('stream_offline', 'Transmisja zakończona.', label)
      this.schedule(target, signal, OFFLINE_RECHECK_MS)
    } catch (err) {
      if (signal.aborted) return
      if (isQuotaError(err)) {
        this.callbacks.onStatus('error', 'Wyczerpany dzienny limit (quota) YouTube Data API — ponowię za 15 minut.', label)
        this.schedule(target, signal, QUOTA_BACKOFF_MS)
      } else if (isCredentialError(err)) {
        this.callbacks.onStatus('auth_required', `YouTube odrzucił dane dostępowe: ${errMsg(err)}. Sprawdź klucz API albo zaloguj się ponownie.`, label)
      } else {
        this.callbacks.onStatus('reconnecting', `${errMsg(err)} — ponowię za 30 s.`, label)
        this.schedule(target, signal, ERROR_RETRY_MS)
      }
    }
  }

  private async findLive(target: YouTubeTarget, signal: AbortSignal): Promise<{ chatId: string; title?: string } | undefined> {
    let candidates: string[]
    if (target.kind === 'video') {
      candidates = [target.videoId]
    } else {
      const key = JSON.stringify(target)
      let channel = this.channelCache.get(key)
      if (!channel) {
        channel = await this.api.resolveChannel(target, signal)
        if (!channel) throw new YouTubeApiError(`Nie znaleziono kanału YouTube „${this.label()}”.`, 404, 'channelNotFound')
        this.channelCache.set(key, channel)
      }
      if (!channel.uploads) return undefined
      candidates = await this.api.latestUploads(channel.uploads, signal)
    }
    const videos = await this.api.videos(candidates, signal)
    const live = videos.find((v) => v.state === 'live' && v.activeLiveChatId && !v.ended)
    return live?.activeLiveChatId ? { chatId: live.activeLiveChatId, title: live.title } : undefined
  }

  /** Odbiera czat do jego zakończenia (zwraca normalnie) albo rzuca błąd. */
  private async receiveChat(chatId: string, signal: AbortSignal): Promise<void> {
    const label = this.label()
    const connectedAt = Date.now()
    let pageToken: string | undefined
    let ended = false
    const handle = (response: LiveChatResponse): void => {
      if (response.nextPageToken) pageToken = response.nextPageToken
      if (response.offlineAt) ended = true
      for (const item of response.items ?? []) {
        if (item.snippet?.type === 'chatEndedEvent') {
          ended = true
          continue
        }
        const message = normalizeYouTubeMessage(item, label)
        if (!message) continue
        // Historia odesłana przy pierwszym połączeniu nie powinna zalewać czatu starymi wiadomościami.
        if (message.timestampMs < connectedAt - HISTORY_GRACE_MS) continue
        this.callbacks.onMessage(message)
      }
    }

    while (!signal.aborted && !ended) {
      if (!this.streamUnsupported) {
        try {
          const startedAt = Date.now()
          await this.api.streamMessages(chatId, pageToken, signal, handle)
          // Serwer zamknął strumień - łączymy ponownie od ostatniego tokenu. Każde połączenie kosztuje
          // quota, więc krótko żyjące strumienie nie mogą zamienić się w pętlę zapytań.
          if (Date.now() - startedAt < STREAM_MIN_LIFETIME_MS) await sleep(STREAM_MIN_LIFETIME_MS, signal)
          continue
        } catch (err) {
          if (signal.aborted || isChatGoneError(err) || isQuotaError(err) || isCredentialError(err)) {
            if (isChatGoneError(err)) return
            throw err
          }
          // Strumień niedostępny (np. inna odpowiedź serwera) - przechodzimy na polling.
          console.warn('[youtube] strumień czatu niedostępny, przechodzę na polling:', errMsg(err))
          this.streamUnsupported = true
        }
      }
      let response: LiveChatResponse
      try {
        response = await this.api.listMessages(chatId, pageToken, signal)
      } catch (err) {
        if (isChatGoneError(err)) return
        throw err
      }
      handle(response)
      const delay = Math.max(response.pollingIntervalMillis ?? 5000, MIN_POLL_MS)
      await sleep(delay, signal)
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.lastStartSignature = undefined
    this.cancelSession()
    this.callbacks.onStatus('disconnected')
  }

  async login(): Promise<{ ok: boolean; message?: string }> {
    const settings = this.settings()
    const clientSecret = loadSecret(SecretKeys.youtubeClientSecret)
    if (!settings.clientId || !clientSecret) {
      return { ok: false, message: 'Uzupełnij Client ID i Client Secret Google przed logowaniem.' }
    }
    try {
      await loginToYouTube(settings.clientId, clientSecret)
      this.lastStartSignature = undefined
      await this.start()
      return { ok: true }
    } catch (err) {
      return { ok: false, message: errMsg(err) }
    }
  }

  async logout(): Promise<void> {
    logoutYouTube()
    this.lastStartSignature = undefined
    await this.start()
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const target = parseYouTubeInput(this.settings().channelHandle)
    if (!target) return { ok: false, message: 'Nie rozpoznano kanału/transmisji YouTube.' }
    const auth = await this.resolveAuth()
    if (!auth) return { ok: false, message: 'Brak klucza API YouTube i brak logowania Google.' }
    const signal = AbortSignal.timeout(20_000)
    try {
      const live = await this.findLive(target, signal)
      const via = auth.kind === 'apiKey' ? 'klucz API (bez logowania)' : 'konto Google (OAuth)'
      return live
        ? { ok: true, message: `Znaleziono aktywną transmisję${live.title ? ` „${live.title}”` : ''} — dostęp przez ${via}.` }
        : { ok: true, message: `Kanał/film znaleziony (${via}), ale nie jest teraz na żywo.` }
    } catch (err) {
      return { ok: false, message: errMsg(err) }
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('przekroczono czas odpowiedzi Google')), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true }
    )
  })
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

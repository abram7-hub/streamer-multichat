import type { ActivityEvent } from '../../../../shared/chat-message'
import type { ConnectionState } from '../../../../shared/platform'
import type { TwitchSettings } from '../../../../shared/settings'
import { isAllowedAssetUrl } from '../../../../shared/emote-url'
import type { AdapterCallbacks, PlatformAdapter } from '../types'
import {
  getStoredTwitchTokens,
  getTwitchAuthState,
  refreshTwitchToken,
  revokeTwitchAuth,
  startTwitchDeviceAuth,
  type DeviceCodePrompt,
  type TwitchAuthState
} from './auth'
import { TwitchBadgeRegistry } from './badges'
import { TwitchIrcClient } from './irc-client'
import { TwitchEventSubClient } from './eventsub-client'
import type { EmoteRegistry } from './emote-registry'

const HELIX_USERS_URL = 'https://api.twitch.tv/helix/users'
const HELIX_REWARDS_URL = 'https://api.twitch.tv/helix/channel_points/custom_rewards'
/** Ponowna próba inicjalizacji funkcji wymagających logowania po błędzie sieci. */
const AUTH_RETRY_MS = 60_000
/** Nieznana nagroda (np. dodana w trakcie streama) - nie częściej niż co tyle odpytujemy Helix. */
const REWARDS_REFRESH_MIN_MS = 60_000

interface RewardInfo {
  title: string
  imageUrl?: string
}

/** Czysta funkcja: komunikat dla użytkownika, gdy token nie może zostać odświeżony. */
export function describeAuthProblem(state: TwitchAuthState): string | undefined {
  if (state.status !== 'refresh_failed') return undefined
  const disabled = 'Do tego czasu Channel Points, followy, suby z EventSub i obrazki odznak są wyłączone (czat działa dalej).'
  switch (state.reason) {
    case 'missing_client_secret':
      return (
        'Token Twitch wygasł i nie może zostać odświeżony: Twitch odpowiada „missing client secret”, bo aplikacja ' +
        'w Twitch Developer Console jest typu „Confidential”. Wpisz jej Client Secret w ustawieniach Twitcha ' +
        `(albo użyj aplikacji typu „Public”) i zaloguj się ponownie. ${disabled}`
      )
    case 'invalid_refresh_token':
      return `Sesja Twitch wygasła lub została cofnięta — zaloguj się ponownie w ustawieniach Twitcha. ${disabled}`
    case 'network':
      return `Nie udało się odświeżyć tokenu Twitch (sieć) — ponowię za minutę. ${disabled}`
  }
}

/**
 * Kanał wiadomości Twitcha: JEDNO współdzielone anonimowe połączenie IRC (`TwitchIrcClient`,
 * wstrzykiwane z main/index.ts - to samo połączenie obsługuje też wpisy z listy "Kanały").
 * Emotki 7TV/BTTV działają bez logowania (numeryczne ID kanału przychodzi w tagach IRC, patrz
 * emote-registry.ts). Logowanie OAuth (Device Code Flow) jest OPCJONALNE i służy do:
 *  - obrazków odznak (Helix - dowolny token wystarczy, więc także dla kanałów z listy "Kanały"),
 *  - zdarzeń EventSub (Channel Points, suby, raidy, Bitsy, followy...) - WYŁĄCZNIE gdy zalogowany
 *    użytkownik jest właścicielem skonfigurowanego kanału. Kanały obserwowane anonimowo nigdy nie
 *    dostają zdarzeń wymagających uprawnień właściciela.
 * Każdy problem z logowaniem/uprawnieniami jest zgłaszany jako `warning` statusu (pasek w UI),
 * a nie tylko do konsoli.
 */
export class TwitchAdapter implements PlatformAdapter {
  readonly platform = 'twitch' as const

  private readonly eventSub: TwitchEventSubClient
  private readonly badges: TwitchBadgeRegistry
  private currentToken: string | undefined
  private unwatch: (() => void) | undefined
  private stopped = true
  private lastStartSignature: string | undefined
  private sessionActive = false
  private eventSubNote = ''
  private ircState: ConnectionState = 'idle'
  private ircMessage: string | undefined
  private warning: string | undefined
  private authRetryTimer: ReturnType<typeof setTimeout> | undefined
  private rewards = new Map<string, RewardInfo>()
  private rewardsFetchedAt = 0
  private ownBroadcaster: { id: string; login: string } | undefined

  constructor(
    private settings: () => TwitchSettings,
    private readonly callbacks: AdapterCallbacks,
    private readonly onDevicePrompt: (prompt: DeviceCodePrompt) => void,
    private readonly ircClient: TwitchIrcClient,
    private readonly onActivity: (event: ActivityEvent) => void = () => undefined,
    private readonly emoteRegistry?: EmoteRegistry
  ) {
    this.badges = new TwitchBadgeRegistry(() => {
      const clientId = this.settings().clientId
      return this.currentToken && clientId ? { token: this.currentToken, clientId } : undefined
    })
    this.ircClient.setBadgeResolver(this.badges.resolve)
    this.ircClient.setRewardTitleResolver((channel, rewardId) =>
      this.ownBroadcaster?.login === channel ? this.rewardFor(rewardId)?.title : undefined
    )
    this.eventSub = new TwitchEventSubClient({
      getToken: async () => this.currentToken ?? (await this.loadToken()),
      refreshToken: async () => {
        const { refreshToken } = getStoredTwitchTokens()
        const clientId = this.settings().clientId
        if (!refreshToken || !clientId) return undefined
        try {
          this.currentToken = await refreshTwitchToken(clientId, refreshToken)
        } catch (err) {
          this.currentToken = undefined
          this.setWarning(err instanceof Error ? err.message : String(err))
        }
        return this.currentToken
      },
      onMessage: (message) => {
        const roomId = this.ircClient.getRoomId(message.channel)
        this.callbacks.onMessage(this.emoteRegistry ? this.emoteRegistry.enrich(message, roomId) : message)
      },
      onStatus: (text, problem) => {
        this.eventSubNote = text
        this.setWarning(problem ? text : undefined)
      },
      normalizeOptions: {
        rewardImage: (rewardId) => this.rewardFor(rewardId)?.imageUrl,
        userColor: (userId) => this.ircClient.getUserColor(userId)
      }
    })
    // Publiczne odpowiedniki z IRC (USERNOTICE / tag bits / custom-reward-id) są pomijane dla typów,
    // które EventSub już dostarcza dla własnego kanału - bez duplikatów.
    this.ircClient.setEventCoverage((channel, kind) => this.eventSub.covers(channel, kind))
  }

  /** Wołane z main/index.ts przy poznaniu `room-id` dowolnego obserwowanego kanału (ROOMSTATE). */
  onRoomId(roomId: string): void {
    this.badges.ensure(roomId)
  }

  private channelLogin(): string {
    return this.settings().channelLogin.trim().replace(/^#/, '').toLowerCase()
  }

  private async loadToken(): Promise<string | undefined> {
    const clientId = this.settings().clientId
    if (!clientId) return undefined
    const state = await getTwitchAuthState(clientId)
    this.currentToken = state.status === 'ok' ? state.token : undefined
    return this.currentToken
  }

  private emitStatus(): void {
    if (this.stopped) return
    this.callbacks.onStatus(this.ircState, this.ircMessage, this.channelLogin(), this.warning)
  }

  private setWarning(warning: string | undefined): void {
    if (warning === this.warning) return
    this.warning = warning
    this.emitStatus()
  }

  async start(): Promise<void> {
    const settings = this.settings()
    if (!settings.enabled) {
      await this.stop()
      return
    }
    // `settings:update` wywołuje start() po każdej zmianie ustawień (nawet niepowiązanej), więc bez
    // tej strażniczki co drugie zapisanie kreatora zrywałoby i odtwarzało aktywne połączenie od nowa.
    const signature = JSON.stringify(settings)
    if (this.sessionActive && signature === this.lastStartSignature) return
    this.lastStartSignature = signature
    this.stopped = false
    if (this.authRetryTimer) clearTimeout(this.authRetryTimer)
    this.authRetryTimer = undefined

    const channelLogin = this.channelLogin()
    if (!channelLogin) {
      this.callbacks.onStatus('error', 'Uzupełnij nazwę kanału Twitch w kreatorze konfiguracji.')
      return
    }

    // Zmiana kanału: stara subskrypcja IRC jest odpinana PRZED nową (bez podwójnych wiadomości).
    this.unwatch?.()
    this.ircState = 'connecting'
    this.ircMessage = undefined
    this.emitStatus()

    this.unwatch = this.ircClient.watch(channelLogin, {
      // Emotki 7TV/BTTV są doklejane centralnie w TwitchIrcClient (raz na wiadomość, dla wszystkich kanałów).
      onMessage: (message) => this.callbacks.onMessage(message),
      onActivity: (event) => {
        if (this.settings().showJoinPartNotifications) this.onActivity(event)
      },
      onStatus: (state, message) => {
        this.sessionActive = state === 'connected'
        this.ircState = state
        this.ircMessage = message
        this.emitStatus()
      }
    })

    // Logowanie jest opcjonalne (nieblokujące) - dociąga odznaki i uruchamia EventSub, jeśli
    // dostępny jest ważny token. Wiadomości czatu płyną niezależnie od wyniku tego kroku.
    void this.enrichWithAuthIfAvailable(settings, channelLogin).catch((err: unknown) => {
      console.error('[twitch] błąd inicjalizacji funkcji wymagających logowania:', err)
    })
  }

  private async enrichWithAuthIfAvailable(settings: TwitchSettings, channelLogin: string): Promise<void> {
    if (!settings.clientId) {
      this.eventSub.stop()
      this.eventSubNote = 'Brak Client ID — zdarzenia EventSub wyłączone.'
      this.setWarning(undefined)
      return
    }
    const auth = await getTwitchAuthState(settings.clientId)
    if (this.stopped) return
    if (auth.status !== 'ok') {
      this.eventSub.stop()
      this.currentToken = undefined
      if (auth.status === 'logged_out') {
        this.eventSubNote = 'Nie zalogowano — zdarzenia EventSub (Channel Points, followy itd.) wyłączone.'
        this.setWarning(undefined)
      } else {
        this.eventSubNote = describeAuthProblem(auth) ?? auth.message
        this.setWarning(this.eventSubNote)
        console.warn(`[twitch] ${auth.message}`)
        if (auth.reason === 'network') {
          this.authRetryTimer = setTimeout(() => {
            if (!this.stopped) void this.enrichWithAuthIfAvailable(this.settings(), this.channelLogin())
          }, AUTH_RETRY_MS)
        }
      }
      return
    }
    this.currentToken = auth.token
    const { validation } = auth

    // Odznaki: globalne + wszystkich już obserwowanych kanałów (nowe dojdą przy ROOMSTATE).
    this.badges.resetFailures()
    this.badges.ensure()
    for (const roomId of this.ircClient.knownRoomIds()) this.badges.ensure(roomId)

    const user = await this.fetchUserByLogin(auth.token, settings.clientId, channelLogin).catch(() => undefined)
    if (this.stopped) return
    if (!user) {
      this.setWarning(`Nie znaleziono kanału Twitch „${channelLogin}” w Helix — EventSub wyłączony.`)
      return
    }

    // EventSub tylko dla WŁASNEGO kanału: te zdarzenia wymagają tokenu nadawcy kanału z `condition`.
    if (!settings.eventSubEnabled) {
      this.eventSub.stop()
      this.eventSubNote = 'Zdarzenia EventSub wyłączone w ustawieniach.'
      this.setWarning(undefined)
      return
    }
    if (validation.userId !== user.id) {
      this.eventSub.stop()
      this.ownBroadcaster = undefined
      this.eventSubNote =
        `Zalogowano jako ${validation.login ?? '?'}, a skonfigurowany kanał to ${user.login} — ` +
        'zdarzenia EventSub (Channel Points itd.) działają tylko dla kanału zalogowanego właściciela.'
      this.setWarning(this.eventSubNote)
      return
    }
    const scopes = validation.scopes ?? []
    const missing = TwitchEventSubClient.missingScopes(scopes)
    if (missing.length > 0) {
      this.eventSubNote = `Token Twitch nie ma uprawnień: ${missing.join(', ')} — wyloguj się i zaloguj ponownie w ustawieniach Twitcha, aby je nadać.`
      this.setWarning(this.eventSubNote)
    } else {
      this.setWarning(undefined)
    }
    this.ownBroadcaster = { id: user.id, login: user.login.toLowerCase() }
    void this.loadRewards(true)
    this.eventSub.start({
      clientId: settings.clientId,
      broadcasterId: user.id,
      broadcasterLogin: user.login.toLowerCase(),
      tokenUserId: validation.userId,
      grantedScopes: scopes
    })
  }

  /** Nazwy i ikony nagród własnych (Helix Get Custom Reward) - do ikony w zdarzeniu i nazwy z IRC. */
  private rewardFor(rewardId: string): RewardInfo | undefined {
    const hit = this.rewards.get(rewardId)
    if (!hit) void this.loadRewards(false)
    return hit
  }

  private async loadRewards(force: boolean): Promise<void> {
    const owner = this.ownBroadcaster
    const clientId = this.settings().clientId
    if (!owner || !this.currentToken || !clientId) return
    if (!force && Date.now() - this.rewardsFetchedAt < REWARDS_REFRESH_MIN_MS) return
    this.rewardsFetchedAt = Date.now()
    try {
      const res = await fetch(`${HELIX_REWARDS_URL}?broadcaster_id=${encodeURIComponent(owner.id)}`, {
        headers: { Authorization: `Bearer ${this.currentToken}`, 'Client-Id': clientId },
        signal: AbortSignal.timeout(10_000)
      })
      if (!res.ok) return // np. kanał bez afiliacji/partnerstwa - nagrody i tak nie istnieją
      const data = (await res.json()) as {
        data?: { id: string; title: string; image?: { url_1x?: string } | null; default_image?: { url_1x?: string } }[]
      }
      const next = new Map<string, RewardInfo>()
      for (const r of data.data ?? []) {
        const image = r.image?.url_1x ?? r.default_image?.url_1x
        next.set(r.id, { title: r.title, imageUrl: isAllowedAssetUrl(image, 'twitch') ? image : undefined })
      }
      this.rewards = next
    } catch {
      // Ikony nagród są dodatkiem - zdarzenie i tak przychodzi z nazwą i kosztem z EventSub.
    }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.sessionActive = false
    this.lastStartSignature = undefined
    if (this.authRetryTimer) clearTimeout(this.authRetryTimer)
    this.authRetryTimer = undefined
    this.unwatch?.()
    this.unwatch = undefined
    this.eventSub.stop()
    this.ircState = 'disconnected'
    this.warning = undefined
    this.callbacks.onStatus('disconnected')
  }

  async login(): Promise<{ ok: boolean; message?: string }> {
    const settings = this.settings()
    if (!settings.clientId) return { ok: false, message: 'Uzupełnij Client ID Twitcha przed logowaniem.' }
    try {
      const abort = new AbortController()
      const tokens = await startTwitchDeviceAuth(settings.clientId, this.onDevicePrompt, abort.signal)
      this.currentToken = tokens.accessToken
      // Wymuś ponowną inicjalizację (odznaki + EventSub z nowymi scope'ami) nawet przy tej samej konfiguracji.
      this.lastStartSignature = undefined
      this.sessionActive = false
      await this.start()
      return { ok: true }
    } catch (err) {
      return { ok: false, message: errMsg(err) }
    }
  }

  async logout(): Promise<void> {
    const settings = this.settings()
    await revokeTwitchAuth(settings.clientId).catch(() => undefined)
    this.currentToken = undefined
    this.ownBroadcaster = undefined
    this.eventSub.stop()
    this.setWarning(undefined)
    // Wylogowanie wyłącza tylko EventSub - samo połączenie IRC (anonimowe) i emotki 7TV/BTTV zostają
    // aktywne, bo nie zależą od logowania.
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const settings = this.settings()
    if (!settings.channelLogin.trim()) return { ok: false, message: 'Uzupełnij nazwę kanału Twitch.' }
    const anon = `Odczyt czatu kanału "${settings.channelLogin}" oraz emotki 7TV/BTTV działają anonimowo (bez logowania).`
    if (!settings.clientId) {
      return { ok: true, message: `${anon} Zaloguj się, aby włączyć odznaki i zdarzenia EventSub własnego kanału.` }
    }
    const auth = await getTwitchAuthState(settings.clientId)
    if (auth.status === 'logged_out') {
      return { ok: true, message: `${anon} Nie zalogowano — odznaki i EventSub wyłączone.` }
    }
    if (auth.status === 'refresh_failed') {
      return { ok: false, message: `${anon} ${describeAuthProblem(auth) ?? auth.message}` }
    }
    const user = await this.fetchUserByLogin(auth.token, settings.clientId, settings.channelLogin).catch(() => undefined)
    if (!user) return { ok: false, message: `Nie znaleziono kanału "${settings.channelLogin}".` }
    const parts = [
      `Zalogowano jako ${auth.validation.login ?? '?'} — odznaki włączone. Uprawnienia tokenu: ${(auth.validation.scopes ?? []).join(', ') || 'brak'}.`
    ]
    if (this.eventSubNote) parts.push(this.eventSubNote)
    else if (this.eventSub.summary) parts.push(this.eventSub.summary)
    else if (auth.validation.userId === user.id) parts.push('EventSub: łączenie…')
    return { ok: true, message: parts.join(' ') }
  }

  private async fetchUserByLogin(
    accessToken: string,
    clientId: string,
    login: string
  ): Promise<{ id: string; login: string } | undefined> {
    const clean = login.trim().replace(/^#/, '')
    const res = await fetch(`${HELIX_USERS_URL}?login=${encodeURIComponent(clean)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) throw new Error(`Helix /users zwrócił HTTP ${res.status}`)
    const data = (await res.json()) as { data: { id: string; login: string }[] }
    return data.data[0]
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

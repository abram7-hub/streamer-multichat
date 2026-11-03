import WebSocket from 'ws'
import type { ChatMessage, StreamEventKind } from '../../../../shared/chat-message'
import { ExponentialBackoff } from '../common/backoff'
import { normalizeEventSubNotification, type EventSubNormalizeOptions } from './eventsub-normalize'

export const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30'
const SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions'
const KEEPALIVE_GRACE_MS = 5_000
const MAX_SEEN_IDS = 500

export interface EventSubTarget {
  clientId: string
  /** ID i login kanału, którego zdarzenia odbieramy - MUSI być kanałem zalogowanego użytkownika. */
  broadcasterId: string
  broadcasterLogin: string
  /** ID właściciela tokenu (dla follow: `moderator_user_id`). */
  tokenUserId: string
  grantedScopes: readonly string[]
}

interface SubscriptionDef {
  type: string
  version: string
  /** Wystarczy dowolny z wymienionych scope'ów (pusta lista = brak wymagań). */
  anyScope: string[]
  kinds: StreamEventKind[]
  condition(t: EventSubTarget): Record<string, string>
}

/**
 * Subskrypcje EventSub dostępne dla właściciela kanału (wersje i scope'y wg dokumentacji Twitcha:
 * dev.twitch.tv/docs/eventsub/eventsub-subscription-types). Wszystkie wymagają tokenu użytkownika,
 * który jest nadawcą kanału z `condition` - dlatego klient uruchamiany jest WYŁĄCZNIE dla kanału
 * zalogowanego użytkownika, nigdy dla kanałów obserwowanych anonimowo.
 */
export const EVENTSUB_SUBSCRIPTIONS: readonly SubscriptionDef[] = [
  {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    anyScope: ['channel:read:redemptions', 'channel:manage:redemptions'],
    kinds: ['redemption'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    // Nagrody automatyczne (wyróżniona wiadomość, odblokowanie emotki...) - osobny typ od nagród własnych.
    type: 'channel.channel_points_automatic_reward_redemption.add',
    version: '2',
    anyScope: ['channel:read:redemptions', 'channel:manage:redemptions'],
    kinds: [],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.subscribe',
    version: '1',
    anyScope: ['channel:read:subscriptions'],
    kinds: ['sub'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.subscription.message',
    version: '1',
    anyScope: ['channel:read:subscriptions'],
    kinds: ['resub'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.subscription.gift',
    version: '1',
    anyScope: ['channel:read:subscriptions'],
    kinds: ['gift_sub', 'community_gift'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.cheer',
    version: '1',
    anyScope: ['bits:read'],
    kinds: ['cheer'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.raid',
    version: '1',
    anyScope: [],
    kinds: ['raid_in'],
    condition: (t) => ({ to_broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.raid',
    version: '1',
    anyScope: [],
    kinds: ['raid_out'],
    condition: (t) => ({ from_broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.follow',
    version: '2',
    anyScope: ['moderator:read:followers'],
    kinds: ['follow'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId, moderator_user_id: t.tokenUserId })
  },
  {
    type: 'channel.hype_train.begin',
    version: '2',
    anyScope: ['channel:read:hype_train'],
    kinds: ['hype_train_begin'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  },
  {
    type: 'channel.hype_train.end',
    version: '2',
    anyScope: ['channel:read:hype_train'],
    kinds: ['hype_train_end'],
    condition: (t) => ({ broadcaster_user_id: t.broadcasterId })
  }
]

/** Minimalny interfejs gniazda - pozwala wstrzyknąć atrapę w testach. */
export interface SocketLike {
  on(event: 'message', listener: (data: WebSocket.RawData) => void): unknown
  on(event: 'close', listener: (code: number) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  removeAllListeners(): unknown
  close(): void
  terminate(): void
}

export interface EventSubDeps {
  /** Aktualny, ważny token użytkownika (po ewentualnym odświeżeniu). */
  getToken(): Promise<string | undefined>
  /** Wymuszenie odświeżenia tokenu po 401. */
  refreshToken(): Promise<string | undefined>
  onMessage(message: ChatMessage): void
  /** Podsumowanie subskrypcji; `problem` = true, gdy część zdarzeń jest niedostępna. */
  onStatus?(text: string, problem: boolean): void
  normalizeOptions?: EventSubNormalizeOptions
  createSocket?(url: string): SocketLike
  fetchImpl?: typeof fetch
}

type SubscribeResult = 'ok' | 'missing_scope' | 'forbidden' | 'error'

/**
 * Klient EventSub przez WebSocket. Gwarancje:
 *  - co najwyżej JEDNO aktywne gniazdo (+ chwilowo drugie podczas `session_reconnect`), nigdy więcej;
 *    każde gniazdo jest odpinane (`removeAllListeners`) przed porzuceniem - bez zduplikowanych
 *    listenerów i wycieków po reconnectach;
 *  - `session_reconnect` -> nowe gniazdo pod `reconnect_url`, subskrypcje przechodzą automatycznie
 *    (bez ponownego tworzenia); zerwanie połączenia -> nowa sesja z backoffem i ponowne subskrypcje;
 *  - watchdog keepalive: brak jakiejkolwiek wiadomości przez `keepalive_timeout_seconds` + zapas ->
 *    połączenie uznane za martwe;
 *  - deduplikacja po `message_id` (Twitch może dostarczyć to samo powiadomienie ponownie).
 */
export class TwitchEventSubClient {
  private socket: SocketLike | undefined
  private pendingSocket: SocketLike | undefined
  private target: EventSubTarget | undefined
  private keepaliveTimer: ReturnType<typeof setTimeout> | undefined
  private keepaliveMs = 35_000
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private readonly backoff = new ExponentialBackoff(2_000, 60_000)
  private readonly seenIds = new Set<string>()
  private readonly seenOrder: string[] = []
  private activeKinds = new Set<StreamEventKind>()
  private lastSummary = ''
  private running = false

  constructor(private readonly deps: EventSubDeps) {}

  /** Uruchamia (lub restartuje dla innego kanału). Ponowne wywołanie z tym samym celem jest no-opem. */
  start(target: EventSubTarget): void {
    const sameTarget =
      this.running &&
      this.target?.broadcasterId === target.broadcasterId &&
      this.target.clientId === target.clientId &&
      this.target.grantedScopes.join(' ') === target.grantedScopes.join(' ')
    if (sameTarget) return
    this.stop()
    this.target = target
    this.running = true
    this.connect(EVENTSUB_WS_URL, false)
  }

  stop(): void {
    this.running = false
    this.clearTimers()
    this.dropSocket(this.socket)
    this.dropSocket(this.pendingSocket)
    this.socket = undefined
    this.pendingSocket = undefined
    this.activeKinds = new Set()
    this.target = undefined
  }

  /** Czy dany typ zdarzenia jest aktualnie dostarczany przez EventSub dla tego kanału. */
  covers(channelLogin: string, kind: StreamEventKind): boolean {
    return (
      this.running &&
      this.target?.broadcasterLogin.toLowerCase() === channelLogin.toLowerCase() &&
      this.activeKinds.has(kind)
    )
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Czytelne podsumowanie stanu subskrypcji (do "Testuj połączenie"). */
  get summary(): string {
    return this.lastSummary
  }

  /** Scope'y wymagane przez wszystkie obsługiwane subskrypcje, których token nie posiada. */
  static missingScopes(granted: readonly string[]): string[] {
    const missing = new Set<string>()
    for (const def of EVENTSUB_SUBSCRIPTIONS) {
      if (def.anyScope.length > 0 && !def.anyScope.some((s) => granted.includes(s))) {
        const first = def.anyScope[0]
        if (first) missing.add(first)
      }
    }
    return [...missing]
  }

  private connect(url: string, isReconnect: boolean): void {
    const create = this.deps.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike)
    let socket: SocketLike
    try {
      socket = create(url)
    } catch (err) {
      console.error('[twitch-eventsub] nie udało się utworzyć połączenia:', err)
      this.scheduleReconnect()
      return
    }
    if (isReconnect) {
      this.dropSocket(this.pendingSocket)
      this.pendingSocket = socket
    } else {
      this.dropSocket(this.socket)
      this.socket = socket
      // Watchdog od razu: gniazdo, które nigdy nie przyśle session_welcome, też zostanie ponowione.
      this.armKeepalive()
    }
    socket.on('message', (data) => this.handleRaw(socket, data.toString()))
    socket.on('error', (err) => console.warn('[twitch-eventsub] błąd gniazda:', err.message))
    socket.on('close', (code) => this.handleClose(socket, code))
  }

  private handleClose(socket: SocketLike, code: number): void {
    if (socket === this.pendingSocket) {
      // Nieudany reconnect - zostajemy na starym gnieździe (jeśli żyje), inaczej pełny reconnect.
      this.pendingSocket = undefined
      if (!this.socket) this.scheduleReconnect()
      return
    }
    if (socket !== this.socket) return
    this.socket = undefined
    this.activeKinds = new Set()
    // Keepalive zamkniętego gniazda nie może potem "zabić" następnego połączenia.
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = undefined
    if (!this.running) return
    console.warn(`[twitch-eventsub] połączenie zamknięte (kod ${code}) — ponawiam`)
    this.deps.onStatus?.('EventSub: rozłączono, ponawiam połączenie…', false)
    this.scheduleReconnect()
  }

  private handleRaw(socket: SocketLike, raw: string): void {
    if (socket !== this.socket && socket !== this.pendingSocket) return
    let msg: { metadata?: { message_id?: string; message_type?: string; subscription_type?: string }; payload?: Record<string, unknown> }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const type = msg.metadata?.message_type
    if (socket === this.socket) this.armKeepalive()

    switch (type) {
      case 'session_welcome': {
        const session = (msg.payload?.['session'] ?? {}) as { id?: string; keepalive_timeout_seconds?: number }
        if (typeof session.keepalive_timeout_seconds === 'number' && session.keepalive_timeout_seconds > 0) {
          this.keepaliveMs = session.keepalive_timeout_seconds * 1000 + KEEPALIVE_GRACE_MS
          if (socket === this.socket) this.armKeepalive()
        }
        if (socket === this.pendingSocket) {
          // Zakończenie session_reconnect: stare gniazdo zamykamy, subskrypcje przeszły same.
          this.dropSocket(this.socket)
          this.socket = socket
          this.pendingSocket = undefined
          this.armKeepalive()
          return
        }
        this.backoff.reset()
        if (session.id) void this.subscribeAll(session.id, socket)
        return
      }
      case 'session_keepalive':
        return
      case 'session_reconnect': {
        const session = (msg.payload?.['session'] ?? {}) as { reconnect_url?: string }
        const url = session.reconnect_url
        if (url && url.startsWith('wss://') && /(^|\.)twitch\.tv$/.test(new URL(url).hostname)) {
          this.connect(url, true)
        }
        return
      }
      case 'notification':
        this.handleNotification(msg.metadata?.message_id, msg.payload)
        return
      case 'revocation': {
        const sub = (msg.payload?.['subscription'] ?? {}) as { type?: string; status?: string }
        console.warn(`[twitch-eventsub] subskrypcja ${sub.type} cofnięta (${sub.status})`)
        const def = EVENTSUB_SUBSCRIPTIONS.find((d) => d.type === sub.type)
        if (def) for (const k of def.kinds) this.activeKinds.delete(k)
        this.deps.onStatus?.(
          `EventSub: Twitch cofnął subskrypcję ${sub.type} (${sub.status ?? '?'}) — zaloguj się ponownie w ustawieniach Twitcha.`,
          true
        )
        return
      }
    }
  }

  private handleNotification(messageId: string | undefined, payload: Record<string, unknown> | undefined): void {
    if (!messageId || !payload || !this.target) return
    if (this.seenIds.has(messageId)) return
    this.seenIds.add(messageId)
    this.seenOrder.push(messageId)
    if (this.seenOrder.length > MAX_SEEN_IDS) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seenIds.delete(oldest)
    }
    const subscription = (payload['subscription'] ?? {}) as { type?: string; condition?: Record<string, unknown> }
    const event = payload['event']
    if (!subscription.type || !event || typeof event !== 'object') return
    try {
      const message = normalizeEventSubNotification(
        {
          messageId,
          subscriptionType: subscription.type,
          condition: subscription.condition ?? {},
          event: event as Record<string, unknown>
        },
        this.target.broadcasterLogin,
        this.deps.normalizeOptions
      )
      if (message) this.deps.onMessage(message)
    } catch (err) {
      console.error('[twitch-eventsub] nie udało się przetworzyć zdarzenia:', err)
    }
  }

  private async subscribeAll(sessionId: string, socket: SocketLike): Promise<void> {
    const target = this.target
    if (!target) return
    const active = new Set<StreamEventKind>()
    const results: string[] = []
    const missing: string[] = []
    for (const def of EVENTSUB_SUBSCRIPTIONS) {
      if (socket !== this.socket || !this.running) return // sesja już nieaktualna
      if (def.anyScope.length > 0 && !def.anyScope.some((s) => target.grantedScopes.includes(s))) {
        missing.push(`${def.type} (wymaga: ${def.anyScope[0]})`)
        continue
      }
      const result = await this.subscribe(def, target, sessionId)
      if (result === 'ok') {
        for (const k of def.kinds) active.add(k)
        results.push(def.kinds.length > 0 ? def.kinds.join('/') : def.type)
      } else {
        missing.push(`${def.type} (${result === 'forbidden' ? 'brak uprawnień' : 'błąd'})`)
      }
    }
    if (socket !== this.socket) return
    this.activeKinds = active
    this.lastSummary =
      `EventSub aktywny: ${results.length > 0 ? results.join(', ') : 'brak subskrypcji'}` +
      (missing.length > 0 ? `. Niedostępne: ${missing.join('; ')}` : '')
    console.info(`[twitch-eventsub] ${this.lastSummary}`)
    this.deps.onStatus?.(this.lastSummary, missing.length > 0)
  }

  private async subscribe(def: SubscriptionDef, target: EventSubTarget, sessionId: string): Promise<SubscribeResult> {
    const doFetch = this.deps.fetchImpl ?? fetch
    const body = JSON.stringify({
      type: def.type,
      version: def.version,
      condition: def.condition(target),
      transport: { method: 'websocket', session_id: sessionId }
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = attempt === 0 ? await this.deps.getToken() : await this.deps.refreshToken()
      if (!token) return 'error'
      let res: Response
      try {
        res = await doFetch(SUBSCRIPTIONS_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Client-Id': target.clientId, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(10_000)
        })
      } catch {
        return 'error'
      }
      if (res.status === 202 || res.status === 409) return 'ok'
      if (res.status === 401 && attempt === 0) continue
      if (res.status === 403) return 'forbidden'
      const text = await res.text().catch(() => '')
      console.warn(`[twitch-eventsub] ${def.type} → HTTP ${res.status} ${text.slice(0, 200)}`)
      return 'error'
    }
    return 'error'
  }

  private armKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = setTimeout(() => {
      console.warn('[twitch-eventsub] brak keepalive — połączenie uznane za martwe')
      const dead = this.socket
      this.socket = undefined
      this.activeKinds = new Set()
      this.dropSocket(dead)
      if (this.running) this.scheduleReconnect()
    }, this.keepaliveMs)
  }

  private scheduleReconnect(): void {
    if (!this.running) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.running && !this.socket) this.connect(EVENTSUB_WS_URL, false)
    }, this.backoff.next())
  }

  private clearTimers(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.keepaliveTimer = undefined
    this.reconnectTimer = undefined
  }

  private dropSocket(socket: SocketLike | undefined): void {
    if (!socket) return
    socket.removeAllListeners()
    socket.on('error', () => undefined) // terminate() po removeAllListeners nie może rzucić "unhandled error"
    try {
      socket.terminate()
    } catch {
      /* gniazdo mogło być już zamknięte */
    }
  }
}

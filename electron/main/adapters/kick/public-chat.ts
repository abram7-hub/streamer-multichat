import WebSocket from 'ws'
import type { ChatMessage } from '../../../../shared/chat-message'
import type { ConnectionState } from '../../../../shared/platform'
import { normalizeKickSlug } from '../../../../shared/channel-input'
import { isAllowedAssetUrl } from '../../../../shared/emote-url'
import {
  normalizeKickPusherEvent,
  normalizeKickPusherMessage,
  type KickChannelContext,
  type KickPusherChatMessage,
  type KickSubscriberBadge
} from './normalize'
import { ExponentialBackoff } from '../common/backoff'

/**
 * Odczyt publicznego czatu Kicka BEZ logowania i BEZ webhooka/tunelu Cloudflare - przez ten sam
 * websocket Pusher, którym Kick dostarcza czat do przeglądarki każdego widza.
 *
 * Zweryfikowane na żywo (2026-10): Kick przestał akceptować dawny, wpisany na sztywno klucz Pushera
 * (`4001 App key ... not in this cluster`) i podaje go teraz dynamicznie przez publiczny endpoint
 * `web.kick.com/api/v1/realtime/connection` (bez logowania) - dlatego klucz/klaster pobieramy stamtąd,
 * z zapasowym, ostatnio znanym kluczem. Dane kanału (`kick.com/api/v1/channels/{slug}`) dają ID
 * pokoju czatu, status LIVE i oficjalne obrazki odznak subskrybenta. Gdyby Cloudflare zablokował to
 * zapytanie na danej sieci, można podać ID pokoju ręcznie (lista "Kanały").
 */
const CHANNEL_INFO_URLS = (slug: string): string[] => [
  `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`,
  `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`
]
const REALTIME_CONFIG_URL = 'https://web.kick.com/api/v1/realtime/connection'
const FALLBACK_PUSHER = { appKey: '0000000000', cluster: 'us2' }
const SETUP_RETRY_MS = 60_000
const MIN_RECONNECT_MS = 3000
const MAX_RECONNECT_MS = 60_000
/** Pusher zamyka połączenie bez ruchu po ~120 s - wysyłamy pusher:ping, gdy nic nie przychodzi. */
const PING_AFTER_SILENCE_MS = 60_000
const DEAD_AFTER_SILENCE_MS = 150_000

export interface KickChannelWatchHandlers {
  onMessage(message: ChatMessage): void
  onStatus(state: ConnectionState, message?: string): void
  /** Opcjonalnie: status transmisji z danych kanału (true = LIVE). */
  onLive?(isLive: boolean): void
}

interface ChatroomSubscription {
  handlers: Set<KickChannelWatchHandlers>
  slug: string
  chatroomId: number | undefined
  subscribed: boolean
  manualChatroomId: number | undefined
  context: KickChannelContext | undefined
}

export interface KickChannelInfo {
  chatroomId: number | undefined
  isLive: boolean
  context: KickChannelContext
}

/** Czysta funkcja: dane kanału z `kick.com/api/v2/channels/{slug}`. */
export function parseKickChannelInfo(json: unknown): KickChannelInfo {
  const data = (json ?? {}) as {
    chatroom?: { id?: unknown }
    livestream?: unknown
    subscriber_badges?: { months?: unknown; badge_image?: { src?: unknown } }[]
  }
  const subscriberBadges: KickSubscriberBadge[] = []
  for (const b of Array.isArray(data.subscriber_badges) ? data.subscriber_badges : []) {
    const src = typeof b?.badge_image?.src === 'string' ? b.badge_image.src : undefined
    if (typeof b?.months === 'number' && isAllowedAssetUrl(src, 'kick')) subscriberBadges.push({ months: b.months, imageUrl: src })
  }
  return {
    chatroomId: typeof data.chatroom?.id === 'number' ? data.chatroom.id : undefined,
    isLive: Boolean(data.livestream),
    context: { subscriberBadges }
  }
}

/**
 * Dane kanału. Zweryfikowane (2026-10): Cloudflare Kicka odpowiadał 403 "Request blocked by security
 * policy" wyłącznie dlatego, że wcześniejsza wersja wysyłała podrobiony nagłówek User-Agent
 * przeglądarki, niepasujący do odcisku TLS klienta Node/Electrona. Bez podszywania się oba endpointy
 * (v1 i v2) zwracają 200; v1 jest pierwszy, v2 zapasowo.
 */
export async function fetchKickChannelInfo(slug: string): Promise<KickChannelInfo | undefined> {
  let lastStatus = 0
  for (const url of CHANNEL_INFO_URLS(slug)) {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.status === 404) return undefined
    if (res.ok) return parseKickChannelInfo(await res.json())
    lastStatus = res.status
  }
  throw new Error(`kick.com/api/…/channels zwrócił HTTP ${lastStatus}`)
}

/** Czysta funkcja: konfiguracja Pushera z odpowiedzi `realtime/connection`. */
export function parseRealtimeConfig(json: unknown): { appKey: string; cluster: string } | undefined {
  const connections = (json as { data?: { connections?: unknown } } | null)?.data?.connections
  if (!Array.isArray(connections)) return undefined
  for (const c of connections as { provider?: unknown; credentials?: { app_key?: unknown; cluster?: unknown } }[]) {
    const key = c?.credentials?.app_key
    const cluster = c?.credentials?.cluster
    if (c?.provider === 'pusher' && typeof key === 'string' && /^[a-f0-9]{10,40}$/.test(key) && typeof cluster === 'string' && /^[a-z0-9-]{2,12}$/.test(cluster)) {
      return { appKey: key, cluster }
    }
  }
  return undefined
}

async function fetchRealtimeConfig(): Promise<{ appKey: string; cluster: string } | undefined> {
  try {
    const res = await fetch(REALTIME_CONFIG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client: { id: 'streamer-multichat', type: 'web' },
        capabilities: { accepted_providers: [{ provider: 'pusher' }] }
      }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return undefined
    return parseRealtimeConfig(await res.json())
  } catch {
    return undefined
  }
}

/**
 * JEDNO współdzielone połączenie Pusher dla wszystkich obserwowanych kanałów Kicka (główny kanał +
 * lista "Kanały"), liczące referencje jak klient IRC Twitcha.
 */
export class KickPublicChatClient {
  private ws: WebSocket | undefined
  private readonly backoff = new ExponentialBackoff(MIN_RECONNECT_MS, MAX_RECONNECT_MS)
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private watchdog: ReturnType<typeof setInterval> | undefined
  private readonly bySlug = new Map<string, ChatroomSubscription>()
  private readonly byChatroomId = new Map<number, string>()
  private socketReady = false
  private lastDataAt = 0
  private pusher: { appKey: string; cluster: string } | undefined
  private connecting = false

  /** `manualChatroomId` to zapasowa ścieżka na wypadek zablokowanego automatycznego rozwiązywania slugu. */
  watch(slugRaw: string, handlers: KickChannelWatchHandlers, manualChatroomId?: number): () => void {
    const slug = normalizeKickSlug(slugRaw)
    let sub = this.bySlug.get(slug)
    const isNew = !sub
    if (!sub) {
      sub = { handlers: new Set(), slug, chatroomId: undefined, subscribed: false, manualChatroomId, context: undefined }
      this.bySlug.set(slug, sub)
    }
    sub.handlers.add(handlers)
    handlers.onStatus(sub.subscribed ? 'connected' : 'connecting')

    if (isNew) void this.setupChannel(sub)

    return () => this.unwatch(slug, handlers)
  }

  /** Ponowne pobranie danych kanału (status LIVE, odznaki subów) - np. okresowo przez adapter Kicka. */
  async refreshChannel(slugRaw: string): Promise<KickChannelInfo | undefined> {
    const sub = this.bySlug.get(normalizeKickSlug(slugRaw))
    if (!sub) return undefined
    const info = await fetchKickChannelInfo(sub.slug).catch(() => undefined)
    if (info && this.bySlug.get(sub.slug) === sub) {
      sub.context = info.context
      this.notify(sub, (h) => h.onLive?.(info.isLive))
    }
    return info
  }

  private async setupChannel(sub: ChatroomSubscription): Promise<void> {
    this.notify(sub, (h) => h.onStatus('connecting'))
    let chatroomId = sub.manualChatroomId
    try {
      const info = await fetchKickChannelInfo(sub.slug)
      if (info) {
        chatroomId = chatroomId ?? info.chatroomId
        sub.context = info.context
        this.notify(sub, (h) => h.onLive?.(info.isLive))
      } else if (!chatroomId) {
        this.notify(sub, (h) => h.onStatus('error', `Nie znaleziono kanału Kick „${sub.slug}”.`))
        return
      }
    } catch (err) {
      if (!chatroomId) {
        this.notify(sub, (h) =>
          h.onStatus(
            'error',
            `Nie udało się pobrać danych kanału Kick „${sub.slug}” (${errMsg(err)}). Ponowię za minutę. Jeśli Kick ` +
              'blokuje to zapytanie na tej sieci, podaj ręcznie ID pokoju czatu w zakładce „Kanały”.'
          )
        )
        setTimeout(() => {
          if (this.bySlug.get(sub.slug) === sub && sub.chatroomId === undefined) void this.setupChannel(sub)
        }, SETUP_RETRY_MS)
        return
      }
    }
    if (this.bySlug.get(sub.slug) !== sub) return // odsubskrybowano w międzyczasie
    if (!chatroomId) {
      this.notify(sub, (h) => h.onStatus('error', `Nie znaleziono pokoju czatu kanału Kick „${sub.slug}”.`))
      return
    }
    sub.chatroomId = chatroomId
    this.byChatroomId.set(chatroomId, sub.slug)
    if (this.socketReady) this.subscribeChatroom(chatroomId)
    else void this.ensureSocket()
  }

  private unwatch(slug: string, handlers: KickChannelWatchHandlers): void {
    const sub = this.bySlug.get(slug)
    if (!sub) return
    sub.handlers.delete(handlers)
    if (sub.handlers.size > 0) return
    this.bySlug.delete(slug)
    if (sub.chatroomId !== undefined) {
      this.byChatroomId.delete(sub.chatroomId)
      if (this.socketReady && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event: 'pusher:unsubscribe', data: { channel: `chatrooms.${sub.chatroomId}.v2` } }))
      }
    }
    if (this.bySlug.size === 0) this.teardown()
  }

  private async ensureSocket(): Promise<void> {
    if (this.connecting) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.connecting = true
    try {
      if (!this.pusher) this.pusher = (await fetchRealtimeConfig()) ?? FALLBACK_PUSHER
    } finally {
      this.connecting = false
    }
    if (this.bySlug.size === 0) return
    this.connect(this.pusher)
  }

  private connect(config: { appKey: string; cluster: string }): void {
    this.dropSocket()
    this.socketReady = false
    const url = `wss://ws-${config.cluster}.pusher.com/app/${config.appKey}?protocol=7&client=js&version=8.4.0&flash=false`
    const ws = new WebSocket(url)
    this.ws = ws
    this.lastDataAt = Date.now()
    this.startWatchdog()
    ws.on('message', (raw) => {
      this.lastDataAt = Date.now()
      this.handleRaw(raw.toString())
    })
    ws.on('close', (code) => {
      if (this.ws !== ws) return
      ws.removeAllListeners()
      ws.on('error', () => undefined)
      this.ws = undefined
      this.socketReady = false
      // 4001/4003...: zły klucz aplikacji - pobierz aktualną konfigurację przed kolejną próbą.
      if (code >= 4000 && code < 4100) this.pusher = undefined
      for (const sub of this.bySlug.values()) {
        sub.subscribed = false
        this.notify(sub, (h) => h.onStatus('reconnecting', 'Rozłączono z czatem Kick — ponawiam.'))
      }
      this.scheduleReconnect()
    })
    ws.on('error', (err) => console.warn('[kick] błąd połączenia z publicznym czatem:', err.message))
  }

  private handleRaw(raw: string): void {
    let payload: { event?: string; channel?: string; data?: unknown }
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }
    switch (payload.event) {
      case 'pusher:connection_established':
        this.socketReady = true
        this.backoff.reset()
        for (const sub of this.bySlug.values()) {
          if (sub.chatroomId !== undefined) this.subscribeChatroom(sub.chatroomId)
        }
        return
      case 'pusher:error': {
        const data = (typeof payload.data === 'string' ? safeJson(payload.data) : payload.data) as { code?: number } | undefined
        if (data?.code && data.code >= 4000 && data.code < 4100) this.pusher = undefined
        return
      }
      case 'pusher_internal:subscription_succeeded': {
        const sub = this.subForChannel(payload.channel)
        if (sub) {
          sub.subscribed = true
          this.notify(sub, (h) => h.onStatus('connected'))
        }
        return
      }
      case 'pusher:ping':
        this.ws?.send(JSON.stringify({ event: 'pusher:pong', data: {} }))
        return
    }
    if (typeof payload.event !== 'string' || typeof payload.data !== 'string') return
    const sub = this.subForChannel(payload.channel)
    if (!sub) return
    const data = safeJson(payload.data) as Record<string, unknown> | undefined
    if (!data) return
    const message =
      payload.event === 'App\\Events\\ChatMessageEvent'
        ? normalizeKickPusherMessage(data as KickPusherChatMessage, sub.slug, sub.context)
        : normalizeKickPusherEvent(
            payload.event,
            data,
            sub.slug,
            `${sub.chatroomId}-${simpleHash(payload.event + payload.data)}-${Math.floor(Date.now() / 60_000)}`
          )
    if (message) this.notify(sub, (h) => h.onMessage(message))
  }

  private subForChannel(channel: string | undefined): ChatroomSubscription | undefined {
    const match = /^chatrooms\.(\d+)\.v2$/.exec(channel ?? '')
    if (!match?.[1]) return undefined
    const slug = this.byChatroomId.get(Number(match[1]))
    return slug ? this.bySlug.get(slug) : undefined
  }

  private subscribeChatroom(chatroomId: number): void {
    this.ws?.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: `chatrooms.${chatroomId}.v2` } }))
  }

  private notify(sub: ChatroomSubscription, fn: (h: KickChannelWatchHandlers) => void): void {
    for (const h of sub.handlers) fn(h)
  }

  private startWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const silence = Date.now() - this.lastDataAt
      if (silence > DEAD_AFTER_SILENCE_MS) ws.terminate()
      else if (silence > PING_AFTER_SILENCE_MS) ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }))
    }, 30_000)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.bySlug.size > 0) void this.ensureSocket()
    }, this.backoff.next())
  }

  private dropSocket(): void {
    if (!this.ws) return
    this.ws.removeAllListeners()
    this.ws.on('error', () => undefined)
    this.ws.terminate()
    this.ws = undefined
  }

  private teardown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = undefined
    this.dropSocket()
    this.socketReady = false
  }

  shutdown(): void {
    this.bySlug.clear()
    this.byChatroomId.clear()
    this.teardown()
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** ID zdarzenia bez własnego identyfikatora: ta sama treść w tej samej minucie = ten sam klucz deduplikacji. */
function simpleHash(text: string): string {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

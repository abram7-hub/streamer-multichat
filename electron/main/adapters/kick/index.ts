import type { ChatMessage } from '../../../../shared/chat-message'
import type { ConnectionState } from '../../../../shared/platform'
import type { KickSettings } from '../../../../shared/settings'
import { normalizeKickSlug } from '../../../../shared/channel-input'
import type { AdapterCallbacks, PlatformAdapter } from '../types'
import { loadSecret, SecretKeys } from '../../secure-store'
import { CloudflareTunnel } from '../../cloudflare-tunnel'
import { KickWebhookServer } from './webhook-server'
import { getStoredKickTokens, loginToKick, logoutKick, refreshKickToken } from './auth'
import { fetchKickChannel, subscribeToKickChatMessages, unsubscribeAllKick } from './subscriptions'
import { fetchKickChannelInfo, KickPublicChatClient } from './public-chat'
import { ExponentialBackoff } from '../common/backoff'

const LIVE_POLL_MS = 120_000
const MIN_RECONNECT_DELAY_MS = 3000
const MAX_RECONNECT_DELAY_MS = 60_000
const MAX_FINGERPRINTS = 500

/** Klucz treści wiadomości niezależny od transportu (webhook vs publiczny czat mogą mieć różne ID). */
export function kickFingerprint(message: ChatMessage): string {
  return `${message.author.id}|${message.rawText}|${Math.floor(message.timestampMs / 1000)}`
}

/**
 * Kick: czat skonfigurowanego kanału czytany jest PUBLICZNIE (Pusher, bez logowania, bez webhooka -
 * patrz public-chat.ts), dokładnie jak dowolny kanał z listy "Kanały". Webhook OAuth (oficjalne API,
 * wymaga Client ID/Secret, logowania i tunelu Cloudflare) pozostaje OPCJONALNY - jeśli jest w pełni
 * skonfigurowany, działa równolegle, a te same wiadomości z obu źródeł są odrzucane jako duplikaty.
 */
export class KickAdapter implements PlatformAdapter {
  readonly platform = 'kick' as const

  private readonly webhookServer = new KickWebhookServer()
  private readonly tunnel = new CloudflareTunnel()
  private livePollTimer: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private readonly backoff = new ExponentialBackoff(MIN_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS)
  private stopped = true
  private currentAccessToken: string | undefined
  private lastStartSignature: string | undefined
  private unwatch: (() => void) | undefined
  private chatState: ConnectionState = 'idle'
  private chatMessage: string | undefined
  private isLive: boolean | undefined
  private webhookWarning: string | undefined
  private webhookActive = false
  private readonly seen = new Set<string>()
  private readonly seenOrder: string[] = []

  constructor(
    private settings: () => KickSettings,
    private readonly callbacks: AdapterCallbacks,
    private readonly publicChat: KickPublicChatClient
  ) {}

  private slug(): string {
    return normalizeKickSlug(this.settings().channelSlug)
  }

  private emitStatus(): void {
    if (this.stopped) return
    const state: ConnectionState = this.chatState === 'connected' && this.isLive === false ? 'stream_offline' : this.chatState
    const message = state === 'stream_offline' ? 'Kanał jest offline — czat nadal jest odbierany.' : this.chatMessage
    this.callbacks.onStatus(state, message, this.slug(), this.webhookWarning)
  }

  private publish(message: ChatMessage): void {
    // Webhook i publiczny czat dostarczają te same wiadomości - tylko pierwsza kopia trafia dalej.
    if (this.webhookActive && !message.event) {
      const key = kickFingerprint(message)
      if (this.seen.has(key)) return
      this.seen.add(key)
      this.seenOrder.push(key)
      if (this.seenOrder.length > MAX_FINGERPRINTS) this.seen.delete(this.seenOrder.shift() as string)
    }
    this.callbacks.onMessage(message)
  }

  async start(): Promise<void> {
    const settings = this.settings()
    if (!settings.enabled) {
      await this.stop()
      return
    }
    // Patrz komentarz w TwitchAdapter.start() - bez tej strażniczki każda zmiana ustawień w kreatorze
    // (nawet innej platformy) zrywałaby i odtwarzała aktywne połączenie Kicka od nowa.
    const signature = JSON.stringify(settings)
    if (!this.stopped && signature === this.lastStartSignature) return
    this.lastStartSignature = signature
    this.stopped = false
    this.clearTimers()

    const slug = this.slug()
    if (!slug) {
      this.callbacks.onStatus('error', 'Uzupełnij nazwę kanału Kick w ustawieniach.')
      return
    }

    // Zmiana kanału: poprzednia subskrypcja jest odpinana przed nową (bez podwójnych wiadomości).
    this.unwatch?.()
    this.isLive = undefined
    this.chatState = 'connecting'
    this.chatMessage = undefined
    this.emitStatus()
    this.unwatch = this.publicChat.watch(slug, {
      onMessage: (message) => this.publish(message),
      onStatus: (state, message) => {
        this.chatState = state
        this.chatMessage = message
        this.emitStatus()
      },
      onLive: (isLive) => {
        this.isLive = isLive
        this.emitStatus()
      }
    })
    this.livePollTimer = setInterval(() => void this.publicChat.refreshChannel(slug), LIVE_POLL_MS)

    await this.startWebhookIfConfigured(settings, slug)
  }

  /** Opcjonalna, autoryzowana ścieżka (webhook OAuth). Błędy tutaj NIE przerywają publicznego czatu. */
  private async startWebhookIfConfigured(settings: KickSettings, slug: string): Promise<void> {
    await this.webhookServer.stop()
    this.webhookActive = false
    const { accessToken, refreshToken, clientSecret } = getStoredKickTokens()
    const configured = Boolean(settings.clientId && settings.webhookUrl && clientSecret && (accessToken || refreshToken))
    if (!configured) {
      this.setWebhookWarning(undefined)
      return
    }
    try {
      const refresh = (): Promise<string> => {
        if (!refreshToken) throw new Error('Sesja Kick wygasła — zaloguj się ponownie (webhook).')
        return refreshKickToken(settings.clientId, clientSecret as string, refreshToken)
      }
      let token = accessToken ?? (await refresh())
      await this.webhookServer.start(settings.localWebhookPort, slug, (msg) => this.publish(msg))
      try {
        await subscribeToKickChatMessages(token)
      } catch (err) {
        // Zapisany access token wygasa - odśwież go raz i ponów (wcześniej kończyło się trwałym 401).
        if (!/HTTP 401/.test(errMsg(err))) throw err
        token = await refresh()
        await subscribeToKickChatMessages(token)
      }
      if (this.stopped) return
      this.currentAccessToken = token
      this.webhookActive = true
      this.backoff.reset()
      this.setWebhookWarning(undefined)
    } catch (err) {
      if (this.stopped) return
      this.setWebhookWarning(`Webhook Kick (opcjonalny) nie działa: ${errMsg(err)}. Publiczny czat działa dalej.`)
      this.reconnectTimer = setTimeout(() => {
        if (!this.stopped) void this.startWebhookIfConfigured(this.settings(), this.slug())
      }, this.backoff.next())
    }
  }

  private setWebhookWarning(warning: string | undefined): void {
    if (warning === this.webhookWarning) return
    this.webhookWarning = warning
    this.emitStatus()
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.livePollTimer) clearInterval(this.livePollTimer)
    this.reconnectTimer = undefined
    this.livePollTimer = undefined
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.lastStartSignature = undefined
    this.clearTimers()
    this.unwatch?.()
    this.unwatch = undefined
    this.webhookActive = false
    this.webhookWarning = undefined
    await this.webhookServer.stop()
    this.callbacks.onStatus('disconnected')
  }

  async login(): Promise<{ ok: boolean; message?: string }> {
    const settings = this.settings()
    const clientSecret = loadSecret(SecretKeys.kickClientSecret)
    if (!settings.clientId || !clientSecret) {
      return { ok: false, message: 'Uzupełnij Client ID i Client Secret Kick przed logowaniem.' }
    }
    try {
      await loginToKick(settings.clientId, clientSecret, settings.oauthCallbackPort)
      this.lastStartSignature = undefined
      await this.start()
      return { ok: true }
    } catch (err) {
      return { ok: false, message: errMsg(err) }
    }
  }

  async logout(): Promise<void> {
    const token = this.currentAccessToken ?? loadSecret(SecretKeys.kickAccessToken)
    await this.webhookServer.stop()
    this.webhookActive = false
    if (token) await unsubscribeAllKick(token).catch(() => undefined)
    logoutKick()
  }

  async startTunnel(): Promise<{ ok: boolean; url?: string; message: string }> {
    return this.tunnel.start(this.settings().localWebhookPort)
  }

  stopTunnel(): void {
    this.tunnel.stop()
  }

  getTunnelStatus(): { running: boolean; url?: string } {
    return { running: this.tunnel.isRunning(), url: this.tunnel.getUrl() }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const slug = this.slug()
    if (!slug) return { ok: false, message: 'Uzupełnij nazwę kanału Kick.' }
    const info = await fetchKickChannelInfo(slug).catch((err: unknown) => err as Error)
    if (info instanceof Error) return { ok: false, message: `Nie udało się pobrać danych kanału „${slug}”: ${info.message}` }
    if (!info) return { ok: false, message: `Nie znaleziono kanału Kick „${slug}”.` }
    const parts = [`Publiczny czat kanału „${slug}” działa bez logowania. Kanał jest ${info.isLive ? 'na żywo' : 'offline'}.`]
    const settings = this.settings()
    const clientSecret = loadSecret(SecretKeys.kickClientSecret)
    if (settings.clientId && clientSecret) {
      const { accessToken, refreshToken } = getStoredKickTokens()
      let token = accessToken
      if (!token && refreshToken) token = await refreshKickToken(settings.clientId, clientSecret, refreshToken).catch(() => undefined)
      if (!token) parts.push('Webhook (opcjonalny): nie zalogowano.')
      else if (!(await fetchKickChannel(token, slug).catch(() => undefined))) parts.push('Webhook (opcjonalny): token nie działa dla tego kanału.')
      else parts.push(settings.webhookUrl ? 'Webhook (opcjonalny): skonfigurowany.' : 'Webhook (opcjonalny): brak URL tunelu.')
    }
    return { ok: true, message: parts.join(' ') }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

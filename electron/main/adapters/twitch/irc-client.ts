import WebSocket from 'ws'
import type { ActivityEvent, ChatMessage, StreamEventKind } from '../../../../shared/chat-message'
import type { ConnectionState } from '../../../../shared/platform'
import type { BadgeResolver } from './badges'
import { MembershipTracker } from './membership-tracker'
import { normalizeTwitchIrcMessage } from './irc-normalize'
import { parsePrivmsgLine, parseTaggedCommandLine, type ParsedPrivmsg, type ParsedTaggedCommand } from './irc-tags'
import { normalizeTwitchUserNotice } from './irc-usernotice'
import { ExponentialBackoff } from '../common/backoff'

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'
const BURST_WINDOW_MS = 4000
const JOIN_TIMEOUT_MS = 12_000
const MIN_RECONNECT_MS = 3000
const MAX_RECONNECT_MS = 60_000
/** Twitch wysyła PING co ~5 min. Brak JAKICHKOLWIEK danych przez 6 min = martwe połączenie
 *  (np. uśpienie systemu, zerwany NAT) - wymuszamy reconnect zamiast czekać w nieskończoność. */
const SILENCE_TIMEOUT_MS = 6 * 60_000
const WATCHDOG_INTERVAL_MS = 60_000
const MAX_REMEMBERED_COLORS = 2000

/** Dokleja emotki zewnętrzne (7TV/BTTV) na podstawie numerycznego `room-id` kanału. */
export type MessageEnricher = (message: ChatMessage, roomId: string | undefined) => ChatMessage
/** Czy dane zdarzenie dla kanału jest już dostarczane przez autoryzowany EventSub (wtedy publiczny
 *  odpowiednik z IRC jest pomijany, żeby nie było duplikatów). */
export type EventCoverage = (channelLogin: string, kind: StreamEventKind) => boolean

export interface ChannelWatchHandlers {
  onMessage(message: ChatMessage): void
  onActivity(event: ActivityEvent): void
  onStatus(state: ConnectionState, message?: string): void
}

interface ChannelSubscription {
  handlers: Set<ChannelWatchHandlers>
  tracker: MembershipTracker
  joined: boolean
  joinTimeout: ReturnType<typeof setTimeout> | undefined
  roomId: string | undefined
}

function normalizeChannel(raw: string): string {
  return raw.toLowerCase().replace(/^#/, '').trim()
}

/**
 * JEDNO współdzielone, anonimowe połączenie WebSocket z IRC Twitcha dla całej aplikacji - obsługuje
 * dowolną liczbę jednocześnie obserwowanych kanałów przez pojedynczy socket (IRC natywnie wspiera
 * JOIN wielu kanałów na jednym połączeniu) zamiast otwierać osobne połączenie na kanał. Liczy
 * referencje: jeśli ten sam kanał obserwuje jednocześnie skonfigurowana integracja główna ORAZ wpis
 * z listy "Kanały", JOIN wysyłany jest tylko raz, a wiadomości trafiają do obu subskrybentów.
 *
 * Połączenie jest w pełni anonimowe (nick "justinfanNNNNN", bez OAuth) - udokumentowany, od dawna
 * działający sposób na tylko-do-odczytu dostęp do publicznego czatu IRC Twitcha DOWOLNEGO kanału,
 * bez logowania. To także jedyny sposób na uzyskanie prawdziwego koloru nicku, wiadomości /me (CTCP
 * ACTION) oraz zdarzeń JOIN/PART w tej aplikacji - nowszy EventSub Twitcha (używany tu wcześniej)
 * nie udostępnia żadnego z tych trzech.
 */
export class TwitchIrcClient {
  private ws: WebSocket | undefined
  private ownNick = ''
  private readonly backoff = new ExponentialBackoff(MIN_RECONNECT_MS, MAX_RECONNECT_MS)
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private readonly channels = new Map<string, ChannelSubscription>()
  private badgeResolver: BadgeResolver | undefined
  private rewardTitle: (channelLogin: string, rewardId: string) => string | undefined = () => undefined
  private enricher: MessageEnricher = (m) => m
  private eventCoverage: EventCoverage = () => false
  private onRoomId: (channelLogin: string, roomId: string) => void = () => undefined
  private lastDataAt = 0
  private watchdog: ReturnType<typeof setInterval> | undefined
  /** Prawdziwe kolory nicków (tag `color`) ostatnio piszących - EventSub nie podaje koloru. LRU. */
  private readonly userColors = new Map<string, string>()

  setMessageEnricher(enricher: MessageEnricher): void {
    this.enricher = enricher
  }

  setEventCoverage(coverage: EventCoverage): void {
    this.eventCoverage = coverage
  }

  /** Powiadamiany przy poznaniu numerycznego ID kanału (ROOMSTATE) - np. do prefetchu emotek. */
  setRoomIdListener(listener: (channelLogin: string, roomId: string) => void): void {
    this.onRoomId = listener
  }

  /** `room-id` wszystkich aktualnie obserwowanych kanałów (np. do pobrania odznak po zalogowaniu). */
  knownRoomIds(): string[] {
    const ids: string[] = []
    for (const sub of this.channels.values()) if (sub.roomId) ids.push(sub.roomId)
    return ids
  }

  /** Kolor nicku ustawiony przez użytkownika na Twitchu, jeśli widzieliśmy go w czacie. */
  getUserColor(userId: string): string | undefined {
    return this.userColors.get(userId)
  }

  private rememberColor(userId: string | undefined, color: string | undefined): void {
    if (!userId || !color) return
    this.userColors.delete(userId)
    this.userColors.set(userId, color)
    if (this.userColors.size > MAX_REMEMBERED_COLORS) {
      const oldest = this.userColors.keys().next().value
      if (oldest !== undefined) this.userColors.delete(oldest)
    }
  }

  /** Numeryczne ID kanału z ROOMSTATE (bez logowania), jeśli już znane. */
  getRoomId(channelLoginRaw: string): string | undefined {
    return this.channels.get(normalizeChannel(channelLoginRaw))?.roomId
  }

  /** Źródło obrazków odznak (cache Helix globalnych i kanałowych - patrz badges.ts). */
  setBadgeResolver(resolver: BadgeResolver): void {
    this.badgeResolver = resolver
  }

  /** Nazwa nagrody Channel Points po ID (znana tylko dla własnego kanału - Helix Get Custom Reward). */
  setRewardTitleResolver(resolver: (channelLogin: string, rewardId: string) => string | undefined): void {
    this.rewardTitle = resolver
  }

  /** Zaczyna obserwować kanał (JOIN wysyłany tylko przy pierwszym obserwującym). Zwraca funkcję odsubskrybowującą. */
  watch(channelLoginRaw: string, handlers: ChannelWatchHandlers): () => void {
    const channel = normalizeChannel(channelLoginRaw)
    let sub = this.channels.get(channel)
    const isNewChannel = !sub
    if (!sub) {
      sub = { handlers: new Set(), tracker: new MembershipTracker(), joined: false, joinTimeout: undefined, roomId: undefined }
      this.channels.set(channel, sub)
    }
    sub.handlers.add(handlers)
    handlers.onStatus(sub.joined ? 'connected' : 'connecting')

    if (isNewChannel) {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
        this.connect()
      } else if (this.ws.readyState === WebSocket.OPEN) {
        this.sendJoin(channel)
      }
      // Jeśli socket jest w trakcie łączenia (CONNECTING), handler 'open' dołączy do wszystkich
      // kanałów obecnych w mapie (w tym tego nowego) automatycznie.
    }

    return () => this.unwatch(channel, handlers)
  }

  private unwatch(channel: string, handlers: ChannelWatchHandlers): void {
    const sub = this.channels.get(channel)
    if (!sub) return
    sub.handlers.delete(handlers)
    if (sub.handlers.size > 0) return
    this.channels.delete(channel)
    if (sub.joinTimeout) clearTimeout(sub.joinTimeout)
    if (sub.joined && this.ws?.readyState === WebSocket.OPEN) this.ws.send(`PART #${channel}`)
    if (this.channels.size === 0) this.teardownSocket()
  }

  private connect(): void {
    // Nigdy dwa sockety naraz: stary (jeśli jakimś cudem jeszcze żyje) jest odpinany i zamykany.
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.on('error', () => undefined)
      this.ws.terminate()
    }
    const ws = new WebSocket(IRC_URL)
    this.ws = ws
    this.lastDataAt = Date.now()
    this.startWatchdog()

    ws.on('open', () => {
      this.ownNick = `justinfan${Math.floor(10000 + Math.random() * 89999)}`
      ws.send('PASS SCHMOOPIIE')
      ws.send(`NICK ${this.ownNick}`)
      ws.send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands')
      for (const channel of this.channels.keys()) this.sendJoin(channel)
    })
    ws.on('message', (raw) => {
      this.lastDataAt = Date.now()
      this.handleRaw(raw.toString())
    })
    ws.on('close', () => {
      for (const sub of this.channels.values()) {
        sub.joined = false
        if (sub.joinTimeout) {
          clearTimeout(sub.joinTimeout)
          sub.joinTimeout = undefined
        }
        this.notify(sub, (h) => h.onStatus('reconnecting', 'Rozłączono z Twitch IRC.'))
      }
      this.scheduleReconnect()
    })
    ws.on('error', (err) => {
      console.error('[twitch] błąd anonimowego IRC:', err)
    })
  }

  private sendJoin(channel: string): void {
    this.ws?.send(`JOIN #${channel}`)
    const sub = this.channels.get(channel)
    if (!sub || sub.joinTimeout) return
    sub.joinTimeout = setTimeout(() => {
      sub.joinTimeout = undefined
      const current = this.channels.get(channel)
      if (current && !current.joined) {
        this.notify(current, (h) =>
          h.onStatus('error', `Nie udało się dołączyć do kanału #${channel} — sprawdź nazwę kanału.`)
        )
      }
    }, JOIN_TIMEOUT_MS)
  }

  private startWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (Date.now() - this.lastDataAt > SILENCE_TIMEOUT_MS) {
        console.warn('[twitch] IRC milczy zbyt długo — wymuszam ponowne połączenie')
        ws.terminate() // wywoła 'close' -> scheduleReconnect()
      }
    }, WATCHDOG_INTERVAL_MS)
  }

  private teardownSocket(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = undefined
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.on('error', () => undefined)
      this.ws.close()
    }
    this.ws = undefined
  }

  private handleRaw(raw: string): void {
    for (const line of raw.split('\r\n')) {
      if (!line) continue
      if (line.startsWith('PING')) {
        this.ws?.send(line.replace('PING', 'PONG'))
        continue
      }
      if (/^:tmi\.twitch\.tv 001 /.test(line)) {
        this.backoff.reset()
        continue
      }
      const joinMatch = /^:([^!\s]+)!\S+ JOIN (#\S+)$/.exec(line)
      if (joinMatch?.[1] && joinMatch[2]) {
        this.handleJoinLine(joinMatch[1], joinMatch[2].slice(1))
        continue
      }
      const partMatch = /^:([^!\s]+)!\S+ PART (#\S+)$/.exec(line)
      if (partMatch?.[1] && partMatch[2]) {
        this.handlePartLine(partMatch[1], partMatch[2].slice(1))
        continue
      }
      const privmsg = parsePrivmsgLine(line)
      if (privmsg) {
        this.handlePrivmsg(privmsg)
        continue
      }
      const tagged = parseTaggedCommandLine(line)
      if (tagged) {
        if (tagged.command === 'ROOMSTATE') this.handleRoomState(tagged)
        else this.handleUserNotice(tagged)
      }
    }
  }

  private handleJoinLine(nick: string, channel: string): void {
    const sub = this.channels.get(channel)
    if (!sub) return
    if (nick === this.ownNick) {
      sub.joined = true
      if (sub.joinTimeout) {
        clearTimeout(sub.joinTimeout)
        sub.joinTimeout = undefined
      }
      sub.tracker.startBurstWindow(Date.now(), BURST_WINDOW_MS)
      this.notify(sub, (h) => h.onStatus('connected'))
      return
    }
    if (!sub.tracker.handleJoin(nick, Date.now())) return
    this.notify(sub, (h) =>
      h.onActivity({
        id: `twitch-join-${channel}-${nick}-${Date.now()}`,
        platform: 'twitch',
        type: 'join',
        username: nick,
        timestampMs: Date.now()
      })
    )
  }

  private handlePartLine(nick: string, channel: string): void {
    const sub = this.channels.get(channel)
    if (!sub || nick === this.ownNick) return
    if (!sub.tracker.handlePart(nick, Date.now())) return
    this.notify(sub, (h) =>
      h.onActivity({
        id: `twitch-part-${channel}-${nick}-${Date.now()}`,
        platform: 'twitch',
        type: 'part',
        username: nick,
        timestampMs: Date.now()
      })
    )
  }

  private handleRoomState(parsed: ParsedTaggedCommand): void {
    const sub = this.channels.get(parsed.channel)
    const roomId = parsed.tags['room-id']
    if (!sub || !roomId || !/^\d+$/.test(roomId)) return
    if (sub.roomId === roomId) return
    sub.roomId = roomId
    this.onRoomId(parsed.channel, roomId)
  }

  private handlePrivmsg(parsed: ParsedPrivmsg): void {
    const channel = parsed.channel.toLowerCase()
    const sub = this.channels.get(channel)
    if (!sub) return
    const roomId = this.resolveRoomId(sub, parsed.tags['room-id'])
    let message = normalizeTwitchIrcMessage(parsed, channel, this.badgeResolver, roomId)
    this.rememberColor(parsed.tags['user-id'], parsed.tags.color)
    const bits = Number(parsed.tags.bits)
    const rewardId = parsed.tags['custom-reward-id']
    if (Number.isFinite(bits) && bits > 0) {
      // Cheer jest częścią zwykłej wiadomości czatu (tag `bits`) - publiczny dla każdego widza.
      // Gdy własny kanał ma aktywny EventSub `channel.cheer`, zdarzenie (z tą samą treścią) przyjdzie
      // stamtąd, więc tę kopię pomijamy.
      if (this.eventCoverage(channel, 'cheer')) return
      message = { ...message, event: { kind: 'cheer', source: 'irc', bits } }
    } else if (rewardId) {
      // Nagroda Channel Points Z TEKSTEM użytkownika trafia też na publiczny czat jako PRIVMSG z tagiem
      // `custom-reward-id` (nagrody bez tekstu nie trafiają do IRC wcale). Przy aktywnym EventSub
      // własnego kanału ta sama nagroda przychodzi stamtąd - z nazwą i kosztem - więc kopię pomijamy.
      if (this.eventCoverage(channel, 'redemption')) return
      message = {
        ...message,
        event: { kind: 'redemption', source: 'irc', rewardTitle: this.rewardTitle(channel, rewardId) }
      }
    }
    message = this.enricher(message, roomId)
    this.notify(sub, (h) => h.onMessage(message))
  }

  private handleUserNotice(parsed: ParsedTaggedCommand): void {
    const sub = this.channels.get(parsed.channel)
    if (!sub) return
    const roomId = this.resolveRoomId(sub, parsed.tags['room-id'])
    const normalized = normalizeTwitchUserNotice(parsed, this.badgeResolver, roomId)
    if (!normalized?.event) return
    const kind = normalized.event.kind
    // Suby i gifty dla własnego kanału przychodzą też z EventSub - unikamy podwójnych wierszy.
    const coveredKind = kind === 'gift_sub' ? 'community_gift' : kind
    if (this.eventCoverage(parsed.channel, coveredKind)) return
    const message = this.enricher(normalized, roomId)
    this.notify(sub, (h) => h.onMessage(message))
  }

  private resolveRoomId(sub: ChannelSubscription, tagRoomId: string | undefined): string | undefined {
    if (!sub.roomId && tagRoomId && /^\d+$/.test(tagRoomId)) sub.roomId = tagRoomId
    return sub.roomId
  }

  private notify(sub: ChannelSubscription, fn: (h: ChannelWatchHandlers) => void): void {
    for (const h of sub.handlers) fn(h)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (this.channels.size > 0) this.connect()
    }, this.backoff.next())
  }

  /** Zamyka połączenie całkowicie (np. przy zamykaniu aplikacji). */
  shutdown(): void {
    this.channels.clear()
    this.teardownSocket()
  }
}

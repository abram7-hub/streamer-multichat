import type { ChatBadge, ChatMessage, StreamEvent } from '../../../../shared/chat-message'
import type { Platform } from '../../../../shared/platform'
import type { AdapterCallbacks, PlatformAdapter } from '../types'

/** Prawdziwe adresy oficjalnych odznak (globalne odznaki Twitcha, odznaki Kicka/TikToka z CDN-ów
 *  platform) - żeby podgląd w trybie demo wyglądał jak prawdziwy czat. */
const TWITCH_BADGE = (uuid: string): string => `https://static-cdn.jtvnw.net/badges/v1/${uuid}/1`
const DEMO_BADGES: Record<string, ChatBadge> = {
  broadcaster: {
    id: 'broadcaster/1',
    type: 'broadcaster',
    label: 'Broadcaster',
    imageUrl: TWITCH_BADGE('5527c58c-fb7d-422d-b71b-f309dcb85cc1'),
    provider: 'twitch'
  },
  moderator: {
    id: 'moderator/1',
    type: 'moderator',
    label: 'Moderator',
    imageUrl: TWITCH_BADGE('3267646d-33f0-4b17-b3df-f923a41db1d0'),
    provider: 'twitch'
  },
  vip: { id: 'vip/1', type: 'vip', label: 'VIP', imageUrl: TWITCH_BADGE('b817aba4-fad8-49e2-b88a-7cc744dfa6ec'), provider: 'twitch' },
  kickLevel: {
    id: 'v2:level',
    type: 'level',
    label: 'Poziom 46',
    imageUrl: 'https://ext.cdn.kick.com/chat/badges/46_1629c3f5-cd67-4189-a508-be557265254d.png',
    provider: 'kick'
  },
  tiktokLevel: {
    id: 'scene-8-0',
    type: 'scene-8',
    label: 'Poziom 4',
    imageUrl: 'https://p16-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv1_v1.png~tplv-obj.image',
    provider: 'tiktok'
  }
}

const DEMO_USERS: Record<Platform, { name: string; color: string; badges: ChatBadge[] }[]> = {
  twitch: [
    { name: 'Streamer_', color: '#00FF7F', badges: [DEMO_BADGES['broadcaster']!] },
    { name: 'FiolkaTV', color: '#e91e63', badges: [DEMO_BADGES['moderator']!, DEMO_BADGES['vip']!] },
    { name: 'grzmot_92', color: '#3f51b5', badges: [] }
  ],
  kick: [
    { name: 'zielony_kompot', color: '#53FC18', badges: [DEMO_BADGES['kickLevel']!] },
    { name: 'Kasjer', color: '#4caf50', badges: [] }
  ],
  youtube: [
    { name: 'Ania ogląda', color: '#FF0000', badges: [] },
    { name: 'PixelDrwal', color: '#f44336', badges: [] }
  ],
  tiktok: [
    { name: 'tt_widz1', color: '#25F4EE', badges: [DEMO_BADGES['tiktokLevel']!] },
    { name: 'nocny.marek', color: '#FE2C55', badges: [] }
  ]
}

const DEMO_TEXTS = [
  'siema ekipa! 👋',
  'ale ten boss ciężki xD',
  'kiedy raid?',
  'GG WP',
  'to jest demo wiadomości testowych',
  'pozdro z Polski 🇵🇱',
  'LUL',
  'zagraj coś innego proszę',
  'super gra!',
  'streamer daj combo'
]

let counter = 0

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T
}

function makeDemoMessage(platform: Platform, highlightNick: string): ChatMessage {
  const user = randomFrom(DEMO_USERS[platform]!)
  // Co któraś wiadomość Twitcha to /me - podgląd koloru nicku na całej treści.
  const isAction = platform === 'twitch' && counter % 9 === 4
  // Co któraś wiadomość wspomina nick użytkownika - podgląd wyróżnienia wzmianek (oznacza ją
  // centralny detektor w procesie głównym, nie adapter).
  const mention = !isAction && highlightNick.length > 0 && counter % 7 === 3
  const text = isAction ? 'macha do kamery' : mention ? `@${highlightNick} ${randomFrom(DEMO_TEXTS)}` : randomFrom(DEMO_TEXTS)
  counter += 1
  return {
    id: `demo-${platform}-${counter}-${Date.now()}`,
    platform,
    channel: 'demo',
    author: {
      id: `demo-${platform}-${user.name}`,
      username: user.name,
      displayName: user.name,
      color: user.color,
      badges: user.badges,
      isBroadcaster: user.badges.some((b) => b.type === 'broadcaster'),
      isModerator: user.badges.some((b) => b.type === 'moderator'),
      isSubscriber: Math.random() > 0.7
    },
    fragments: [{ type: 'text', text }],
    rawText: text,
    isAction,
    timestampMs: Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false,
    isDemo: true,
    paid: Math.random() > 0.9 ? { label: 'Wsparcie testowe', amountFormatted: '5,00 PLN' } : undefined
  }
}

/** Przykładowe zdarzenia Twitcha w trybie demo - do podglądu wyglądu wiadomości systemowych
 *  (okno główne i nakładka OBS) bez prawdziwego streama. Oznaczone jako DEMO jak reszta. */
const DEMO_EVENTS: { event: StreamEvent; name: string; text?: string; platform?: Platform }[] = [
  { event: { kind: 'redemption', source: 'eventsub', rewardTitle: 'Hydratacja', rewardCost: 500 }, name: 'Streamer_', text: 'Napij się wody!' },
  { event: { kind: 'resub', source: 'irc', months: 3 }, name: 'User123', text: 'trzeci miesiąc z rzędu Kappa' },
  { event: { kind: 'superchat', source: 'platform', amountFormatted: '20,00 zł' }, name: 'Ania ogląda', text: 'dzięki za stream!', platform: 'youtube' },
  { event: { kind: 'community_gift', source: 'irc', giftCount: 5 }, name: 'Viewer99' },
  { event: { kind: 'tiktok_gift', source: 'platform', itemName: 'Rose', count: 12 }, name: 'nocny.marek', platform: 'tiktok' },
  { event: { kind: 'raid_in', source: 'irc', viewers: 84 }, name: 'StreamerXYZ' },
  { event: { kind: 'sub', source: 'platform' }, name: 'Kasjer', platform: 'kick' },
  { event: { kind: 'cheer', source: 'irc', bits: 500 }, name: 'User123', text: 'dobra robota!' }
]
let demoEventIndex = 0

function makeDemoEvent(): ChatMessage {
  const sample = DEMO_EVENTS[demoEventIndex++ % DEMO_EVENTS.length]!
  counter += 1
  const text = sample.text ?? ''
  return {
    id: `demo-event-${counter}-${Date.now()}`,
    platform: sample.platform ?? 'twitch',
    channel: 'demo',
    author: {
      id: `demo-${sample.platform ?? 'twitch'}-${sample.name}`,
      username: sample.name.toLowerCase(),
      displayName: sample.name,
      badges: [],
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments: text ? [{ type: 'text', text }] : [],
    rawText: text,
    timestampMs: Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false,
    isDemo: true,
    event: sample.event
  }
}

export class DemoAdapter implements PlatformAdapter {
  readonly platform = 'twitch' as const
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly callbacks: AdapterCallbacks,
    private readonly getHighlightNick: () => string
  ) {}

  isRunning(): boolean {
    return this.timer !== undefined
  }

  async start(): Promise<void> {
    // start() jest wołane przy każdej zmianie ustawień, gdy tryb demo jest włączony - drugi
    // setInterval nadpisałby uchwyt pierwszego i stop() nie mógłby go już wyczyścić.
    if (this.timer) return
    this.callbacks.onStatus('connected', 'Tryb demonstracyjny')
    // DEMO_INTERVAL_MS: hak wyłącznie do ręcznych testów wydajnościowych (symulacja dużego ruchu na
    // czacie) - bez zmiennej środowiskowej zachowuje się dokładnie jak wcześniej (1500 ms).
    const intervalMs = Number(process.env['DEMO_INTERVAL_MS']) || 1500
    let tick = 0
    this.timer = setInterval(() => {
      tick += 1
      if (tick % 7 === 0) {
        this.callbacks.onMessage(makeDemoEvent())
        return
      }
      const platform = randomFrom(['twitch', 'kick', 'youtube', 'tiktok'] as const)
      this.callbacks.onMessage(makeDemoMessage(platform, this.getHighlightNick()))
    }, intervalMs)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Tryb demonstracyjny nie wymaga połączenia.' }
  }
}

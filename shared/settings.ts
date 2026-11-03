import type { Platform } from './platform'
import { DEFAULT_GAMING_SETTINGS, type GamingOverlaySettings } from './gaming'
import { DEFAULT_MENTION_SETTINGS, type MentionHighlightSettings, type MentionSettings } from './mentions'
import {
  DEFAULT_APPEARANCE,
  resolveAppearance,
  type AppearanceSettings,
  type ChatAppearance,
  type PlatformColors
} from './appearance'

export interface TwitchSettings {
  enabled: boolean
  channelLogin: string
  clientId: string
  /** Emotki 7TV (globalne + kanałowe) doklejane do wiadomości Twitcha. */
  seventvEnabled: boolean
  /** Emotki BTTV (globalne + kanałowe) doklejane do wiadomości Twitcha. */
  bttvEnabled: boolean
  /**
   * Zdarzenia EventSub (Channel Points, suby, gifty, raidy, Bitsy, followy, Hype Train) - działają
   * WYŁĄCZNIE dla kanału zalogowanego użytkownika (wymagają uprawnień właściciela). Publiczne
   * komunikaty o subach/raidach z IRC pokazywane są niezależnie od tego ustawienia.
   */
  eventSubEnabled: boolean
  /** Pokazuj w czacie zdarzenia streamowe (suby, raidy, gifty, Bitsy itd.). */
  showStreamEvents: boolean
  /** Powiadomienia JOIN/PART z anonimowego IRC Twitcha (patrz twitch/irc-client.ts - ograniczenia opisane w UI). */
  showJoinPartNotifications: boolean
  /** Gdzie pokazywać powiadomienia JOIN/PART. */
  joinPartDisplay: 'chat' | 'panel'
}

export interface KickSettings {
  enabled: boolean
  channelSlug: string
  /** Client ID nie jest sekretem - client secret trzymany jest osobno w secure-store. */
  clientId: string
  /** Stały port lokalny na potrzeby OAuth redirect URI (musi być zarejestrowany w panelu Kick). */
  oauthCallbackPort: number
  /** Port lokalny, na którym nasłuchuje WYŁĄCZNIE endpoint webhooka (tunelowany przez Cloudflare). */
  localWebhookPort: number
  /** Publiczny URL tunelu Cloudflare, wpisywany ręcznie w panelu deweloperskim Kick. */
  webhookUrl: string
}

export interface YouTubeSettings {
  enabled: boolean
  /**
   * Co obserwować: URL kanału, @handle, ID kanału (UC...), URL transmisji lub filmu LIVE - format
   * rozpoznawany automatycznie (shared/youtube-input.ts). Nazwa pola zachowana dla zgodności
   * z zapisanymi ustawieniami.
   */
  channelHandle: string
  /** Client ID nie jest sekretem - client secret trzymany jest osobno w secure-store. */
  clientId: string
}

export interface TikTokSettings {
  enabled: boolean
  /** Nazwa użytkownika (@uniqueId) bez znaku "@". */
  uniqueId: string
}

/**
 * Ustawienia nakładki OBS niezwiązane z wyglądem wiadomości. Wygląd (czcionka, odznaki, animacje,
 * tła) jest w `appearance` - wspólny model z nadpisaniami dla nakładki (patrz shared/appearance.ts).
 */
export interface OverlaySettings {
  port: number
  maxMessages: number
  /** Krycie tła całej nakładki (0 = przezroczyste). */
  backgroundOpacity: number
  enabledPlatforms: Platform[]
  /** Lustrzane odbicie ui.lowResourceMode - patrz komentarz tam. Osobne pole, bo nakładka OBS ma
   *  własny, niezależny serwer/proces i pobiera ustawienia osobnym zapytaniem HTTP. */
  lowResourceMode: boolean
}

export interface UiSettings {
  windowWidth: number
  windowHeight: number
  windowX?: number
  windowY?: number
  enabledPlatforms: Platform[]
  autoScroll: boolean
  /** Wstrzymuj przewijanie do najnowszych, gdy kursor jest nad czatem (odbiór wiadomości trwa). */
  pauseOnHover: boolean
  /** Dodatkowy nick wyróżniany na wszystkich platformach (patrz `mentions`). */
  highlightNick: string
  /**
   * Tryb niskiego zużycia zasobów (do streamowania obok gry). Wydłuża okno
   * grupowania przychodzących wiadomości w paczki (mniej aktualizacji interfejsu/s), zmniejsza
   * limit wiadomości trzymanych w pamięci/DOM, i każe emotkom 7TV używać statycznej klatki zamiast
   * animowanej. NIE zrywa ani nie spowalnia odbierania wiadomości z integracji - to wyłącznie
   * ograniczenie pracy warstwy renderowania. Ustawienie przetrwa restart aplikacji.
   */
  lowResourceMode: boolean
}

/** Wpis na liście ignorowanych. `id` (stabilny identyfikator platformy) ma pierwszeństwo nad `username`,
 *  jeśli jest dostępny - dzięki temu zmiana wyświetlanej nazwy nie omija filtra. */
export interface IgnoreEntry {
  username: string
  id?: string
}

export interface IgnoreListSettings {
  enabled: boolean
  users: IgnoreEntry[]
}

export type IgnoreLists = Record<Platform, IgnoreListSettings>

/**
 * Dowolny, anonimowo obserwowany kanał (bez logowania) - sekcja "Kanały". Niezależne od głównej
 * skonfigurowanej integracji Twitch/Kick/YouTube/TikTok powyżej; można obserwować wiele kanałów,
 * również tej samej platformy jednocześnie. Jeśli ten sam kanał jest już połączony przez główną
 * integrację, aplikacja nie otwiera drugiego połączenia (patrz watched-channels.ts).
 */
export interface WatchedChannel {
  id: string
  platform: 'twitch' | 'kick'
  /** Nazwa kanału/slug (bez @ ani pełnego URL - akceptowane w UI, tam normalizowane do samej nazwy). */
  channel: string
  enabled: boolean
  /** Kick: zapasowe ręczne ID pokoju czatu, gdyby automatyczne rozpoznanie po slugu zawiodło (patrz kick/public-chat.ts). */
  kickChatroomId?: number
}

export interface AppSettings {
  /** Wersja struktury zapisanych ustawień - patrz shared/settings-migration.ts. */
  schemaVersion: number
  firstRunComplete: boolean
  demoMode: boolean
  twitch: TwitchSettings
  kick: KickSettings
  youtube: YouTubeSettings
  tiktok: TikTokSettings
  overlay: OverlaySettings
  ui: UiSettings
  ignoreLists: IgnoreLists
  watchedChannels: WatchedChannel[]
  appearance: AppearanceSettings
  gaming: GamingOverlaySettings
  mentions: MentionSettings
}

export const SETTINGS_SCHEMA_VERSION = 4

/** Wszystko, czego potrzebuje strona nakładki OBS (serwowane przez HTTP i WebSocket). */
export interface OverlayView {
  overlay: OverlaySettings
  appearance: ChatAppearance
  platformColors: PlatformColors
  mentionHighlight: MentionHighlightSettings
}

export function overlayView(settings: AppSettings): OverlayView {
  return {
    overlay: settings.overlay,
    appearance: resolveAppearance(settings.appearance, 'obs'),
    platformColors: settings.appearance.platformColors,
    mentionHighlight: settings.mentions.highlight
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  firstRunComplete: false,
  demoMode: false,
  twitch: {
    enabled: true,
    channelLogin: '',
    clientId: '',
    seventvEnabled: true,
    bttvEnabled: true,
    eventSubEnabled: true,
    showStreamEvents: true,
    showJoinPartNotifications: false,
    joinPartDisplay: 'panel'
  },
  kick: {
    enabled: false,
    channelSlug: '',
    clientId: '',
    oauthCallbackPort: 47320,
    localWebhookPort: 47312,
    webhookUrl: ''
  },
  youtube: {
    enabled: true,
    channelHandle: '',
    clientId: ''
  },
  tiktok: {
    enabled: true,
    uniqueId: ''
  },
  overlay: {
    port: 47311,
    maxMessages: 60,
    backgroundOpacity: 0,
    enabledPlatforms: ['twitch', 'kick', 'youtube', 'tiktok'],
    lowResourceMode: false
  },
  ui: {
    windowWidth: 460,
    windowHeight: 900,
    enabledPlatforms: ['twitch', 'kick', 'youtube', 'tiktok'],
    autoScroll: true,
    pauseOnHover: false,
    highlightNick: '',
    lowResourceMode: false
  },
  ignoreLists: {
    twitch: { enabled: true, users: [] },
    kick: { enabled: true, users: [] },
    youtube: { enabled: true, users: [] },
    tiktok: { enabled: true, users: [] }
  },
  watchedChannels: [],
  appearance: DEFAULT_APPEARANCE,
  gaming: DEFAULT_GAMING_SETTINGS,
  mentions: DEFAULT_MENTION_SETTINGS
}

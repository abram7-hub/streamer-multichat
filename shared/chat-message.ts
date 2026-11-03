import type { Platform } from './platform'

/** Źródło emotki - natywna Twitcha (z tagu IRC/EventSub) lub zewnętrzny provider. */
export type EmoteProvider = 'twitch' | '7tv' | 'bttv'

export type MessageFragment =
  | { type: 'text'; text: string }
  | {
      type: 'emote'
      text: string
      url: string
      provider?: EmoteProvider
      /** Proporcje obrazka (szerokość / wysokość), jeśli provider je podaje - pozwala zarezerwować
       *  miejsce przed załadowaniem obrazka (brak skakania układu i autoscrolla). */
      ratio?: number
      overlays?: { text: string; url: string }[]
    }
  | { type: 'link'; text: string; url: string }

/**
 * Wspólny model odznaki/roli. W wierszu wiadomości renderowane są WYŁĄCZNIE odznaki z oficjalnym
 * obrazkiem platformy (`imageUrl`) - sama nazwa roli (`label`) trafia tylko do tooltipa/aria-label,
 * nigdy jako tekst w czacie. Odznaki bez obrazka zostają w danych (np. do `isModerator`), ale są
 * niewidoczne.
 */
export interface ChatBadge {
  /** Unikalne w obrębie wiadomości, np. Twitch `subscriber/12`, Kick `subscriber`, TikTok `scene-8`. */
  id: string
  /** Rodzaj odznaki wg platformy (Twitch set_id, typ Kicka, scena TikToka...). */
  type: string
  /** Czytelna nazwa - tylko do tooltipa i czytników ekranu. */
  label: string
  imageUrl?: string
  imageUrl2x?: string
  imageUrl4x?: string
  provider: Platform
}

export interface ChatAuthor {
  id: string
  username: string
  displayName: string
  color?: string
  badges: ChatBadge[]
  isBroadcaster: boolean
  isModerator: boolean
  isSubscriber: boolean
}

/** Informacja o wiadomości płatnej (superchat, sub-gift itp.), jeśli platforma ją udostępnia. */
export interface PaidInfo {
  label: string
  amountFormatted?: string
}

export interface ChatMessage {
  /** Unikalne w obrębie platformy id - używane do deduplikacji jako `platform:id`. */
  id: string
  platform: Platform
  channel: string
  author: ChatAuthor
  fragments: MessageFragment[]
  rawText: string
  /** Czas wg platformy (jeśli dostępny), inaczej czas odbioru. */
  timestampMs: number
  receivedAtMs: number
  isHighlighted: boolean
  /** Wiadomość typu /me (CTCP ACTION) - cały tekst przyjmuje kolor nicku, jak w natywnym czacie Twitcha. */
  isAction?: boolean
  paid?: PaidInfo
  isDemo?: boolean
  /**
   * Jeśli obecne - to nie zwykła wiadomość czatu, tylko zdarzenie streamowe (sub, raid, nagroda
   * Channel Points...), renderowane jako wiadomość systemowa. `author` to osoba wywołująca zdarzenie,
   * a `fragments` to opcjonalna wiadomość dołączona przez użytkownika (może być pusta).
   */
  event?: StreamEvent
}

export type StreamEventKind =
  | 'redemption'
  | 'sub'
  | 'resub'
  | 'gift_sub'
  | 'community_gift'
  | 'gift_upgrade'
  | 'raid_in'
  | 'raid_out'
  | 'cheer'
  | 'follow'
  | 'watch_streak'
  | 'announcement'
  | 'hype_train_begin'
  | 'hype_train_end'
  /** YouTube */
  | 'superchat'
  | 'supersticker'
  | 'membership'
  | 'member_milestone'
  | 'membership_gift'
  /** Kick (publiczne zdarzenia czatu) */
  | 'host'
  /** TikTok */
  | 'tiktok_gift'

/**
 * Skąd pochodzi zdarzenie: autoryzowany EventSub (tylko własny kanał), publiczny IRC Twitcha albo
 * publiczny strumień czatu innej platformy (Kick Pusher, YouTube Live Chat, TikTok LIVE).
 */
export type StreamEventSource = 'eventsub' | 'irc' | 'platform'

export interface StreamEvent {
  kind: StreamEventKind
  source: StreamEventSource
  /** Channel Points - nazwa nagrody (dla automatycznych nagród: polska nazwa typu). */
  rewardTitle?: string
  rewardCost?: number
  /** Mała ikona nagrody (Helix Get Custom Reward), zwalidowana do CDN Twitcha. */
  rewardImageUrl?: string
  /** Kwota (Bits nie - `bits`), np. Super Chat "12,00 zł". */
  amountFormatted?: string
  /** Nazwa prezentu TikTok / naklejki Super Sticker. */
  itemName?: string
  /** Liczba sztuk (combo prezentu TikTok). */
  count?: number
  /** Suby: '1000' | '2000' | '3000' | 'prime' */
  tier?: string
  /** Łączna liczba miesięcy subskrypcji (resub). */
  months?: number
  /** Liczba podarowanych subów (community gift). */
  giftCount?: number
  /** Odbiorca pojedynczego gift suba (jeśli znany). */
  recipient?: string
  /** Raid: liczba widzów, kanał docelowy (raid wychodzący). */
  viewers?: number
  targetName?: string
  bits?: number
  anonymous?: boolean
  /** Hype Train */
  level?: number
}

/** Zdarzenie dołączenia/opuszczenia czatu (obecnie: wyłącznie Twitch IRC membership, patrz twitch/irc-client.ts). */
export interface ActivityEvent {
  id: string
  platform: Platform
  type: 'join' | 'part'
  username: string
  userId?: string
  timestampMs: number
}

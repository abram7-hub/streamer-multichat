export type Platform = 'twitch' | 'kick' | 'youtube' | 'tiktok'

export const PLATFORMS: readonly Platform[] = ['twitch', 'kick', 'youtube', 'tiktok']

export const PLATFORM_LABELS: Record<Platform, string> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
  tiktok: 'TikTok'
}

/** Kolory marek platform, używane jako akcent przy wiadomości. */
export const PLATFORM_COLORS: Record<Platform, string> = {
  twitch: '#9146FF',
  kick: '#53FC18',
  youtube: '#FF0000',
  tiktok: '#25F4EE'
}

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'stream_offline'
  | 'auth_required'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export interface AdapterStatus {
  platform: Platform
  state: ConnectionState
  message?: string
  channel?: string
  /**
   * Problem z funkcją dodatkową przy działającym czacie (np. Twitch: token wygasł i zdarzenia
   * Channel Points/EventSub są wyłączone) - renderer pokazuje go jako wyraźny pasek ostrzeżenia.
   */
  warning?: string
  updatedAt: number
}

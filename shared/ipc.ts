import type { ActivityEvent, ChatMessage } from './chat-message'
import type { AdapterStatus, ConnectionState, Platform } from './platform'
import type { AppSettings } from './settings'
import type { GamingMode, GamingOverlayState } from './gaming'

/** Sekrety wpisywane przez użytkownika w ustawieniach (zapisywane zaszyfrowane, nigdy nie wracają do renderera). */
export type UserSecretKey =
  | 'twitch.clientSecret'
  | 'kick.clientSecret'
  | 'youtube.clientSecret'
  | 'youtube.apiKey'
  | 'tiktok.eulerApiKey'

/** Kanały wywoływane z renderera do main (invoke/handle). */
export interface IpcInvokeMap {
  'settings:get': () => AppSettings
  'settings:update': (patch: Partial<AppSettings>) => AppSettings
  'platform:test-connection': (platform: Platform) => { ok: boolean; message: string }
  'platform:connect': (platform: Platform) => void
  'platform:disconnect': (platform: Platform) => void
  'oauth:start': (platform: Platform) => { ok: boolean; message?: string }
  'oauth:logout': (platform: Platform) => void
  'kick:tunnel-start': () => { ok: boolean; url?: string; message?: string }
  'kick:tunnel-stop': () => void
  'kick:tunnel-status': () => { running: boolean; url?: string }
  'app:get-version': () => string
  'demo:set-enabled': (enabled: boolean) => AppSettings
  'secrets:set': (input: { key: UserSecretKey; value: string }) => { ok: boolean; message?: string }
  'secrets:has': (key: UserSecretKey) => boolean
  /** Ostatni znany status każdej platformy - statusy wysłane, zanim renderer się załadował, nie giną. */
  'status:get-all': () => AdapterStatus[]
  'gaming:get-state': () => GamingOverlayState
  'gaming:set-mode': (mode: GamingMode) => GamingOverlayState
  'gaming:resize-by': (delta: { dx: number; dy: number }) => void
  'gaming:reset-position': () => void
  'gaming:show': () => void
  /** Eksport/import wyłącznie ustawień wizualnych (shared/visual-export.ts) przez systemowe okno pliku. */
  'visual:export': () => { ok: boolean; canceled?: boolean; message?: string }
  'visual:import': () => { ok: boolean; canceled?: boolean; message?: string; settings?: AppSettings }
}

/** Kanały nadawane z main do renderera (send/on), bez odpowiedzi. */
export interface IpcEventMap {
  'chat:message': ChatMessage
  'chat:clear': { platform?: Platform }
  'status:update': AdapterStatus
  'activity:event': ActivityEvent
  'watched-channel:status': { id: string; state: ConnectionState; message?: string }
  'kick:tunnel-status-changed': { running: boolean; url?: string }
  /** Stan okna Gaming Overlay (tryb edycji, skrót). */
  'gaming:state': GamingOverlayState
  /** Pełne ustawienia po zmianie - dla okien bez własnego store'u (Gaming Overlay). */
  'settings:changed': AppSettings
  'oauth:device-code': {
    platform: Platform
    userCode: string
    verificationUri: string
    verificationUriComplete?: string
    expiresInSec: number
  }
}

export type IpcInvokeChannel = keyof IpcInvokeMap
export type IpcEventChannel = keyof IpcEventMap

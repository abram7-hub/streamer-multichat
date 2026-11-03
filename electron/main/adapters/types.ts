import type { ChatMessage } from '../../../shared/chat-message'
import type { AdapterStatus, ConnectionState, Platform } from '../../../shared/platform'

export interface AdapterCallbacks {
  onMessage(message: ChatMessage): void
  onStatus(state: ConnectionState, message?: string, channel?: string, warning?: string): void
}

export interface PlatformAdapter {
  readonly platform: Platform
  start(): Promise<void>
  stop(): Promise<void>
  /** Szybki test konfiguracji/połączenia używany przez kreator konfiguracji. */
  testConnection(): Promise<{ ok: boolean; message: string }>
}

export function makeStatus(
  platform: Platform,
  state: ConnectionState,
  message?: string,
  channel?: string,
  warning?: string
): AdapterStatus {
  return { platform, state, message, channel, warning, updatedAt: Date.now() }
}

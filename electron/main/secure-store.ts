import Store from 'electron-store'
import { safeStorage } from 'electron'
import type { UserSecretKey } from '../../shared/ipc'

/**
 * Sekrety (tokeny OAuth, refresh tokeny) trzymane są w oddzielnym pliku,
 * zaszyfrowane przez Electron `safeStorage` (na Windows: DPAPI powiązane
 * z kontem użytkownika). Nigdy nie zapisujemy jawnego tekstu na dysk.
 */
const secretsStore = new Store<Record<string, string>>({ name: 'secrets' })

export function isSecureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveSecret(key: string, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Bezpieczne szyfrowanie danych uwierzytelniających (Windows DPAPI) jest niedostępne w tym systemie.'
    )
  }
  const encrypted = safeStorage.encryptString(value)
  secretsStore.set(key, encrypted.toString('base64'))
}

export function loadSecret(key: string): string | undefined {
  const stored = secretsStore.get(key)
  if (!stored) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return undefined
  }
}

export function deleteSecret(key: string): void {
  secretsStore.delete(key)
}

export const SecretKeys = {
  twitchAccessToken: 'twitch.accessToken',
  twitchRefreshToken: 'twitch.refreshToken',
  twitchClientSecret: 'twitch.clientSecret',
  kickClientSecret: 'kick.clientSecret',
  kickAccessToken: 'kick.accessToken',
  kickRefreshToken: 'kick.refreshToken',
  youtubeClientSecret: 'youtube.clientSecret',
  youtubeAccessToken: 'youtube.accessToken',
  youtubeRefreshToken: 'youtube.refreshToken',
  youtubeApiKey: 'youtube.apiKey',
  tiktokEulerApiKey: 'tiktok.eulerApiKey'
} as const

export type UserEnterableSecretKey = UserSecretKey

export const USER_ENTERABLE_SECRET_KEYS: readonly UserEnterableSecretKey[] = [
  SecretKeys.twitchClientSecret,
  SecretKeys.kickClientSecret,
  SecretKeys.youtubeClientSecret,
  SecretKeys.youtubeApiKey,
  SecretKeys.tiktokEulerApiKey
]

import { loadSecret, saveSecret, deleteSecret, SecretKeys } from '../../secure-store'
import { runLoopbackOAuth } from '../common/loopback-oauth'

const AUTHORIZE_URL = 'https://id.kick.com/oauth/authorize'
const TOKEN_URL = 'https://id.kick.com/oauth/token'

export const KICK_SCOPES = ['user:read', 'channel:read', 'events:subscribe']

export class KickAuthError extends Error {}

export async function loginToKick(
  clientId: string,
  clientSecret: string,
  callbackPort: number
): Promise<{ accessToken: string; refreshToken?: string }> {
  const result = await runLoopbackOAuth({
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    scopes: KICK_SCOPES,
    fixedPort: callbackPort
  })
  saveSecret(SecretKeys.kickAccessToken, result.accessToken)
  if (result.refreshToken) saveSecret(SecretKeys.kickRefreshToken, result.refreshToken)
  return { accessToken: result.accessToken, refreshToken: result.refreshToken }
}

export async function refreshKickToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  })
  if (!res.ok) throw new KickAuthError(`Odświeżenie tokenu Kick nie powiodło się (HTTP ${res.status}).`)
  const data = (await res.json()) as { access_token: string; refresh_token?: string }
  saveSecret(SecretKeys.kickAccessToken, data.access_token)
  if (data.refresh_token) saveSecret(SecretKeys.kickRefreshToken, data.refresh_token)
  return data.access_token
}

export function getStoredKickTokens(): { accessToken?: string; refreshToken?: string; clientSecret?: string } {
  return {
    accessToken: loadSecret(SecretKeys.kickAccessToken),
    refreshToken: loadSecret(SecretKeys.kickRefreshToken),
    clientSecret: loadSecret(SecretKeys.kickClientSecret)
  }
}

export function logoutKick(): void {
  deleteSecret(SecretKeys.kickAccessToken)
  deleteSecret(SecretKeys.kickRefreshToken)
}

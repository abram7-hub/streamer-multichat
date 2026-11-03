import { OAuth2Client } from 'google-auth-library'
import { loadSecret, saveSecret, deleteSecret, SecretKeys } from '../../secure-store'
import { runLoopbackOAuth } from '../common/loopback-oauth'

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.readonly']

export async function loginToYouTube(clientId: string, clientSecret: string): Promise<OAuth2Client> {
  const result = await runLoopbackOAuth({
    authorizeUrl: AUTHORIZE_URL,
    tokenUrl: TOKEN_URL,
    clientId,
    clientSecret,
    scopes: YOUTUBE_SCOPES,
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  })
  if (!result.refreshToken) {
    throw new Error(
      'Google nie zwrócił refresh tokenu. Jeśli logowałeś się wcześniej tym kontem, cofnij dostęp aplikacji ' +
        'na myaccount.google.com/permissions i zaloguj się ponownie.'
    )
  }
  saveSecret(SecretKeys.youtubeAccessToken, result.accessToken)
  saveSecret(SecretKeys.youtubeRefreshToken, result.refreshToken)
  return buildClient(clientId, clientSecret, result.accessToken, result.refreshToken)
}

export function buildClient(
  clientId: string,
  clientSecret: string,
  accessToken?: string,
  refreshToken?: string
): OAuth2Client {
  const client = new OAuth2Client({ clientId, clientSecret })
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
  client.on('tokens', (tokens) => {
    if (tokens.access_token) saveSecret(SecretKeys.youtubeAccessToken, tokens.access_token)
    if (tokens.refresh_token) saveSecret(SecretKeys.youtubeRefreshToken, tokens.refresh_token)
  })
  return client
}

export function getStoredYouTubeClient(clientId: string, clientSecret: string): OAuth2Client | undefined {
  const accessToken = loadSecret(SecretKeys.youtubeAccessToken)
  const refreshToken = loadSecret(SecretKeys.youtubeRefreshToken)
  if (!refreshToken) return undefined
  return buildClient(clientId, clientSecret, accessToken, refreshToken)
}

export function logoutYouTube(): void {
  deleteSecret(SecretKeys.youtubeAccessToken)
  deleteSecret(SecretKeys.youtubeRefreshToken)
}

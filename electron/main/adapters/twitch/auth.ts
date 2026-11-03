import { shell } from 'electron'
import { isSafeExternalUrl } from '../../../../shared/external-url'
import { loadSecret, saveSecret, deleteSecret, SecretKeys } from '../../secure-store'

const DEVICE_CODE_URL = 'https://id.twitch.tv/oauth2/device'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate'
const REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke'

/**
 * Scope'y OAuth. Czat Twitcha czytany jest anonimowo przez IRC (bez scope'ów); logowanie służy do
 * odznak (wystarczy sam token) oraz do zdarzeń EventSub WŁASNEGO kanału:
 *  - channel:read:redemptions   -> Channel Points (channel.channel_points_custom_reward_redemption.add)
 *  - channel:read:subscriptions -> suby, resuby, gifty (channel.subscribe / .subscription.message / .subscription.gift)
 *  - bits:read                  -> cheery (channel.cheer)
 *  - moderator:read:followers   -> followy (channel.follow v2)
 *  - channel:read:hype_train    -> Hype Train (channel.hype_train.begin/end v2)
 * Raidy (channel.raid) nie wymagają żadnego scope'u.
 */
export const TWITCH_SCOPES = [
  'channel:read:redemptions',
  'channel:read:subscriptions',
  'bits:read',
  'moderator:read:followers',
  'channel:read:hype_train'
]

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string[]
  token_type: string
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresInSec: number
}

/** Przyczyna nieudanego odświeżenia tokenu - pozwala pokazać użytkownikowi konkretną instrukcję. */
export type TwitchRefreshFailure = 'missing_client_secret' | 'invalid_refresh_token' | 'network'

export class TwitchAuthError extends Error {
  constructor(
    message: string,
    readonly reason?: TwitchRefreshFailure
  ) {
    super(message)
  }
}

/**
 * Client Secret jest potrzebny WYŁĄCZNIE, gdy aplikacja w Twitch Developer Console ma typ
 * "Confidential" - wtedy Twitch odrzuca odświeżenie tokenu bez niego ("missing client secret"),
 * a token z Device Code Flow wygasa po ~4 h. Aplikacje typu "Public" go nie mają i nie potrzebują.
 */
function clientSecretParams(): Record<string, string> {
  const secret = loadSecret(SecretKeys.twitchClientSecret)
  return secret ? { client_secret: secret } : {}
}

/**
 * Uruchamia OAuth Device Code Grant Flow (bez client secret, z refresh tokenem).
 * Otwiera systemową przeglądarkę na verification_uri i odpytuje endpoint tokenu
 * aż użytkownik zatwierdzi kod (lub czas wygaśnie).
 */
export async function startTwitchDeviceAuth(
  clientId: string,
  onPrompt: (prompt: DeviceCodePrompt) => void,
  signal: AbortSignal
): Promise<{ accessToken: string; refreshToken: string }> {
  const deviceRes = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPES.join(' ') })
  })
  if (!deviceRes.ok) {
    throw new TwitchAuthError(`Nie udało się rozpocząć logowania Twitch (HTTP ${deviceRes.status}).`)
  }
  const device = (await deviceRes.json()) as DeviceCodeResponse

  onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresInSec: device.expires_in
  })
  // Adres pochodzi z odpowiedzi sieciowej - kod i tak jest widoczny w oknie aplikacji.
  if (isSafeExternalUrl(device.verification_uri)) void shell.openExternal(device.verification_uri)

  const deadline = Date.now() + device.expires_in * 1000
  let intervalSec = Math.max(device.interval, 5)

  while (Date.now() < deadline) {
    if (signal.aborted) throw new TwitchAuthError('Logowanie Twitch zostało anulowane.')
    await sleep(intervalSec * 1000, signal)

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        ...clientSecretParams(),
        device_code: device.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    })

    if (tokenRes.ok) {
      const token = (await tokenRes.json()) as TokenResponse
      saveSecret(SecretKeys.twitchAccessToken, token.access_token)
      saveSecret(SecretKeys.twitchRefreshToken, token.refresh_token)
      return { accessToken: token.access_token, refreshToken: token.refresh_token }
    }

    const body = (await tokenRes.json().catch(() => ({}))) as { message?: string }
    const reason = body.message ?? ''
    if (reason.includes('authorization_pending')) continue
    if (reason.includes('slow_down')) {
      intervalSec += 5
      continue
    }
    throw new TwitchAuthError(`Logowanie Twitch nie powiodło się: ${reason || tokenRes.status}`)
  }

  throw new TwitchAuthError('Czas na zatwierdzenie logowania Twitch upłynął. Spróbuj ponownie.')
}

/** Czysta funkcja: rozpoznaje przyczynę odrzucenia odświeżenia tokenu z treści odpowiedzi Twitcha. */
export function classifyRefreshFailure(status: number, message: string): TwitchRefreshFailure {
  if (/client secret/i.test(message)) return 'missing_client_secret'
  if (status === 400 || status === 401) return 'invalid_refresh_token'
  return 'network'
}

export async function refreshTwitchToken(clientId: string, refreshToken: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        ...clientSecretParams(),
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new TwitchAuthError('Brak połączenia z id.twitch.tv przy odświeżaniu tokenu.', 'network')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string }
    const reason = classifyRefreshFailure(res.status, body.message ?? '')
    throw new TwitchAuthError(`Odświeżenie tokenu Twitch nie powiodło się (HTTP ${res.status}: ${body.message ?? '?'}).`, reason)
  }
  const token = (await res.json()) as TokenResponse
  saveSecret(SecretKeys.twitchAccessToken, token.access_token)
  saveSecret(SecretKeys.twitchRefreshToken, token.refresh_token)
  return token.access_token
}

export interface TokenValidation {
  valid: boolean
  login?: string
  userId?: string
  scopes?: string[]
}

export async function validateTwitchToken(accessToken: string): Promise<TokenValidation> {
  const res = await fetch(VALIDATE_URL, {
    headers: { Authorization: `OAuth ${accessToken}` },
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined)
  if (!res?.ok) return { valid: false }
  const data = (await res.json()) as { login: string; user_id: string; scopes?: string[] }
  return { valid: true, login: data.login, userId: data.user_id, scopes: Array.isArray(data.scopes) ? data.scopes : [] }
}

export type TwitchAuthState =
  | { status: 'ok'; token: string; validation: TokenValidation }
  | { status: 'logged_out' }
  | { status: 'refresh_failed'; reason: TwitchRefreshFailure; message: string }

/**
 * Stan logowania: ważny token (walidując zapisany, a w razie potrzeby odświeżając go refresh
 * tokenem) wraz z wynikiem walidacji (login, ID, przyznane scope'y), albo KONKRETNY powód, dla
 * którego go nie ma - wcześniej nieudane odświeżenie było cicho traktowane jak "nie zalogowano",
 * przez co Channel Points i inne zdarzenia EventSub znikały bez żadnej informacji.
 */
export async function getTwitchAuthState(clientId: string): Promise<TwitchAuthState> {
  const { accessToken, refreshToken } = getStoredTwitchTokens()
  if (accessToken) {
    const validation = await validateTwitchToken(accessToken)
    if (validation.valid) return { status: 'ok', token: accessToken, validation }
  }
  if (!refreshToken || !clientId) return { status: 'logged_out' }
  try {
    const refreshed = await refreshTwitchToken(clientId, refreshToken)
    const validation = await validateTwitchToken(refreshed)
    return validation.valid
      ? { status: 'ok', token: refreshed, validation }
      : { status: 'refresh_failed', reason: 'invalid_refresh_token', message: 'Odświeżony token jest nieważny.' }
  } catch (err) {
    const reason = err instanceof TwitchAuthError && err.reason ? err.reason : 'network'
    return { status: 'refresh_failed', reason, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function getValidTwitchToken(clientId: string): Promise<{ token: string; validation: TokenValidation } | undefined> {
  const state = await getTwitchAuthState(clientId)
  return state.status === 'ok' ? { token: state.token, validation: state.validation } : undefined
}

export function getStoredTwitchTokens(): { accessToken?: string; refreshToken?: string } {
  return {
    accessToken: loadSecret(SecretKeys.twitchAccessToken),
    refreshToken: loadSecret(SecretKeys.twitchRefreshToken)
  }
}

export async function revokeTwitchAuth(clientId: string): Promise<void> {
  const accessToken = loadSecret(SecretKeys.twitchAccessToken)
  if (accessToken) {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, token: accessToken })
    }).catch(() => undefined)
  }
  deleteSecret(SecretKeys.twitchAccessToken)
  deleteSecret(SecretKeys.twitchRefreshToken)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new TwitchAuthError('Anulowano.'))
    })
  })
}

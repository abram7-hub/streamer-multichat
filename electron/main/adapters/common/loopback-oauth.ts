import { createServer } from 'node:http'
import { shell } from 'electron'
import { isSafeExternalUrl } from '../../../../shared/external-url'
import { generatePkce, generateState } from './pkce'

export interface LoopbackOAuthConfig {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scopes: string[]
  extraAuthParams?: Record<string, string>
  /** Stały port pętli zwrotnej (wymagany, gdy dostawca żąda dokładnego dopasowania redirect URI, np. Kick). 0 = port efemeryczny. */
  fixedPort?: number
}

export interface LoopbackOAuthResult {
  accessToken: string
  refreshToken?: string
  expiresInSec?: number
  raw: Record<string, unknown>
}

/**
 * Generyczny Authorization Code + PKCE flow z lokalnym serwerem pętli zwrotnej
 * (http://127.0.0.1:<port>/callback) i systemową przeglądarką. Używane przez
 * Kick i YouTube - obie platformy wymagają zarejestrowanego redirect URI.
 */
export async function runLoopbackOAuth(config: LoopbackOAuthConfig): Promise<LoopbackOAuthResult> {
  const { verifier, challenge } = generatePkce()
  const state = generateState()

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const returnedState = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (error || !code || returnedState !== state) {
        res.end('<html><body><h2>Logowanie nie powiodło się. Możesz zamknąć tę kartę.</h2></body></html>')
        server.close()
        reject(new Error(error ?? 'Nieprawidłowa odpowiedź OAuth (state mismatch).'))
        return
      }
      res.end('<html><body><h2>Zalogowano pomyślnie. Możesz zamknąć tę kartę i wrócić do aplikacji.</h2></body></html>')
      const port = (server.address() as { port: number }).port
      server.close()
      resolve({ code, redirectUri: `http://127.0.0.1:${port}/callback` })
    })

    server.listen(config.fixedPort ?? 0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      const redirectUri = `http://127.0.0.1:${port}/callback`
      const authUrl = new URL(config.authorizeUrl)
      authUrl.searchParams.set('client_id', config.clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', config.scopes.join(' '))
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', challenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) authUrl.searchParams.set(k, v)
      if (!isSafeExternalUrl(authUrl.toString())) {
        server.close()
        reject(new Error('Adres strony logowania OAuth musi używać https.'))
        return
      }
      void shell.openExternal(authUrl.toString())
    })

    server.on('error', reject)

    setTimeout(() => {
      server.close()
      reject(new Error('Upłynął czas oczekiwania na logowanie (5 minut).'))
    }, 5 * 60 * 1000)
  })

  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier
  })
  if (config.clientSecret) body.set('client_secret', config.clientSecret)

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!tokenRes.ok) {
    throw new Error(`Wymiana kodu na token nie powiodła się (HTTP ${tokenRes.status}): ${await tokenRes.text()}`)
  }
  const raw = (await tokenRes.json()) as Record<string, unknown>
  return {
    accessToken: raw.access_token as string,
    refreshToken: raw.refresh_token as string | undefined,
    expiresInSec: raw.expires_in as number | undefined,
    raw
  }
}

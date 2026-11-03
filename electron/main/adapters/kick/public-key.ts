import { createVerify } from 'node:crypto'

const PUBLIC_KEY_URL = 'https://api.kick.com/public/v1/public-key'

let cachedKey: string | undefined
let cachedAt = 0
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

async function getPublicKey(): Promise<string> {
  if (cachedKey && Date.now() - cachedAt < CACHE_TTL_MS) return cachedKey
  const res = await fetch(PUBLIC_KEY_URL)
  if (!res.ok) throw new Error(`Nie udało się pobrać klucza publicznego Kick (HTTP ${res.status}).`)
  const data = (await res.json()) as { data: { public_key: string } }
  cachedKey = data.data.public_key
  cachedAt = Date.now()
  return cachedKey
}

/**
 * Weryfikuje podpis webhooka Kicka: RSA-SHA256 (PKCS1v15) nad
 * `messageId.timestamp.rawBody`, zakodowany Base64 w nagłówku Kick-Event-Signature.
 */
export async function verifyKickSignature(
  messageId: string,
  timestamp: string,
  rawBody: Buffer,
  signatureBase64: string
): Promise<boolean> {
  const publicKey = await getPublicKey()
  const signedPayload = `${messageId}.${timestamp}.${rawBody.toString('utf8')}`
  const verifier = createVerify('RSA-SHA256')
  verifier.update(signedPayload)
  verifier.end()
  try {
    return verifier.verify(publicKey, Buffer.from(signatureBase64, 'base64'))
  } catch {
    return false
  }
}

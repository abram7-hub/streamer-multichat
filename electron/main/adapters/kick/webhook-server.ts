import { createServer, type Server } from 'node:http'
import express from 'express'
import { verifyKickSignature } from './public-key'
import { normalizeKickMessage, type KickChatMessageEvent } from './normalize'
import type { ChatMessage } from '../../../../shared/chat-message'

/**
 * Serwer wyłącznie dla webhooka Kicka. Nasłuchuje na 127.0.0.1 i jest
 * jedynym lokalnym portem tunelowanym publicznie (przez Cloudflare Tunnel).
 * Nie obsługuje żadnych innych endpointów administracyjnych.
 */
export class KickWebhookServer {
  private httpServer: Server | undefined

  async start(port: number, channelSlug: string, onMessage: (message: ChatMessage) => void): Promise<void> {
    await this.stop()
    const app = express()

    app.post(
      '/kick/webhook',
      express.raw({ type: '*/*', limit: '1mb' }),
      async (req, res) => {
        const messageId = req.header('Kick-Event-Message-Id')
        const timestamp = req.header('Kick-Event-Message-Timestamp')
        const signature = req.header('Kick-Event-Signature')
        const eventType = req.header('Kick-Event-Type')
        const rawBody = req.body as Buffer

        if (!messageId || !timestamp || !signature) {
          res.status(400).end('Brak wymaganych nagłówków podpisu.')
          return
        }

        const valid = await verifyKickSignature(messageId, timestamp, rawBody, signature).catch(() => false)
        if (!valid) {
          res.status(401).end('Nieprawidłowy podpis webhooka.')
          return
        }

        res.status(200).end('OK')

        if (eventType === 'chat.message.sent') {
          try {
            const event = JSON.parse(rawBody.toString('utf8')) as KickChatMessageEvent
            onMessage(normalizeKickMessage(event, channelSlug))
          } catch {
            // Ignorujemy pojedyncze uszkodzone zdarzenie - nie przerywa to strumienia webhooków.
          }
        }
      }
    )

    this.httpServer = createServer(app)
    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once('error', reject)
      this.httpServer?.listen(port, '127.0.0.1', () => resolve())
    })
  }

  async stop(): Promise<void> {
    if (this.httpServer) await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()))
    this.httpServer = undefined
  }
}

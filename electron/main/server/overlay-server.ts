import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { WebSocketServer } from 'ws'
import type { ChatMessage } from '../../../shared/chat-message'
import type { OverlayView } from '../../../shared/settings'

/**
 * Serwer nakładki OBS. Nasłuchuje WYŁĄCZNIE na 127.0.0.1 - nie jest tunelowany
 * ani w żaden sposób wystawiony do internetu. Serwuje statyczny build
 * overlay.html oraz przesyła nowe wiadomości przez WebSocket bez odświeżania strony.
 */
export class OverlayServer {
  private httpServer: Server | undefined
  private wss: WebSocketServer | undefined
  private currentPort: number | undefined

  async start(
    port: number,
    staticDir: string,
    getView: () => OverlayView,
    devServerUrl?: string
  ): Promise<void> {
    if (this.httpServer && this.currentPort === port) return
    await this.stop()

    const app = express()
    app.get('/overlay/settings', (_req, res) => res.json(getView()))

    if (existsSync(join(staticDir, 'overlay.html'))) {
      // index:false - inaczej express.static automatycznie serwuje index.html (główną aplikację,
      // zależną od mostka preload) pod "/", zanim poniższy redirect zdąży zadziałać.
      app.use(express.static(staticDir, { index: false }))
      app.get('/', (_req, res) => res.redirect('/overlay.html'))
    } else if (devServerUrl) {
      // Tryb deweloperski: build renderera nie istnieje na dysku - przekierowujemy
      // do serwera Vite. Po `npm run build` nakładka działa w pełni offline.
      app.get('/', (_req, res) => res.redirect(`${devServerUrl}/overlay.html`))
    } else {
      app.get('/', (_req, res) =>
        res.status(503).send('Build renderera nie istnieje. Uruchom "npm run build" lub tryb deweloperski.')
      )
    }

    const httpServer = createServer(app)
    const wss = new WebSocketServer({ server: httpServer, path: '/overlay/ws' })

    this.httpServer = httpServer
    this.wss = wss
    this.currentPort = port

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, '127.0.0.1', () => resolve())
    })
  }

  broadcast(message: ChatMessage): void {
    const payload = JSON.stringify({ type: 'message', message })
    this.wss?.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload)
    })
  }

  broadcastSettings(view: OverlayView): void {
    const payload = JSON.stringify({ type: 'settings', view })
    this.wss?.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(payload)
    })
  }

  async stop(): Promise<void> {
    this.wss?.clients.forEach((c) => c.terminate())
    this.wss?.close()
    this.wss = undefined
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()))
    }
    this.httpServer = undefined
    this.currentPort = undefined
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

export class CloudflareTunnel {
  private proc: ChildProcessWithoutNullStreams | undefined
  private url: string | undefined

  isRunning(): boolean {
    return this.proc !== undefined
  }

  getUrl(): string | undefined {
    return this.url
  }

  /**
   * Uruchamia szybki tunel Cloudflare (`cloudflared tunnel --url ...`), wskazujący
   * na lokalny port, na którym nasłuchuje WYŁĄCZNIE endpoint webhooka Kicka.
   * Wymaga zainstalowanego `cloudflared` w PATH (winget install Cloudflare.cloudflared
   * lub pobranie z github.com/cloudflare/cloudflared/releases).
   */
  async start(localPort: number): Promise<{ ok: boolean; url?: string; message: string }> {
    if (this.proc) {
      return { ok: true, url: this.url, message: 'Tunel już działa.' }
    }

    return new Promise((resolve) => {
      let settled = false
      let proc: ChildProcessWithoutNullStreams
      try {
        proc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${localPort}`], {
          windowsHide: true
        })
      } catch (err) {
        resolve({ ok: false, message: describeSpawnError(err) })
        return
      }

      this.proc = proc

      const onData = (chunk: Buffer): void => {
        const text = chunk.toString()
        const match = URL_REGEX.exec(text)
        if (match && !settled) {
          settled = true
          this.url = match[0]
          resolve({ ok: true, url: this.url, message: 'Tunel Cloudflare uruchomiony.' })
        }
      }
      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)

      proc.on('error', (err) => {
        this.proc = undefined
        if (!settled) {
          settled = true
          resolve({ ok: false, message: describeSpawnError(err) })
        }
      })

      proc.on('exit', (code) => {
        this.proc = undefined
        this.url = undefined
        if (!settled) {
          settled = true
          resolve({ ok: false, message: `Proces cloudflared zakończył się kodem ${code}.` })
        }
      })

      setTimeout(() => {
        if (!settled) {
          settled = true
          resolve({
            ok: false,
            message: 'Cloudflared nie zwrócił publicznego adresu w ciągu 20 sekund. Sprawdź połączenie internetowe.'
          })
        }
      }, 20_000)
    })
  }

  stop(): void {
    this.proc?.kill()
    this.proc = undefined
    this.url = undefined
  }
}

function describeSpawnError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOENT') {
    return (
      'Nie znaleziono programu "cloudflared". Zainstaluj go poleceniem ' +
      '"winget install --id Cloudflare.cloudflared" (wymaga ponownego uruchomienia aplikacji) ' +
      'lub pobierz z github.com/cloudflare/cloudflared/releases i dodaj do PATH.'
    )
  }
  return err instanceof Error ? err.message : String(err)
}

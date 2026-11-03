import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdapterCallbacks } from '../types'
import type { YouTubeSettings } from '../../../../shared/settings'

const secrets: Record<string, string | undefined> = {}
vi.mock('../../secure-store', () => ({
  loadSecret: (key: string) => secrets[key],
  SecretKeys: { youtubeApiKey: 'youtube.apiKey', youtubeClientSecret: 'youtube.clientSecret' }
}))
vi.mock('./auth', () => ({ getStoredYouTubeClient: () => undefined, loginToYouTube: vi.fn(), logoutYouTube: vi.fn() }))

const { YouTubeAdapter } = await import('./index')
const { JsonArrayStreamParser } = await import('./api')

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Odpowiedź strumieniowa: kolejne fragmenty tablicy JSON (jak `liveChat/messages/stream`). */
function streamed(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c))
        controller.close()
      }
    }),
    { status: 200 }
  )
}

function makeCallbacks() {
  const statuses: { state: string; message?: string }[] = []
  const callbacks: AdapterCallbacks = {
    onMessage: vi.fn(),
    onStatus: vi.fn((state, message) => statuses.push({ state, message }))
  }
  return { callbacks, statuses }
}

const settingsFor = (channelHandle: string): YouTubeSettings => ({ enabled: true, channelHandle, clientId: '' })

function installFetch(routes: Record<string, Route>): { calls: URL[]; headers: Headers[] } {
  const calls: URL[] = []
  const headers: Headers[] = []
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url)
    headers.push(new Headers(init?.headers))
    const key = Object.keys(routes).find((k) => url.pathname.endsWith(k))
    if (!key) return json({ error: { code: 404, message: 'no route' } }, 404)
    return routes[key]!(url, init)
  })
  return { calls, headers }
}

const liveMessage = (id: string, text: string) => ({
  id,
  snippet: { type: 'textMessageEvent', publishedAt: new Date().toISOString(), textMessageDetails: { messageText: text } },
  authorDetails: { channelId: 'UCa', displayName: 'Widz' }
})

describe('JsonArrayStreamParser', () => {
  it('extracts objects from a JSON array split at arbitrary points, including braces inside strings', () => {
    const parser = new JsonArrayStreamParser()
    const full = '[{"a":1,"t":"x}{y"},\r\n{"b":{"c":"\\"}"}}'
    const out: unknown[] = []
    for (let i = 0; i < full.length; i += 3) out.push(...parser.push(full.slice(i, i + 3)))
    out.push(...parser.push(']'))
    expect(out).toEqual([{ a: 1, t: 'x}{y' }, { b: { c: '"}' } }])
  })
})

describe('YouTubeAdapter (public live chat via API key)', () => {
  let adapter: InstanceType<typeof YouTubeAdapter> | undefined

  beforeEach(() => {
    secrets['youtube.apiKey'] = 'test-key'
  })
  afterEach(async () => {
    await adapter?.stop()
    adapter = undefined
    vi.unstubAllGlobals()
    for (const k of Object.keys(secrets)) delete secrets[k]
  })

  it('@handle → channel → uploads → live video → activeLiveChatId → streamed messages; ended chat → Offline', async () => {
    const { calls, headers } = installFetch({
      '/channels': () => json({ items: [{ id: 'UCchan', contentDetails: { relatedPlaylists: { uploads: 'UUchan' } } }] }),
      '/playlistItems': () => json({ items: [{ contentDetails: { videoId: 'vidLIVE0001' } }, { contentDetails: { videoId: 'vidOLD00001' } }] }),
      '/videos': () =>
        json({
          items: [
            { id: 'vidLIVE0001', snippet: { title: 'Stream', liveBroadcastContent: 'live' }, liveStreamingDetails: { activeLiveChatId: 'CHAT1' } },
            { id: 'vidOLD00001', snippet: { liveBroadcastContent: 'none' }, liveStreamingDetails: { actualEndTime: '2025-01-01T00:00:00Z' } }
          ]
        }),
      '/liveChat/messages/stream': () =>
        streamed([
          `[{"items":[${JSON.stringify(liveMessage('m1', 'hej'))}],"nextPageToken":"p1"}`,
          ',{"error":{"code":403,"message":"ended","errors":[{"reason":"liveChatEnded"}]}}]'
        ])
    })
    const { callbacks, statuses } = makeCallbacks()
    adapter = new YouTubeAdapter(() => settingsFor('https://www.youtube.com/@SomeStreamer'), callbacks)
    await adapter.start()
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('stream_offline'))

    expect(statuses.map((s) => s.state)).toEqual(['connecting', 'connecting', 'connected', 'stream_offline'])
    expect(callbacks.onMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(callbacks.onMessage).mock.calls[0]![0].rawText).toBe('hej')
    const channelsCall = calls.find((u) => u.pathname.endsWith('/channels'))!
    expect(channelsCall.searchParams.get('forHandle')).toBe('@somestreamer')
    const stream = calls.find((u) => u.pathname.endsWith('/stream'))!
    expect(stream.searchParams.get('liveChatId')).toBe('CHAT1')
    // Klucz API w nagłówku (nie w URL-u, więc nie trafia do logów z adresami).
    expect(headers.every((h) => h.get('x-goog-api-key') === 'test-key')).toBe(true)
    expect(calls.every((u) => !u.searchParams.has('key'))).toBe(true)
  })

  it('video URL input skips channel lookup; a finished stream reports Offline instead of an error', async () => {
    const { calls } = installFetch({
      '/videos': () => json({ items: [{ id: 'abcDEF12345', snippet: { liveBroadcastContent: 'none' }, liveStreamingDetails: { actualEndTime: 'x' } }] })
    })
    const { callbacks, statuses } = makeCallbacks()
    adapter = new YouTubeAdapter(() => settingsFor('https://youtu.be/abcDEF12345'), callbacks)
    await adapter.start()
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('stream_offline'))
    expect(statuses.at(-1)?.message).toMatch(/nie jest teraz na żywo/)
    expect(calls.some((u) => u.pathname.endsWith('/channels'))).toBe(false)
  })

  it('falls back to polling (respecting pollingIntervalMillis) when the stream endpoint is unavailable', async () => {
    let polls = 0
    installFetch({
      '/videos': () => json({ items: [{ id: 'abcDEF12345', snippet: { liveBroadcastContent: 'live' }, liveStreamingDetails: { activeLiveChatId: 'C' } }] }),
      '/liveChat/messages/stream': () => json({ error: { code: 501, message: 'not implemented' } }, 501),
      '/liveChat/messages': () => {
        polls++
        return polls === 1
          ? json({ items: [liveMessage('p1', 'z pollingu')], pollingIntervalMillis: 10, nextPageToken: 't' })
          : json({ error: { code: 403, errors: [{ reason: 'liveChatEnded' }] } }, 403)
      }
    })
    const { callbacks, statuses } = makeCallbacks()
    adapter = new YouTubeAdapter(() => settingsFor('abcDEF12345'), callbacks)
    await adapter.start()
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('stream_offline'), { timeout: 5000 })
    expect(vi.mocked(callbacks.onMessage).mock.calls.map((c) => c[0].rawText)).toEqual(['z pollingu'])
  })

  it('quota exhausted → clear error, no hammering', async () => {
    const { calls } = installFetch({
      '/channels': () => json({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, 403)
    })
    const { callbacks, statuses } = makeCallbacks()
    adapter = new YouTubeAdapter(() => settingsFor('@testnickyt'), callbacks)
    await adapter.start()
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('error'))
    expect(statuses.at(-1)?.message).toMatch(/limit/)
    expect(calls).toHaveLength(1)
  })

  it('without API key and without Google login → asks for an API key (public preview) instead of forcing OAuth', async () => {
    delete secrets['youtube.apiKey']
    installFetch({})
    const { callbacks, statuses } = makeCallbacks()
    adapter = new YouTubeAdapter(() => settingsFor('@testnickyt'), callbacks)
    await adapter.start()
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('auth_required'))
    expect(statuses.at(-1)?.message).toMatch(/klucz API/)
  })

  it('stop() aborts an open chat stream (no work in the background after disabling)', async () => {
    let aborted = false
    installFetch({
      '/videos': () => json({ items: [{ id: 'abcDEF12345', snippet: { liveBroadcastContent: 'live' }, liveStreamingDetails: { activeLiveChatId: 'C' } }] }),
      '/liveChat/messages/stream': (_u, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('['))
              init?.signal?.addEventListener('abort', () => {
                aborted = true
                controller.error(new DOMException('aborted', 'AbortError'))
              })
            }
          })
        )
    })
    const { callbacks, statuses } = makeCallbacks()
    adapter = new YouTubeAdapter(() => settingsFor('abcDEF12345'), callbacks)
    await adapter.start()
    await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('connected'))
    await adapter.stop()
    await vi.waitFor(() => expect(aborted).toBe(true))
    expect(statuses.at(-1)?.state).toBe('disconnected')
  })
})

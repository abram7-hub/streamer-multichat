import type { YouTubeTarget } from '../../../../shared/youtube-input'
import type { YouTubeChatItem } from './normalize'

const API_ROOT = 'https://www.googleapis.com/youtube/v3'
const STREAM_URL = 'https://youtube.googleapis.com/youtube/v3/liveChat/messages/stream'

/** Publiczny podgląd: klucz API (bez logowania) albo - jeśli go brak - token OAuth zalogowanego konta. */
export type YouTubeAuth = { kind: 'apiKey'; key: string } | { kind: 'oauth'; token: string }

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** `error.errors[0].reason` z odpowiedzi Google, np. quotaExceeded, liveChatEnded, keyInvalid. */
    readonly reason: string | undefined
  ) {
    super(message)
  }
}

export interface LiveChatResponse {
  items?: YouTubeChatItem[]
  nextPageToken?: string
  pollingIntervalMillis?: number
  offlineAt?: string
}

export interface LiveVideoInfo {
  videoId: string
  title?: string
  /** `liveBroadcastContent`: live | upcoming | none */
  state: string
  activeLiveChatId?: string
  ended: boolean
}

/**
 * Inkrementalny parser odpowiedzi `liveChat/messages/stream`: serwer wysyła tablicę JSON
 * (`[{...},{...}`) kawałek po kawałku, dopóki połączenie jest otwarte. Wycina kolejne obiekty
 * najwyższego poziomu, licząc nawiasy poza łańcuchami znaków - bez buforowania całej odpowiedzi.
 */
export class JsonArrayStreamParser {
  private buffer = ''
  private depth = 0
  private inString = false
  private escaped = false
  private objectStart = -1
  private scanned = 0

  push(chunk: string): unknown[] {
    this.buffer += chunk
    const out: unknown[] = []
    for (let i = this.scanned; i < this.buffer.length; i++) {
      const ch = this.buffer[i]
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (ch === '\\') this.escaped = true
        else if (ch === '"') this.inString = false
        continue
      }
      if (ch === '"') {
        if (this.depth > 0) this.inString = true
      } else if (ch === '{') {
        if (this.depth === 0) this.objectStart = i
        this.depth++
      } else if (ch === '}') {
        this.depth--
        if (this.depth === 0 && this.objectStart >= 0) {
          try {
            out.push(JSON.parse(this.buffer.slice(this.objectStart, i + 1)))
          } catch {
            // uszkodzony fragment - pomijamy, kolejne obiekty nadal są parsowane
          }
          this.objectStart = -1
        }
      }
    }
    // Odrzucamy już przetworzony początek bufora (pamięć nie rośnie przez całą transmisję).
    const keepFrom = this.depth > 0 && this.objectStart >= 0 ? this.objectStart : this.buffer.length
    this.buffer = this.buffer.slice(keepFrom)
    if (this.objectStart >= 0) this.objectStart -= keepFrom
    this.scanned = this.buffer.length
    return out
  }
}

export class YouTubeApi {
  constructor(
    private readonly getAuth: () => Promise<YouTubeAuth | undefined>,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  private async request(url: URL, signal: AbortSignal): Promise<Response> {
    const auth = await this.getAuth()
    if (!auth) throw new YouTubeApiError('Brak klucza API YouTube i brak logowania Google.', 401, 'noCredentials')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (auth.kind === 'apiKey') headers['x-goog-api-key'] = auth.key
    else headers['Authorization'] = `Bearer ${auth.token}`
    return this.fetchImpl(url, { headers, signal })
  }

  private async get<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
    const url = new URL(`${API_ROOT}/${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await this.request(url, AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as T
  }

  /** ID kanału + playlista "uploads" (1 jednostka quota). */
  async resolveChannel(
    target: Exclude<YouTubeTarget, { kind: 'video' }>,
    signal: AbortSignal
  ): Promise<{ channelId: string; uploads?: string; title?: string } | undefined> {
    const params: Record<string, string> = { part: 'id,snippet,contentDetails' }
    if (target.kind === 'channel') params['id'] = target.channelId
    else if (target.kind === 'handle') params['forHandle'] = `@${target.handle}`
    else params['forUsername'] = target.username
    const data = await this.get<{
      items?: { id: string; snippet?: { title?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[]
    }>('channels', params, signal)
    const item = data.items?.[0]
    if (!item) return undefined
    return { channelId: item.id, uploads: item.contentDetails?.relatedPlaylists?.uploads, title: item.snippet?.title }
  }

  /** Najnowsze filmy z playlisty "uploads" (1 jednostka) - trwająca transmisja jest tam na górze. */
  async latestUploads(playlistId: string, signal: AbortSignal): Promise<string[]> {
    const data = await this.get<{ items?: { contentDetails?: { videoId?: string } }[] }>(
      'playlistItems',
      { part: 'contentDetails', maxResults: '10', playlistId },
      signal
    )
    return (data.items ?? []).map((i) => i.contentDetails?.videoId).filter((id): id is string => Boolean(id))
  }

  /** Status LIVE i `activeLiveChatId` filmów (1 jednostka dla do 50 ID). */
  async videos(ids: string[], signal: AbortSignal): Promise<LiveVideoInfo[]> {
    if (ids.length === 0) return []
    const data = await this.get<{
      items?: {
        id: string
        snippet?: { title?: string; liveBroadcastContent?: string }
        liveStreamingDetails?: { activeLiveChatId?: string; actualEndTime?: string }
      }[]
    }>('videos', { part: 'snippet,liveStreamingDetails', id: ids.join(',') }, signal)
    return (data.items ?? []).map((v) => ({
      videoId: v.id,
      title: v.snippet?.title,
      state: v.snippet?.liveBroadcastContent ?? 'none',
      activeLiveChatId: v.liveStreamingDetails?.activeLiveChatId,
      ended: Boolean(v.liveStreamingDetails?.actualEndTime)
    }))
  }

  /** Klasyczny polling (`liveChatMessages.list`) - zapasowo, gdy strumień jest niedostępny. */
  async listMessages(liveChatId: string, pageToken: string | undefined, signal: AbortSignal): Promise<LiveChatResponse> {
    const params: Record<string, string> = { part: 'id,snippet,authorDetails', liveChatId, maxResults: '200' }
    if (pageToken) params['pageToken'] = pageToken
    return this.get<LiveChatResponse>('liveChat/messages', params, signal)
  }

  /**
   * `liveChatMessages.streamList` przez HTTP: serwer trzyma połączenie i dosyła nowe wiadomości od
   * razu (bez odpytywania co kilka sekund). Kończy się, gdy serwer zamknie strumień - wtedy wywołujący
   * łączy się ponownie z ostatnim `nextPageToken`.
   */
  async streamMessages(
    liveChatId: string,
    pageToken: string | undefined,
    signal: AbortSignal,
    onResponse: (response: LiveChatResponse) => void
  ): Promise<void> {
    const url = new URL(STREAM_URL)
    url.searchParams.set('part', 'id,snippet,authorDetails')
    url.searchParams.set('liveChatId', liveChatId)
    url.searchParams.set('maxResults', '200')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await this.request(url, signal)
    if (!res.ok) throw await toApiError(res)
    if (!res.body) throw new YouTubeApiError('Pusta odpowiedź strumienia czatu.', 502, 'emptyStream')
    const parser = new JsonArrayStreamParser()
    const decoder = new TextDecoder()
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const obj of parser.push(decoder.decode(value, { stream: true }))) {
          const maybeError = (obj as { error?: { code?: number; message?: string; errors?: { reason?: string }[] } }).error
          if (maybeError) {
            throw new YouTubeApiError(maybeError.message ?? 'Błąd strumienia czatu', maybeError.code ?? 500, maybeError.errors?.[0]?.reason)
          }
          onResponse(obj as LiveChatResponse)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}

async function toApiError(res: Response): Promise<YouTubeApiError> {
  const text = await res.text().catch(() => '')
  let reason: string | undefined
  let message = `YouTube API: HTTP ${res.status}`
  try {
    const parsed = JSON.parse(text) as
      | { error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }
      | { error?: { message?: string; errors?: { reason?: string }[] } }[]
    const err = Array.isArray(parsed) ? parsed[0]?.error : parsed.error
    reason = err?.errors?.[0]?.reason ?? (err as { details?: { reason?: string }[] } | undefined)?.details?.[0]?.reason
    if (err?.message) message = `YouTube API: ${err.message}`
  } catch {
    // treść nie jest JSON-em - zostaje sam kod HTTP
  }
  return new YouTubeApiError(message, res.status, reason)
}

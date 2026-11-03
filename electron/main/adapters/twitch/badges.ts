import type { ChatBadge } from '../../../../shared/chat-message'
import { isAllowedAssetUrl } from '../../../../shared/emote-url'
import type { IrcBadge } from './irc-tags'

interface BadgeVersion {
  id: string
  image_url_1x: string
  image_url_2x: string
  image_url_4x: string
  title: string
}
interface BadgeSet {
  set_id: string
  versions: BadgeVersion[]
}

export interface BadgeImage {
  title: string
  url1x: string
  url2x?: string
  url4x?: string
}

/** Mapa "set_id:version" -> obrazek, złożona z odpowiedzi Helix (globalne albo jednego kanału). */
export type BadgeMap = Map<string, BadgeImage>

/** Rozwiązuje obrazek odznaki dla kanału o danym `room-id` (najpierw kanałowe, potem globalne). */
export type BadgeResolver = (roomId: string | undefined, setId: string, version: string) => BadgeImage | undefined

const FRESH_MS = 6 * 60 * 60_000
const RETRY_AFTER_ERROR_MS = 5 * 60_000
const MAX_CHANNELS = 24

/** Nazwy ról do tooltipa, gdy Twitch nie zwrócił własnego tytułu (brak logowania / nieznana odznaka). */
const FALLBACK_TITLES: Record<string, string> = {
  broadcaster: 'Nadawca',
  moderator: 'Moderator',
  vip: 'VIP',
  subscriber: 'Subskrybent',
  founder: 'Założyciel',
  bits: 'Bits',
  staff: 'Twitch Staff',
  admin: 'Twitch Admin',
  partner: 'Partner',
  turbo: 'Turbo',
  premium: 'Prime Gaming'
}

export function parseBadgeSets(json: unknown): BadgeMap {
  const map: BadgeMap = new Map()
  const sets = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(sets)) return map
  for (const set of sets as BadgeSet[]) {
    if (!set || typeof set.set_id !== 'string' || !Array.isArray(set.versions)) continue
    for (const v of set.versions) {
      if (!v || typeof v.id !== 'string' || !isAllowedAssetUrl(v.image_url_1x, 'twitch')) continue
      map.set(`${set.set_id}:${v.id}`, {
        title: typeof v.title === 'string' && v.title ? v.title : set.set_id,
        url1x: v.image_url_1x,
        url2x: isAllowedAssetUrl(v.image_url_2x, 'twitch') ? v.image_url_2x : undefined,
        url4x: isAllowedAssetUrl(v.image_url_4x, 'twitch') ? v.image_url_4x : undefined
      })
    }
  }
  return map
}

/** Czysta funkcja: zamienia tag `badges` IRC na wspólny model. Wszystkie odznaki faktycznie
 *  zwrócone przez Twitcha - bez sztywnej listy; obrazek tylko, jeśli jest w mapie Helix. */
export function toTwitchBadges(ircBadges: IrcBadge[], roomId: string | undefined, resolve?: BadgeResolver): ChatBadge[] {
  return ircBadges.map((b) => {
    const image = resolve?.(roomId, b.id, b.version)
    return {
      id: `${b.id}/${b.version}`,
      type: b.id,
      label: image?.title ?? FALLBACK_TITLES[b.id] ?? b.id,
      imageUrl: image?.url1x,
      imageUrl2x: image?.url2x,
      imageUrl4x: image?.url4x,
      provider: 'twitch'
    }
  })
}

class CachedMap {
  map: BadgeMap = new Map()
  fetchedAt = 0
  failedAt = 0
  inFlight = false
}

export interface TwitchBadgeAuth {
  token: string
  clientId: string
}

/**
 * Cache odznak Twitcha (Helix `chat/badges/global` + `chat/badges?broadcaster_id=`). Helix wymaga
 * dowolnego tokenu (nie musi należeć do nadawcy), więc po zalogowaniu działa to także dla kanałów
 * obserwowanych z listy "Kanały". Pobierane raz (odświeżane leniwie co 6 h), nigdy per wiadomość;
 * `room-id` kanału przychodzi w ROOMSTATE, więc mapa kanału zwykle jest gotowa przed pierwszą
 * wiadomością.
 */
export class TwitchBadgeRegistry {
  private readonly global = new CachedMap()
  private readonly channels = new Map<string, CachedMap>()

  constructor(
    private readonly getAuth: () => TwitchBadgeAuth | undefined,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)
  ) {}

  readonly resolve: BadgeResolver = (roomId, setId, version) => {
    const key = `${setId}:${version}`
    if (roomId) {
      const channel = this.channels.get(roomId)
      const hit = channel?.map.get(key)
      if (hit) return hit
    }
    return this.global.map.get(key)
  }

  /** Wywoływane przy poznaniu `room-id` kanału oraz po zalogowaniu. Tanie, gdy cache świeży. */
  ensure(roomId?: string): void {
    this.load(this.global, 'https://api.twitch.tv/helix/chat/badges/global')
    if (!roomId || !/^\d+$/.test(roomId)) return
    let entry = this.channels.get(roomId)
    if (!entry) {
      entry = new CachedMap()
      this.channels.set(roomId, entry)
      while (this.channels.size > MAX_CHANNELS) {
        const oldest = this.channels.keys().next().value
        if (oldest === undefined) break
        this.channels.delete(oldest)
      }
    }
    this.load(entry, `https://api.twitch.tv/helix/chat/badges?broadcaster_id=${roomId}`)
  }

  /** Po zalogowaniu/zmianie konta - pozwala od razu ponowić pobranie po wcześniejszym błędzie. */
  resetFailures(): void {
    this.global.failedAt = 0
    for (const entry of this.channels.values()) entry.failedAt = 0
  }

  private load(entry: CachedMap, url: string): void {
    const now = Date.now()
    if (entry.inFlight) return
    if (entry.fetchedAt > 0 && now - entry.fetchedAt < FRESH_MS) return
    if (entry.failedAt > 0 && now - entry.failedAt < RETRY_AFTER_ERROR_MS) return
    const auth = this.getAuth()
    if (!auth) return
    entry.inFlight = true
    void this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${auth.token}`, 'Client-Id': auth.clientId },
      signal: AbortSignal.timeout(10_000)
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        entry.map = parseBadgeSets(await res.json())
        entry.fetchedAt = Date.now()
        entry.failedAt = 0
      })
      .catch((err: unknown) => {
        entry.failedAt = Date.now()
        console.warn('[twitch] nie udało się pobrać odznak:', err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        entry.inFlight = false
      })
  }
}

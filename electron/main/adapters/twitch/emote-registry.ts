import type { ChatMessage } from '../../../../shared/chat-message'
import { applyThirdPartyEmotes, type ThirdPartyEmote } from './emote-apply'
import { fetchSevenTvChannel, fetchSevenTvGlobal } from './seventv'
import { fetchBttvChannel, fetchBttvGlobal } from './bttv'

/** Jak długo zestaw emotek uznajemy za świeży (potem odświeżany leniwie, przy kolejnej wiadomości). */
const FRESH_MS = 30 * 60_000
/** Po błędzie API nie ponawiamy częściej niż co tyle - chroni przed zalewaniem API przy awarii. */
const RETRY_AFTER_ERROR_MS = 60_000
/** Ilu kanałów zestawy trzymamy w pamięci (LRU) - obserwowanych kanałów zwykle jest kilka. */
const MAX_CHANNELS = 24

type ProviderKey = 'seventv' | 'bttv'

export interface EmoteFetchers {
  seventvGlobal(): Promise<ThirdPartyEmote[]>
  seventvChannel(roomId: string): Promise<ThirdPartyEmote[]>
  bttvGlobal(): Promise<ThirdPartyEmote[]>
  bttvChannel(roomId: string): Promise<ThirdPartyEmote[]>
}

const DEFAULT_FETCHERS: EmoteFetchers = {
  seventvGlobal: fetchSevenTvGlobal,
  seventvChannel: fetchSevenTvChannel,
  bttvGlobal: fetchBttvGlobal,
  bttvChannel: fetchBttvChannel
}

/** Jeden zestaw emotek (np. "7TV globalne" albo "BTTV kanału X") wraz ze stanem pobierania. */
class CachedSet {
  emotes: ThirdPartyEmote[] = []
  fetchedAt = 0
  failedAt = 0
  inFlight: Promise<void> | undefined

  constructor(private readonly load: () => Promise<ThirdPartyEmote[]>, private readonly onChange: () => void) {}

  /** Uruchamia pobieranie w tle, jeśli zestaw jest nieświeży i nic nie jest w toku. Nie blokuje. */
  ensure(now: number): void {
    if (this.inFlight) return
    if (this.fetchedAt > 0 && now - this.fetchedAt < FRESH_MS) return
    if (this.failedAt > 0 && now - this.failedAt < RETRY_AFTER_ERROR_MS) return
    this.inFlight = this.load()
      .then((emotes) => {
        this.emotes = emotes
        this.fetchedAt = Date.now()
        this.failedAt = 0
        this.onChange()
      })
      .catch((err: unknown) => {
        // Zostawiamy poprzednie emotki (jeśli były) - wiadomości dalej działają, ewentualnie jako tekst.
        this.failedAt = Date.now()
        console.warn('[emotes]', err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        this.inFlight = undefined
      })
  }
}

interface ChannelEntry {
  seventv: CachedSet
  bttv: CachedSet
  merged: ReadonlyMap<string, ThirdPartyEmote> | undefined
}

export interface EmoteRegistryOptions {
  isEnabled(provider: ProviderKey): boolean
  preferStatic(): boolean
}

/**
 * Wspólny dla całej aplikacji cache emotek 7TV i BTTV - globalnych oraz kanałowych (po numerycznym
 * `room-id` kanału Twitcha, który przychodzi w tagach anonimowego IRC, więc logowanie NIE jest
 * potrzebne). Listy pobierane są raz i odświeżane leniwie co 30 min (bez timerów działających
 * w tle); nigdy przy każdej wiadomości. Scalona mapa (nazwa -> emotka) per kanał jest liczona tylko
 * po zmianie któregoś zestawu, więc dopasowanie wiadomości to O(liczba słów) lookupów w Map.
 *
 * Priorytet przy kolizji nazw (od najwyższego):
 *   1. natywne emotki Twitcha (z tagu `emotes`) - nigdy nie są nadpisywane (patrz emote-apply.ts),
 *   2. 7TV kanału, 3. BTTV kanału - emotki wybrane przez streamera wygrywają z globalnymi,
 *   4. 7TV globalne, 5. BTTV globalne.
 */
export class EmoteRegistry {
  private readonly global: Record<ProviderKey, CachedSet>
  private readonly channels = new Map<string, ChannelEntry>()

  constructor(
    private readonly options: EmoteRegistryOptions,
    private readonly fetchers: EmoteFetchers = DEFAULT_FETCHERS
  ) {
    const invalidateAll = (): void => {
      for (const entry of this.channels.values()) entry.merged = undefined
    }
    this.global = {
      seventv: new CachedSet(() => this.fetchers.seventvGlobal(), invalidateAll),
      bttv: new CachedSet(() => this.fetchers.bttvGlobal(), invalidateAll)
    }
  }

  /** Wywoływane przy wejściu na kanał (ROOMSTATE) i przy każdej wiadomości - tanie, gdy cache świeży. */
  ensureChannel(roomId: string): ChannelEntry {
    const now = Date.now()
    if (this.options.isEnabled('seventv')) this.global.seventv.ensure(now)
    if (this.options.isEnabled('bttv')) this.global.bttv.ensure(now)

    let entry = this.channels.get(roomId)
    if (entry) {
      // Odśwież pozycję w LRU.
      this.channels.delete(roomId)
      this.channels.set(roomId, entry)
    } else {
      const created: ChannelEntry = {
        seventv: new CachedSet(() => this.fetchers.seventvChannel(roomId), () => (created.merged = undefined)),
        bttv: new CachedSet(() => this.fetchers.bttvChannel(roomId), () => (created.merged = undefined)),
        merged: undefined
      }
      entry = created
      this.channels.set(roomId, entry)
      while (this.channels.size > MAX_CHANNELS) {
        const oldest = this.channels.keys().next().value
        if (oldest === undefined) break
        this.channels.delete(oldest)
      }
    }
    if (this.options.isEnabled('seventv')) entry.seventv.ensure(now)
    if (this.options.isEnabled('bttv')) entry.bttv.ensure(now)
    return entry
  }

  /** Scalona mapa emotek dla kanału (z uwzględnieniem włączonych providerów i priorytetów). */
  getMap(roomId: string): ReadonlyMap<string, ThirdPartyEmote> {
    const entry = this.ensureChannel(roomId)
    if (entry.merged) return entry.merged
    const seventv = this.options.isEnabled('seventv')
    const bttv = this.options.isEnabled('bttv')
    const map = new Map<string, ThirdPartyEmote>()
    // Od najniższego priorytetu do najwyższego - późniejsze `set` nadpisują wcześniejsze.
    if (bttv) for (const e of this.global.bttv.emotes) map.set(e.name, e)
    if (seventv) for (const e of this.global.seventv.emotes) map.set(e.name, e)
    if (bttv) for (const e of entry.bttv.emotes) map.set(e.name, e)
    if (seventv) for (const e of entry.seventv.emotes) map.set(e.name, e)
    entry.merged = map
    return map
  }

  /** Po zmianie ustawień (włączenie/wyłączenie providera) - przelicz scalone mapy. */
  invalidate(): void {
    for (const entry of this.channels.values()) entry.merged = undefined
  }

  /** Dokleja emotki 7TV/BTTV do wiadomości (lub zdarzenia z wiadomością) z kanału o danym room-id. */
  enrich(message: ChatMessage, roomId: string | undefined): ChatMessage {
    if (!roomId || message.fragments.length === 0) {
      if (roomId) this.ensureChannel(roomId)
      return message
    }
    const map = this.getMap(roomId)
    if (map.size === 0) return message
    const fragments = applyThirdPartyEmotes(message.fragments, map, this.options.preferStatic())
    return fragments === message.fragments ? message : { ...message, fragments }
  }

  /** Do testów/diagnostyki. */
  get cachedChannelCount(): number {
    return this.channels.size
  }
}

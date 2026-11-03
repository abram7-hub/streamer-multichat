import type { ChatMessage } from '../../shared/chat-message'
import type { ConnectionState } from '../../shared/platform'
import type { WatchedChannel } from '../../shared/settings'
import { TwitchIrcClient } from './adapters/twitch/irc-client'
import { KickPublicChatClient } from './adapters/kick/public-chat'

interface ActiveWatch {
  signature: string
  unwatch: () => void
}

/**
 * Zarządza dowolną liczbą anonimowo obserwowanych kanałów Twitcha/Kicka (sekcja "Kanały"),
 * niezależnie od głównej, skonfigurowanej integracji każdej platformy. `sync()` diffuje poprzednią
 * i nową listę z ustawień i (od)łącza tylko to, co faktycznie się zmieniło - nie zrywa działających
 * połączeń przy niepowiązanych zmianach ustawień gdzie indziej w aplikacji.
 *
 * Deduplikacja z główną integracją: dla Twitcha następuje automatycznie na poziomie
 * `TwitchIrcClient` (jedno, współdzielone, liczące referencje połączenie IRC - obserwowanie tego
 * samego kanału głównego i z listy "Kanały" nie otwiera drugiego socketu). Dla Kicka główna
 * integracja używa osobnego mechanizmu (webhook OAuth) - gdyby użytkownik dodał własny, już
 * połączony kanał Kicka też do listy "Kanały", wiadomości nadal nie zdublują się w interfejsie,
 * bo `message-bus` odrzuca duplikaty po tym samym `message_id` niezależnie od źródła transportu.
 */
export class WatchedChannelsManager {
  private readonly active = new Map<string, ActiveWatch>()

  constructor(
    private readonly twitchIrc: TwitchIrcClient,
    private readonly kickPublicChat: KickPublicChatClient,
    private readonly onMessage: (message: ChatMessage) => void,
    private readonly onStatus: (id: string, state: ConnectionState, message?: string) => void
  ) {}

  sync(entries: WatchedChannel[]): void {
    const wantedIds = new Set(entries.filter((e) => e.enabled).map((e) => e.id))
    for (const [id, active] of this.active) {
      if (!wantedIds.has(id)) {
        active.unwatch()
        this.active.delete(id)
      }
    }
    for (const entry of entries) {
      if (!entry.enabled || !entry.channel.trim()) continue
      const signature = JSON.stringify(entry)
      const current = this.active.get(entry.id)
      if (current && current.signature === signature) continue
      current?.unwatch()
      this.active.set(entry.id, { signature, unwatch: this.startWatching(entry) })
    }
  }

  private startWatching(entry: WatchedChannel): () => void {
    if (entry.platform === 'twitch') {
      return this.twitchIrc.watch(entry.channel, {
        onMessage: (message) => this.onMessage(message),
        onActivity: () => undefined, // JOIN/PART dotyczy tylko głównego skonfigurowanego kanału
        onStatus: (state, message) => this.onStatus(entry.id, state, message)
      })
    }
    return this.kickPublicChat.watch(
      entry.channel,
      {
        onMessage: (message) => this.onMessage(message),
        onStatus: (state, message) => this.onStatus(entry.id, state, message)
      },
      entry.kickChatroomId
    )
  }

  shutdown(): void {
    for (const active of this.active.values()) active.unwatch()
    this.active.clear()
  }
}

import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { isIgnored } from './ignore-filter'
import { MentionDetector } from './highlight'
import { applySevenTvEmotes, type SevenTvEmote } from './adapters/twitch/seventv'
import { MessageBatcher } from '../../shared/message-batcher'
import type { ChatMessage } from '../../shared/chat-message'
import { DEFAULT_SETTINGS, type IgnoreLists } from '../../shared/settings'

/**
 * Testy wydajnościowe na syntetycznym strumieniu wiadomości (wymaganie: "multichat może odbierać
 * kilkadziesiąt wiadomości na sekundę z wielu kanałów"). Mierzą całą gorącą ścieżkę na wiadomość
 * (filtrowanie ignorowanych, wyróżnianie, dopasowywanie emotek 7TV, deduplikacja message-bus) na
 * dużej, syntetycznej próbce - żeby wychwycić ewentualną złożoność O(n²) zanim trafi na produkcję.
 * Nie mierzy renderowania Reacta (do tego potrzebny byłby dodatkowy pakiet typu jsdom/Playwright,
 * czego celowo unikamy - patrz raport końcowy).
 */

function makeMessage(i: number): ChatMessage {
  return {
    id: `msg-${i}`,
    platform: 'twitch',
    channel: 'testnick_',
    author: {
      id: `user-${i % 500}`,
      username: `widz${i % 500}`,
      displayName: `Widz${i % 500}`,
      color: '#FF0000',
      badges: [],
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments: [{ type: 'text', text: `siema Pog wiadomość numer ${i} z jakimś dłuższym tekstem xd` }],
    rawText: `siema Pog wiadomość numer ${i}`,
    timestampMs: Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false
  }
}

function emptyIgnoreLists(): IgnoreLists {
  return {
    twitch: { enabled: true, users: [{ username: 'ktos_ignorowany' }] },
    kick: { enabled: true, users: [] },
    youtube: { enabled: true, users: [] },
    tiktok: { enabled: true, users: [] }
  }
}

describe('synthetic message-stream performance', () => {
  it('processes 20 000 messages through ignore-filter + highlight + message-bus dedup well under a second', () => {
    const N = 20_000
    const ignoreLists = emptyIgnoreLists()
    const bus = new EventEmitter()
    const seen = new Set<string>()
    let published = 0
    bus.on('message', () => {
      published++
    })
    const detector = new MentionDetector()
    const mentionSettings = {
      ...DEFAULT_SETTINGS,
      twitch: { ...DEFAULT_SETTINGS.twitch, channelLogin: 'testnick' },
      mentions: { ...DEFAULT_SETTINGS.mentions, keywords: ['C++', 'gg wp', '[TEST]', 'boss', 'raid', 'combo'] }
    }

    const start = performance.now()
    for (let i = 0; i < N; i++) {
      const message = makeMessage(i)
      if (isIgnored(message.author, 'twitch', ignoreLists)) continue
      const patched = detector.apply(message, mentionSettings)
      const key = `${patched.platform}:${patched.id}`
      if (seen.has(key)) continue
      seen.add(key)
      bus.emit('message', patched)
    }
    const elapsedMs = performance.now() - start

    expect(published).toBe(N)
    expect(elapsedMs).toBeLessThan(1000)
  })

  it('applies 7TV emote matching across 5 000 messages well under a second (with a realistic-size emote map)', () => {
    const N = 5000
    const map = new Map<string, SevenTvEmote>()
    for (let i = 0; i < 800; i++) {
      map.set(`Emote${i}`, { name: `Emote${i}`, url: `https://cdn.7tv.app/emote/${i}/2x.webp`, isZeroWidth: false })
    }
    map.set('Pog', { name: 'Pog', url: 'https://cdn.7tv.app/emote/pog/2x.webp', isZeroWidth: false })

    const start = performance.now()
    for (let i = 0; i < N; i++) {
      const message = makeMessage(i)
      applySevenTvEmotes(message.fragments, map)
    }
    const elapsedMs = performance.now() - start

    expect(elapsedMs).toBeLessThan(1000)
  })

  it('detects duplicate messages (same platform:id) without reprocessing them as new', () => {
    const ignoreLists = emptyIgnoreLists()
    const seen = new Set<string>()
    let acceptedCount = 0
    for (let i = 0; i < 1000; i++) {
      // Symuluje tę samą wiadomość dostarczoną dwoma torami naraz (np. główna integracja + wpis
      // z listy "Kanały" obserwujący ten sam kanał) - patrz komentarz w watched-channels.ts.
      for (const message of [makeMessage(i), makeMessage(i)]) {
        if (isIgnored(message.author, 'twitch', ignoreLists)) continue
        const key = `${message.platform}:${message.id}`
        if (seen.has(key)) continue
        seen.add(key)
        acceptedCount++
      }
    }
    expect(acceptedCount).toBe(1000)
  })

  it('MessageBatcher bounds UI updates to ~1 per animation frame regardless of message rate (20-50 msg/s and short bursts)', () => {
    // Model "co N wiadomości jedna klatka" bez prawdziwego zegara/rAF: symuluje nierówny ruch
    // (średnio ~35 wiadomości/s, z krótkimi skokami do 3 na klatkę) przez 600 "klatek" (60fps przez
    // 10s) - realistyczny scenariusz wielokanałowego, intensywnego ruchu z wymagania #7.
    const totalFrames = 600
    let flushCount = 0
    let deliveredCount = 0
    let pendingFlush: (() => void) | undefined

    const batcher = new MessageBatcher<number>(
      (flush) => {
        pendingFlush = flush
      },
      (batch) => {
        flushCount++
        deliveredCount += batch.length
      }
    )

    let sent = 0
    for (let frame = 0; frame < totalFrames; frame++) {
      // Nierówne tempo: czasem 0 wiadomości w danej klatce, czasem kilka naraz (krótki skok ruchu).
      const messagesThisFrame = frame % 7 === 0 ? 3 : frame % 3 === 0 ? 1 : 0
      for (let i = 0; i < messagesThisFrame; i++) {
        batcher.push(sent)
        sent++
      }
      // Symuluje przeglądarkę wywołującą zaplanowany rAF/setTimeout raz na "klatkę".
      const flush = pendingFlush
      pendingFlush = undefined
      flush?.()
    }

    expect(sent).toBeGreaterThan(400) // upewnia się, że scenariusz faktycznie wygenerował duży ruch
    expect(deliveredCount).toBe(sent) // żadna wiadomość nie zginęła
    expect(flushCount).toBeLessThan(sent) // zdecydowanie mniej aktualizacji UI niż wiadomości
    expect(flushCount).toBeLessThanOrEqual(totalFrames)
  })
})

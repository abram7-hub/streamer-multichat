import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ActivityEvent, ChatMessage } from '@shared/chat-message'
import type { Platform } from '@shared/platform'
import { chatLayout, type ChatAppearance, type PlatformColors } from '@shared/appearance'
import type { MentionHighlightSettings } from '@shared/mentions'
import {
  countNewerThan,
  distanceFromNewest,
  isFollowingNewest,
  nextAutoScroll,
  lastMessageKey,
  messageKey,
  newMessagesArrow,
  newMessagesLabel
} from '@shared/chat-history'
import { MessageRow } from './MessageRow'
import { ChatList } from './ChatList'
import { useChatStore } from '../store/useChatStore'

const EDGE_THRESHOLD_PX = 40
/** Zdarzenie przewinięcia w tym czasie po kółku/dotyku/klawiszu/kliknięciu to ruch użytkownika, nie dopisanie wiadomości. */
const USER_SCROLL_WINDOW_MS = 600

type FeedItem =
  | { kind: 'message'; timestampMs: number; message: ChatMessage }
  | { kind: 'activity'; timestampMs: number; event: ActivityEvent }

const ActivityRow = memo(function ActivityRow({ event }: { event: ActivityEvent }) {
  return (
    <div className="activity-row" data-type={event.type}>
      <span className="activity-dot" data-type={event.type} />
      {event.username} {event.type === 'join' ? 'dołączył(a) do czatu' : 'opuścił(a) czat'}
    </div>
  )
})

function PinnedBar({ pinned, onJump, onUnpin }: { pinned: ChatMessage[]; onJump: (m: ChatMessage) => void; onUnpin: (m: ChatMessage) => void }) {
  const [open, setOpen] = useState(true)
  if (pinned.length === 0) return null
  return (
    <div className="pinned-bar" data-open={open}>
      <button type="button" className="pinned-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        📌 Przypięte ({pinned.length}) {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="pinned-list">
          {pinned.map((m) => (
            <li key={messageKey(m)} className="pinned-item">
              <button type="button" className="pinned-jump" title="Pokaż w czacie" onClick={() => onJump(m)}>
                <strong>{m.author.displayName}:</strong> {m.rawText || m.event?.kind}
              </button>
              <button type="button" className="pinned-unpin" title="Odepnij" aria-label="Odepnij" onClick={() => onUnpin(m)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  messages: ChatMessage[]
  activity: ActivityEvent[]
  appearance: ChatAppearance
  colors: PlatformColors
  mention?: MentionHighlightSettings
  /** Wstrzymaj przewijanie do najnowszych, gdy kursor jest nad czatem. */
  pauseOnHover?: boolean
  multiChannelPlatforms: ReadonlySet<Platform>
  onIgnoreUser: (message: ChatMessage) => void
}

export function ChatWindow({ messages, activity, appearance, colors, mention, pauseOnHover = false, multiChannelPlatforms, onIgnoreUser }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScroll = useChatStore((s) => s.autoScroll)
  const setAutoScroll = useChatStore((s) => s.setAutoScroll)
  const pinned = useChatStore((s) => s.pinned)
  const togglePin = useChatStore((s) => s.togglePin)
  const [hovered, setHovered] = useState(false)
  const userScrollAt = useRef(0)
  const pointerHeld = useRef(false)
  const { newestFirst } = chatLayout(appearance)
  const hoverPaused = pauseOnHover && hovered
  // Czat podąża za najnowszymi tylko, gdy użytkownik nie przewinął historii i (opcjonalnie) kursor
  // nie jest nad czatem. Odbieranie wiadomości trwa w obu przypadkach.
  const following = isFollowingNewest(autoScroll, pauseOnHover, hovered)

  // Kotwica: najnowsza wiadomość w chwili zatrzymania - od niej liczone są "nowe wiadomości".
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const [anchor, setAnchor] = useState<string | null>(null)
  useEffect(() => {
    setAnchor(following ? null : lastMessageKey(messagesRef.current))
  }, [following])
  const newCount = anchor === null ? 0 : countNewerThan(messages, anchor)

  const pinnedKeys = useMemo(() => new Set(pinned.map(messageKey)), [pinned])

  const feed = useMemo<FeedItem[]>(() => {
    // Szybka ścieżka dla najczęstszego przypadku (JOIN/PART wyłączone lub pokazywane w osobnym
    // panelu - patrz App.tsx): bez tego każda nowa wiadomość ponownie sortowałaby całą, już
    // posortowaną tablicę tylko po to, żeby scalić ją z pustą listą aktywności.
    let items: FeedItem[]
    if (activity.length === 0) {
      items = messages.map((message): FeedItem => ({ kind: 'message', timestampMs: message.receivedAtMs, message }))
    } else {
      items = [
        ...messages.map((message): FeedItem => ({ kind: 'message', timestampMs: message.receivedAtMs, message })),
        ...activity.map((event): FeedItem => ({ kind: 'activity', timestampMs: event.timestampMs, event }))
      ]
      items.sort((a, b) => a.timestampMs - b.timestampMs)
    }
    // Wiersze mają stałe klucze, więc odwrócenie kolejności tylko przestawia węzły DOM.
    return newestFirst ? items.reverse() : items
  }, [messages, activity, newestFirst])

  const scrollToNewest = (el: HTMLDivElement): void => {
    el.scrollTop = newestFirst ? 0 : el.scrollHeight
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !following) return
    el.scrollTop = newestFirst ? 0 : el.scrollHeight
  }, [feed, following, newestFirst])

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    // Wyłączyć autoprzewijanie może tylko ruch użytkownika (kółko, dotyk, klawisz, przeciąganie paska).
    // Zdarzenia przewinięcia wywołane przez samą stronę - dopisanie wiadomości, zakotwiczenie
    // przewijania przeglądarki, doładowany obrazek - nie zatrzymują czatu.
    const userGesture = pointerHeld.current || performance.now() - userScrollAt.current < USER_SCROLL_WINDOW_MS
    const next = nextAutoScroll(autoScroll, distanceFromNewest(el, newestFirst), EDGE_THRESHOLD_PX, userGesture)
    if (next !== autoScroll) setAutoScroll(next)
  }
  const markUserScroll = (): void => {
    userScrollAt.current = performance.now()
  }
  useEffect(() => {
    const release = (): void => {
      if (pointerHeld.current) markUserScroll()
      pointerHeld.current = false
    }
    window.addEventListener('pointerup', release)
    return () => window.removeEventListener('pointerup', release)
  }, [])

  const jumpToLatest = (): void => {
    setAutoScroll(true)
    // Kursor nadal nad czatem przy wstrzymaniu po najechaniu: licznik od nowa, od bieżącej wiadomości.
    setAnchor(hoverPaused ? lastMessageKey(messages) : null)
    const el = scrollRef.current
    if (el) scrollToNewest(el)
  }

  const jumpToMessage = (m: ChatMessage): void => {
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(messageKey(m))}"]`)
    if (!row) return
    setAutoScroll(false)
    row.scrollIntoView({ block: 'center' })
  }

  const showJump = !autoScroll || newCount > 0

  return (
    <div
      className="chat-container"
      onWheel={markUserScroll}
      onTouchMove={markUserScroll}
      onKeyDown={markUserScroll}
      onPointerDown={() => {
        pointerHeld.current = true
        markUserScroll()
      }}
      // Doładowana emotka/odznaka powiększa wiersz już po przewinięciu - czat zostaje przy najnowszych.
      onLoadCapture={() => {
        const el = scrollRef.current
        if (el && following) scrollToNewest(el)
      }}
    >
      <PinnedBar pinned={pinned} onJump={jumpToMessage} onUnpin={togglePin} />
      <ChatList
        ref={scrollRef}
        className="chat-scroll"
        appearance={appearance}
        colors={colors}
        mention={mention}
        onScroll={handleScroll}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {feed.map((item) =>
          item.kind === 'message' ? (
            <MessageRow
              key={`${item.message.platform}:${item.message.id}`}
              message={item.message}
              pinned={pinnedKeys.has(messageKey(item.message))}
              multiChannelPlatforms={multiChannelPlatforms}
              onIgnoreUser={onIgnoreUser}
              onTogglePin={togglePin}
            />
          ) : (
            <ActivityRow key={item.event.id} event={item.event} />
          )
        )}
      </ChatList>
      {showJump && (
        <button className="jump-latest" data-edge={newestFirst ? 'top' : 'bottom'} onClick={jumpToLatest}>
          {newMessagesArrow(newestFirst)} {newCount > 0 ? newMessagesLabel(newCount) : 'Najnowsze wiadomości'}
        </button>
      )}
    </div>
  )
}

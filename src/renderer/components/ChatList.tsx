import {
  forwardRef,
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type UIEventHandler
} from 'react'
import type { ChatMessage } from '@shared/chat-message'
import {
  appearanceCssVars,
  appearanceDataAttributes,
  chatLayout,
  freshClassDurationMs,
  APPEARANCE_LIMITS,
  type ChatAppearance,
  type PlatformColors
} from '@shared/appearance'
import { isFreshMessage } from '@shared/pulse'
import { DEFAULT_MENTION_HIGHLIGHT, mentionCssVars, mentionDataAttributes, type MentionHighlightSettings } from '@shared/mentions'
import { PlatformIcon } from './PlatformIcon'
import { Badges } from './Badges'
import { FragmentsText } from './FragmentsText'

/** Jak długo nowy wiersz trzyma klasę `fresh` - dłużej niż najdłuższa możliwa animacja. */
export const FRESH_HOLD_MS = freshClassDurationMs({ animationDurationMs: APPEARANCE_LIMITS.animationDurationMs![1] })

/**
 * Wiersz jest "świeży" tylko, jeśli trafia na ekran tuż po odebraniu wiadomości (ponowny montaż
 * starej wiadomości, np. po zmianie filtra, nie animuje jej drugi raz). Klasa jest zdejmowana po
 * zakończeniu animacji - późniejsza zmiana ustawień animacji nie odpali jej ponownie na historii.
 */
export function useFreshFlag(receivedAtMs: number): boolean {
  const [fresh, setFresh] = useState(() => isFreshMessage(receivedAtMs))
  useEffect(() => {
    if (!fresh) return
    const timer = setTimeout(() => setFresh(false), FRESH_HOLD_MS)
    return () => clearTimeout(timer)
  }, []) // licznik startuje raz, przy montowaniu wiersza
  return fresh
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Treść wiersza czatu: `[ikona platformy] [odznaki] Nick: treść` - wspólna dla czatu głównego,
 * nakładki OBS i podglądu w ustawieniach. Wiadomości /me nie mają dwukropka, a cała treść ma kolor
 * nicku (jak w natywnym czacie Twitcha).
 */
export const MessageContent = memo(function MessageContent({
  message,
  fallbackColor,
  onAuthorContextMenu
}: {
  message: ChatMessage
  /** Kolor nicku, gdy platforma go nie podała (nakładka OBS ma tło sceny, więc biały). */
  fallbackColor?: string
  onAuthorContextMenu?: (event: MouseEvent) => void
}) {
  const nickColor = message.author.color || fallbackColor
  const actionColor = message.isAction ? nickColor : undefined
  return (
    <>
      <PlatformIcon platform={message.platform} />
      <Badges badges={message.author.badges} />
      <span className="author-name" style={{ color: nickColor }} onContextMenu={onAuthorContextMenu}>
        {message.author.displayName}
      </span>
      {message.isAction ? ' ' : ': '}
      <span className={message.isAction ? 'action-text' : undefined} style={{ color: actionColor }}>
        <FragmentsText fragments={message.fragments} />
      </span>
    </>
  )
})

interface ChatListProps {
  appearance: ChatAppearance
  colors: PlatformColors
  /** Wyróżnienie wzmianek (ustawienia "Wzmianki"). */
  mention?: MentionHighlightSettings
  className?: string
  style?: CSSProperties
  onScroll?: UIEventHandler<HTMLDivElement>
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  children: ReactNode
}

/**
 * Kontener listy wiadomości: zmienne CSS (rozmiary, kolory platform, parametry animacji),
 * atrybuty wybierające animację i wyrównanie dla wybranego sposobu układania wiadomości.
 * Kolejność dzieci (od najnowszej lub od najstarszej) ustala wywołujący - patrz `chatLayout`.
 */
export const ChatList = forwardRef<HTMLDivElement, ChatListProps>(function ChatList(
  { appearance, colors, mention = DEFAULT_MENTION_HIGHLIGHT, className, style, onScroll, onMouseEnter, onMouseLeave, children },
  ref
) {
  const vars = useMemo(() => ({ ...appearanceCssVars(appearance, colors), ...mentionCssVars(mention) }), [appearance, colors, mention])
  const data = useMemo(() => ({ ...appearanceDataAttributes(appearance), ...mentionDataAttributes(mention) }), [appearance, mention])
  const { justifyContent } = chatLayout(appearance)
  return (
    <div
      ref={ref}
      className={`chat-list${className ? ` ${className}` : ''}`}
      style={{ ...(vars as CSSProperties), justifyContent, ...style }}
      data-timestamps={String(appearance.showTimestamps)}
      data-badges={String(appearance.showBadges)}
      {...data}
      onScroll={onScroll}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  )
})

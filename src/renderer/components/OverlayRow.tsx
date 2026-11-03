import { memo } from 'react'
import type { ChatMessage } from '@shared/chat-message'
import { formatTime, MessageContent, useFreshFlag } from './ChatList'
import { StreamEventLine } from './StreamEventLine'

/**
 * Wiersz nakładki OBS - ten sam format i te same komponenty co okno główne. Wygląd (w tym osobne
 * ustawienia dla OBS) pochodzi ze zmiennych CSS kontenera `ChatList`.
 */
export const OverlayRow = memo(function OverlayRow({ message, leaving = false }: { message: ChatMessage; leaving?: boolean }) {
  const fresh = useFreshFlag(message.receivedAtMs)
  const className = `overlay-row chat-row${message.event ? ' event-row' : ''}${fresh ? ' fresh' : ''}${leaving ? ' leaving' : ''}`

  if (message.event) {
    return (
      <div className={className} data-platform={message.platform}>
        <StreamEventLine message={message} event={message.event} />
      </div>
    )
  }

  return (
    <div className={className} data-platform={message.platform} data-mention={message.isHighlighted}>
      <span className="timestamp">{formatTime(message.timestampMs)} </span>
      <MessageContent message={message} fallbackColor="#fff" />
    </div>
  )
})

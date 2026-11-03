import { memo, useState, type MouseEvent } from 'react'
import type { ChatMessage } from '@shared/chat-message'
import { PLATFORM_LABELS, type Platform } from '@shared/platform'
import { messageKey } from '@shared/chat-history'
import { formatTime, MessageContent, useFreshFlag } from './ChatList'
import { StreamEventLine } from './StreamEventLine'

interface Props {
  message: ChatMessage
  multiChannelPlatforms: ReadonlySet<Platform>
  onIgnoreUser: (message: ChatMessage) => void
  pinned?: boolean
  onTogglePin?: (message: ChatMessage) => void
}

/**
 * Wiersz czatu głównego. Wygląd (rozmiary, kolory platform, animacje, znaczniki czasu) pochodzi
 * ze zmiennych CSS kontenera `ChatList`, więc zmiana ustawień wyglądu nie renderuje wiersza ponownie.
 */
function MessageRowImpl({ message, multiChannelPlatforms, onIgnoreUser, pinned = false, onTogglePin }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const fresh = useFreshFlag(message.receivedAtMs)
  const className = `message-row chat-row${message.event ? ' event-row' : ''}${fresh ? ' fresh' : ''}`
  const openMenu = (e: MouseEvent): void => {
    e.preventDefault()
    setMenuOpen(true)
  }
  const prefix = (
    <>
      <span className="timestamp">{formatTime(message.timestampMs)} </span>
      {multiChannelPlatforms.has(message.platform) && (
        <span className="channel-label" title={`Kanał: ${message.channel}`}>
          {message.channel}
        </span>
      )}
    </>
  )
  const menu = menuOpen && (
    <>
      <div className="context-menu-backdrop" onClick={() => setMenuOpen(false)} />
      <div className="context-menu">
        {onTogglePin && (
          <button
            className="context-menu-item"
            onClick={() => {
              onTogglePin(message)
              setMenuOpen(false)
            }}
          >
            {pinned ? 'Odepnij wiadomość' : 'Przypnij wiadomość'}
          </button>
        )}
        {!message.event && (
          <button
            className="context-menu-item"
            onClick={() => {
              onIgnoreUser(message)
              setMenuOpen(false)
            }}
          >
            Ignoruj „{message.author.displayName}” na {PLATFORM_LABELS[message.platform]}
          </button>
        )}
      </div>
    </>
  )

  if (message.event) {
    return (
      <div
        className={className}
        data-event={message.event.kind}
        data-platform={message.platform}
        data-key={messageKey(message)}
        data-pinned={pinned}
        onContextMenu={onTogglePin ? openMenu : undefined}
      >
        <StreamEventLine message={message} event={message.event} prefix={prefix} />
        {menu}
      </div>
    )
  }

  return (
    <div
      className={className}
      data-platform={message.platform}
      data-key={messageKey(message)}
      data-mention={message.isHighlighted}
      data-pinned={pinned}
      data-paid={Boolean(message.paid)}
      onContextMenu={openMenu}
    >
      <span className="message-line">
        {prefix}
        <MessageContent message={message} />
        {message.paid && (
          <span className="paid-pill">
            {message.paid.label}
            {message.paid.amountFormatted ? ` · ${message.paid.amountFormatted}` : ''}
          </span>
        )}
        {message.isDemo && <span className="demo-pill">DEMO</span>}
      </span>
      {menu}
    </div>
  )
}

export const MessageRow = memo(MessageRowImpl)

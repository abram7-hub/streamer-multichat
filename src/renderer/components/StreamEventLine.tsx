import { memo, type ReactNode } from 'react'
import type { ChatMessage, StreamEvent } from '@shared/chat-message'
import { describeStreamEvent } from '@shared/stream-event'
import { isAllowedAssetUrl } from '@shared/emote-url'
import { PlatformIcon } from './PlatformIcon'
import { FragmentsText } from './FragmentsText'

function formatCost(cost: number): string {
  return cost.toLocaleString('pl-PL')
}

/**
 * Wiadomość systemowa o zdarzeniu streamowym (sub, raid, nagroda...) - współdzielona przez okno główne
 * i nakładkę OBS. Jedna linia: [ikona platformy] [ikona zdarzenia] opis: wiadomość użytkownika.
 * Bez awatarów. Wszystkie teksty (nazwy, nagrody, wiadomości) trafiają do DOM wyłącznie jako węzły
 * tekstowe Reacta; ikona nagrody ma stały, mały rozmiar (nie rozpycha wiersza).
 */
export const StreamEventLine = memo(function StreamEventLine({
  message,
  event,
  prefix
}: {
  message: ChatMessage
  event: StreamEvent
  /** Np. znacznik czasu / etykieta kanału renderowane przez rodzica. */
  prefix?: ReactNode
}) {
  const { icon, text } = describeStreamEvent(event, message.author.displayName)
  const rewardImage = isAllowedAssetUrl(event.rewardImageUrl, 'twitch') ? event.rewardImageUrl : undefined
  return (
    <span className="event-line">
      {prefix}
      <PlatformIcon platform={message.platform} />
      {rewardImage ? (
        <img className="event-reward-img" src={rewardImage} alt="" aria-hidden="true" width={18} height={18} decoding="async" />
      ) : (
        <span className="event-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="event-text">{text}</span>
      {event.kind === 'redemption' && event.rewardCost !== undefined && (
        <span className="event-meta"> · {formatCost(event.rewardCost)} pkt</span>
      )}
      {message.fragments.length > 0 && (
        <>
          {': '}
          <span className="event-user-message">
            <FragmentsText fragments={message.fragments} />
          </span>
        </>
      )}
    </span>
  )
})

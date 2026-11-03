import { memo, useState } from 'react'
import type { ChatBadge } from '@shared/chat-message'
import { isAllowedAssetUrl } from '@shared/emote-url'

/** Odznaka do wyświetlenia: ma oficjalny obrazek z dozwolonego CDN-u platformy. */
export function isRenderableBadge(badge: ChatBadge): boolean {
  return isAllowedAssetUrl(badge.imageUrl, badge.provider)
}

function srcSetOf(badge: ChatBadge): string | undefined {
  const entries: string[] = []
  if (isAllowedAssetUrl(badge.imageUrl2x, badge.provider)) entries.push(`${badge.imageUrl2x} 2x`)
  if (isAllowedAssetUrl(badge.imageUrl4x, badge.provider)) entries.push(`${badge.imageUrl4x} 4x`)
  return entries.length > 0 ? [`${badge.imageUrl} 1x`, ...entries].join(', ') : undefined
}

/**
 * Pojedyncza odznaka. Rozmiar jest stały (CSS `.badge-img`), więc miejsce jest zarezerwowane przed
 * załadowaniem obrazka - wiersz nie skacze. Obrazki są cache'owane przez przeglądarkę (ten sam URL
 * dla wszystkich wiadomości danego widza), nic nie jest pobierane per wiadomość przez aplikację.
 * Uszkodzony URL -> odznaka znika (bez ikony zepsutego obrazka i bez tekstu zastępczego).
 */
function BadgeImage({ badge }: { badge: ChatBadge }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      className="badge-img"
      src={badge.imageUrl}
      srcSet={srcSetOf(badge)}
      alt={badge.label}
      title={badge.label}
      aria-label={badge.label}
      width={18}
      height={18}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Odznaki/role autora jako IKONY. Odznaki bez oficjalnego obrazka platformy (np. sama nazwa roli
 * "moderator", "member") celowo NIE są renderowane - w wierszu czatu nigdy nie pojawia się tekst roli.
 */
export const Badges = memo(function Badges({ badges }: { badges: ChatBadge[] }) {
  const visible = badges.filter(isRenderableBadge)
  if (visible.length === 0) return null
  return (
    <span className="badges">
      {visible.map((badge) => (
        <BadgeImage key={badge.id} badge={badge} />
      ))}
    </span>
  )
})

import { memo, useState } from 'react'
import { PLATFORMS, type AdapterStatus, type Platform } from '@shared/platform'
import { PlatformIcon } from './PlatformIcon'

/**
 * Wyraźne ostrzeżenia o funkcjach, które przestały działać mimo działającego czatu (np. wygasły token
 * Twitch -> brak Channel Points). Wcześniej takie problemy trafiały tylko do konsoli. Każde ostrzeżenie
 * można ukryć; ponownie pojawi się dopiero, gdy zmieni się jego treść.
 */
export const WarningBanners = memo(function WarningBanners({
  statuses,
  onOpenSettings
}: {
  statuses: Partial<Record<Platform, AdapterStatus>>
  onOpenSettings: () => void
}) {
  const [dismissed, setDismissed] = useState<Partial<Record<Platform, string>>>({})
  const active = PLATFORMS.filter((p) => {
    const warning = statuses[p]?.warning
    return warning && dismissed[p] !== warning
  })
  if (active.length === 0) return null
  return (
    <>
      {active.map((platform) => {
        const warning = statuses[platform]?.warning as string
        return (
          <div key={platform} className="warning-banner" role="alert">
            <PlatformIcon platform={platform} />
            <span className="warning-banner-text">{warning}</span>
            <button className="btn" onClick={onOpenSettings}>
              Ustawienia
            </button>
            <button className="btn" onClick={() => setDismissed((d) => ({ ...d, [platform]: warning }))} title="Ukryj">
              ×
            </button>
          </div>
        )
      })}
    </>
  )
})

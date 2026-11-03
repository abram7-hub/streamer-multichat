import { memo, type ReactElement } from 'react'
import type { Platform } from '@shared/platform'
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@shared/platform'

/** Małe, rozpoznawalne ikony platform (zamiast tekstowych etykiet) - zachowują kolory marek. */
function TwitchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.3 2 2.6 6.4v13.2h4.9V22l3.6-2.4h4l6.3-6.3V2Zm12.9 10.1-3 3h-3.4l-2.6 2.6v-2.6H4.9V3.7h12.3Z"
      />
      <path fill="currentColor" d="M14.7 6.8h1.6v4.4h-1.6Zm-4.4 0h1.6v4.4h-1.6Z" />
    </svg>
  )
}

function KickGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M3 3h6v5h2V5h2V3h8v6h-2v2h-2v2h2v2h2v6h-8v-2h-2v-2h-2v5H3Z" />
    </svg>
  )
}

function YouTubeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="1.5" y="5" width="21" height="14" rx="4" fill="currentColor" />
      <path fill="var(--bg, #0e0e12)" d="M10 8.5v7l6-3.5Z" />
    </svg>
  )
}

function TikTokGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.5 2h-3.2v13.6a2.9 2.9 0 1 1-2.9-3c.3 0 .6 0 .9.1V9.5a6.1 6.1 0 1 0 5.2 6V9.1a8.1 8.1 0 0 0 4.7 1.5V7.3A4.8 4.8 0 0 1 16.5 2Z"
      />
    </svg>
  )
}

const ICONS: Record<Platform, () => ReactElement> = {
  twitch: TwitchGlyph,
  kick: KickGlyph,
  youtube: YouTubeGlyph,
  tiktok: TikTokGlyph
}

/** Ikona platformy zamiast tekstu "Twitch"/"Kick"/... - nazwa tylko w tooltipie i dla czytników ekranu. */
export const PlatformIcon = memo(function PlatformIcon({ platform }: { platform: Platform }) {
  const Icon = ICONS[platform]
  const label = PLATFORM_LABELS[platform]
  return (
    <span className="platform-icon" style={{ color: PLATFORM_COLORS[platform] }} title={label} role="img" aria-label={label}>
      <Icon />
    </span>
  )
})

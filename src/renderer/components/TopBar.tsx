import { PLATFORMS, PLATFORM_LABELS } from '@shared/platform'
import type { AdapterStatus, Platform } from '@shared/platform'
import { DemoModeToolbarToggle } from './DemoModeControls'

interface Props {
  enabledPlatforms: Platform[]
  statuses: Partial<Record<Platform, AdapterStatus>>
  onTogglePlatform: (platform: Platform) => void
  fontSizePx: number
  onFontSizeChange: (px: number) => void
  demoMode: boolean
  onOpenSettings: () => void
}

export function TopBar({
  enabledPlatforms,
  statuses,
  onTogglePlatform,
  fontSizePx,
  onFontSizeChange,
  demoMode,
  onOpenSettings
}: Props) {
  return (
    <div className="topbar">
      {PLATFORMS.map((platform) => {
        const enabled = enabledPlatforms.includes(platform)
        const state = statuses[platform]?.state ?? 'idle'
        return (
          <button
            key={platform}
            className="platform-chip"
            data-enabled={enabled}
            onClick={() => onTogglePlatform(platform)}
            title={statuses[platform]?.message ?? state}
          >
            <span className="platform-dot" data-state={state} />
            {PLATFORM_LABELS[platform]}
          </button>
        )
      })}
      {demoMode && <span className="demo-pill">TRYB DEMO</span>}
      <div className="topbar-actions">
        <button className="icon-btn" title="Mniejsza czcionka" onClick={() => onFontSizeChange(Math.max(11, fontSizePx - 1))}>
          A−
        </button>
        <button className="icon-btn" title="Większa czcionka" onClick={() => onFontSizeChange(Math.min(28, fontSizePx + 1))}>
          A+
        </button>
        <DemoModeToolbarToggle />
        <button className="icon-btn" onClick={onOpenSettings}>
          ⚙ Ustawienia
        </button>
      </div>
    </div>
  )
}

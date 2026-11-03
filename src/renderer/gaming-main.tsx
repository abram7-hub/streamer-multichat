import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatMessage } from '@shared/chat-message'
import type { AppSettings } from '@shared/settings'
import { chatLayout, resolveAppearance } from '@shared/appearance'
import { formatAccelerator, gamingFilterAccepts, gamingOverlayVisible, type GamingOverlayState } from '@shared/gaming'
import { GamingFeed, type GamingFeedItem } from '@shared/gaming-feed'
import { MessageBatcher } from '@shared/message-batcher'
import { ChatList } from './components/ChatList'
import { OverlayRow } from './components/OverlayRow'
import './styles/overlay-shared.css'
import './styles/chat-appearance.css'
import './styles/gaming.css'

const LOW_RESOURCE_BATCH_DELAY_MS = 200

function feedOptions(settings: AppSettings | undefined): { lifetimeMs: number; maxVisible: number } {
  return { lifetimeMs: (settings?.gaming.lifetimeSec ?? 10) * 1000, maxVisible: settings?.gaming.maxVisible ?? 5 }
}

/** Uchwyt zmiany rozmiaru: przezroczystych okien nie da się zmieniać krawędzią, więc robi to main. */
function ResizeGrip() {
  const last = useRef<{ x: number; y: number } | undefined>(undefined)
  const pending = useRef({ dx: 0, dy: 0 })
  const frame = useRef<number | undefined>(undefined)
  const flush = (): void => {
    frame.current = undefined
    const { dx, dy } = pending.current
    pending.current = { dx: 0, dy: 0 }
    if (dx || dy) void window.api.gamingResizeBy({ dx, dy })
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!last.current) return
    pending.current.dx += e.screenX - last.current.x
    pending.current.dy += e.screenY - last.current.y
    last.current = { x: e.screenX, y: e.screenY }
    // Jedno wywołanie na klatkę, tylko w trakcie przeciągania.
    if (frame.current === undefined) frame.current = requestAnimationFrame(flush)
  }
  return (
    <div
      className="gaming-resize-grip"
      title="Zmień rozmiar"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        last.current = { x: e.screenX, y: e.screenY }
      }}
      onPointerMove={onMove}
      onPointerUp={() => {
        last.current = undefined
        flush()
      }}
    />
  )
}

function GamingApp() {
  const [settings, setSettings] = useState<AppSettings | undefined>()
  const [state, setState] = useState<GamingOverlayState | undefined>()
  const [items, setItems] = useState<readonly GamingFeedItem[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const feed = useMemo(() => new GamingFeed(feedOptions(undefined), setItems), [])

  useEffect(() => {
    let disposed = false
    void window.api.getSettings().then((s) => !disposed && setSettings(s))
    void window.api.gamingGetState().then((s) => !disposed && setState(s))
    const batcher = new MessageBatcher<ChatMessage>(
      (flush) => {
        if (settingsRef.current?.ui.lowResourceMode) setTimeout(flush, LOW_RESOURCE_BATCH_DELAY_MS)
        else requestAnimationFrame(flush)
      },
      (batch) => {
        const filter = settingsRef.current?.gaming.filter ?? 'all'
        feed.addMany(batch.filter((m) => gamingFilterAccepts(filter, m)))
      }
    )
    const offs = [
      window.api.onChatMessage((m) => batcher.push(m)),
      window.api.onSettingsChanged(setSettings),
      window.api.onGamingState(setState)
    ]
    return () => {
      disposed = true
      for (const off of offs) off()
      feed.dispose()
    }
  }, [feed])

  useEffect(() => {
    if (settings) feed.setOptions(feedOptions(settings))
  }, [feed, settings])

  const appearance = useMemo(() => (settings ? resolveAppearance(settings.appearance, 'gaming') : undefined), [settings])
  const newestFirst = appearance ? chatLayout(appearance).newestFirst : false
  const ordered = useMemo(() => (newestFirst ? [...items].reverse() : items), [items, newestFirst])
  const editing = state?.mode === 'edit'

  // Bez paska przewijania: przy nadmiarze widoczna zostaje krawędź z najnowszymi wiadomościami.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = newestFirst ? 0 : el.scrollHeight
  }, [ordered, newestFirst])

  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') void window.api.gamingSetMode('locked')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  if (!settings || !appearance) return null
  const g = settings.gaming
  const hidden = !gamingOverlayVisible(g, items.length, editing)
  const style = {
    opacity: g.layerOpacity / 100,
    background: `rgba(10, 10, 14, ${g.backgroundOpacity / 100})`,
    visibility: hidden ? 'hidden' : 'visible',
    '--outline-width': `${g.outlineWidthPx}px`
  } as CSSProperties

  return (
    <div className="gaming-root" data-edit={editing} data-shadow={g.textShadow} data-outline={g.textOutline} style={style}>
      {editing && (
        <div className="gaming-edit-bar">
          <span>Tryb edycji - przeciągnij, aby przesunąć</span>
          <button type="button" onClick={() => void window.api.gamingSetMode('locked')}>
            Zablokuj
          </button>
        </div>
      )}
      <ChatList ref={listRef} className="gaming-list" appearance={appearance} colors={settings.appearance.platformColors} mention={settings.mentions.highlight}>
        {ordered.map((item) => (
          <OverlayRow key={item.key} message={item.message} leaving={item.leaving} />
        ))}
        {editing && items.length === 0 && (
          <div className="gaming-placeholder">Tu pojawią się wiadomości. {state ? `${formatAccelerator(state.hotkey)} - zablokuj` : ''}</div>
        )}
      </ChatList>
      {editing && <ResizeGrip />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GamingApp />
  </StrictMode>
)

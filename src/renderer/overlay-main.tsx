import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatMessage } from '@shared/chat-message'
import type { OverlayView } from '@shared/settings'
import { chatLayout } from '@shared/appearance'
import { MessageBatcher } from '@shared/message-batcher'
import { OverlayRow } from './components/OverlayRow'
import { ChatList } from './components/ChatList'
// UWAGA: celowo NIE importujemy styles/global.css tutaj - ma ono nieprzezroczyste tło na <body>,
// które zepsułoby przezroczystość nakładki OBS (ustawienie "przezroczystość tła"). Ten plik zawiera
// tylko reguły potrzebne współdzielonym komponentom (FragmentsText/PlatformIcon).
import './styles/overlay-shared.css'
import './styles/chat-appearance.css'

const LOW_RESOURCE_BATCH_DELAY_MS = 200

function OverlayApp() {
  const [view, setView] = useState<OverlayView | undefined>()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    void fetch('/overlay/settings')
      .then((r) => r.json())
      .then(setView)

    // Grupuje wiadomości napływające przez WebSocket w krótkie paczki zamiast wywoływać
    // `setMessages` (i pełny re-render nakładki) dla każdej osobno - kluczowe przy dużym ruchu,
    // bo ta sama nakładka jest jednocześnie kompozytowana przez OBS jako Browser Source.
    const batcher = new MessageBatcher<ChatMessage>(
      (flush) => {
        if (viewRef.current?.overlay.lowResourceMode) setTimeout(flush, LOW_RESOURCE_BATCH_DELAY_MS)
        else requestAnimationFrame(flush)
      },
      (batch) => {
        const max = viewRef.current?.overlay.maxMessages ?? 60
        setMessages((prev) => {
          const next = prev.concat(batch)
          if (next.length > max) next.splice(0, next.length - max)
          return next
        })
      }
    )

    // Jedno gniazdo naraz: po odmontowaniu (lub w StrictMode przy podwójnym efekcie) `disposed`
    // blokuje ponowne łączenie, a timer reconnectu jest czyszczony - bez mnożenia połączeń.
    let disposed = false
    let ws: WebSocket | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    const connect = (): void => {
      if (disposed) return
      const socket = new WebSocket(`ws://${window.location.host}/overlay/ws`)
      ws = socket
      socket.onmessage = (event) => {
        let data: { type: 'message'; message: ChatMessage } | { type: 'settings'; view: OverlayView }
        try {
          data = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (data.type === 'message' && data.message) {
          batcher.push(data.message)
        } else if (data.type === 'settings' && data.view) {
          setView(data.view)
        }
      }
      socket.onclose = () => {
        if (disposed || ws !== socket) return
        reconnectTimer = setTimeout(connect, 2000)
      }
    }
    connect()
    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])

  const newestFirst = view ? chatLayout(view.appearance).newestFirst : false
  const visible = useMemo(() => {
    if (!view) return []
    const filtered = messages.filter((m) => view.overlay.enabledPlatforms.includes(m.platform))
    return newestFirst ? filtered.reverse() : filtered
  }, [messages, view, newestFirst])

  // Nakładka nie ma paska przewijania: gdy wiadomości się nie mieszczą, widoczna zostaje krawędź
  // z najnowszymi, a najstarsze są przycinane po przeciwnej stronie.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = newestFirst ? 0 : el.scrollHeight
  }, [visible, newestFirst])

  if (!view) return <></>

  return (
    <div className="overlay-root" style={{ background: `rgba(10,10,14,${view.overlay.backgroundOpacity / 100})` }}>
      <ChatList ref={listRef} className="overlay-list" appearance={view.appearance} colors={view.platformColors} mention={view.mentionHighlight}>
        {visible.map((m) => (
          <OverlayRow key={`${m.platform}:${m.id}`} message={m} />
        ))}
      </ChatList>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)

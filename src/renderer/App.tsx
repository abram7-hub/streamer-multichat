import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityEvent, ChatMessage } from '@shared/chat-message'
import type { Platform } from '@shared/platform'
import { MessageBatcher } from '@shared/message-batcher'
import { resolveAppearance, setAppearanceValue } from '@shared/appearance'
import { useChatStore } from './store/useChatStore'
import { TopBar } from './components/TopBar'
import { ChatWindow } from './components/ChatWindow'
import { ActivityPanel } from './components/ActivityPanel'
import { SettingsWizard } from './components/SettingsWizard'
import { DeviceCodeModal } from './components/DeviceCodeModal'
import { WarningBanners } from './components/WarningBanners'
import { maybePlayMentionSound } from './mention-sound'

interface DevicePrompt {
  platform: Platform
  userCode: string
  verificationUri: string
}

const LOW_RESOURCE_BATCH_DELAY_MS = 200

/**
 * Grupuje szybko napływające wiadomości/zdarzenia w krótkie paczki zamiast wywoływać osobną
 * aktualizację store'u (i pełny przebieg reconciliation Reacta) dla każdej z osobna - patrz
 * `shared/message-batcher.ts`. W Trybie niskiego zużycia zasobów okno grupowania jest dłuższe
 * (200 ms zamiast ~1 klatki), więc interfejs aktualizuje się rzadziej podczas dużego ruchu.
 */
function batchSchedule(flush: () => void): void {
  if (useChatStore.getState().settings?.ui.lowResourceMode) {
    setTimeout(flush, LOW_RESOURCE_BATCH_DELAY_MS)
  } else {
    requestAnimationFrame(flush)
  }
}

const messageBatcher = new MessageBatcher<ChatMessage>(batchSchedule, (batch) => {
  const store = useChatStore.getState()
  store.addMessages(batch)
  maybePlayMentionSound(store.settings?.mentions.sound, batch.some((m) => m.isHighlighted))
})
const activityBatcher = new MessageBatcher<ActivityEvent>(batchSchedule, (batch) =>
  useChatStore.getState().addActivities(batch)
)

export default function App() {
  const messages = useChatStore((s) => s.messages)
  const activity = useChatStore((s) => s.activity)
  const statuses = useChatStore((s) => s.statuses)
  const settings = useChatStore((s) => s.settings)
  const setStatus = useChatStore((s) => s.setStatus)
  const setWatchedChannelStatus = useChatStore((s) => s.setWatchedChannelStatus)
  const setSettings = useChatStore((s) => s.setSettings)

  const [showSettings, setShowSettings] = useState(false)
  const [devicePrompt, setDevicePrompt] = useState<DevicePrompt | undefined>()
  const [initError, setInitError] = useState<string | undefined>()

  useEffect(() => {
    if (!window.api) {
      const message =
        'Most między interfejsem a aplikacją (preload) nie został załadowany. ' +
        'To błąd inicjalizacji Electrona, nie problem z żadną platformą czatu.'
      console.error('[renderer]', message)
      setInitError(message)
      return
    }

    window.api
      .getSettings()
      .then((s) => {
        setSettings(s)
        if (!s.firstRunComplete) setShowSettings(true)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[renderer] nie udało się wczytać ustawień:', err)
        setInitError(message)
      })

    const offMessage = window.api.onChatMessage((m) => messageBatcher.push(m))
    const offStatus = window.api.onStatusUpdate(setStatus)
    // Statusy wysłane, zanim renderer się załadował (np. szybki błąd logowania przy starcie), są
    // dociągane raz z procesu głównego. Nowsze statusy z subskrypcji powyżej mają pierwszeństwo.
    void window.api.getStatuses().then((list) => {
      const current = useChatStore.getState().statuses
      for (const status of list) {
        if ((current[status.platform]?.updatedAt ?? 0) < status.updatedAt) setStatus(status)
      }
    })
    const offActivity = window.api.onActivityEvent((e) => activityBatcher.push(e))
    const offWatchedStatus = window.api.onWatchedChannelStatus(setWatchedChannelStatus)
    const offDevice = window.api.onDeviceCodePrompt((p) => setDevicePrompt(p))
    return () => {
      offMessage()
      offStatus()
      offActivity()
      offWatchedStatus()
      offDevice()
    }
  }, [setStatus, setWatchedChannelStatus, setSettings])

  const enabledPlatforms = settings?.ui.enabledPlatforms ?? []
  const filteredMessages = useMemo(
    () => messages.filter((m) => enabledPlatforms.includes(m.platform)),
    [messages, enabledPlatforms]
  )

  // Platformy, dla których obecnie obserwowany jest więcej niż jeden kanał (główny + wpisy z listy
  // "Kanały") - dopiero wtedy pokazujemy małą etykietę kanału przy wiadomości, żeby dało się
  // rozpoznać źródło (patrz MessageRow). Dla typowego przypadku jednego kanału na platformę etykieta
  // byłaby zbędnym szumem.
  const multiChannelPlatforms = useMemo(() => {
    if (!settings) return new Set<Platform>()
    const counts: Partial<Record<Platform, number>> = {}
    if (settings.twitch.enabled && settings.twitch.channelLogin.trim()) counts.twitch = (counts.twitch ?? 0) + 1
    if (settings.kick.enabled && settings.kick.channelSlug.trim()) counts.kick = (counts.kick ?? 0) + 1
    for (const wc of settings.watchedChannels) {
      if (!wc.enabled || !wc.channel.trim()) continue
      counts[wc.platform] = (counts[wc.platform] ?? 0) + 1
    }
    const result = new Set<Platform>()
    for (const [platform, count] of Object.entries(counts)) {
      if ((count ?? 0) > 1) result.add(platform as Platform)
    }
    return result
  }, [settings])

  const togglePlatform = useCallback(
    async (platform: Platform): Promise<void> => {
      if (!settings) return
      const next = enabledPlatforms.includes(platform)
        ? enabledPlatforms.filter((p) => p !== platform)
        : [...enabledPlatforms, platform]
      const updated = await window.api.updateSettings({ ui: { ...settings.ui, enabledPlatforms: next } })
      setSettings(updated)
    },
    [settings, enabledPlatforms, setSettings]
  )

  const mainAppearance = useMemo(() => (settings ? resolveAppearance(settings.appearance, 'main') : undefined), [settings])

  // Przyciski A-/A+ zmieniają rozmiar czcionki tylko czatu głównego (nadpisanie "main").
  const changeFontSize = useCallback(
    async (px: number): Promise<void> => {
      if (!settings) return
      const appearance = setAppearanceValue(settings.appearance, 'main', 'fontSizePx', px)
      const updated = await window.api.updateSettings({ appearance })
      setSettings(updated)
    },
    [settings, setSettings]
  )

  const ignoreUser = useCallback(
    async (message: ChatMessage): Promise<void> => {
      if (!settings) return
      const platform = message.platform
      const current = settings.ignoreLists[platform]
      const alreadyIgnored = current.users.some(
        (u) => (u.id && u.id === message.author.id) || u.username.toLowerCase() === message.author.username.toLowerCase()
      )
      if (alreadyIgnored) return
      const updated = await window.api.updateSettings({
        ignoreLists: {
          ...settings.ignoreLists,
          [platform]: {
            ...current,
            users: [...current.users, { id: message.author.id, username: message.author.username }]
          }
        }
      })
      setSettings(updated)
    },
    [settings, setSettings]
  )

  if (initError) {
    return (
      <div className="init-error">
        <h2>Nie udało się uruchomić interfejsu</h2>
        <p>{initError}</p>
        <p className="help-text">
          Szczegóły techniczne znajdziesz w konsoli DevTools (Ctrl+Shift+I) oraz w logu terminala, z którego
          uruchomiono aplikację.
        </p>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="init-loading">
        <p>Ładowanie ustawień…</p>
      </div>
    )
  }

  const showJoinPartInChat = settings.twitch.showJoinPartNotifications && settings.twitch.joinPartDisplay === 'chat'
  const showJoinPartPanel = settings.twitch.showJoinPartNotifications && settings.twitch.joinPartDisplay === 'panel'

  return (
    <div className="app">
      <TopBar
        enabledPlatforms={enabledPlatforms}
        statuses={statuses}
        onTogglePlatform={togglePlatform}
        fontSizePx={mainAppearance!.fontSizePx}
        onFontSizeChange={changeFontSize}
        demoMode={settings.demoMode}
        onOpenSettings={() => setShowSettings(true)}
      />
      <WarningBanners statuses={statuses} onOpenSettings={() => setShowSettings(true)} />
      <div className="main-row">
        <ChatWindow
          messages={filteredMessages}
          activity={showJoinPartInChat ? activity : []}
          appearance={mainAppearance!}
          colors={settings.appearance.platformColors}
          mention={settings.mentions.highlight}
          pauseOnHover={settings.ui.pauseOnHover}
          multiChannelPlatforms={multiChannelPlatforms}
          onIgnoreUser={ignoreUser}
        />
        {showJoinPartPanel && <ActivityPanel events={activity} />}
      </div>

      {showSettings && (
        <SettingsWizard
          settings={settings}
          onSettingsChanged={setSettings}
          isFirstRun={!settings.firstRunComplete}
          onFinishFirstRun={async () => {
            const updated = await window.api.updateSettings({ firstRunComplete: true })
            setSettings(updated)
            setShowSettings(false)
          }}
        />
      )}

      {devicePrompt && (
        <DeviceCodeModal
          userCode={devicePrompt.userCode}
          verificationUri={devicePrompt.verificationUri}
          onClose={() => setDevicePrompt(undefined)}
        />
      )}
    </div>
  )
}

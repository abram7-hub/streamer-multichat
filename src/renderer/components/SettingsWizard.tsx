import { useEffect, useState } from 'react'
import type { AppSettings, IgnoreEntry, WatchedChannel } from '@shared/settings'
import { PLATFORMS, PLATFORM_LABELS, type ConnectionState, type Platform } from '@shared/platform'
import type { UserSecretKey } from '@shared/ipc'
import { useChatStore } from '../store/useChatStore'
import { AnimationsPage, AppearancePage, flushAppearanceSave, type AppearanceScope } from './settings/AppearancePages'
import { AboutPage, EventsPage, GeneralPage, OverlayPage, PerformancePage } from './settings/OtherPages'
import { MentionsPage } from './settings/MentionsPage'
import { GamingOverlayPage } from './settings/GamingPage'
import { normalizeKickSlug, parseChannelInput, parseTikTokInput } from '@shared/channel-input'
import { parseYouTubeInput } from '@shared/youtube-input'

type PlatformTab = 'channels' | 'twitch' | 'kick' | 'youtube' | 'tiktok'
type Page =
  | 'general'
  | 'platforms'
  | 'appearance'
  | 'animations'
  | 'events'
  | 'mentions'
  | 'filters'
  | 'obs'
  | 'gaming'
  | 'performance'
  | 'about'

const PAGES: { id: Page; label: string }[] = [
  { id: 'general', label: 'Ogólne' },
  { id: 'platforms', label: 'Platformy' },
  { id: 'appearance', label: 'Wygląd czatu' },
  { id: 'animations', label: 'Animacje' },
  { id: 'events', label: 'Eventy' },
  { id: 'mentions', label: 'Wzmianki' },
  { id: 'filters', label: 'Filtry' },
  { id: 'obs', label: 'OBS Overlay' },
  { id: 'gaming', label: 'Gaming Overlay' },
  { id: 'performance', label: 'Wydajność' },
  { id: 'about', label: 'O aplikacji' }
]

const PLATFORM_TABS: { id: PlatformTab; label: string }[] = [
  { id: 'twitch', label: 'Twitch' },
  { id: 'kick', label: 'Kick' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'channels', label: 'Kanały' }
]

interface TestResult {
  ok: boolean
  message: string
}

export function SettingsWizard({
  settings,
  onSettingsChanged,
  onFinishFirstRun,
  isFirstRun
}: {
  settings: AppSettings
  onSettingsChanged: (settings: AppSettings) => void
  onFinishFirstRun: () => void
  isFirstRun: boolean
}) {
  const [page, setPage] = useState<Page>(isFirstRun ? 'platforms' : 'general')
  const [platformTab, setPlatformTab] = useState<PlatformTab>('twitch')
  const [scope, setScope] = useState<AppearanceScope>('main')
  const [results, setResults] = useState<Partial<Record<Platform, TestResult>>>({})
  const [busy, setBusy] = useState<Platform | undefined>()

  // Niezapisana zmiana wyglądu (odłożony zapis suwaka) trafia do pliku przy zamknięciu ustawień.
  useEffect(() => () => void flushAppearanceSave(), [])

  const patchSection = async <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>): Promise<void> => {
    const updated = await window.api.updateSettings({
      [section]: { ...(settings[section] as object), ...patch }
    } as Partial<AppSettings>)
    onSettingsChanged(updated)
  }

  const test = async (platform: Platform): Promise<void> => {
    setBusy(platform)
    const result = await window.api.testConnection(platform)
    setResults((r) => ({ ...r, [platform]: result }))
    setBusy(undefined)
  }

  const login = async (platform: Platform): Promise<void> => {
    setBusy(platform)
    const result = await window.api.oauthStart(platform)
    if (!result.ok) setResults((r) => ({ ...r, [platform]: { ok: false, message: result.message ?? 'Logowanie nieudane.' } }))
    setBusy(undefined)
  }

  const title = PAGES.find((p) => p.id === page)!.label

  return (
    <div className="modal-backdrop">
      <div className="settings-modal" role="dialog" aria-label="Ustawienia">
        <nav className="settings-sidebar">
          <div className="settings-sidebar-title">{isFirstRun ? 'Konfiguracja' : 'Ustawienia'}</div>
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className="settings-nav-item"
              data-active={page === p.id}
              onClick={(e) => {
                setPage(p.id)
                // W wąskim oknie zakładki są w poziomym pasku - wybrana nie zostaje ucięta przy krawędzi.
                e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
              }}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <header className="settings-header">
            <h2>{title}</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                await flushAppearanceSave()
                onFinishFirstRun()
              }}
            >
              {isFirstRun ? 'Zapisz i uruchom' : 'Zamknij'}
            </button>
          </header>
          <div className="settings-body">
            {page === 'general' && <GeneralPage settings={settings} patchSection={patchSection} />}
            {page === 'platforms' && (
              <>
                <div className="settings-tabs">
                  {PLATFORM_TABS.map((t) => (
                    <button key={t.id} type="button" className="settings-tab" data-active={platformTab === t.id} onClick={() => setPlatformTab(t.id)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {platformTab === 'channels' && <ChannelsTab settings={settings} onSettingsChanged={onSettingsChanged} />}
                {platformTab === 'twitch' && (
                  <TwitchTab
                    settings={settings}
                    patchSection={patchSection}
                    onTest={() => test('twitch')}
                    onLogin={() => login('twitch')}
                    onLogout={() => window.api.oauthLogout('twitch')}
                    result={results.twitch}
                    busy={busy === 'twitch'}
                  />
                )}
                {platformTab === 'kick' && (
                  <KickTab
                    settings={settings}
                    patchSection={patchSection}
                    onTest={() => test('kick')}
                    onLogin={() => login('kick')}
                    onLogout={() => window.api.oauthLogout('kick')}
                    result={results.kick}
                    busy={busy === 'kick'}
                  />
                )}
                {platformTab === 'youtube' && (
                  <YouTubeTab
                    settings={settings}
                    patchSection={patchSection}
                    onTest={() => test('youtube')}
                    onLogin={() => login('youtube')}
                    onLogout={() => window.api.oauthLogout('youtube')}
                    result={results.youtube}
                    busy={busy === 'youtube'}
                  />
                )}
                {platformTab === 'tiktok' && (
                  <TikTokTab
                    settings={settings}
                    patchSection={patchSection}
                    onTest={() => test('tiktok')}
                    result={results.tiktok}
                    busy={busy === 'tiktok'}
                  />
                )}
              </>
            )}
            {page === 'appearance' && <AppearancePage scope={scope} onScopeChange={setScope} />}
            {page === 'animations' && <AnimationsPage scope={scope} onScopeChange={setScope} />}
            {page === 'events' && <EventsPage settings={settings} patchSection={patchSection} />}
            {page === 'mentions' && <MentionsPage settings={settings} patchSection={patchSection} />}
            {page === 'filters' && <IgnoreTab settings={settings} onSettingsChanged={onSettingsChanged} />}
            {page === 'obs' && (
              <OverlayPage
                settings={settings}
                patchSection={patchSection}
                onEditAppearance={() => {
                  setScope('obs')
                  setPage('appearance')
                }}
              />
            )}
            {page === 'gaming' && (
              <GamingOverlayPage
                settings={settings}
                patchSection={patchSection}
                onEditAppearance={() => {
                  setScope('gaming')
                  setPage('appearance')
                }}
                onEditAnimations={() => {
                  setScope('gaming')
                  setPage('animations')
                }}
              />
            )}
            {page === 'performance' && <PerformancePage settings={settings} onSettingsChanged={onSettingsChanged} />}
            {page === 'about' && <AboutPage />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TestResultView({ result }: { result?: TestResult }) {
  if (!result) return null
  return (
    <div className="test-result" data-ok={result.ok}>
      {result.ok ? '✓' : '✗'} {result.message}
    </div>
  )
}

/** Czytelna nazwa stanu połączenia (jednakowa dla wszystkich platform). */
export function connectionStateLabel(state: ConnectionState | undefined): string {
  switch (state) {
    case 'connected':
      return 'Połączono'
    case 'connecting':
    case 'reconnecting':
      return 'Łączenie'
    case 'stream_offline':
      return 'Offline'
    case 'error':
    case 'auth_required':
      return 'Błąd'
    default:
      return 'Wyłączony'
  }
}

/**
 * Wspólny blok "Kanał -> [Połącz] -> Status" dla każdej platformy. "Połącz" zapisuje znormalizowaną
 * nazwę, włącza platformę i wymusza świeże połączenie (poprzednie gniazdo, listenery i timery są
 * czyszczone w procesie głównym - patrz `platform:connect`).
 */
function ChannelConnect({
  platform,
  label,
  placeholder,
  value,
  enabled,
  normalize,
  save
}: {
  platform: Platform
  label: string
  placeholder: string
  value: string
  enabled: boolean
  normalize: (raw: string) => string
  save: (value: string) => Promise<void>
}) {
  const status = useChatStore((s) => s.statuses[platform])
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(value), [value])

  const connect = async (): Promise<void> => {
    const next = normalize(draft)
    if (!next) return
    setBusy(true)
    try {
      if (next !== value || !enabled) await save(next) // zapis ustawień sam uruchamia połączenie
      else await window.api.connectPlatform(platform)
      setDraft(next)
    } finally {
      setBusy(false)
    }
  }

  const state = enabled ? status?.state : 'idle'
  return (
    <div className="field">
      <label>{label}</label>
      <div className="row">
        <input
          style={{ flex: 1 }}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void connect()
          }}
        />
        <button className="btn btn-primary" onClick={() => void connect()} disabled={busy || !normalize(draft)}>
          Połącz
        </button>
      </div>
      <div className="status-line">
        <span className="platform-dot" data-state={state ?? 'idle'} />
        <span>Status: {connectionStateLabel(state)}</span>
        {enabled && status?.message && <span className="status-line-text">— {status.message}</span>}
      </div>
    </div>
  )
}

/** Pole sekretu: wartość nigdy nie wraca do renderera, pokazujemy tylko, czy jest zapisana. */
function SecretField({ secretKey, label, placeholder }: { secretKey: UserSecretKey; label: string; placeholder: string }) {
  const [draft, setDraft] = useState('')
  const [hasSecret, setHasSecret] = useState(false)
  useEffect(() => {
    void window.api.hasSecret(secretKey).then(setHasSecret)
  }, [secretKey])
  const persist = async (): Promise<void> => {
    if (!draft.trim()) return
    const res = await window.api.setSecret({ key: secretKey, value: draft })
    if (res.ok) {
      setHasSecret(true)
      setDraft('')
    }
  }
  return (
    <div className="field">
      <label>
        {label} {hasSecret && '(zapisany, zaszyfrowany)'}
      </label>
      <input
        type="password"
        autoComplete="off"
        placeholder={hasSecret ? '••••••••' : placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void persist()}
      />
    </div>
  )
}

function TwitchTab({
  settings,
  patchSection,
  onTest,
  onLogin,
  onLogout,
  result,
  busy
}: {
  settings: AppSettings
  patchSection: <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>
  onTest: () => void
  onLogin: () => void
  onLogout: () => void
  result?: TestResult
  busy: boolean
}) {
  const t = settings.twitch
  return (
    <div>
      <ChannelConnect
        platform="twitch"
        label="Kanał"
        placeholder="nazwa kanału albo twitch.tv/…"
        value={t.channelLogin}
        enabled={t.enabled}
        normalize={parseChannelInput}
        save={(channelLogin) => patchSection('twitch', { channelLogin, enabled: true })}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={t.enabled} onChange={(e) => patchSection('twitch', { enabled: e.target.checked })} />
        Włącz Twitcha
      </label>
      <p className="help-text">
        Czat dowolnego kanału działa w pełni anonimowo — logowanie NIE jest wymagane do wiadomości,
        koloru nicku, /me, emotek 7TV/BTTV ani publicznych komunikatów o subach, giftach, raidach i
        Bitsach. Logowanie (opcjonalne) włącza obrazki odznak (na wszystkich kanałach) oraz zdarzenia
        EventSub Twojego kanału (Channel Points, followy, raid wychodzący, Hype Train). 1. Utwórz
        aplikację na dev.twitch.tv/console/apps (najlepiej typu „Public” — wtedy Client Secret nie jest
        potrzebny). 2. Skopiuj Client ID poniżej. 3. Kliknij „Zaloguj” — otworzy się przeglądarka z kodem
        do wpisania (Device Code Flow, bez podawania hasła w aplikacji).
      </p>
      <div className="field">
        <label>Client ID</label>
        <input defaultValue={t.clientId} onBlur={(e) => patchSection('twitch', { clientId: e.target.value.trim() })} />
      </div>
      <SecretField secretKey="twitch.clientSecret" label="Client Secret (tylko dla aplikacji typu „Confidential”)" placeholder="opcjonalnie" />
      <p className="help-text">
        Jeśli aplikacja w Twitch Developer Console ma typ „Confidential”, Twitch nie pozwala odświeżyć
        tokenu bez Client Secret — po ~4 godzinach Channel Points i inne zdarzenia przestałyby działać.
        Wpisz go wtedy tutaj (jest szyfrowany i nigdy nie trafia do interfejsu).
      </p>
      <div className="row">
        <button className="btn btn-primary" onClick={onLogin} disabled={busy}>
          Zaloguj
        </button>
        <button className="btn btn-danger" onClick={onLogout} disabled={busy}>
          Wyloguj
        </button>
        <button className="btn" onClick={onTest} disabled={busy}>
          Testuj połączenie
        </button>
      </div>
      <TestResultView result={result} />

      <label className="checkbox-row" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={t.seventvEnabled}
          onChange={(e) => patchSection('twitch', { seventvEnabled: e.target.checked })}
        />
        Emotki 7TV (globalne + kanałowe)
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={t.bttvEnabled}
          onChange={(e) => patchSection('twitch', { bttvEnabled: e.target.checked })}
        />
        Emotki BTTV (globalne + kanałowe)
      </label>
      <p className="help-text">
        Emotki 7TV i BTTV działają bez logowania — również na kanałach z listy „Kanały”. Natywne
        emotki Twitcha mają zawsze pierwszeństwo; przy kolizji nazw: 7TV kanału → BTTV kanału →
        7TV globalne → BTTV globalne.
      </p>

    </div>
  )
}

function KickTab({
  settings,
  patchSection,
  onTest,
  onLogin,
  onLogout,
  result,
  busy
}: {
  settings: AppSettings
  patchSection: <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>
  onTest: () => void
  onLogin: () => void
  onLogout: () => void
  result?: TestResult
  busy: boolean
}) {
  const k = settings.kick
  const [tunnel, setTunnel] = useState<{ running: boolean; url?: string }>({ running: false })
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const [tunnelMessage, setTunnelMessage] = useState<string>()

  useEffect(() => {
    void window.api.kickTunnelStatus().then(setTunnel)
    return window.api.onKickTunnelStatusChanged(setTunnel)
  }, [])

  const startTunnel = async (): Promise<void> => {
    setTunnelBusy(true)
    setTunnelMessage(undefined)
    const res = await window.api.kickTunnelStart()
    setTunnelMessage(res.message)
    setTunnelBusy(false)
  }

  return (
    <div>
      <ChannelConnect
        platform="kick"
        label="Kanał"
        placeholder="nazwa kanału albo kick.com/…"
        value={k.channelSlug}
        enabled={k.enabled}
        normalize={normalizeKickSlug}
        save={(channelSlug) => patchSection('kick', { channelSlug, enabled: true })}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={k.enabled} onChange={(e) => patchSection('kick', { enabled: e.target.checked })} />
        Włącz Kicka
      </label>
      <p className="help-text">
        Publiczny czat dowolnego kanału Kicka działa bez logowania i bez webhooka (ten sam strumień, który
        Kick wysyła do przeglądarki każdego widza). Uwaga: w adresie kanału Kick zamienia „_” na „-”
        (użytkownik „Test_Nick” ma kanał „test-nick”) — aplikacja robi to automatycznie.
      </p>
      <details>
        <summary className="help-text">Opcjonalnie: autoryzowany webhook Kicka (zaawansowane)</summary>
      <p className="help-text">
        Niepotrzebny do czytania czatu. 1. W ustawieniach konta Kick włącz weryfikację dwuetapową (2FA), potem
        wejdź w zakładkę „Developer”. 2. Utwórz aplikację, jako redirect URI wpisz dokładnie:{' '}
        <code>http://127.0.0.1:{k.oauthCallbackPort}/callback</code>. 3. Skopiuj Client ID i Client Secret poniżej.
        4. Uruchom tunel Cloudflare, wklej wygenerowany adres jako webhook URL w panelu Kick (Developer →
        Webhooks) i włącz zdarzenie „chat.message.sent”. Wiadomości z webhooka i z publicznego czatu nie
        dublują się.
      </p>
      <div className="field">
        <label>Client ID</label>
        <input defaultValue={k.clientId} onBlur={(e) => patchSection('kick', { clientId: e.target.value.trim() })} />
      </div>
      <SecretField secretKey="kick.clientSecret" label="Client Secret" placeholder="wklej Client Secret" />
      <div className="field">
        <label>Webhook URL</label>
        <input
          defaultValue={k.webhookUrl}
          placeholder="https://xxxxxxxx.trycloudflare.com/kick/webhook"
          onBlur={(e) => patchSection('kick', { webhookUrl: e.target.value.trim() })}
        />
        <div className="help-text">
          Wypełniane automatycznie po uruchomieniu tunelu poniżej. Gdy skonfigurujesz stały tunel Cloudflare
          (np. na własnej domenie), możesz wkleić tu jego adres ręcznie — bez ponownego budowania aplikacji.
        </div>
      </div>

      <div className="field">
        <label>Kreator tunelu Cloudflare (dla webhooka)</label>
        <div className="row">
          <button className="btn" onClick={startTunnel} disabled={tunnelBusy || tunnel.running}>
            {tunnel.running ? 'Tunel działa' : 'Uruchom tunel'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              void window.api.kickTunnelStop()
              setTunnel({ running: false })
            }}
            disabled={!tunnel.running}
          >
            Zatrzymaj tunel
          </button>
        </div>
        {tunnel.url && <div className="help-text">Publiczny URL: {tunnel.url}/kick/webhook (wpisz to w panelu Kick)</div>}
        {tunnelMessage && <div className="test-result" data-ok={tunnel.running}>{tunnelMessage}</div>}
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={onLogin} disabled={busy}>
          Zaloguj
        </button>
        <button className="btn btn-danger" onClick={onLogout} disabled={busy}>
          Wyloguj
        </button>
      </div>
      </details>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onTest} disabled={busy}>
          Testuj połączenie
        </button>
      </div>
      <TestResultView result={result} />
    </div>
  )
}

function YouTubeTab({
  settings,
  patchSection,
  onTest,
  onLogin,
  onLogout,
  result,
  busy
}: {
  settings: AppSettings
  patchSection: <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>
  onTest: () => void
  onLogin: () => void
  onLogout: () => void
  result?: TestResult
  busy: boolean
}) {
  const y = settings.youtube
  return (
    <div>
      <ChannelConnect
        platform="youtube"
        label="Kanał / @handle / URL"
        placeholder="@handle, youtube.com/@…, UC…, albo URL transmisji"
        value={y.channelHandle}
        enabled={y.enabled}
        normalize={(raw) => (parseYouTubeInput(raw) ? raw.trim() : '')}
        save={(channelHandle) => patchSection('youtube', { channelHandle, enabled: true })}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={y.enabled} onChange={(e) => patchSection('youtube', { enabled: e.target.checked })} />
        Włącz YouTube
      </label>

      <h4 style={{ margin: '12px 0 4px' }}>Publiczny podgląd (bez logowania)</h4>
      <p className="help-text">
        Do czytania publicznego czatu dowolnej transmisji wystarczy klucz API: Google Cloud Console → włącz
        „YouTube Data API v3” → Dane logowania → Utwórz → Klucz interfejsu API (zalecane: ogranicz go do
        YouTube Data API v3). Limit darmowy: 10 000 jednostek/dobę — aplikacja sprawdza, czy kanał jest
        na żywo, co 90 s (~2 jednostki), a czat odbiera strumieniowo (bez odpytywania co sekundę).
      </p>
      <SecretField secretKey="youtube.apiKey" label="Klucz API YouTube Data API v3" placeholder="AIza…" />

      <details>
        <summary className="help-text">Opcjonalnie: logowanie kontem Google (OAuth)</summary>
        <p className="help-text">
          Niepotrzebne do podglądu czatu, jeśli wpisano klucz API. Bez klucza te same publiczne zapytania
          idą z tokenem zalogowanego konta. Uwaga: jeśli ekran zgody OAuth jest w trybie „Testowanie”, Google
          unieważnia sesję po 7 dniach — wtedy trzeba logować się ponownie (klucz API tego problemu nie ma).
          1. Skonfiguruj ekran zgody OAuth. 2. Utwórz dane logowania OAuth typu „Desktop app”. 3. Skopiuj
          Client ID i Client Secret poniżej.
        </p>
        <div className="field">
          <label>Client ID</label>
          <input defaultValue={y.clientId} onBlur={(e) => patchSection('youtube', { clientId: e.target.value.trim() })} />
        </div>
        <SecretField secretKey="youtube.clientSecret" label="Client Secret" placeholder="wklej Client Secret" />
        <div className="row">
          <button className="btn btn-primary" onClick={onLogin} disabled={busy}>
            Zaloguj (Google)
          </button>
          <button className="btn btn-danger" onClick={onLogout} disabled={busy}>
            Wyloguj
          </button>
        </div>
      </details>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={onTest} disabled={busy}>
          Testuj połączenie
        </button>
      </div>
      <TestResultView result={result} />
    </div>
  )
}

function TikTokTab({
  settings,
  patchSection,
  onTest,
  result,
  busy
}: {
  settings: AppSettings
  patchSection: <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>
  onTest: () => void
  result?: TestResult
  busy: boolean
}) {
  const tk = settings.tiktok
  return (
    <div>
      <ChannelConnect
        platform="tiktok"
        label="@username"
        placeholder="@nazwa albo tiktok.com/@nazwa"
        value={tk.uniqueId}
        enabled={tk.enabled}
        normalize={parseTikTokInput}
        save={(uniqueId) => patchSection('tiktok', { uniqueId, enabled: true })}
      />
      <label className="checkbox-row">
        <input type="checkbox" checked={tk.enabled} onChange={(e) => patchSection('tiktok', { enabled: e.target.checked })} />
        Włącz TikTok
      </label>
      <p className="help-text">
        Działa dla dowolnego użytkownika po samej nazwie — bez logowania, cookies ani sessionid. Gdy osoba nie
        jest na żywo, status pokaże „Offline” i aplikacja sprawdza ponownie co 30 s. Biblioteka
        tiktok-live-connector jest nieoficjalna i korzysta z serwera podpisującego Euler Stream (darmowy limit
        współdzielony ze wszystkimi). Jeśli połączenia zawodzą z błędem limitu, załóż darmowe konto na
        eulerstream.com i wklej klucz API poniżej.
      </p>
      <SecretField secretKey="tiktok.eulerApiKey" label="Euler Stream API Key (opcjonalnie)" placeholder="opcjonalny klucz API" />
      <div className="row">
        <button className="btn" onClick={onTest} disabled={busy}>
          Testuj połączenie
        </button>
      </div>
      <TestResultView result={result} />
    </div>
  )
}

function IgnoreTab({
  settings,
  onSettingsChanged
}: {
  settings: AppSettings
  onSettingsChanged: (settings: AppSettings) => void
}) {
  const [drafts, setDrafts] = useState<Partial<Record<Platform, string>>>({})

  const patchIgnore = async (platform: Platform, users: IgnoreEntry[], enabled?: boolean): Promise<void> => {
    const current = settings.ignoreLists[platform]
    const updated = await window.api.updateSettings({
      ignoreLists: {
        ...settings.ignoreLists,
        [platform]: { enabled: enabled ?? current.enabled, users }
      }
    })
    onSettingsChanged(updated)
  }

  const addUser = async (platform: Platform): Promise<void> => {
    const name = (drafts[platform] ?? '').trim()
    if (!name) return
    const current = settings.ignoreLists[platform]
    if (current.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
      setDrafts((d) => ({ ...d, [platform]: '' }))
      return
    }
    await patchIgnore(platform, [...current.users, { username: name }])
    setDrafts((d) => ({ ...d, [platform]: '' }))
  }

  const removeUser = async (platform: Platform, entry: IgnoreEntry): Promise<void> => {
    const current = settings.ignoreLists[platform]
    await patchIgnore(
      platform,
      current.users.filter((u) => u !== entry)
    )
  }

  return (
    <div>
      <p className="help-text">
        Wiadomości ignorowanych użytkowników nie pojawiają się ani w głównym czacie, ani w nakładce OBS — dla
        każdej platformy osobno. Możesz też kliknąć prawym przyciskiem myszy na nick w czacie, żeby dodać go do
        listy jednym kliknięciem.
      </p>
      {PLATFORMS.map((platform) => {
        const list = settings.ignoreLists[platform]
        return (
          <div key={platform} className="field" style={{ marginBottom: 18 }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={list.enabled}
                onChange={(e) => void patchIgnore(platform, list.users, e.target.checked)}
              />
              {PLATFORM_LABELS[platform]} — filtrowanie {list.enabled ? 'włączone' : 'wyłączone'}
            </label>
            <div className="row">
              <input
                placeholder="dodaj nick…"
                value={drafts[platform] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [platform]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addUser(platform)
                }}
              />
              <button className="btn" onClick={() => void addUser(platform)}>
                Dodaj
              </button>
            </div>
            <div className="ignore-chip-list">
              {list.users.map((entry) => (
                <span key={entry.id ?? entry.username} className="ignore-chip">
                  {entry.username}
                  <button onClick={() => void removeUser(platform, entry)} title="Usuń z listy">
                    ×
                  </button>
                </span>
              ))}
              {list.users.length === 0 && <span className="help-text">Brak ignorowanych.</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ChannelsTab({
  settings,
  onSettingsChanged
}: {
  settings: AppSettings
  onSettingsChanged: (settings: AppSettings) => void
}) {
  const statuses = useChatStore((s) => s.watchedChannelStatuses)
  const [platform, setPlatform] = useState<'twitch' | 'kick'>('twitch')
  const [draft, setDraft] = useState('')

  const save = async (next: WatchedChannel[]): Promise<void> => {
    onSettingsChanged(await window.api.updateSettings({ watchedChannels: next }))
  }

  const addChannel = async (): Promise<void> => {
    const channel = platform === 'kick' ? normalizeKickSlug(draft) : parseChannelInput(draft)
    if (!channel) return
    const exists = settings.watchedChannels.some((c) => c.platform === platform && c.channel === channel)
    if (exists) {
      setDraft('')
      return
    }
    const entry: WatchedChannel = { id: crypto.randomUUID(), platform, channel, enabled: true }
    await save([...settings.watchedChannels, entry])
    setDraft('')
  }

  const updateChannel = async (id: string, patch: Partial<WatchedChannel>): Promise<void> => {
    await save(settings.watchedChannels.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const removeChannel = async (id: string): Promise<void> => {
    await save(settings.watchedChannels.filter((c) => c.id !== id))
  }

  return (
    <div>
      <p className="help-text">
        Obserwuj czat dowolnego publicznego kanału Twitcha lub Kicka BEZ logowania — niezależnie od
        głównej integracji skonfigurowanej w zakładkach Twitch/Kick powyżej. Możesz dodać wiele
        kanałów naraz, również tej samej platformy. Wiadomości trafiają do wspólnego czatu w
        kolejności otrzymania.
      </p>
      <p className="help-text">
        Twitch: pełny odczyt (kolor nicku, /me, emotki) działa w 100% anonimowo przez publiczne IRC.{' '}
        Kick: rozpoznanie kanału po nazwie może czasem zawieść z powodu zabezpieczeń Kicka (Cloudflare)
        — jeśli status pokaże błąd, spróbuj podać ręcznie „ID czatu” poniżej (widoczne np. w kodzie
        źródłowym strony kanału jako <code>chatroom.id</code>).
      </p>
      <div className="row">
        <select value={platform} onChange={(e) => setPlatform(e.target.value as 'twitch' | 'kick')}>
          <option value="twitch">Twitch</option>
          <option value="kick">Kick</option>
        </select>
        <input
          placeholder="nazwa kanału albo adres URL…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addChannel()
          }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-primary" onClick={() => void addChannel()}>
          Dodaj kanał
        </button>
      </div>

      <div className="channel-list">
        {settings.watchedChannels.length === 0 && <p className="help-text">Brak obserwowanych kanałów.</p>}
        {settings.watchedChannels.map((c) => {
          const status = statuses[c.id]
          return (
            <div key={c.id} className="channel-row">
              <span className="platform-dot" data-state={c.enabled ? (status?.state ?? 'connecting') : 'idle'} />
              <span className="channel-row-label">
                [{PLATFORM_LABELS[c.platform]}] {c.channel}
              </span>
              {c.platform === 'kick' && (
                <input
                  className="channel-chatroom-id"
                  type="number"
                  placeholder="ID czatu (opcjonalnie)"
                  defaultValue={c.kickChatroomId ?? ''}
                  onBlur={(e) => {
                    const value = e.target.value.trim()
                    void updateChannel(c.id, { kickChatroomId: value ? Number(value) : undefined })
                  }}
                />
              )}
              <label className="checkbox-row">
                <input type="checkbox" checked={c.enabled} onChange={(e) => void updateChannel(c.id, { enabled: e.target.checked })} />
                aktywny
              </label>
              <button className="btn btn-danger" onClick={() => void removeChannel(c.id)}>
                Usuń
              </button>
              {status?.message && (
                <div className="test-result" data-ok={status.state === 'connected'} style={{ width: '100%' }}>
                  {status.message}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

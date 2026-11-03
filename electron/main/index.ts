import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, shell, Menu } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import type { ActivityEvent, ChatMessage } from '../../shared/chat-message'
import type { AdapterStatus, Platform } from '../../shared/platform'
import { isSafeExternalUrl } from '../../shared/external-url'
import { overlayView } from '../../shared/settings'
import { buildVisualExport, parseVisualImport } from '../../shared/visual-export'
import { getSettings, updateSettings, updateSection } from './settings-store'
import { loadSecret, saveSecret, USER_ENTERABLE_SECRET_KEYS } from './secure-store'
import { messageBus } from './message-bus'
import { MentionDetector } from './highlight'
import { platformNicks } from '../../shared/mentions'
import { isAuthorIgnored, isIgnored } from './ignore-filter'
import { makeStatus } from './adapters/types'
import { TwitchAdapter } from './adapters/twitch'
import { TwitchIrcClient } from './adapters/twitch/irc-client'
import { EmoteRegistry } from './adapters/twitch/emote-registry'
import { KickAdapter } from './adapters/kick'
import { KickPublicChatClient } from './adapters/kick/public-chat'
import { YouTubeAdapter } from './adapters/youtube'
import { TikTokAdapter } from './adapters/tiktok'
import { DemoAdapter } from './adapters/demo'
import { ConnectionModeController } from './connection-mode'
import { DiagnosticsLog } from './diagnostics'
import { GamingOverlayManager, type OverlayWindowLike } from './gaming-overlay'
import type { GamingMode, GamingOverlayState, GamingWindowBounds } from '../../shared/gaming'
import { isValidSecretInput, sanitizeSettingsPatch } from './ipc-validation'
import { OverlayServer } from './server/overlay-server'
import { WatchedChannelsManager } from './watched-channels'

process.on('uncaughtException', (err) => {
  console.error('[main] nieprzechwycony wyjątek:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] nieobsłużone odrzucenie obietnicy:', reason)
})

let mainWindow: BrowserWindow | undefined
const overlayServer = new OverlayServer()

// Współdzielone, anonimowe klienty - JEDNO połączenie IRC/Pusher na aplikację, używane zarówno
// przez główną skonfigurowaną integrację, jak i przez dowolną liczbę wpisów z listy "Kanały"
// (patrz watched-channels.ts i komentarze w irc-client.ts / public-chat.ts).
const twitchIrcClient = new TwitchIrcClient()
const kickPublicChatClient = new KickPublicChatClient()

// Wspólny cache emotek 7TV/BTTV dla wszystkich kanałów Twitcha (główny + lista "Kanały") - działa
// bez logowania, bo numeryczne ID kanału przychodzi w tagach anonimowego IRC (room-id).
const emoteRegistry = new EmoteRegistry({
  isEnabled: (provider) => (provider === 'seventv' ? getSettings().twitch.seventvEnabled : getSettings().twitch.bttvEnabled),
  preferStatic: () => getSettings().ui.lowResourceMode
})
twitchIrcClient.setMessageEnricher((message, roomId) => emoteRegistry.enrich(message, roomId))
// Prefetch list emotek zaraz po wejściu na kanał (ROOMSTATE), zanim przyjdzie pierwsza wiadomość.
twitchIrcClient.setRoomIdListener((_channel, roomId) => {
  emoteRegistry.ensureChannel(roomId)
  twitchAdapter.onRoomId(roomId)
})

const twitchAdapter = new TwitchAdapter(
  () => getSettings().twitch,
  {
    onMessage: publishMessage,
    onStatus: (state, message, channel, warning) => publishStatus('twitch', state, message, channel, warning)
  },
  (prompt) => sendToMainWindow('oauth:device-code', { platform: 'twitch', ...prompt }),
  twitchIrcClient,
  publishActivity,
  emoteRegistry
)

const kickAdapter = new KickAdapter(
  () => getSettings().kick,
  {
    onMessage: publishMessage,
    onStatus: (state, message, channel, warning) => publishStatus('kick', state, message, channel, warning)
  },
  kickPublicChatClient
)

const watchedChannelsManager = new WatchedChannelsManager(
  twitchIrcClient,
  kickPublicChatClient,
  publishMessage,
  (id, state, message) => sendToMainWindow('watched-channel:status', { id, state, message })
)

const youtubeAdapter = new YouTubeAdapter(() => getSettings().youtube, {
  onMessage: publishMessage,
  onStatus: (state, message, channel) => publishStatus('youtube', state, message, channel)
})

const tiktokAdapter = new TikTokAdapter(() => getSettings().tiktok, {
  onMessage: publishMessage,
  onStatus: (state, message, channel) => publishStatus('tiktok', state, message, channel)
})

const demoAdapter = new DemoAdapter(
  {
    onMessage: publishMessage,
    onStatus: (state, message) => {
      for (const platform of ['twitch', 'kick', 'youtube', 'tiktok'] as const) {
        publishStatus(platform, state, message, 'demo')
      }
    }
  },
  () => {
    const s = getSettings()
    const nicks = platformNicks(s)
    return s.ui.highlightNick || nicks.twitch || nicks.kick || nicks.youtube || nicks.tiktok || s.mentions.keywords[0] || ''
  }
)

const mentionDetector = new MentionDetector()

function sendToMainWindow<C extends string>(channel: C, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function publishMessage(message: ChatMessage): void {
  const settings = getSettings()
  if (message.event && message.platform === 'twitch' && !settings.twitch.showStreamEvents) return
  // Zdarzenia anonimowych gifterów nie mają prawdziwego autora - nie filtrujemy ich po liście ignorowanych.
  if (!message.event?.anonymous && isAuthorIgnored(message.author, message.platform, settings.ignoreLists)) return
  const patched = mentionDetector.apply(message, settings)
  if (!messageBus.publish(patched)) return
  sendToMainWindow('chat:message', patched)
  gamingOverlay?.send('chat:message', patched)
  overlayServer.broadcast(patched)
}

function publishActivity(event: ActivityEvent): void {
  const ignoreLists = getSettings().ignoreLists
  if (isIgnored({ id: event.userId ?? 'unknown', username: event.username }, event.platform, ignoreLists)) return
  sendToMainWindow('activity:event', event)
}

const lastStatuses = new Map<Platform, AdapterStatus>()

function publishStatus(
  platform: Platform,
  state: Parameters<typeof makeStatus>[1],
  message?: string,
  channel?: string,
  warning?: string
): void {
  const status = makeStatus(platform, state, message, channel, warning)
  lastStatuses.set(platform, status)
  messageBus.publishStatus(status)
  sendToMainWindow('status:update', status)
}

async function stopAllRealAdapters(): Promise<void> {
  await Promise.all([twitchAdapter.stop(), kickAdapter.stop(), youtubeAdapter.stop(), tiktokAdapter.stop()])
  watchedChannelsManager.sync([])
}

function startRealAdapters(): void {
  const settings = getSettings()
  if (settings.twitch.enabled) void twitchAdapter.start()
  if (settings.kick.enabled) void kickAdapter.start()
  if (settings.youtube.enabled) void youtubeAdapter.start()
  if (settings.tiktok.enabled) void tiktokAdapter.start()
  watchedChannelsManager.sync(settings.watchedChannels)
}

const connectionMode = new ConnectionModeController({
  isDemoMode: () => getSettings().demoMode,
  startDemo: () => demoAdapter.start(),
  stopDemo: () => demoAdapter.stop(),
  stopRealAdapters: stopAllRealAdapters,
  startRealAdapters
})

function applyConnectionMode(): Promise<void> {
  return connectionMode.apply()
}

const diagnostics = new DiagnosticsLog(() => join(app.getPath('userData'), 'logs', 'diagnostics.log'))

// Awarie procesów pomocniczych Chromium (GPU, usługa sieciowa itd.) nie są widoczne z poziomu okna.
app.on('child-process-gone', (_event, details) => {
  diagnostics.record('child-process-gone', {
    type: details.type,
    serviceName: details.serviceName,
    reason: details.reason,
    exitCode: details.exitCode
  })
})

function isAppUrl(url: string): boolean {
  const devServer = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  try {
    if (devServer) return new URL(url).origin === new URL(devServer).origin
    return url.startsWith(`${pathToFileURL(join(__dirname, '../renderer')).href}/`)
  } catch {
    return false
  }
}

/** Okna z dostępem do API preloadu nigdy nie otwierają w sobie obcych stron. */
function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Link bez target=_blank otwiera się w przeglądarce systemowej (tylko https), nie w oknie aplikacji.
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
}

// Preload budowany jako CommonJS (out/preload/index.cjs, patrz electron.vite.config.ts) - tylko taki
// format działa w sandboxie; nazwa pliku musi się zgadzać z wynikiem builda.
const secureWebPreferences = (): Electron.WebPreferences => ({
  preload: join(__dirname, '../preload/index.cjs'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false
})

let gamingOverlay: GamingOverlayManager | undefined

/** Przezroczyste okno Gaming Overlay - ten sam preload i te same zabezpieczenia co okno główne. */
function createGamingWindow(bounds: GamingWindowBounds): OverlayWindowLike {
  const win = new BrowserWindow({
    ...bounds,
    title: 'Gaming Overlay',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: secureWebPreferences()
  })
  hardenWebContents(win.webContents)
  win.webContents.on('render-process-gone', (_event, details) => {
    diagnostics.record('render-process-gone', { window: 'gaming', reason: details.reason, exitCode: details.exitCode })
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/gaming.html`)
  else void win.loadFile(join(__dirname, '../renderer/gaming.html'))
  return {
    setIgnoreMouseEvents: (ignore, options) => win.setIgnoreMouseEvents(ignore, options),
    setFocusable: (focusable) => win.setFocusable(focusable),
    setSkipTaskbar: (skip) => win.setSkipTaskbar(skip),
    setMovable: (movable) => win.setMovable(movable),
    setAlwaysOnTop: (flag, level) => win.setAlwaysOnTop(flag, level),
    setBounds: (b) => win.setBounds(b),
    getBounds: () => win.getBounds(),
    showInactive: () => win.showInactive(),
    focus: () => win.focus(),
    moveTop: () => win.moveTop(),
    close: () => win.close(),
    isDestroyed: () => win.isDestroyed(),
    on: (event, listener) => void win.on(event, listener),
    send: (channel, payload) => {
      if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
}

function createGamingOverlayManager(): GamingOverlayManager {
  const toInfo = (d: Electron.Display): { id: number; workArea: GamingWindowBounds } => ({ id: d.id, workArea: d.workArea })
  return new GamingOverlayManager({
    createWindow: createGamingWindow,
    screen: {
      getAllDisplays: () => screen.getAllDisplays().map(toInfo),
      getPrimaryDisplay: () => toInfo(screen.getPrimaryDisplay()),
      getDisplayMatching: (b) => toInfo(screen.getDisplayMatching(b)),
      on: (event, listener) => void screen.on(event as 'display-added', listener)
    },
    shortcuts: {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    },
    getSettings: () => getSettings().gaming,
    saveSettings: (patch) => void updateSection('gaming', patch),
    onStateChange: (state) => sendToMainWindow('gaming:state', state)
  })
}

/** Po zmianie ustawień: stan okna nakładki i jej widok (wygląd, filtr, limity). */
function syncGamingOverlay(settings = getSettings()): void {
  gamingOverlay?.sync()
  gamingOverlay?.send('settings:changed', settings)
  sendToMainWindow('gaming:state', gamingState())
}

function gamingState(): GamingOverlayState {
  return gamingOverlay?.state() ?? { open: false, mode: 'locked', hotkey: getSettings().gaming.editHotkey, hotkeyRegistered: false }
}

function createMainWindow(): void {
  const ui = getSettings().ui
  mainWindow = new BrowserWindow({
    width: ui.windowWidth,
    height: ui.windowHeight,
    x: ui.windowX,
    y: ui.windowY,
    minWidth: 320,
    minHeight: 480,
    backgroundColor: '#0e0e12',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences()
  })
  Menu.setApplicationMenu(null)

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[renderer] błąd ładowania preload (${preloadPath}):`, error)
    diagnostics.record('preload-error', { error: error.name })
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[renderer] nie udało się załadować strony (${validatedURL}): ${errorDescription} (${errorCode})`)
    diagnostics.record('did-fail-load', { errorCode, description: errorDescription, mainFrame: isMainFrame })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] proces renderera zakończył się nieoczekiwanie:', details.reason)
    diagnostics.record('render-process-gone', { reason: details.reason, exitCode: details.exitCode })
  })
  mainWindow.on('unresponsive', () => diagnostics.record('window-unresponsive'))
  mainWindow.on('responsive', () => diagnostics.record('window-responsive'))
  mainWindow.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level === 'warning' || level === 'error') console.error(`[renderer console] ${message} (${sourceId}:${lineNumber})`)
  })

  if (is.dev) mainWindow.webContents.openDevTools({ mode: 'detach' })

  const persistBounds = (): void => {
    const bounds = mainWindow?.getBounds()
    if (!bounds) return
    updateSection('ui', { windowWidth: bounds.width, windowHeight: bounds.height, windowX: bounds.x, windowY: bounds.y })
  }
  mainWindow.on('resized', persistBounds)
  mainWindow.on('moved', persistBounds)
  mainWindow.on('closed', () => {
    mainWindow = undefined
    // Nakładka nie może utrzymywać aplikacji przy życiu po zamknięciu okna głównego.
    gamingOverlay?.close()
  })

  hardenWebContents(mainWindow.webContents)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, rawPatch: unknown) => {
    const patch = sanitizeSettingsPatch(rawPatch)
    if (patch.gaming) {
      const current = getSettings().gaming
      patch.gaming = { ...patch.gaming, bounds: current.bounds, displayId: current.displayId }
    }
    const updated = updateSettings(patch)
    emoteRegistry.invalidate() // włączenie/wyłączenie 7TV/BTTV albo trybu statycznych emotek
    // Nakładka OBS na żywo, bez odświeżania strony w OBS.
    if (patch.overlay || patch.appearance || patch.mentions) overlayServer.broadcastSettings(overlayView(updated))
    syncGamingOverlay(updated)
    void applyConnectionMode()
    return updated
  })

  ipcMain.handle('platform:test-connection', async (_e, platform: Platform) => {
    switch (platform) {
      case 'twitch':
        return twitchAdapter.testConnection()
      case 'kick':
        return kickAdapter.testConnection()
      case 'youtube':
        return youtubeAdapter.testConnection()
      case 'tiktok':
        return tiktokAdapter.testConnection()
    }
  })

  // Przycisk "Połącz": zawsze świeże połączenie (stop czyści poprzednie gniazda, listenery i timery).
  ipcMain.handle('platform:connect', async (_e, platform: Platform) => {
    const adapter = adapterFor(platform)
    if (!adapter || getSettings().demoMode) return
    await adapter.stop()
    await adapter.start()
  })
  ipcMain.handle('platform:disconnect', (_e, platform: Platform) => {
    void adapterFor(platform)?.stop()
  })

  ipcMain.handle('oauth:start', async (_e, platform: Platform) => {
    if (platform === 'twitch') return twitchAdapter.login()
    if (platform === 'kick') return kickAdapter.login()
    if (platform === 'youtube') return youtubeAdapter.login()
    return { ok: false, message: 'TikTok nie wymaga logowania OAuth.' }
  })
  ipcMain.handle('oauth:logout', async (_e, platform: Platform) => {
    if (platform === 'twitch') await twitchAdapter.logout()
    if (platform === 'kick') await kickAdapter.logout()
    if (platform === 'youtube') await youtubeAdapter.logout()
  })

  ipcMain.handle('kick:tunnel-start', async () => {
    const result = await kickAdapter.startTunnel()
    sendToMainWindow('kick:tunnel-status-changed', { running: result.ok, url: result.url })
    if (result.ok && result.url) {
      updateSection('kick', { webhookUrl: `${result.url}/kick/webhook` })
    }
    return result
  })
  ipcMain.handle('kick:tunnel-stop', () => {
    kickAdapter.stopTunnel()
    sendToMainWindow('kick:tunnel-status-changed', { running: false })
  })
  ipcMain.handle('kick:tunnel-status', () => kickAdapter.getTunnelStatus())

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('status:get-all', () => [...lastStatuses.values()])

  // Odpowiedź wraca dopiero po faktycznym przełączeniu, z zapisanymi ustawieniami - renderer
  // aktualizuje z nich wspólny stan (przełącznik w Ustawieniach i na pasku czatu).
  ipcMain.handle('demo:set-enabled', async (_e, enabled: boolean) => {
    const updated = updateSettings({ demoMode: Boolean(enabled) })
    await applyConnectionMode()
    gamingOverlay?.send('settings:changed', updated)
    return updated
  })

  ipcMain.handle('gaming:get-state', () => gamingState())
  ipcMain.handle('gaming:set-mode', (_e, mode: GamingMode) => {
    if (mode === 'edit' || mode === 'locked') gamingOverlay?.setMode(mode)
    sendToMainWindow('gaming:state', gamingState())
    return gamingState()
  })
  ipcMain.handle('gaming:resize-by', (_e, delta: { dx?: unknown; dy?: unknown }) => {
    if (typeof delta?.dx === 'number' && typeof delta?.dy === 'number') gamingOverlay?.resizeBy(delta.dx, delta.dy)
  })
  ipcMain.handle('gaming:reset-position', () => gamingOverlay?.resetPosition())
  ipcMain.handle('gaming:show', () => gamingOverlay?.show())

  ipcMain.handle('visual:export', async () => {
    const options = { title: 'Eksport wyglądu', defaultPath: 'streamer-multichat-wyglad.json', filters: [{ name: 'JSON', extensions: ['json'] }] }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    try {
      await writeFile(result.filePath, JSON.stringify(buildVisualExport(getSettings()), null, 2), 'utf8')
      return { ok: true }
    } catch {
      return { ok: false, message: 'Nie udało się zapisać pliku.' }
    }
  })
  ipcMain.handle('visual:import', async () => {
    const options = { title: 'Import wyglądu', properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file) return { ok: false, canceled: true }
    let text: string
    try {
      if ((await stat(file)).size > 512 * 1024) return { ok: false, message: 'Plik jest za duży jak na ustawienia wyglądu.' }
      text = await readFile(file, 'utf8')
    } catch {
      return { ok: false, message: 'Nie udało się odczytać pliku.' }
    }
    const parsed = parseVisualImport(text, getSettings())
    if (!parsed.ok) return { ok: false, message: parsed.error }
    const updated = updateSettings(parsed.patch)
    overlayServer.broadcastSettings(overlayView(updated))
    syncGamingOverlay(updated)
    return { ok: true, settings: updated }
  })

  ipcMain.handle('secrets:set', (_e, input: unknown) => {
    if (!isValidSecretInput(input, USER_ENTERABLE_SECRET_KEYS)) {
      return { ok: false, message: 'Nieznany klucz sekretu lub nieprawidłowa wartość.' }
    }
    try {
      saveSecret(input.key, input.value.trim())
      // Nowy klucz/sekret ma zadziałać od razu (np. klucz API YouTube po komunikacie "auth_required").
      if (!getSettings().demoMode) void restartAdapterFor(input.key)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('secrets:has', (_e, key: (typeof USER_ENTERABLE_SECRET_KEYS)[number]) => Boolean(loadSecret(key)))
}

async function restartAdapterFor(key: (typeof USER_ENTERABLE_SECRET_KEYS)[number]): Promise<void> {
  const platform = key.split('.')[0] as Platform
  const adapter = adapterFor(platform)
  if (!adapter || !getSettings()[platform].enabled) return
  await adapter.stop()
  await adapter.start()
}

function adapterFor(platform: Platform): { start(): Promise<void>; stop(): Promise<void> } | undefined {
  switch (platform) {
    case 'twitch':
      return twitchAdapter
    case 'kick':
      return kickAdapter
    case 'youtube':
      return youtubeAdapter
    case 'tiktok':
      return tiktokAdapter
  }
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  diagnostics.record('app-start', { version: app.getVersion(), electron: process.versions.electron })
  registerIpcHandlers()
  createMainWindow()
  gamingOverlay = createGamingOverlayManager()
  gamingOverlay.sync()

  const overlaySettings = getSettings().overlay
  const staticDir = join(__dirname, '../renderer')
  await overlayServer
    .start(overlaySettings.port, staticDir, () => overlayView(getSettings()), process.env['ELECTRON_RENDERER_URL'])
    .catch((err) => console.error('[overlay] nie udało się uruchomić serwera nakładki:', err))

  if (getSettings().firstRunComplete) {
    void applyConnectionMode()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  gamingOverlay?.close()
  globalShortcut.unregisterAll()
  void stopAllRealAdapters()
  void demoAdapter.stop()
  kickAdapter.stopTunnel()
  twitchIrcClient.shutdown()
  kickPublicChatClient.shutdown()
})

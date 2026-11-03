import {
  gamingWindowState,
  MIN_OVERLAY_SIZE,
  resolveOverlayBounds,
  type DisplayInfo,
  type GamingMode,
  type GamingOverlaySettings,
  type GamingOverlayState,
  type GamingWindowBounds
} from '../../shared/gaming'

/** Podzbiór BrowserWindow używany przez nakładkę (ułatwia testy bez Electrona). */
export interface OverlayWindowLike {
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void
  setFocusable(focusable: boolean): void
  setSkipTaskbar(skip: boolean): void
  setMovable(movable: boolean): void
  setAlwaysOnTop(flag: boolean, level?: 'screen-saver'): void
  setBounds(bounds: Partial<GamingWindowBounds>): void
  getBounds(): GamingWindowBounds
  showInactive(): void
  focus(): void
  moveTop(): void
  close(): void
  isDestroyed(): boolean
  on(event: 'closed', listener: () => void): void
  send(channel: string, payload: unknown): void
}

export interface ScreenLike {
  getAllDisplays(): DisplayInfo[]
  getPrimaryDisplay(): DisplayInfo
  getDisplayMatching(bounds: GamingWindowBounds): DisplayInfo
  on(event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void): void
}

export interface ShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface GamingOverlayDeps {
  createWindow(bounds: GamingWindowBounds): OverlayWindowLike
  screen: ScreenLike
  shortcuts: ShortcutLike
  getSettings(): GamingOverlaySettings
  saveSettings(patch: Partial<GamingOverlaySettings>): void
  /** Powiadomienie o zmianie stanu (np. skrót przełączył tryb edycji) - dla panelu ustawień. */
  onStateChange?(state: GamingOverlayState): void
}


/**
 * Okno Gaming Overlay: przezroczyste, bez ramki, zawsze na wierzchu, w stanie LOCKED przepuszcza
 * kliknięcia do gry (opcjonalnie) i nigdy nie przejmuje fokusu. Globalny skrót przełącza tryb
 * edycji (przesuwanie i zmiana rozmiaru) - to bezpieczny sposób odzyskania kontroli nad nakładką,
 * przez którą przechodzi mysz. Wiadomości dostaje z tego samego strumienia co czat główny.
 */
export class GamingOverlayManager {
  private window: OverlayWindowLike | undefined
  private mode: GamingMode = 'locked'
  private registeredHotkey: string | undefined
  private hotkeyRegistered = false

  constructor(private readonly deps: GamingOverlayDeps) {
    const reposition = (): void => this.fitToDisplays()
    deps.screen.on('display-added', reposition)
    deps.screen.on('display-removed', reposition)
    deps.screen.on('display-metrics-changed', reposition)
  }

  /** Dopasowuje stan do ustawień: otwiera/zamyka okno, odświeża skrót i tryb myszy. */
  sync(): void {
    const settings = this.deps.getSettings()
    if (!settings.enabled) {
      this.close()
      return
    }
    this.registerHotkey(settings.editHotkey)
    if (!this.window || this.window.isDestroyed()) this.open(settings)
    else this.applyMode()
  }

  state(): GamingOverlayState {
    const settings = this.deps.getSettings()
    return {
      open: Boolean(this.window && !this.window.isDestroyed()),
      mode: this.mode,
      hotkey: settings.editHotkey,
      hotkeyRegistered: this.hotkeyRegistered
    }
  }

  setMode(mode: GamingMode): void {
    if (!this.window || this.window.isDestroyed() || mode === this.mode) return
    if (mode === 'locked') this.persistBounds()
    this.mode = mode
    this.applyMode()
    if (mode === 'edit') this.window.focus()
  }

  toggleEditMode(): void {
    this.setMode(this.mode === 'edit' ? 'locked' : 'edit')
  }

  /** Pokazuje nakładkę na wierzchu (np. po przykryciu przez inne okno "zawsze na wierzchu"). */
  show(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setAlwaysOnTop(true, 'screen-saver')
    this.window.showInactive()
    this.window.moveTop()
  }

  /** Zmiana rozmiaru uchwytem w trybie edycji (przezroczystych okien nie da się zmieniać krawędzią). */
  resizeBy(dx: number, dy: number): void {
    if (!this.window || this.window.isDestroyed() || this.mode !== 'edit') return
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const b = this.window.getBounds()
    const area = this.deps.screen.getDisplayMatching(b).workArea
    const width = Math.min(Math.max(MIN_OVERLAY_SIZE.width, Math.round(b.width + dx)), area.x + area.width - b.x)
    const height = Math.min(Math.max(MIN_OVERLAY_SIZE.height, Math.round(b.height + dy)), area.y + area.height - b.y)
    this.window.setBounds({ width, height })
  }

  resetPosition(): void {
    this.deps.saveSettings({ bounds: undefined, displayId: undefined })
    if (this.window && !this.window.isDestroyed()) this.window.setBounds(this.targetBounds().bounds)
  }

  /** Wiadomość lub zmiana ustawień dla okna nakładki (jeśli jest otwarte). */
  send(channel: string, payload: unknown): void {
    if (this.window && !this.window.isDestroyed()) this.window.send(channel, payload)
  }

  close(): void {
    this.unregisterHotkey()
    const win = this.window
    this.window = undefined
    this.mode = 'locked'
    if (win && !win.isDestroyed()) win.close()
    this.deps.onStateChange?.(this.state())
  }

  private open(settings: GamingOverlaySettings): void {
    const { bounds } = this.targetBounds(settings)
    const win = this.deps.createWindow(bounds)
    this.window = win
    this.mode = 'locked'
    win.on('closed', () => {
      if (this.window === win) {
        this.window = undefined
        this.mode = 'locked'
      }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    this.applyMode()
    win.showInactive()
  }

  private applyMode(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const state = gamingWindowState(this.mode, this.deps.getSettings().clickThrough)
    // forward: true - nakładka nadal dostaje ruch myszy (bez kliknięć), gdy przepuszcza kliknięcia.
    win.setIgnoreMouseEvents(state.ignoreMouse, state.ignoreMouse ? { forward: true } : undefined)
    win.setFocusable(state.focusable)
    // Na Windows zmiana "focusable" (i aktywacja w trybie edycji) przywraca przycisk na pasku zadań.
    win.setSkipTaskbar(true)
    win.setMovable(state.movable)
    const current = this.state()
    win.send('gaming:state', current)
    this.deps.onStateChange?.(current)
  }

  private targetBounds(settings = this.deps.getSettings()): { bounds: GamingWindowBounds; relocated: boolean } {
    return resolveOverlayBounds(settings, this.deps.screen.getAllDisplays(), this.deps.screen.getPrimaryDisplay())
  }

  private persistBounds(): void {
    if (!this.window || this.window.isDestroyed()) return
    const bounds = this.window.getBounds()
    const display = this.deps.screen.getDisplayMatching(bounds)
    this.deps.saveSettings({ bounds, displayId: display.id })
  }

  /** Po zmianie monitorów (odłączenie, rozdzielczość, skalowanie) okno zostaje w całości na ekranie. */
  private fitToDisplays(): void {
    if (!this.window || this.window.isDestroyed()) return
    const current = this.window.getBounds()
    const display = this.deps.screen.getDisplayMatching(current)
    const saved = this.deps.getSettings()
    const target = resolveOverlayBounds(
      { bounds: current, displayId: saved.displayId !== undefined && this.deps.screen.getAllDisplays().some((d) => d.id === saved.displayId) ? saved.displayId : display.id },
      this.deps.screen.getAllDisplays(),
      this.deps.screen.getPrimaryDisplay()
    )
    if (target.relocated) this.window.setBounds(target.bounds)
  }

  private registerHotkey(accelerator: string): void {
    if (this.registeredHotkey === accelerator && this.hotkeyRegistered) return
    this.unregisterHotkey()
    try {
      this.hotkeyRegistered = this.deps.shortcuts.register(accelerator, () => this.toggleEditMode())
    } catch {
      this.hotkeyRegistered = false
    }
    this.registeredHotkey = this.hotkeyRegistered ? accelerator : undefined
  }

  private unregisterHotkey(): void {
    if (this.registeredHotkey) this.deps.shortcuts.unregister(this.registeredHotkey)
    this.registeredHotkey = undefined
    this.hotkeyRegistered = false
  }
}

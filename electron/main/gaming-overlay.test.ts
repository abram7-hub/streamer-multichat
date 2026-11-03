import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GAMING_SETTINGS, defaultOverlayBounds, type DisplayInfo, type GamingOverlaySettings, type GamingWindowBounds } from '../../shared/gaming'
import { GamingOverlayManager, type OverlayWindowLike } from './gaming-overlay'

class FakeWindow implements OverlayWindowLike {
  ignoreMouse = false
  ignoreOptions: { forward?: boolean } | undefined
  focusable = true
  skipTaskbar = false
  movable = true
  onTop = false
  shown = false
  destroyed = false
  sent: { channel: string; payload: unknown }[] = []
  private closed: (() => void)[] = []
  constructor(public bounds: GamingWindowBounds) {}
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    this.ignoreMouse = ignore
    this.ignoreOptions = options
  }
  setFocusable(v: boolean): void {
    this.focusable = v
  }
  setSkipTaskbar(v: boolean): void {
    this.skipTaskbar = v
  }
  setMovable(v: boolean): void {
    this.movable = v
  }
  setAlwaysOnTop(v: boolean): void {
    this.onTop = v
  }
  setBounds(b: Partial<GamingWindowBounds>): void {
    this.bounds = { ...this.bounds, ...b }
  }
  getBounds(): GamingWindowBounds {
    return this.bounds
  }
  showInactive(): void {
    this.shown = true
  }
  focus(): void {}
  moveTop(): void {}
  close(): void {
    this.destroyed = true
    for (const cb of this.closed) cb()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  on(_event: 'closed', listener: () => void): void {
    this.closed.push(listener)
  }
  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload })
  }
}

function setup(initial: Partial<GamingOverlaySettings> = {}, registerResult = true) {
  let settings: GamingOverlaySettings = { ...DEFAULT_GAMING_SETTINGS, enabled: true, ...initial }
  const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  const second: DisplayInfo = { id: 2, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }
  let displays = [primary, second]
  const listeners: (() => void)[] = []
  const shortcuts = new Map<string, () => void>()
  const windows: FakeWindow[] = []
  const states = vi.fn()
  const manager = new GamingOverlayManager({
    createWindow: (b) => {
      const w = new FakeWindow(b)
      windows.push(w)
      return w
    },
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => primary,
      getDisplayMatching: (b) => displays.find((d) => b.x >= d.workArea.x && b.x < d.workArea.x + d.workArea.width) ?? primary,
      on: (_e, l) => void listeners.push(l)
    },
    shortcuts: {
      register: (acc, cb) => {
        if (registerResult) shortcuts.set(acc, cb)
        return registerResult
      },
      unregister: (acc) => void shortcuts.delete(acc)
    },
    getSettings: () => settings,
    saveSettings: (patch) => {
      settings = { ...settings, ...patch }
    },
    onStateChange: states
  })
  return {
    manager,
    windows,
    shortcuts,
    states,
    settings: () => settings,
    set: (p: Partial<GamingOverlaySettings>) => {
      settings = { ...settings, ...p }
    },
    setDisplays: (d: DisplayInfo[]) => {
      displays = d
      for (const l of listeners) l()
    },
    primary
  }
}

describe('GamingOverlayManager', () => {
  it('OFF by default: no window, no global hotkey', () => {
    const t = setup({ enabled: false })
    t.manager.sync()
    expect(t.windows).toHaveLength(0)
    expect(t.shortcuts.size).toBe(0)
  })

  it('ON: opens one always-on-top window without stealing focus, click-through when locked', () => {
    const t = setup()
    t.manager.sync()
    t.manager.sync()
    expect(t.windows).toHaveLength(1)
    const w = t.windows[0]!
    expect(w.onTop).toBe(true)
    expect(w.shown).toBe(true)
    expect(w.ignoreMouse).toBe(true)
    expect(w.ignoreOptions).toEqual({ forward: true })
    expect(w.focusable).toBe(false)
    expect(w.bounds).toEqual(defaultOverlayBounds(t.primary))
    expect(t.manager.state()).toMatchObject({ open: true, mode: 'locked', hotkeyRegistered: true })
  })

  it('click-through can be switched off for the locked overlay', () => {
    const t = setup({ clickThrough: false })
    t.manager.sync()
    expect(t.windows[0]!.ignoreMouse).toBe(false)
    expect(t.windows[0]!.focusable).toBe(false)
  })

  it('hotkey: enters edit mode (mouse back, movable), second press locks and saves position + monitor', () => {
    const t = setup()
    t.manager.sync()
    const w = t.windows[0]!
    t.shortcuts.get(t.settings().editHotkey)!()
    expect(t.manager.state().mode).toBe('edit')
    expect(w.ignoreMouse).toBe(false)
    expect(w.movable).toBe(true)
    expect(w.focusable).toBe(true)
    expect(w.skipTaskbar).toBe(true)
    w.setBounds({ x: 2100, y: 200, width: 500, height: 600 }) // przesunięte na drugi monitor
    t.shortcuts.get(t.settings().editHotkey)!()
    expect(t.manager.state().mode).toBe('locked')
    expect(w.ignoreMouse).toBe(true)
    expect(t.settings().bounds).toEqual({ x: 2100, y: 200, width: 500, height: 600 })
    expect(t.settings().displayId).toBe(2)
    expect(t.states).toHaveBeenCalled()
  })

  it('reopening restores the saved position on the saved monitor', () => {
    const t = setup({ bounds: { x: 2100, y: 200, width: 500, height: 600 }, displayId: 2 })
    t.manager.sync()
    expect(t.windows[0]!.bounds).toEqual({ x: 2100, y: 200, width: 500, height: 600 })
  })

  it('monitor disconnected while open: window is moved to the primary screen', () => {
    const t = setup({ bounds: { x: 2100, y: 200, width: 500, height: 600 }, displayId: 2 })
    t.manager.sync()
    t.setDisplays([t.primary])
    const b = t.windows[0]!.bounds
    expect(b.x + b.width).toBeLessThanOrEqual(1920)
    expect(b.y + b.height).toBeLessThanOrEqual(1040)
  })

  it('resize handle works only in edit mode and keeps the window on its monitor', () => {
    const t = setup()
    t.manager.sync()
    const w = t.windows[0]!
    const before = { ...w.bounds }
    t.manager.resizeBy(100, 100)
    expect(w.bounds).toEqual(before)
    t.manager.setMode('edit')
    t.manager.resizeBy(-5000, -5000)
    expect(w.bounds.width).toBe(220)
    expect(w.bounds.height).toBe(120)
    t.manager.resizeBy(99999, 99999)
    expect(w.bounds.x + w.bounds.width).toBe(1920)
    expect(w.bounds.y + w.bounds.height).toBe(1040)
  })

  it('reset position clears the saved bounds and moves to the default place', () => {
    const t = setup({ bounds: { x: 2100, y: 200, width: 500, height: 600 }, displayId: 2 })
    t.manager.sync()
    t.manager.resetPosition()
    expect(t.settings().bounds).toBeUndefined()
    expect(t.windows[0]!.bounds).toEqual(defaultOverlayBounds(t.primary))
  })

  it('a hotkey taken by another app is reported, not silently ignored', () => {
    const t = setup({}, false)
    t.manager.sync()
    expect(t.manager.state().hotkeyRegistered).toBe(false)
  })

  it('changing the hotkey re-registers it', () => {
    const t = setup()
    t.manager.sync()
    t.set({ editHotkey: 'Ctrl+Alt+F10' })
    t.manager.sync()
    expect([...t.shortcuts.keys()]).toEqual(['Ctrl+Alt+F10'])
  })

  it('OFF again: window closed and hotkey released', () => {
    const t = setup()
    t.manager.sync()
    t.set({ enabled: false })
    t.manager.sync()
    expect(t.windows[0]!.destroyed).toBe(true)
    expect(t.shortcuts.size).toBe(0)
    expect(t.manager.state().open).toBe(false)
  })

  it('messages and settings are forwarded only while the window is open', () => {
    const t = setup()
    t.manager.send('chat:message', { id: 'x' })
    t.manager.sync()
    t.manager.send('chat:message', { id: 'y' })
    expect(t.windows[0]!.sent.filter((s) => s.channel === 'chat:message').map((s) => (s.payload as { id: string }).id)).toEqual(['y'])
  })
})

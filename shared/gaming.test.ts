import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './chat-message'
import {
  DEFAULT_GAMING_HOTKEY,
  DEFAULT_GAMING_SETTINGS,
  defaultOverlayBounds,
  formatAccelerator,
  gamingFilterAccepts,
  gamingOverlayVisible,
  gamingWindowState,
  isValidAccelerator,
  normalizeGamingSettings,
  resolveOverlayBounds,
  type DisplayInfo
} from './gaming'

const msg = (patch: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id: '1',
    platform: 'twitch',
    channel: 'c',
    author: { id: 'a', username: 'u', displayName: 'U', badges: [], isBroadcaster: false, isModerator: false, isSubscriber: false },
    fragments: [{ type: 'text', text: 'hej' }],
    rawText: 'hej',
    timestampMs: 0,
    receivedAtMs: 0,
    isHighlighted: false,
    ...patch
  }) as ChatMessage

describe('Gaming Overlay defaults', () => {
  it('match the agreed defaults', () => {
    expect(DEFAULT_GAMING_SETTINGS).toEqual({
      enabled: false,
      clickThrough: true,
      editHotkey: 'CommandOrControl+Alt+Shift+G',
      layerOpacity: 100,
      backgroundOpacity: 0,
      lifetimeSec: 10,
      maxVisible: 5,
      filter: 'all',
      showOnlyOnActivity: true,
      textShadow: true,
      textOutline: false,
      outlineWidthPx: 1
    })
  })

  it('the default hotkey is a valid accelerator shown as Ctrl+Alt+Shift+G', () => {
    expect(isValidAccelerator(DEFAULT_GAMING_HOTKEY)).toBe(true)
    expect(formatAccelerator(DEFAULT_GAMING_HOTKEY)).toBe('Ctrl+Alt+Shift+G')
  })
})

describe('normalizeGamingSettings', () => {
  it('missing or broken section -> defaults', () => {
    expect(normalizeGamingSettings(undefined)).toEqual(DEFAULT_GAMING_SETTINGS)
    expect(normalizeGamingSettings('x')).toEqual(DEFAULT_GAMING_SETTINGS)
  })

  it('keeps valid values, clamps numbers and rejects invalid ones', () => {
    const n = normalizeGamingSettings({
      enabled: true,
      lifetimeSec: 9999,
      maxVisible: 0,
      layerOpacity: 3,
      filter: 'everything',
      editHotkey: 'rm -rf',
      outlineWidthPx: 2,
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      displayId: 7
    })
    expect(n).toMatchObject({ enabled: true, lifetimeSec: 600, maxVisible: 1, layerOpacity: 10, filter: 'all', editHotkey: DEFAULT_GAMING_HOTKEY, outlineWidthPx: 2 })
    expect(n.bounds).toEqual({ x: 10, y: 20, width: 300, height: 200 })
    expect(n.displayId).toBe(7)
  })

  it('drops malformed bounds', () => {
    expect(normalizeGamingSettings({ bounds: { x: 'a', y: 1, width: 1, height: 1 } }).bounds).toBeUndefined()
  })

  it('accepts typical accelerators and rejects garbage', () => {
    for (const ok of ['Ctrl+Shift+F9', 'CommandOrControl+Alt+O', 'Alt+Shift+1']) expect(isValidAccelerator(ok)).toBe(true)
    for (const bad of ['G', 'Ctrl+', '', 'Ctrl+Alt+Delete+X+Y+Z+Q', 'Ctrl+Escape']) expect(isValidAccelerator(bad)).toBe(false)
  })
})

describe('gamingFilterAccepts', () => {
  const chat = msg()
  const mention = msg({ isHighlighted: true })
  const event = msg({ event: { kind: 'sub', source: 'irc' } })

  it('all messages / events only', () => {
    expect(gamingFilterAccepts('all', chat)).toBe(true)
    expect(gamingFilterAccepts('all', event)).toBe(true)
    expect(gamingFilterAccepts('events', chat)).toBe(false)
    expect(gamingFilterAccepts('events', mention)).toBe(false)
    expect(gamingFilterAccepts('events', event)).toBe(true)
  })

  it('mentions only: uses the central mention flag', () => {
    expect(gamingFilterAccepts('mentions', chat)).toBe(false)
    expect(gamingFilterAccepts('mentions', event)).toBe(false)
    expect(gamingFilterAccepts('mentions', mention)).toBe(true)
  })

  it('mentions + events: both, but not plain chat', () => {
    expect(gamingFilterAccepts('mentions-events', mention)).toBe(true)
    expect(gamingFilterAccepts('mentions-events', event)).toBe(true)
    expect(gamingFilterAccepts('mentions-events', chat)).toBe(false)
  })
})

describe('window bounds and monitors', () => {
  const primary: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }
  const second: DisplayInfo = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }

  it('no saved position -> default position on the primary monitor, fully on screen', () => {
    const r = resolveOverlayBounds({}, [primary, second], primary)
    expect(r.displayId).toBe(1)
    expect(r.bounds).toEqual(defaultOverlayBounds(primary))
    expect(r.bounds.x + r.bounds.width).toBeLessThanOrEqual(1920)
    expect(r.bounds.y + r.bounds.height).toBeLessThanOrEqual(1040)
  })

  it('a saved position on another monitor is kept', () => {
    const saved = { bounds: { x: 2200, y: 300, width: 400, height: 500 }, displayId: 2 }
    expect(resolveOverlayBounds(saved, [primary, second], primary)).toEqual({ bounds: saved.bounds, displayId: 2, relocated: false })
  })

  it('disconnected monitor -> safely moved to the primary monitor', () => {
    const r = resolveOverlayBounds({ bounds: { x: 2200, y: 300, width: 400, height: 500 }, displayId: 2 }, [primary], primary)
    expect(r.displayId).toBe(1)
    expect(r.relocated).toBe(true)
    expect(r.bounds).toEqual(defaultOverlayBounds(primary))
  })

  it('partly or fully off-screen window is pulled back inside the work area', () => {
    const r = resolveOverlayBounds({ bounds: { x: 1800, y: -200, width: 400, height: 500 }, displayId: 1 }, [primary], primary)
    expect(r.bounds).toEqual({ x: 1520, y: 0, width: 400, height: 500 })
    expect(r.relocated).toBe(true)
  })

  it('lower resolution / higher scaling: window larger than the screen is shrunk to fit', () => {
    const small: DisplayInfo = { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 680 } }
    const r = resolveOverlayBounds({ bounds: { x: 900, y: 100, width: 1500, height: 900 }, displayId: 1 }, [small], small)
    expect(r.bounds).toEqual({ x: 0, y: 0, width: 1280, height: 680 })
  })

  it('tiny saved size is raised to the minimum', () => {
    const r = resolveOverlayBounds({ bounds: { x: 100, y: 100, width: 10, height: 10 }, displayId: 1 }, [primary], primary)
    expect(r.bounds.width).toBeGreaterThanOrEqual(220)
    expect(r.bounds.height).toBeGreaterThanOrEqual(120)
  })
})

describe('window state (click-through and edit mode)', () => {
  it('LOCKED with click-through: mouse passes to the game, overlay never takes focus', () => {
    expect(gamingWindowState('locked', true)).toEqual({ ignoreMouse: true, focusable: false, movable: false })
  })
  it('LOCKED without click-through: overlay receives the mouse but still does not take focus', () => {
    expect(gamingWindowState('locked', false)).toEqual({ ignoreMouse: false, focusable: false, movable: false })
  })
  it('EDIT: click-through is always off, window can be moved', () => {
    expect(gamingWindowState('edit', true)).toEqual({ ignoreMouse: false, focusable: true, movable: true })
  })
})

describe('show only on activity', () => {
  it('hidden without messages, visible with messages or while editing', () => {
    expect(gamingOverlayVisible({ showOnlyOnActivity: true }, 0, false)).toBe(false)
    expect(gamingOverlayVisible({ showOnlyOnActivity: true }, 1, false)).toBe(true)
    expect(gamingOverlayVisible({ showOnlyOnActivity: true }, 0, true)).toBe(true)
    expect(gamingOverlayVisible({ showOnlyOnActivity: false }, 0, false)).toBe(true)
  })
})

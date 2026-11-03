import type { ChatMessage } from './chat-message'

/** Co pokazuje Gaming Overlay (wzmianki rozpoznaje centralny detektor - patrz shared/mentions.ts). */
export type GamingFilter = 'all' | 'mentions' | 'mentions-events' | 'events'

export interface GamingWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface GamingOverlaySettings {
  enabled: boolean
  /** Po zablokowaniu (wyjściu z trybu edycji) mysz przechodzi przez nakładkę do gry. */
  clickThrough: boolean
  /** Globalny skrót przełączający tryb edycji (format akceleratora Electron). */
  editHotkey: string
  /** Krycie całej warstwy nakładki 0-100 (wiadomości razem z tłem). */
  layerOpacity: number
  /** Krycie tła okna nakładki 0-100 (0 = w pełni przezroczyste, widać tylko wiadomości). */
  backgroundOpacity: number
  /** Czas widoczności wiadomości w sekundach; 0 = zawsze. */
  lifetimeSec: number
  maxVisible: number
  filter: GamingFilter
  /** Bez widocznych wiadomości nakładka nic nie rysuje (okno zostaje otwarte). */
  showOnlyOnActivity: boolean
  textShadow: boolean
  textOutline: boolean
  outlineWidthPx: number
  /** Ostatnia zablokowana pozycja i rozmiar (współrzędne ekranu w DIP). */
  bounds?: GamingWindowBounds
  /** Monitor, na którym nakładka była zablokowana (`Display.id` z Electron). */
  displayId?: number
}

export const DEFAULT_GAMING_HOTKEY = 'CommandOrControl+Alt+Shift+G'

export const DEFAULT_GAMING_SETTINGS: GamingOverlaySettings = {
  enabled: false,
  clickThrough: true,
  editHotkey: DEFAULT_GAMING_HOTKEY,
  layerOpacity: 100,
  backgroundOpacity: 0,
  lifetimeSec: 10,
  maxVisible: 5,
  filter: 'all',
  showOnlyOnActivity: true,
  textShadow: true,
  textOutline: false,
  outlineWidthPx: 1
}

export const GAMING_LIMITS = {
  layerOpacity: [10, 100],
  backgroundOpacity: [0, 100],
  lifetimeSec: [0, 600],
  maxVisible: [1, 50],
  outlineWidthPx: [1, 3]
} as const

const FILTERS: readonly GamingFilter[] = ['all', 'mentions', 'mentions-events', 'events']
/** Akcelerator: modyfikatory + jeden klawisz, np. "CommandOrControl+Alt+Shift+G". */
const ACCELERATOR = /^(?:(?:CommandOrControl|CmdOrCtrl|Control|Ctrl|Alt|Shift|Super|Meta)\+){1,4}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/

export function isValidAccelerator(value: unknown): value is string {
  return typeof value === 'string' && ACCELERATOR.test(value)
}

function clampInt(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

function sanitizeBounds(raw: unknown): GamingWindowBounds | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const b = raw as Record<string, unknown>
  const nums = [b['x'], b['y'], b['width'], b['height']]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined
  return { x: Math.round(b['x'] as number), y: Math.round(b['y'] as number), width: Math.round(b['width'] as number), height: Math.round(b['height'] as number) }
}

/** Pełne, poprawne ustawienia Gaming Overlay z dowolnego (również uszkodzonego) wejścia. */
export function normalizeGamingSettings(raw: unknown): GamingOverlaySettings {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_GAMING_SETTINGS
  const bool = (key: keyof GamingOverlaySettings, fallback: boolean): boolean => (typeof v[key] === 'boolean' ? (v[key] as boolean) : fallback)
  const out: GamingOverlaySettings = {
    enabled: bool('enabled', d.enabled),
    clickThrough: bool('clickThrough', d.clickThrough),
    editHotkey: isValidAccelerator(v['editHotkey']) ? v['editHotkey'] : d.editHotkey,
    layerOpacity: clampInt(v['layerOpacity'], GAMING_LIMITS.layerOpacity, d.layerOpacity),
    backgroundOpacity: clampInt(v['backgroundOpacity'], GAMING_LIMITS.backgroundOpacity, d.backgroundOpacity),
    lifetimeSec: clampInt(v['lifetimeSec'], GAMING_LIMITS.lifetimeSec, d.lifetimeSec),
    maxVisible: clampInt(v['maxVisible'], GAMING_LIMITS.maxVisible, d.maxVisible),
    filter: FILTERS.includes(v['filter'] as GamingFilter) ? (v['filter'] as GamingFilter) : d.filter,
    showOnlyOnActivity: bool('showOnlyOnActivity', d.showOnlyOnActivity),
    textShadow: bool('textShadow', d.textShadow),
    textOutline: bool('textOutline', d.textOutline),
    outlineWidthPx: clampInt(v['outlineWidthPx'], GAMING_LIMITS.outlineWidthPx, d.outlineWidthPx)
  }
  const bounds = sanitizeBounds(v['bounds'])
  if (bounds) out.bounds = bounds
  if (typeof v['displayId'] === 'number' && Number.isFinite(v['displayId'])) out.displayId = v['displayId']
  return out
}

/**
 * Czy wiadomość ma trafić do Gaming Overlay. Wzmiankę oznacza proces główny (`isHighlighted`,
 * ten sam detektor co dla czatu głównego), więc nakładka nie liczy jej drugi raz.
 */
export function gamingFilterAccepts(filter: GamingFilter, message: ChatMessage): boolean {
  const isEvent = Boolean(message.event)
  const isMention = message.isHighlighted
  switch (filter) {
    case 'all':
      return true
    case 'events':
      return isEvent
    case 'mentions':
      return isMention
    case 'mentions-events':
      return isEvent || isMention
  }
}

export interface DisplayInfo {
  id: number
  /** Obszar roboczy monitora (bez paska zadań), w DIP. */
  workArea: GamingWindowBounds
}

export const MIN_OVERLAY_SIZE = { width: 220, height: 120 }
const DEFAULT_SIZE = { width: 380, height: 420 }
const EDGE_MARGIN = 24

/** Domyślne położenie: prawa dolna część obszaru roboczego monitora. */
export function defaultOverlayBounds(display: DisplayInfo): GamingWindowBounds {
  const area = display.workArea
  const width = Math.min(DEFAULT_SIZE.width, area.width)
  const height = Math.min(DEFAULT_SIZE.height, area.height)
  return {
    x: area.x + Math.max(0, area.width - width - EDGE_MARGIN),
    y: area.y + Math.max(0, area.height - height - EDGE_MARGIN * 4),
    width,
    height
  }
}

/**
 * Pozycja nakładki dla bieżącego układu monitorów. Zapisany monitor jest szukany po `displayId`;
 * jeśli zniknął (odłączony), nakładka trafia na monitor główny. Rozmiar jest ograniczany do obszaru
 * roboczego, a pozycja przesuwana tak, żeby całe okno było na ekranie (np. po zmianie rozdzielczości
 * lub skalowania).
 */
export function resolveOverlayBounds(
  saved: { bounds?: GamingWindowBounds; displayId?: number },
  displays: readonly DisplayInfo[],
  primary: DisplayInfo
): { bounds: GamingWindowBounds; displayId: number; relocated: boolean } {
  const display = (saved.displayId !== undefined && displays.find((d) => d.id === saved.displayId)) || undefined
  if (!saved.bounds || !display) {
    return { bounds: defaultOverlayBounds(primary), displayId: primary.id, relocated: Boolean(saved.bounds) }
  }
  const area = display.workArea
  const width = Math.min(Math.max(saved.bounds.width, MIN_OVERLAY_SIZE.width), area.width)
  const height = Math.min(Math.max(saved.bounds.height, MIN_OVERLAY_SIZE.height), area.height)
  const x = Math.min(Math.max(saved.bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(saved.bounds.y, area.y), area.y + area.height - height)
  const bounds = { x, y, width, height }
  const relocated = bounds.x !== saved.bounds.x || bounds.y !== saved.bounds.y || bounds.width !== saved.bounds.width || bounds.height !== saved.bounds.height
  return { bounds, displayId: display.id, relocated }
}

export type GamingMode = 'locked' | 'edit'

export interface GamingOverlayState {
  open: boolean
  mode: GamingMode
  hotkey: string
  /** false, gdy system odmówił rejestracji skrótu (np. zajęty przez inną aplikację). */
  hotkeyRegistered: boolean
}

/** Stan okna dla trybu pracy: LOCKED (gra) albo EDIT (przesuwanie i zmiana rozmiaru). */
export function gamingWindowState(mode: GamingMode, clickThrough: boolean): {
  ignoreMouse: boolean
  focusable: boolean
  movable: boolean
} {
  if (mode === 'edit') return { ignoreMouse: false, focusable: true, movable: true }
  // Zablokowana nakładka nigdy nie przejmuje fokusu z gry; mysz przechodzi przez nią, jeśli tak ustawiono.
  return { ignoreMouse: clickThrough, focusable: false, movable: false }
}

/**
 * Czy nakładka ma coś rysować. Przy "tylko przy aktywności" bez wiadomości jest niewidoczna, ale okno
 * zostaje otwarte (bez ciągłego tworzenia i zamykania BrowserWindow). W trybie edycji zawsze widoczna.
 */
export function gamingOverlayVisible(settings: Pick<GamingOverlaySettings, 'showOnlyOnActivity'>, visibleMessages: number, editing: boolean): boolean {
  return editing || !settings.showOnlyOnActivity || visibleMessages > 0
}

/** Czytelny opis skrótu, np. "Ctrl+Alt+Shift+G". */
export function formatAccelerator(accelerator: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
}

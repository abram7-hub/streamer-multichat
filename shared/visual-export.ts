import { normalizeAppearance, type AppearanceSettings } from './appearance'
import { normalizeGamingSettings, type GamingOverlaySettings } from './gaming'
import { normalizeMentionHighlight, type MentionHighlightSettings } from './mentions'
import type { AppSettings } from './settings'

/**
 * Eksport/import ustawień WYŁĄCZNIE wizualnych. Plik powstaje z jawnej listy pól (biała lista),
 * więc nigdy nie zawiera tokenów, sekretów, kluczy API, danych logowania, kanałów, listy
 * ignorowanych, ścieżek lokalnych ani własnego pliku dźwięku. Import działa tak samo: odczytuje
 * tylko te pola, normalizuje je i zwraca łatkę do zapisania - reszta pliku jest ignorowana.
 */
export const VISUAL_EXPORT_FORMAT = 'streamer-multichat-visual'
export const VISUAL_EXPORT_SCHEMA_VERSION = 1
const MAX_IMPORT_BYTES = 256 * 1024

const GAMING_VISUAL_KEYS = [
  'layerOpacity',
  'backgroundOpacity',
  'lifetimeSec',
  'maxVisible',
  'filter',
  'showOnlyOnActivity',
  'textShadow',
  'textOutline',
  'outlineWidthPx'
] as const satisfies readonly (keyof GamingOverlaySettings)[]

type GamingVisual = Pick<GamingOverlaySettings, (typeof GAMING_VISUAL_KEYS)[number]>

export interface VisualExport {
  format: typeof VISUAL_EXPORT_FORMAT
  schemaVersion: number
  appearance: AppearanceSettings
  overlay: { backgroundOpacity: number }
  gaming: GamingVisual
  mentions: { highlight: MentionHighlightSettings }
}

function pickGaming(gaming: GamingOverlaySettings): GamingVisual {
  return Object.fromEntries(GAMING_VISUAL_KEYS.map((k) => [k, gaming[k]])) as GamingVisual
}

export function buildVisualExport(settings: AppSettings): VisualExport {
  return {
    format: VISUAL_EXPORT_FORMAT,
    schemaVersion: VISUAL_EXPORT_SCHEMA_VERSION,
    appearance: structuredClone(settings.appearance),
    overlay: { backgroundOpacity: settings.overlay.backgroundOpacity },
    gaming: pickGaming(settings.gaming),
    mentions: { highlight: { ...settings.mentions.highlight } }
  }
}

export type VisualImportResult =
  | { ok: true; patch: Pick<AppSettings, 'appearance' | 'overlay' | 'gaming' | 'mentions'> }
  | { ok: false; error: string }

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * Plik -> łatka ustawień scalona z bieżącymi wartościami (sekcje `overlay`, `gaming`, `mentions`
 * zachowują wszystkie pola niewizualne, np. port OBS, skrót, pozycję nakładki, frazy, dźwięk).
 */
export function parseVisualImport(text: string, current: AppSettings): VisualImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'Plik jest za duży jak na ustawienia wyglądu.' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'To nie jest poprawny plik JSON.' }
  }
  if (!isObject(data) || data['format'] !== VISUAL_EXPORT_FORMAT) {
    return { ok: false, error: 'To nie jest plik ustawień wyglądu Streamer Multichat.' }
  }
  const version = data['schemaVersion']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'Brak lub niepoprawna wersja pliku (schemaVersion).' }
  }
  if (version > VISUAL_EXPORT_SCHEMA_VERSION) {
    return { ok: false, error: 'Plik pochodzi z nowszej wersji aplikacji - zaktualizuj aplikację, aby go wczytać.' }
  }
  if (!isObject(data['appearance'])) return { ok: false, error: 'W pliku brakuje ustawień wyglądu.' }

  const overlayRaw = isObject(data['overlay']) ? data['overlay'] : {}
  const opacity = overlayRaw['backgroundOpacity']
  const gamingRaw = isObject(data['gaming']) ? data['gaming'] : {}
  const gamingVisual = pickGaming(normalizeGamingSettings({ ...pickGaming(current.gaming), ...gamingRaw }))
  const mentionsRaw = isObject(data['mentions']) ? data['mentions'] : {}

  return {
    ok: true,
    patch: {
      appearance: normalizeAppearance(data['appearance']),
      overlay: {
        ...current.overlay,
        backgroundOpacity: typeof opacity === 'number' && Number.isFinite(opacity) ? Math.min(100, Math.max(0, Math.round(opacity))) : current.overlay.backgroundOpacity
      },
      gaming: { ...current.gaming, ...gamingVisual },
      mentions: { ...current.mentions, highlight: isObject(mentionsRaw['highlight']) ? normalizeMentionHighlight(mentionsRaw['highlight']) : current.mentions.highlight }
    }
  }
}

import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'
import { normalizeAppearance } from '../../shared/appearance'
import { normalizeGamingSettings } from '../../shared/gaming'
import { normalizeMentionSettings } from '../../shared/mentions'
import type { UserSecretKey } from '../../shared/ipc'

const MAX_SECRET_LENGTH = 4096

/**
 * Łatka ustawień z renderera: tylko znane klucze najwyższego poziomu i wartości tego samego rodzaju
 * co w ustawieniach domyślnych (sekcja jako obiekt, lista jako tablica, flaga jako boolean).
 * Nieznane lub źle typowane pola są pomijane, zamiast trafiać do config.json.
 */
export function sanitizeSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {}
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>
  const accepted = Object.entries(patch as Record<string, unknown>).filter(([key, value]) => {
    // Wersję schematu ustawia wyłącznie migracja w procesie głównym.
    if (key === 'schemaVersion') return false
    if (!Object.hasOwn(defaults, key) || value === undefined || value === null) return false
    const expected = defaults[key]
    return typeof value === typeof expected && Array.isArray(value) === Array.isArray(expected)
  })
  const result = Object.fromEntries(accepted) as Partial<AppSettings>
  if (result.appearance) result.appearance = normalizeAppearance(result.appearance)
  if (result.mentions) result.mentions = normalizeMentionSettings(result.mentions)
  if (result.gaming) {
    // Pozycję i monitor nakładki zapisuje wyłącznie proces główny (przy blokowaniu) - kopia w
    // rendererze może być nieaktualna i nie może ich nadpisać.
    const { bounds: _bounds, displayId: _displayId, ...gaming } = normalizeGamingSettings(result.gaming)
    result.gaming = gaming as typeof result.gaming
  }
  return result
}

export function isValidSecretInput(
  input: unknown,
  allowedKeys: readonly UserSecretKey[]
): input is { key: UserSecretKey; value: string } {
  if (!input || typeof input !== 'object') return false
  const { key, value } = input as { key?: unknown; value?: unknown }
  return (
    typeof key === 'string' &&
    (allowedKeys as readonly string[]).includes(key) &&
    typeof value === 'string' &&
    value.length <= MAX_SECRET_LENGTH
  )
}

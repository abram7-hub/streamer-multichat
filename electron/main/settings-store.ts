import Store from 'electron-store'
import type { AppSettings } from '../../shared/settings'
import { migrateSettings, normalizeSettings, storeDefaults } from '../../shared/settings-migration'

const store = new Store<AppSettings>({
  name: 'config',
  // Bez schemaVersion/appearance - patrz storeDefaults(): migracja musi zobaczyć plik w wersji 1.0.x.
  defaults: storeDefaults() as AppSettings,
  clearInvalidConfig: true
})

/**
 * Ustawienia trzymane w pamięci. `store.store` z electron-store przy KAŻDYM odczycie wykonuje
 * `fs.readFileSync` + `JSON.parse` całego pliku config.json - a `getSettings()` jest wołane kilka
 * razy na każdą wiadomość czatu (filtr ignorowanych, wyróżnianie, emotki 7TV/BTTV...). Przy dużym
 * ruchu oznaczało to setki synchronicznych odczytów dysku na sekundę w procesie głównym. Plik
 * zmienia wyłącznie ta aplikacja (przez funkcje poniżej), więc cache jest zawsze aktualny.
 */
let cached: AppSettings | undefined

function refresh(): AppSettings {
  const stored = store.store
  // Migracja schematu jest zapisywana raz - kolejne starty widzą już bieżącą wersję.
  const migrated = migrateSettings(stored)
  if (migrated !== stored) store.set(migrated)
  // Każda ścieżka musi przejść przez normalizeSettings() - inaczej do renderera trafiałby "surowy"
  // obiekt, w którym nowo dodane pola u użytkowników ze starszym configiem byłyby `undefined`.
  cached = normalizeSettings(migrated)
  return cached
}

export function getSettings(): AppSettings {
  return cached ?? refresh()
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  store.set({ ...store.store, ...patch })
  return refresh()
}

export function updateSection<K extends keyof AppSettings>(key: K, patch: Partial<AppSettings[K]>): AppSettings {
  const current = store.store
  store.set(key, { ...(current[key] as object), ...patch })
  return refresh()
}

import { useChatStore, type ChatState } from '../store/useChatStore'

/**
 * Jedyna ścieżka zmiany trybu demo w rendererze. Stan trzymany jest w ustawieniach (proces main
 * zapisuje go w config.json), a obie kontrolki - na pasku czatu i w Ustawieniach - czytają go
 * z tego samego `settings` w store, więc zawsze pokazują to samo.
 */
export async function setDemoMode(enabled: boolean): Promise<void> {
  const updated = await window.api.setDemoEnabled(enabled)
  useChatStore.getState().setSettings(updated)
}

export const selectDemoMode = (state: ChatState): boolean => state.settings?.demoMode ?? false

interface ViewProps {
  demoMode: boolean
  onChange: (enabled: boolean) => void
}

export function DemoModeToolbarToggleView({ demoMode, onChange }: ViewProps) {
  return (
    <button
      className="icon-btn demo-toggle"
      data-active={demoMode}
      aria-pressed={demoMode}
      title={demoMode ? 'Wyłącz tryb demonstracyjny' : 'Włącz tryb demonstracyjny (przykładowe wiadomości)'}
      onClick={() => onChange(!demoMode)}
    >
      Demo: {demoMode ? 'ON' : 'OFF'}
    </button>
  )
}

export function DemoModeSettingsCheckboxView({ demoMode, onChange }: ViewProps) {
  return (
    <label className="checkbox-row">
      <input type="checkbox" checked={demoMode} onChange={(e) => onChange(e.target.checked)} />
      Tryb demonstracyjny (przykładowe wiadomości bez realnych połączeń)
    </label>
  )
}

const changeDemoMode = (enabled: boolean): void => void setDemoMode(enabled)

/** Szybki przełącznik na pasku nad czatem. */
export function DemoModeToolbarToggle() {
  return <DemoModeToolbarToggleView demoMode={useChatStore(selectDemoMode)} onChange={changeDemoMode} />
}

/** Pole w zakładce Ogólne w Ustawieniach. */
export function DemoModeSettingsCheckbox() {
  return <DemoModeSettingsCheckboxView demoMode={useChatStore(selectDemoMode)} onChange={changeDemoMode} />
}

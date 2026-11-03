import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/settings'
import {
  DEFAULT_GAMING_HOTKEY,
  formatAccelerator,
  isValidAccelerator,
  type GamingFilter,
  type GamingOverlaySettings,
  type GamingOverlayState
} from '@shared/gaming'
import { Section, Segmented, Select, SettingRow, Slider, Switch } from './controls'

type PatchSection = <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>

const LIFETIME_PRESETS = [0, 5, 10, 15, 30] as const
const MAX_VISIBLE_PRESETS = [1, 3, 5, 10] as const

function useGamingState(): GamingOverlayState | undefined {
  const [state, setState] = useState<GamingOverlayState>()
  useEffect(() => {
    void window.api.gamingGetState().then(setState)
    return window.api.onGamingState(setState)
  }, [])
  return state
}

/** Wybór z gotowych wartości albo własna liczba (np. czas wiadomości, limit widocznych). */
function PresetNumber({
  label,
  value,
  presets,
  format,
  min,
  max,
  unit,
  onChange
}: {
  label: string
  value: number
  presets: readonly number[]
  format: (n: number) => string
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  const isPreset = presets.includes(value)
  const [custom, setCustom] = useState(!isPreset)
  const options = [...presets.map((n) => ({ value: String(n), label: format(n) })), { value: 'custom', label: 'Własna' }]
  return (
    <div className="preset-number">
      <Segmented
        label={label}
        value={custom ? 'custom' : String(value)}
        options={options}
        onChange={(v) => {
          if (v === 'custom') setCustom(true)
          else {
            setCustom(false)
            onChange(Number(v))
          }
        }}
      />
      {custom && (
        <span className="preset-number-custom">
          <input
            className="text-input text-input-short"
            type="number"
            aria-label={`${label} - własna wartość`}
            min={min}
            max={max}
            defaultValue={value}
            onBlur={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n))
            }}
          />
          {unit}
        </span>
      )}
    </div>
  )
}

function HotkeyField({ value, registered, onChange }: { value: string; registered: boolean | undefined; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const valid = isValidAccelerator(draft)
  return (
    <div className="hotkey-field">
      <input
        className="text-input"
        aria-label="Skrót trybu edycji"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (valid && draft !== value) onChange(draft)
        }}
      />
      <button type="button" className="btn btn-small" disabled={value === DEFAULT_GAMING_HOTKEY} onClick={() => onChange(DEFAULT_GAMING_HOTKEY)}>
        Domyślny
      </button>
      {!valid && <div className="setting-row-hint field-error">Format: modyfikatory i jeden klawisz, np. CommandOrControl+Alt+Shift+G.</div>}
      {valid && registered === false && <div className="setting-row-hint field-error">Ten skrót jest zajęty przez inną aplikację - wybierz inny.</div>}
    </div>
  )
}

export function GamingOverlayPage({
  settings,
  patchSection,
  onEditAppearance,
  onEditAnimations
}: {
  settings: AppSettings
  patchSection: PatchSection
  onEditAppearance: () => void
  onEditAnimations: () => void
}) {
  const g = settings.gaming
  const state = useGamingState()
  const patch = (p: Partial<GamingOverlaySettings>): void => void patchSection('gaming', p)
  const hotkey = formatAccelerator(g.editHotkey)
  const editing = state?.mode === 'edit'

  return (
    <>
      <Section
        title="Okno nakładki"
        description="Przezroczyste okno z czatem wyświetlane nad grą. Działa w grach w oknie i w trybie pełnoekranowym bez ramki (borderless). Nad grami w wyłącznym trybie pełnoekranowym system może go nie pokazać."
      >
        <SettingRow label="Włącz Gaming Overlay">
          <Switch label="Włącz Gaming Overlay" checked={g.enabled} onChange={(v) => patch({ enabled: v })} />
        </SettingRow>
        <SettingRow label="Pokaż nakładkę" hint="Przywraca nakładkę na wierzch, jeśli przykryło ją inne okno.">
          <button type="button" className="btn btn-small" disabled={!state?.open} onClick={() => void window.api.gamingShow()}>
            Pokaż
          </button>
        </SettingRow>
        <SettingRow label="Przepuszczaj kliknięcia" hint="Po zablokowaniu mysz przechodzi przez nakładkę do gry.">
          <Switch label="Przepuszczaj kliknięcia" checked={g.clickThrough} onChange={(v) => patch({ clickThrough: v })} />
        </SettingRow>
        <SettingRow label="Tryb edycji" hint={`Przesuwanie i zmiana rozmiaru. Skrót ${hotkey} działa również w grze.`}>
          <button type="button" className="btn btn-small" disabled={!state?.open} onClick={() => void window.api.gamingSetMode(editing ? 'locked' : 'edit')}>
            {editing ? 'Zablokuj' : 'Edytuj położenie'}
          </button>
        </SettingRow>
        <SettingRow label="Skrót trybu edycji" hint="Globalny - włącza edycję i wyłącza przepuszczanie kliknięć, ponowne użycie blokuje nakładkę.">
          <HotkeyField value={g.editHotkey} registered={state?.open ? state.hotkeyRegistered : undefined} onChange={(v) => patch({ editHotkey: v })} />
        </SettingRow>
        <SettingRow label="Pozycja" hint="Prawy dolny róg głównego monitora.">
          <button type="button" className="btn btn-small" onClick={() => void window.api.gamingResetPosition()}>
            Przywróć pozycję domyślną
          </button>
        </SettingRow>
      </Section>

      <Section title="Widoczność">
        <SettingRow label="Przezroczystość nakładki" hint="Cała warstwa: wiadomości razem z tłem.">
          <Slider label="Przezroczystość nakładki" min={10} max={100} unit="%" value={g.layerOpacity} onChange={(v) => patch({ layerOpacity: v })} />
        </SettingRow>
        <SettingRow label="Tło okna" hint="0% - widać tylko wiadomości. Tło samych wiadomości ustawiasz w Wygląd czatu.">
          <Slider label="Tło okna" min={0} max={100} unit="%" value={g.backgroundOpacity} onChange={(v) => patch({ backgroundOpacity: v })} />
        </SettingRow>
        <SettingRow label="Pokazuj tylko przy aktywności" hint="Bez wiadomości nakładka jest niewidoczna.">
          <Switch label="Pokazuj tylko przy aktywności" checked={g.showOnlyOnActivity} onChange={(v) => patch({ showOnlyOnActivity: v })} />
        </SettingRow>
      </Section>

      <Section title="Wiadomości" description="Dotyczy tylko Gaming Overlay - czat główny i OBS pokazują wszystko jak dotąd.">
        <SettingRow label="Czas wyświetlania">
          <PresetNumber
            label="Czas wyświetlania"
            value={g.lifetimeSec}
            presets={LIFETIME_PRESETS}
            format={(n) => (n === 0 ? 'Zawsze' : `${n} s`)}
            min={1}
            max={600}
            unit=" s"
            onChange={(v) => patch({ lifetimeSec: v })}
          />
        </SettingRow>
        <SettingRow label="Maksymalna liczba widocznych">
          <PresetNumber
            label="Maksymalna liczba widocznych"
            value={g.maxVisible}
            presets={MAX_VISIBLE_PRESETS}
            format={(n) => String(n)}
            min={1}
            max={50}
            unit=""
            onChange={(v) => patch({ maxVisible: v })}
          />
        </SettingRow>
        <SettingRow label="Filtr" hint='Wzmianki ustawiasz w sekcji "Wzmianki".'>
          <Select<GamingFilter>
            label="Filtr"
            value={g.filter}
            options={[
              { value: 'all', label: 'Wszystkie wiadomości' },
              { value: 'events', label: 'Tylko eventy' },
              { value: 'mentions', label: 'Tylko wzmianki' },
              { value: 'mentions-events', label: 'Wzmianki + eventy' }
            ]}
            onChange={(v) => patch({ filter: v })}
          />
        </SettingRow>
      </Section>

      <Section title="Czytelność tekstu">
        <SettingRow label="Cień tekstu">
          <Switch label="Cień tekstu" checked={g.textShadow} onChange={(v) => patch({ textShadow: v })} />
        </SettingRow>
        <SettingRow label="Obrys tekstu">
          <Switch label="Obrys tekstu" checked={g.textOutline} onChange={(v) => patch({ textOutline: v })} />
        </SettingRow>
        {g.textOutline && (
          <SettingRow label="Grubość obrysu">
            <Slider label="Grubość obrysu" min={1} max={3} unit=" px" value={g.outlineWidthPx} onChange={(v) => patch({ outlineWidthPx: v })} />
          </SettingRow>
        )}
      </Section>

      <Section title="Wygląd i animacje" description="Czcionka, rozmiary, kolory, układ i animacje wiadomości w zakresie Gaming Overlay.">
        <div className="row">
          <button type="button" className="btn" onClick={onEditAppearance}>
            Wygląd Gaming Overlay
          </button>
          <button type="button" className="btn" onClick={onEditAnimations}>
            Animacje Gaming Overlay
          </button>
        </div>
      </Section>
    </>
  )
}

import { useId, type ReactNode } from 'react'

/** Nagłówek sekcji strony ustawień z opcjonalnym opisem. */
export function Section({
  title,
  description,
  onReset,
  children
}: {
  title: string
  description?: ReactNode
  /** Przycisk "Przywróć domyślne" tej sekcji (tylko ta sekcja, bez globalnego resetu). */
  onReset?: () => void
  children: ReactNode
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h3 className="settings-section-title">{title}</h3>
        {onReset && (
          <button type="button" className="btn btn-small section-reset" onClick={onReset}>
            Przywróć domyślne
          </button>
        )}
      </div>
      {description && <p className="settings-section-description">{description}</p>}
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

/** Wiersz ustawienia: etykieta (i opis) po lewej, kontrolka po prawej. */
export function SettingRow({
  label,
  hint,
  children,
  aside
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  /** Dodatkowy element obok etykiety (np. znacznik nadpisania). */
  aside?: ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-text">
        <div className="setting-row-label">
          {label}
          {aside}
        </div>
        {hint && <div className="setting-row-hint">{hint}</div>}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      data-on={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  label
}: {
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  label: string
}) {
  return (
    <div className="slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">
        {value}
        {unit}
      </span>
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="segmented-option"
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId()
  return (
    <label className="color-input" htmlFor={id} title={label}>
      <input id={id} type="color" aria-label={label} value={value.toLowerCase()} onChange={(e) => onChange(e.target.value)} />
      <span className="color-input-value">{value.toUpperCase()}</span>
    </label>
  )
}

/** Rzadziej używane opcje - domyślnie zwinięte. */
export function Advanced({ children, title = 'Zaawansowane' }: { children: ReactNode; title?: string }) {
  return (
    <details className="settings-advanced">
      <summary>{title}</summary>
      <div className="settings-advanced-body">{children}</div>
    </details>
  )
}

/** Miejsce na funkcję zaplanowaną w kolejnej wersji - bez udawania, że działa. */
export function Planned({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-planned">
      <div className="settings-planned-badge">W przygotowaniu</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

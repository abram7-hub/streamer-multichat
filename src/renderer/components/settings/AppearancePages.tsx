import { useMemo, useState, type ReactNode } from 'react'
import type { ChatMessage } from '@shared/chat-message'
import { PLATFORMS, PLATFORM_LABELS, type Platform } from '@shared/platform'
import {
  APPEARANCE_LIMITS,
  chatLayout,
  clearAppearanceOverride,
  DEFAULT_PLATFORM_COLORS,
  resetPlatformColor,
  resolveAppearance,
  setAppearanceValue,
  setPlatformColor,
  type AppearanceSettings,
  type AppearanceTarget,
  type ChatAppearance,
  type EffectIntensity,
  type EntryAnimation,
  type MessageEffect,
  type MessageWidth,
  type NewMessagePosition,
  type PlatformColor,
  type PlatformColors,
  type StackAnchor
} from '@shared/appearance'
import { DEFAULT_MENTION_HIGHLIGHT, type MentionHighlightSettings } from '@shared/mentions'
import {
  ANIMATION_SECTION_FIELDS,
  APPEARANCE_SECTION_FIELDS,
  applyPreset,
  detectPreset,
  PRESET_IDS,
  PRESETS,
  resetAppearanceFields,
  resetPlatformColors,
  type PresetState
} from '@shared/presets'
import { useChatStore } from '../../store/useChatStore'
import { ChatList, formatTime, MessageContent, useFreshFlag } from '../ChatList'
import { Advanced, ColorInput, Section, Segmented, Select, SettingRow, Slider, Switch } from './controls'

export type AppearanceScope = AppearanceTarget | 'common'

const SAVE_DELAY_MS = 200

/**
 * Edycja wyglądu: zmiana trafia od razu do store'u (czat główny i podgląd reagują natychmiast),
 * a zapis do pliku ustawień jest odłożony o chwilę - przeciąganie suwaka nie zapisuje pliku
 * kilkadziesiąt razy na sekundę. Niezapisana zmiana jest zapisywana przy zamknięciu ustawień.
 */
let pendingAppearance: AppearanceSettings | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Zapisuje odłożoną zmianę wyglądu od razu (np. przy zamykaniu ustawień). */
export async function flushAppearanceSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  const next = pendingAppearance
  pendingAppearance = undefined
  if (!next) return
  const updated = await window.api.updateSettings({ appearance: next })
  // Nowsza zmiana czeka już na zapis - nie cofamy jej odpowiedzią na starszy zapis.
  if (!pendingAppearance) useChatStore.getState().setSettings(updated)
}

export function updateAppearance(next: AppearanceSettings): void {
  const current = useChatStore.getState().settings
  if (!current) return
  useChatStore.getState().setSettings({ ...current, appearance: next })
  pendingAppearance = next
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushAppearanceSave(), SAVE_DELAY_MS)
}

export function useAppearanceEditor(): [AppearanceSettings, (next: AppearanceSettings) => void] {
  const appearance = useChatStore((s) => s.settings!.appearance)
  return [appearance, updateAppearance]
}

const SCOPE_OPTIONS: readonly { value: AppearanceScope; label: string }[] = [
  { value: 'main', label: 'Czat główny' },
  { value: 'obs', label: 'OBS Overlay' },
  { value: 'gaming', label: 'Gaming Overlay' },
  { value: 'common', label: 'Wspólne' }
]

const SCOPE_HINT: Record<AppearanceScope, string> = {
  main: 'Zmiany dotyczą tylko okna czatu. Pola oznaczone "własne" różnią się od ustawień wspólnych.',
  obs: 'Zmiany dotyczą tylko nakładki OBS. Pola oznaczone "własne" różnią się od ustawień wspólnych.',
  gaming: 'Zmiany dotyczą tylko Gaming Overlay. Pola oznaczone "własne" różnią się od ustawień wspólnych.',
  common: 'Ustawienia wspólne obowiązują wszędzie tam, gdzie czat główny lub OBS nie mają własnej wartości.'
}

function ScopePicker({ scope, onChange }: { scope: AppearanceScope; onChange: (scope: AppearanceScope) => void }) {
  return (
    <div className="scope-picker">
      <Segmented label="Zakres ustawień" value={scope} options={SCOPE_OPTIONS} onChange={onChange} />
      <p className="settings-section-description">{SCOPE_HINT[scope]}</p>
      <PresetPicker scope={scope} />
    </div>
  )
}

const PRESET_OPTIONS: readonly { value: PresetState; label: string; disabled?: boolean }[] = [
  ...PRESET_IDS.map((id) => ({ value: id as PresetState, label: PRESETS[id].label })),
  { value: 'custom', label: 'Własny', disabled: true }
]

/**
 * Preset dla wybranego zakresu. Zmienia tylko wygląd (i dla Gaming Overlay czas życia oraz liczbę
 * wiadomości); "Własny" pokazuje się sam po każdej ręcznej zmianie.
 */
function PresetPicker({ scope }: { scope: AppearanceScope }) {
  const settings = useChatStore((s) => s.settings!)
  const state = detectPreset(settings.appearance, scope, settings.gaming)
  const apply = async (id: PresetState): Promise<void> => {
    if (id === 'custom') return
    const result = applyPreset(settings.appearance, scope, id)
    updateAppearance(result.appearance)
    if (!result.gaming) return
    await flushAppearanceSave()
    const current = useChatStore.getState().settings!
    useChatStore.getState().setSettings(await window.api.updateSettings({ gaming: { ...current.gaming, ...result.gaming } }))
  }
  return (
    <div className="preset-picker">
      <SettingRow
        label="Preset"
        hint={state === 'custom' ? 'Własne ustawienia. Wybór presetu zastąpi animacje, odstępy, tło i rozmiar czcionki.' : PRESETS[state].description}
      >
        <Select<PresetState> label="Preset" value={state} options={PRESET_OPTIONS} onChange={(id) => void apply(id)} />
      </SettingRow>
    </div>
  )
}

/** Eksport i import samych ustawień wizualnych (bez tokenów, kanałów i listy ignorowanych). */
function VisualFileActions() {
  const [status, setStatus] = useState<{ text: string; error: boolean }>()
  const run = async (kind: 'export' | 'import'): Promise<void> => {
    await flushAppearanceSave()
    const result = kind === 'export' ? await window.api.exportVisualSettings() : await window.api.importVisualSettings()
    if (result.canceled) return setStatus(undefined)
    if (!result.ok) return setStatus({ text: result.message ?? 'Operacja nie powiodła się.', error: true })
    const imported = kind === 'import' ? (result as Awaited<ReturnType<typeof window.api.importVisualSettings>>).settings : undefined
    if (imported) useChatStore.getState().setSettings(imported)
    setStatus({ text: kind === 'export' ? 'Zapisano plik z wyglądem.' : 'Wczytano wygląd z pliku.', error: false })
  }
  return (
    <div className="file-actions">
      <button type="button" className="btn btn-small" onClick={() => void run('export')}>
        Eksportuj wygląd...
      </button>
      <button type="button" className="btn btn-small" onClick={() => void run('import')}>
        Importuj wygląd...
      </button>
      {status && (
        <span className="file-actions-status" data-error={status.error} role="status">
          {status.text}
        </span>
      )}
    </div>
  )
}

/** Wartości dla wybranego zakresu + zapis z automatycznym usuwaniem nadpisania równego wartości wspólnej. */
function useScopedAppearance(scope: AppearanceScope) {
  const [settings, update] = useAppearanceEditor()
  const values = scope === 'common' ? settings.common : resolveAppearance(settings, scope)
  const isOverridden = (key: keyof ChatAppearance): boolean => scope !== 'common' && key in settings.overrides[scope]
  const set = <K extends keyof ChatAppearance>(key: K, value: ChatAppearance[K]): void => {
    if (scope !== 'common' && settings.common[key] === value) update(clearAppearanceOverride(settings, scope, key))
    else update(setAppearanceValue(settings, scope, key, value))
  }
  const setMany = (patch: Partial<ChatAppearance>): void => {
    let next = settings
    for (const [key, value] of Object.entries(patch) as [keyof ChatAppearance, never][]) {
      next =
        scope !== 'common' && next.common[key] === value
          ? clearAppearanceOverride(next, scope, key)
          : setAppearanceValue(next, scope, key, value)
    }
    update(next)
  }
  const reset = (key: keyof ChatAppearance): void => {
    if (scope !== 'common') update(clearAppearanceOverride(settings, scope, key))
  }
  const resetSection = (fields: readonly (keyof ChatAppearance)[]): void => update(resetAppearanceFields(settings, scope, fields))
  return { settings, update, values, isOverridden, set, setMany, reset, resetSection }
}

function OverrideMark({ active, onReset }: { active: boolean; onReset: () => void }) {
  if (!active) return null
  return (
    <button type="button" className="override-mark" onClick={onReset} title="Przywróć wartość wspólną">
      własne ×
    </button>
  )
}

type Scoped = ReturnType<typeof useScopedAppearance>

function Row({ scoped, field, label, hint, children }: { scoped: Scoped; field: keyof ChatAppearance; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <SettingRow label={label} hint={hint} aside={<OverrideMark active={scoped.isOverridden(field)} onReset={() => scoped.reset(field)} />}>
      {children}
    </SettingRow>
  )
}

function NumberRow({ scoped, field, label, unit, hint }: { scoped: Scoped; field: keyof ChatAppearance; label: string; unit: string; hint?: ReactNode }) {
  const [min, max] = APPEARANCE_LIMITS[field]!
  return (
    <Row scoped={scoped} field={field} label={label} hint={hint}>
      <Slider label={label} min={min} max={max} unit={unit} value={scoped.values[field] as number} onChange={(v) => scoped.set(field, v as never)} />
    </Row>
  )
}

function BoolRow({ scoped, field, label, hint }: { scoped: Scoped; field: keyof ChatAppearance; label: string; hint?: ReactNode }) {
  return (
    <Row scoped={scoped} field={field} label={label} hint={hint}>
      <Switch label={label} checked={scoped.values[field] as boolean} onChange={(v) => scoped.set(field, v as never)} />
    </Row>
  )
}

type OrderKey = 'A' | 'B' | 'C' | 'D'
const ORDER_OPTIONS: readonly { value: OrderKey; label: string; anchor: StackAnchor; position: NewMessagePosition }[] = [
  { value: 'A', label: 'Od góry - nowe pod spodem', anchor: 'top', position: 'end' },
  { value: 'D', label: 'Od dołu - nowe na dole', anchor: 'bottom', position: 'anchor' },
  { value: 'C', label: 'Od góry - nowe na górze', anchor: 'top', position: 'anchor' },
  { value: 'B', label: 'Od dołu - nowe nad poprzednimi', anchor: 'bottom', position: 'end' }
]

export function orderKey(appearance: Pick<ChatAppearance, 'stackAnchor' | 'newMessagePosition'>): OrderKey {
  return ORDER_OPTIONS.find((o) => o.anchor === appearance.stackAnchor && o.position === appearance.newMessagePosition)!.value
}

function PlatformColorsEditor({ focus, onFocus }: { focus: Platform; onFocus: (p: Platform) => void }) {
  const [settings, update] = useAppearanceEditor()
  const set = (platform: Platform, patch: Partial<PlatformColor>): void => update(setPlatformColor(settings, platform, patch))
  return (
    <div className="platform-colors">
      {PLATFORMS.map((platform) => {
        const color = settings.platformColors[platform]
        const isDefault = JSON.stringify(color) === JSON.stringify(DEFAULT_PLATFORM_COLORS[platform])
        return (
          <div key={platform} className="platform-color-row" data-focused={focus === platform} onFocusCapture={() => onFocus(platform)} onPointerDown={() => onFocus(platform)}>
            <div className="platform-color-name">{PLATFORM_LABELS[platform]}</div>
            <div className="platform-color-controls">
              <span className="platform-color-label">Tło</span>
              <ColorInput label={`${PLATFORM_LABELS[platform]} - kolor tła`} value={color.background} onChange={(v) => set(platform, { background: v })} />
              <Slider label={`${PLATFORM_LABELS[platform]} - krycie tła`} min={0} max={100} unit="%" value={color.backgroundOpacity} onChange={(v) => set(platform, { backgroundOpacity: v })} />
              <span className="platform-color-label">Akcent</span>
              <ColorInput label={`${PLATFORM_LABELS[platform]} - kolor akcentu`} value={color.accent} onChange={(v) => set(platform, { accent: v })} />
              <button type="button" className="btn btn-small" disabled={isDefault} onClick={() => update(resetPlatformColor(settings, platform))}>
                Przywróć domyślne
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const PREVIEW_BADGES = {
  twitch: { id: 'moderator/1', type: 'moderator', label: 'Moderator', imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1', provider: 'twitch' as const },
  kick: { id: 'v2:level', type: 'level', label: 'Poziom', imageUrl: 'https://ext.cdn.kick.com/chat/badges/46_1629c3f5-cd67-4189-a508-be557265254d.png', provider: 'kick' as const },
  tiktok: { id: 'scene-8-0', type: 'scene-8', label: 'Poziom', imageUrl: 'https://p16-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv1_v1.png~tplv-obj.image', provider: 'tiktok' as const }
}

function previewMessage(id: string, platform: Platform, name: string, color: string, text: string, receivedAtMs: number, withEmote: boolean): ChatMessage {
  const badge = PREVIEW_BADGES[platform as keyof typeof PREVIEW_BADGES]
  return {
    id,
    platform,
    channel: 'podglad',
    author: { id: `preview-${id}`, username: name.toLowerCase(), displayName: name, color, badges: badge ? [badge] : [], isBroadcaster: false, isModerator: false, isSubscriber: false },
    fragments: withEmote
      ? [{ type: 'text', text: `${text} ` }, { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' }]
      : [{ type: 'text', text }],
    rawText: text,
    timestampMs: receivedAtMs || Date.now(),
    receivedAtMs,
    isHighlighted: false
  }
}

/** Przykładowa wzmianka w podglądzie (wyróżnienie z ustawień "Wzmianki"). */
function previewMention(id: string, receivedAtMs: number): ChatMessage {
  return { ...previewMessage(id, 'twitch', 'Widz_42', '#FF7F50', '@twoj_nick zagrasz jeszcze raz?', receivedAtMs, false), isHighlighted: true }
}

const OLDER_PLATFORMS: Platform[] = ['kick', 'youtube', 'tiktok', 'twitch']

/** Przykładowe wiadomości: dwie starsze (bez animacji) i jedna nowa w kolorach wybranej platformy. */
export function buildPreviewMessages(focus: Platform, replay: number, now: number): ChatMessage[] {
  const older = OLDER_PLATFORMS.filter((p) => p !== focus).slice(0, 2)
  return [
    previewMessage('p1', older[0]!, 'zielony_kompot', '#53FC18', 'siema ekipa', 1, false),
    previewMessage('p2', older[1]!, 'PixelDrwal', '#f44336', 'GG WP', 2, false),
    previewMessage(`new-${replay}`, focus, 'Test_Nick', '#1E90FF', 'Przykładowa wiadomość', now, true)
  ]
}

function PreviewRow({ message }: { message: ChatMessage }) {
  const fresh = useFreshFlag(message.receivedAtMs)
  return (
    <div className={`message-row chat-row${fresh ? ' fresh' : ''}`} data-platform={message.platform} data-mention={message.isHighlighted}>
      <span className="message-line">
        <span className="timestamp">{formatTime(message.timestampMs)} </span>
        <MessageContent message={message} fallbackColor="#fff" />
      </span>
    </div>
  )
}

/**
 * Podgląd na żywo: ten sam kontener i te same komponenty co czat, z wyglądem wybranego zakresu.
 * "Odtwórz animację" tworzy nowy wiersz przykładowy (nowy klucz) - nic nie trafia do prawdziwego czatu.
 */
export function AppearancePreview({
  appearance,
  colors,
  scope,
  focus,
  mention = DEFAULT_MENTION_HIGHLIGHT,
  newMention = false
}: {
  appearance: ChatAppearance
  colors: PlatformColors
  scope: AppearanceScope
  focus: Platform
  mention?: MentionHighlightSettings
  /** "Odtwórz animację" pokazuje nową wzmiankę zamiast zwykłej wiadomości (strona "Wzmianki"). */
  newMention?: boolean
}) {
  const [replay, setReplay] = useState(0)
  const chronological = useMemo(() => {
    const now = Date.now()
    const list = buildPreviewMessages(focus, replay, now)
    return newMention ? [...list.slice(0, -1), previewMention(`mention-${replay}`, now)] : list
  }, [focus, replay, newMention])
  const newestFirst = chatLayout(appearance).newestFirst
  const messages = useMemo(() => (newestFirst ? [...chronological].reverse() : chronological), [chronological, newestFirst])
  return (
    <div className="appearance-preview" data-scope={scope}>
      <div className="appearance-preview-header">
        <span>Podgląd</span>
        <button type="button" className="btn btn-small" onClick={() => setReplay((n) => n + 1)}>
          Odtwórz animację
        </button>
      </div>
      <ChatList className="appearance-preview-list" appearance={appearance} colors={colors} mention={mention}>
        {messages.map((m) => (
          <PreviewRow key={m.id} message={m} />
        ))}
      </ChatList>
    </div>
  )
}

function previewAppearance(settings: AppearanceSettings, scope: AppearanceScope): ChatAppearance {
  return scope === 'common' ? settings.common : resolveAppearance(settings, scope)
}

export function AppearancePage({ scope, onScopeChange }: { scope: AppearanceScope; onScopeChange: (scope: AppearanceScope) => void }) {
  const scoped = useScopedAppearance(scope)
  const mentionHighlight = useChatStore((s) => s.settings!.mentions.highlight)
  const [focus, setFocus] = useState<Platform>('twitch')
  const v = scoped.values
  return (
    <div className="settings-page-with-preview">
      <div className="settings-page-main">
        <ScopePicker scope={scope} onChange={onScopeChange} />
        <Section title="Tekst i elementy wiadomości" onReset={() => scoped.resetSection(APPEARANCE_SECTION_FIELDS)}>
          <NumberRow scoped={scoped} field="fontSizePx" label="Rozmiar czcionki" unit=" px" />
          <NumberRow scoped={scoped} field="emoteScale" label="Rozmiar emotek" unit="%" />
          <NumberRow scoped={scoped} field="badgeScale" label="Rozmiar odznak" unit="%" />
          <NumberRow scoped={scoped} field="iconSizePx" label="Rozmiar ikony platformy" unit=" px" />
          <BoolRow scoped={scoped} field="showBadges" label="Odznaki" />
          <BoolRow scoped={scoped} field="showTimestamps" label="Znaczniki czasu" />
        </Section>
        <Section title="Układ">
          <Row scoped={scoped} field="stackAnchor" label="Kolejność wiadomości" hint="Gdzie stoi pierwsza wiadomość i gdzie pojawiają się kolejne.">
            <Select
              label="Kolejność wiadomości"
              value={orderKey(v)}
              options={ORDER_OPTIONS}
              onChange={(key) => {
                const option = ORDER_OPTIONS.find((o) => o.value === key)!
                scoped.setMany({ stackAnchor: option.anchor, newMessagePosition: option.position })
              }}
            />
          </Row>
          <NumberRow scoped={scoped} field="messageSpacingPx" label="Odstęp między wiadomościami" unit=" px" />
          <NumberRow scoped={scoped} field="borderRadiusPx" label="Zaokrąglenie rogów" unit=" px" />
          <BoolRow scoped={scoped} field="compact" label="Tryb kompaktowy" hint="Mniejsze marginesy i ciaśniejsze wiersze." />
          <Row scoped={scoped} field="width" label="Szerokość tła wiadomości">
            <Segmented<MessageWidth>
              label="Szerokość tła wiadomości"
              value={v.width}
              options={[
                { value: 'full', label: 'Pełna' },
                { value: 'fit', label: 'Do treści' }
              ]}
              onChange={(value) => scoped.set('width', value)}
            />
          </Row>
        </Section>
        <Section title="Tło wiadomości">
          <BoolRow scoped={scoped} field="backgroundsEnabled" label="Kolorowe tło wg platformy" />
          <NumberRow
            scoped={scoped}
            field="backgroundIntensity"
            label="Intensywność tła"
            unit="%"
            hint="Mnożnik krycia ustawionego dla każdej platformy poniżej (100% = bez zmian)."
          />
        </Section>
        <Section
          title="Kolory platform"
          description="Wspólne dla czatu głównego i nakładki OBS. Akcent to kolor pulsowania i krawędzi zdarzeń."
          onReset={() => scoped.update(resetPlatformColors(scoped.settings))}
        >
          <PlatformColorsEditor focus={focus} onFocus={setFocus} />
        </Section>
        <Section
          title="Eksport i import wyglądu"
          description="Plik zawiera tylko wygląd: ustawienia wspólne i nadpisania (czat, OBS, Gaming Overlay), kolory platform, animacje, wygląd Gaming Overlay i wyróżnienie wzmianek. Bez tokenów, kluczy, kanałów, listy ignorowanych i ścieżek plików."
        >
          <VisualFileActions />
        </Section>
      </div>
      <AppearancePreview
        appearance={previewAppearance(scoped.settings, scope)}
        colors={scoped.settings.platformColors}
        scope={scope}
        focus={focus}
        mention={mentionHighlight}
      />
    </div>
  )
}

const ENTRY_OPTIONS: readonly { value: EntryAnimation; label: string }[] = [
  { value: 'none', label: 'Brak' },
  { value: 'left', label: 'Od lewej' },
  { value: 'right', label: 'Od prawej' },
  { value: 'bottom', label: 'Od dołu' },
  { value: 'expand', label: 'Od środka' }
]
const EFFECT_OPTIONS: readonly { value: MessageEffect; label: string }[] = [
  { value: 'none', label: 'Brak' },
  { value: 'pulse', label: 'Pulsowanie kolorem' },
  { value: 'bounce', label: 'Bounce (pulsowanie rozmiarem)' },
  { value: 'pulse-bounce', label: 'Kolor + bounce' }
]
const INTENSITY_OPTIONS: readonly { value: EffectIntensity; label: string }[] = [
  { value: 'subtle', label: 'Delikatna' },
  { value: 'normal', label: 'Normalna' },
  { value: 'strong', label: 'Mocna' }
]

export function AnimationsPage({ scope, onScopeChange }: { scope: AppearanceScope; onScopeChange: (scope: AppearanceScope) => void }) {
  const scoped = useScopedAppearance(scope)
  const v = scoped.values
  return (
    <div className="settings-page-with-preview">
      <div className="settings-page-main">
        <ScopePicker scope={scope} onChange={onScopeChange} />
        <Section
          title="Nowe wiadomości"
          description="Animacje dotyczą tylko wiadomości, które właśnie przyszły - historia czatu się nie porusza."
          onReset={() => scoped.resetSection(ANIMATION_SECTION_FIELDS)}
        >
          <Row scoped={scoped} field="entryAnimation" label="Pojawienie się">
            <Select label="Pojawienie się" value={v.entryAnimation} options={ENTRY_OPTIONS} onChange={(value) => scoped.set('entryAnimation', value)} />
          </Row>
          <Row scoped={scoped} field="effect" label="Efekt dodatkowy">
            <Select label="Efekt dodatkowy" value={v.effect} options={EFFECT_OPTIONS} onChange={(value) => scoped.set('effect', value)} />
          </Row>
          <Row scoped={scoped} field="intensity" label="Intensywność">
            <Segmented label="Intensywność" value={v.intensity} options={INTENSITY_OPTIONS} onChange={(value) => scoped.set('intensity', value)} />
          </Row>
        </Section>
        <Advanced>
          <NumberRow
            scoped={scoped}
            field="animationDurationMs"
            label="Długość animacji pojawienia"
            unit=" ms"
            hint="Bounce trwa odpowiednio dłużej; pulsowanie kolorem zawsze ok. 2 s."
          />
        </Advanced>
        <p className="settings-footnote">
          Jeśli w systemie włączone jest ograniczenie animacji, nowe wiadomości tylko łagodnie się pojawiają, bez przesuwania
          i skalowania.
        </p>
      </div>
      <AppearancePreview appearance={previewAppearance(scoped.settings, scope)} colors={scoped.settings.platformColors} scope={scope} focus="twitch" />
    </div>
  )
}

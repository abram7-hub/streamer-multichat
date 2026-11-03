import { useMemo, useRef, useState } from 'react'
import type { AppSettings } from '@shared/settings'
import { PLATFORM_LABELS, PLATFORMS } from '@shared/platform'
import { resolveAppearance } from '@shared/appearance'
import {
  compileMentionMatcher,
  DEFAULT_MENTION_HIGHLIGHT,
  MENTION_LIMITS,
  normalizeKeywords,
  platformNicks,
  type MentionHighlightSettings,
  type MentionSettings,
  type MentionSoundSettings
} from '@shared/mentions'
import { useChatStore } from '../../store/useChatStore'
import { formatTime } from '../ChatList'
import { playMentionSound } from '../../mention-sound'
import { AppearancePreview } from './AppearancePages'
import { ColorInput, Section, SettingRow, Slider, Switch } from './controls'

type PatchSection = <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>

/** Plik dźwięku do ok. 500 KB - zapisywany w ustawieniach jako data URL, bez ścieżki na dysku. */
const MAX_SOUND_FILE_BYTES = Math.floor((MENTION_LIMITS.maxCustomSoundChars * 3) / 4) - 1024

function KeywordEditor({ keywords, onChange }: { keywords: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const add = (): void => {
    const phrase = draft.trim()
    if (!phrase) return setError('Fraza nie może być pusta.')
    if (keywords.some((k) => k.toLowerCase() === phrase.toLowerCase())) return setError('Ta fraza jest już na liście.')
    if (keywords.length >= MENTION_LIMITS.maxKeywords) return setError(`Najwyżej ${MENTION_LIMITS.maxKeywords} fraz.`)
    setError(undefined)
    setDraft('')
    onChange(normalizeKeywords([...keywords, phrase]))
  }
  const edit = (index: number, value: string): void => {
    const next = keywords.slice()
    next[index] = value
    // Pusta po edycji = usunięta; duplikat po edycji znika (zostaje pierwsze wystąpienie).
    onChange(normalizeKeywords(next))
  }
  return (
    <div>
      {keywords.length > 0 && (
        <ul className="keyword-list">
          {keywords.map((k, i) => (
            <li key={`${i}:${k}`} className="keyword-item">
              <input
                className="text-input"
                defaultValue={k}
                aria-label={`Fraza ${i + 1}`}
                maxLength={MENTION_LIMITS.maxKeywordLength}
                onBlur={(e) => e.target.value !== k && edit(i, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <button type="button" className="btn btn-small" onClick={() => onChange(keywords.filter((_, j) => j !== i))}>
                Usuń
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="keyword-add">
        <input
          className="text-input"
          value={draft}
          placeholder="np. C++, [TEST], giveaway"
          aria-label="Nowa fraza"
          maxLength={MENTION_LIMITS.maxKeywordLength}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" className="btn btn-small" onClick={add}>
          Dodaj
        </button>
      </div>
      {error && (
        <div className="setting-row-hint" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

function SoundFilePicker({ sound, onChange }: { sound: MentionSoundSettings; onChange: (patch: Partial<MentionSoundSettings>) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const pick = (file: File | undefined): void => {
    if (!file) return
    if (!file.type.startsWith('audio/')) return setError('To nie jest plik dźwiękowy.')
    if (file.size > MAX_SOUND_FILE_BYTES) return setError('Plik jest za duży (najwyżej ok. 500 KB).')
    const reader = new FileReader()
    reader.onload = () => {
      setError(undefined)
      onChange({ customData: String(reader.result), customName: file.name })
    }
    reader.onerror = () => setError('Nie udało się odczytać pliku.')
    reader.readAsDataURL(file)
  }
  return (
    <div className="file-actions">
      <span className="file-actions-status">{sound.customName || 'Domyślny sygnał'}</span>
      <button type="button" className="btn btn-small" onClick={() => input.current?.click()}>
        Wybierz plik...
      </button>
      {sound.customData && (
        <button type="button" className="btn btn-small" onClick={() => onChange({ customData: '', customName: '' })}>
          Domyślny
        </button>
      )}
      <input ref={input} type="file" accept="audio/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {error && (
        <span className="file-actions-status" data-error="true" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

function MentionHistory() {
  const history = useChatStore((s) => s.mentionHistory)
  if (history.length === 0) return <p className="settings-section-description">Brak wzmianek od uruchomienia aplikacji.</p>
  return (
    <ul className="mention-history">
      {[...history].reverse().map((m) => (
        <li key={`${m.platform}:${m.id}`}>
          <time>{formatTime(m.timestampMs)}</time>
          <strong>{m.author.displayName}</strong> ({PLATFORM_LABELS[m.platform]}): {m.rawText}
        </li>
      ))}
    </ul>
  )
}

export function MentionsPage({ settings, patchSection }: { settings: AppSettings; patchSection: PatchSection }) {
  const m = settings.mentions
  const patch = (p: Partial<MentionSettings>): void => void patchSection('mentions', p)
  const patchHighlight = (p: Partial<MentionHighlightSettings>): void => patch({ highlight: { ...m.highlight, ...p } })
  const patchSound = (p: Partial<MentionSoundSettings>): void => patch({ sound: { ...m.sound, ...p } })
  const nicks = platformNicks(settings)
  const detected = PLATFORMS.filter((p) => nicks[p]).map((p) => `${PLATFORM_LABELS[p]}: @${nicks[p]}`)
  const [sample, setSample] = useState('')
  const matcher = useMemo(() => compileMentionMatcher(m, nicks, settings.ui.highlightNick), [m, settings.ui.highlightNick, JSON.stringify(nicks)])
  const sampleHit = sample.trim() ? matcher.test(sample) : undefined
  const mainAppearance = useMemo(() => resolveAppearance(settings.appearance, 'main'), [settings.appearance])
  const highlightIsDefault = JSON.stringify(m.highlight) === JSON.stringify(DEFAULT_MENTION_HIGHLIGHT)

  return (
    <div className="settings-page-with-preview">
      <div className="settings-page-main">
        <Section title="Wykrywanie" description="Wzmianki są wyróżniane w czacie głównym, w nakładce OBS i w Gaming Overlay (filtr &quot;Tylko wzmianki&quot;).">
          <SettingRow label="Wykrywaj wzmianki">
            <Switch label="Wykrywaj wzmianki" checked={m.enabled} onChange={(v) => patch({ enabled: v })} />
          </SettingRow>
          <SettingRow
            label="Automatycznie wykrywaj mój nick"
            hint={detected.length > 0 ? `Z ustawień platform: ${detected.join(', ')}. Pasuje też z "@", na każdej platformie.` : 'Nick pojawi się po wpisaniu kanału w ustawieniach platform.'}
          >
            <Switch label="Automatycznie wykrywaj mój nick" checked={m.autoNick} onChange={(v) => patch({ autoNick: v })} />
          </SettingRow>
          <SettingRow label="Dodatkowy nick" hint="Wyróżniany na wszystkich platformach (np. inna nazwa, której używasz).">
            <input
              className="text-input"
              defaultValue={settings.ui.highlightNick}
              placeholder="np. twoj_nick"
              onBlur={(e) => void patchSection('ui', { highlightNick: e.target.value.trim() })}
            />
          </SettingRow>
        </Section>

        <Section title="Własne słowa i frazy" description="Dopasowywane jako zwykły tekst - znaki takie jak + . [ ] ( ) * nie mają specjalnego znaczenia.">
          <KeywordEditor keywords={m.keywords} onChange={(keywords) => patch({ keywords })} />
          <SettingRow label="Tylko całe słowa" hint='Np. "gra" nie pasuje do "program".'>
            <Switch label="Tylko całe słowa" checked={m.wholeWord} onChange={(v) => patch({ wholeWord: v })} />
          </SettingRow>
          <SettingRow label="Bez rozróżniania wielkości liter" hint="Domyślnie włączone. Nicki zawsze bez rozróżniania.">
            <Switch label="Bez rozróżniania wielkości liter" checked={!m.caseSensitive} onChange={(v) => patch({ caseSensitive: !v })} />
          </SettingRow>
          <SettingRow label="Sprawdź tekst" hint={sampleHit === undefined ? 'Wpisz przykładową wiadomość.' : sampleHit ? 'To byłaby wzmianka.' : 'To nie byłaby wzmianka.'}>
            <input className="text-input" value={sample} placeholder="np. @twoj_nick hej" onChange={(e) => setSample(e.target.value)} />
          </SettingRow>
        </Section>

        <Section title="Wyróżnienie" onReset={highlightIsDefault ? undefined : () => patch({ highlight: { ...DEFAULT_MENTION_HIGHLIGHT } })}>
          <SettingRow label="Kolor tła">
            <ColorInput label="Kolor tła wzmianki" value={m.highlight.background} onChange={(v) => patchHighlight({ background: v })} />
          </SettingRow>
          <SettingRow label="Krycie tła">
            <Slider label="Krycie tła wzmianki" min={0} max={100} unit="%" value={m.highlight.backgroundOpacity} onChange={(v) => patchHighlight({ backgroundOpacity: v })} />
          </SettingRow>
          <SettingRow label="Kolor krawędzi">
            <ColorInput label="Kolor krawędzi wzmianki" value={m.highlight.border} onChange={(v) => patchHighlight({ border: v })} />
          </SettingRow>
          <SettingRow label="Kolor błysku">
            <ColorInput label="Kolor błysku wzmianki" value={m.highlight.accent} onChange={(v) => patchHighlight({ accent: v })} />
          </SettingRow>
          <SettingRow label="Mocniejszy błysk" hint="Także przy wyłączonych zwykłych animacjach.">
            <Switch label="Mocniejszy błysk" checked={m.highlight.strongerPulse} onChange={(v) => patchHighlight({ strongerPulse: v })} />
          </SettingRow>
          <SettingRow label="Mocniejsze podskoczenie">
            <Switch label="Mocniejsze podskoczenie" checked={m.highlight.strongerBounce} onChange={(v) => patchHighlight({ strongerBounce: v })} />
          </SettingRow>
        </Section>

        <Section title="Dźwięk" description="Domyślnie wyłączony. Przy serii wzmianek gra najwyżej raz na podany odstęp.">
          <SettingRow label="Dźwięk przy wzmiance">
            <Switch label="Dźwięk przy wzmiance" checked={m.sound.enabled} onChange={(v) => patchSound({ enabled: v })} />
          </SettingRow>
          <SettingRow label="Głośność">
            <Slider label="Głośność dźwięku wzmianki" min={0} max={100} unit="%" value={m.sound.volume} onChange={(v) => patchSound({ volume: v })} />
          </SettingRow>
          <SettingRow label="Odstęp między dźwiękami">
            <Slider
              label="Odstęp między dźwiękami"
              min={MENTION_LIMITS.cooldownSec[0]}
              max={MENTION_LIMITS.cooldownSec[1]}
              unit=" s"
              value={m.sound.cooldownSec}
              onChange={(v) => patchSound({ cooldownSec: v })}
            />
          </SettingRow>
          <SettingRow label="Plik dźwięku" hint="Własny plik nie trafia do eksportu wyglądu.">
            <SoundFilePicker sound={m.sound} onChange={patchSound} />
          </SettingRow>
          <SettingRow label="Test">
            <button type="button" className="btn btn-small" onClick={() => playMentionSound(m.sound)}>
              Odtwórz
            </button>
          </SettingRow>
        </Section>

        <Section title="Ostatnie wzmianki" description={`Do ${MENTION_LIMITS.historySize} ostatnich, tylko w pamięci (znikają po zamknięciu aplikacji).`}>
          <MentionHistory />
        </Section>
      </div>
      <AppearancePreview appearance={mainAppearance} colors={settings.appearance.platformColors} scope="main" focus="twitch" mention={m.highlight} newMention />
    </div>
  )
}

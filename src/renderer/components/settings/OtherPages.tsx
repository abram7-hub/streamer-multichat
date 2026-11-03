import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/settings'
import { DemoModeSettingsCheckbox } from '../DemoModeControls'
import { Section, Segmented, SettingRow, Slider, Switch } from './controls'

type PatchSection = <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => Promise<void>

export function GeneralPage({ settings, patchSection }: { settings: AppSettings; patchSection: PatchSection }) {
  return (
    <>
      <Section title="Przewijanie czatu" description='Po przewinięciu w górę czat nie wraca sam do najnowszych - przycisk "N nowych wiadomości" przenosi do nich.'>
        <SettingRow label="Wstrzymaj autoscroll po najechaniu" hint="Gdy kursor jest nad czatem, nowe wiadomości nie przesuwają widoku. Odbieranie wiadomości trwa.">
          <Switch
            label="Wstrzymaj autoscroll po najechaniu"
            checked={settings.ui.pauseOnHover}
            onChange={(v) => void patchSection('ui', { pauseOnHover: v })}
          />
        </SettingRow>
      </Section>
      <Section
        title="Tryb demonstracyjny"
        description='Przykładowe wiadomości oznaczone jako "DEMO" ze wszystkich platform, bez łączenia z prawdziwymi czatami. Ten sam przełącznik jest na pasku nad czatem.'
      >
        <DemoModeSettingsCheckbox />
      </Section>
    </>
  )
}

export function EventsPage({ settings, patchSection }: { settings: AppSettings; patchSection: PatchSection }) {
  const t = settings.twitch
  return (
    <>
      <Section title="Zdarzenia w czacie" description="Suby, gifty, raidy, Bitsy i nagrody Channel Points pokazywane między wiadomościami.">
        <SettingRow label="Pokazuj zdarzenia w czacie">
          <Switch label="Pokazuj zdarzenia w czacie" checked={t.showStreamEvents} onChange={(v) => void patchSection('twitch', { showStreamEvents: v })} />
        </SettingRow>
        <SettingRow
          label="Zdarzenia EventSub mojego kanału (Twitch)"
          hint="Wymaga zalogowania jako właściciel kanału wpisanego w Platformy -> Twitch."
        >
          <Switch label="Zdarzenia EventSub" checked={t.eventSubEnabled} onChange={(v) => void patchSection('twitch', { eventSubEnabled: v })} />
        </SettingRow>
        <p className="help-text">
          EventSub działa WYŁĄCZNIE, gdy zalogowane konto jest właścicielem kanału - nie dla kanałów obserwowanych
          anonimowo. Wymagane uprawnienia OAuth: channel:read:redemptions (Channel Points - nagrody własne i
          automatyczne), channel:read:subscriptions (suby/resuby/gifty), bits:read (Bitsy), moderator:read:followers
          (followy), channel:read:hype_train (Hype Train). Raidy nie wymagają uprawnień. Jeśli logowałeś(-aś) się w
          starszej wersji aplikacji, wyloguj się i zaloguj ponownie, żeby nadać nowe uprawnienia. Na innych kanałach
          widoczne są tylko publiczne komunikaty czatu (suby, gifty, raid przychodzący, Bitsy, nagrody Channel Points Z
          TEKSTEM - bez ich nazwy) - bez nagród bez tekstu i bez followów.
        </p>
      </Section>
      <Section title="Wejścia i wyjścia z czatu (Twitch)">
        <SettingRow label="Powiadomienia JOIN/PART">
          <Switch
            label="Powiadomienia JOIN/PART"
            checked={t.showJoinPartNotifications}
            onChange={(v) => void patchSection('twitch', { showJoinPartNotifications: v })}
          />
        </SettingRow>
        {t.showJoinPartNotifications && (
          <SettingRow label="Gdzie pokazywać">
            <Segmented<'chat' | 'panel'>
              label="Gdzie pokazywać"
              value={t.joinPartDisplay}
              options={[
                { value: 'panel', label: 'Osobny panel' },
                { value: 'chat', label: 'Wspólny czat' }
              ]}
              onChange={(v) => void patchSection('twitch', { joinPartDisplay: v })}
            />
          </SettingRow>
        )}
        <p className="help-text">
          Dołączenie do POKOJU CZATU IRC to nie to samo, co rozpoczęcie oglądania transmisji - to dwie różne rzeczy.
          Połączenie jest anonimowe (bez logowania) i wykorzystuje capability `twitch.tv/membership` klasycznego IRC
          Twitcha. Na dużych kanałach Twitch z założenia przestaje wysyłać pełny komplet zdarzeń JOIN/PART - na
          małych/średnich kanałach działa wiarygodnie. Zaraz po (ponownym) połączeniu początkowy "tłum" obecnych osób jest
          wyciszony, żeby nie zalać czatu setkami powiadomień.
        </p>
      </Section>
    </>
  )
}

export function OverlayPage({
  settings,
  patchSection,
  onEditAppearance
}: {
  settings: AppSettings
  patchSection: PatchSection
  onEditAppearance: () => void
}) {
  const o = settings.overlay
  return (
    <>
      <Section title="Źródło w OBS">
        <p className="settings-section-description">
          Dodaj w OBS Studio źródło "Przeglądarka" (Browser Source) z adresem <code>http://127.0.0.1:{o.port}/</code>. Adres
          jest dostępny wyłącznie lokalnie na tym komputerze.
        </p>
        <SettingRow label="Port lokalny" hint="Zmiana wymaga ponownego uruchomienia aplikacji.">
          <input
            className="text-input text-input-short"
            type="number"
            min={1024}
            max={65535}
            defaultValue={o.port}
            onBlur={(e) => void patchSection('overlay', { port: Number(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Maksymalna liczba wiadomości">
          <input
            className="text-input text-input-short"
            type="number"
            min={5}
            max={500}
            defaultValue={o.maxMessages}
            onBlur={(e) => void patchSection('overlay', { maxMessages: Number(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Tło nakładki" hint="0% - w pełni przezroczyste.">
          <Slider label="Tło nakładki" min={0} max={100} unit="%" value={o.backgroundOpacity} onChange={(v) => void patchSection('overlay', { backgroundOpacity: v })} />
        </SettingRow>
      </Section>
      <Section title="Wygląd wiadomości w OBS" description="Czcionka, odznaki, kolory, kolejność i animacje nakładki ustawiasz w Wygląd czatu i Animacje, w zakresie OBS Overlay.">
        <button type="button" className="btn" onClick={onEditAppearance}>
          Otwórz wygląd OBS Overlay
        </button>
      </Section>
    </>
  )
}

export function PerformancePage({ settings, onSettingsChanged }: { settings: AppSettings; onSettingsChanged: (s: AppSettings) => void }) {
  return (
    <Section title="Streamowanie obok gry">
      <SettingRow
        label="Tryb niskiego zużycia zasobów"
        hint="Rzadsze odświeżanie listy, mniej wiadomości w pamięci, statyczne emotki 7TV/BTTV. Nie gubi wiadomości i nie zrywa połączeń."
      >
        <Switch
          label="Tryb niskiego zużycia zasobów"
          checked={settings.ui.lowResourceMode}
          onChange={async (lowResourceMode) => {
            const updated = await window.api.updateSettings({
              ui: { ...settings.ui, lowResourceMode },
              overlay: { ...settings.overlay, lowResourceMode }
            })
            onSettingsChanged(updated)
          }}
        />
      </SettingRow>
      <p className="help-text">
        Animacje nowych wiadomości działają na kompozytorze GPU (przesunięcie, skala, przezroczystość) i nie wymuszają
        przeliczania układu całej listy. Jeśli zależy Ci na minimalnym obciążeniu, ustaw w Animacje: brak animacji i brak
        efektu.
      </p>
    </Section>
  )
}

export function AboutPage() {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])
  return (
    <>
      <Section title="Streamer Multichat">
        <SettingRow label="Wersja">
          <span className="about-value">{version ?? '...'}</span>
        </SettingRow>
        <p className="settings-section-description">
          Czat z Twitcha, Kicka, YouTube i TikToka w jednym oknie oraz nakładka do OBS Studio.
        </p>
      </Section>
      <Section title="Dane aplikacji">
        <p className="settings-section-description">
          Ustawienia, zaszyfrowane dane logowania i log diagnostyczny (logs\diagnostics.log) są zapisywane w katalogu
          danych użytkownika: <code>%APPDATA%\streamer-multichat</code>.
        </p>
      </Section>
      <Section title="Licencja">
        <p className="settings-section-description">
          Użycie niekomercyjne: PolyForm Noncommercial License 1.0.0. Użycie komercyjne wymaga osobnej, pisemnej licencji
          od właściciela projektu. Komponenty zewnętrzne mają własne licencje (THIRD_PARTY_NOTICES.md).
        </p>
      </Section>
    </>
  )
}

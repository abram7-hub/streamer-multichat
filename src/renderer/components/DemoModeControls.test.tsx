import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import { useChatStore } from '../store/useChatStore'
import {
  DemoModeSettingsCheckboxView,
  DemoModeToolbarToggleView,
  selectDemoMode,
  setDemoMode
} from './DemoModeControls'

/** Atrapa procesu main: zapisuje demoMode i odsyła zapisane ustawienia (jak IPC demo:set-enabled). */
function fakeMain(initial: boolean) {
  let saved: AppSettings = { ...DEFAULT_SETTINGS, demoMode: initial }
  const setDemoEnabled = vi.fn(async (enabled: boolean) => {
    saved = { ...saved, demoMode: enabled }
    return saved
  })
  vi.stubGlobal('window', { api: { setDemoEnabled } })
  useChatStore.getState().setSettings(saved)
  return { setDemoEnabled, saved: () => saved }
}

/** Obie kontrolki renderowane z tego samego źródła stanu, tak jak robią to komponenty w aplikacji. */
function renderBoth(): { toolbar: string; settings: string } {
  const demoMode = selectDemoMode(useChatStore.getState())
  return {
    toolbar: renderToStaticMarkup(<DemoModeToolbarToggleView demoMode={demoMode} onChange={() => undefined} />),
    settings: renderToStaticMarkup(<DemoModeSettingsCheckboxView demoMode={demoMode} onChange={() => undefined} />)
  }
}

describe('Demo Mode controls share one state', () => {
  beforeEach(() => useChatStore.setState({ settings: undefined }))
  afterEach(() => vi.unstubAllGlobals())

  it('renders a clearly labelled toolbar toggle and a settings checkbox', () => {
    expect(renderToStaticMarkup(<DemoModeToolbarToggleView demoMode={false} onChange={() => undefined} />)).toContain('Demo: OFF')
    const on = renderToStaticMarkup(<DemoModeToolbarToggleView demoMode onChange={() => undefined} />)
    expect(on).toContain('Demo: ON')
    expect(on).toContain('aria-pressed="true"')
    expect(on).toContain('data-active="true"')
    expect(renderToStaticMarkup(<DemoModeSettingsCheckboxView demoMode onChange={() => undefined} />)).toContain('checked=""')
    expect(renderToStaticMarkup(<DemoModeSettingsCheckboxView demoMode={false} onChange={() => undefined} />)).not.toContain('checked')
  })

  it('F: turning demo ON in Settings shows ON in the chat toolbar', async () => {
    const main = fakeMain(false)
    expect(renderBoth().toolbar).toContain('Demo: OFF')

    await setDemoMode(true) // ścieżka checkboxa w Ustawieniach
    expect(main.setDemoEnabled).toHaveBeenCalledWith(true)
    expect(main.saved().demoMode).toBe(true)
    const view = renderBoth()
    expect(view.toolbar).toContain('Demo: ON')
    expect(view.settings).toContain('checked=""')
  })

  it('G: turning demo OFF from the chat toolbar shows OFF in Settings', async () => {
    const main = fakeMain(true)
    expect(renderBoth().settings).toContain('checked=""')

    await setDemoMode(false) // ścieżka przycisku na pasku czatu
    expect(main.setDemoEnabled).toHaveBeenCalledWith(false)
    expect(main.saved().demoMode).toBe(false)
    const view = renderBoth()
    expect(view.settings).not.toContain('checked')
    expect(view.toolbar).toContain('Demo: OFF')
  })

  it('the toggle asks for the opposite of the current state; the checkbox passes its own value', () => {
    const onToolbar = vi.fn()
    const toolbar = DemoModeToolbarToggleView({ demoMode: true, onChange: onToolbar })
    toolbar.props.onClick()
    expect(onToolbar).toHaveBeenCalledWith(false)

    const onCheckbox = vi.fn()
    const checkbox = DemoModeSettingsCheckboxView({ demoMode: false, onChange: onCheckbox })
    const input = (checkbox.props.children as ReactElement<{ onChange: (e: unknown) => void }>[])[0]!
    input.props.onChange({ target: { checked: true } })
    expect(onCheckbox).toHaveBeenCalledWith(true)
  })
})

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_APPEARANCE, resolveAppearance, setAppearanceValue, setPlatformColor } from '@shared/appearance'
import { ChatList } from './ChatList'
import { buildPreviewMessages, orderKey, AppearancePreview } from './settings/AppearancePages'
import { normalizeSettings } from '@shared/settings-migration'

describe('ChatList container', () => {
  it('carries appearance as CSS variables and data attributes (rows are not re-rendered on changes)', () => {
    const appearance = { ...resolveAppearance(DEFAULT_APPEARANCE, 'main'), entryAnimation: 'left' as const, effect: 'pulse-bounce' as const, showTimestamps: false }
    const html = renderToStaticMarkup(
      <ChatList appearance={appearance} colors={DEFAULT_APPEARANCE.platformColors}>
        <div />
      </ChatList>
    )
    expect(html).toContain('data-enter="left"')
    expect(html).toContain('data-effect="pulse-bounce"')
    expect(html).toContain('data-timestamps="false"')
    expect(html).toContain('--chat-font-size:15px')
    expect(html).toContain('--pc-twitch-bg:rgba(145, 70, 255, 0.100)')
    expect(html).toContain('justify-content:flex-start')
  })

  it('Main Chat and OBS overrides produce different containers', () => {
    const colors = DEFAULT_APPEARANCE.platformColors
    const s = setAppearanceValue(DEFAULT_APPEARANCE, 'obs', 'entryAnimation', 'right')
    const main = renderToStaticMarkup(<ChatList appearance={resolveAppearance(s, 'main')} colors={colors}>{null}</ChatList>)
    const obs = renderToStaticMarkup(<ChatList appearance={resolveAppearance(s, 'obs')} colors={colors}>{null}</ChatList>)
    expect(main).toContain('data-enter="none"')
    expect(main).toContain('--chat-font-size:15px')
    expect(obs).toContain('data-enter="right"')
    expect(obs).toContain('--chat-font-size:20px')
    expect(obs).toContain('justify-content:safe flex-end')
  })
})

describe('settings preview', () => {
  it('two older sample rows and one new row of the focused platform; replay creates a new row', () => {
    const now = Date.now()
    const first = buildPreviewMessages('kick', 0, now)
    expect(first.map((m) => m.platform)).toEqual(['youtube', 'tiktok', 'kick'])
    expect(first[2]!.author.displayName).toBe('Test_Nick')
    expect(first[2]!.receivedAtMs).toBe(now)
    expect(first.slice(0, 2).every((m) => m.receivedAtMs < 10)).toBe(true)
    expect(buildPreviewMessages('kick', 1, now)[2]!.id).not.toBe(first[2]!.id)
  })

  it('renders the newest row as animated, in the chosen order, with the chosen colours', () => {
    const settings = normalizeSettings({})
    const appearance = setPlatformColor(settings.appearance, 'twitch', { background: '#000080', backgroundOpacity: 50 })
    const ordered = setAppearanceValue(appearance, 'main', 'newMessagePosition', 'anchor') // C: newest on top
    const html = renderToStaticMarkup(<AppearancePreview appearance={resolveAppearance(ordered, 'main')} colors={ordered.platformColors} scope="main" focus="twitch" />)
    expect(html).toContain('--pc-twitch-bg:rgba(0, 0, 128, 0.500)')
    expect(html).toContain('Odtwórz animację')
    const rows = [...html.matchAll(/class="message-row chat-row( fresh)?" data-platform="(\w+)"/g)].map((m) => `${m[2]}${m[1] ? '*' : ''}`)
    // Układ C (nowe na górze): najnowsza, animowana wiadomość jest pierwsza; tylko ona ma klasę fresh.
    expect(rows).toEqual(['twitch*', 'youtube', 'kick'])
  })

  it('orderKey maps the two stored fields to the four options', () => {
    expect(orderKey({ stackAnchor: 'top', newMessagePosition: 'end' })).toBe('A')
    expect(orderKey({ stackAnchor: 'bottom', newMessagePosition: 'end' })).toBe('B')
    expect(orderKey({ stackAnchor: 'top', newMessagePosition: 'anchor' })).toBe('C')
    expect(orderKey({ stackAnchor: 'bottom', newMessagePosition: 'anchor' })).toBe('D')
  })
})

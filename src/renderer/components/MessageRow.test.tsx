import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatBadge, ChatMessage } from '@shared/chat-message'
import type { Platform } from '@shared/platform'
import { MessageRow } from './MessageRow'
import { OverlayRow } from './OverlayRow'

const noop = (): void => undefined

function message(overrides: Partial<ChatMessage> = {}, badges: ChatBadge[] = []): ChatMessage {
  const now = Date.now()
  return {
    id: 'm1',
    platform: 'twitch',
    channel: 'testnick_',
    author: {
      id: '1',
      username: 'testnick_',
      displayName: 'Testnick_',
      color: '#00FF7F',
      badges,
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments: [{ type: 'text', text: 'Siema!' }],
    rawText: 'Siema!',
    timestampMs: now,
    receivedAtMs: now,
    isHighlighted: false,
    ...overrides
  }
}

function render(m: ChatMessage): string {
  return renderToStaticMarkup(<MessageRow message={m} multiChannelPlatforms={new Set<Platform>()} onIgnoreUser={noop} />)
}

/**
 * Widoczny tekst wiersza (bez znaczników i atrybutów - tooltipy/aria-label nie są "tekstem w czacie").
 * Znacznik czasu jest zawsze w DOM, a ukrywa go CSS kontenera (data-timestamps) - tu go pomijamy.
 */
function visibleText(html: string): string {
  return html
    .replace(/<span class="timestamp">[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

const CDN = 'https://static-cdn.jtvnw.net/badges/v1'
const ROLE_WORDS = /broadcaster|moderator|subscriber|owner|member|vip|verified|nadawca|subskrybent|członek/i

const roleBadges = (provider: Platform): ChatBadge[] => [
  { id: 'broadcaster/1', type: 'broadcaster', label: 'Broadcaster', imageUrl: `${CDN}/b/1`, provider },
  { id: 'moderator/1', type: 'moderator', label: 'Moderator', provider }, // brak oficjalnego obrazka
  { id: 'vip/1', type: 'vip', label: 'VIP', imageUrl: `${CDN}/v/1`, imageUrl2x: `${CDN}/v/2`, provider },
  { id: 'subscriber/6', type: 'subscriber', label: 'Subscriber', imageUrl: 'https://evil.example.com/x.png', provider },
  { id: 'verified', type: 'verified', label: 'Verified', provider },
  { id: 'member', type: 'member', label: 'Member', provider },
  { id: 'owner', type: 'owner', label: 'Owner', provider }
]

describe('MessageRow — format, icons and badges', () => {
  it('renders "[platform icon] [badges] Nick: message" with no platform name or role text in the row', () => {
    const html = render(message({}, roleBadges('twitch')))
    expect(visibleText(html)).toBe('Testnick_: Siema!')
    expect(visibleText(html)).not.toMatch(ROLE_WORDS)
    expect(visibleText(html)).not.toMatch(/twitch|kick|youtube|tiktok/i)
    // Ikona platformy: tooltip + aria-label, bez tekstu.
    expect(html).toMatch(/class="platform-icon"[^>]*title="Twitch"[^>]*role="img"[^>]*aria-label="Twitch"/)
    // Tylko odznaki z oficjalnym obrazkiem z CDN Twitcha (broadcaster, VIP), z tooltipem i aria-label.
    const imgs = [...html.matchAll(/<img class="badge-img"[^>]*>/g)].map((m) => m[0])
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toMatch(/title="Broadcaster"/)
    expect(imgs[0]).toMatch(/aria-label="Broadcaster"/)
    expect(imgs[1]).toMatch(/srcSet="https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/v\/1 1x, https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/v\/2 2x"/)
    expect(html).not.toContain('evil.example.com')
    // Ikona -> odznaki -> nick, w tej kolejności.
    expect(html.indexOf('platform-icon')).toBeLessThan(html.indexOf('badge-img'))
    expect(html.indexOf('badge-img')).toBeLessThan(html.indexOf('author-name'))
  })

  it('no badges / unknown badge without image → nothing rendered (no empty slot, no text)', () => {
    expect(render(message())).not.toContain('class="badges"')
    const html = render(message({}, [{ id: 'x/1', type: 'x', label: 'x', provider: 'twitch' }]))
    expect(html).not.toContain('class="badges"')
  })

  it.each<Platform>(['kick', 'youtube', 'tiktok'])('%s: role labels never appear as text either', (platform) => {
    const html = render(message({ platform }, roleBadges(platform)))
    expect(visibleText(html)).toBe('Testnick_: Siema!')
  })

  it('never renders avatars (only badge/emote images)', () => {
    const html = render(message({}, roleBadges('twitch')))
    const imgs = [...html.matchAll(/<img class="([^"]+)"/g)].map((m) => m[1])
    expect(imgs.every((c) => c === 'badge-img' || c?.startsWith('emote-img'))).toBe(true)
  })

  it('/me: whole text in the real nick colour, emotes still rendered inside', () => {
    const html = render(
      message({
        isAction: true,
        fragments: [
          { type: 'text', text: 'tańczy ' },
          { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' }
        ]
      })
    )
    expect(visibleText(html)).toBe('Testnick_ tańczy ')
    expect(html).toMatch(/<span class="action-text" style="color:#00FF7F">.*emote-img/)
  })

  it('user-entered HTML stays text', () => {
    const html = render(message({ fragments: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }))
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('MessageRow - new message animation hook', () => {
  it.each<Platform>(['twitch', 'kick', 'youtube', 'tiktok'])('a fresh %s message gets the "fresh" class and its platform hook', (platform) => {
    const html = render(message({ platform }))
    expect(html).toMatch(new RegExp(`class="message-row chat-row fresh" data-platform="${platform}"`))
  })

  it('old messages (e.g. remounted after a filter change or reconnect) are not animated again', () => {
    const html = render(message({ receivedAtMs: Date.now() - 10_000 }))
    expect(html).toContain('class="message-row chat-row"')
    expect(html).not.toContain('fresh')
  })

  it('rows carry no inline appearance - colours and effects come from the ChatList container', () => {
    const html = render(message())
    expect(html).not.toMatch(/<div[^>]*style=/)
  })

  it('Channel Points redemption: Twitch icon, inline user text, pulse, Twitch background', () => {
    const html = render(
      message({
        fragments: [{ type: 'text', text: 'Napij się wody!' }],
        event: { kind: 'redemption', source: 'eventsub', rewardTitle: 'Hydratacja', rewardCost: 500 }
      })
    )
    expect(html).toMatch(/class="message-row chat-row event-row fresh" data-event="redemption" data-platform="twitch"/)
    expect(html).toContain('aria-label="Twitch"')
    expect(visibleText(html)).toBe('⭐Testnick_ odebrał(a) nagrodę „Hydratacja” · 500 pkt: Napij się wody!')
  })

  it.each([
    [{ kind: 'sub', source: 'irc' }, '🎁Testnick_ zasubskrybował(a) kanał!'],
    [{ kind: 'raid_in', source: 'irc', viewers: 84 }, '🚀Testnick_ zrobił(a) raid z 84 widzami!'],
    [{ kind: 'superchat', source: 'platform', amountFormatted: '20,00 zł' }, '💰Testnick_ — Super Chat 20,00 zł']
  ] as const)('stream event %j is animated as new and reads well', (event, text) => {
    const html = render(message({ fragments: [], event: { ...event } }))
    expect(html).toContain('fresh')
    expect(visibleText(html)).toBe(text)
  })

  it('reward icon must come from the Twitch CDN and has a fixed small size', () => {
    const ok = render(
      message({ fragments: [], event: { kind: 'redemption', source: 'eventsub', rewardTitle: 'X', rewardImageUrl: 'https://static-cdn.jtvnw.net/r/1.png' } })
    )
    expect(ok).toMatch(/<img class="event-reward-img"[^>]*width="18" height="18"/)
    const bad = render(
      message({ fragments: [], event: { kind: 'redemption', source: 'eventsub', rewardTitle: 'X', rewardImageUrl: 'https://evil.example.com/1.png' } })
    )
    expect(bad).not.toContain('evil.example.com')
  })
})

describe('OverlayRow (OBS) — same rules as the main window', () => {
  const renderOverlay = (m: ChatMessage): string => renderToStaticMarkup(<OverlayRow message={m} />)

  it('icon + image badges + Nick: text, no role text, animation hook on fresh rows only', () => {
    const html = renderOverlay(message({}, roleBadges('twitch')))
    expect(visibleText(html)).toBe('Testnick_: Siema!')
    expect([...html.matchAll(/class="badge-img"/g)]).toHaveLength(2)
    expect(html).toMatch(/class="overlay-row chat-row fresh" data-platform="twitch"/)
    expect(renderOverlay(message({ receivedAtMs: Date.now() - 10_000 }))).not.toContain('fresh')
  })

  it('uses the same message content as the main window (white nick when the platform gives no colour)', () => {
    const html = renderOverlay(message({ author: { ...message().author, color: undefined } }))
    expect(html).toContain('class="author-name" style="color:#fff"')
  })

  it('/me colour and events render in the overlay', () => {
    expect(renderOverlay(message({ isAction: true }))).toContain('style="color:#00FF7F"><span class="message-text">')
    const ev = renderOverlay(message({ fragments: [], event: { kind: 'cheer', source: 'irc', bits: 500 } }))
    expect(visibleText(ev)).toBe('💎Testnick_ wysłał(a) 500 Bitsów!')
  })
})

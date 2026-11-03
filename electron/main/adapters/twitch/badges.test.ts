import { describe, expect, it, vi } from 'vitest'
import { TwitchBadgeRegistry } from './badges'

const CDN = 'https://static-cdn.jtvnw.net/badges/v1'
const helix = (setId: string, id: string, title: string) => ({
  data: [{ set_id: setId, versions: [{ id, title, image_url_1x: `${CDN}/${setId}/1`, image_url_2x: `${CDN}/${setId}/2`, image_url_4x: `${CDN}/${setId}/3` }] }]
})

describe('TwitchBadgeRegistry (Helix cache)', () => {
  it('fetches global + per-channel badges once, then serves them from cache (never per message)', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('global') ? new Response(JSON.stringify(helix('vip', '1', 'VIP'))) : new Response(JSON.stringify(helix('subscriber', '12', '1-Year Subscriber')))
    )
    const registry = new TwitchBadgeRegistry(() => ({ token: 't', clientId: 'c' }), fetchMock as unknown as typeof fetch)
    registry.ensure('123')
    registry.ensure('123')
    await vi.waitFor(() => expect(registry.resolve('123', 'subscriber', '12')?.title).toBe('1-Year Subscriber'))
    for (let i = 0; i < 100; i++) registry.ensure('123')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(registry.resolve('123', 'vip', '1')?.url2x).toBe(`${CDN}/vip/2`)
    expect(registry.resolve('999', 'subscriber', '12')).toBeUndefined() // inny kanał — inne odznaki subów
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers)
    expect(headers.get('Client-Id')).toBe('c')
  })

  it('without a token nothing is fetched (anonymous mode) and nothing is resolved', () => {
    const fetchMock = vi.fn()
    const registry = new TwitchBadgeRegistry(() => undefined, fetchMock as unknown as typeof fetch)
    registry.ensure('123')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(registry.resolve('123', 'vip', '1')).toBeUndefined()
  })

  it('HTTP errors back off instead of retrying on every message', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new TwitchBadgeRegistry(() => ({ token: 't', clientId: 'c' }), fetchMock as unknown as typeof fetch)
    registry.ensure()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0))
    registry.ensure()
    registry.ensure()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    registry.resetFailures() // np. po ponownym zalogowaniu
    registry.ensure()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

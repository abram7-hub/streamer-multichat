import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage, MessageFragment } from '../../../../shared/chat-message'
import { applyThirdPartyEmotes, type ThirdPartyEmote } from './emote-apply'
import { parseSevenTvEmoteSet } from './seventv'
import { parseBttvChannel, parseBttvGlobal } from './bttv'
import { EmoteRegistry, type EmoteFetchers } from './emote-registry'
import { normalizeTwitchIrcMessage } from './irc-normalize'
import { parsePrivmsgLine } from './irc-tags'

const SEVENTV_HOST = '//cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6'

/** Kształt odpowiedzi skopiowany z prawdziwego `GET https://7tv.io/v3/emote-sets/global` (skrócony). */
const SEVENTV_GLOBAL_SAMPLE = {
  id: '01HKQT8EWR000ESSWF3625XCS4',
  name: 'Global Emotes',
  emotes: [
    {
      id: '01FCY771D800007PQ2DF3GDTN6',
      name: 'RainTime',
      flags: 1,
      data: {
        name: 'RainTime',
        flags: 256,
        animated: true,
        host: {
          url: SEVENTV_HOST,
          files: [
            { name: '1x.webp', static_name: '1x_static.webp', width: 32, height: 32, format: 'WEBP' },
            { name: '2x.webp', static_name: '2x_static.webp', width: 64, height: 64, format: 'WEBP' }
          ]
        }
      }
    },
    {
      id: '01EZTCN91800012PTN006Q50PR',
      name: 'OMEGALUL',
      flags: 0,
      data: {
        flags: 0,
        animated: false,
        host: {
          url: '//cdn.7tv.app/emote/01EZTCN91800012PTN006Q50PR',
          files: [{ name: '2x.webp', static_name: '2x_static.webp', width: 96, height: 64, format: 'WEBP' }]
        }
      }
    },
    // Wrogi/zepsuty wpis: URL spoza CDN 7TV - musi zostać odrzucony.
    { name: 'Evil', data: { host: { url: '//evil.example.com/x', files: [{ name: '2x.webp' }] } } },
    // Nazwa z białym znakiem nie może być emotką (nie da się jej dopasować jako słowa).
    { name: 'two words', data: { host: { url: SEVENTV_HOST, files: [{ name: '2x.webp' }] } } }
  ]
}

const BTTV_GLOBAL_SAMPLE = [
  { id: '566ca38765dbbdab32ec0560', code: 'SourPls', imageType: 'gif', animated: true, userId: 'x', modifier: false },
  { id: '54fa8fce01e468494b85b53c', code: 'CiGrip', imageType: 'png', animated: false, userId: 'x', modifier: false },
  { id: '../../etc/passwd', code: 'Bad', imageType: 'png', animated: false }
]

const BTTV_CHANNEL_SAMPLE = {
  id: '555943515393e61c772ee968',
  channelEmotes: [{ id: '5f3eb452b2efd65d77e867ed', code: 'forsenBlunder', imageType: 'png', animated: false }],
  sharedEmotes: [{ id: '5f593428aa6fe06bfb601eb1', code: 'OMEGALUL', imageType: 'png', animated: false, user: {} }]
}

function emote(name: string, provider: '7tv' | 'bttv', extra: Partial<ThirdPartyEmote> = {}): ThirdPartyEmote {
  const url = provider === '7tv' ? `https://cdn.7tv.app/emote/${name}/2x.webp` : `https://cdn.betterttv.net/emote/${name}/2x.webp`
  return { name, url, isZeroWidth: false, provider, ...extra }
}

function chatMessage(fragments: MessageFragment[]): ChatMessage {
  return {
    id: '1',
    platform: 'twitch',
    channel: 'testnick_',
    author: { id: '1', username: 'testnick_', displayName: 'Testnick_', badges: [], isBroadcaster: false, isModerator: false, isSubscriber: false },
    fragments,
    rawText: fragments.map((f) => f.text).join(''),
    timestampMs: 0,
    receivedAtMs: 0,
    isHighlighted: false
  }
}

describe('7TV parser', () => {
  it('parses real-shaped emote set, keeps animated + static URL, zero-width flag and aspect ratio', () => {
    const emotes = parseSevenTvEmoteSet(SEVENTV_GLOBAL_SAMPLE)
    expect(emotes.map((e) => e.name)).toEqual(['RainTime', 'OMEGALUL'])
    expect(emotes[0]).toEqual({
      name: 'RainTime',
      url: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/2x.webp',
      staticUrl: 'https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/2x_static.webp',
      isZeroWidth: true,
      provider: '7tv',
      ratio: 1
    })
    expect(emotes[1]?.isZeroWidth).toBe(false)
    expect(emotes[1]?.staticUrl).toBeUndefined() // nieanimowana - brak osobnej klatki statycznej
    expect(emotes[1]?.ratio).toBe(1.5)
  })

  it('returns an empty list for malformed responses instead of throwing', () => {
    expect(parseSevenTvEmoteSet(null)).toEqual([])
    expect(parseSevenTvEmoteSet({ emotes: 'nope' })).toEqual([])
    expect(parseSevenTvEmoteSet({ emotes: [null, 5, {}] })).toEqual([])
  })
})

describe('BTTV parser', () => {
  it('parses global emotes, builds CDN URLs, static frame for animated, rejects invalid ids', () => {
    const emotes = parseBttvGlobal(BTTV_GLOBAL_SAMPLE)
    expect(emotes.map((e) => e.name)).toEqual(['SourPls', 'CiGrip'])
    expect(emotes[0]).toMatchObject({
      url: 'https://cdn.betterttv.net/emote/566ca38765dbbdab32ec0560/2x.webp',
      staticUrl: 'https://cdn.betterttv.net/emote/566ca38765dbbdab32ec0560/static/2x.webp',
      provider: 'bttv',
      isZeroWidth: false
    })
    expect(emotes[1]?.staticUrl).toBeUndefined()
  })

  it('parses channel + shared emotes from the user endpoint', () => {
    const emotes = parseBttvChannel(BTTV_CHANNEL_SAMPLE)
    expect(emotes.map((e) => e.name).sort()).toEqual(['OMEGALUL', 'forsenBlunder'])
    expect(parseBttvChannel(undefined)).toEqual([])
  })
})

describe('applyThirdPartyEmotes', () => {
  it('replaces the BTTV/7TV code inline: "OMEGALUL ale akcja"', () => {
    const map = new Map([['OMEGALUL', emote('OMEGALUL', 'bttv')]])
    expect(applyThirdPartyEmotes([{ type: 'text', text: 'OMEGALUL ale akcja' }], map)).toEqual([
      { type: 'emote', text: 'OMEGALUL', url: 'https://cdn.betterttv.net/emote/OMEGALUL/2x.webp', provider: 'bttv' },
      { type: 'text', text: ' ale akcja' }
    ])
  })

  it('handles a message with several different emotes from different providers and native Twitch', () => {
    const map = new Map([
      ['OMEGALUL', emote('OMEGALUL', 'bttv')],
      ['catJAM', emote('catJAM', '7tv', { ratio: 1 })]
    ])
    const fragments: MessageFragment[] = [
      { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' },
      { type: 'text', text: ' OMEGALUL i catJAM xd' }
    ]
    const out = applyThirdPartyEmotes(fragments, map)
    expect(out.filter((f) => f.type === 'emote').map((f) => `${f.text}:${(f as { provider?: string }).provider}`)).toEqual([
      'Kappa:twitch',
      'OMEGALUL:bttv',
      'catJAM:7tv'
    ])
    expect(out.find((f) => f.text === 'catJAM')).toMatchObject({ ratio: 1 })
  })

  it('never overrides a native Twitch emote even if 7TV/BTTV has an emote with the same name', () => {
    const map = new Map([['Kappa', emote('Kappa', '7tv')]])
    const native: MessageFragment = { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' }
    expect(applyThirdPartyEmotes([native], map)).toEqual([native])
  })

  it('attaches a 7TV zero-width emote as an overlay of a preceding native Twitch emote without mutating the input', () => {
    const map = new Map([['RainTime', emote('RainTime', '7tv', { isZeroWidth: true })]])
    const native = { type: 'emote' as const, text: 'Kappa', url: 'https://static-cdn.jtvnw.net/x', provider: 'twitch' as const }
    const out = applyThirdPartyEmotes([native, { type: 'text', text: ' RainTime' }], map)
    expect(out[0]).toMatchObject({ text: 'Kappa', overlays: [{ text: 'RainTime' }] })
    expect((native as { overlays?: unknown }).overlays).toBeUndefined()
  })

  it('does not match emotes inside words or with different case', () => {
    const map = new Map([['OMEGALUL', emote('OMEGALUL', 'bttv')]])
    const out = applyThirdPartyEmotes([{ type: 'text', text: 'omegalul OMEGALULxd xOMEGALUL' }], map)
    expect(out.every((f) => f.type === 'text')).toBe(true)
  })
})

describe('EmoteRegistry', () => {
  function makeFetchers(overrides: Partial<EmoteFetchers> = {}) {
    const fetchers = {
      seventvGlobal: vi.fn(async () => [emote('Shared', '7tv'), emote('G7', '7tv')]),
      seventvChannel: vi.fn(async (_id: string) => [emote('C7', '7tv'), emote('Clash', '7tv')]),
      bttvGlobal: vi.fn(async () => [emote('Shared', 'bttv'), emote('GB', 'bttv'), emote('Clash2', 'bttv')]),
      bttvChannel: vi.fn(async (_id: string) => [emote('Clash', 'bttv'), emote('Clash2', 'bttv'), emote('CB', 'bttv')]),
      ...overrides
    }
    return fetchers
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('merges all four sets with priority: 7TV channel > BTTV channel > 7TV global > BTTV global', async () => {
    const reg = new EmoteRegistry({ isEnabled: () => true, preferStatic: () => false }, makeFetchers())
    reg.ensureChannel('123')
    await flush()
    const map = reg.getMap('123')
    expect(map.get('Shared')?.provider).toBe('7tv') // 7TV global > BTTV global
    expect(map.get('Clash')?.provider).toBe('7tv') // 7TV channel > BTTV channel
    expect(map.get('Clash2')?.provider).toBe('bttv') // BTTV channel > BTTV global (oba bttv)
    expect(map.get('Clash2')?.url).toContain('Clash2')
    for (const name of ['G7', 'GB', 'C7', 'CB']) expect(map.has(name)).toBe(true)
  })

  it('fetches lists once and reuses the cache for subsequent messages (no refetch per message)', async () => {
    const fetchers = makeFetchers()
    const reg = new EmoteRegistry({ isEnabled: () => true, preferStatic: () => false }, fetchers)
    reg.ensureChannel('123')
    await flush()
    for (let i = 0; i < 200; i++) reg.enrich(chatMessage([{ type: 'text', text: 'C7 hej' }]), '123')
    expect(fetchers.seventvGlobal).toHaveBeenCalledTimes(1)
    expect(fetchers.seventvChannel).toHaveBeenCalledTimes(1)
    expect(fetchers.bttvGlobal).toHaveBeenCalledTimes(1)
    expect(fetchers.bttvChannel).toHaveBeenCalledTimes(1)
  })

  it('loads a different emote set after switching channel (new room-id) and keeps globals shared', async () => {
    const fetchers = makeFetchers({
      seventvChannel: vi.fn(async (id: string) => [emote(id === '1' ? 'OnlyOne' : 'OnlyTwo', '7tv')])
    })
    const reg = new EmoteRegistry({ isEnabled: () => true, preferStatic: () => false }, fetchers)
    reg.ensureChannel('1')
    await flush()
    reg.ensureChannel('2')
    await flush()
    expect(reg.getMap('1').has('OnlyOne')).toBe(true)
    expect(reg.getMap('2').has('OnlyOne')).toBe(false)
    expect(reg.getMap('2').has('OnlyTwo')).toBe(true)
    expect(fetchers.seventvGlobal).toHaveBeenCalledTimes(1)
  })

  it('survives API errors: message stays plain text, other providers still work, retry after cooldown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const seventvGlobal = vi.fn(async (): Promise<ThirdPartyEmote[]> => {
        throw new Error('7TV down')
      })
      const fetchers = makeFetchers({
        seventvGlobal,
        seventvChannel: vi.fn(async () => {
          throw new Error('7TV down')
        })
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const reg = new EmoteRegistry({ isEnabled: () => true, preferStatic: () => false }, fetchers)
      reg.ensureChannel('9')
      await flush()
      const out = reg.enrich(chatMessage([{ type: 'text', text: 'G7 GB' }]), '9')
      expect(out.fragments).toEqual([
        { type: 'text', text: 'G7 ' },
        { type: 'emote', text: 'GB', url: 'https://cdn.betterttv.net/emote/GB/2x.webp', provider: 'bttv' }
      ])
      // W okresie karencji brak ponownych prób...
      reg.ensureChannel('9')
      expect(seventvGlobal).toHaveBeenCalledTimes(1)
      // ...po 61 s ponawiamy (reconnect 7TV), a gdy API wraca, emotki się pojawiają.
      seventvGlobal.mockImplementation(async () => [emote('G7', '7tv')])
      vi.setSystemTime(Date.now() + 61_000)
      reg.ensureChannel('9')
      await flush()
      expect(seventvGlobal).toHaveBeenCalledTimes(2)
      expect(reg.getMap('9').get('G7')?.provider).toBe('7tv')
      warn.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })

  it('respects disabled providers and the static-frame preference', async () => {
    let bttvOn = true
    const fetchers = makeFetchers({
      seventvChannel: vi.fn(async () => [emote('Anim', '7tv', { staticUrl: 'https://cdn.7tv.app/emote/Anim/2x_static.webp' })])
    })
    const reg = new EmoteRegistry({ isEnabled: (p) => p === 'seventv' || bttvOn, preferStatic: () => true }, fetchers)
    reg.ensureChannel('5')
    await flush()
    expect(reg.getMap('5').has('GB')).toBe(true)
    bttvOn = false
    reg.invalidate()
    expect(reg.getMap('5').has('GB')).toBe(false)
    const out = reg.enrich(chatMessage([{ type: 'text', text: 'Anim' }]), '5')
    expect(out.fragments[0]).toMatchObject({ url: 'https://cdn.7tv.app/emote/Anim/2x_static.webp' })
  })
})

describe('native Twitch emotes (IRC emotes tag)', () => {
  const line = (tags: string, text: string) =>
    parsePrivmsgLine(`@${tags} :testnick_!testnick_@testnick_.tmi.twitch.tv PRIVMSG #testnick_ :${text}`)!

  it('renders a static native emote with the 2.0 CDN url', () => {
    const msg = normalizeTwitchIrcMessage(line('id=1;user-id=1;emotes=25:0-4', 'Kappa hej'), 'testnick_')
    expect(msg.fragments[0]).toEqual({
      type: 'emote',
      text: 'Kappa',
      url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
      provider: 'twitch'
    })
  })

  it('uses the `default` format so animated native emotes (emotesv2_…) play as animated', () => {
    const msg = normalizeTwitchIrcMessage(line('id=1;user-id=1;emotes=emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7:0-6', 'DinoDance'), 'testnick_')
    expect(msg.fragments[0]).toMatchObject({
      url: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/default/dark/2.0'
    })
  })

  it('slices by Unicode code points, so an emoji before the emote does not shift it', () => {
    // "👋 Kappa" - 👋 to 1 punkt kodowy (2 jednostki UTF-16); Twitch podaje zakres 2-6.
    const msg = normalizeTwitchIrcMessage(line('id=1;user-id=1;emotes=25:2-6', '👋 Kappa'), 'testnick_')
    expect(msg.fragments).toEqual([
      { type: 'text', text: '👋 ' },
      { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' }
    ])
  })

  it('/me with a native emote: positions are relative to the text without the ACTION wrapper', () => {
    const msg = normalizeTwitchIrcMessage(line('id=1;user-id=1;emotes=25:6-10', '\u0001ACTION macha Kappa\u0001'), 'testnick_')
    expect(msg.isAction).toBe(true)
    expect(msg.fragments).toEqual([
      { type: 'text', text: 'macha ' },
      { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', provider: 'twitch' }
    ])
  })

  it('/me with a 7TV emote is enriched like a normal message', async () => {
    const reg = new EmoteRegistry(
      { isEnabled: () => true, preferStatic: () => false },
      {
        seventvGlobal: async () => [emote('catJAM', '7tv')],
        seventvChannel: async () => [],
        bttvGlobal: async () => [],
        bttvChannel: async () => []
      }
    )
    reg.ensureChannel('1')
    await new Promise((r) => setTimeout(r, 0))
    const msg = normalizeTwitchIrcMessage(line('id=1;user-id=1', '\u0001ACTION tańczy catJAM\u0001'), 'testnick_')
    const out = reg.enrich(msg, '1')
    expect(out.isAction).toBe(true)
    expect(out.fragments).toEqual([
      { type: 'text', text: 'tańczy ' },
      { type: 'emote', text: 'catJAM', url: 'https://cdn.7tv.app/emote/catJAM/2x.webp', provider: '7tv' }
    ])
  })

  it('ignores out-of-range or malicious emote ids/ranges and falls back to text', () => {
    const msg = normalizeTwitchIrcMessage(line('id=1;user-id=1;emotes=25:0-99', 'Kappa'), 'testnick_')
    expect(msg.fragments).toEqual([{ type: 'text', text: 'Kappa' }])
  })
})

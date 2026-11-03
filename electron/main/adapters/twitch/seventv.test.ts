import { describe, expect, it } from 'vitest'
import { applySevenTvEmotes, type SevenTvEmote } from './seventv'
import type { MessageFragment } from '../../../../shared/chat-message'

function emote(name: string, isZeroWidth = false): SevenTvEmote {
  return { name, url: `https://cdn.7tv.app/emote/${name}/2x.webp`, isZeroWidth }
}

describe('applySevenTvEmotes', () => {
  it('is a no-op passthrough when the emote map is empty (e.g. API unavailable)', () => {
    const fragments: MessageFragment[] = [{ type: 'text', text: 'hej Pog wszystkim' }]
    expect(applySevenTvEmotes(fragments, new Map())).toEqual(fragments)
  })

  it('replaces a whole-word emote code and preserves surrounding whitespace/text', () => {
    const map = new Map([['Pog', emote('Pog')]])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'hej Pog wszystkim' }]
    // Sąsiednie fragmenty tekstowe są sklejane (mniej węzłów DOM na wiadomość).
    expect(applySevenTvEmotes(fragments, map)).toEqual([
      { type: 'text', text: 'hej ' },
      { type: 'emote', text: 'Pog', url: 'https://cdn.7tv.app/emote/Pog/2x.webp' },
      { type: 'text', text: ' wszystkim' }
    ])
  })

  it('does not match an emote code as a substring of a longer word (word-boundary correctness)', () => {
    const map = new Map([['Pog', emote('Pog')]])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'PogChamp Pogging' }]
    const result = applySevenTvEmotes(fragments, map)
    expect(result.every((f) => f.type === 'text')).toBe(true)
  })

  it('folds a zero-width emote following a base emote into that emote\'s overlays', () => {
    const map = new Map([
      ['Pog', emote('Pog')],
      ['RainTime', emote('RainTime', true)]
    ])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'Pog RainTime' }]
    expect(applySevenTvEmotes(fragments, map)).toEqual([
      {
        type: 'emote',
        text: 'Pog',
        url: 'https://cdn.7tv.app/emote/Pog/2x.webp',
        overlays: [{ text: 'RainTime', url: 'https://cdn.7tv.app/emote/RainTime/2x.webp' }]
      },
      { type: 'text', text: ' ' }
    ])
  })

  it('renders a leading zero-width emote (no preceding base emote) as its own emote fragment instead of dropping it', () => {
    const map = new Map([['RainTime', emote('RainTime', true)]])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'RainTime siema' }]
    const result = applySevenTvEmotes(fragments, map)
    expect(result[0]).toEqual({ type: 'emote', text: 'RainTime', url: 'https://cdn.7tv.app/emote/RainTime/2x.webp' })
  })

  it('leaves native Twitch emote fragments untouched', () => {
    const map = new Map([['Pog', emote('Pog')]])
    const fragments: MessageFragment[] = [
      { type: 'emote', text: 'Kappa', url: 'https://static-cdn.jtvnw.net/Kappa.png' }
    ]
    expect(applySevenTvEmotes(fragments, map)).toEqual(fragments)
  })

  it('uses the static frame URL when preferStatic is true and one is available (low-resource mode)', () => {
    const map = new Map([
      ['Pog', { name: 'Pog', url: 'https://cdn.7tv.app/emote/Pog/2x.webp', staticUrl: 'https://cdn.7tv.app/emote/Pog/2x_static.webp', isZeroWidth: false } as SevenTvEmote]
    ])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'Pog' }]
    const result = applySevenTvEmotes(fragments, map, true)
    expect(result).toEqual([{ type: 'emote', text: 'Pog', url: 'https://cdn.7tv.app/emote/Pog/2x_static.webp' }])
  })

  it('falls back to the animated URL when preferStatic is true but no static frame exists (already-static emote)', () => {
    const map = new Map([['Pog', emote('Pog')]])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'Pog' }]
    const result = applySevenTvEmotes(fragments, map, true)
    expect(result).toEqual([{ type: 'emote', text: 'Pog', url: 'https://cdn.7tv.app/emote/Pog/2x.webp' }])
  })

  it('applies preferStatic to zero-width overlay URLs too', () => {
    const map = new Map([
      ['Pog', emote('Pog')],
      [
        'RainTime',
        {
          name: 'RainTime',
          url: 'https://cdn.7tv.app/emote/RainTime/2x.webp',
          staticUrl: 'https://cdn.7tv.app/emote/RainTime/2x_static.webp',
          isZeroWidth: true
        } as SevenTvEmote
      ]
    ])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'Pog RainTime' }]
    const result = applySevenTvEmotes(fragments, map, true)
    expect(result[0]).toEqual({
      type: 'emote',
      text: 'Pog',
      url: 'https://cdn.7tv.app/emote/Pog/2x.webp',
      overlays: [{ text: 'RainTime', url: 'https://cdn.7tv.app/emote/RainTime/2x_static.webp' }]
    })
  })

  it('defaults to animated URLs when preferStatic is omitted (backwards compatible)', () => {
    const map = new Map([['Pog', emote('Pog')]])
    const fragments: MessageFragment[] = [{ type: 'text', text: 'Pog' }]
    expect(applySevenTvEmotes(fragments, map)).toEqual([
      { type: 'emote', text: 'Pog', url: 'https://cdn.7tv.app/emote/Pog/2x.webp' }
    ])
  })
})

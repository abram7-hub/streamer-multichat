import { describe, expect, it } from 'vitest'
import { stripActionWrapper } from './action-message'
import type { MessageFragment } from '../../../../shared/chat-message'

describe('stripActionWrapper', () => {
  it('leaves ordinary text messages untouched', () => {
    const fragments: MessageFragment[] = [{ type: 'text', text: 'siema wszystkim' }]
    const result = stripActionWrapper('siema wszystkim', fragments)
    expect(result.isAction).toBe(false)
    expect(result.rawText).toBe('siema wszystkim')
    expect(result.fragments).toEqual(fragments)
  })

  it('strips the CTCP ACTION wrapper and marks the message as an action', () => {
    const raw = '\u0001ACTION macha do kamery\u0001'
    const fragments: MessageFragment[] = [{ type: 'text', text: raw }]
    const result = stripActionWrapper(raw, fragments)
    expect(result.isAction).toBe(true)
    expect(result.rawText).toBe('macha do kamery')
    expect(result.fragments).toEqual([{ type: 'text', text: 'macha do kamery' }])
  })

  it('strips the wrapper from the first/last text fragments while keeping emote fragments intact', () => {
    const raw = '\u0001ACTION rzuca PogChamp na scenę\u0001'
    const fragments: MessageFragment[] = [
      { type: 'text', text: '\u0001ACTION rzuca ' },
      { type: 'emote', text: 'PogChamp', url: 'https://example.com/pogchamp.png' },
      { type: 'text', text: ' na scenę\u0001' }
    ]
    const result = stripActionWrapper(raw, fragments)
    expect(result.isAction).toBe(true)
    expect(result.fragments).toEqual([
      { type: 'text', text: 'rzuca ' },
      { type: 'emote', text: 'PogChamp', url: 'https://example.com/pogchamp.png' },
      { type: 'text', text: ' na scenę' }
    ])
  })

  it('does not treat a message merely containing 0x01 mid-text as an action', () => {
    const fragments: MessageFragment[] = [{ type: 'text', text: 'losowy \u0001 znak' }]
    const result = stripActionWrapper('losowy \u0001 znak', fragments)
    expect(result.isAction).toBe(false)
  })
})

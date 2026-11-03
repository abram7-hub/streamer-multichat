import { describe, expect, it } from 'vitest'
import { MentionDetector } from './highlight'
import type { ChatMessage } from '../../shared/chat-message'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'

function makeMessage(rawText: string, username = 'widz', isHighlighted = false): ChatMessage {
  return {
    id: '1',
    platform: 'twitch',
    channel: 'streamer_ttv',
    author: {
      id: 'u1',
      username,
      displayName: username,
      badges: [],
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments: [{ type: 'text', text: rawText }],
    rawText,
    timestampMs: Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted
  }
}

const settings = (patch: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS,
  twitch: { ...DEFAULT_SETTINGS.twitch, channelLogin: 'streamer_ttv' },
  ...patch
})

describe('MentionDetector (main process)', () => {
  it('flags a message mentioning the configured channel nick (@nick, any case)', () => {
    const d = new MentionDetector()
    expect(d.apply(makeMessage('hej @streamer_ttv co tam'), settings()).isHighlighted).toBe(true)
    expect(d.apply(makeMessage('siema wszystkim'), settings()).isHighlighted).toBe(false)
  })

  it('the extra nick from General settings still works', () => {
    const d = new MentionDetector()
    const s = settings({ ui: { ...DEFAULT_SETTINGS.ui, highlightNick: 'drugi_nick' } })
    expect(d.apply(makeMessage('drugi_nick hej'), s).isHighlighted).toBe(true)
  })

  it('own messages are not mentions; an adapter flag is overridden by the central detector', () => {
    const d = new MentionDetector()
    expect(d.apply(makeMessage('ja streamer_ttv pisze', 'streamer_ttv'), settings()).isHighlighted).toBe(false)
    expect(d.apply(makeMessage('bez nicku', 'widz', true), settings()).isHighlighted).toBe(false)
  })

  it('reacts to settings changes and does not mutate the original message', () => {
    const d = new MentionDetector()
    const original = makeMessage('lubie C++')
    expect(d.apply(original, settings()).isHighlighted).toBe(false)
    const patched = d.apply(original, settings({ mentions: { ...DEFAULT_SETTINGS.mentions, keywords: ['C++'] } }))
    expect(patched.isHighlighted).toBe(true)
    expect(original.isHighlighted).toBe(false)
    expect(patched).not.toBe(original)
  })
})

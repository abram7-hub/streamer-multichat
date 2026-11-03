import { describe, expect, it } from 'vitest'
import { parseYouTubeInput } from './youtube-input'

describe('parseYouTubeInput — recognises every supported format', () => {
  it.each([
    ['@testnickyt', { kind: 'handle', handle: 'testnickyt' }],
    ['testnickyt', { kind: 'handle', handle: 'testnickyt' }],
    ['https://www.youtube.com/@TestnickYT', { kind: 'handle', handle: 'testnickyt' }],
    ['youtube.com/@testnickyt/live', { kind: 'handle', handle: 'testnickyt' }],
    ['UCSJ4gkVC6NrvII8umztf0Ow', { kind: 'channel', channelId: 'UCSJ4gkVC6NrvII8umztf0Ow' }],
    ['https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow', { kind: 'channel', channelId: 'UCSJ4gkVC6NrvII8umztf0Ow' }],
    ['https://www.youtube.com/user/SomeOldName', { kind: 'username', username: 'SomeOldName' }],
    ['https://www.youtube.com/watch?v=jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://youtu.be/jfKfPfyJRdk?si=abc', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://www.youtube.com/live/jfKfPfyJRdk?feature=share', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['https://m.youtube.com/watch?v=jfKfPfyJRdk&t=10', { kind: 'video', videoId: 'jfKfPfyJRdk' }],
    ['jfKfPfyJRdk', { kind: 'video', videoId: 'jfKfPfyJRdk' }]
  ])('%s', (input, expected) => {
    expect(parseYouTubeInput(input)).toEqual(expected)
  })

  it('rejects empty input and non-YouTube URLs', () => {
    expect(parseYouTubeInput('')).toBeUndefined()
    expect(parseYouTubeInput('https://example.com/@x')).toBeUndefined()
    expect(parseYouTubeInput('https://www.youtube.com/feed/trending')).toBeUndefined()
  })
})

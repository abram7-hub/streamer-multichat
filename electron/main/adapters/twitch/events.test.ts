import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChatMessage } from '../../../../shared/chat-message'
import { describeStreamEvent } from '../../../../shared/stream-event'
import { parseTaggedCommandLine } from './irc-tags'
import { normalizeTwitchUserNotice } from './irc-usernotice'
import { normalizeEventSubNotification } from './eventsub-normalize'
import { TwitchEventSubClient, type EventSubTarget, type SocketLike, EVENTSUB_WS_URL } from './eventsub-client'

// auth.ts / index.ts importują Electrona i zaszyfrowany magazyn - w testach jednostkowych niepotrzebne.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('../../secure-store', () => ({
  loadSecret: () => undefined,
  saveSecret: vi.fn(),
  deleteSecret: vi.fn(),
  SecretKeys: { twitchAccessToken: 'a', twitchRefreshToken: 'r', twitchClientSecret: 's' }
}))

function usernotice(tags: Record<string, string>, text = ''): ChatMessage | undefined {
  const tagStr = Object.entries(tags)
    .map(([k, v]) => `${k}=${v.replace(/ /g, '\\s')}`)
    .join(';')
  const parsed = parseTaggedCommandLine(`@${tagStr} :tmi.twitch.tv USERNOTICE #testnick_${text ? ` :${text}` : ''}`)
  expect(parsed?.command).toBe('USERNOTICE')
  return normalizeTwitchUserNotice(parsed!)
}

describe('IRC USERNOTICE (public chat notices — available anonymously for any channel)', () => {
  it('parses ROOMSTATE room-id', () => {
    const parsed = parseTaggedCommandLine('@emote-only=0;room-id=71092938;slow=0 :tmi.twitch.tv ROOMSTATE #XQC')
    expect(parsed).toMatchObject({ command: 'ROOMSTATE', channel: 'xqc', tags: { 'room-id': '71092938' } })
  })

  it('sub', () => {
    const m = usernotice({ 'msg-id': 'sub', login: 'user123', 'display-name': 'User123', 'msg-param-sub-plan': '1000', id: 'a' })
    expect(m?.event).toMatchObject({ kind: 'sub', source: 'irc', tier: '1000' })
    expect(describeStreamEvent(m!.event!, m!.author.displayName).text).toBe('User123 zasubskrybował(a) kanał!')
  })

  it('resub with message and native emote (code points)', () => {
    const m = usernotice(
      { 'msg-id': 'resub', login: 'user123', 'display-name': 'User123', 'msg-param-cumulative-months': '3', 'msg-param-sub-plan': 'Prime', emotes: '25:2-6', id: 'b' },
      '🎉 Kappa trzeci miesiąc'
    )
    expect(m?.event).toMatchObject({ kind: 'resub', months: 3, tier: 'prime' })
    expect(m?.fragments[1]).toMatchObject({ type: 'emote', text: 'Kappa', provider: 'twitch' })
    expect(describeStreamEvent(m!.event!, 'User123').text).toBe('User123 zasubskrybował(a) kanał na 3 miesiące (Prime)!')
  })

  it('single gifted sub names the recipient; gifts belonging to a community gift are skipped', () => {
    const single = usernotice({ 'msg-id': 'subgift', login: 'viewer99', 'display-name': 'Viewer99', 'msg-param-recipient-display-name': 'Nowy', id: 'c' })
    expect(single?.event).toMatchObject({ kind: 'gift_sub', recipient: 'Nowy' })
    expect(describeStreamEvent(single!.event!, 'Viewer99').text).toBe('Viewer99 podarował(a) suba dla Nowy!')
    const partOfMystery = usernotice({ 'msg-id': 'subgift', login: 'viewer99', 'msg-param-community-gift-id': '123', id: 'd' })
    expect(partOfMystery).toBeUndefined()
  })

  it('community gift (several gifted subs), anonymous gifter', () => {
    const m = usernotice({ 'msg-id': 'submysterygift', login: 'viewer99', 'display-name': 'Viewer99', 'msg-param-mass-gift-count': '5', id: 'e' })
    expect(describeStreamEvent(m!.event!, 'Viewer99').text).toBe('Viewer99 podarował(a) 5 subów!')
    const anon = usernotice({ 'msg-id': 'submysterygift', login: 'ananonymousgifter', 'msg-param-mass-gift-count': '2', id: 'f' })
    expect(describeStreamEvent(anon!.event!, 'x').text).toBe('Anonimowy widz podarował(a) 2 suby!')
  })

  it('incoming raid', () => {
    const m = usernotice({ 'msg-id': 'raid', login: 'streamerxyz', 'msg-param-displayName': 'StreamerXYZ', 'msg-param-viewerCount': '84', id: 'g' })
    expect(m?.author.displayName).toBe('StreamerXYZ')
    expect(describeStreamEvent(m!.event!, m!.author.displayName).text).toBe('StreamerXYZ zrobił(a) raid z 84 widzami!')
  })

  it('unsupported notices are ignored (no fake events)', () => {
    expect(usernotice({ 'msg-id': 'bitsbadgetier', login: 'x', id: 'h' })).toBeUndefined()
    expect(usernotice({ 'msg-id': 'viewermilestone', 'msg-param-category': 'other', login: 'x', id: 'h2' })).toBeUndefined()
    expect(usernotice({ 'msg-id': 'unknownthing', login: 'x', id: 'i' })).toBeUndefined()
  })
})

describe('EventSub notification → message', () => {
  const n = (subscriptionType: string, event: Record<string, unknown>, condition: Record<string, unknown> = { broadcaster_user_id: '1' }) =>
    normalizeEventSubNotification({ messageId: 'm1', subscriptionType, condition, event }, 'testnick_')

  it('channel points redemption with user input', () => {
    const m = n('channel.channel_points_custom_reward_redemption.add', {
      user_id: '7',
      user_login: 'testnick_',
      user_name: 'Testnick_',
      user_input: 'Napij się wody!',
      reward: { id: 'r', title: 'Hydratacja', cost: 500, prompt: '' }
    })
    expect(m?.id).toBe('eventsub-m1')
    expect(m?.event).toEqual({ kind: 'redemption', source: 'eventsub', rewardTitle: 'Hydratacja', rewardCost: 500 })
    expect(m?.fragments).toEqual([{ type: 'text', text: 'Napij się wody!' }])
    expect(describeStreamEvent(m!.event!, m!.author.displayName).text).toBe('Testnick_ odebrał(a) nagrodę „Hydratacja”')
  })

  it('reward title with HTML stays plain text data (rendered via React text nodes)', () => {
    const m = n('channel.channel_points_custom_reward_redemption.add', { user_name: 'x', reward: { title: '<img src=x onerror=alert(1)>' } })
    expect(describeStreamEvent(m!.event!, 'x').text).toContain('<img src=x onerror=alert(1)>')
  })

  it('new sub; gifted channel.subscribe is suppressed (announced via subscription.gift)', () => {
    expect(n('channel.subscribe', { user_name: 'User123', tier: '1000', is_gift: false })?.event).toMatchObject({ kind: 'sub', tier: '1000' })
    expect(n('channel.subscribe', { user_name: 'User123', tier: '1000', is_gift: true })).toBeUndefined()
  })

  it('resub message with emotes', () => {
    const m = n('channel.subscription.message', {
      user_name: 'User123',
      tier: '2000',
      cumulative_months: 3,
      message: { text: 'Kappa hej', emotes: [{ begin: 0, end: 4, id: '25' }] }
    })
    expect(m?.event).toMatchObject({ kind: 'resub', months: 3, tier: '2000' })
    expect(m?.fragments[0]).toMatchObject({ type: 'emote', text: 'Kappa' })
    expect(describeStreamEvent(m!.event!, 'User123').text).toBe('User123 zasubskrybował(a) kanał na 3 miesiące (Tier 2)!')
  })

  it('gifted subs: single and multiple, anonymous', () => {
    expect(n('channel.subscription.gift', { user_name: 'V', total: 1, tier: '1000', is_anonymous: false })?.event?.kind).toBe('gift_sub')
    const many = n('channel.subscription.gift', { user_name: 'Viewer99', total: 5, tier: '1000', is_anonymous: false })
    expect(describeStreamEvent(many!.event!, 'Viewer99').text).toBe('Viewer99 podarował(a) 5 subów!')
    const anon = n('channel.subscription.gift', { total: 10, tier: '1000', is_anonymous: true })
    expect(anon?.author.username).toBe('anonymous')
    expect(describeStreamEvent(anon!.event!, anon!.author.displayName).text).toBe('Anonimowy widz podarował(a) 10 subów!')
  })

  it('cheer', () => {
    const m = n('channel.cheer', { user_name: 'User123', bits: 500, message: 'Cheer500 dobra robota', is_anonymous: false })
    expect(describeStreamEvent(m!.event!, 'User123').text).toBe('User123 wysłał(a) 500 Bitsów!')
    expect(m?.rawText).toBe('Cheer500 dobra robota')
  })

  it('raid in vs out is decided by the subscription condition', () => {
    const raidEvent = {
      from_broadcaster_user_id: '2',
      from_broadcaster_user_login: 'streamerxyz',
      from_broadcaster_user_name: 'StreamerXYZ',
      to_broadcaster_user_id: '1',
      to_broadcaster_user_login: 'testnick_',
      to_broadcaster_user_name: 'Testnick_',
      viewers: 84
    }
    const incoming = n('channel.raid', raidEvent, { to_broadcaster_user_id: '1' })
    expect(incoming?.event).toMatchObject({ kind: 'raid_in', viewers: 84 })
    expect(incoming?.author.displayName).toBe('StreamerXYZ')
    const outgoing = n('channel.raid', { ...raidEvent, from_broadcaster_user_name: 'Testnick_', to_broadcaster_user_name: 'Kumpel' }, { from_broadcaster_user_id: '1' })
    expect(describeStreamEvent(outgoing!.event!, 'Testnick_').text).toBe('Raid na kanał Kumpel z 84 widzami!')
  })

  it('follow and hype train', () => {
    expect(describeStreamEvent(n('channel.follow', { user_name: 'Nowy' })!.event!, 'Nowy').text).toBe('Nowy obserwuje kanał!')
    expect(n('channel.hype_train.begin', { level: 2 })?.event).toMatchObject({ kind: 'hype_train_begin', level: 2 })
  })

  it('unknown subscription types produce nothing', () => {
    expect(n('channel.update', { title: 'x' })).toBeUndefined()
  })
})

// ── EventSub WebSocket client ──────────────────────────────────────────────────────────────────────

class FakeSocket extends EventEmitter implements SocketLike {
  static all: FakeSocket[] = []
  terminated = false
  constructor(readonly url: string) {
    super()
    FakeSocket.all.push(this)
  }
  close(): void {
    this.terminate()
  }
  terminate(): void {
    this.terminated = true
  }
  send(obj: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(obj)))
  }
  welcome(id = 'session-1', keepalive = 30): void {
    this.send({ metadata: { message_type: 'session_welcome', message_id: `w-${id}` }, payload: { session: { id, keepalive_timeout_seconds: keepalive } } })
  }
  notify(messageId: string, type: string, event: Record<string, unknown>, condition: Record<string, unknown> = { broadcaster_user_id: '1' }): void {
    this.send({ metadata: { message_type: 'notification', message_id: messageId }, payload: { subscription: { type, condition }, event } })
  }
}

const ALL_SCOPES = ['channel:read:redemptions', 'channel:read:subscriptions', 'bits:read', 'moderator:read:followers', 'channel:read:hype_train']
const target = (scopes = ALL_SCOPES): EventSubTarget => ({
  clientId: 'cid',
  broadcasterId: '1',
  broadcasterLogin: 'testnick_',
  tokenUserId: '1',
  grantedScopes: scopes
})

describe('TwitchEventSubClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let messages: ChatMessage[]
  let client: TwitchEventSubClient
  // Prawdziwy setImmediate (nie podmieniany przez fake timers) - pozwala dokończyć się łańcuchom
  // obietnic z odczytem treści Response.
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    FakeSocket.all = []
    messages = []
    fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    client = new TwitchEventSubClient({
      getToken: async () => 'token',
      refreshToken: async () => 'token2',
      onMessage: (m) => messages.push(m),
      createSocket: (url) => new FakeSocket(url),
      fetchImpl: fetchMock as unknown as typeof fetch
    })
  })
  afterEach(() => {
    client.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const subscribedTypes = () =>
    fetchMock.mock.calls.map((c) => {
      const body = JSON.parse((c[1] as RequestInit).body as string)
      return `${body.type}:${JSON.stringify(body.condition)}`
    })

  it('creates all subscriptions for the owner channel after session_welcome, with the session id', async () => {
    client.start(target())
    expect(FakeSocket.all[0]?.url).toBe(EVENTSUB_WS_URL)
    FakeSocket.all[0]!.welcome()
    await settle()
    const types = subscribedTypes()
    expect(types).toHaveLength(11)
    expect(types).toContain('channel.channel_points_automatic_reward_redemption.add:{"broadcaster_user_id":"1"}')
    expect(types).toContain('channel.raid:{"to_broadcaster_user_id":"1"}')
    expect(types).toContain('channel.raid:{"from_broadcaster_user_id":"1"}')
    expect(types).toContain('channel.follow:{"broadcaster_user_id":"1","moderator_user_id":"1"}')
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body.transport).toEqual({ method: 'websocket', session_id: 'session-1' })
    expect(client.covers('testnick_', 'redemption')).toBe(true)
    expect(client.covers('testnick_', 'cheer')).toBe(true)
    // Inny kanał nigdy nie jest "pokryty" przez EventSub właściciela.
    expect(client.covers('innykanal', 'cheer')).toBe(false)
  })

  it('skips subscriptions whose scope was not granted (old token) but still subscribes raids', async () => {
    client.start(target([]))
    FakeSocket.all[0]!.welcome()
    await settle()
    expect(subscribedTypes().every((t) => t.startsWith('channel.raid'))).toBe(true)
    expect(client.covers('testnick_', 'redemption')).toBe(false)
    expect(client.covers('testnick_', 'raid_in')).toBe(true)
    expect(TwitchEventSubClient.missingScopes([])).toEqual(ALL_SCOPES)
  })

  it('treats 403 as unavailable and refreshes the token once on 401', async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      const auth = (init.headers as Record<string, string>)['Authorization']
      if (body.type === 'channel.cheer') return new Response('', { status: 403 })
      if (auth === 'Bearer token') return new Response('', { status: 401 })
      return new Response('', { status: 202 })
    })
    client.start(target())
    FakeSocket.all[0]!.welcome()
    await settle()
    expect(client.covers('testnick_', 'cheer')).toBe(false)
    expect(client.covers('testnick_', 'sub')).toBe(true)
    expect(client.summary).toContain('channel.cheer (brak uprawnień)')
  })

  it('emits channel points / sub / gift / raid / cheer notifications and dedupes repeated message ids', async () => {
    client.start(target())
    const s = FakeSocket.all[0]!
    s.welcome()
    await settle()
    s.notify('n1', 'channel.channel_points_custom_reward_redemption.add', { user_name: 'Testnick_', reward: { title: 'Hydratacja' }, user_input: 'Napij się wody!' })
    s.notify('n1', 'channel.channel_points_custom_reward_redemption.add', { user_name: 'Testnick_', reward: { title: 'Hydratacja' } })
    s.notify('n2', 'channel.subscribe', { user_name: 'User123', tier: '1000', is_gift: false })
    s.notify('n3', 'channel.subscription.gift', { user_name: 'Viewer99', total: 5, tier: '1000' })
    s.notify('n4', 'channel.raid', { from_broadcaster_user_name: 'StreamerXYZ', viewers: 84 }, { to_broadcaster_user_id: '1' })
    s.notify('n5', 'channel.cheer', { user_name: 'User123', bits: 500, message: 'gg' })
    expect(messages.map((m) => m.event?.kind)).toEqual(['redemption', 'sub', 'community_gift', 'raid_in', 'cheer'])
  })

  it('session_reconnect: moves to the new socket without re-subscribing and without leaking the old one', async () => {
    client.start(target())
    const first = FakeSocket.all[0]!
    first.welcome()
    await settle()
    const subsBefore = fetchMock.mock.calls.length
    first.send({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?id=abc' } } })
    const second = FakeSocket.all[1]!
    expect(second.url).toBe('wss://eventsub.wss.twitch.tv/ws?id=abc')
    second.welcome('session-1')
    await settle()
    expect(first.terminated).toBe(true)
    expect(first.listenerCount('message')).toBe(0) // brak zduplikowanych/wiszących listenerów
    expect(fetchMock.mock.calls.length).toBe(subsBefore)
    second.notify('n9', 'channel.follow', { user_name: 'Nowy' })
    expect(messages).toHaveLength(1)
    // Wiadomości ze starego gniazda są ignorowane.
    first.notify('n10', 'channel.follow', { user_name: 'Stary' })
    expect(messages).toHaveLength(1)
  })

  it('ignores reconnect URLs outside twitch.tv', async () => {
    client.start(target())
    FakeSocket.all[0]!.welcome()
    await settle()
    FakeSocket.all[0]!.send({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://evil.example.com/ws' } } })
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('unexpected close → exactly one new connection with backoff and fresh subscriptions', async () => {
    client.start(target())
    const first = FakeSocket.all[0]!
    first.welcome()
    await settle()
    first.emit('close', 1006)
    expect(client.covers('testnick_', 'sub')).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000) // pierwszy krok backoffu
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1]!.welcome('session-2')
    await settle()
    expect(fetchMock.mock.calls.length).toBe(22)
    expect(client.covers('testnick_', 'sub')).toBe(true)
  })

  it('keepalive watchdog: silence beyond keepalive timeout drops the socket and reconnects', async () => {
    client.start(target())
    const first = FakeSocket.all[0]!
    first.welcome('s', 10)
    await settle()
    await vi.advanceTimersByTimeAsync(14_000)
    expect(first.terminated).toBe(false) // 10 s + 5 s zapasu jeszcze nie minęło
    await vi.advanceTimersByTimeAsync(2_000)
    expect(first.terminated).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(FakeSocket.all.length).toBe(2)
  })

  it('stop() closes everything, clears timers and never reconnects; start() twice with same target is a no-op', async () => {
    client.start(target())
    client.start(target())
    expect(FakeSocket.all).toHaveLength(1)
    FakeSocket.all[0]!.welcome()
    await settle()
    client.stop()
    expect(FakeSocket.all[0]!.terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(client.covers('testnick_', 'sub')).toBe(false)
  })
})

describe('Channel Points — automatic rewards, reward icon, real nick colour (EventSub)', () => {
  const n = (subscriptionType: string, event: Record<string, unknown>, opts = {}) =>
    normalizeEventSubNotification({ messageId: 'm9', subscriptionType, condition: { broadcaster_user_id: '1' }, event }, 'testnick_', opts)

  it('automatic reward v2 (unlock emote) → redemption event with Polish title, cost and emote name', () => {
    const m = n('channel.channel_points_automatic_reward_redemption.add', {
      user_id: '7',
      user_login: 'testnick_',
      user_name: 'Testnick_',
      reward: { type: 'random_sub_emote_unlock', channel_points: 1000, emote: { id: '1', name: 'testnickHype' } },
      message: { text: '', fragments: [] }
    })
    expect(m?.event).toMatchObject({ kind: 'redemption', source: 'eventsub', rewardTitle: 'Odblokuj losową emotkę suba', rewardCost: 1000, itemName: 'testnickHype' })
  })

  it('automatic "highlight my message" does not duplicate the chat text (the message itself arrives via IRC)', () => {
    const m = n('channel.channel_points_automatic_reward_redemption.add', {
      user_name: 'Widz',
      reward: { type: 'send_highlighted_message', channel_points: 100 },
      message: { text: 'patrzcie na mnie', fragments: [] }
    })
    expect(m?.fragments).toEqual([])
    expect(m?.event?.rewardTitle).toBe('Wyróżnij moją wiadomość')
  })

  it('custom reward gets its icon from the reward cache and the user keeps the real Twitch colour seen in chat', () => {
    const m = n(
      'channel.channel_points_custom_reward_redemption.add',
      { user_id: '7', user_name: 'Testnick_', reward: { id: 'r1', title: 'Hydratacja', cost: 500 } },
      { rewardImage: (id: string) => (id === 'r1' ? 'https://static-cdn.jtvnw.net/custom-reward-images/1.png' : undefined), userColor: () => '#00FF7F' }
    )
    expect(m?.event?.rewardImageUrl).toBe('https://static-cdn.jtvnw.net/custom-reward-images/1.png')
    expect(m?.author.color).toBe('#00FF7F')
  })
})

describe('more public USERNOTICE kinds', () => {
  it('watch streak (viewermilestone), gift upgrade, announcement', () => {
    expect(usernotice({ 'msg-id': 'viewermilestone', 'msg-param-category': 'watch-streak', 'msg-param-value': '7', login: 'x', id: 'w' })?.event)
      .toMatchObject({ kind: 'watch_streak', count: 7 })
    expect(usernotice({ 'msg-id': 'giftpaidupgrade', login: 'x', id: 'g' })?.event?.kind).toBe('gift_upgrade')
    const ann = usernotice({ 'msg-id': 'announcement', login: 'mod', 'display-name': 'Mod', id: 'a1' }, 'Ważne ogłoszenie')
    expect(ann?.event?.kind).toBe('announcement')
    expect(ann?.rawText).toBe('Ważne ogłoszenie')
    expect(describeStreamEvent(ann!.event!, 'Mod').text).toBe('Ogłoszenie od Mod')
  })
})

describe('Twitch token refresh failure classification', () => {
  it('"missing client secret" (Confidential app) is recognised and explained', async () => {
    const { classifyRefreshFailure } = await import('./auth')
    const { describeAuthProblem } = await import('./index')
    expect(classifyRefreshFailure(400, 'missing client secret')).toBe('missing_client_secret')
    expect(classifyRefreshFailure(400, 'Invalid refresh token')).toBe('invalid_refresh_token')
    expect(classifyRefreshFailure(503, '')).toBe('network')
    const text = describeAuthProblem({ status: 'refresh_failed', reason: 'missing_client_secret', message: '' })
    expect(text).toMatch(/Client Secret/)
    expect(text).toMatch(/Channel Points/)
  })
})

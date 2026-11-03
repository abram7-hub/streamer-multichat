import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as proto from 'tiktok-live-proto/v3'
import * as connector from 'tiktok-live-connector'
import { normalizeTikTokGift, normalizeTikTokMessage, normalizeTikTokSubscribe, type TikTokChatEvent, type TikTokGiftEvent } from './normalize'

/**
 * Testy na prawdziwej, zainstalowanej bibliotece (bez sieci): sprawdzają, że wersja przypięta w
 * package.json eksportuje to, czego używa adapter, i że zdekodowane ramki protobuf mają kształt,
 * który czyta normalize.ts. Połączenia z prawdziwym TikTok LIVE nie da się tu sprawdzić.
 */

type Codec<T> = { encode(message: T): { finish(): Uint8Array }; decode(input: Uint8Array): T }

/** Pusty komunikat z wartościami domyślnymi (generator nie udostępnia fromPartial) + nadpisane pola. */
function make<T>(codec: Codec<T>, fields: Partial<T>): T {
  return Object.assign(codec.decode(new Uint8Array()) as object, fields) as T
}

function roundTrip<T>(codec: Codec<T>, message: T): T {
  return codec.decode(codec.encode(message).finish())
}

function packageJson(name: string): { version: string; license: string } {
  return JSON.parse(readFileSync(join(process.cwd(), 'node_modules', name, 'package.json'), 'utf8')) as {
    version: string
    license: string
  }
}

describe('tiktok-live-connector (installed version)', () => {
  it('is the MIT-licensed release pinned in package.json, together with an MIT tiktok-live-proto', () => {
    // 2.4.1+ / 0.2.4+ są wydane na AGPL-3.0 - aktualizacja wymaga ponownej oceny licencji.
    expect(packageJson('tiktok-live-connector')).toMatchObject({ version: '2.4.0', license: 'MIT' })
    expect(packageJson('tiktok-live-proto')).toMatchObject({ version: '0.2.3', license: 'MIT' })
  })

  it('exports the connection class and error classes used by the adapter', () => {
    expect(typeof connector.TikTokLiveConnection).toBe('function')
    for (const cls of [connector.UserOfflineError, connector.SignatureRateLimitError, connector.SignAPIError, connector.InvalidUniqueIdError]) {
      expect(cls.prototype).toBeInstanceOf(Error)
    }
  })

  it('emits the event names the adapter subscribes to', () => {
    expect(connector.WebcastEvent.CHAT).toBe('chat')
    expect(connector.WebcastEvent.GIFT).toBe('gift')
    expect(connector.WebcastEvent.SUB_NOTIFY).toBe('subNotify')
    expect(connector.WebcastEvent.STREAM_END).toBe('streamEnd')
    expect(connector.ControlEvent.DISCONNECTED).toBe('disconnected')
    expect(connector.ControlEvent.ERROR).toBe('error')
  })

  it('creates a connection object without touching the network', () => {
    const connection = new connector.TikTokLiveConnection('some.user', { enableExtendedGiftInfo: false })
    for (const method of ['connect', 'disconnect', 'on', 'removeAllListeners'] as const) {
      expect(typeof connection[method]).toBe('function')
    }
    connection.removeAllListeners()
  })
})

describe('tiktok-live-proto frames -> normalize', () => {
  const user = (id: string, displayId: string, nickname: string, badgeList: proto.BadgeStruct[] = []): proto.User =>
    make(proto.User, { id, displayId, nickname, badgeList })

  it('chat message: author, text, id, role flags and badge icon survive a real protobuf round trip', () => {
    const badge = make(proto.BadgeStruct, {
      sceneType: 8,
      display: true,
      combine: make(proto.CombineBadgeStruct, {
        icon: make(proto.ImageModel, { urlList: ['https://p16-webcast.tiktokcdn.com/webcast-va/level.png'] }),
        str: '12'
      })
    })
    const frame = roundTrip(
      proto.WebcastChatMessage,
      make(proto.WebcastChatMessage, {
        common: make(proto.CommonMessageData, { msgId: '7300000000000000001' }),
        content: 'hej z TikToka',
        user: user('6900000000000000001', 'some.viewer', 'Some Viewer', [badge]),
        userIdentity: make(proto.UserIdentity, { isModeratorOfAnchor: true })
      })
    )

    const message = normalizeTikTokMessage(frame as unknown as TikTokChatEvent, 'some.user')
    expect(message.platform).toBe('tiktok')
    expect(message.rawText).toBe('hej z TikToka')
    expect(message.author.username).toBe('some.viewer')
    expect(message.author.displayName).toBe('Some Viewer')
    expect(message.author.isModerator).toBe(true)
    expect(message.id).toContain('7300000000000000001')
    expect(message.author.badges.map((b) => b.imageUrl)).toEqual(['https://p16-webcast.tiktokcdn.com/webcast-va/level.png'])
  })

  it('gift message: end of a combo streak is reported with its count', () => {
    const frame = roundTrip(
      proto.WebcastGiftMessage,
      make(proto.WebcastGiftMessage, {
        common: make(proto.CommonMessageData, { msgId: '7300000000000000002' }),
        giftId: '5655',
        repeatCount: 3,
        repeatEnd: 1,
        gift: make(proto.Gift, { name: 'Rose', type: 1, combo: true }),
        user: user('7', 'gifter', 'Gifter')
      })
    )
    const message = normalizeTikTokGift(frame as unknown as TikTokGiftEvent, 'some.user')
    expect(message?.author.username).toBe('gifter')
    expect(message?.event).toMatchObject({ kind: 'tiktok_gift', itemName: 'Rose', count: 3 })
  })

  it('subscription notice becomes a sub event', () => {
    const frame = roundTrip(
      proto.WebcastSubNotifyMessage,
      make(proto.WebcastSubNotifyMessage, {
        common: make(proto.CommonMessageData, { msgId: '7300000000000000003' }),
        user: user('8', 'subscriber', 'Subscriber')
      })
    )
    const message = normalizeTikTokSubscribe(frame as unknown as TikTokChatEvent, 'some.user')
    expect(message.author.username).toBe('subscriber')
    expect(message.event).toMatchObject({ kind: 'sub' })
  })
})

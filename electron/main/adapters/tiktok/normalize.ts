import type { ChatBadge, ChatMessage, MessageFragment } from '../../../../shared/chat-message'
import { isAllowedAssetUrl } from '../../../../shared/emote-url'

/**
 * Kształt zdarzeń z tiktok-live-connector v2.x (protobuf `tiktok-live-proto/v3`). Biblioteka jest
 * nieoficjalna (reverse engineering) i TikTok może zmienić protokół w dowolnym momencie, więc
 * odczytujemy WSZYSTKIE pola defensywnie (opcjonalnie).
 *
 * W 2.x treść jest w `content`, id wiadomości w `common.msgId`, dane autora mają pola
 * `id`/`displayId`/`nickname`, a odznaki - `badgeList` (patrz `TikTokBadge`).
 */
export interface TikTokImageModel {
  urlList?: string[]
}

export interface TikTokEmoteWithIndex {
  index?: number
  emote?: { image?: TikTokImageModel }
}

/**
 * Odznaka z `user.badgeList` - zweryfikowane na prawdziwym LIVE: obrazek w `image.image.urlList`
 * albo `combine.icon.urlList` (CDN p16-webcast.tiktokcdn.com), `combine.str` = np. numer poziomu,
 * `display` = czy TikTok pokazuje ją przy wiadomości.
 */
export interface TikTokBadge {
  sceneType?: number
  display?: boolean
  image?: { image?: TikTokImageModel }
  combine?: { icon?: TikTokImageModel; str?: string }
}

export interface TikTokUser {
  id?: string
  idStr?: string
  displayId?: string
  nickname?: string
  badgeList?: TikTokBadge[]
}

export interface TikTokUserIdentity {
  isModeratorOfAnchor?: boolean
  isSubscriberOfAnchor?: boolean
  isAnchor?: boolean
}

export interface TikTokChatEvent {
  common?: { msgId?: string }
  content?: string
  user?: TikTokUser
  userIdentity?: TikTokUserIdentity
  emotes?: TikTokEmoteWithIndex[]
}

export interface TikTokGiftEvent {
  common?: { msgId?: string }
  user?: TikTokUser
  giftId?: number
  repeatCount?: number
  repeatEnd?: number | boolean
  /** proto v3 (`WebcastGiftMessage.gift`): `type` 1 = prezent seryjny (combo). */
  gift?: { name?: string; type?: number; combo?: boolean }
  giftDetails?: { giftName?: string; giftType?: number }
  /** Starsze/rozszerzone kształty biblioteki. */
  giftName?: string
  giftType?: number
}

/** Sceny odznak wg `BadgeSceneType` z protobufa TikToka - tylko do tooltipa. */
const SCENE_LABELS: Record<number, string> = {
  1: 'Moderator',
  2: 'Pierwsze doładowanie',
  3: 'Znajomy',
  4: 'Subskrybent',
  5: 'Wydarzenie',
  6: 'Top gifter',
  7: 'Nowy subskrybent',
  8: 'Poziom',
  10: 'Fan club',
  11: 'LIVE Pro',
  12: 'Twórca'
}

export function toTikTokBadges(user: TikTokUser | undefined): ChatBadge[] {
  const out: ChatBadge[] = []
  const seen = new Set<string>()
  for (const b of user?.badgeList ?? []) {
    if (!b || b.display === false) continue
    const url = b.image?.image?.urlList?.[0] ?? b.combine?.icon?.urlList?.[0]
    if (!isAllowedAssetUrl(url, 'tiktok') || seen.has(url)) continue
    seen.add(url)
    const scene = typeof b.sceneType === 'number' ? b.sceneType : 0
    const base = SCENE_LABELS[scene] ?? 'Odznaka TikTok'
    const extra = b.combine?.str?.trim()
    out.push({
      id: `scene-${scene}-${out.length}`,
      type: `scene-${scene}`,
      label: extra ? `${base} ${extra}` : base,
      imageUrl: url,
      provider: 'tiktok'
    })
  }
  return out
}

function buildFragments(text: string, emotes: TikTokEmoteWithIndex[] | undefined): MessageFragment[] {
  const fragments: MessageFragment[] = text ? [{ type: 'text', text }] : []
  // Indeksowanie emotek TikToka w treści nie jest udokumentowane/stabilne w tej nieoficjalnej
  // bibliotece - zamiast zgadywać podział tekstu (ryzyko uszkodzenia treści), doklejamy obrazki
  // emotek jako dodatkowe fragmenty na końcu wiadomości.
  for (const e of emotes ?? []) {
    const url = e.emote?.image?.urlList?.[0]
    if (url) fragments.push({ type: 'emote', text: '', url })
  }
  return fragments.length > 0 ? fragments : [{ type: 'text', text: '' }]
}

function authorOf(user: TikTokUser | undefined, identity: TikTokUserIdentity | undefined): ChatMessage['author'] {
  const id = String(user?.id ?? user?.idStr ?? user?.displayId ?? 'unknown')
  const username = user?.displayId ?? 'widz'
  return {
    id,
    username,
    displayName: user?.nickname || username,
    badges: toTikTokBadges(user),
    isBroadcaster: identity?.isAnchor ?? false,
    isModerator: identity?.isModeratorOfAnchor ?? false,
    isSubscriber: identity?.isSubscriberOfAnchor ?? false
  }
}

export function normalizeTikTokMessage(event: TikTokChatEvent, uniqueId: string): ChatMessage {
  const text = event.content ?? ''
  const author = authorOf(event.user, event.userIdentity)
  return {
    id: event.common?.msgId ?? `${author.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    platform: 'tiktok',
    channel: uniqueId,
    author,
    fragments: buildFragments(text, event.emotes),
    rawText: text,
    timestampMs: Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false
  }
}

/**
 * Prezent TikTok. Prezenty "seryjne" (giftType 1, np. róża) przychodzą jako wiele zdarzeń w trakcie
 * combo - pokazujemy tylko ostatnie (`repeatEnd`), z łączną liczbą, żeby nie zalać czatu.
 */
export function normalizeTikTokGift(event: TikTokGiftEvent, uniqueId: string): ChatMessage | undefined {
  const giftType = event.gift?.type ?? event.giftDetails?.giftType ?? event.giftType
  const ended = event.repeatEnd === true || event.repeatEnd === 1
  if ((giftType === 1 || event.gift?.combo === true) && !ended) return undefined
  const author = authorOf(event.user, undefined)
  const now = Date.now()
  return {
    id: event.common?.msgId ? `gift-${event.common.msgId}` : `gift-${author.id}-${event.giftId ?? 0}-${now}`,
    platform: 'tiktok',
    channel: uniqueId,
    author,
    fragments: [],
    rawText: '',
    timestampMs: now,
    receivedAtMs: now,
    isHighlighted: false,
    event: {
      kind: 'tiktok_gift',
      source: 'platform',
      itemName: event.gift?.name || event.giftDetails?.giftName || event.giftName,
      count: Math.max(1, event.repeatCount ?? 1)
    }
  }
}

/** Subskrypcja kanału TikTok LIVE. */
export function normalizeTikTokSubscribe(event: { common?: { msgId?: string }; user?: TikTokUser }, uniqueId: string): ChatMessage {
  const author = authorOf(event.user, undefined)
  const now = Date.now()
  return {
    id: event.common?.msgId ? `sub-${event.common.msgId}` : `sub-${author.id}-${now}`,
    platform: 'tiktok',
    channel: uniqueId,
    author,
    fragments: [],
    rawText: '',
    timestampMs: now,
    receivedAtMs: now,
    isHighlighted: false,
    event: { kind: 'sub', source: 'platform' }
  }
}

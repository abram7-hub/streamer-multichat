import type { ChatBadge, ChatMessage, MessageFragment, StreamEvent } from '../../../../shared/chat-message'
import { isAllowedAssetUrl } from '../../../../shared/emote-url'

/** Odznaka subskrybenta kanału (z `subscriber_badges` w danych kanału) - oficjalny obrazek Kicka. */
export interface KickSubscriberBadge {
  months: number
  imageUrl: string
}

/** Dane kanału potrzebne do odznak; opcjonalne - bez nich odznaki ról bez obrazka są po prostu ukryte. */
export interface KickChannelContext {
  subscriberBadges: KickSubscriberBadge[]
}

interface KickIdentityBadge {
  text?: string
  type?: string
  count?: number
}
/** `badges_v2` z publicznego czatu - odznaki z oficjalnym obrazkiem na ext.cdn.kick.com. */
interface KickBadgeV2 {
  name?: string
  badge_type?: string
  image_url?: string
  metadata?: { level?: number } | null
  selected?: boolean
}

/* ── Format webhooka (oficjalne API, zdarzenie chat.message.sent) ───────────────────────────────── */

interface KickUser {
  user_id: number
  username: string
  identity?: { username_color?: string; badges?: KickIdentityBadge[] } | null
}
export interface KickChatMessageEvent {
  message_id: string
  broadcaster: KickUser
  sender: KickUser
  content: string
  emotes?: { emote_id: string; positions: { s: number; e: number }[] }[]
  created_at: string
}

/* ── Format publicznego czatu (Pusher, `App\Events\ChatMessageEvent`) - zweryfikowany na żywo ───── */

export interface KickPusherChatMessage {
  id?: string
  chatroom_id?: number
  content?: string
  type?: string
  created_at?: string
  sender?: {
    id?: number
    username?: string
    slug?: string
    identity?: { color?: string; badges?: KickIdentityBadge[]; badges_v2?: KickBadgeV2[] } | null
  }
}

const KICK_EMOTE_TOKEN = /\[emote:(\d+):([^\]]+)\]/g

function emoteUrl(id: string): string {
  return `https://files.kick.com/emotes/${id}/fullsize`
}

/** Nazwy ról Kicka do tooltipa (Kick zwraca też własny `text`, używany w pierwszej kolejności). */
const ROLE_LABELS: Record<string, string> = {
  broadcaster: 'Nadawca',
  moderator: 'Moderator',
  vip: 'VIP',
  og: 'OG',
  founder: 'Założyciel',
  verified: 'Zweryfikowany',
  staff: 'Kick Staff',
  subscriber: 'Subskrybent',
  sub_gifter: 'Podarowuje suby'
}

/** Tekst z tokenami `[emote:ID:nazwa]` (format publicznego czatu) -> fragmenty z emotkami inline. */
export function fragmentsFromEmoteTokens(content: string): MessageFragment[] {
  const fragments: MessageFragment[] = []
  let cursor = 0
  for (const match of content.matchAll(KICK_EMOTE_TOKEN)) {
    const [raw, id, name] = match
    const start = match.index ?? 0
    if (!id || !name) continue
    if (start > cursor) fragments.push({ type: 'text', text: content.slice(cursor, start) })
    fragments.push({ type: 'emote', text: name, url: emoteUrl(id) })
    cursor = start + raw.length
  }
  if (cursor < content.length) fragments.push({ type: 'text', text: content.slice(cursor) })
  return fragments
}

function buildWebhookFragments(content: string, emotes: KickChatMessageEvent['emotes']): MessageFragment[] {
  if (!emotes || emotes.length === 0) return fragmentsFromEmoteTokens(content)
  const ranges = emotes.flatMap((e) => e.positions.map((p) => ({ ...p, emoteId: e.emote_id }))).sort((a, b) => a.s - b.s)
  const fragments: MessageFragment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.s < cursor || !/^\d+$/.test(range.emoteId)) continue
    if (range.s > cursor) fragments.push({ type: 'text', text: content.slice(cursor, range.s) })
    const raw = content.slice(range.s, range.e + 1)
    const nameMatch = /\[emote:\d+:([^\]]+)\]/.exec(raw)
    fragments.push({ type: 'emote', text: nameMatch?.[1] ?? raw, url: emoteUrl(range.emoteId) })
    cursor = range.e + 1
  }
  if (cursor < content.length) fragments.push({ type: 'text', text: content.slice(cursor) })
  return fragments
}

/** Najwyższa odznaka subskrybenta nie większa niż liczba miesięcy subskrypcji. */
export function subscriberBadgeFor(months: number, badges: KickSubscriberBadge[]): string | undefined {
  let best: KickSubscriberBadge | undefined
  for (const b of badges) if (b.months <= months && (!best || b.months > best.months)) best = b
  return best?.imageUrl
}

/** Odznaki ról (legacy `badges`): obrazek mają tylko suby (z danych kanału); reszta zostaje bez obrazka. */
function roleBadges(raw: KickIdentityBadge[] | undefined, channel: KickChannelContext | undefined): ChatBadge[] {
  const out: ChatBadge[] = []
  for (const b of raw ?? []) {
    const type = typeof b.type === 'string' ? b.type : ''
    if (!type) continue
    const months = typeof b.count === 'number' ? b.count : 1
    const imageUrl = type === 'subscriber' && channel ? subscriberBadgeFor(months, channel.subscriberBadges) : undefined
    out.push({
      id: type,
      type,
      label: type === 'subscriber' ? `Subskrybent (${months} mies.)` : (b.text || ROLE_LABELS[type] || type),
      imageUrl: isAllowedAssetUrl(imageUrl, 'kick') ? imageUrl : undefined,
      provider: 'kick'
    })
  }
  return out
}

function v2Badges(raw: KickBadgeV2[] | undefined): ChatBadge[] {
  const out: ChatBadge[] = []
  for (const b of raw ?? []) {
    if (b.selected === false || typeof b.name !== 'string' || !isAllowedAssetUrl(b.image_url, 'kick')) continue
    const level = b.metadata?.level
    out.push({
      id: `v2:${b.name}`,
      type: b.name,
      label: b.name === 'level' && typeof level === 'number' ? `Poziom ${level}` : b.name,
      imageUrl: b.image_url,
      provider: 'kick'
    })
  }
  return out
}

function author(
  id: string,
  username: string,
  color: string | undefined,
  badges: ChatBadge[],
  isBroadcaster: boolean
): ChatMessage['author'] {
  const types = new Set(badges.map((b) => b.type))
  return {
    id,
    username,
    displayName: username,
    color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined,
    badges,
    isBroadcaster: isBroadcaster || types.has('broadcaster'),
    isModerator: types.has('moderator'),
    isSubscriber: types.has('subscriber') || types.has('founder')
  }
}

/** Wiadomość z webhooka (oficjalne API Kicka). */
export function normalizeKickMessage(
  event: KickChatMessageEvent,
  channelSlug: string,
  channel?: KickChannelContext
): ChatMessage {
  const badges = roleBadges(event.sender.identity?.badges, channel)
  const plainText = event.content.replace(/\[emote:\d+:([^\]]+)\]/g, '$1')
  return {
    id: event.message_id,
    platform: 'kick',
    channel: channelSlug,
    author: author(
      String(event.sender.user_id),
      event.sender.username,
      event.sender.identity?.username_color,
      badges,
      event.sender.user_id === event.broadcaster?.user_id
    ),
    fragments: buildWebhookFragments(event.content, event.emotes),
    rawText: plainText,
    timestampMs: Date.parse(event.created_at) || Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false
  }
}

/** Wiadomość z publicznego czatu (Pusher). Zwraca `undefined` dla niekompletnych danych. */
export function normalizeKickPusherMessage(
  data: KickPusherChatMessage,
  channelSlug: string,
  channel?: KickChannelContext
): ChatMessage | undefined {
  const sender = data.sender
  if (!data.id || typeof data.content !== 'string' || !sender?.username || sender.id === undefined) return undefined
  const identity = sender.identity ?? undefined
  // Kolejność jak w natywnym czacie Kicka: role (z obrazkiem tylko sub) -> odznaki z obrazkiem (poziom, kolekcje).
  const badges = [...roleBadges(identity?.badges, channel), ...v2Badges(identity?.badges_v2)]
  return {
    id: data.id,
    platform: 'kick',
    channel: channelSlug,
    author: author(String(sender.id), sender.username, identity?.color, badges, false),
    fragments: fragmentsFromEmoteTokens(data.content),
    rawText: data.content.replace(/\[emote:\d+:([^\]]+)\]/g, '$1'),
    timestampMs: (data.created_at && Date.parse(data.created_at)) || Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false
  }
}

/**
 * Publiczne zdarzenia kanału z Pushera (suby, gifty, hosty). Kształty wg danych publicznego czatu
 * Kicka; pola odczytywane defensywnie - przy braku wymaganych pól zdarzenie jest pomijane.
 */
export function normalizeKickPusherEvent(
  eventName: string,
  data: Record<string, unknown>,
  channelSlug: string,
  idSeed: string
): ChatMessage | undefined {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  let name: string | undefined
  let event: StreamEvent
  let text = ''
  switch (eventName) {
    case 'App\\Events\\SubscriptionEvent': {
      name = str(data['username'])
      const months = num(data['months'])
      event = months && months > 1 ? { kind: 'resub', source: 'platform', months } : { kind: 'sub', source: 'platform' }
      break
    }
    case 'App\\Events\\GiftedSubscriptionsEvent': {
      name = str(data['gifter_username'])
      const gifted = Array.isArray(data['gifted_usernames']) ? data['gifted_usernames'].filter((u) => typeof u === 'string') : []
      const anonymous = !name || name === 'Anonymous'
      event =
        gifted.length === 1
          ? { kind: 'gift_sub', source: 'platform', recipient: gifted[0] as string, anonymous }
          : { kind: 'community_gift', source: 'platform', giftCount: Math.max(1, gifted.length), anonymous }
      name = name ?? 'Anonymous'
      break
    }
    case 'App\\Events\\StreamHostEvent':
      name = str(data['host_username'])
      event = { kind: 'host', source: 'platform', viewers: num(data['number_viewers']) }
      text = str(data['optional_message']) ?? ''
      break
    default:
      return undefined
  }
  if (!name) return undefined
  const now = Date.now()
  return {
    id: `kick-event-${idSeed}`,
    platform: 'kick',
    channel: channelSlug,
    author: author(`kick-user:${name.toLowerCase()}`, name, undefined, [], false),
    fragments: text ? [{ type: 'text', text }] : [],
    rawText: text,
    timestampMs: now,
    receivedAtMs: now,
    isHighlighted: false,
    event
  }
}

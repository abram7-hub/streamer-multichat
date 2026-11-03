import type { ChatMessage, MessageFragment, StreamEvent } from '../../../../shared/chat-message'
import { twitchDefaultColor } from './irc-tags'
import { buildFragmentsFromEmoteRanges } from './irc-normalize'

type Json = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}
function obj(v: unknown): Json | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined
}

function textFragments(text: string | undefined): MessageFragment[] {
  return text ? [{ type: 'text', text }] : []
}

/** `message` z `channel.subscription.message`: `{ text, emotes: [{ begin, end, id }] }`. */
function subMessageFragments(message: Json | undefined): { text: string; fragments: MessageFragment[] } {
  const text = str(message?.['text']) ?? ''
  const emotesRaw = Array.isArray(message?.['emotes']) ? (message['emotes'] as unknown[]) : []
  const ranges = emotesRaw
    .map((e) => obj(e))
    .filter((e): e is Json => Boolean(e))
    .map((e) => ({ id: String(e['id'] ?? ''), start: num(e['begin']) ?? -1, end: num(e['end']) ?? -1 }))
    .filter((r) => r.id && r.start >= 0 && r.end >= r.start)
    .sort((a, b) => a.start - b.start)
  return { text, fragments: buildFragmentsFromEmoteRanges(text, ranges) }
}

function tierOf(v: unknown): string | undefined {
  const t = str(v)
  return t && ['1000', '2000', '3000'].includes(t) ? t : undefined
}

/** Polskie nazwy typów nagród automatycznych (lista z dokumentacji EventSub, v1 i v2). */
const AUTOMATIC_REWARD_TITLES: Record<string, string> = {
  single_message_bypass_sub_mode: 'Wyślij wiadomość w trybie tylko dla subów',
  send_highlighted_message: 'Wyróżnij moją wiadomość',
  random_sub_emote_unlock: 'Odblokuj losową emotkę suba',
  chosen_sub_emote_unlock: 'Wybierz emotkę do odblokowania',
  chosen_modified_sub_emote_unlock: 'Zmodyfikuj emotkę',
  message_effect: 'Efekt wiadomości',
  gigantify_an_emote: 'Powiększ emotkę',
  celebration: 'Świętowanie'
}

const MESSAGE_CARRYING_REWARDS = new Set(['single_message_bypass_sub_mode', 'send_highlighted_message'])

export interface EventSubNormalizeOptions {
  /** Ikona nagrody własnej po ID (z cache Helix Get Custom Reward), jeśli znana. */
  rewardImage?(rewardId: string): string | undefined
  /** Prawdziwy kolor nicku (ostatnio widziany w tagach IRC), jeśli znany. */
  userColor?(userId: string): string | undefined
}

export interface EventSubNotification {
  messageId: string
  subscriptionType: string
  condition: Json
  event: Json
}

/**
 * Czysta funkcja: zamienia powiadomienie EventSub na wspólny model wiadomości (z polem `event`).
 * Zwraca `undefined` dla zdarzeń, których nie pokazujemy (np. `channel.subscribe` z `is_gift` -
 * gift jest już ogłaszany zbiorczo przez `channel.subscription.gift`, więc pokazanie każdego
 * odbiorcy osobno zalałoby czat).
 */
export function normalizeEventSubNotification(
  n: EventSubNotification,
  channelLogin: string,
  opts: EventSubNormalizeOptions = {}
): ChatMessage | undefined {
  const e = n.event
  let event: StreamEvent
  let userId = str(e['user_id'])
  let login = str(e['user_login'])
  let name = str(e['user_name'])
  let fragments: MessageFragment[] = []
  let rawText = ''

  switch (n.subscriptionType) {
    case 'channel.channel_points_custom_reward_redemption.add': {
      const reward = obj(e['reward'])
      const rewardId = str(reward?.['id'])
      event = {
        kind: 'redemption',
        source: 'eventsub',
        rewardTitle: str(reward?.['title']) ?? 'Nagroda',
        rewardCost: num(reward?.['cost']),
        rewardImageUrl: rewardId ? opts.rewardImage?.(rewardId) : undefined
      }
      rawText = str(e['user_input']) ?? ''
      fragments = textFragments(rawText)
      break
    }
    case 'channel.channel_points_automatic_reward_redemption.add': {
      const reward = obj(e['reward'])
      const type = str(reward?.['type']) ?? ''
      event = {
        kind: 'redemption',
        source: 'eventsub',
        rewardTitle: AUTOMATIC_REWARD_TITLES[type] ?? 'Nagroda automatyczna',
        rewardCost: num(reward?.['channel_points']) ?? num(reward?.['cost'])
      }
      const emoteName = str(obj(reward?.['emote'])?.['name']) ?? str(obj(reward?.['unlocked_emote'])?.['name'])
      if (emoteName) event.itemName = emoteName
      // Nagrody niosące wiadomość czatu (wyróżniona, pominięcie trybu sub) - ta sama wiadomość
      // przychodzi też zwykłym czatem (IRC), więc tutaj jej nie powtarzamy.
      if (!MESSAGE_CARRYING_REWARDS.has(type)) {
        const msg = subMessageFragments(obj(e['message']))
        rawText = msg.text
        fragments = msg.fragments
      }
      break
    }
    case 'channel.subscribe':
      if (e['is_gift'] === true) return undefined
      event = { kind: 'sub', source: 'eventsub', tier: tierOf(e['tier']) }
      break
    case 'channel.subscription.message': {
      event = { kind: 'resub', source: 'eventsub', tier: tierOf(e['tier']), months: num(e['cumulative_months']) }
      const msg = subMessageFragments(obj(e['message']))
      rawText = msg.text
      fragments = msg.fragments
      break
    }
    case 'channel.subscription.gift': {
      const total = num(e['total']) ?? 1
      const anonymous = e['is_anonymous'] === true
      event =
        total > 1
          ? { kind: 'community_gift', source: 'eventsub', giftCount: total, tier: tierOf(e['tier']), anonymous }
          : { kind: 'gift_sub', source: 'eventsub', tier: tierOf(e['tier']), anonymous }
      break
    }
    case 'channel.cheer':
      event = { kind: 'cheer', source: 'eventsub', bits: num(e['bits']) ?? 0, anonymous: e['is_anonymous'] === true }
      rawText = str(e['message']) ?? ''
      fragments = textFragments(rawText)
      break
    case 'channel.raid': {
      const viewers = num(e['viewers']) ?? 0
      const incoming = str(n.condition['to_broadcaster_user_id']) !== undefined
      if (incoming) {
        event = { kind: 'raid_in', source: 'eventsub', viewers }
        userId = str(e['from_broadcaster_user_id'])
        login = str(e['from_broadcaster_user_login'])
        name = str(e['from_broadcaster_user_name'])
      } else {
        event = {
          kind: 'raid_out',
          source: 'eventsub',
          viewers,
          targetName: str(e['to_broadcaster_user_name']) ?? str(e['to_broadcaster_user_login'])
        }
        userId = str(e['from_broadcaster_user_id'])
        login = str(e['from_broadcaster_user_login'])
        name = str(e['from_broadcaster_user_name'])
      }
      break
    }
    case 'channel.follow':
      event = { kind: 'follow', source: 'eventsub' }
      break
    case 'channel.hype_train.begin':
      event = { kind: 'hype_train_begin', source: 'eventsub', level: num(e['level']) }
      userId = str(e['broadcaster_user_id'])
      login = str(e['broadcaster_user_login'])
      name = str(e['broadcaster_user_name'])
      break
    case 'channel.hype_train.end':
      event = { kind: 'hype_train_end', source: 'eventsub', level: num(e['level']) }
      userId = str(e['broadcaster_user_id'])
      login = str(e['broadcaster_user_login'])
      name = str(e['broadcaster_user_name'])
      break
    default:
      return undefined
  }

  const anonymous = event.anonymous === true
  const safeLogin = login ?? (anonymous ? 'anonymous' : 'unknown')
  const safeId = userId ?? safeLogin
  const now = Date.now()
  return {
    id: `eventsub-${n.messageId}`,
    platform: 'twitch',
    channel: channelLogin,
    author: {
      id: safeId,
      username: safeLogin,
      displayName: name ?? safeLogin,
      color: opts.userColor?.(safeId) ?? twitchDefaultColor(safeId),
      badges: [],
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments,
    rawText,
    timestampMs: now,
    receivedAtMs: now,
    isHighlighted: false,
    event
  }
}

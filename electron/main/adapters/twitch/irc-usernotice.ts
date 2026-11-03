import type { ChatMessage, StreamEvent } from '../../../../shared/chat-message'
import { toTwitchBadges, type BadgeResolver } from './badges'
import { type ParsedTaggedCommand, parseBadgesTag, parseEmotesTag, twitchDefaultColor } from './irc-tags'
import { buildFragmentsFromEmoteRanges } from './irc-normalize'

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
}

function tierFromPlan(plan: string | undefined): string | undefined {
  if (!plan) return undefined
  if (plan.toLowerCase() === 'prime') return 'prime'
  return ['1000', '2000', '3000'].includes(plan) ? plan : undefined
}

/**
 * Mapuje `msg-id` USERNOTICE na zdarzenie streamowe. To publiczne komunikaty czatu (każdy widz
 * widzi je w natywnym czacie Twitcha), więc są dostępne anonimowo dla DOWOLNEGO kanału - w odróżnieniu
 * od Channel Points, followów czy raidów wychodzących, które wymagają autoryzowanego EventSub
 * właściciela kanału. Nieobsługiwane `msg-id` (np. `bitsbadgetier`) -> `undefined`.
 */
function eventFromTags(tags: Record<string, string>): StreamEvent | undefined {
  const tier = tierFromPlan(tags['msg-param-sub-plan'])
  switch (tags['msg-id']) {
    case 'sub':
      return { kind: 'sub', source: 'irc', tier }
    case 'resub':
      return { kind: 'resub', source: 'irc', tier, months: toInt(tags['msg-param-cumulative-months']) }
    case 'subgift':
      // Pojedyncze gifty wchodzące w skład "community gift" (msg-param-community-gift-id) są pomijane -
      // zbiorczy komunikat `submysterygift` mówi już "X podarował N subów"; inaczej przy 50 giftach
      // czat zalałoby 51 wierszy.
      if (tags['msg-param-community-gift-id']) return undefined
      return {
        kind: 'gift_sub',
        source: 'irc',
        tier,
        recipient: tags['msg-param-recipient-display-name'] || tags['msg-param-recipient-user-name'] || undefined,
        anonymous: tags['login'] === 'ananonymousgifter'
      }
    case 'submysterygift':
      return {
        kind: 'community_gift',
        source: 'irc',
        tier,
        giftCount: toInt(tags['msg-param-mass-gift-count']) ?? 1,
        anonymous: tags['login'] === 'ananonymousgifter'
      }
    case 'raid':
      return { kind: 'raid_in', source: 'irc', viewers: toInt(tags['msg-param-viewerCount']) ?? 0 }
    case 'giftpaidupgrade':
    case 'anongiftpaidupgrade':
    case 'primepaidupgrade':
      return { kind: 'gift_upgrade', source: 'irc', tier }
    case 'viewermilestone':
      // Seria oglądania (nagroda za punkty kanału "watch streak") - publiczny komunikat czatu.
      if (tags['msg-param-category'] !== 'watch-streak') return undefined
      return { kind: 'watch_streak', source: 'irc', count: toInt(tags['msg-param-value']) ?? 0 }
    case 'announcement':
      return { kind: 'announcement', source: 'irc' }
    default:
      return undefined
  }
}

export function normalizeTwitchUserNotice(
  parsed: ParsedTaggedCommand,
  resolveBadge?: BadgeResolver,
  roomId?: string
): ChatMessage | undefined {
  const { tags } = parsed
  const event = eventFromTags(tags)
  if (!event) return undefined
  const login = tags['login'] || 'unknown'
  const userId = tags['user-id'] || login
  const displayName =
    event.kind === 'raid_in' ? tags['msg-param-displayName'] || tags['display-name'] || login : tags['display-name'] || login
  const badges = toTwitchBadges(parseBadgesTag(tags.badges), roomId ?? tags['room-id'], resolveBadge)
  const fragments = buildFragmentsFromEmoteRanges(parsed.text, parseEmotesTag(tags.emotes))
  const now = Date.now()
  return {
    id: tags.id || `usernotice-${login}-${now}`,
    platform: 'twitch',
    channel: parsed.channel,
    author: {
      id: userId,
      username: login,
      displayName,
      color: tags.color || twitchDefaultColor(userId),
      badges,
      isBroadcaster: false,
      isModerator: false,
      isSubscriber: false
    },
    fragments,
    rawText: parsed.text,
    timestampMs: tags['tmi-sent-ts'] ? Number(tags['tmi-sent-ts']) : now,
    receivedAtMs: now,
    isHighlighted: false,
    event
  }
}

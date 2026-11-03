import type { ChatMessage, MessageFragment, StreamEvent } from '../../../../shared/chat-message'

/**
 * Minimalny kształt `liveChatMessage` (YouTube Data API v3) - tylko używane pola, wszystkie
 * opcjonalne, bo dane przychodzą z sieci (strumień albo polling).
 */
export interface YouTubeChatItem {
  id?: string | null
  snippet?: {
    type?: string | null
    publishedAt?: string | null
    displayMessage?: string | null
    textMessageDetails?: { messageText?: string | null } | null
    superChatDetails?: { amountDisplayString?: string | null; userComment?: string | null } | null
    superStickerDetails?: {
      amountDisplayString?: string | null
      superStickerMetadata?: { altText?: string | null } | null
    } | null
    newSponsorDetails?: { memberLevelName?: string | null; isUpgrade?: boolean | null } | null
    memberMilestoneChatDetails?: { memberMonth?: number | null; memberLevelName?: string | null; userComment?: string | null } | null
    membershipGiftingDetails?: { giftMembershipsCount?: number | null; giftMembershipsLevelName?: string | null } | null
  } | null
  authorDetails?: {
    channelId?: string | null
    displayName?: string | null
    isChatOwner?: boolean | null
    isChatModerator?: boolean | null
    isChatSponsor?: boolean | null
    isVerified?: boolean | null
  } | null
}

function text(value: string | null | undefined): MessageFragment[] {
  return value ? [{ type: 'text', text: value }] : []
}

/**
 * Wiadomość albo zdarzenie z czatu YouTube. Role (właściciel, moderator, członek, zweryfikowany)
 * API zwraca wyłącznie jako flagi logiczne - bez oficjalnych obrazków - więc trafiają do
 * `isBroadcaster`/`isModerator`/`isSubscriber`, ale NIE jako tekstowe odznaki w wierszu czatu.
 * Zwraca `undefined` dla elementów, których nie pokazujemy (usunięte wiadomości, bany, ankiety,
 * pojedyncze otrzymane prezenty członkostwa - te ostatnie zalałyby czat przy dużym gifcie).
 */
export function normalizeYouTubeMessage(item: YouTubeChatItem, channelLabel: string): ChatMessage | undefined {
  const snippet = item.snippet
  const author = item.authorDetails
  if (!snippet || !author || !item.id) return undefined

  let event: StreamEvent | undefined
  let fragments: MessageFragment[]
  switch (snippet.type) {
    case 'textMessageEvent':
    case undefined:
    case null:
      fragments = text(snippet.textMessageDetails?.messageText ?? snippet.displayMessage)
      if (fragments.length === 0) return undefined
      break
    case 'superChatEvent':
      event = { kind: 'superchat', source: 'platform', amountFormatted: snippet.superChatDetails?.amountDisplayString ?? undefined }
      fragments = text(snippet.superChatDetails?.userComment)
      break
    case 'superStickerEvent':
      event = {
        kind: 'supersticker',
        source: 'platform',
        amountFormatted: snippet.superStickerDetails?.amountDisplayString ?? undefined,
        itemName: snippet.superStickerDetails?.superStickerMetadata?.altText ?? undefined
      }
      fragments = []
      break
    case 'newSponsorEvent':
      event = { kind: 'membership', source: 'platform', itemName: snippet.newSponsorDetails?.memberLevelName ?? undefined }
      fragments = []
      break
    case 'memberMilestoneChatEvent':
      event = {
        kind: 'member_milestone',
        source: 'platform',
        months: snippet.memberMilestoneChatDetails?.memberMonth ?? undefined,
        itemName: snippet.memberMilestoneChatDetails?.memberLevelName ?? undefined
      }
      fragments = text(snippet.memberMilestoneChatDetails?.userComment)
      break
    case 'membershipGiftingEvent':
      event = {
        kind: 'membership_gift',
        source: 'platform',
        giftCount: snippet.membershipGiftingDetails?.giftMembershipsCount ?? 1,
        itemName: snippet.membershipGiftingDetails?.giftMembershipsLevelName ?? undefined
      }
      fragments = []
      break
    default:
      return undefined
  }

  const name = author.displayName ?? 'Widz'
  const rawText = fragments.map((f) => f.text).join('')
  return {
    id: item.id,
    platform: 'youtube',
    channel: channelLabel,
    author: {
      id: author.channelId ?? 'unknown',
      username: name,
      displayName: name,
      badges: [],
      isBroadcaster: author.isChatOwner ?? false,
      isModerator: author.isChatModerator ?? false,
      isSubscriber: author.isChatSponsor ?? false
    },
    fragments,
    rawText,
    timestampMs: snippet.publishedAt ? Date.parse(snippet.publishedAt) || Date.now() : Date.now(),
    receivedAtMs: Date.now(),
    isHighlighted: false,
    event
  }
}

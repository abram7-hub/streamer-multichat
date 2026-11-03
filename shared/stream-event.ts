import type { StreamEvent } from './chat-message'

export interface StreamEventDescription {
  icon: string
  text: string
}

function tierLabel(tier: string | undefined): string {
  switch (tier) {
    case 'prime':
      return ' (Prime)'
    case '2000':
      return ' (Tier 2)'
    case '3000':
      return ' (Tier 3)'
    default:
      return ''
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function months(n: number): string {
  return `${n} ${plural(n, 'miesiąc', 'miesiące', 'miesięcy')}`
}

/**
 * Czysta funkcja: buduje polski opis zdarzenia streamowego. Zwraca zwykły tekst - renderer wstawia
 * go wyłącznie jako węzeł tekstowy Reacta (bez HTML), więc nazwy użytkowników/nagród z API nie
 * mogą wstrzyknąć znaczników.
 */
export function describeStreamEvent(event: StreamEvent, name: string): StreamEventDescription {
  const who = event.anonymous ? 'Anonimowy widz' : name
  switch (event.kind) {
    case 'redemption':
      return event.rewardTitle
        ? { icon: '⭐', text: `${name} odebrał(a) nagrodę „${event.rewardTitle}”` }
        : { icon: '⭐', text: `${name} odebrał(a) nagrodę Channel Points` }
    case 'sub':
      return { icon: '🎁', text: `${name} zasubskrybował(a) kanał${tierLabel(event.tier)}!` }
    case 'resub': {
      const n = event.months ?? 0
      return n > 1
        ? { icon: '🎁', text: `${name} zasubskrybował(a) kanał na ${months(n)}${tierLabel(event.tier)}!` }
        : { icon: '🎁', text: `${name} zasubskrybował(a) kanał${tierLabel(event.tier)}!` }
    }
    case 'gift_sub':
      return event.recipient
        ? { icon: '🎁', text: `${who} podarował(a) suba dla ${event.recipient}${tierLabel(event.tier)}!` }
        : { icon: '🎁', text: `${who} podarował(a) suba${tierLabel(event.tier)}!` }
    case 'community_gift': {
      const n = event.giftCount ?? 1
      return { icon: '🎁', text: `${who} podarował(a) ${n} ${plural(n, 'suba', 'suby', 'subów')}${tierLabel(event.tier)}!` }
    }
    case 'gift_upgrade':
      return { icon: '🎁', text: `${name} przedłuża podarowaną subskrypcję${tierLabel(event.tier)}!` }
    case 'raid_in': {
      const n = event.viewers ?? 0
      return { icon: '🚀', text: `${name} zrobił(a) raid z ${n} ${plural(n, 'widzem', 'widzami', 'widzami')}!` }
    }
    case 'raid_out': {
      const n = event.viewers ?? 0
      return { icon: '🚀', text: `Raid na kanał ${event.targetName ?? '?'} z ${n} ${plural(n, 'widzem', 'widzami', 'widzami')}!` }
    }
    case 'cheer': {
      const n = event.bits ?? 0
      return { icon: '💎', text: `${who} wysłał(a) ${n} ${plural(n, 'Bit', 'Bity', 'Bitsów')}!` }
    }
    case 'follow':
      return { icon: '💜', text: `${name} obserwuje kanał!` }
    case 'watch_streak': {
      const n = event.count ?? 0
      return { icon: '🔥', text: `${name} ogląda ${n} ${plural(n, 'stream', 'streamy', 'streamów')} z rzędu!` }
    }
    case 'announcement':
      return { icon: '📣', text: `Ogłoszenie od ${name}` }
    case 'hype_train_begin':
      return { icon: '🚂', text: `Hype Train wystartował${event.level ? ` (poziom ${event.level})` : ''}!` }
    case 'hype_train_end':
      return { icon: '🚂', text: `Hype Train zakończony${event.level ? ` na poziomie ${event.level}` : ''}!` }
    case 'superchat':
      return { icon: '💰', text: `${name} — Super Chat${event.amountFormatted ? ` ${event.amountFormatted}` : ''}` }
    case 'supersticker':
      return {
        icon: '💰',
        text: `${name} — Super Sticker${event.itemName ? ` „${event.itemName}”` : ''}${event.amountFormatted ? ` ${event.amountFormatted}` : ''}`
      }
    case 'membership':
      return { icon: '⭐', text: `${name} dołączył(a) do wspierających kanał${event.itemName ? ` (${event.itemName})` : ''}!` }
    case 'member_milestone':
      return { icon: '⭐', text: `${name} wspiera kanał od ${months(event.months ?? 0)}!` }
    case 'membership_gift': {
      const n = event.giftCount ?? 1
      return { icon: '🎁', text: `${name} podarował(a) ${n} ${plural(n, 'członkostwo', 'członkostwa', 'członkostw')}!` }
    }
    case 'host': {
      const n = event.viewers ?? 0
      return { icon: '🚀', text: `${name} hostuje kanał${n > 0 ? ` z ${n} ${plural(n, 'widzem', 'widzami', 'widzami')}` : ''}!` }
    }
    case 'tiktok_gift': {
      const n = event.count ?? 1
      return { icon: '🎁', text: `${name} wysłał(a) ${event.itemName ?? 'prezent'}${n > 1 ? ` ×${n}` : ''}` }
    }
  }
}

import type { ChatAuthor } from '../../shared/chat-message'
import type { IgnoreLists } from '../../shared/settings'
import type { Platform } from '../../shared/platform'

/**
 * Sprawdza, czy dany autor powinien zostać wyciszony na danej platformie. Dopasowanie po `id`
 * (stabilny identyfikator platformy) ma pierwszeństwo - dzięki temu zmiana wyświetlanej nazwy nie
 * omija filtra. Wpisy bez zapisanego `id` (np. dodane ręcznie w ustawieniach, zanim ktokolwiek napisał
 * na czacie) są dopasowywane po nazwie użytkownika, bez rozróżniania wielkości liter.
 */
export function isIgnored(author: { id: string; username: string }, platform: Platform, ignoreLists: IgnoreLists): boolean {
  const list = ignoreLists[platform]
  if (!list?.enabled || list.users.length === 0) return false
  const username = author.username.toLowerCase()
  return list.users.some((entry) => {
    const bothHaveStableIds = Boolean(entry.id) && Boolean(author.id) && author.id !== 'unknown'
    if (bothHaveStableIds) return entry.id === author.id
    return entry.username.toLowerCase() === username
  })
}

export function isAuthorIgnored(author: ChatAuthor, platform: Platform, ignoreLists: IgnoreLists): boolean {
  return isIgnored(author, platform, ignoreLists)
}

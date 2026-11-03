import type { ChatMessage } from '../../shared/chat-message'
import type { AppSettings } from '../../shared/settings'
import { compileMentionMatcher, platformNicks, type MentionMatcher } from '../../shared/mentions'

type MentionInputs = Pick<AppSettings, 'mentions' | 'twitch' | 'kick' | 'youtube' | 'tiktok' | 'ui'>

/**
 * Centralne wykrywanie wzmianek: jedno miejsce (proces główny), z którego oznaczona wiadomość trafia
 * do czatu głównego, Gaming Overlay i nakładki OBS. Dopasowanie jest kompilowane tylko po zmianie
 * ustawień, które na nie wpływają - każda nowa wiadomość to jedno sprawdzenie gotowego wyrażenia.
 */
export class MentionDetector {
  private key = ''
  private matcher: MentionMatcher | undefined

  private matcherFor(settings: MentionInputs): MentionMatcher {
    const nicks = platformNicks(settings)
    const { highlight: _h, sound: _s, ...detection } = settings.mentions
    const key = JSON.stringify([detection, nicks, settings.ui.highlightNick])
    if (!this.matcher || key !== this.key) {
      this.matcher = compileMentionMatcher(settings.mentions, nicks, settings.ui.highlightNick)
      this.key = key
    }
    return this.matcher
  }

  /** Zwraca wiadomość z ustawioną flagą `isHighlighted` (nowy obiekt tylko, gdy flaga się zmienia). */
  apply(message: ChatMessage, settings: MentionInputs): ChatMessage {
    const isMention = this.matcherFor(settings).matches(message)
    return isMention === message.isHighlighted ? message : { ...message, isHighlighted: isMention }
  }
}

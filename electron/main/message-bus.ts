import { EventEmitter } from 'node:events'
import type { ChatMessage } from '../../shared/chat-message'
import type { AdapterStatus } from '../../shared/platform'

/**
 * Centralny agregator wiadomości ze wszystkich adapterów.
 * Deduplikuje po `platform:id`, żeby ta sama wiadomość nie pojawiła się
 * dwa razy po ponownym połączeniu adaptera.
 */
class MessageBus extends EventEmitter {
  private readonly seenIds = new Set<string>()
  private readonly seenOrder: string[] = []
  private readonly maxSeen = 4000

  publish(message: ChatMessage): boolean {
    const key = `${message.platform}:${message.id}`
    if (this.seenIds.has(key)) return false
    this.seenIds.add(key)
    this.seenOrder.push(key)
    if (this.seenOrder.length > this.maxSeen) {
      const oldest = this.seenOrder.shift()
      if (oldest) this.seenIds.delete(oldest)
    }
    this.emit('message', message)
    return true
  }

  publishStatus(status: AdapterStatus): void {
    this.emit('status', status)
  }
}

export const messageBus = new MessageBus()

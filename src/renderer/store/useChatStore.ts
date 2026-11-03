import { create } from 'zustand'
import type { ActivityEvent, ChatMessage } from '@shared/chat-message'
import type { AdapterStatus, ConnectionState, Platform } from '@shared/platform'
import type { AppSettings } from '@shared/settings'
import { appendCapped, togglePinned } from '@shared/chat-history'
import { MENTION_LIMITS } from '@shared/mentions'

const MAX_MESSAGES_IN_MEMORY = 500
const MAX_MESSAGES_IN_MEMORY_LOW_RESOURCE = 150
const MAX_ACTIVITY_IN_MEMORY = 200
const MAX_ACTIVITY_IN_MEMORY_LOW_RESOURCE = 60

export interface WatchedChannelStatus {
  id: string
  state: ConnectionState
  message?: string
}

export interface ChatState {
  messages: ChatMessage[]
  activity: ActivityEvent[]
  statuses: Partial<Record<Platform, AdapterStatus>>
  watchedChannelStatuses: Record<string, WatchedChannelStatus>
  settings: AppSettings | undefined
  autoScroll: boolean
  /** Ostatnie wzmianki - referencje do tych samych obiektów co `messages`, bez kopii. */
  mentionHistory: ChatMessage[]
  /** Przypięte wiadomości (zostają też na swoim miejscu w historii czatu). */
  pinned: ChatMessage[]
  togglePin: (message: ChatMessage) => void
  /**
   * Dopisuje paczkę wiadomości JEDNYM wywołaniem `set()` (jedna aktualizacja stanu/reconciliation
   * Reacta zamiast N) - używane przez `MessageBatcher` w App.tsx do grupowania szybko napływających
   * wiadomości. Limit wiadomości w pamięci jest mniejszy w Trybie niskiego zużycia zasobów.
   */
  addMessages: (batch: ChatMessage[]) => void
  addActivities: (batch: ActivityEvent[]) => void
  setStatus: (status: AdapterStatus) => void
  setWatchedChannelStatus: (status: WatchedChannelStatus) => void
  setSettings: (settings: AppSettings) => void
  setAutoScroll: (value: boolean) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  activity: [],
  statuses: {},
  watchedChannelStatuses: {},
  settings: undefined,
  autoScroll: true,
  mentionHistory: [],
  pinned: [],
  togglePin: (message) => set((state) => ({ pinned: togglePinned(state.pinned, message) })),
  addMessages: (batch) => {
    if (batch.length === 0) return
    const cap = get().settings?.ui.lowResourceMode ? MAX_MESSAGES_IN_MEMORY_LOW_RESOURCE : MAX_MESSAGES_IN_MEMORY
    set((state) => {
      const next = state.messages.length === 0 ? batch.slice() : state.messages.concat(batch)
      if (next.length > cap) next.splice(0, next.length - cap)
      const mentions = batch.filter((m) => m.isHighlighted)
      return {
        messages: next,
        mentionHistory: appendCapped(state.mentionHistory, mentions, MENTION_LIMITS.historySize)
      }
    })
  },
  addActivities: (batch) => {
    if (batch.length === 0) return
    const cap = get().settings?.ui.lowResourceMode ? MAX_ACTIVITY_IN_MEMORY_LOW_RESOURCE : MAX_ACTIVITY_IN_MEMORY
    set((state) => {
      const next = state.activity.length === 0 ? batch.slice() : state.activity.concat(batch)
      if (next.length > cap) next.splice(0, next.length - cap)
      return { activity: next }
    })
  },
  setStatus: (status) => set((state) => ({ statuses: { ...state.statuses, [status.platform]: status } })),
  setWatchedChannelStatus: (status) =>
    set((state) => ({ watchedChannelStatuses: { ...state.watchedChannelStatuses, [status.id]: status } })),
  setSettings: (settings) => set({ settings }),
  setAutoScroll: (value) => set({ autoScroll: value }),
  clearMessages: () => set({ messages: [], activity: [], mentionHistory: [], pinned: [] })
}))

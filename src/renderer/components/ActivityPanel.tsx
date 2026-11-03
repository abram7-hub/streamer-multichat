import type { ActivityEvent } from '@shared/chat-message'

export function ActivityPanel({ events }: { events: ActivityEvent[] }) {
  const recent = events.slice(-100).reverse()
  return (
    <div className="activity-panel">
      <div className="activity-panel-header">Aktywność czatu Twitch (JOIN/PART)</div>
      <div className="activity-panel-list">
        {recent.length === 0 && <div className="help-text">Brak zdarzeń — czekam na dołączenia/opuszczenia czatu.</div>}
        {recent.map((event) => (
          <div key={event.id} className="activity-row" data-type={event.type}>
            <span className="activity-dot" data-type={event.type} />
            {event.username} {event.type === 'join' ? 'dołączył(a)' : 'opuścił(a)'}
          </div>
        ))}
      </div>
    </div>
  )
}

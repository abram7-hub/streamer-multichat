const SUBSCRIPTIONS_URL = 'https://api.kick.com/public/v1/events/subscriptions'

export async function subscribeToKickChatMessages(accessToken: string): Promise<void> {
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: [{ name: 'chat.message.sent', version: 1 }],
      method: 'webhook'
    })
  })
  if (!res.ok) {
    throw new Error(`Nie udało się utworzyć subskrypcji webhooka Kick (HTTP ${res.status}): ${await res.text()}`)
  }
}

export async function unsubscribeAllKick(accessToken: string): Promise<void> {
  const listRes = await fetch(SUBSCRIPTIONS_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!listRes.ok) return
  const data = (await listRes.json().catch(() => undefined)) as { data?: { id: string }[] } | undefined
  for (const sub of data?.data ?? []) {
    await fetch(`${SUBSCRIPTIONS_URL}?id=${encodeURIComponent(sub.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` }
    }).catch(() => undefined)
  }
}

export async function fetchKickChannel(
  accessToken: string,
  slug: string
): Promise<{ broadcasterUserId: number; isLive: boolean } | undefined> {
  const res = await fetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (!res.ok) return undefined
  const data = (await res.json()) as { data: { broadcaster_user_id: number; is_live: boolean }[] }
  const channel = data.data[0]
  if (!channel) return undefined
  return { broadcasterUserId: channel.broadcaster_user_id, isLive: channel.is_live }
}

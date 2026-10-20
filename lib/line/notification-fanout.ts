import { textMessage, type TemplateOverrides } from './templates'

/**
 * notifications -> LINE (spec F4). The notice row stays the only event; this only queues one
 * outbox row per eligible staff contact. The database decides who is eligible (switch in
 * policies.line.notify, menu, ACTIVE, LINKED) and dedupes per (notification, contact).
 */
export interface FanoutStore {
  recipients(notificationId: string): Promise<Array<{ contact_id: string }>>
  notification(notificationId: string): Promise<{ id: string; event_type: string; entity_id: string; title: string; body: string } | null>
  enqueueSystem(input: {
    contactId: string
    notificationId: string
    sourceId: string
    templateKey: 'STAFF_NOTICE'
    messages: unknown[]
    dedupeKey: string
  }): Promise<{ duplicate: boolean }>
}

export async function fanOutNotification(store: FanoutStore, notificationId: string, templates?: TemplateOverrides) {
  const n = await store.notification(notificationId)
  if (!n) return { queued: 0, duplicates: 0 }
  const recipients = await store.recipients(notificationId)
  if (recipients.length === 0) return { queued: 0, duplicates: 0 }
  const messages = [textMessage('STAFF_NOTICE', { หัวข้อ: n.title, รายละเอียด: n.body }, templates)]
  let queued = 0
  let duplicates = 0
  for (const r of recipients) {
    const res = await store.enqueueSystem({
      contactId: r.contact_id,
      notificationId: n.id,
      sourceId: n.entity_id,
      templateKey: 'STAFF_NOTICE',
      messages,
      dedupeKey: `N:${n.id}:${r.contact_id}`,
    })
    if (res.duplicate) duplicates++
    else queued++
  }
  return { queued, duplicates }
}

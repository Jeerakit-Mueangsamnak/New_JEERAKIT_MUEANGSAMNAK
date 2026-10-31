import { fanOutNotification, type FanoutStore } from './notification-fanout'
import { processOutbox, type OutboxRunResult, type OutboxStore } from './outbox'
import { LINE_REMINDER_RULES } from './config'
import { cardMessage } from './flex'
import { lineOaMessageUrl } from './oa-link'
import { customerNoticeMessages, renderTemplate, taskPostbackData, type TemplateOverrides } from './templates'
import { type LineMessage, type LineProvider } from './types'

/**
 * One scheduler round (/api/line/cron, every ~2 minutes): due-date scan → notices to staff
 * LINE → customer reminders on the Settings schedule → driver accept reminders → send the
 * queue. Every queue write is idempotent in the database, so a round that runs twice or dies
 * half way never sends a message twice.
 */

export interface ReminderRow {
  rule: string
  source_type: 'BILL' | 'APPOINTMENT'
  source_id: string
  contact_id: string
  customer_name: string
  ref_no: string
  due_at: string
  amount: number | string | null
  days_left: number
  dedupe_key: string
}

export interface CronStore {
  scanDue(): Promise<number>
  claimNotifications(limit: number): Promise<string[]>
  remindersDue(): Promise<ReminderRow[]>
  acceptOverdue(): Promise<Array<{ task_id: string; contact_id: string; title: string; dedupe_key: string }>>
  enqueueServer(input: {
    contactId: string
    sourceType: 'BILL' | 'APPOINTMENT' | 'TASK'
    sourceId: string
    taskId?: string | null
    templateKey: string
    messages: LineMessage[]
    dedupeKey: string
  }): Promise<{ duplicate: boolean }>
  /** Driver progress → shop notice + customer message (when switched on). */
  jobProgress(taskId: string, stage: string, stageLabel: string): Promise<void>
}

export interface CronShop {
  shopName: string
  templates: TemplateOverrides
  lineId: string | null
  phone: string | null
}

export interface CronResult {
  scanned: number
  notices: number
  reminders: number
  acceptReminders: number
  errors: number
  outbox: OutboxRunResult | null
}

const TZ = 'Asia/Bangkok'
export const formatThaiDate = (iso: string, withTime = false) =>
  new Intl.DateTimeFormat('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(
    new Date(iso),
  )
export const formatBaht = (n: number | string | null) =>
  new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0) || 0)

/** The template, title and texts of one reminder row (shared by the worker and the manual send). */
export function reminderMessages(row: Omit<ReminderRow, 'contact_id' | 'dedupe_key'>, shop: CronShop): { templateKey: string; messages: LineMessage[] } {
  const rule = LINE_REMINDER_RULES.find((r) => r.key === row.rule)
  if (!rule) throw new Error('LINE_REMINDER_RULE_UNKNOWN')
  const vars: Record<string, string> =
    row.source_type === 'APPOINTMENT'
      ? { ชื่อลูกค้า: row.customer_name || '-', เรื่อง: row.ref_no || '-', วันนัด: formatThaiDate(row.due_at, true), ชื่อร้าน: shop.shopName }
      : {
          ชื่อลูกค้า: row.customer_name || '-',
          เลขบิล: row.ref_no || '-',
          วันคืน: formatThaiDate(row.due_at, true),
          วันครบ: formatThaiDate(row.due_at),
          ยอดค้าง: formatBaht(row.amount),
          ชื่อร้าน: shop.shopName,
        }
  const messages = customerNoticeMessages(rule.template, rule.label, vars, shop.templates, {
    chatUrl: lineOaMessageUrl(shop.lineId, row.ref_no ? `สอบถาม ${row.ref_no}` : 'สอบถาม'),
    phone: shop.phone,
  })
  return { templateKey: rule.template, messages }
}

export async function runLineCron(opts: {
  store: CronStore & FanoutStore & OutboxStore
  shop: CronShop
  /** null = mock mode: queue only, nothing is pushed. */
  provider: LineProvider | null
}): Promise<CronResult> {
  const { store, shop } = opts
  const result: CronResult = { scanned: 0, notices: 0, reminders: 0, acceptReminders: 0, errors: 0, outbox: null }
  const safely = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch {
      result.errors++
    }
  }

  await safely(async () => {
    result.scanned = await store.scanDue()
  })

  await safely(async () => {
    for (const id of await store.claimNotifications(200)) {
      await safely(async () => {
        result.notices += (await fanOutNotification(store, id, shop.templates)).queued
      })
    }
  })

  await safely(async () => {
    for (const row of await store.remindersDue()) {
      await safely(async () => {
        const { templateKey, messages } = reminderMessages(row, shop)
        const r = await store.enqueueServer({
          contactId: row.contact_id,
          sourceType: row.source_type,
          sourceId: row.source_id,
          templateKey,
          messages,
          dedupeKey: row.dedupe_key,
        })
        if (!r.duplicate) result.reminders++
      })
    }
  })

  await safely(async () => {
    for (const late of await store.acceptOverdue()) {
      await safely(async () => {
        const text = renderTemplate('DRIVER_ACCEPT_REMINDER', { เรื่อง: late.title || 'งาน' }, shop.templates)
        const messages = [
          cardMessage({
            altText: text,
            title: text,
            buttons: [{ label: 'รับงาน', postback: taskPostbackData(late.task_id, 'ACCEPT'), displayText: 'รับงาน', primary: true }],
          }),
        ]
        const r = await store.enqueueServer({
          contactId: late.contact_id,
          sourceType: 'TASK',
          sourceId: late.task_id,
          taskId: late.task_id,
          templateKey: 'DRIVER_ACCEPT_REMINDER',
          messages,
          dedupeKey: late.dedupe_key,
        })
        if (!r.duplicate) result.acceptReminders++
      })
    }
  })

  if (opts.provider) {
    await safely(async () => {
      result.outbox = await processOutbox({ store, provider: opts.provider!, limit: 100 })
    })
  }
  return result
}

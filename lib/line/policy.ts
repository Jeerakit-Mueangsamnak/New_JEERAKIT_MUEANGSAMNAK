import { isTemplateKey, LINE_TEMPLATES } from './templates'
import { LINE_LIMITS } from './messages'
import { LINE_NUMBER_OPTIONS, LINE_REGISTER_FIELDS, LINE_REMINDER_RULES } from './config'

/**
 * store_settings.policies.line: the only LINE options, all non-secret. The database checks the
 * same rules on every save (trigger trg_store_settings_line_policy -> _line_policy_check); this
 * copy lets a screen or server action refuse bad input before the round trip. Keys and ranges
 * come from lib/line/config.ts.
 */

/**
 * The only parts of store_settings.policies the LINE server code reads. The whole column also carries
 * the shop's images (~600 KB), so LINE reads ask for these two paths alone (egress check 2026-11-20).
 */
export const SHOP_LINE_ID_COLUMN = 'line_id:policies->business_profile->>lineId'
export const SHOP_LINE_TEMPLATES_COLUMN = 'templates:policies->line->templates'

export const LINE_POLICY_INT_RANGES: Record<string, readonly [number, number]> = Object.fromEntries(
  Object.entries(LINE_NUMBER_OPTIONS).map(([k, o]) => [k, [o.min, o.max] as const]),
)

const EVENT_TYPE = /^[A-Z][A-Z0-9_]{1,59}$/
const PLACEHOLDER = /\{([^{}]+)\}/g
const RULE_INTS: Record<string, readonly [number, number]> = { daysBefore: [0, 30], repeatDays: [0, 30] }

export type LinePolicyCheck = { ok: true } | { ok: false; path: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, [min, max]: readonly [number, number]) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

export function validateLinePolicy(line: unknown): LinePolicyCheck {
  if (line === undefined || line === null) return { ok: true }
  if (!isObject(line)) return { ok: false, path: 'line' }
  for (const [key, value] of Object.entries(line)) {
    if (Object.prototype.hasOwnProperty.call(LINE_POLICY_INT_RANGES, key)) {
      if (!isInt(value, LINE_POLICY_INT_RANGES[key])) return { ok: false, path: `line.${key}` }
    } else if (key === 'notify' || key === 'customerStages') {
      if (!isObject(value)) return { ok: false, path: `line.${key}` }
      for (const [type, on] of Object.entries(value)) {
        if (!EVENT_TYPE.test(type) || typeof on !== 'boolean') return { ok: false, path: `line.${key}.${type.slice(0, 60)}` }
      }
    } else if (key === 'abuseAutoSuspend' || key === 'ownerCommands') {
      if (typeof value !== 'boolean') return { ok: false, path: `line.${key}` }
    } else if (key === 'friend') {
      if (!isObject(value)) return { ok: false, path: 'line.friend' }
      for (const [f, on] of Object.entries(value)) {
        if ((f !== 'welcome' && f !== 'notifyOwner') || typeof on !== 'boolean') return { ok: false, path: `line.friend.${f.slice(0, 60)}` }
      }
    } else if (key === 'catalog') {
      if (!isObject(value)) return { ok: false, path: 'line.catalog' }
      for (const [f, on] of Object.entries(value)) {
        if (f !== 'showPrice' || typeof on !== 'boolean') return { ok: false, path: `line.catalog.${f.slice(0, 60)}` }
      }
    } else if (key === 'register') {
      if (!isObject(value)) return { ok: false, path: 'line.register' }
      for (const [f, v] of Object.entries(value)) {
        const path = `line.register.${f.slice(0, 60)}`
        if (f === 'notifyOwner' || f === 'notifyApproved' || f === 'notifyRejected') {
          if (typeof v !== 'boolean') return { ok: false, path }
        } else if (f === 'privacy') {
          if (typeof v !== 'string' || v.trim() === '' || v.length > 1000) return { ok: false, path }
        } else if (f === 'required') {
          if (!isObject(v)) return { ok: false, path }
          for (const [field, on] of Object.entries(v)) {
            if (!(LINE_REGISTER_FIELDS as readonly string[]).includes(field) || typeof on !== 'boolean') return { ok: false, path: `${path}.${field.slice(0, 40)}` }
          }
        } else {
          return { ok: false, path }
        }
      }
    } else if (key === 'reminders') {
      if (!isObject(value)) return { ok: false, path: 'line.reminders' }
      for (const [rule, setting] of Object.entries(value)) {
        const path = `line.reminders.${rule.slice(0, 60)}`
        if (!LINE_REMINDER_RULES.some((r) => r.key === rule) || !isObject(setting)) return { ok: false, path }
        for (const [f, v] of Object.entries(setting)) {
          if (f === 'enabled' ? typeof v !== 'boolean' : !RULE_INTS[f] || !isInt(v, RULE_INTS[f])) return { ok: false, path: `${path}.${f}` }
        }
      }
    } else if (key === 'templates') {
      if (!isObject(value)) return { ok: false, path: 'line.templates' }
      for (const [tKey, text] of Object.entries(value)) {
        const path = `line.templates.${tKey.slice(0, 60)}`
        if (!isTemplateKey(tKey) || typeof text !== 'string' || text.trim() === '' || text.length > LINE_LIMITS.textLength) {
          return { ok: false, path }
        }
        const allowed = new Set<string>(LINE_TEMPLATES[tKey].vars)
        for (const m of text.matchAll(PLACEHOLDER)) if (!allowed.has(m[1])) return { ok: false, path }
      }
    } else {
      return { ok: false, path: `line.${key.slice(0, 60)}` }
    }
  }
  return { ok: true }
}

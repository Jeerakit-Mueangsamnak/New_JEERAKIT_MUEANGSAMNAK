import { isTemplateKey, LINE_TEMPLATES } from './templates'
import { LINE_LIMITS } from './messages'

/**
 * store_settings.policies.line: the only LINE options, all non-secret. The database checks the
 * same rules on every save (trigger trg_store_settings_line_policy -> _line_policy_check); this
 * copy lets a screen or server action refuse bad input before the round trip.
 */

export const LINE_POLICY_INT_RANGES = {
  linkCodeTtlMinutes: [2, 60],
  linkMaxFailures: [3, 10],
  linkLockMinutes: [5, 1440],
  linkGlobalMaxFailures: [10, 200],
} as const

const EVENT_TYPE = /^[A-Z][A-Z0-9_]{1,59}$/
const PLACEHOLDER = /\{([^{}]+)\}/g

export type LinePolicyCheck = { ok: true } | { ok: false; path: string }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function validateLinePolicy(line: unknown): LinePolicyCheck {
  if (line === undefined || line === null) return { ok: true }
  if (!isObject(line)) return { ok: false, path: 'line' }
  for (const [key, value] of Object.entries(line)) {
    if (Object.prototype.hasOwnProperty.call(LINE_POLICY_INT_RANGES, key)) {
      const [min, max] = LINE_POLICY_INT_RANGES[key as keyof typeof LINE_POLICY_INT_RANGES]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        return { ok: false, path: `line.${key}` }
      }
    } else if (key === 'notify') {
      if (!isObject(value)) return { ok: false, path: 'line.notify' }
      for (const [type, on] of Object.entries(value)) {
        if (!EVENT_TYPE.test(type) || typeof on !== 'boolean') return { ok: false, path: `line.notify.${type.slice(0, 60)}` }
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

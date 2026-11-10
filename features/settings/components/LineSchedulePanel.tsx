'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { CalendarClock, Route, Timer } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import { SETTINGS_HELPER, SETTINGS_INPUT, SETTINGS_LABEL, SETTINGS_SECTION, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import {
  LINE_CUSTOMER_STAGES,
  LINE_NUMBER_OPTIONS,
  LINE_REMINDER_RULES,
  LINE_SCHEDULE_NUMBER_KEYS,
  type LineReminderRuleKey,
  type LineReminderRuleSetting,
  type LineReminderSettings,
} from '@/lib/line/config'

/**
 * Settings › LINE › ตารางเตือน: customer reminder schedule, which driver steps the customer
 * hears about, and the timing options. Everything is rendered from lib/line/config.ts and
 * saved in policies.line (the section draft, saved with the page's บันทึก button).
 */

interface Props {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
}

const SWITCH = 'mt-0.5 w-4 h-4 text-emerald-700 dark:text-emerald-400 rounded'

export function LineSchedulePanel({ config, setConfig }: Props) {
  const other = config.line.other
  const reminders = (other.reminders ?? {}) as LineReminderSettings
  const stages = (other.customerStages ?? {}) as Record<string, boolean>
  const setOther = (key: string, value: unknown) =>
    setConfig((c) => {
      const next = { ...c.line.other }
      if (value === undefined) delete next[key]
      else next[key] = value
      return { ...c, line: { ...c.line, other: next } }
    })

  const setRule = (key: LineReminderRuleKey, patch: Partial<LineReminderRuleSetting>) => {
    const rule = { ...(reminders[key] ?? {}), ...patch }
    setOther('reminders', { ...reminders, [key]: rule })
  }

  return (
    <>
      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <CalendarClock className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
          <span>ตารางเตือนลูกค้าทาง LINE</span>
        </h4>
        <div className="space-y-2 max-w-3xl">
          {LINE_REMINDER_RULES.map((rule) => {
            const s = reminders[rule.key] ?? {}
            const on = s.enabled === true
            return (
              <div key={rule.key} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={rule.label}
                    checked={on}
                    onChange={(e) => setRule(rule.key, { enabled: e.target.checked })}
                    className={SWITCH}
                  />
                  <span>
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{rule.label}</span>
                  </span>
                </label>
                {rule.fields.length > 0 && (
                  <div className="mt-2 ml-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {rule.fields.map((f) => (
                      <div key={f.key}>
                        <label className={SETTINGS_LABEL} htmlFor={`line-rule-${rule.key}-${f.key}`}>
                          {f.label}
                        </label>
                        <NumericInput
                          id={`line-rule-${rule.key}-${f.key}`}
                          value={s[f.key] ?? f.default}
                          min={f.min}
                          max={f.max}
                          allowDecimals={false}
                          defaultValueOnBlur={f.default}
                          disabled={!on}
                          onChange={(v) => setRule(rule.key, { [f.key]: v === '' ? f.default : Math.min(Math.max(v, f.min), f.max) })}
                          className={SETTINGS_INPUT}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <Route className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>แจ้งลูกค้าเมื่อคนขับกดขั้นตอนงาน</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          {LINE_CUSTOMER_STAGES.map((st) => (
            <label key={st.key} className="flex items-start gap-2.5 py-1.5 cursor-pointer">
              <input
                type="checkbox"
                role="switch"
                aria-label={st.label}
                checked={stages[st.key] === true}
                onChange={(e) => {
                  const next = { ...stages }
                  if (e.target.checked) next[st.key] = true
                  else delete next[st.key]
                  setOther('customerStages', next)
                }}
                className={SWITCH}
              />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{st.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={SETTINGS_SECTION}>
        <h4 className={SETTINGS_SECTION_TITLE}>
          <Timer className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
          <span>เวลา</span>
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
          {LINE_SCHEDULE_NUMBER_KEYS.map((key) => {
            const o = LINE_NUMBER_OPTIONS[key]
            const value = typeof other[key] === 'number' ? (other[key] as number) : o.default
            return (
              <div key={key}>
                <label className={SETTINGS_LABEL} htmlFor={`line-opt-${key}`}>
                  {o.label}
                </label>
                <NumericInput
                  id={`line-opt-${key}`}
                  value={value}
                  min={o.min}
                  max={o.max}
                  allowDecimals={false}
                  defaultValueOnBlur={o.default}
                  onChange={(v) => setOther(key, v === '' ? undefined : Math.min(Math.max(v, o.min), o.max))}
                  className={SETTINGS_INPUT}
                />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

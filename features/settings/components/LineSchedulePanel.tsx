'use client'

import { type Dispatch, type SetStateAction } from 'react'
import { CalendarClock, Route, Timer } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import {
  SETTINGS_ROW_NUMBER,
  SETTINGS_ROW_UNIT,
  SettingsRow,
  SettingsRowsCard,
  SettingsSwitch,
} from '@/features/settings/components/SettingsRows'
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
 * LINE › ตั้งค่า › เตือนลูกค้า: customer reminder schedule, which driver steps the customer
 * hears about, and the timing options. Everything is rendered from lib/line/config.ts and
 * saved in policies.line (the section draft, saved with the page's บันทึก button).
 */

interface Props {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
}

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
    // Cards of rows, each setting with its controls and switch on the right (owner 2026-11-17: reference
    // "Connection logging" look). The page's save buttons stay in the LINE settings bottom bar.
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <SettingsRowsCard title="ตารางเตือนลูกค้าทาง LINE" icon={CalendarClock}>
        {LINE_REMINDER_RULES.map((rule) => {
          const s = reminders[rule.key] ?? {}
          const on = s.enabled === true
          return (
            <SettingsRow key={rule.key} label={rule.label}>
              {rule.fields.map((f) => (
                <span key={f.key} className="flex items-center gap-1">
                  <label className={SETTINGS_ROW_UNIT} htmlFor={`line-rule-${rule.key}-${f.key}`}>
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
                    className={SETTINGS_ROW_NUMBER}
                  />
                </span>
              ))}
              <SettingsSwitch label={rule.label} checked={on} onChange={(enabled) => setRule(rule.key, { enabled })} />
            </SettingsRow>
          )
        })}
      </SettingsRowsCard>

      <div className="space-y-4 min-w-0">
        <SettingsRowsCard title="แจ้งลูกค้าเมื่อคนขับกดขั้นตอนงาน" icon={Route}>
          {LINE_CUSTOMER_STAGES.map((st) => (
            <SettingsRow key={st.key} label={st.label}>
              <SettingsSwitch
                label={st.label}
                checked={stages[st.key] === true}
                onChange={(on) => {
                  const next = { ...stages }
                  if (on) next[st.key] = true
                  else delete next[st.key]
                  setOther('customerStages', next)
                }}
              />
            </SettingsRow>
          ))}
        </SettingsRowsCard>

        <SettingsRowsCard title="เวลา" icon={Timer}>
          {LINE_SCHEDULE_NUMBER_KEYS.map((key) => {
            const o = LINE_NUMBER_OPTIONS[key]
            const value = typeof other[key] === 'number' ? (other[key] as number) : o.default
            return (
              <SettingsRow key={key} label={<label htmlFor={`line-opt-${key}`}>{o.label}</label>}>
                <NumericInput
                  id={`line-opt-${key}`}
                  value={value}
                  min={o.min}
                  max={o.max}
                  allowDecimals={false}
                  defaultValueOnBlur={o.default}
                  onChange={(v) => setOther(key, v === '' ? undefined : Math.min(Math.max(v, o.min), o.max))}
                  className={SETTINGS_ROW_NUMBER}
                />
              </SettingsRow>
            )
          })}
        </SettingsRowsCard>
      </div>
    </div>
  )
}

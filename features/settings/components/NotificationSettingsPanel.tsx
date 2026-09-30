'use client'

import type { Dispatch, SetStateAction } from 'react'
import { BellRing, Eye, EyeOff, MessageSquare, Pencil, Plus, Save, Tag, Trash2 } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import type { SystemConfig } from '@/features/settings/types/settings-page.types'

interface AppointmentType {
  id: string
  label: string
}

interface NotificationSettingsPanelProps {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
  lineSecrets: {
    lineTokenInput: string
    setLineTokenInput: Dispatch<SetStateAction<string>>
    lineSecretInput: string
    setLineSecretInput: Dispatch<SetStateAction<string>>
    lineSecretsConfigured: { lineTokenConfigured: boolean; lineSecretConfigured: boolean }
    lineSecretsStatusLoaded: boolean
    lineSecretsStatusError: string | null
    isSavingLineSecrets: boolean
    showLineToken: boolean
    setShowLineToken: Dispatch<SetStateAction<boolean>>
    showLineSecret: boolean
    setShowLineSecret: Dispatch<SetStateAction<boolean>>
    handleSaveLineSecrets: () => Promise<void>
    handleClearLineSecrets: () => Promise<void>
  }
  appointments: {
    masterData: { appointmentTypes: AppointmentType[] }
    aptNewTypeName: string
    setAptNewTypeName: Dispatch<SetStateAction<string>>
    aptEditingTypeId: string | null
    setAptEditingTypeId: Dispatch<SetStateAction<string | null>>
    aptEditingTypeLabel: string
    setAptEditingTypeLabel: Dispatch<SetStateAction<string>>
    aptDeleteConfirmId: string | null
    setAptDeleteConfirmId: Dispatch<SetStateAction<string | null>>
    handleAptTypeAdd: () => void
    handleAptTypeUpdate: (id: string) => void
    handleAptTypeDelete: (id: string) => void
  }
}

export function NotificationSettingsPanel({ config, setConfig, lineSecrets, appointments }: NotificationSettingsPanelProps) {
  const {
    lineTokenInput, setLineTokenInput, lineSecretInput, setLineSecretInput,
    lineSecretsConfigured, lineSecretsStatusLoaded, lineSecretsStatusError,
    isSavingLineSecrets, showLineToken, setShowLineToken, showLineSecret, setShowLineSecret,
    handleSaveLineSecrets, handleClearLineSecrets,
  } = lineSecrets
  const {
    masterData, aptNewTypeName, setAptNewTypeName, aptEditingTypeId, setAptEditingTypeId,
    aptEditingTypeLabel, setAptEditingTypeLabel, aptDeleteConfirmId, setAptDeleteConfirmId,
    handleAptTypeAdd, handleAptTypeUpdate, handleAptTypeDelete,
  } = appointments

  return (
    <div className="space-y-2">
      {/* Group A: ประเภทการนัดหมาย (Appointment Types) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-teal-600" />
            <span>กลุ่ม A: ประเภทการนัดหมาย (Appointment Types)</span>
          </h4>
          <span className="text-[11px] text-slate-500">
            ทั้งหมด {masterData.appointmentTypes.length} ประเภท (Master Data)
          </span>
        </div>

        {/* Add New Appointment Type */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="ชื่อประเภทนัดหมายใหม่ เช่น 📦 รับสินค้าหน้างาน..."
            value={aptNewTypeName}
            onChange={(e) => setAptNewTypeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAptTypeAdd()
              }
            }}
            className="flex-1 h-9 px-3 py-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAptTypeAdd}
            className="h-9 px-3.5 py-0 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>เพิ่ม</span>
          </button>
        </div>

        {/* Appointment Types List */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {masterData.appointmentTypes.map((type) => (
            <div
              key={type.id}
              className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2"
            >
              {aptEditingTypeId === type.id ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={aptEditingTypeLabel}
                    onChange={(e) => setAptEditingTypeLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleAptTypeUpdate(type.id)
                      } else if (e.key === 'Escape') {
                        setAptEditingTypeId(null)
                      }
                    }}
                    className="flex-1 h-7 px-2.5 py-0 rounded-lg border border-teal-500 text-xs bg-white dark:bg-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAptTypeUpdate(type.id)}
                    className="h-7 px-2.5 py-0 rounded-lg bg-teal-600 text-white text-xs font-bold shrink-0 cursor-pointer"
                  >
                    บันทึก
                  </button>
                  <button
                    type="button"
                    onClick={() => setAptEditingTypeId(null)}
                    className="h-7 px-2.5 py-0 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold shrink-0 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    {type.label}
                  </span>
                  {aptDeleteConfirmId === type.id ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAptTypeDelete(type.id)}
                        className="h-7 px-2.5 py-0 rounded-lg bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs cursor-pointer"
                      >
                        ยืนยันลบ
                      </button>
                      <button
                        type="button"
                        onClick={() => setAptDeleteConfirmId(null)}
                        className="h-7 px-2.5 py-0 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setAptEditingTypeId(type.id)
                          setAptEditingTypeLabel(type.label)
                          setAptDeleteConfirmId(null)
                        }}
                        className="h-7 w-7 p-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors cursor-pointer"
                        title="แก้ไขชื่อประเภท"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAptDeleteConfirmId(type.id)
                          setAptEditingTypeId(null)
                        }}
                        className="h-7 w-7 p-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                        title="ลบประเภท"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Group B: การแจ้งเตือนในระบบ (System Alerts) */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
        <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5">
          <BellRing className="w-3.5 h-3.5 text-teal-600" />
          <span>กลุ่ม B: การแจ้งเตือนในระบบ (System Alerts)</span>
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* 1. กำหนดส่งสินค้า */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.deliveryReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      deliveryReminder: {
                        ...config.notifications?.deliveryReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  กำหนดส่งสินค้า
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนรายการนัดหมายส่งสินค้าล่วงหน้า
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.deliveryReminder?.daysBefore ?? 1}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      deliveryReminder: {
                        ...config.notifications?.deliveryReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={1}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.deliveryReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* 2. กำหนดคืนสินค้า */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.returnReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      returnReminder: {
                        ...config.notifications?.returnReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  กำหนดคืนสินค้า
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนบิลที่ใกล้ครบกำหนดรับคืนอุปกรณ์
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.returnReminder?.daysBefore ?? 1}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      returnReminder: {
                        ...config.notifications?.returnReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={1}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.returnReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* 3. ค้างชำระ */}
          <div className="py-2 flex items-center justify-between gap-2">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={config.notifications?.paymentReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      paymentReminder: {
                        ...config.notifications?.paymentReminder,
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  ค้างชำระ
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนยอดเงินค้างชำระที่ถึงกำหนด
                </span>
              </div>
            </label>
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[11px] text-slate-500">แจ้งล่วงหน้า</span>
              <NumericInput
                value={config.notifications?.paymentReminder?.daysBefore ?? 1}
                onChange={(val) => {
                  const num = val === '' ? 0 : Math.min(365, Math.max(0, val))
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      paymentReminder: {
                        ...config.notifications?.paymentReminder,
                        daysBefore: num,
                      },
                    },
                  })
                }}
                defaultValueOnBlur={1}
                min={0}
                max={365}
                allowDecimals={false}
                disabled={!config.notifications?.paymentReminder?.enabled}
                className="w-12 h-7 px-1.5 py-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-center font-bold text-xs disabled:opacity-50"
              />
              <span className="text-[11px] text-slate-500">วัน</span>
            </div>
          </div>

          {/* 4. สต็อกต่ำ */}
          <label className="py-2 flex items-center justify-between gap-2.5 cursor-pointer">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={config.notifications?.lowStockReminder?.enabled ?? config.productStock?.lowStockNotificationEnabled ?? true}
                onChange={(e) => {
                  const checked = e.target.checked
                  setConfig({
                    ...config,
                    productStock: {
                      ...config.productStock,
                      lowStockNotificationEnabled: checked,
                    },
                    notifications: {
                      ...config.notifications,
                      lowStockReminder: {
                        enabled: checked,
                      },
                    },
                  })
                }}
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  สต็อกต่ำ
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนเมื่อสินค้าพร้อมใช้ต่ำกว่าขั้นต่ำ
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold text-[10px]">
              Stock Alert
            </span>
          </label>

          {/* 5. สินค้าค้างคืน/คืนล่าช้า */}
          <label className="py-2 flex items-center justify-between gap-2.5 cursor-pointer">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={config.notifications?.overdueReturnReminder?.enabled ?? true}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    notifications: {
                      ...config.notifications,
                      overdueReturnReminder: {
                        enabled: e.target.checked,
                      },
                    },
                  })
                }
                className="w-4 h-4 text-teal-600 rounded"
              />
              <div>
                <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                  สินค้าค้างคืน / คืนล่าช้า
                </span>
                <span className="text-[11px] text-slate-500">
                  แจ้งเตือนรายการบิลที่เลยกำหนดส่งคืนอุปกรณ์
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 font-bold text-[10px]">
              Overdue Alert
            </span>
          </label>
        </div>
      </div>

      {/* Group C: LINE Notify / LINE Official Account */}
      <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-300 dark:border-emerald-800 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            <span>กลุ่ม C: การเชื่อมต่อ LINE Notify / LINE Official Account</span>
          </h4>
          <span className="px-2 py-0.5 rounded-full bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 font-extrabold text-[10px]">
            {lineSecretsStatusError
              ? 'ตรวจสอบไม่ได้'
              : !lineSecretsStatusLoaded
                ? 'กำลังตรวจสอบ'
                : lineSecretsConfigured.lineTokenConfigured || lineSecretsConfigured.lineSecretConfigured
                  ? 'ตั้งค่าแล้ว'
                  : 'ยังไม่ได้ตั้งค่า'}
          </span>
        </div>

        <div className="space-y-2.5">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              LINE Notify Token / Messaging API Channel Token
            </label>
            <div className="relative">
              <input
                type={showLineToken ? "text" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                value={lineTokenInput}
                placeholder={lineSecretsConfigured.lineTokenConfigured ? 'Token บันทึกอยู่บนเซิร์ฟเวอร์แล้ว' : 'ยังไม่ได้ตั้งค่า'}
                onChange={(e) => setLineTokenInput(e.target.value)}
                className="w-full h-9 pl-3 pr-8 py-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowLineToken(!showLineToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 focus:outline-none transition-colors cursor-pointer"
                aria-label={showLineToken ? "ซ่อน Token" : "แสดง Token"}
              >
                {showLineToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              LINE OA Channel Secret (สำหรับการตอบกลับอัตโนมัติ)
            </label>
            <div className="relative">
              <input
                type={showLineSecret ? "text" : "password"}
                autoComplete="new-password"
                spellCheck={false}
                value={lineSecretInput}
                placeholder={lineSecretsConfigured.lineSecretConfigured ? 'Secret บันทึกอยู่บนเซิร์ฟเวอร์แล้ว' : 'ยังไม่ได้ตั้งค่า'}
                onChange={(e) => setLineSecretInput(e.target.value)}
                className="w-full h-9 pl-3 pr-8 py-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowLineSecret(!showLineSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 focus:outline-none transition-colors cursor-pointer"
                aria-label={showLineSecret ? "ซ่อน Secret" : "แสดง Secret"}
              >
                {showLineSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            {lineSecretsStatusError
              ? lineSecretsStatusError
              : lineSecretsConfigured.lineTokenConfigured || lineSecretsConfigured.lineSecretConfigured
              ? 'ข้อมูลเดิมถูกเก็บฝั่งเซิร์ฟเวอร์แล้ว ช่องว่างหมายถึงคงค่าเดิมไว้'
              : 'กรอกข้อมูลเพื่อจัดเก็บอย่างปลอดภัย; ค่าเหล่านี้จะไม่ถูกเก็บใน browser'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSaveLineSecrets()}
              disabled={isSavingLineSecrets || (!lineTokenInput.trim() && !lineSecretInput.trim())}
              className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>{isSavingLineSecrets ? 'กำลังบันทึก...' : 'บันทึก LINE credentials'}</span>
            </button>
            {(lineSecretsConfigured.lineTokenConfigured || lineSecretsConfigured.lineSecretConfigured) && (
              <button
                type="button"
                onClick={() => void handleClearLineSecrets()}
                disabled={isSavingLineSecrets}
                className="h-9 px-3.5 rounded-xl border border-red-300 text-red-700 dark:text-red-300 disabled:opacity-50 text-xs font-bold"
              >
                ลบ credentials ที่บันทึกไว้
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

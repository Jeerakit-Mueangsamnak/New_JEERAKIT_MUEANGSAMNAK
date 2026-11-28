'use client'

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { KeyRound, ScanLine } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { clearSlipCheckKey, getSlipCheckKeyStatus, saveSlipCheckKey, type SlipCheckKeyStatus } from '@/app/actions/system-secrets'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import { SETTINGS_ROW_INPUT, SettingsRow, SettingsRowsCard, SettingsSwitch } from '@/features/settings/components/SettingsRows'
import { ActionButton } from '@/components/common/ActionButton'
import { StatusPill } from '@/features/settings/components/StatusPill'

const NAME_SLOTS = 5

/**
 * การชำระเงิน › ตั้งค่าตรวจสลิป (OWNER, owner 2026-11-26: ก): automatic slip check of the slips sent from the LINE pay form.
 * The switch and the shop's receiving account names are saved with the page (policies.line.slipCheck); the EasySlip key
 * goes straight to Vault by its own buttons and is never shown back. The check only puts a label on สลิปรอตรวจ.
 */
export function LineSlipCheckSettings({
  config,
  setConfig,
  footer,
}: {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
  footer?: ReactNode
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const sc = config.line.slipCheck
  const names = sc.receiverNames ?? []
  const setSc = (patch: Partial<SystemConfig['line']['slipCheck']>) =>
    setConfig((c) => ({ ...c, line: { ...c.line, slipCheck: { ...c.line.slipCheck, ...patch } } }))
  const setName = (i: number, value: string) => {
    const next = Array.from({ length: NAME_SLOTS }, (_, k) => (k === i ? value : names[k] ?? ''))
    // keep the typed slots in place while editing; empty slots at the end are dropped on save
    while (next.length && next[next.length - 1] === '') next.pop()
    setSc({ receiverNames: next })
  }

  const [key, setKey] = useState('')
  const [status, setStatus] = useState<SlipCheckKeyStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    getSlipCheckKeyStatus()
      .then(setStatus)
      .catch(() => setStatus({ available: false, configured: false }))
  }, [])

  const saveKey = async () => {
    setBusy(true)
    try {
      setStatus(await saveSlipCheckKey(key))
      setKey('')
      showToast('บันทึกแล้ว', 'บันทึกรหัส EasySlip เรียบร้อย', 'SUCCESS')
    } catch (e) {
      showToast('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setBusy(false)
    }
  }
  const clearKey = async () => {
    const ok = await confirm({ title: 'ลบรหัส EasySlip', message: 'สลิปที่ส่งมาหลังจากนี้จะไม่ถูกตรวจอัตโนมัติ', confirmLabel: 'ลบรหัส', danger: true })
    if (!ok) return
    setBusy(true)
    try {
      setStatus(await clearSlipCheckKey())
      showToast('ลบแล้ว', 'ลบรหัส EasySlip แล้ว', 'SUCCESS')
    } catch (e) {
      showToast('ลบไม่สำเร็จ', e instanceof Error ? e.message : 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-testid="line-slip-check-settings">
      <SettingsRowsCard title="ตรวจสลิปอัตโนมัติ" icon={ScanLine} footer={footer}>
        <SettingsRow label="ตรวจสลิปที่ลูกค้าส่งทาง LINE">
          <SettingsSwitch label="ตรวจสลิปที่ลูกค้าส่งทาง LINE" checked={sc.enabled === true} onChange={(on) => setSc({ enabled: on })} />
        </SettingsRow>
        {Array.from({ length: NAME_SLOTS }, (_, i) => (
          <SettingsRow key={i} label={`บัญชีผู้รับของร้าน ${i + 1}`}>
            <input
              className={SETTINGS_ROW_INPUT}
              maxLength={100}
              value={names[i] ?? ''}
              aria-label={`บัญชีผู้รับของร้าน ${i + 1}`}
              onChange={(e) => setName(i, e.target.value)}
            />
          </SettingsRow>
        ))}
      </SettingsRowsCard>

      <SettingsRowsCard title="รหัส EasySlip" icon={KeyRound}>
        <SettingsRow label="สถานะ">
          {status && <StatusPill ok={status.configured} okText="ตั้งค่าแล้ว" noText={status.available ? 'ยังไม่ได้ตั้งค่า' : 'ยังไม่พร้อมในฐานข้อมูล'} />}
        </SettingsRow>
        <SettingsRow label="รหัส API (API key)">
          <input
            type="password"
            autoComplete="off"
            className={SETTINGS_ROW_INPUT}
            value={key}
            aria-label="รหัส API ของ EasySlip"
            onChange={(e) => setKey(e.target.value)}
          />
        </SettingsRow>
        <div className="px-3 py-2 flex flex-wrap justify-end gap-2">
          {status?.configured && (
            <ActionButton variant="danger" disabled={busy} onClick={() => void clearKey()}>
              ลบรหัส
            </ActionButton>
          )}
          <ActionButton variant="primary" disabled={busy || key.trim().length < 20 || status?.available === false} onClick={() => void saveKey()}>
            บันทึกรหัส
          </ActionButton>
        </div>
      </SettingsRowsCard>
    </div>
  )
}

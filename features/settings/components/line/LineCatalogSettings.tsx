'use client'

import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import { useToast } from '@/components/common/Toast'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'
import { getLineCatalogAdmin, setLineCatalog, type LineCatalogCategory } from '@/app/actions/line'
import type { SystemConfig } from '@/features/settings/services/settings-storage'
import { LineChatPreview } from '@/features/settings/components/LineChatPreview'
import { LineEditorLayout } from '@/features/settings/components/LineEditorLayout'
import { SETTINGS_ROW_NUMBER, SettingsRow, SettingsRowsCard, SettingsSwitch } from '@/features/settings/components/SettingsRows'

/**
 * ตั้งค่า › รายการสินค้า (OWNER): what a person who added the OA may see in the product list in LINE. Nothing is shown until
 * it is ticked here; a product the shop switched off never shows. Ticks are saved at once (the data lives in the product
 * rows, not in the settings draft); the price switch is a setting and goes with the page's บันทึก.
 */
const SMALL = `${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`
const baht = (n: number | null) => (n === null ? '-' : n.toLocaleString('th-TH', { maximumFractionDigits: 2 }))

export function LineCatalogSettings({
  config,
  setConfig,
  footer,
}: {
  config: SystemConfig
  setConfig: Dispatch<SetStateAction<SystemConfig>>
  footer?: ReactNode
}) {
  const { showToast } = useToast()
  const [categories, setCategories] = useState<LineCatalogCategory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const showPrice = config.line.catalog.showPrice === true
  const shopName = config.business.businessName.trim() || 'ร้านของคุณ'

  const load = useCallback(async () => {
    const r = await getLineCatalogAdmin()
    if (!r.success || !r.data) return setError(r.error || 'โหลดรายการสินค้าไม่สำเร็จ')
    setError(null)
    setCategories(r.data.categories)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  /** Saves one tick, shows it at once, and reads the list again only when the database refused. */
  const tick = async (kind: 'CATEGORY' | 'PRODUCT' | 'CATEGORY_PRODUCTS', id: string, listed: boolean, order?: number) => {
    setBusy(true)
    try {
      const r = await setLineCatalog(kind, id, listed, order)
      if (!r.success) {
        showToast('บันทึกไม่สำเร็จ', r.error, 'ERROR')
        return void (await load())
      }
      setCategories((cats) =>
        (cats ?? []).map((c) => {
          if (kind === 'CATEGORY') return c.id === id ? { ...c, line_listed: listed, line_order: order ?? c.line_order } : c
          if (kind === 'CATEGORY_PRODUCTS') return c.id === id ? { ...c, products: c.products.map((p) => ({ ...p, line_listed: listed })) } : c
          return { ...c, products: c.products.map((p) => (p.id === id ? { ...p, line_listed: listed } : p)) }
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const shown = (categories ?? []).filter((c) => c.line_listed && c.active && c.products.some((p) => p.line_listed && p.active))
  const sorted = [...shown].sort((a, b) => a.line_order - b.line_order || a.name.localeCompare(b.name, 'th'))

  return (
    <LineEditorLayout
      preview={
        <LineChatPreview
          shopName={shopName}
          caption={<b className="text-slate-800 dark:text-slate-200">คนที่เพิ่มเพื่อนจะเห็นแบบนี้</b>}
          bubbles={
            sorted.length === 0
              ? [{ from: 'shop', text: 'ยังไม่มีรายการสินค้าให้แสดง', empty: true }]
              : [{ from: 'me', text: 'ดูรายการสินค้า' }, { from: 'shop', text: 'เลือกหมวดสินค้าที่สนใจได้เลย', buttons: sorted.slice(0, 4).map((c) => c.name) }]
          }
        />
      }
    >
      <SettingsRowsCard title="รายการสินค้าใน LINE" icon={Package} footer={footer}>
        <SettingsRow label="แสดงราคาในรายการสินค้า">
          <SettingsSwitch
            label="แสดงราคาในรายการสินค้า"
            checked={showPrice}
            onChange={(on) => setConfig((c) => ({ ...c, line: { ...c.line, catalog: on ? { showPrice: true } : {} } }))}
          />
        </SettingsRow>
        <SettingsRow label="สินค้าที่ปิดใช้งานในระบบ" description="ไม่แสดงใน LINE เสมอ แม้ติ๊กไว้" />
      </SettingsRowsCard>

      {error && <p className="rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-800 dark:text-amber-200">{error}</p>}
      <SettingsRowsCard title="หมวดหมู่และสินค้าที่แสดง" icon={Package}>
        {(categories ?? []).map((c) => {
          const ticked = c.products.filter((p) => p.line_listed).length
          const open = openId === c.id
          return (
            <div key={c.id}>
              <SettingsRow
                label={
                  <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="flex items-center gap-1 text-left cursor-pointer" aria-expanded={open}>
                    {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    {c.name}
                    {!c.active && <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">(ปิดใช้งาน)</span>}
                  </button>
                }
                description={`เลือกแล้ว ${ticked} จาก ${c.products.length} รายการ`}
              >
                <label className="flex items-center gap-1 text-[11px] text-slate-700 dark:text-slate-300">
                  ลำดับ
                  <NumericInput
                    aria-label={`ลำดับของหมวด ${c.name}`}
                    value={c.line_order}
                    min={0}
                    max={9999}
                    allowDecimals={false}
                    defaultValueOnBlur={0}
                    disabled={busy}
                    onChange={(v) => {
                      if (v !== '' && v !== c.line_order) void tick('CATEGORY', c.id, c.line_listed, v)
                    }}
                    className={SETTINGS_ROW_NUMBER}
                  />
                </label>
                <SettingsSwitch label={`แสดงหมวด ${c.name}`} checked={c.line_listed} disabled={busy} onChange={(on) => void tick('CATEGORY', c.id, on)} />
              </SettingsRow>
              {open && (
                <div className="px-4 pb-2 space-y-1">
                  <div className="flex gap-2 py-1">
                    <button type="button" disabled={busy} className={SMALL} onClick={() => void tick('CATEGORY_PRODUCTS', c.id, true)}>เลือกทั้งหมวด</button>
                    <button type="button" disabled={busy} className={SMALL} onClick={() => void tick('CATEGORY_PRODUCTS', c.id, false)}>ล้างทั้งหมวด</button>
                  </div>
                  {c.products.map((p) => (
                    <label key={p.id} className={`flex items-center gap-2 text-xs ${p.active ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
                      <input type="checkbox" className="w-4 h-4" checked={p.line_listed} disabled={busy} onChange={(e) => void tick('PRODUCT', p.id, e.target.checked)} />
                      <span className="flex-1 min-w-0 truncate">
                        {p.name}
                        {!p.active && ' (ปิดใช้งาน)'}
                      </span>
                      <span className="tabular-nums text-[11px] text-slate-600 dark:text-slate-400">
                        {p.can_rent && `เช่า ${baht(p.rental_price)}`}
                        {p.can_rent && p.can_sell && ' · '}
                        {p.can_sell && `ขาย ${baht(p.sale_price)}`}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </SettingsRowsCard>
    </LineEditorLayout>
  )
}

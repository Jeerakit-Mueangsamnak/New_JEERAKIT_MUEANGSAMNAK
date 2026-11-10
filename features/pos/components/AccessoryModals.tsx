'use client'

/**
 * Accessory windows of the POS (owner 2026-11-09, pictures "น็อตเสา" and "อุปกรณ์นั่งร้าน").
 * They only work out which accessories and how many; `onAdd` puts them in the cart as rental lines
 * without a rental charge. Stock is checked here and again by the page and the server.
 */
import React, { useMemo, useState } from 'react'
import { AlertTriangle, Layers } from 'lucide-react'
import type { Product } from '@/lib/types/rental-pos'
import { AppModal, AppModalBody, AppModalFooter, AppModalHeader } from '@/components/common/AppModal'
import { NumericInput } from '@/components/common/NumericInput'
import { QuickQuantityGrid } from '@/features/pos/components/QuickQuantityGrid'
import {
  ACCESSORY_CATEGORY,
  NUT_HEIGHTS,
  NUT_LIST_ITEM,
  NUT_SECTIONS,
  SCAFFOLD_LIST_ITEM,
  SCAFFOLD_PARTS,
  type ScaffoldPartKey,
  findNutProduct,
  findScaffoldPart,
  nutTotal,
  scaffoldPartQuantities,
} from '@/features/pos/services/accessory-rules'

export interface AccessoryLine {
  product: Product
  quantity: number
}

interface AccessoryModalProps {
  products: Product[]
  /** Adds the lines to the cart; false = refused (the window stays open). */
  onAdd: (lines: AccessoryLine[]) => boolean
  onClose: () => void
  /** Quotation: more than the free stock may be quoted (warning only). */
  allowOverStock?: boolean
}

const LABEL = 'block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1'
const INPUT =
  'w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-bold text-base focus:ring-2 focus:ring-emerald-500 focus:outline-none'
/** A read-only result box the same height as INPUT. */
const RESULT_BOX =
  'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-slate-100 font-black text-base text-center whitespace-nowrap overflow-hidden text-ellipsis'
const CHOICE = 'py-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer'
const CHOICE_ON = 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500'
const CHOICE_OFF =
  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'

const available = (p: Product) => {
  const n = Number(p.availableQuantity ?? p.available_qty ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const whole = (v: number | '') => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0)

function Problems({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (errors.length === 0 && warnings.length === 0) return null
  return (
    <div className="space-y-1.5">
      {errors.map((e) => (
        <div key={e} role="alert" className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 text-xs font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{e}</span>
        </div>
      ))}
      {warnings.map((w) => (
        <div key={w} className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  )
}

/** Stock problems of the lines: over the free stock blocks a bill, only warns on a quotation. */
function stockProblems(lines: AccessoryLine[], allowOverStock: boolean) {
  const over = lines
    .filter((l) => l.quantity > available(l.product))
    .map((l) => `${l.product.name}: ต้องการ ${l.quantity} แต่สต็อกพร้อมใช้มี ${available(l.product)} ${l.product.unit || ''}`.trim())
  return allowOverStock
    ? { errors: [] as string[], warnings: over.map((o) => `${o} — เสนอราคาได้ แต่ต้องมีของพอตอนเปิดบิล`) }
    : { errors: over, warnings: [] as string[] }
}

function Footer({ canAdd, onAdd, onClose }: { canAdd: boolean; onAdd: () => void; onClose: () => void }) {
  return (
    <AppModalFooter>
      <div className="flex-1 flex items-center justify-end gap-2 w-full">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold text-xs transition-colors cursor-pointer"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-lg shadow-emerald-500/30 transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          เพิ่มลงตะกร้า
        </button>
      </div>
    </AppModalFooter>
  )
}

/** The pick → confirm behaviour of the quick numbers, plus a guard against adding twice. */
function useQuickPick(initial: number) {
  const [value, setValue] = useState<number | ''>(initial)
  const [picked, setPicked] = useState<number | null>(initial)
  const [pending, setPending] = useState(false)
  const [added, setAdded] = useState(false)
  return {
    value,
    picked,
    pending,
    added,
    setAdded,
    type: (v: number | '') => {
      setValue(v)
      setPicked(typeof v === 'number' && v <= 50 ? v : null)
      setPending(false)
    },
    pick: (n: number) => {
      setValue(n)
      setPicked(n)
      setPending(true)
    },
  }
}

export function NutAccessoryModal({ products, onAdd, onClose, allowOverStock = false }: AccessoryModalProps) {
  const [sectionIdx, setSectionIdx] = useState<number | null>(null)
  const [heightIdx, setHeightIdx] = useState<number | null>(null)
  const columns = useQuickPick(1)

  const section = sectionIdx === null ? null : NUT_SECTIONS[sectionIdx]
  const height = heightIdx === null ? null : NUT_HEIGHTS[heightIdx]
  const product = section ? findNutProduct(products, section.inch) : null
  const qtyFor = (cols: number) => (height ? nutTotal(height.perColumn, cols) : 0)
  const total = qtyFor(whole(columns.value))
  const unit = product?.unit || 'ตัว'

  const missing =
    section && !product
      ? [`ยังไม่มีน็อต ${section.inch} นิ้ว ในหมวด ${ACCESSORY_CATEGORY} รายการ "${NUT_LIST_ITEM}" (ชื่อสินค้าต้องมีคำว่า ${section.inch}นิ้ว)`]
      : []
  const stock = product && total > 0 ? stockProblems([{ product, quantity: total }], allowOverStock) : { errors: [], warnings: [] }
  const ready = (qty: number) => Boolean(section && height && product && qty > 0) && missing.length === 0 && !columns.added
  const canAdd = ready(total) && stock.errors.length === 0

  const add = (qty: number) => {
    if (!product || !ready(qty)) return
    if (!allowOverStock && qty > available(product)) return
    columns.setAdded(true)
    if (onAdd([{ product, quantity: qty }])) onClose()
    else columns.setAdded(false)
  }

  return (
    <AppModal isOpen={true} onClose={onClose} size="md">
      <AppModalHeader onClose={onClose} icon={<Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />}>
        <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">น็อตเสา</h3>
      </AppModalHeader>

      <AppModalBody className="space-y-4">
        <div>
          <span className={LABEL}>ขนาดหน้าตัดเสา</span>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="ขนาดหน้าตัดเสา">
            {NUT_SECTIONS.map((s, i) => (
              <button key={s.label} type="button" aria-pressed={sectionIdx === i} onClick={() => setSectionIdx(i)} className={`${CHOICE} ${sectionIdx === i ? CHOICE_ON : CHOICE_OFF}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={LABEL}>ความสูงเสา</span>
          <div className="grid grid-cols-5 gap-2" role="group" aria-label="ความสูงเสา">
            {NUT_HEIGHTS.map((h, i) => (
              <button key={h.label} type="button" aria-pressed={heightIdx === i} onClick={() => setHeightIdx(i)} className={`${CHOICE} ${heightIdx === i ? CHOICE_ON : CHOICE_OFF}`}>
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {/* จำนวนต้น | ขนาดน็อต | จำนวนน็อต — each with its heading on top, nothing wraps (owner 2026-11-09) */}
        <div className="grid grid-cols-3 gap-3 items-end">
          <div>
            <label className={LABEL} htmlFor="nut-columns">
              จำนวนต้นที่ต้องการ
            </label>
            <NumericInput id="nut-columns" value={columns.value} onChange={columns.type} defaultValueOnBlur={1} min={1} allowDecimals={false} className={INPUT} />
          </div>
          <div>
            <span className={LABEL}>ขนาดน็อต</span>
            <div className={RESULT_BOX} data-testid="nut-size">
              {section ? `${section.inch} นิ้ว` : '–'}
            </div>
          </div>
          <div>
            <span className={LABEL}>จำนวนน็อต</span>
            <div className={RESULT_BOX} data-testid="nut-result">
              {section && height ? `${total.toLocaleString('th-TH')} ${unit}` : '–'}
            </div>
          </div>
        </div>

        <Problems errors={[...missing, ...stock.errors]} warnings={stock.warnings} />

        <QuickQuantityGrid selected={columns.picked} pendingConfirm={columns.pending} onPick={columns.pick} onConfirm={(n) => add(qtyFor(n))} />
      </AppModalBody>

      <Footer canAdd={canAdd} onAdd={() => add(total)} onClose={onClose} />
    </AppModal>
  )
}

export function ScaffoldAccessoryModal({ products, onAdd, onClose, allowOverStock = false }: AccessoryModalProps) {
  const sets = useQuickPick(1)
  const [parts, setParts] = useState<Record<ScaffoldPartKey, number | ''>>(() => scaffoldPartQuantities(1))
  const partProducts = useMemo(
    () => Object.fromEntries(SCAFFOLD_PARTS.map((p) => [p.key, findScaffoldPart(products, p.key)])) as Record<ScaffoldPartKey, Product | null>,
    [products]
  )

  // A new number of sets works every part out again; each part can still be changed (0 = not added).
  const setSetCount = (v: number | '') => {
    sets.type(v)
    setParts(scaffoldPartQuantities(whole(v)))
  }
  const pickSets = (n: number) => {
    sets.pick(n)
    setParts(scaffoldPartQuantities(n))
  }

  const linesFor = (q: Record<ScaffoldPartKey, number | ''>): AccessoryLine[] =>
    SCAFFOLD_PARTS.flatMap((p) => {
      const product = partProducts[p.key]
      const quantity = whole(q[p.key])
      return product && quantity > 0 ? [{ product, quantity }] : []
    })
  const missingFor = (q: Record<ScaffoldPartKey, number | ''>) =>
    SCAFFOLD_PARTS.filter((p) => whole(q[p.key]) > 0 && !partProducts[p.key]).map(
      (p) => `ยังไม่มี "${p.label}" ในหมวด ${ACCESSORY_CATEGORY} รายการ "${SCAFFOLD_LIST_ITEM}"`
    )

  const lines = linesFor(parts)
  const missing = missingFor(parts)
  const stock = stockProblems(lines, allowOverStock)
  const canAdd = lines.length > 0 && missing.length === 0 && stock.errors.length === 0 && !sets.added

  const add = (q: Record<ScaffoldPartKey, number | ''>) => {
    const l = linesFor(q)
    if (l.length === 0 || missingFor(q).length > 0 || sets.added) return
    if (stockProblems(l, allowOverStock).errors.length > 0) return
    sets.setAdded(true)
    if (onAdd(l)) onClose()
    else sets.setAdded(false)
  }

  const partField = (key: ScaffoldPartKey) => {
    const part = SCAFFOLD_PARTS.find((p) => p.key === key)!
    const product = partProducts[key]
    const unit = product?.unit || (key === 'CROSS' ? 'คู่' : 'ตัว')
    return (
      <div>
        <label className={LABEL} htmlFor={`scaffold-${key}`}>
          {part.label} ({unit})
        </label>
        <NumericInput
          id={`scaffold-${key}`}
          value={parts[key]}
          onChange={(v) => setParts((prev) => ({ ...prev, [key]: v }))}
          defaultValueOnBlur={0}
          min={0}
          allowDecimals={false}
          className={INPUT}
        />
      </div>
    )
  }

  return (
    <AppModal isOpen={true} onClose={onClose} size="md">
      <AppModalHeader onClose={onClose} icon={<Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />}>
        <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">อุปกรณ์นั่งร้าน</h3>
      </AppModalHeader>

      <AppModalBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {partField('CROSS')}
          <div>
            <label className={LABEL} htmlFor="scaffold-sets">
              จำนวนนั่งร้าน (ชุด)
            </label>
            <NumericInput id="scaffold-sets" value={sets.value} onChange={setSetCount} defaultValueOnBlur={1} min={1} allowDecimals={false} className={INPUT} />
          </div>
          {partField('CAP')}
          {partField('JOINT')}
        </div>

        <Problems errors={[...missing, ...stock.errors]} warnings={stock.warnings} />

        <QuickQuantityGrid selected={sets.picked} pendingConfirm={sets.pending} onPick={pickSets} onConfirm={(n) => add(scaffoldPartQuantities(n))} />
      </AppModalBody>

      <Footer canAdd={canAdd} onAdd={() => add(parts)} onClose={onClose} />
    </AppModal>
  )
}

'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  CheckCircle2,
  Printer,
  Search,
  RotateCcw,
  Package,
} from 'lucide-react'
import { NumericInput } from '@/components/common/NumericInput'
import { CustomSelect } from '@/components/common/CustomSelect'
import { ActionButton } from '@/components/common/ActionButton'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { Product } from '@/lib/types/rental-pos'
import { useToast } from '@/components/common/Toast'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { applyStockCount, StockCountPartialError } from '@/features/products/services/product-storage'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import { isPinCancelled } from '@/lib/db/pin-confirm'
import { printTable } from '@/lib/print/print-service'

export interface StockCountRowState {
  productId: string
  productCode: string
  productName: string
  category: string
  unit: string
  originalQuantity: number
  originalAvailableQuantity: number
  normalQty: number | ''
  lostQty: number | ''
  damagedQty: number | ''
  soldQty: number | ''
}

interface ProductStockCountViewProps {
  products: Product[]
  onSuccess?: (updatedProducts: Product[]) => void
  onNavigateToList?: () => void
}

export function ProductStockCountView({
  products,
  onSuccess,
  onNavigateToList,
}: ProductStockCountViewProps) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [countItems, setCountItems] = useState<StockCountRowState[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [roundNote, setRoundNote] = useState('')

  // Initialize count items whenever products change
  useEffect(() => {
    if (!products.length) {
      setCountItems([])
      return
    }

    // The server counts active products only; "ปกติ" is compared with the AVAILABLE quantity
    const initial: StockCountRowState[] = products.filter((p) => p.status !== 'INACTIVE').map((p) => ({
      productId: p.id,
      productCode: p.code,
      productName: p.name,
      category: p.category || 'ทั่วไป',
      unit: p.unit || 'ชิ้น',
      originalQuantity: p.totalQuantity,
      originalAvailableQuantity: p.availableQuantity,
      normalQty: '',
      lostQty: '',
      damagedQty: '',
      soldQty: '',
    }))
    setCountItems(initial)
  }, [products])

  // Category filter options
  const categoryOptions = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category || 'ทั่วไป').filter(Boolean)))
    return [
      { value: 'ALL', label: 'หมวดหมู่: ทั้งหมด' },
      ...cats.map((c) => ({ value: c, label: c })),
    ]
  }, [products])

  // Filtered rows by category and search term
  const filteredItems = useMemo(() => {
    return countItems.filter((item) => {
      const matchCat = selectedCategory === 'ALL' || item.category === selectedCategory
      const matchSearch =
        searchTerm.trim() === '' ||
        item.productName.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.productCode.toLowerCase().includes(searchTerm.toLowerCase().trim())
      return matchCat && matchSearch
    })
  }, [countItems, selectedCategory, searchTerm])

  // Count modified items
  const modifiedItems = useMemo(() => {
    return countItems.filter(
      (i) => i.normalQty !== '' || i.damagedQty !== '' || i.lostQty !== '' || i.soldQty !== ''
    )
  }, [countItems])

  const handleFieldChange = (
    productId: string,
    field: 'normalQty' | 'lostQty' | 'damagedQty' | 'soldQty',
    val: number | ''
  ) => {
    const num = val === '' ? '' : Math.max(0, Math.floor(val))
    setCountItems((prev) =>
      prev.map((item) => {
        if (item.productId === productId) {
          return { ...item, [field]: num }
        }
        return item
      })
    )
  }

  // Clear all entered counts
  const handleClearAll = () => {
    setCountItems((prev) =>
      prev.map((item) => ({
        ...item,
        normalQty: '',
        lostQty: '',
        damagedQty: '',
        soldQty: '',
      }))
    )
    setRoundNote('')
    showToast('ล้างข้อมูลแล้ว', 'ล้างค่าที่กรอกในตารางตรวจนับทั้งหมดเรียบร้อย', 'INFO')
  }

  // Print every row of the current search / category filter (not only the rows on screen)
  const handlePrintTable = () => {
    const categoryLabel = categoryOptions.find((o) => o.value === selectedCategory)?.label || selectedCategory
    const qty = (v: number | '') => (v === '' ? '' : v)
    const ok = printTable({
      title: 'ใบตรวจนับสต็อกสินค้า',
      subtitle: [categoryLabel, searchTerm.trim() && `ค้นหา "${searchTerm.trim()}"`, roundNote.trim() && `หมายเหตุ: ${roundNote.trim()}`]
        .filter(Boolean)
        .join(' · '),
      columns: [
        { label: 'ลำดับ', align: 'center' },
        { label: 'รหัส' },
        { label: 'ชื่อสินค้า' },
        { label: 'ยอดเดิม', align: 'right' },
        { label: 'ปกติ', align: 'right' },
        { label: 'สูญหาย', align: 'right' },
        { label: 'ชำรุด', align: 'right' },
        { label: 'ขายออก', align: 'right' },
      ],
      rows: filteredItems.map((item, idx) => [
        idx + 1,
        item.productCode,
        item.productName,
        `${item.originalAvailableQuantity} ${item.unit}`,
        qty(item.normalQty),
        qty(item.lostQty),
        qty(item.damagedQty),
        qty(item.soldQty),
      ]),
      orientation: 'portrait',
    })
    if (!ok) showToast('ไม่มีข้อมูลสำหรับพิมพ์', 'ไม่มีรายการตามตัวกรองปัจจุบัน', 'INFO')
  }

  // Confirm Stock Count
  const handleConfirmStockCount = async () => {
    setIsSubmitting(true)
    try {
      if (modifiedItems.length === 0) {
        showToast('ไม่มีรายการแก้ไข', 'กรุณากรอกผลการตรวจนับอย่างน้อย 1 รายการก่อนบันทึก', 'INFO')
        return
      }

      // Review the differences first (Master §11.4: count → discrepancy → review → PIN → adjustment).
      const fmt = (from: number, to: number) => `${from} → ${to} (${to - from >= 0 ? '+' : ''}${to - from})`
      let pinSteps = 0
      const reviewLines = modifiedItems.map((item) => {
        const p = products.find((x) => x.id === item.productId)
        const parts: string[] = []
        if (item.normalQty !== '') parts.push(`ปกติ ${fmt(item.originalAvailableQuantity, Number(item.normalQty))}`)
        if (item.damagedQty !== '' && Number(item.damagedQty) !== (p?.damagedQuantity || 0)) {
          parts.push(`ชำรุด ${fmt(p?.damagedQuantity || 0, Number(item.damagedQty))}`)
          pinSteps += 1
        }
        if (item.lostQty !== '' && Number(item.lostQty) !== (p?.lostQuantity || 0)) {
          parts.push(`สูญหาย ${fmt(p?.lostQuantity || 0, Number(item.lostQty))}`)
          pinSteps += 1
        }
        return `• ${item.productName}: ${parts.join(', ') || 'ไม่เปลี่ยน'}`
      })
      if (modifiedItems.some((item) => item.normalQty !== '')) pinSteps += 1
      const shown = reviewLines.slice(0, 15)
      if (reviewLines.length > shown.length) shown.push(`… และอีก ${reviewLines.length - shown.length} รายการ`)
      const reviewed = await confirm({
        title: 'ตรวจผลต่างก่อนปรับยอดสต็อก',
        message:
          `${shown.join('\n')}\n\n` +
          (pinSteps > 1
            ? `จะถาม PIN ${pinSteps} ครั้ง (1 ครั้งต่อ 1 การปรับยอด) — กดยกเลิกที่ PIN แรก ยอดสต็อกจะไม่เปลี่ยน`
            : 'กดยืนยันแล้วใส่ PIN เพื่อปรับยอด — กดยกเลิก ยอดสต็อกจะไม่เปลี่ยน'),
        confirmLabel: 'ยืนยันและใส่ PIN',
      })
      if (!reviewed) return

      const updatedList = await applyStockCount(
        modifiedItems.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          counts: {
            normalQty: item.normalQty === '' ? undefined : Number(item.normalQty),
            damagedQty: item.damagedQty === '' ? undefined : Number(item.damagedQty),
            lostQty: item.lostQty === '' ? undefined : Number(item.lostQty),
            soldQty: item.soldQty === '' ? undefined : Number(item.soldQty),
          },
        })),
        roundNote.trim() || 'ตรวจนับสต็อกจากหน้างาน'
      )
      setRoundNote('')

      if (onSuccess) {
        onSuccess(updatedList)
      }

      showToast(
        'ตรวจนับสต็อกสำเร็จ',
        `บันทึกผลตรวจนับ ${modifiedItems.length} รายการ และบันทึกประวัติ Audit แล้ว`,
        'SUCCESS'
      )
    } catch (err: any) {
      if (err instanceof StockCountPartialError) {
        // Some adjustments were confirmed before the stop: show the real stock now.
        if (onSuccess) onSuccess(err.products)
        showToast('บันทึกบางส่วน', err.message, 'INFO')
      } else if (isPinCancelled(err)) {
        showToast('ยกเลิกแล้ว', 'ยังไม่ได้ปรับยอด — ยอดสต็อกไม่เปลี่ยน และไม่มีรอบนับค้าง', 'INFO')
      } else {
        showToast('เกิดข้อผิดพลาด', err?.message || 'ไม่สามารถบันทึกผลตรวจนับได้', 'ERROR')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Table Toolbar */}
      <div className="p-2 sm:p-2.5 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
          {/* Search Box */}
          <div className="relative min-w-[140px] flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="ค้นหาชื่อสินค้าที่ต้องการนับ..."
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Category Dropdown */}
          <div className="w-40 sm:w-48 shrink-0">
            <CustomSelect
              value={selectedCategory}
              onChange={(val) => setSelectedCategory(val)}
              options={categoryOptions}
              buttonClassName="h-9 px-2.5 py-0 rounded-xl"
            />
          </div>

          {/* หมายเหตุของรอบนับ (ใช้กับทุกรายการในรอบนี้) */}
          <input
            type="text"
            value={roundNote}
            onChange={(e) => setRoundNote(e.target.value)}
            placeholder="หมายเหตุรอบนับ..."
            className="min-w-[140px] flex-1 max-w-xs h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all placeholder:text-slate-400"
          />
        </div>

        {/* Action Buttons: Clear, Print, Save */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {modifiedItems.length > 0 && (
            <ActionButton
              type="button"
              onClick={handleClearAll}
              disabled={isSubmitting}
              variant="outline"
              icon={<RotateCcw />}
              className="h-9 !py-0 px-3.5 text-xs rounded-xl"
            >
              ล้างค่า
            </ActionButton>
          )}

          <ActionButton
            type="button"
            onClick={handlePrintTable}
            disabled={isSubmitting}
            variant="outline"
            icon={<Printer />}
            className="h-9 !py-0 px-3.5 text-xs rounded-xl"
          >
            พิมพ์ตารางตรวจนับ
          </ActionButton>

          <ActionButton
            type="button"
            onClick={handleConfirmStockCount}
            disabled={isSubmitting || modifiedItems.length === 0}
            variant="primary"
            icon={isSubmitting ? undefined : <CheckCircle2 />}
            className="h-9 !py-0 px-3.5 text-xs rounded-xl"
            badge={
              !isSubmitting && modifiedItems.length > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono font-black">
                  {modifiedItems.length}
                </span>
              ) : undefined
            }
          >
            {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกการนับสต็อก'}
          </ActionButton>
        </div>
      </div>

      {/* Main Stock Count Table Card Content */}
      <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
        <DataTableFrame fill className="flex-1 min-h-0 rounded-none bg-transparent">
          <table className="w-full text-left border-collapse table-fixed text-xs">
            <colgroup>
              <col className="w-9 sm:w-10" />
              <col className="w-auto" />
              <col className="w-14 sm:w-16" />
              <col className="w-14 sm:w-16" />
              <col className="w-14 sm:w-16" />
              <col className="w-14 sm:w-16" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#E3E3E3] dark:bg-slate-900 text-slate-500 font-bold text-xs border-b border-slate-200 dark:border-slate-700 shadow-xs">
              <tr>
                <th className="w-9 sm:w-10 py-2 px-2 text-center whitespace-nowrap">ลำดับ</th>
                <th className="py-2 px-3 text-left whitespace-nowrap">ชื่อสินค้า</th>
                <th className="w-14 sm:w-16 py-2 px-1.5 text-center whitespace-nowrap">ยอดเดิม</th>
                <th className="w-14 sm:w-16 py-2 px-1 text-center text-emerald-600 dark:text-emerald-400 whitespace-nowrap">ปกติ</th>
                <th className="w-14 sm:w-16 py-2 px-1 text-center text-red-600 dark:text-red-400 whitespace-nowrap">สูญหาย</th>
                <th className="w-14 sm:w-16 py-2 px-1 text-center text-amber-600 dark:text-amber-400 whitespace-nowrap">ชำรุด</th>
                <th className="w-14 sm:w-16 py-2 px-1 text-center text-purple-600 dark:text-purple-400 whitespace-nowrap">ขายออก</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    <Package className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2 opacity-60" />
                    <p className="font-bold text-sm">ไม่พบรายการสินค้าที่ค้นหา</p>
                    <p className="text-xs text-slate-400 mt-0.5">ลองเปลี่ยนคำค้นหาหรือตัวกรองหมวดหมู่</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, idx) => (
                  <tr
                    key={item.productId}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    {/* 1. ลำดับ */}
                    <td className="px-1 py-1.5 text-center font-bold text-slate-500 whitespace-nowrap">
                      {idx + 1}
                    </td>

                    {/* 2. ชื่อสินค้า (แสดงบรรทัดเดียว) */}
                    <td className="px-2 py-1.5 min-w-0">
                      <span
                        className="font-extrabold text-slate-900 dark:text-slate-100 text-xs truncate block whitespace-nowrap"
                        title={item.productName}
                      >
                        {item.productName}
                      </span>
                    </td>

                    {/* 3. ยอดเดิม (บรรทัดเดียว) */}
                    <td className="px-1 py-1.5 text-center whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs">
                        {item.originalAvailableQuantity}
                      </span>{' '}
                      <span className="text-[10px] text-slate-400 font-normal">{item.unit}</span>
                    </td>

                    {/* 4. ปกติ */}
                    <td className="px-0.5 py-1.5 text-center">
                      <NumericInput
                        value={item.normalQty}
                        onChange={(val) => handleFieldChange(item.productId, 'normalQty', val)}
                        placeholder=""
                        min={0}
                        allowDecimals={false}
                        className="w-full max-w-[50px] mx-auto px-1 py-1 rounded-lg border border-emerald-300 dark:border-emerald-800 text-center font-extrabold text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 focus:outline-none focus:ring-1.5 focus:ring-emerald-400"
                      />
                    </td>

                    {/* 5. สูญหาย */}
                    <td className="px-0.5 py-1.5 text-center">
                      <NumericInput
                        value={item.lostQty}
                        onChange={(val) => handleFieldChange(item.productId, 'lostQty', val)}
                        placeholder=""
                        min={0}
                        allowDecimals={false}
                        className="w-full max-w-[50px] mx-auto px-1 py-1 rounded-lg border border-red-300 dark:border-red-800 text-center font-extrabold text-xs bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 focus:outline-none focus:ring-1.5 focus:ring-red-400"
                      />
                    </td>

                    {/* 6. ชำรุด */}
                    <td className="px-0.5 py-1.5 text-center">
                      <NumericInput
                        value={item.damagedQty}
                        onChange={(val) => handleFieldChange(item.productId, 'damagedQty', val)}
                        placeholder=""
                        min={0}
                        allowDecimals={false}
                        className="w-full max-w-[50px] mx-auto px-1 py-1 rounded-lg border border-amber-300 dark:border-amber-800 text-center font-extrabold text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 focus:outline-none focus:ring-1.5 focus:ring-amber-400"
                      />
                    </td>

                    {/* 7. ขายออก */}
                    <td className="px-0.5 py-1.5 text-center">
                      <NumericInput
                        value={item.soldQty}
                        onChange={(val) => handleFieldChange(item.productId, 'soldQty', val)}
                        placeholder=""
                        min={0}
                        allowDecimals={false}
                        className="w-full max-w-[50px] mx-auto px-1 py-1 rounded-lg border border-purple-300 dark:border-purple-800 text-center font-extrabold text-xs bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 focus:outline-none focus:ring-1.5 focus:ring-purple-400"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </DataTableFrame>

        {/* Workspace Footer Bar */}
        <div className="shrink-0 px-3 py-2 bg-slate-50/50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-500 dark:text-slate-400 font-medium">
            แสดง {filteredItems.length} รายการ {modifiedItems.length > 0 && (
              <span className="text-purple-600 dark:text-purple-400 font-bold ml-1">
                (มีการกรอกผลตรวจนับแล้ว {modifiedItems.length} รายการ)
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handleConfirmStockCount}
              disabled={isSubmitting || modifiedItems.length === 0}
              className={`px-3 py-1.5 rounded-xl font-extrabold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs whitespace-nowrap ${
                modifiedItems.length > 0
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed shadow-none'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>บันทึกการนับสต็อก</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  )
}

'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import { A4FitPreview } from '@/features/pos/components/A4FitPreview'
import { DocumentSummaryLayout, DocumentSummaryPanel, documentSummaryRows } from '@/features/pos/components/DocumentSummaryPanel'
import { type VatMode } from '@/features/pos/components/VatModeButtons'
import { useToast } from '@/components/common/Toast'
import { clearActiveCart, loadActiveCart, saveActiveCart, type ActiveCartData } from '@/features/pos/services/cart-storage'
import {
  addQuotation,
  buildQuotationFromCart,
  fetchQuotationsFromSupabase,
  getQuotationById,
} from '@/features/quotations/services/quotation-storage'
import { loadQuotationPrintTemplate, renderQuotationA4PagesHtml } from '@/features/documents/utils/transaction-print'
import type { DocumentTemplate } from '@/lib/types/document'
import { isVatRateConfigured } from '@/features/settings/services/settings-storage'
import { calculateBillTotals } from '@/lib/calculation-service'
import { useSystemSettings } from '@/lib/contexts/SystemSettingsContext'
import { isPinCancelled } from '@/lib/db/pin-confirm'

/**
 * สรุปใบเสนอราคา (owner 2026-11-04): the quotation made in POS quotation mode is finished here, on the
 * same central panel as ชำระเงิน — discount / shipping / deposit, รวม VAT / ไม่รวม VAT and the totals —
 * then saved. No payment is taken.
 */
export default function QuotationSummaryPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { settings } = useSystemSettings()

  const [cart, setCart] = useState<ActiveCartData | null>(null)
  const [discount, setDiscount] = useState<number>(0)
  const [shippingFee, setShippingFee] = useState<number>(0)
  const [depositAmount, setDepositAmount] = useState<number>(0)
  const [vatMode, setVatMode] = useState<VatMode | null>(null)
  // A quotation saved before the buttons, with VAT on but no mode of its own, keeps the shop's old mode.
  const [legacyVatOn, setLegacyVatOn] = useState<boolean>(false)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [template, setTemplate] = useState<DocumentTemplate | null | undefined>(undefined)
  const cartLoadedRef = useRef(false)

  // Load the cart once (the router object is not a reason to load it again).
  const routerRef = useRef(router)
  useEffect(() => {
    const saved = loadActiveCart('QUOTATION')
    if (!saved || !saved.quotationMode || !saved.items?.length) {
      routerRef.current.replace('/pos?mode=quotation')
      return
    }
    setCart(saved)
    setDiscount(saved.discount || 0)
    setShippingFee(saved.shippingFee || 0)
    setDepositAmount(saved.depositAmount || 0)
    setVatMode(saved.vatMode === 'INCLUSIVE' || saved.vatMode === 'EXCLUSIVE' ? saved.vatMode : null)
    setLegacyVatOn(saved.vatEnabled === true && !saved.vatMode)
    cartLoadedRef.current = true
  }, [])

  useEffect(() => {
    let alive = true
    loadQuotationPrintTemplate()
      .then((t) => alive && setTemplate(t ?? null))
      .catch(() => alive && setTemplate(null))
    return () => {
      alive = false
    }
  }, [])

  const effectiveVatMode: VatMode | null = vatMode ?? (legacyVatOn ? settings.taxDiscount?.vatMode ?? null : null)
  const vatOn = effectiveVatMode !== null && isVatRateConfigured(settings)
  const vatInclusive = vatOn && effectiveVatMode === 'INCLUSIVE'
  const toggleVatMode = (mode: VatMode) => {
    setLegacyVatOn(false)
    setVatMode(effectiveVatMode === mode ? null : mode)
  }

  // Keep what is typed here in the saved cart, so going back to POS and forward again keeps it.
  useEffect(() => {
    if (!cartLoadedRef.current) return
    const saved = loadActiveCart('QUOTATION')
    if (saved) saveActiveCart({ ...saved, discount, shippingFee, depositAmount, vatEnabled: effectiveVatMode !== null, vatMode: effectiveVatMode })
  }, [discount, shippingFee, depositAmount, effectiveVatMode])

  const items = useMemo(() => cart?.items ?? [], [cart])
  const totals = calculateBillTotals({
    settings,
    items,
    discount,
    shippingFee,
    depositAmount,
    enableVat: vatOn,
    vatMode: vatOn ? effectiveVatMode : null,
  })

  const quotation = cart
    ? buildQuotationFromCart({
        items,
        customer: cart.customer,
        editing: cart.quotationEdit ?? null,
        documentDate: cart.documentDate,
        shippingAddress: cart.shippingAddress,
        rentalStartDate: cart.headerRentalDate,
        rentalEndDate: cart.headerReturnDate,
        subtotal: totals.subtotal,
        discount: totals.discountAmount,
        shippingFee: totals.shippingFee,
        depositAmount: totals.depositAmount,
        tax: totals.vatAmount,
        grandTotal: totals.grandTotal,
        vatEnabled: vatOn,
        vatMode: vatOn ? effectiveVatMode : null,
      })
    : null
  const previewPage = quotation && template
    ? renderQuotationA4PagesHtml(
        { ...quotation, vatRate: vatOn ? settings.taxDiscount?.vatRate ?? undefined : undefined },
        settings.business,
        template
      )[0]
    : undefined

  const editing = cart?.quotationEdit
  const backParams = new URLSearchParams({ mode: 'quotation', resume: '1' })
  if (editing) backParams.set('editQuotationId', editing.id)
  const backHref = `/pos?${backParams.toString()}`

  const handleSave = async () => {
    if (!quotation || items.length === 0) {
      showToast('ไม่สามารถบันทึกได้', 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการก่อนบันทึกใบเสนอราคา', 'ERROR')
      return
    }
    setIsSubmitting(true)
    try {
      // A revision needs the quotation list loaded (it decides "revise in place" vs "new").
      if (editing && !getQuotationById(editing.id)) await fetchQuotationsFromSupabase()
      const savedId = await addQuotation(quotation)
      const no = getQuotationById(savedId)?.quotationNo
      clearActiveCart('QUOTATION')
      showToast('บันทึกใบเสนอราคาสำเร็จ', no ? `ใบเสนอราคา ${no}` : 'บันทึกเรียบร้อยแล้ว', 'SUCCESS')
      router.push('/quotations')
    } catch (err) {
      if (!isPinCancelled(err)) showToast('บันทึกใบเสนอราคาไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <DocumentSummaryLayout
      formTabLabel="ฟอร์มใบเสนอราคา"
      previewTabLabel="ดูตัวอย่างใบเสนอราคา A4"
      preview={
        previewPage ? (
          <A4FitPreview paddingPx={1} className="h-full w-full" align="center">
            <div
              className="h-full w-full bg-white p-8 font-sans text-xs text-slate-900"
              // Pages come from renderDocumentTemplate, which already sanitizes the HTML.
              dangerouslySetInnerHTML={{ __html: previewPage }}
            />
          </A4FitPreview>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-600 dark:text-slate-400">
            {template === undefined ? 'กำลังโหลดตัวอย่างใบเสนอราคา...' : 'ยังไม่มีแบบฟอร์มใบเสนอราคาที่ใช้แสดงได้ กรุณาเพิ่มที่เมนูจัดการเอกสาร'}
          </div>
        )
      }
    >
      <DocumentSummaryPanel
        title={editing ? `แก้ไขใบเสนอราคา ${editing.quotationNo}` : 'สรุปใบเสนอราคา'}
        backHref={backHref}
        backLabel="ย้อนกลับไป POS"
        discount={discount}
        onDiscountChange={setDiscount}
        shippingFee={shippingFee}
        onShippingFeeChange={setShippingFee}
        depositAmount={depositAmount}
        onDepositAmountChange={setDepositAmount}
        disabled={isSubmitting}
        vatRate={settings.taxDiscount?.vatRate}
        vatMode={vatOn ? effectiveVatMode : null}
        onToggleVat={toggleVatMode}
        // ยอดที่ต้องชำระ = total + deposit, the same as the quotation form prints it (owner 2026-11-07).
        rows={documentSummaryRows({ totals, vatInclusive, depositAmount: totals.depositAmount, depositLabel: 'เงินมัดจำประกันความเสียหาย' })}
        totalLabel="ยอดที่ต้องชำระ"
        totalAmount={totals.totalPayableWithDeposit}
        footer={
          <button
            type="button"
            onClick={handleSave}
            disabled={isSubmitting || items.length === 0}
            className="w-full rounded-xl bg-emerald-700 px-2 py-2.5 hover:bg-emerald-800 active:scale-[0.99] text-white font-black text-xs sm:text-sm md:text-base flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all disabled:opacity-50 min-h-[44px] cursor-pointer"
          >
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
            <span className="truncate">{isSubmitting ? 'กำลังบันทึกใบเสนอราคา...' : 'บันทึกใบเสนอราคา'}</span>
          </button>
        }
      />
    </DocumentSummaryLayout>
  )
}

'use client'

import React, { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProductGrid } from '@/features/pos/components/ProductGrid'
import { CartPanel } from '@/features/pos/components/CartPanel'
import { QuantityModal } from '@/features/pos/components/QuantityModal'
import { Product, Customer, Quotation, Appointment } from '@/lib/types/rental-pos'
import { useToast } from '@/components/common/Toast'
import { useCreateCustomer } from '@/features/customers/hooks/useCreateCustomer'
import {
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { ShoppingBag, Package, FileText, ArrowLeft } from 'lucide-react'
import { loadProducts, validateProductMode } from '@/features/products/services/product-storage'
import { loadCustomers, isIdCardUploadError } from '@/features/customers/services/customer-storage'
import { CartItem, cartLineListPrice, isSaleCartItem, loadActiveCart, saveActiveCart } from '@/features/pos/services/cart-storage'
import { fetchAppointmentsFromSupabase } from '@/features/appointments/services/appointment-storage'
import { getLocalDateString } from '@/components/common/CustomDatePicker'
import {
  fetchQuotationsFromSupabase,
  getQuotationById,
  mapQuotationToPos,
  quotationStatusView,
} from '@/features/quotations/services/quotation-storage'
import { loadBillById } from '@/features/bills/services/bill-storage'

function POSContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isQuotationMode = searchParams.get('mode') === 'quotation'
  const quotationId = searchParams.get('quotationId')
  const draftBillId = searchParams.get('draftBillId')
  const appointmentId = searchParams.get('appointmentId')
  // Back from the checkout page: put the cart saved before checkout back on screen.
  const resumeCheckout = searchParams.get('resume') === '1'
  // Quotation mode only: revise an existing quotation in place, or start a new one from a copy.
  const editQuotationId = isQuotationMode ? searchParams.get('editQuotationId') : null
  const copyQuotationId = isQuotationMode ? searchParams.get('copyQuotationId') : null
  const { showToast } = useToast()
  const createCustomer = useCreateCustomer()

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  // Cart line being edited through the quantity screen (null = adding a new line).
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null)
  const [selectedProductMode, setSelectedProductMode] = useState<'RENT' | 'SALE'>('RENT')
  const [customersList, setCustomersList] = useState<Customer[]>([])
  const [productsList, setProductsList] = useState<Product[]>([])
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [mobileTab, setMobileTab] = useState<'PRODUCTS' | 'CART'>('PRODUCTS')
  const [loadedQuotationNo, setLoadedQuotationNo] = useState<string | undefined>(undefined)
  const [quotationValues, setQuotationValues] = useState<{
    discount?: number
    shippingFee?: number
    depositAmount?: number
    vatEnabled?: boolean
    /** รวม / ไม่รวม VAT of a draft bill or of the cart being resumed from the payment page. */
    vatMode?: 'INCLUSIVE' | 'EXCLUSIVE' | null
    shippingAddress?: string
    contactPhone?: string
    rentalStartDate?: string
    rentalEndDate?: string
    documentDate?: string
  }>({})
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null)

  // Edit / copy: load the quotation (also after a page reload, when the list cache is empty).
  useEffect(() => {
    const sourceId = editQuotationId || copyQuotationId
    if (!sourceId) return
    let alive = true
    void (async () => {
      try {
        const quote = getQuotationById(sourceId) || (await fetchQuotationsFromSupabase()).find((q) => q.id === sourceId)
        if (!alive) return
        if (!quote) {
          showToast('ไม่พบใบเสนอราคา', `ไม่พบใบเสนอราคารหัส ${sourceId}`, 'ERROR')
          return
        }
        if (editQuotationId && !quotationStatusView(quote.status).editable) {
          showToast('แก้ไขไม่ได้', `ใบเสนอราคา ${quote.quotationNo} เปิดบิลหรือยกเลิกไปแล้ว — ใช้ "คัดลอก" เพื่อทำใบใหม่`, 'ERROR')
          router.push('/quotations')
          return
        }
        // Back from สรุปใบเสนอราคา: the resumed cart already holds the changes; only remember which quotation this is.
        if (resumeCheckout && editQuotationId) {
          setEditingQuotation(quote)
          return
        }
        const { customer, cartItems: loadedItems, values } = mapQuotationToPos(quote, loadProducts(), loadCustomers())
        setSelectedCustomer(customer.id ? customer : null)
        setCartItems(loadedItems)
        // A copy is a new document: it is dated today; an edit keeps its own document date.
        setQuotationValues(editQuotationId ? values : { ...values, documentDate: undefined })
        setEditingQuotation(editQuotationId ? quote : null)
        showToast(
          editQuotationId ? 'แก้ไขใบเสนอราคา' : 'คัดลอกใบเสนอราคา',
          editQuotationId ? `กำลังแก้ไข ${quote.quotationNo} (บันทึกแล้วใช้เลขเดิม)` : `ทำใบใหม่จาก ${quote.quotationNo}`,
          'INFO'
        )
      } catch (error) {
        if (alive) showToast('โหลดใบเสนอราคาไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
      }
    })()
    return () => {
      alive = false
    }
  }, [editQuotationId, copyQuotationId, resumeCheckout, router, showToast])

  useEffect(() => {
    const prods = loadProducts()
    const custs = loadCustomers()
    setProductsList(prods)
    setCustomersList(custs)

    if (resumeCheckout) {
      const saved = loadActiveCart()
      if (saved && saved.items?.length > 0) {
        setSelectedCustomer(saved.customer)
        setCartItems(saved.items)
        setQuotationValues({
          discount: saved.discount,
          shippingFee: saved.shippingFee,
          depositAmount: saved.depositAmount,
          vatEnabled: saved.vatEnabled === true,
          vatMode: saved.vatMode ?? null,
          shippingAddress: saved.shippingAddress,
          contactPhone: saved.contactPhone,
          rentalStartDate: saved.headerRentalDate,
          rentalEndDate: saved.headerReturnDate,
          documentDate: saved.documentDate,
        })
        if (saved.quotationNo) setLoadedQuotationNo(saved.quotationNo)
        return
      }
    }

    if (appointmentId) {
      void (async () => {
        try {
          const appointment = (await fetchAppointmentsFromSupabase()).find((item) => item.id === appointmentId)
          if (!appointment) {
            showToast('ไม่พบนัดหมาย', `ไม่พบนัดหมายรหัส ${appointmentId}`, 'ERROR')
            return
          }

          let customer = appointment.customerId
            ? custs.find((item) => item.id === appointment.customerId)
            : undefined
          if (!customer && !appointment.customerId && appointment.customerName && appointment.phone) {
            const exactMatches = custs.filter(
              (item) => item.customerName === appointment.customerName && item.phone === appointment.phone
            )
            if (exactMatches.length === 1) customer = exactMatches[0]
          }
          if (!customer) {
            showToast('ไม่พบข้อมูลลูกค้า', 'ไม่สามารถจับคู่นัดหมายกับข้อมูลลูกค้าได้ กรุณาตรวจสอบลูกค้าในนัดหมายก่อนสร้างบิล', 'ERROR')
            return
          }

          const appointmentItems = appointment.items ?? []
          const missingProducts = appointmentItems.filter((item) => {
            const product = prods.find((candidate) => candidate.id === item.id)
            return !product || product.status !== 'ACTIVE' || !Number.isFinite(item.quantity) || item.quantity <= 0
          })
          if (missingProducts.length > 0) {
            showToast(
              'โหลดรายการสินค้าไม่ครบ',
              `ไม่พบสินค้า เปิดใช้งานไม่ได้ หรือจำนวนไม่ถูกต้อง: ${missingProducts.map((item) => item.name).join(', ')}`,
              'ERROR'
            )
            return
          }

          const productsById = new Map(prods.map((product) => [product.id, product]))
          const convertedItems: CartItem[] = appointmentItems.map((item, index) => {
            const product = productsById.get(item.id)
            if (!product) throw new Error(`ไม่พบสินค้า ${item.name} ในข้อมูลสินค้า`)
            const isSale = product.rentalType === 'SALE'
            const isDaily = !isSale && (product.calculationType === 'PER_DAY' || product.rentalType === 'DAILY')
            const rentalType: CartItem['rentalType'] = isSale ? 'SALE' : isDaily ? 'DAILY' : 'NORMAL'
            const itemType: CartItem['itemType'] = isSale ? 'SALE' : 'RENT'
            const unitPrice = cartLineListPrice({ product, rentalType, itemType })
            if (unitPrice === null || !Number.isFinite(unitPrice)) {
              throw new Error(`ไม่พบราคาสำหรับสินค้า ${product.name} กรุณาตรวจสอบข้อมูลสินค้าก่อนสร้างบิล`)
            }
            return {
              id: `appointment-${appointment.id}-${index}`,
              product,
              productId: product.id,
              productName: product.name,
              itemType,
              requiresReturn: !isSale && product.requiresReturn !== false,
              unitName: item.unit || product.unit || product.unit_name || 'ชิ้น',
              calculationType: product.calculationType,
              calculationLabel: product.calculationLabel,
              rentalType,
              quantity: item.quantity,
              unitPrice,
              listUnitPrice: unitPrice,
              usageCount: 1,
              billableDays: 1,
              lineTotal: item.quantity * unitPrice,
            }
          })
          setSelectedCustomer(customer)
          setCartItems(convertedItems)
          setQuotationValues({ shippingAddress: appointment.location || '' })
          if (convertedItems.length === 0) {
            showToast('โหลดข้อมูลนัดหมายแล้ว', 'นัดหมายไม่มีรายการสินค้า กรุณาเพิ่มสินค้าใน POS', 'INFO')
          } else {
            showToast('โหลดข้อมูลนัดหมายสำเร็จ', `โหลดลูกค้าและสินค้า ${convertedItems.length} รายการจาก ${appointment.title}`, 'SUCCESS')
          }
        } catch (error) {
          showToast('โหลดข้อมูลนัดหมายไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาลองใหม่อีกครั้ง', 'ERROR')
        }
      })()
      return
    }

    if (quotationId) {
      let active = true
      void (async () => {
        try {
          // Deep links must work after refresh, when the in-memory quotation list is empty.
          const quote = getQuotationById(quotationId)
            || (await fetchQuotationsFromSupabase()).find((candidate) => candidate.id === quotationId)
          if (!active) return
          if (!quote) {
            showToast('ไม่พบใบเสนอราคา', `ไม่พบใบเสนอราคาที่มีรหัส ${quotationId}`, 'ERROR')
            return
          }
          if (quote.status === 'CONVERTED' || quote.status === 'CANCELLED' || quote.status === 'REJECTED') {
            showToast('ไม่สามารถเปิดใบเสนอราคาได้', `ใบเสนอราคา ${quote.quotationNo} มีสถานะ ${quote.status} ไม่สามารถเปิดบิลได้`, 'ERROR')
            router.push('/quotations')
            return
          }
          const { customer, cartItems: convertedItems, values, quotationNo } = mapQuotationToPos(quote, prods, custs)
          setSelectedCustomer(customer)
          setCartItems(convertedItems)
          setQuotationValues(values)
          setLoadedQuotationNo(quotationNo || quote.quotationNo)
          showToast('โหลดใบเสนอราคาสำเร็จ', `โหลดข้อมูลจากใบเสนอราคา ${quote.quotationNo} เรียบร้อยแล้ว`, 'SUCCESS')
        } catch (error) {
          if (active) showToast('โหลดใบเสนอราคาไม่สำเร็จ', error instanceof Error ? error.message : 'กรุณาตรวจสอบข้อมูลใบเสนอราคา', 'ERROR')
        }
      })()
      return () => { active = false }
    } else if (draftBillId) {
      const draftBill = loadBillById(draftBillId)
      if (draftBill && draftBill.rentalStatus === 'DRAFT') {
        const productsById = new Map(prods.map((product) => [product.id, product]))
        const invalidItemNames: string[] = []
        const draftProducts: Product[] = []
        draftBill.items.forEach((item) => {
          const product = productsById.get(item.productId)
          if (!product || product.status !== 'ACTIVE' || !Number.isFinite(item.quantity) || item.quantity <= 0) {
            invalidItemNames.push(item.productName)
            return
          }
          try {
            validateProductMode(product, item.rentalType === 'SALE' ? 'SALE' : 'RENT')
            draftProducts.push(product)
          } catch (error) {
            invalidItemNames.push(`${item.productName} (${error instanceof Error ? error.message : 'ประเภทสินค้าไม่ถูกต้อง'})`)
          }
        })
        if (invalidItemNames.length > 0) {
          showToast(
            'โหลดแบบร่างไม่ได้',
            `สินค้าไม่พร้อมทำรายการหรือจำนวนไม่ถูกต้อง: ${invalidItemNames.join(', ')}`,
            'ERROR'
          )
          return
        }

        const cust = custs.find((c) => c.id === draftBill.customerId) || {
          id: draftBill.customerId || 'draft-customer',
          customerName: draftBill.customerName,
          phone: draftBill.customerPhone,
          address: draftBill.customerAddress,
        }
        setSelectedCustomer(cust)

        const convertedItems: CartItem[] = draftBill.items.map((item, idx) => {
          const matchedProd = draftProducts[idx]
          const isSale = item.rentalType === 'SALE'
          const rentalType: CartItem['rentalType'] =
            item.rentalType === 'SALE' ? 'SALE' : item.rentalType === 'DAILY' ? 'DAILY' : 'NORMAL'
          const baseProduct: Product = {
            ...matchedProd,
            normalPrice: item.dailyRate,
            dailyPrice: item.dailyRate,
            rentPrice: isSale ? matchedProd.rentPrice : item.dailyRate,
            salePrice: isSale ? item.dailyRate : matchedProd.salePrice,
          }

          return {
            id: `cart-${Date.now()}-${idx}`,
            product: baseProduct,
            productId: item.productId,
            productName: item.productName,
            itemType: isSale ? 'SALE' : 'RENT',
            unitName: item.unit || matchedProd.unit || 'ชิ้น',
            calculationType: matchedProd.calculationType,
            calculationLabel: matchedProd.calculationLabel,
            rentalType,
            quantity: item.quantity,
            unitPrice: item.dailyRate,
            // baseProduct carries the draft's price, so keep the product's own price to detect the override
            listUnitPrice: cartLineListPrice({
              product: matchedProd,
              rentalType,
              itemType: isSale ? 'SALE' : 'RENT',
            }),
            usageCount: item.usageCount || 1,
            billableDays: item.usageCount || 1,
            dailyStartDate: item.rentalStartDate,
            dailyEndDate: item.scheduledReturnDate,
            lineTotal: Number(item.lineTotal !== undefined ? item.lineTotal : ((item.quantity || 0) * (item.dailyRate || 0))),
          }
        })

        setCartItems(convertedItems)
        setQuotationValues({
          discount: draftBill.discountAmount || 0,
          shippingFee: draftBill.shippingFee || 0,
          depositAmount: draftBill.heldDepositAmount || draftBill.paidDepositAmount || 0,
          vatEnabled: Boolean(draftBill.vatMode) || (draftBill.taxAmount ?? 0) > 0,
          vatMode: draftBill.vatMode ?? null,
          shippingAddress: draftBill.siteName || draftBill.customerAddress || '',
          rentalStartDate: draftBill.rentalStartDate,
          rentalEndDate: draftBill.scheduledReturnDate,
        })
        if (draftBill.quotationNo) {
          setLoadedQuotationNo(draftBill.quotationNo)
        }

        showToast('โหลดแบบร่างสำเร็จ', `โหลดข้อมูลจากแบบร่าง ${draftBill.billNo} เรียบร้อยแล้ว`, 'SUCCESS')
      } else if (draftBill) {
        showToast('บิลไม่ใช่แบบร่าง', `บิล ${draftBill.billNo} ไม่ได้อยู่ในสถานะแบบร่าง (สถานะปัจจุบัน: ${draftBill.rentalStatus})`, 'ERROR')
      } else {
        showToast('ไม่พบแบบร่าง', `ไม่พบแบบร่างที่มีรหัส ${draftBillId}`, 'ERROR')
      }
    }
  }, [resumeCheckout, appointmentId, quotationId, draftBillId, router, showToast])

  const handleSelectProduct = (product: Product, mode: 'RENT' | 'SALE' = 'RENT') => {
    setSelectedProduct(product)
    setSelectedProductMode(mode)
  }

  const handleAddToCart = (data: {
    product: Product
    rentalType: 'NORMAL' | 'DAILY' | 'SALE'
    quantity: number
    unitPrice: number
    usageCount: number
    dailyStartDate?: Date
    dailyEndDate?: Date
    billableDays?: number
  }, replaceItem?: CartItem) => {
    if (data.product.status !== 'ACTIVE') {
      showToast('สินค้าไม่พร้อมทำรายการ', `สินค้า ${data.product.name} ไม่ได้เปิดใช้งานแล้ว`, 'ERROR')
      return
    }
    try {
      validateProductMode(data.product, data.rentalType === 'SALE' ? 'SALE' : 'RENT')
    } catch (error) {
      showToast('ประเภทสินค้าไม่ถูกต้อง', error instanceof Error ? error.message : 'ตรวจสอบประเภทสินค้าก่อนเพิ่มลงตะกร้า', 'ERROR')
      return
    }

    // STOCK VALIDATION — a quotation holds no stock, so it may quote more than is free (warning only).
    const stockValue = Number(data.product.availableQuantity ?? data.product.available_qty ?? 0)
    if (!Number.isFinite(stockValue) || stockValue < 0) {
      showToast('ตรวจสอบสต็อกไม่ได้', `ไม่พบยอดสต็อกพร้อมใช้ที่ถูกต้องสำหรับ ${data.product.name}`, 'ERROR')
      return
    }
    const available = stockValue
    // Editing a line: its own old quantity does not count against the stock.
    const currentCartQty = cartItems
      .filter((item) => item.productId === data.product.id && item.id !== replaceItem?.id)
      .reduce((sum, item) => sum + item.quantity, 0)

    if (currentCartQty + data.quantity > available && isQuotationMode) {
      showToast(
        'สต็อกพร้อมใช้ไม่พอ (เสนอราคาได้)',
        `ในใบนี้มี ${currentCartQty + data.quantity} แต่สต็อกพร้อมใช้มี ${available} — ต้องมีของพอตอนเปิดบิล`,
        'INFO'
      )
    } else if (currentCartQty + data.quantity > available) {
      showToast(
        'สินค้าไม่เพียงพอ',
        `มีสินค้าในตะกร้าแล้ว ${currentCartQty} และต้องการเพิ่มอีก ${data.quantity} แต่สต็อกพร้อมใช้มีเพียง ${available}`,
        'ERROR'
      )
      return
    }

    const isSale = data.rentalType === 'SALE'
    const days = data.billableDays || 1

    const multiplier = isSale ? 1 : data.rentalType === 'DAILY' ? days : Math.max(1, data.usageCount)
    const lineTotal = data.quantity * data.unitPrice * multiplier

    const newItem: CartItem = {
      id: `cart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      product: data.product,
      productId: data.product.id,
      productName: data.product.name,
      itemType: isSale ? 'SALE' : 'RENT',
      unitName: data.product.unit || data.product.unit_name,
      calculationType: data.product.calculationType as any,
      calculationLabel: data.product.calculationLabel,
      rentalType: data.rentalType,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      usageCount: isSale ? 1 : data.usageCount,
      billableDays: isSale ? 1 : days,
      dailyStartDate: !isSale && data.dailyStartDate ? getLocalDateString(data.dailyStartDate) : undefined,
      dailyEndDate: !isSale && data.dailyEndDate ? getLocalDateString(data.dailyEndDate) : undefined,
      lineTotal,
      requiresReturn: !isSale, // Adding this per MASTER rule C
    }

    if (replaceItem) {
      // Same line, new values; keep the product's own price so a price change is still detected.
      const updated: CartItem = { ...newItem, id: replaceItem.id, listUnitPrice: replaceItem.listUnitPrice }
      setCartItems((prev) => prev.map((item) => (item.id === replaceItem.id ? updated : item)))
      setEditingCartItem(null)
      showToast('แก้ไขรายการแล้ว', `${data.product.name} × ${data.quantity}`, 'SUCCESS')
      return
    }
    setCartItems((prev) => [...prev, newItem])
    setSelectedProduct(null)
  }

  /** false = not saved, so the customer form stays open with what was typed. */
  const handleAddCustomer = async (newCustomer: Customer): Promise<boolean> => {
    try {
      // The server assigns the customer id; select the saved record, not the form copy.
      const saved = await createCustomer(newCustomer)
      setCustomersList(loadCustomers())
      setSelectedCustomer(saved)
      showToast('เพิ่มลูกค้าสำเร็จ', `เพิ่มลูกค้า ${newCustomer.customerName} เรียบร้อยแล้ว`, 'SUCCESS')
      return true
    } catch (err: any) {
      if (isIdCardUploadError(err)) {
        // The customer is saved (only the photo failed): select it instead of asking to re-enter.
        setCustomersList(loadCustomers())
        setSelectedCustomer(err.saved)
        showToast('บันทึกข้อมูลลูกค้าแล้ว', err.message, 'INFO')
        return true
      }
      if (err?.tag === 'DUPLICATE_CUSTOMER') return false
      showToast('ไม่สามารถเพิ่มลูกค้าได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
      return false
    }
  }

  const handleCheckout = () => {
    if (!isQuotationMode) {
      router.push('/pos/checkout')
      return
    }
    // Quotation mode: the cart (saved by CartPanel) goes to สรุปใบเสนอราคา, the same central panel as ชำระเงิน.
    // Only an edit revises the quotation in place; a new one or a copy gets a fresh id when saved.
    const cart = loadActiveCart()
    if (cart) {
      saveActiveCart({
        ...cart,
        quotationMode: true,
        quotationEdit: editingQuotation
          ? { id: editingQuotation.id, quotationNo: editingQuotation.quotationNo, status: editingQuotation.status, remark: editingQuotation.remark }
          : undefined,
      })
    }
    router.push('/pos/quotation')
  }

  const handleExitQuotationMode = () => {
    router.push('/quotations')
  }

  const cartTotalItems = cartItems.reduce((sum, i) => sum + (i.quantity || 0), 0)

  return (
    <div className="h-full p-2 bg-slate-100 dark:bg-[#07111f] flex flex-col gap-2 overflow-hidden min-h-0">
      {/* Quotation Mode Top Notification Banner */}
      {isQuotationMode && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 px-3 py-1.5 rounded-xl flex items-center justify-between gap-2 text-xs shrink-0 shadow-xs">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <span className="font-extrabold text-amber-900 dark:text-amber-200 truncate">
              📋 {editingQuotation ? `แก้ไขใบเสนอราคา ${editingQuotation.quotationNo}` : 'โหมดสร้างใบเสนอราคา'} (ไม่ตัดสต็อก / ไม่จองสินค้า)
            </span>
          </div>
          <button
            onClick={handleExitQuotationMode}
            className="px-2.5 py-1 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-lg border border-slate-300 dark:border-slate-600 flex items-center gap-1 text-[11px] shrink-0 transition-colors shadow-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>กลับหน้าใบเสนอราคา</span>
          </button>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-2 overflow-hidden">
        {/* Small Mobile View Toggle (< 768px) */}
        <div className={`md:hidden ${TAB_CONTAINER_CLASSES} w-full`}>
          <button
            onClick={() => setMobileTab('PRODUCTS')}
            className={`flex-1 ${TAB_BUTTON_BASE_CLASSES} ${
              mobileTab === 'PRODUCTS'
                ? TAB_BUTTON_ACTIVE_CLASSES
                : TAB_BUTTON_INACTIVE_CLASSES
            }`}
          >
            <Package className="w-4 h-4" />
            <span>เลือกสินค้า</span>
          </button>
          <button
            onClick={() => setMobileTab('CART')}
            className={`flex-1 ${TAB_BUTTON_BASE_CLASSES} ${
              mobileTab === 'CART'
                ? TAB_BUTTON_ACTIVE_CLASSES
                : TAB_BUTTON_INACTIVE_CLASSES
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>
              {isQuotationMode ? 'รายการใบเสนอราคา' : 'ตะกร้าสินค้า'} ({cartTotalItems})
            </span>
          </button>
        </div>

        {/* Left Column - Product Grid */}
        <div
          className={`flex-1 min-w-0 h-full min-h-0 ${
            mobileTab === 'PRODUCTS' ? 'block' : 'hidden md:block'
          }`}
        >
          <ProductGrid products={productsList} onSelectProduct={handleSelectProduct} allowOutOfStock={isQuotationMode} />
        </div>

        {/* Right Column - Cart Panel */}
        <div
          className={`w-full md:w-[280px] xl:w-[320px] 2xl:w-[360px] h-full shrink-0 ${
            mobileTab === 'CART' ? 'block' : 'hidden md:block'
          }`}
        >
          <CartPanel
            customers={customersList}
            items={cartItems}
            setItems={setCartItems}
            customer={selectedCustomer}
            setCustomer={setSelectedCustomer}
            onAddCustomer={handleAddCustomer}
            onCheckout={handleCheckout}
            isQuotationMode={isQuotationMode}
            quotationId={quotationId || undefined}
            quotationNo={loadedQuotationNo ?? editingQuotation?.quotationNo}
            draftBillId={draftBillId || undefined}
            onEditItem={setEditingCartItem}
            initialDiscount={quotationValues.discount}
            initialShippingFee={quotationValues.shippingFee}
            initialDepositAmount={quotationValues.depositAmount}

            initialShippingAddress={quotationValues.shippingAddress}
            initialRentalStartDate={quotationValues.rentalStartDate}
            initialRentalEndDate={quotationValues.rentalEndDate}
            initialVatEnabled={quotationValues.vatEnabled}
            initialVatMode={quotationValues.vatMode}
            initialDocumentDate={quotationValues.documentDate}
            initialCustomerAttention={searchParams.get('customerRequired') === '1'}
            initialContactPhone={quotationValues.contactPhone}
          />
        </div>
      </div>

      {/* Quantity Modal */}
      {selectedProduct && (
        <QuantityModal
          product={selectedProduct}
          mode={selectedProductMode}
          allowOverStock={isQuotationMode}
          onAdd={handleAddToCart}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* Quantity Modal — edit a cart line */}
      {editingCartItem && (
        <QuantityModal
          key={editingCartItem.id}
          product={editingCartItem.product}
          mode={isSaleCartItem(editingCartItem) ? 'SALE' : 'RENT'}
          allowOverStock={isQuotationMode}
          initial={{
            quantity: editingCartItem.quantity,
            unitPrice: editingCartItem.unitPrice,
            usageCount: editingCartItem.usageCount,
            dailyStartDate: editingCartItem.dailyStartDate,
            dailyEndDate: editingCartItem.dailyEndDate,
          }}
          submitLabel="บันทึกการแก้ไข"
          onAdd={(data) => handleAddToCart(data, editingCartItem)}
          onClose={() => setEditingCartItem(null)}
        />
      )}
    </div>
  )
}

export default function POSPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-slate-600 dark:text-slate-400 font-bold text-xs">
          กำลังโหลดหน้า POS...
        </div>
      }
    >
      <POSContent />
    </Suspense>
  )
}

'use client'

import { useActionPermission, NO_ACTION_PERMISSION_TITLE } from '@/features/auth/hooks/useActionPermission'
import React, { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ClipboardList,
  Sliders,
  MapPin,
  Edit,
  History,
  Trash2,
  PackagePlus,
  Settings,
  Layers,
  X,
  Search,
  FileSpreadsheet,
  Package,
  Handshake,
  Wrench,
  AlertTriangle,
  Sigma,
  CalendarDays,
  RotateCcw,
  Download,
  Clock,
  FileText,
  PlayCircle,
  CheckCircle2,
  Phone,
} from 'lucide-react'
import { DataTableFrame, DATA_TABLE_CLASSES } from '@/components/common/DataTableFrame'
import { loadBills, fetchBillsFromSupabase, type FullBill } from '@/features/bills/services/bill-storage'
import { formatThaiDate } from '@/features/reports/services/report-data-common'
import { ReportDonutChart } from '@/features/reports/components/ReportCharts'
import * as XLSX from 'xlsx'
import { CustomSelect } from '@/components/common/CustomSelect'
import {
  ActionButton,
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { Product, Unit, RentalType } from '@/lib/types/rental-pos'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { useToast } from '@/components/common/Toast'
import { ProductStockCountView } from '@/features/products/components/ProductStockCountView'
import { DamagedRestoreModal } from '@/features/products/components/DamagedRestoreModal'
import { DamagedTransformModal } from '@/features/products/components/DamagedTransformModal'
import { ProductListView } from '@/features/products/components/ProductListView'
import { ProductCreateView, ProductCreateDraftRow, createInitialDraftRows } from '@/features/products/components/ProductCreateView'
import { ProductSettingsView } from '@/features/products/components/ProductSettingsView'
import { logger } from '@/lib/utils/logger'
import {
  loadProducts as loadStorageProducts,
  addProductsAsync,
  updateProductAsync,
  deleteProductAsync,
  syncProductsFromSupabase,
} from '@/features/products/services/product-storage'
import {
  loadCategories,
  addCategoryAsync,
  loadCompositeRules,
  addCompositeRuleAsync,
  ProductCategoryItem,
  CategoryCompositeRule,
  loadCategoryRules,
  ProductCategoryRule,
  CalculationType,
  CALCULATION_OPTIONS,
  CALCULATION_LONG_LABELS,
} from '@/lib/category-rules-storage'
import { loadUnits, addUnitAsync } from '@/lib/unit-storage'
import { NumericInput } from '@/components/common/NumericInput'
import { CustomDatePicker, parseLocalDate, getLocalDateString } from '@/components/common/CustomDatePicker'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { getDefaultReorderPoint } from '@/features/settings/services/settings-storage'
import { isLowStock } from '@/features/products/utils/low-stock'

const RENTAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'แบบร่าง',
  CONFIRMED: 'ยืนยันแล้ว',
  RENTING: 'กำลังเช่า',
  EXTENDED: 'ต่อสัญญา',
  PARTIAL_RETURNED: 'คืนบางส่วน',
  RETURNED: 'คืนครบ',
  CLOSED: 'ปิดบิลแล้ว',
  CANCELLED: 'ยกเลิก',
  VOID: 'ยกเลิก',
}
// KPI card tones: same classes as the Products page summary cards.
const KPI_TONE = {
  slate: { box: 'bg-slate-100/70 dark:bg-slate-800/70 border-slate-200 dark:border-slate-800', label: 'text-slate-500', value: 'text-slate-800 dark:text-slate-100' },
  emerald: { box: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/40', label: 'text-emerald-700 dark:text-emerald-300', value: 'text-emerald-600 dark:text-emerald-400' },
  blue: { box: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-900/40', label: 'text-blue-700 dark:text-blue-300', value: 'text-blue-600 dark:text-blue-400' },
  amber: { box: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-900/40', label: 'text-amber-700 dark:text-amber-300', value: 'text-amber-600 dark:text-amber-400' },
  red: { box: 'bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-900/40', label: 'text-red-700 dark:text-red-300', value: 'text-red-600 dark:text-red-400' },
  purple: { box: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200/60 dark:border-purple-900/40', label: 'text-purple-700 dark:text-purple-300', value: 'text-purple-600 dark:text-purple-400' },
} as const
const KPI_CARD = 'p-2.5 sm:p-3 rounded-2xl border shadow-xs'
const KPI_LABEL = 'text-[11px] font-semibold block'
const KPI_VALUE = 'text-lg font-black mt-0.5 block leading-tight'

// Bills whose items are still out with the customer.
// EXTENDED = parent bill whose goods moved to a continuation bill: it holds nothing itself.
const HOLDING_RENTAL_STATUSES: string[] = ['RENTING', 'PARTIAL_RETURNED']

// Status pill with a dot (badge colours as in the product list status column).
const PILL_TONE = {
  emerald: { box: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  amber: { box: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  red: { box: 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300', dot: 'bg-red-500' },
  slate: { box: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', dot: 'bg-slate-400' },
} as const

function StatusPill({ tone, label }: { tone: keyof typeof PILL_TONE; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-bold text-[10px] ${PILL_TONE[tone].box}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${PILL_TONE[tone].dot}`} />
      {label}
    </span>
  )
}

function ProductsContent() {
  const searchParams = useSearchParams()
  const { showToast } = useToast()
  const { user } = useAuth()
  // UI hint only; the server checks menu -> OWNER grant -> PIN on every call.
  const canAction = useActionPermission()
  const [products, setProducts] = useState<Product[]>([])
  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).map((c) => ({ id: c, label: c }))
  const [isLoading, setIsLoading] = useState(false)

  // Product Delete State
  const [productToDelete, setProductToDelete] = useState<Product | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const loadProducts = React.useCallback(async () => {
    setProducts(loadStorageProducts())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    loadProducts()
    // Stock changes from other screens (bills, returns) reload the shared product cache.
    const onChange = () => setProducts(loadStorageProducts())
    window.addEventListener('products_updated', onChange)
    void syncProductsFromSupabase().catch(() => undefined)
    return () => window.removeEventListener('products_updated', onChange)
  }, [loadProducts])

  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [activeViewTab, setActiveViewTab] = useState<'ALL' | 'DAMAGED'>('ALL')

  // Main 4-Tab Workspace State
  const initialTab = searchParams.get('tab') === 'count' ? 'COUNT' : 'LIST'
  const [activeMainTab, setActiveMainTab] = useState<'LIST' | 'ADD' | 'SETTINGS' | 'COUNT'>(initialTab)

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'count') {
      setActiveMainTab('COUNT')
    }
  }, [searchParams])

  // Master Units, Categories & Composite Rules
  const [masterUnits, setMasterUnits] = useState<Unit[]>([])
  const [productCategories, setProductCategories] = useState<ProductCategoryItem[]>([])
  const [compositeRules, setCompositeRules] = useState<CategoryCompositeRule[]>([])
  const [categoryRules, setCategoryRules] = useState<ProductCategoryRule[]>([])

  useEffect(() => {
    setMasterUnits(loadUnits())
    setProductCategories(loadCategories())
    setCompositeRules(loadCompositeRules())
    setCategoryRules(loadCategoryRules())
  }, [])

  // Starting reorder point for products added here; low stock itself is per product (reorder_point).
  const [defaultMinStock, setDefaultMinStock] = useState<number>(() => getDefaultReorderPoint())

  useEffect(() => {
    const handleSettingsChanged = () => setDefaultMinStock(getDefaultReorderPoint())
    window.addEventListener('app_settings_changed', handleSettingsChanged)
    return () => window.removeEventListener('app_settings_changed', handleSettingsChanged)
  }, [])

  // Persistent Draft State for ADD Tab (Survives tab switches!)
  const [createDraftRows, setCreateDraftRows] = useState<ProductCreateDraftRow[]>([])
  const [isCreatingSubmitting, setIsCreatingSubmitting] = useState(false)

  // Initialize draft rows (10 rows) if empty once category rules & units load
  useEffect(() => {
    if (createDraftRows.length === 0 && (categoryRules.length > 0 || masterUnits.length > 0)) {
      setCreateDraftRows(createInitialDraftRows('', ''))
    }
  }, [categoryRules, masterUnits, createDraftRows.length])

  // Clear draft helper
  const handleClearDraft = () => {
    setCreateDraftRows(createInitialDraftRows('', ''))
    showToast('ล้างแบบร่างเรียบร้อย', 'รีเซ็ตข้อมูลในแบบฟอร์มเพิ่มสินค้าแล้ว', 'INFO')
  }

  // Submit handler for ADD Tab
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isCreatingSubmitting) return

    const validRows = createDraftRows.filter((r) => r.name.trim() !== '')
    if (validRows.length === 0) {
      showToast('กรุณาระบุข้อมูล', 'กรุณาระบุชื่อสินค้าอย่างน้อย 1 รายการ', 'ERROR')
      return
    }

    try {
      setIsCreatingSubmitting(true)
      const now = Date.now()

      const createdProducts: Product[] = validRows.map((r, idx) => {
        const matchedCat = productCategories.find((c) => c.id === r.categoryId)
        const categoryName = matchedCat?.name || r.categoryId || 'ทั่วไป'
        const calcType = (r.calculationType || 'PER_ROUND') as CalculationType
        const calcLabel = CALCULATION_LONG_LABELS[calcType] || 'ต่อรอบ'

        // Determine Unit: lookup from masterUnits by r.unitId or fallback
        const matchedUnit = masterUnits.find((u) => u.id === r.unitId) || masterUnits[0]
        const finalUnitName = matchedUnit?.name || 'ชิ้น'
        const finalUnitId = matchedUnit?.id

        // Single Price field mapping based on calculationType
        const priceNum =
          r.price !== null && r.price !== undefined && (r.price as any) !== ''
            ? Number(r.price)
            : null

        let rentPriceNum: number | null = null
        let salePriceNum: number | null = null
        let normalPriceNum = 0
        let dailyPriceNum = 0
        let rentalTypeVal: RentalType = 'NORMAL'
        let isChargeableVal = true
        let requiresReturnVal = true

        if (calcType === 'NO_CHARGE') {
          rentPriceNum = 0
          salePriceNum = null
          normalPriceNum = 0
          dailyPriceNum = 0
          rentalTypeVal = 'NORMAL'
          isChargeableVal = false
          requiresReturnVal = true
        } else if (calcType === 'SALE') {
          salePriceNum = priceNum
          rentalTypeVal = 'SALE'
          isChargeableVal = true
          requiresReturnVal = false
        } else if (calcType === 'PER_DAY') {
          rentPriceNum = priceNum
          dailyPriceNum = priceNum != null ? priceNum : 0
          normalPriceNum = priceNum != null ? priceNum : 0
          rentalTypeVal = 'DAILY'
          isChargeableVal = true
          requiresReturnVal = true
        } else {
          // PER_ROUND or default
          rentPriceNum = priceNum
          normalPriceNum = priceNum != null ? priceNum : 0
          dailyPriceNum = priceNum != null ? priceNum : 0
          rentalTypeVal = 'NORMAL'
          isChargeableVal = true
          requiresReturnVal = true
        }

        const totalQty = Number(r.quantityAdded) || 0
        const costPriceNum = r.costPrice != null ? Number(r.costPrice) : 0
        const damageFeeNum = r.damageFee != null ? Number(r.damageFee) : 0
        const lossFeeNum = r.lossFee != null ? Number(r.lossFee) : 0
        const minStockNum = defaultMinStock

        const dateStr = r.addedDate
          ? r.addedDate.toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)

        return {
          id: `prod-${now}-${idx}`,
          code: `P${String(now).slice(-6)}${validRows.length > 1 ? `-${idx + 1}` : ''}`,
          name: r.name.trim(),
          category: categoryName,
          categoryId: matchedCat?.id,
          categoryRuleId: matchedCat?.id,
          calculationType: calcType,
          calculationLabel: calcLabel,
          unit: finalUnitName,
          unitId: finalUnitId,
          rentPrice: rentPriceNum,
          salePrice: salePriceNum,
          normalPrice: normalPriceNum,
          dailyPrice: dailyPriceNum,
          rentalType: rentalTypeVal,
          rentalTypeId: matchedCat?.id,
          costPrice: costPriceNum,
          defaultDamageFee: damageFeeNum,
          defaultLossFee: lossFeeNum,
          totalQuantity: totalQty,
          availableQuantity: totalQty,
          rentedQuantity: 0,
          damagedQuantity: 0,
          lostQuantity: 0,
          reservedQuantity: 0,
          maintenanceQuantity: 0,
          minimumStock: minStockNum,
          status: 'ACTIVE',
          isAccessory: r.isAccessory ?? false,
          isChargeable: isChargeableVal,
          requiresReturn: requiresReturnVal,
          createdAt: dateStr,
        }
      })

      const savedList = await addProductsAsync(createdProducts)
      setProducts(savedList)

      showToast(
        'บันทึกข้อมูลสินค้าสำเร็จ',
        `บันทึกข้อมูลสินค้า ${createdProducts.length} รายการเรียบร้อยแล้ว`,
        'SUCCESS'
      )

      // Reset Draft to 10 rows after success
      setCreateDraftRows(createInitialDraftRows('', ''))

      // Return to LIST view
      setActiveMainTab('LIST')
    } catch (err: any) {
      showToast('ไม่สามารถบันทึกสินค้าได้', err?.message || 'โปรดตรวจสอบข้อมูลสินค้า', 'ERROR')
    } finally {
      setIsCreatingSubmitting(false)
    }
  }

  // Quick Add Unit from Create View
  const handleQuickAddUnit = async (name: string): Promise<string> => {
    try {
      const updated = await addUnitAsync(name)
      setMasterUnits(updated)
      showToast('เพิ่มหน่วยนับสำเร็จ', `เพิ่มหน่วยนับ "${name}" เรียบร้อยแล้ว`, 'SUCCESS')
      const newUnit = updated.find((u) => u.name === name)
      return newUnit?.id || updated[updated.length - 1]?.id
    } catch (err: any) {
      showToast('ไม่สามารถเพิ่มหน่วยนับได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
      return ''
    }
  }

  // Quick Add Category from Create View
  const handleQuickAddCategory = async (name: string, calcType: CalculationType, unitId: string): Promise<string> => {
    try {
      const updatedCats = await addCategoryAsync(name)
      setProductCategories(updatedCats)
      const newCat = updatedCats.find((c) => c.name === name)
      const newCatId = newCat?.id || updatedCats[updatedCats.length - 1]?.id

      if (newCatId) {
        const updatedComp = await addCompositeRuleAsync({
          categoryId: newCatId,
          calculationType: calcType,
          unitId: unitId || undefined,
        })
        setCompositeRules(updatedComp)
      }

      showToast('เพิ่มหมวดหมู่สำเร็จ', `เพิ่มหมวดหมู่ "${name}" เรียบร้อยแล้ว`, 'SUCCESS')
      return newCatId || ''
    } catch (err: any) {
      showToast('ไม่สามารถเพิ่มหมวดหมู่ได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
      return ''
    }
  }

  // Selected Product for detail drawer / history modal
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [activeDrawerTab, setActiveDrawerTab] = useState<'CURRENT' | 'HISTORY' | 'OVERVIEW'>('CURRENT')
  // Filters for the two bill tabs (reset whenever another product is opened)
  const [holderSearch, setHolderSearch] = useState('')
  const [holderStatus, setHolderStatus] = useState('ALL')
  const [holderStartFrom, setHolderStartFrom] = useState('')
  const [holderDueTo, setHolderDueTo] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historyStatus, setHistoryStatus] = useState('ALL')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')

  // Holders / rental history come from the real bills (Supabase bill cache), never sample data.
  const [productBills, setProductBills] = useState<FullBill[]>(() => loadBills())
  const selectedProductId = selectedProduct?.id
  useEffect(() => {
    if (!selectedProductId) return
    setHolderSearch('')
    setHolderStatus('ALL')
    setHolderStartFrom('')
    setHolderDueTo('')
    setHistorySearch('')
    setHistoryStatus('ALL')
    setHistoryFrom('')
    setHistoryTo('')
    setProductBills(loadBills())
    void fetchBillsFromSupabase().then(setProductBills).catch(() => undefined)
  }, [selectedProductId])

  const todayStr = getLocalDateString(new Date())
  const productBillRows = React.useMemo(() => {
    if (!selectedProductId) return []
    return productBills
      .map((bill) => {
        const lines = (bill.items || []).filter((it) => it.productId === selectedProductId)
        if (lines.length === 0) return null
        const holding = HOLDING_RENTAL_STATUSES.includes(bill.rentalStatus)
        const due = (bill.scheduledReturnDate || '').slice(0, 10)
        return {
          bill,
          quantity: lines.reduce((s, it) => s + (it.quantity || 0), 0),
          outstanding: lines.reduce((s, it) => s + (it.outstandingQty || 0), 0),
          revenue: lines.reduce((s, it) => s + (it.lineTotal ?? (it.quantity || 0) * (it.dailyRate || 0)), 0),
          holding,
          overdue: holding && !!due && due < todayStr,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => (b.bill.rentalStartDate || b.bill.billDate || '').localeCompare(a.bill.rentalStartDate || a.bill.billDate || ''))
  }, [productBills, selectedProductId, todayStr])

  const matchesBillSearch = (bill: FullBill, term: string) => {
    const q = term.trim().toLowerCase()
    if (!q) return true
    return [bill.billNo, bill.customerName, bill.customerPhone, bill.siteName, bill.remark]
      .some((v) => (v || '').toLowerCase().includes(q))
  }

  const allHolders = productBillRows.filter((r) => r.holding && r.outstanding > 0)
  const productHolders = allHolders.filter((r) => {
    if (holderStatus === 'OVERDUE' && !r.overdue) return false
    if (holderStatus !== 'ALL' && holderStatus !== 'OVERDUE' && r.bill.rentalStatus !== holderStatus) return false
    if (holderStartFrom && (r.bill.rentalStartDate || '').slice(0, 10) < holderStartFrom) return false
    if (holderDueTo && (r.bill.scheduledReturnDate || '').slice(0, 10) > holderDueTo) return false
    return matchesBillSearch(r.bill, holderSearch)
  })
  const productHistory = productBillRows.filter((r) => {
    if (historyStatus === 'OVERDUE' && !r.overdue) return false
    if (historyStatus === 'HOLDING' && (!r.holding || r.overdue)) return false
    if (historyStatus === 'RETURNED_GROUP' && !['RETURNED', 'CLOSED'].includes(r.bill.rentalStatus)) return false
    const start = (r.bill.rentalStartDate || r.bill.billDate || '').slice(0, 10)
    if (historyFrom && start < historyFrom) return false
    if (historyTo && start > historyTo) return false
    return matchesBillSearch(r.bill, historySearch)
  })
  const historyStats = {
    total: productBillRows.filter((r) => !['DRAFT', 'CANCELLED', 'VOID'].includes(r.bill.rentalStatus)).length,
    renting: allHolders.length,
    returned: productBillRows.filter((r) => ['RETURNED', 'CLOSED'].includes(r.bill.rentalStatus)).length,
    overdue: productBillRows.filter((r) => r.overdue).length,
  }

  const exportBillRows = (rows: typeof productBillRows, sheet: string) => {
    if (!selectedProduct || rows.length === 0) {
      showToast('ไม่มีข้อมูล', 'ไม่มีรายการสำหรับส่งออก', 'ERROR')
      return
    }
    const data = rows.map((r) => ({
      เลขที่บิล: r.bill.billNo,
      ลูกค้า: r.bill.customerName || '-',
      เบอร์โทร: r.bill.customerPhone || '-',
      หน้างาน: r.bill.siteName || '-',
      เริ่มเช่า: formatThaiDate(r.bill.rentalStartDate),
      กำหนดคืน: formatThaiDate(r.bill.scheduledReturnDate),
      วันที่คืนจริง: formatThaiDate(r.bill.actualReturnDate),
      จำนวน: r.quantity,
      ค้างคืน: r.outstanding,
      สถานะ: r.overdue ? 'เกินกำหนดคืน' : RENTAL_STATUS_LABEL[r.bill.rentalStatus] || r.bill.rentalStatus,
      รายได้: r.revenue,
      หมายเหตุ: r.bill.remark || '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), sheet)
    XLSX.writeFile(wb, `${selectedProduct.code || selectedProduct.name}_${sheet}_${todayStr}.xlsx`)
  }

  // Damaged Stock Management Modals State
  const [restoreTargetProduct, setRestoreTargetProduct] = useState<Product | null>(null)
  const [transformTargetProduct, setTransformTargetProduct] = useState<Product | null>(null)


  // Delete product confirmation handler
  const handleConfirmDeleteProduct = async () => {
    if (!productToDelete) return
    const trimmedReason = deleteReason.trim()
    if (!trimmedReason) {
      showToast('กรุณาระบุเหตุผล', 'จำเป็นต้องระบุเหตุผลในการลบหรือระงับสินค้า', 'ERROR')
      return
    }

    setIsDeleting(true)
    try {
      const updated = await deleteProductAsync(productToDelete.id)
      setProducts(updated)


      showToast('ลบสินค้าสำเร็จ', `ลบรายการ "${productToDelete.name}" เรียบร้อยแล้ว`, 'SUCCESS')
      setDeleteReason('')
      setProductToDelete(null)
    } catch (err: any) {
      logger.error('Failed to delete product:', err)
      showToast('ไม่สามารถลบสินค้าได้', err?.message || 'เกิดข้อผิดพลาดในการลบสินค้า', 'ERROR')
    } finally {
      setIsDeleting(false)
    }
  }

  // Filtered Products (Search by product name only, no product code)
  const filteredProducts = products.filter((p) => {
    if (activeViewTab === 'DAMAGED' && p.damagedQuantity <= 0) {
      return false
    }
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCat = categoryFilter === 'ALL' || p.category === categoryFilter
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'LOW_STOCK' && isLowStock(p)) ||
      (statusFilter === 'OUT_OF_STOCK' && p.availableQuantity === 0) ||
      (statusFilter === 'ACTIVE' && p.status === 'ACTIVE')
    return matchesSearch && matchesCat && matchesStatus
  })

  // Stock Summary Metrics
  const totalItems = products.reduce((acc, p) => acc + p.totalQuantity, 0)
  const totalAvailable = products.reduce((acc, p) => acc + p.availableQuantity, 0)
  const totalReserved = products.reduce((acc, p) => acc + (p.reservedQuantity || 0), 0)
  const totalRented = products.reduce((acc, p) => acc + p.rentedQuantity, 0)
  const totalDamaged = products.reduce((acc, p) => acc + p.damagedQuantity, 0)
  const totalLost = products.reduce((acc, p) => acc + p.lostQuantity, 0)
  const lowStockCount = products.filter((p) => isLowStock(p)).length
  const damagedProductsCount = products.filter((p) => p.damagedQuantity > 0).length

  // Double-click / double-tap a product row: the 7 cards show that product's numbers.
  // Same row again, Esc, or a click/tap anywhere else returns to the overall totals.
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null)
  const focusedProduct = focusedProductId ? products.find((p) => p.id === focusedProductId) ?? null : null
  useEffect(() => {
    if (!focusedProductId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedProduct) setFocusedProductId(null)
    }
    const onPointerDown = (e: PointerEvent) => {
      const row = (e.target as Element | null)?.closest?.('[data-product-row]')
      if (row?.getAttribute('data-product-row') !== focusedProductId) setFocusedProductId(null)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [focusedProductId, selectedProduct])
  const cardTotal = focusedProduct ? focusedProduct.totalQuantity : totalItems
  const cardAvailable = focusedProduct ? focusedProduct.availableQuantity : totalAvailable
  const cardReserved = focusedProduct ? focusedProduct.reservedQuantity || 0 : totalReserved
  const cardRented = focusedProduct ? focusedProduct.rentedQuantity : totalRented
  const cardDamaged = focusedProduct ? focusedProduct.damagedQuantity : totalDamaged
  const cardLost = focusedProduct ? focusedProduct.lostQuantity : totalLost
  const focusedIsLow = !!focusedProduct && isLowStock(focusedProduct)

  // Handlers
  // Stock Count Handlers
  const handleOpenStockCount = () => {
    setActiveMainTab('COUNT')
  }

  const openProductHistory = (product: Product, initialTab: 'CURRENT' | 'HISTORY' | 'OVERVIEW' = 'CURRENT') => {
    setSelectedProduct(product)
    setIsEditingInline(false)
    setActiveDrawerTab(initialTab)
  }


  // Inline Edit State inside selectedProduct modal
  const [isEditingInline, setIsEditingInline] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    categoryRuleId: '',
    category: '',
    calculationType: 'PER_ROUND' as string,
    calculationLabel: '',
    unit: '',
    unitId: '',
    rentPrice: '' as string,
    salePrice: '' as string,
    costPrice: '' as string,
    defaultDamageFee: '' as string,
    defaultLossFee: '' as string,
    totalQuantity: '' as string,
    createdAt: '',
  })

  const startInlineEdit = (p: Product) => {
    const rules = loadCategoryRules()
    setCategoryRules(rules)
    const matched = rules.find((r) => r.id === p.categoryRuleId || r.name === p.category)
    setEditForm({
      name: p.name,
      categoryRuleId: matched ? matched.id : p.categoryRuleId || '',
      category: matched ? matched.name : p.category,
      calculationType: matched ? matched.calculationType : (p.calculationType || (p.rentalType === 'DAILY' ? 'PER_DAY' : 'PER_ROUND')),
      calculationLabel: matched ? matched.calculationLabel : (p.calculationLabel || (p.rentalType === 'DAILY' ? 'คำนวณตามวันใช้งานจริง' : 'คำนวณเหมาต่อรอบ/ครั้ง')),
      unit: matched ? (matched.unit || matched.unitName || '') : p.unit,
      rentPrice: p.rentPrice !== undefined && p.rentPrice !== null ? String(p.rentPrice) : '',
      salePrice: p.salePrice !== undefined && p.salePrice !== null ? String(p.salePrice) : '',
      unitId: masterUnits.find((u) => u.id === p.unitId || u.name === p.unit)?.id || p.unitId || '',
      costPrice: p.costPrice !== undefined && p.costPrice !== null ? String(p.costPrice) : '',
      defaultDamageFee: String(p.defaultDamageFee ?? 0),
      defaultLossFee: String(p.defaultLossFee ?? 0),
      totalQuantity: String(p.totalQuantity ?? 0),
      createdAt: p.createdAt || (p as any).created_at || getLocalDateString(new Date()),
    })
    setIsEditingInline(true)
  }

  const handleSaveInlineEdit = async () => {
    if (!selectedProduct) return
    if (!editForm.name.trim()) {
      showToast('กรุณาระบุชื่อสินค้า', 'ชื่อสินค้าต้องไม่เว้นว่าง', 'ERROR')
      return
    }
    if (!editForm.category.trim()) {
      showToast('กรุณาเลือกหมวดหมู่', 'จำเป็นต้องระบุหมวดหมู่สินค้า', 'ERROR')
      return
    }

    const rentVal = editForm.rentPrice !== '' ? Number(editForm.rentPrice) : null
    const saleVal = editForm.salePrice !== '' ? Number(editForm.salePrice) : null

    const chosenUnit = masterUnits.find((u) => u.id === editForm.unitId)
    const calcType = editForm.calculationType
    // Same mapping as the Add form (handleCreateSubmit).
    const updated: Product = {
      ...selectedProduct,
      name: editForm.name.trim(),
      category: editForm.category,
      categoryRuleId: editForm.categoryRuleId,
      calculationType: calcType,
      calculationLabel: editForm.calculationLabel,
      unit: chosenUnit?.name || editForm.unit || selectedProduct.unit,
      unitId: chosenUnit?.id || selectedProduct.unitId,
      rentPrice: rentVal,
      salePrice: saleVal,
      rentalType: calcType === 'SALE' ? 'SALE' : calcType === 'PER_DAY' ? 'DAILY' : 'NORMAL',
      isChargeable: calcType !== 'NO_CHARGE',
      requiresReturn: calcType !== 'SALE',
      normalPrice: rentVal ?? selectedProduct.normalPrice,
      dailyPrice: rentVal ?? selectedProduct.dailyPrice,
      costPrice: editForm.costPrice !== '' ? Number(editForm.costPrice) : selectedProduct.costPrice,
      defaultDamageFee: Number(editForm.defaultDamageFee || 0),
      defaultLossFee: Number(editForm.defaultLossFee || 0),
      totalQuantity: editForm.totalQuantity !== '' ? Number(editForm.totalQuantity) : selectedProduct.totalQuantity,
      createdAt: editForm.createdAt,
    }

    try {
      const next = await updateProductAsync(updated)
      setProducts(next)
      setSelectedProduct(next.find((p) => p.id === updated.id) ?? updated)
      setIsEditingInline(false)

    showToast('บันทึกสำเร็จ', `อัปเดตข้อมูลสินค้า "${updated.name}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      logger.error('Failed to update product inline', err)
      showToast('เกิดข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลได้ โปรดลองอีกครั้ง', 'ERROR')
    }
  }

  return (
    <div className="relative h-full min-h-0 min-w-0 flex flex-col overflow-hidden p-2 gap-2">
      {/* AREA 1: การ์ดสรุปภาพรวม 7 ใบ (สต็อกรวม = พร้อมให้เช่า + จอง + อยู่ระหว่างเช่า + ชำรุด) */}
      <div className="shrink-0">
        {/* Stock Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          <div
            onClick={() => setActiveViewTab('ALL')}
            className={`p-2.5 sm:p-3 bg-slate-100/70 dark:bg-slate-800/70 rounded-2xl border shadow-xs cursor-pointer transition-all ${
              activeViewTab === 'ALL'
                ? 'border-slate-400 ring-2 ring-slate-400/20'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-400'
            }`}
          >
            <span className="text-[11px] text-slate-500 font-semibold block">สต็อกรวม</span>
            <span className="text-lg font-black text-slate-800 dark:text-slate-100 mt-0.5 block">{cardTotal.toLocaleString()}</span>
          </div>
          <div className="p-2.5 sm:p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200/60 dark:border-emerald-900/40 shadow-xs">
            <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold block">พร้อมให้เช่า</span>
            <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5 block">{cardAvailable.toLocaleString()}</span>
          </div>
          <div className="p-2.5 sm:p-3 bg-indigo-50 dark:bg-indigo-950/30 rounded-2xl border border-indigo-200/60 dark:border-indigo-900/40 shadow-xs">
            <span className="text-[11px] text-indigo-700 dark:text-indigo-300 font-semibold block">จอง (รอส่ง)</span>
            <span className="text-lg font-black text-indigo-600 dark:text-indigo-400 mt-0.5 block">{cardReserved.toLocaleString()}</span>
          </div>
          <div className="p-2.5 sm:p-3 bg-blue-50 dark:bg-blue-950/30 rounded-2xl border border-blue-200/60 dark:border-blue-900/40 shadow-xs">
            <span className="text-[11px] text-blue-700 dark:text-blue-300 font-semibold block">อยู่ระหว่างเช่า</span>
            <span className="text-lg font-black text-blue-600 dark:text-blue-400 mt-0.5 block">{cardRented.toLocaleString()}</span>
          </div>
          <div
            onClick={() => setActiveViewTab('DAMAGED')}
            className={`p-2.5 sm:p-3 bg-amber-50 dark:bg-amber-950/30 rounded-2xl border shadow-xs cursor-pointer transition-all ${
              activeViewTab === 'DAMAGED'
                ? 'border-amber-500 ring-2 ring-amber-500/30'
                : 'border-amber-200/60 dark:border-amber-900/40 hover:border-amber-400'
            }`}
          >
            <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold block">ชำรุด</span>
            <span className="text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5 block">{cardDamaged.toLocaleString()}</span>
          </div>
          <div className="p-2.5 sm:p-3 bg-red-50 dark:bg-red-950/30 rounded-2xl border border-red-200/60 dark:border-red-900/40 shadow-xs">
            <span className="text-[11px] text-red-700 dark:text-red-300 font-semibold block">สูญหาย</span>
            <span className="text-lg font-black text-red-600 dark:text-red-400 mt-0.5 block">{cardLost.toLocaleString()}</span>
          </div>
          <div className="p-2.5 sm:p-3 bg-purple-50 dark:bg-purple-950/30 rounded-2xl border border-purple-200/60 dark:border-purple-900/40 shadow-xs">
            <span className="text-[11px] text-purple-700 dark:text-purple-300 font-semibold block">สินค้าใกล้หมด</span>
            <span className="text-lg font-black text-purple-600 dark:text-purple-400 mt-0.5 block">{(focusedProduct ? Number(focusedIsLow) : lowStockCount).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* AREA 2: กรอบเดียว ครอบแถบ 4 ปุ่มหลัก + พื้นที่ทำงาน */}
      <div className="flex-1 min-h-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">
        {/* Outer Row: p-2 border-b */}
        <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex items-center shrink-0 overflow-x-auto">
          <div className={TAB_CONTAINER_CLASSES}>
            <ActionButton
              onClick={() => setActiveMainTab('LIST')}
              size="sm"
              variant={activeMainTab === 'LIST' ? 'active' : 'ghost'}
              icon={<Layers className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'LIST' ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600/80 dark:text-blue-400/80'}`} />}
              badge={
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                  activeMainTab === 'LIST'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}>
                  {products.length}
                </span>
              }
            >
              รายการสินค้า
            </ActionButton>

            <ActionButton
              onClick={() => setActiveMainTab('ADD')}
              size="sm"
              variant={activeMainTab === 'ADD' ? 'active' : 'ghost'}
              icon={<PackagePlus className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'ADD' ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-600/80 dark:text-emerald-400/80'}`} />}
              badge={
                createDraftRows.some((r) => r.name.trim() !== '') ? (
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title="มีแบบร่างค้างอยู่" />
                ) : undefined
              }
            >
              เพิ่มสินค้า
            </ActionButton>

            <ActionButton
              onClick={() => setActiveMainTab('SETTINGS')}
              size="sm"
              variant={activeMainTab === 'SETTINGS' ? 'active' : 'ghost'}
              icon={<Settings className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'SETTINGS' ? 'text-purple-600 dark:text-purple-400' : 'text-purple-600/80 dark:text-purple-400/80'}`} />}
            >
              ตั้งค่าเสริม
            </ActionButton>

            <ActionButton
              onClick={() => setActiveMainTab('COUNT')}
              size="sm"
              variant={activeMainTab === 'COUNT' ? 'active' : 'ghost'}
              icon={<ClipboardList className={`w-3.5 h-3.5 shrink-0 ${activeMainTab === 'COUNT' ? 'text-purple-600 dark:text-purple-400' : 'text-purple-600/80 dark:text-purple-400/80'}`} />}
            >
              นับสต็อก
            </ActionButton>
          </div>
        </div>

        {/* พื้นที่ของ LIST / ADD / SETTINGS / COUNT */}
        {activeMainTab === 'LIST' && (
          <ProductListView
            products={filteredProducts}
            isLoading={isLoading}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            activeViewTab={activeViewTab}
            setActiveViewTab={setActiveViewTab}
            categories={categories}
            damagedProductsCount={damagedProductsCount}
            onRestoreDamaged={(p) => setRestoreTargetProduct(p)}
            onTransformDamaged={(p) => setTransformTargetProduct(p)}
            canAdjustStock={canAction('STOCK_ADJUST')}
            onOpenHistory={(p) => openProductHistory(p, 'CURRENT')}
            onDeleteProduct={(p) => setProductToDelete(p)}
            focusedProductId={focusedProductId}
            onRowDoubleClick={(p) => setFocusedProductId((cur) => (cur === p.id ? null : p.id))}
          />
        )}

        {activeMainTab === 'ADD' && (
          <ProductCreateView
            rows={createDraftRows}
            setRows={setCreateDraftRows}
            categories={productCategories}
            compositeRules={compositeRules}
            categoryRules={categoryRules}
            units={masterUnits}
            isSubmitting={isCreatingSubmitting}
            onSubmit={handleCreateSubmit}
            onClearDraft={handleClearDraft}
            onNavigateToSettings={() => setActiveMainTab('SETTINGS')}
            onQuickAddCategory={handleQuickAddCategory}
            onQuickAddUnit={handleQuickAddUnit}
          />
        )}

        {activeMainTab === 'SETTINGS' && (
          <ProductSettingsView
            categories={productCategories}
            setCategories={setProductCategories}
            compositeRules={compositeRules}
            setCompositeRules={setCompositeRules}
            categoryRules={categoryRules}
            setCategoryRules={setCategoryRules}
            masterUnits={masterUnits}
            setMasterUnits={setMasterUnits}
            allProducts={products}
            onShowToast={(title, msg, type) => showToast(title, msg, type)}
          />
        )}

        {activeMainTab === 'COUNT' && (
          <ProductStockCountView
            products={products}
            onSuccess={(updated) => setProducts(updated)}
            onNavigateToList={() => setActiveMainTab('LIST')}
          />
        )}
      </div>

      {/* Damaged Restore Modal */}
      <DamagedRestoreModal
        isOpen={!!restoreTargetProduct}
        onClose={() => setRestoreTargetProduct(null)}
        product={restoreTargetProduct}
        onSuccess={({ product: updatedP }) => {
          setProducts(loadStorageProducts())
          if (selectedProduct?.id === updatedP.id) {
            setSelectedProduct(updatedP)
          }
        }}
        onShowToast={(title, msg, type) => showToast(title, msg, type)}
      />

      {/* Damaged Transform Modal */}
      <DamagedTransformModal
        isOpen={!!transformTargetProduct}
        onClose={() => setTransformTargetProduct(null)}
        sourceProduct={transformTargetProduct}
        allProducts={products}
        onSuccess={({ sourceProduct: updatedSource, targetProduct: updatedTarget }) => {
          setProducts(loadStorageProducts())
          if (selectedProduct?.id === updatedSource.id) setSelectedProduct(updatedSource)
          if (selectedProduct?.id === updatedTarget.id) setSelectedProduct(updatedTarget)
        }}
        onShowToast={(title, msg, type) => showToast(title, msg, type)}
      />

      {/* PRODUCT RENTAL HISTORY & ACTIVE HOLDERS MODAL */}
      <AppModal
        variant="workspace"
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProduct(null)}
        size="xl"
      >
        {selectedProduct && (
          <>
            <AppModalBody noPadding className="!overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-950">
              {/* Product info: name / category / unit / date added + real stock quantities */}
              <div className={`shrink-0 p-2 pb-0 ${isEditingInline ? 'max-h-[70%] overflow-y-auto' : ''}`}>
                {!isEditingInline ? (
                  /* Display Mode */
                  <div className="bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="px-2 py-0.5 rounded-md font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                            {selectedProduct.category || '-'}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            หน่วยนับ: <strong className="text-slate-800 dark:text-slate-200">{selectedProduct.unit || '-'}</strong>
                          </span>
                        </div>
                        <h3 className="text-lg font-black text-slate-900 dark:text-slate-100 leading-tight">{selectedProduct.name}</h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>วันที่เพิ่ม: <strong className="text-slate-700 dark:text-slate-300">{formatThaiDate(selectedProduct.createdAt || (selectedProduct as any).created_at)}</strong></span>
                          {selectedProduct.rentPrice !== undefined && selectedProduct.rentPrice !== null && selectedProduct.rentPrice > 0 && (
                            <span>ราคาเช่า: <strong className="text-blue-600 dark:text-blue-400 font-mono">฿{selectedProduct.rentPrice.toLocaleString('th-TH')}</strong></span>
                          )}
                          {selectedProduct.salePrice !== undefined && selectedProduct.salePrice !== null && selectedProduct.salePrice > 0 && (
                            <span>ราคาขาย: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">฿{selectedProduct.salePrice.toLocaleString('th-TH')}</strong></span>
                          )}
                        </div>
                      </div>
                      <div className="order-last w-full lg:order-none lg:w-auto grid grid-cols-5 gap-1.5">
                        {[
                          { label: 'พร้อมใช้', value: selectedProduct.availableQuantity, tone: KPI_TONE.emerald, icon: <Package className="w-5 h-5" /> },
                          { label: 'กำลังเช่า', value: selectedProduct.rentedQuantity, tone: KPI_TONE.blue, icon: <Handshake className="w-5 h-5" /> },
                          { label: 'ชำรุด / ซ่อม', value: selectedProduct.damagedQuantity, tone: KPI_TONE.amber, icon: <Wrench className="w-5 h-5" /> },
                          { label: 'สูญหาย', value: selectedProduct.lostQuantity, tone: KPI_TONE.red, icon: <AlertTriangle className="w-5 h-5" /> },
                          { label: 'รวมทั้งหมด', value: selectedProduct.totalQuantity, tone: KPI_TONE.slate, icon: <Sigma className="w-5 h-5" /> },
                        ].map((s) => (
                          <div key={s.label} className={`${KPI_CARD} ${s.tone.box} flex items-center gap-2 lg:min-w-[112px]`}>
                            <span className={`shrink-0 ${s.tone.value}`}>{s.icon}</span>
                            <div className="min-w-0">
                              <span className={`${KPI_LABEL} ${s.tone.label}`}>{s.label}</span>
                              <span className={`${KPI_VALUE} ${s.tone.value}`}>
                                {(s.value || 0).toLocaleString('th-TH')} <span className="text-[10px] font-bold text-slate-400">{selectedProduct.unit}</span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <ActionButton size="sm" variant="neutral" icon={<Edit />} onClick={() => startInlineEdit(selectedProduct)}>
                          แก้ไขสินค้า
                        </ActionButton>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProduct(null)
                            setIsEditingInline(false)
                          }}
                          aria-label="ปิดหน้าต่าง"
                          title="ปิดหน้าต่าง"
                          className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Edit Mode: Inline Form */
                  <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border-2 border-amber-400 dark:border-amber-500 shadow-md space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <span>ข้อมูลสินค้า</span>
                        <span className="text-xs font-black text-amber-600 dark:text-amber-400">· แก้ไข</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProduct(null)
                          setIsEditingInline(false)
                        }}
                        aria-label="ปิดหน้าต่าง"
                        title="ปิดหน้าต่าง"
                        className="shrink-0 p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 text-xs">

                      {/* ชื่อสินค้า */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">
                          ชื่อสินค้า <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="ชื่อสินค้า..."
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      {/* หมวดหมู่ (Dropdown from Category Rules) */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">
                          หมวดหมู่ <span className="text-red-500">*</span>
                        </label>
                        <CustomSelect
                          value={editForm.category}
                          onChange={(val) => {
                            const chosen = categoryRules.find((r) => r.name === val)
                            if (chosen) {
                              setEditForm((prev) => ({
                                ...prev,
                                categoryRuleId: chosen.id,
                                category: chosen.name,
                                calculationType: chosen.calculationType,
                                calculationLabel: chosen.calculationLabel,
                                unit: chosen.unit || chosen.unitName || '',
                              }))
                            } else {
                              setEditForm((prev) => ({ ...prev, category: String(val) }))
                            }
                          }}
                          options={categoryRules.map((r) => ({ value: r.name, label: r.name }))}
                          placeholder="เลือกหมวดหมู่"
                        />
                      </div>

                      {/* วิธีคิดเงิน */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">วิธีคิดเงิน</label>
                        <CustomSelect
                          value={editForm.calculationType}
                          onChange={(val) =>
                            setEditForm((prev) => ({
                              ...prev,
                              calculationType: String(val),
                              calculationLabel: CALCULATION_LONG_LABELS[val as CalculationType] || prev.calculationLabel,
                            }))
                          }
                          options={CALCULATION_OPTIONS.map((opt) => ({ value: opt.type, label: opt.label }))}
                          placeholder="-- วิธีคิดเงิน --"
                        />
                      </div>

                      {/* หน่วยนับ */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">หน่วยนับ</label>
                        <CustomSelect
                          value={editForm.unitId}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, unitId: String(val) }))}
                          options={masterUnits.filter((u) => u.isActive || u.id === editForm.unitId).map((u) => ({ value: u.id, label: u.name }))}
                          placeholder="-- หน่วยนับ --"
                        />
                      </div>

                      {/* ราคาเช่า */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">
                          ราคาเช่า (฿) <span className="text-slate-400 font-normal">(เว้นว่างได้)</span>
                        </label>
                        <NumericInput
                          value={editForm.rentPrice}
                          disabled={!canAction('PRODUCT_PRICE_CHANGE')}
                          title={canAction('PRODUCT_PRICE_CHANGE') ? undefined : NO_ACTION_PERMISSION_TITLE}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, rentPrice: val === '' ? '' : String(val) }))}
                          placeholder="เว้นว่างได้ถ้าไม่ให้เช่า"
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      {/* ราคาขาย */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">
                          ราคาขาย (฿) <span className="text-slate-400 font-normal">(เว้นว่างได้)</span>
                        </label>
                        <NumericInput
                          value={editForm.salePrice}
                          disabled={!canAction('PRODUCT_PRICE_CHANGE')}
                          title={canAction('PRODUCT_PRICE_CHANGE') ? undefined : NO_ACTION_PERMISSION_TITLE}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, salePrice: val === '' ? '' : String(val) }))}
                          placeholder="เว้นว่างได้ถ้าไม่ขาย"
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">ต้นทุน (฿)</label>
                        <NumericInput
                          value={editForm.costPrice}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, costPrice: val === '' ? '' : String(val) }))}
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">ค่าชำรุด (฿)</label>
                        <NumericInput
                          value={editForm.defaultDamageFee}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, defaultDamageFee: val === '' ? '' : String(val) }))}
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">ค่าสูญหาย (฿)</label>
                        <NumericInput
                          value={editForm.defaultLossFee}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, defaultLossFee: val === '' ? '' : String(val) }))}
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">จำนวนทั้งหมด <span className="text-slate-400 font-normal">(เพิ่ม/ลด = รับเข้า/นำออก, ยืนยัน PIN)</span></label>
                        <NumericInput
                          value={editForm.totalQuantity}
                          onChange={(val) => setEditForm((prev) => ({ ...prev, totalQuantity: val === '' ? '' : String(val) }))}
                          className="w-full h-9 px-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl border border-slate-300 dark:border-slate-700 font-mono font-bold text-xs focus:ring-2 focus:ring-amber-500 outline-none"
                        />
                      </div>

                      {/* วันที่เพิ่มสินค้า */}
                      <div>
                        <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">วันที่เพิ่มสินค้า</label>
                        <CustomDatePicker
                          value={parseLocalDate(editForm.createdAt)}
                          onChange={(d) => setEditForm((prev) => ({ ...prev, createdAt: d ? getLocalDateString(d) : '' }))}
                          className="w-full"
                        />
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsEditingInline(false)}
                        className="h-9 px-4 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveInlineEdit}
                        className="h-9 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-sm transition-colors cursor-pointer"
                      >
                        บันทึก
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Tabs + content in one card (same pattern as the customer page) */}
              <div className="flex-1 min-h-0 m-2 mt-1 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
              {/* Navigation Tabs (shared tab component classes) */}
              <div className="shrink-0 p-2 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700"><div className={`${TAB_CONTAINER_CLASSES} max-w-full`}>
                {([
                  { key: 'CURRENT', icon: <MapPin className="w-3.5 h-3.5" />, label: `ปัจจุบันสินค้าอยู่กับใครบ้าง (${allHolders.length})` },
                  { key: 'HISTORY', icon: <History className="w-3.5 h-3.5" />, label: 'ประวัติการเช่าทั้งหมด' },
                  { key: 'OVERVIEW', icon: <Sliders className="w-3.5 h-3.5" />, label: 'สถานะสต็อก' },
                ] as const).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setActiveDrawerTab(t.key)}
                    className={`${TAB_BUTTON_BASE_CLASSES} ${activeDrawerTab === t.key ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div></div>

              {/* Tab Body: tables fill the remaining height, only rows scroll */}
              <div className={`flex-1 min-h-0 flex flex-col gap-2 text-xs ${activeDrawerTab === 'OVERVIEW' ? 'p-2 overflow-y-auto' : 'overflow-hidden'}`}>

                {/* TAB 1: ปัจจุบันสินค้าอยู่กับใครบ้าง (open rental bills still holding this product) */}
                {activeDrawerTab === 'CURRENT' && (() => {
                  const total = selectedProduct.totalQuantity || 0
                  const rented = selectedProduct.rentedQuantity || 0
                  const pct = total > 0 ? (rented / total) * 100 : 0
                  const r = 16
                  const c = 2 * Math.PI * r
                  return (
                    <DataTableFrame
                      fill
                      className="flex-1 p-2 rounded-none"
                      rowCount={productHolders.length}
                      header={
                        <div className="space-y-2 pb-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0 flex items-start gap-2 px-1">
                              <MapPin className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">รายการลูกค้าที่เช่าสินค้าอยู่ในขณะนี้</h4>
                                <p className="text-[11px] text-slate-500">ลูกค้าที่มีสินค้า &quot;{selectedProduct.name}&quot; อยู่ในการเช่า ยังไม่คืนครบ</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
                              <div className="relative w-12 h-12 shrink-0">
                                <svg viewBox="0 0 40 40" className="w-full h-full -rotate-90">
                                  <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-slate-100 dark:stroke-slate-800" />
                                  <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-emerald-500" strokeDasharray={`${(pct / 100) * c} ${c}`} />
                                </svg>
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-slate-800 dark:text-slate-100">{pct.toFixed(1)}%</span>
                              </div>
                              <div className="leading-tight">
                                <span className="block text-[11px] text-slate-500">กำลังเช่าในขณะนี้</span>
                                <span className="text-sm text-slate-600 dark:text-slate-300"><strong className="text-lg font-black text-blue-600 dark:text-blue-400">{rented}</strong> จาก <strong className="text-slate-900 dark:text-slate-100">{total}</strong> {selectedProduct.unit}</span>
                              </div>
                              <div className="pl-3 border-l border-slate-200 dark:border-slate-700 text-[11px] space-y-0.5">
                                <p className="flex items-center gap-1.5 text-slate-500"><Package className="w-3.5 h-3.5 text-emerald-500" />พร้อมให้เช่า <strong className="text-emerald-600 dark:text-emerald-400 text-sm">{selectedProduct.availableQuantity}</strong> {selectedProduct.unit}</p>
                                <p className="flex items-center gap-1.5 text-slate-500"><CalendarDays className="w-3.5 h-3.5 text-amber-500" />จองล่วงหน้า <strong className="text-amber-600 dark:text-amber-400 text-sm">{selectedProduct.reservedQuantity || 0}</strong> {selectedProduct.unit}</p>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <div className="relative flex-1 min-w-[160px]">
                              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                value={holderSearch}
                                onChange={(e) => setHolderSearch(e.target.value)}
                                placeholder="ค้นชื่อลูกค้า, เลขบิล, เบอร์โทร..."
                                type="text"
                                className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                              />
                            </div>
                            <div className="w-36">
                              <CustomDatePicker value={parseLocalDate(holderStartFrom)} onChange={(d) => setHolderStartFrom(d ? getLocalDateString(d) : '')} placeholder="วันที่เช่า" align="left" />
                            </div>
                            <div className="w-36">
                              <CustomDatePicker value={parseLocalDate(holderDueTo)} onChange={(d) => setHolderDueTo(d ? getLocalDateString(d) : '')} placeholder="กำหนดคืน" />
                            </div>
                            <div className="w-36">
                              <CustomSelect
                                value={holderStatus}
                                onChange={(v) => setHolderStatus(String(v))}
                                options={[
                                  { value: 'ALL', label: 'สถานะ: ทั้งหมด' },
                                  ...HOLDING_RENTAL_STATUSES.map((st) => ({ value: st, label: RENTAL_STATUS_LABEL[st] })),
                                  { value: 'OVERDUE', label: 'เกินกำหนดคืน' },
                                ]}
                                buttonClassName="h-9 px-2.5 rounded-xl"
                              />
                            </div>
                            <ActionButton variant="neutral" icon={<RotateCcw />} onClick={() => { setHolderSearch(''); setHolderStatus('ALL'); setHolderStartFrom(''); setHolderDueTo('') }}>
                              ล้างตัวกรอง
                            </ActionButton>
                            <ActionButton
                              onClick={() => exportBillRows(productHolders, 'holders')}
                              className="ml-auto !bg-emerald-600 hover:!bg-emerald-700 !text-white !border-transparent"
                              icon={<Download />}
                            >
                              ส่งออก
                            </ActionButton>
                          </div>
                        </div>
                      }
                    >
                      <table className={`${DATA_TABLE_CLASSES} text-xs`}>
                        <thead className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="px-2 text-center w-10">#</th>
                            <th className="px-2">ลูกค้า</th>
                            <th className="px-2">เลขที่บิล</th>
                            <th className="px-2 text-center">จำนวน ({selectedProduct.unit})</th>
                            <th className="px-2">วันที่เช่า</th>
                            <th className="px-2">กำหนดคืน</th>
                            <th className="px-2">สถานะ</th>
                            <th className="px-2">หมายเหตุ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {productHolders.map(({ bill, outstanding, overdue }, idx) => (
                            <tr key={bill.id} className="hover:bg-amber-50/40 dark:hover:bg-amber-950/20">
                              <td className="px-2 text-center text-slate-500">{idx + 1}</td>
                              <td className="px-2">
                                <span className="block font-bold text-slate-900 dark:text-slate-100">{bill.customerName || '-'}</span>
                                {bill.customerPhone && (
                                  <span className="flex items-center gap-1 text-[11px] text-slate-500"><Phone className="w-3 h-3" />{bill.customerPhone}</span>
                                )}
                              </td>
                              <td className="px-2 text-blue-600 dark:text-blue-400 whitespace-nowrap">{bill.billNo}</td>
                              <td className="px-2 text-center font-bold whitespace-nowrap">{outstanding}</td>
                              <td className="px-2 whitespace-nowrap">{formatThaiDate(bill.rentalStartDate)}</td>
                              <td className="px-2 whitespace-nowrap">{formatThaiDate(bill.scheduledReturnDate)}</td>
                              <td className="px-2 whitespace-nowrap">
                                {overdue ? (
                                  <StatusPill tone="red" label="เกินกำหนดคืน" />
                                ) : (
                                  <StatusPill tone="amber" label={RENTAL_STATUS_LABEL[bill.rentalStatus] || bill.rentalStatus} />
                                )}
                              </td>
                              <td className="px-2 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={bill.remark || ''}>{bill.remark || '-'}</td>
                            </tr>
                          ))}
                          {productHolders.length === 0 && (
                            <tr data-empty-row="true">
                              <td colSpan={8} className="text-center py-10 text-slate-400 text-xs italic">ไม่มีลูกค้าที่ถือสินค้านี้ตามเงื่อนไข</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </DataTableFrame>
                  )
                })()}

                {/* TAB 2: ประวัติการเช่าทั้งหมด (every bill that contains this product) */}
                {activeDrawerTab === 'HISTORY' && (
                  <DataTableFrame
                    fill
                    className="flex-1 p-2 rounded-none"
                    rowCount={productHistory.length}
                    header={
                      <div className="space-y-2 pb-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex items-start gap-2 px-1">
                            <Clock className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">ประวัติการเช่าทั้งหมด</h4>
                              <p className="text-[11px] text-slate-500">รายการประวัติการเช่า &quot;{selectedProduct.name}&quot; ทุกครั้งที่ผ่านมา</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                            {[
                              { label: 'จำนวนการเช่าทั้งหมด', value: historyStats.total, icon: <FileText className="w-5 h-5 text-blue-600" />, cls: 'text-slate-500', box: 'bg-slate-100/70 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700' },
                              { label: 'กำลังเช่าอยู่', value: historyStats.renting, icon: <PlayCircle className="w-5 h-5 text-emerald-600" />, cls: 'text-emerald-700 dark:text-emerald-300', box: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-900/40' },
                              { label: 'คืนแล้ว', value: historyStats.returned, icon: <CheckCircle2 className="w-5 h-5 text-blue-600" />, cls: 'text-blue-700 dark:text-blue-300', box: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-900/40' },
                              { label: 'เกินกำหนดคืน', value: historyStats.overdue, icon: <AlertTriangle className="w-5 h-5 text-red-600" />, cls: 'text-red-700 dark:text-red-300', box: 'bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-900/40' },
                            ].map((s) => (
                              <div key={s.label} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border min-w-[120px] ${s.box}`}>
                                {s.icon}
                                <div className="leading-tight">
                                  <span className={`block text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
                                  <span className="text-lg font-black text-slate-900 dark:text-slate-100">{s.value} <span className="text-[11px] font-semibold text-slate-500">ครั้ง</span></span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <div className="relative flex-1 min-w-[160px]">
                            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              value={historySearch}
                              onChange={(e) => setHistorySearch(e.target.value)}
                              placeholder="ค้นชื่อลูกค้า, เลขบิล, เบอร์โทร..."
                              type="text"
                              className="w-full h-9 pl-9 pr-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                            />
                          </div>
                          <div className="w-36">
                            <CustomDatePicker value={parseLocalDate(historyFrom)} onChange={(d) => setHistoryFrom(d ? getLocalDateString(d) : '')} placeholder="วันที่เริ่มต้น" align="left" />
                          </div>
                          <div className="w-36">
                            <CustomDatePicker value={parseLocalDate(historyTo)} onChange={(d) => setHistoryTo(d ? getLocalDateString(d) : '')} placeholder="วันที่สิ้นสุด" />
                          </div>
                          <div className="w-36">
                            <CustomSelect
                              value={historyStatus}
                              onChange={(v) => setHistoryStatus(String(v))}
                              options={[
                                { value: 'ALL', label: 'สถานะการคืน: ทั้งหมด' },
                                { value: 'RETURNED_GROUP', label: 'คืนแล้ว' },
                                { value: 'HOLDING', label: 'กำลังเช่าอยู่' },
                                { value: 'OVERDUE', label: 'เกินกำหนดคืน' },
                              ]}
                              buttonClassName="h-9 px-2.5 rounded-xl"
                            />
                          </div>
                          <ActionButton variant="neutral" icon={<RotateCcw />} onClick={() => { setHistorySearch(''); setHistoryStatus('ALL'); setHistoryFrom(''); setHistoryTo('') }}>
                            ล้างตัวกรอง
                          </ActionButton>
                          <ActionButton
                            onClick={() => exportBillRows(productHistory, 'history')}
                            className="ml-auto !bg-emerald-600 hover:!bg-emerald-700 !text-white !border-transparent"
                            icon={<Download />}
                          >
                            ส่งออก
                          </ActionButton>
                        </div>
                      </div>
                    }
                  >
                    <table className={`${DATA_TABLE_CLASSES} text-xs`}>
                      <thead className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="px-2 text-center w-10">#</th>
                          <th className="px-2">วันที่</th>
                          <th className="px-2">เลขที่บิล</th>
                          <th className="px-2">ลูกค้า</th>
                          <th className="px-2 text-center">จำนวน</th>
                          <th className="px-2">วันที่เช่า</th>
                          <th className="px-2">วันที่คืน</th>
                          <th className="px-2">สถานะการคืน</th>
                          <th className="px-2 text-right">รายรับ (บาท)</th>
                          <th className="px-2">หมายเหตุ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {productHistory.map(({ bill, quantity, revenue, overdue, holding }, idx) => (
                          <tr key={bill.id} className="hover:bg-amber-50/40 dark:hover:bg-amber-950/20">
                            <td className="px-2 text-center text-slate-500">{idx + 1}</td>
                            <td className="px-2 whitespace-nowrap">{formatThaiDate(bill.billDate)}</td>
                            <td className="px-2 text-blue-600 dark:text-blue-400 whitespace-nowrap">{bill.billNo}</td>
                            <td className="px-2 font-bold text-slate-900 dark:text-slate-100">{bill.customerName || '-'}</td>
                            <td className="px-2 text-center whitespace-nowrap">{quantity}</td>
                            <td className="px-2 whitespace-nowrap">{formatThaiDate(bill.rentalStartDate)}</td>
                            <td className="px-2 whitespace-nowrap">{formatThaiDate(bill.actualReturnDate || bill.scheduledReturnDate)}</td>
                            <td className="px-2 whitespace-nowrap">
                              {overdue ? (
                                <StatusPill tone="red" label="เกินกำหนดคืน" />
                              ) : holding ? (
                                <StatusPill tone="amber" label="กำลังเช่าอยู่" />
                              ) : bill.rentalStatus === 'RETURNED' || bill.rentalStatus === 'CLOSED' ? (
                                <StatusPill tone="emerald" label="คืนแล้ว" />
                              ) : (
                                <StatusPill tone="slate" label={RENTAL_STATUS_LABEL[bill.rentalStatus] || bill.rentalStatus} />
                              )}
                            </td>
                            <td className="px-2 text-right font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                              {revenue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-2 text-slate-600 dark:text-slate-300 max-w-[140px] truncate" title={bill.remark || ''}>{bill.remark || '-'}</td>
                          </tr>
                        ))}
                        {productHistory.length === 0 && (
                          <tr data-empty-row="true">
                            <td colSpan={10} className="text-center py-10 text-slate-400 text-xs italic">ไม่มีประวัติการเช่าตามเงื่อนไข</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </DataTableFrame>
                )}

                {/* TAB 3: สถานะสต็อก (stock_balances via the product cache) */}
                {activeDrawerTab === 'OVERVIEW' && (() => {
                  const total = selectedProduct.totalQuantity || 0
                  const pctOf = (v: number) => (total > 0 ? Math.round(((v || 0) / total) * 100) : 0)
                  const states = [
                    { label: 'พร้อมใช้', value: selectedProduct.availableQuantity || 0, color: '#10b981', tone: KPI_TONE.emerald },
                    { label: 'จองแล้ว', value: selectedProduct.reservedQuantity || 0, color: '#8b5cf6', tone: KPI_TONE.purple },
                    { label: 'กำลังเช่า', value: selectedProduct.rentedQuantity || 0, color: '#3b82f6', tone: KPI_TONE.blue },
                    { label: 'ชำรุด / ซ่อม', value: selectedProduct.damagedQuantity || 0, color: '#f59e0b', tone: KPI_TONE.amber },
                    { label: 'สูญหาย', value: selectedProduct.lostQuantity || 0, color: '#f43f5e', tone: KPI_TONE.red },
                  ]
                  return (
                    <>
                      {/* The 5 stock cards are already in the product header above; this tab adds the breakdown only. */}
                      <div className="flex-1 min-h-[260px] grid grid-cols-1 lg:grid-cols-5 gap-2">
                        <div className="lg:col-span-2 p-2 flex flex-col">
                          <h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs pb-2">สัดส่วนสถานะสต็อก</h4>
                          <div className="flex-1 flex items-center">
                            <ReportDonutChart
                              data={states.map((s) => ({ label: s.label, value: s.value, color: s.color, percentage: pctOf(s.value) }))}
                              size={120}
                              centerTitle="รวม"
                              centerValue={total}
                              centerSuffix={selectedProduct.unit}
                            />
                          </div>
                        </div>

                        <DataTableFrame
                          fill
                          className="lg:col-span-3 min-h-[220px] p-2 rounded-none border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-700"
                          header={<h4 className="font-bold text-slate-800 dark:text-slate-200 text-xs pb-2">รายละเอียดสถานะสต็อกในคลัง</h4>}
                        >
                          <table className={`${DATA_TABLE_CLASSES} text-xs`}>
                            <thead className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                              <tr>
                                <th className="px-2">สถานะ</th>
                                <th className="px-2 text-right">จำนวน</th>
                                <th className="px-2 text-right">สัดส่วนจากรวม</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                              {states.map((s) => (
                                <tr key={s.label}>
                                  <td className="px-2 font-bold">
                                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: s.color }} />
                                    {s.label}
                                  </td>
                                  <td className={`px-2 text-right font-mono font-bold ${s.tone.value}`}>{s.value} {selectedProduct.unit}</td>
                                  <td className="px-2 text-right font-mono text-slate-500">{total > 0 ? `${pctOf(s.value)}%` : '-'}</td>
                                </tr>
                              ))}
                              <tr className="bg-slate-50 dark:bg-slate-800/60">
                                <td className="px-2 font-black">รวม (ไม่นับสูญหาย)</td>
                                <td className="px-2 text-right font-mono font-black">{total} {selectedProduct.unit}</td>
                                <td className="px-2" />
                              </tr>
                            </tbody>
                          </table>
                        </DataTableFrame>
                      </div>

                      <div className="shrink-0 px-3 py-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                        <span className="font-bold text-slate-800 dark:text-slate-200">ราคาและค่าธรรมเนียม</span>
                        {selectedProduct.rentPrice !== undefined && selectedProduct.rentPrice !== null ? (
                          <span className="text-slate-500">ราคาเช่า: <span className="font-bold text-blue-600">฿{selectedProduct.rentPrice.toLocaleString()}</span></span>
                        ) : (
                          <span className="text-slate-500">ราคาเช่าปกติ: <span className="font-bold text-blue-600">฿{selectedProduct.normalPrice.toLocaleString()}</span></span>
                        )}
                        {selectedProduct.salePrice !== undefined && selectedProduct.salePrice !== null && (
                          <span className="text-slate-500">ราคาขาย: <span className="font-bold text-emerald-600">฿{selectedProduct.salePrice.toLocaleString()}</span></span>
                        )}
                        <span className="text-slate-500">ค่าชำรุดตั้งต้น: <span className="font-bold text-amber-600">฿{selectedProduct.defaultDamageFee.toLocaleString()}</span></span>
                        <span className="text-slate-500">ค่าสูญหายตั้งต้น: <span className="font-bold text-red-600">฿{selectedProduct.defaultLossFee.toLocaleString()}</span></span>
                      </div>
                    </>
                  )
                })()}

              </div>
              </div>
            </AppModalBody>

          </>
        )}
      </AppModal>

      {/* Delete Product Confirmation Modal */}
      <AppModal
        isOpen={!!productToDelete}
        onClose={() => {
          if (!isDeleting) setProductToDelete(null)
        }}
        size="sm"
      >
        <AppModalHeader
          title="ยืนยันการลบสินค้า"
          icon={<Trash2 className="w-5 h-5 text-red-600" />}
          onClose={() => {
            if (!isDeleting) setProductToDelete(null)
          }}
        />
        <AppModalBody className="space-y-3 text-xs py-3">
          <p className="text-slate-700 dark:text-slate-300">
            คุณต้องการลบสินค้า <strong className="text-slate-900 dark:text-slate-100 font-bold">&quot;{productToDelete?.name}&quot;</strong> ออกจากระบบหรือไม่?
          </p>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
              <span>เหตุผลในการลบ/ระงับสินค้า (จำเป็น)</span>
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="ระบุเหตุผล เช่น สินค้าชำรุดจำหน่ายออก, สินค้าเลิกจำหน่าย..."
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="p-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-600 dark:text-red-400 text-[11px] leading-relaxed">
            * ข้อมูลสินค้าจะถูกลบออกจากฐานข้อมูล และไม่สามารถเรียกคืนได้
          </div>
        </AppModalBody>
        <AppModalFooter
          onCancel={() => {
            setDeleteReason('')
            setProductToDelete(null)
          }}
          cancelText="ยกเลิก"
          onConfirm={handleConfirmDeleteProduct}
          confirmText={isDeleting ? 'กำลังลบ...' : 'ยืนยันการลบ'}
          confirmButtonColor="red"
          isConfirmDisabled={isDeleting || !deleteReason.trim()}
          isConfirmLoading={isDeleting}
        />
      </AppModal>

    </div>
  )
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsContent />
    </Suspense>
  )
}

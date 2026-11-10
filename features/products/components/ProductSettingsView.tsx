'use client'

import React, { useState, useMemo } from 'react'
import { Plus, Edit2, Trash2, Check, X, RotateCcw } from 'lucide-react'
import { useDataActions } from '@/components/common/useDataActions'
import {
  ActionButton,
  COMMAND_BUTTON_SIZE_CLASSES,
  TABLE_TOOLBAR_CLASSES,
} from '@/components/common/ActionButton'
import { DataTableFrame } from '@/components/common/DataTableFrame'
import { CustomSelect } from '@/components/common/CustomSelect'
import {
  ProductCategoryItem,
  CategoryCompositeRule,
  CalculationType,
  CALCULATION_OPTIONS,
  loadAllCategories,
  addCategoryAsync as addCategory,
  updateCategoryAsync as updateCategory,
  deleteCategoryAsync as deleteCategory,
  setCategoryActiveAsync as setCategoryActive,
  loadCompositeRules,
  addCompositeRuleAsync as addCompositeRule,
  updateCompositeRuleAsync as updateCompositeRule,
  ProductCategoryRule,
} from '@/lib/category-rules-storage'
import {
  Unit,
  addUnitAsync as addUnit,
  updateUnitAsync as updateUnit,
  deleteUnitAsync as deleteUnit,
  setUnitActiveAsync as setUnitActive,
} from '@/lib/unit-storage'
import { Product } from '@/lib/types/rental-pos'
import {
  sortCategoryNames,
  getCategoryListItems,
  addCategoryListItemAsync,
  renameCategoryListItemAsync,
  deleteCategoryListItemAsync,
} from '@/features/products/utils/list-items'

/** Tag after the name of a suspended (ระงับ) category or unit. */
const SUSPENDED_PILL =
  'ml-1.5 inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'

interface ProductSettingsViewProps {
  categories?: ProductCategoryItem[]
  setCategories?: React.Dispatch<React.SetStateAction<ProductCategoryItem[]>>
  compositeRules?: CategoryCompositeRule[]
  setCompositeRules?: React.Dispatch<React.SetStateAction<CategoryCompositeRule[]>>
  masterUnits: Unit[]
  setMasterUnits: React.Dispatch<React.SetStateAction<Unit[]>>
  allProducts: Product[]
  onShowToast: (title: string, message: string, type: 'SUCCESS' | 'ERROR' | 'INFO') => void
  // Backward compatibility props
  categoryRules?: ProductCategoryRule[]
  setCategoryRules?: React.Dispatch<React.SetStateAction<ProductCategoryRule[]>>
}


export function ProductSettingsView({
  categories: propCategories,
  setCategories: propSetCategories,
  compositeRules: propCompositeRules,
  setCompositeRules: propSetCompositeRules,
  masterUnits,
  setMasterUnits,
  allProducts,
  onShowToast,
}: ProductSettingsViewProps) {
  // ─── Local State if not passed from parent ────────────────
  const [internalCategories, setInternalCategories] = useState<ProductCategoryItem[]>(() => loadAllCategories())
  const [internalCompositeRules, setInternalCompositeRules] = useState<CategoryCompositeRule[]>(() => loadCompositeRules())

  const categories = propCategories ?? internalCategories
  const setCategories = propSetCategories ?? setInternalCategories

  const compositeRules = propCompositeRules ?? internalCompositeRules
  const setCompositeRules = propSetCompositeRules ?? setInternalCompositeRules

  // ─── Table 1: Categories State ─────────────────────────────
  const [newCatName, setNewCatName] = useState('')
  const [catEditId, setCatEditId] = useState<string | null>(null)
  const [catEditName, setCatEditName] = useState('')
  const { deleteOrSuspend } = useDataActions()

  // ─── Table 2: Units State ──────────────────────────────────
  const [newUnitName, setNewUnitName] = useState('')
  const [unitEditId, setUnitEditId] = useState<string | null>(null)
  const [unitEditName, setUnitEditName] = useState('')

  // ─── ตารางเพิ่มรายการ State (owner 2026-11-02) ─────────────
  const [newItemCatId, setNewItemCatId] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [itemEditKey, setItemEditKey] = useState<string | null>(null)
  const [itemEditName, setItemEditName] = useState('')
  const [itemDeleteKey, setItemDeleteKey] = useState<string | null>(null)
  const [itemSaving, setItemSaving] = useState(false)
  // Bumped after each change: the items live in the shop settings cache, not in React state.
  const [itemsVersion, setItemsVersion] = useState(0)

  // ─── Table 3: Composite Rules State ────────────────────────
  const [isAddingCompositeRow, setIsAddingCompositeRow] = useState(false)
  const [newCompCategoryId, setNewCompCategoryId] = useState('')
  const [newCompCalcType, setNewCompCalcType] = useState<CalculationType>('PER_ROUND')
  const [newCompUnitId, setNewCompUnitId] = useState('')
  const [newCompListItem, setNewCompListItem] = useState('')

  const [compEditId, setCompEditId] = useState<string | null>(null)
  const [compEditCategoryId, setCompEditCategoryId] = useState('')
  const [compEditCalcType, setCompEditCalcType] = useState<CalculationType>('PER_ROUND')
  const [compEditUnitId, setCompEditUnitId] = useState('')

  // ─── Categories Handlers (ตาราง 1) ─────────────────────────
  const handleCategoryAdd = async () => {
    const trimmed = newCatName.trim()
    if (!trimmed) {
      onShowToast('กรุณาระบุชื่อหมวดหมู่', 'ชื่อหมวดหมู่ต้องไม่เป็นค่าว่าง', 'ERROR')
      return
    }

    try {
      const updated = await addCategory(trimmed)
      setCategories(updated)
      setNewCatName('')
      onShowToast('เพิ่มหมวดหมู่สำเร็จ', `เพิ่มหมวดหมู่ "${trimmed}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถเพิ่มหมวดหมู่ได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  const handleCategoryStartEdit = (cat: ProductCategoryItem) => {
    setCatEditId(cat.id)
    setCatEditName(cat.name)
  }

  const handleCategorySaveEdit = async (id: string) => {
    const trimmed = catEditName.trim()
    if (!trimmed) {
      onShowToast('กรุณาระบุชื่อหมวดหมู่', 'ชื่อหมวดหมู่ต้องไม่เป็นค่าว่าง', 'ERROR')
      return
    }

    try {
      const updated = await updateCategory(id, trimmed)
      setCategories(updated)
      setCatEditId(null)
      setCatEditName('')
      onShowToast('แก้ไขหมวดหมู่สำเร็จ', `อัปเดต "${trimmed}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถแก้ไขหมวดหมู่ได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  // ลบถาวร: only products hold a category back (the server counts them). Every category has its own
  // default row in ตาราง 3, so those rows are not a reason to refuse (they go with the category).
  const handleCategoryDelete = async (cat: ProductCategoryItem) => {
    setCatEditId(null)
    try {
      const outcome = await deleteOrSuspend({
        name: `หมวดหมู่ "${cat.name}"`,
        usedIn: 'สินค้า',
        remove: async () => setCategories(await deleteCategory(cat.id)),
        suspend: cat.isActive === false ? undefined : async () => setCategories(await setCategoryActive(cat.id, false)),
      })
      if (outcome === 'deleted') onShowToast('ลบหมวดหมู่สำเร็จ', `ลบหมวดหมู่ "${cat.name}" ออกจากระบบแล้ว`, 'SUCCESS')
      if (outcome === 'suspended') onShowToast('ระงับหมวดหมู่แล้ว', `"${cat.name}" ไม่แสดงให้เลือกในงานใหม่แล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถลบหมวดหมู่ได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  const handleCategoryReactivate = async (cat: ProductCategoryItem) => {
    try {
      setCategories(await setCategoryActive(cat.id, true))
      onShowToast('เปิดใช้งานหมวดหมู่แล้ว', `"${cat.name}" กลับมาให้เลือกได้แล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('เปิดใช้งานหมวดหมู่ไม่สำเร็จ', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  // ─── Units Handlers (ตาราง 2) ──────────────────────────────
  const handleUnitAdd = async () => {
    const trimmed = newUnitName.trim()
    if (!trimmed) {
      onShowToast('กรุณาระบุชื่อหน่วยนับ', 'ชื่อหน่วยนับต้องไม่ว่าง', 'ERROR')
      return
    }

    try {
      const updated = await addUnit(trimmed)
      setMasterUnits(updated)
      setNewUnitName('')
      onShowToast('เพิ่มหน่วยนับสำเร็จ', `เพิ่มหน่วยนับ "${trimmed}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถเพิ่มหน่วยนับได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  const handleUnitStartEdit = (unit: Unit) => {
    setUnitEditId(unit.id)
    setUnitEditName(unit.name)
  }

  const handleUnitSaveEdit = async (id: string) => {
    const trimmed = unitEditName.trim()
    if (!trimmed) {
      onShowToast('กรุณาระบุชื่อหน่วยนับ', 'ชื่อหน่วยนับต้องไม่ว่าง', 'ERROR')
      return
    }

    try {
      const updated = await updateUnit(id, trimmed)
      setMasterUnits(updated)
      setUnitEditId(null)
      setUnitEditName('')
      onShowToast('แก้ไขหน่วยนับสำเร็จ', `อัปเดตหน่วยนับ "${trimmed}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถแก้ไขหน่วยนับได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  // ลบถาวร: products (counted by the server) and rows of ตาราง 3 (shop settings) hold a unit back.
  const handleUnitDelete = async (unit: Unit) => {
    setUnitEditId(null)
    const settingsUses = compositeRules.filter((r) => r.unitId === unit.id).length
    try {
      const outcome = await deleteOrSuspend({
        name: `หน่วยนับ "${unit.name}"`,
        usedIn: settingsUses > 0 ? 'ตารางประกอบข้อมูล' : 'สินค้า',
        remove: async () => setMasterUnits(await deleteUnit(unit.id, settingsUses)),
        suspend: unit.isActive === false ? undefined : async () => setMasterUnits(await setUnitActive(unit.id, false)),
      })
      if (outcome === 'deleted') onShowToast('ลบหน่วยนับสำเร็จ', `ลบหน่วยนับ "${unit.name}" ออกจากระบบแล้ว`, 'SUCCESS')
      if (outcome === 'suspended') onShowToast('ระงับหน่วยนับแล้ว', `"${unit.name}" ไม่แสดงให้เลือกในงานใหม่แล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถลบหน่วยนับได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  const handleUnitReactivate = async (unit: Unit) => {
    try {
      setMasterUnits(await setUnitActive(unit.id, true))
      onShowToast('เปิดใช้งานหน่วยนับแล้ว', `"${unit.name}" กลับมาให้เลือกได้แล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('เปิดใช้งานหน่วยนับไม่สำเร็จ', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  // ─── ตารางเพิ่มรายการ Handlers ─────────────────────────────
  type ListItemRow = { categoryId: string; categoryName: string; name: string }
  const listItemRows = useMemo<ListItemRow[]>(() => {
    void itemsVersion
    // Grouped per category (แบบคาน แบบเสา แบบข้าง นั่งร้าน อื่นๆ first); picking a category in the
    // toolbar shows only that category's items (owner 2026-11-02).
    const order = sortCategoryNames(categories.map((c) => c.name))
    const sorted = [...categories].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    return sorted
      .filter((c) => !newItemCatId || c.id === newItemCatId)
      .flatMap((c) => getCategoryListItems(c.id).map((i) => ({ categoryId: c.id, categoryName: c.name, name: i.name })))
  }, [categories, itemsVersion, newItemCatId])

  const listItemInUse = (row: ListItemRow) =>
    allProducts.some((p) => (p.categoryId === row.categoryId || p.category === row.categoryName) && p.listItem === row.name)

  const afterListItemChange = () => {
    setItemsVersion((v) => v + 1)
    // Item rows of ตารางประกอบข้อมูล follow the item list.
    setCompositeRules(loadCompositeRules())
  }

  const handleListItemAdd = async () => {
    if (itemSaving) return
    const trimmed = newItemName.trim()
    if (!newItemCatId || !trimmed) return
    setItemSaving(true)
    try {
      await addCategoryListItemAsync(newItemCatId, trimmed)
      setNewItemName('')
      afterListItemChange()
      onShowToast('เพิ่มรายการสำเร็จ', `เพิ่ม "${trimmed}" ในหมวดหมู่ ${getCategoryName(newItemCatId)} แล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถเพิ่มรายการได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setItemSaving(false)
    }
  }

  const handleListItemSaveEdit = async (row: ListItemRow) => {
    if (itemSaving) return
    setItemSaving(true)
    try {
      await renameCategoryListItemAsync(row.categoryId, row.name, itemEditName, listItemInUse(row))
      setItemEditKey(null)
      afterListItemChange()
      onShowToast('แก้ไขรายการสำเร็จ', `อัปเดต "${itemEditName.trim()}" เรียบร้อยแล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถแก้ไขรายการได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setItemSaving(false)
    }
  }

  const handleListItemDelete = async (row: ListItemRow) => {
    if (itemSaving) return
    setItemSaving(true)
    try {
      await deleteCategoryListItemAsync(row.categoryId, row.name, listItemInUse(row))
      afterListItemChange()
      onShowToast('ลบรายการสำเร็จ', `ลบ "${row.name}" ออกจากหมวดหมู่ ${row.categoryName} แล้ว`, 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถลบรายการได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setItemDeleteKey(null)
      setItemSaving(false)
    }
  }

  // ─── Composite Rules Handlers (ตาราง 3) ────────────────────
  const handleStartAddCompositeRow = () => {
    const defaultCatId = categories[0]?.id || ''
    setNewCompCategoryId(defaultCatId)
    setNewCompCalcType('PER_ROUND')
    setNewCompUnitId('')
    setNewCompListItem('')
    setIsAddingCompositeRow(true)
    setCompEditId(null)
  }

  const [compositeSaving, setCompositeSaving] = useState(false)
  const handleSaveAddCompositeRow = async () => {
    if (compositeSaving) return
    if (!newCompCategoryId) {
      onShowToast('กรุณาเลือกหมวดหมู่', 'ต้องเลือกหมวดหมู่สินค้าสำหรับแถวนี้', 'ERROR')
      return
    }

    setCompositeSaving(true)
    try {
      const updated = await addCompositeRule({
        categoryId: newCompCategoryId,
        listItem: newCompListItem || undefined,
        calculationType: newCompCalcType,
        unitId: newCompUnitId || undefined,
      })
      setCompositeRules(updated)
      setIsAddingCompositeRow(false)
      onShowToast('เพิ่มข้อมูลประกอบสำเร็จ', 'เพิ่มรายการในตารางประกอบข้อมูลเรียบร้อยแล้ว', 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถเพิ่มข้อมูลประกอบได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    } finally {
      setCompositeSaving(false)
    }
  }

  const handleStartEditCompositeRow = (rule: CategoryCompositeRule) => {
    setCompEditId(rule.id)
    setCompEditCategoryId(rule.categoryId)
    setCompEditCalcType(rule.calculationType)
    setCompEditUnitId(rule.unitId || '')
    setIsAddingCompositeRow(false)
  }

  const handleSaveEditCompositeRow = async (id: string) => {
    if (!compEditCategoryId) {
      onShowToast('กรุณาเลือกหมวดหมู่', 'ต้องเลือกหมวดหมู่สินค้า', 'ERROR')
      return
    }

    try {
      const updated = await updateCompositeRule({
        id,
        categoryId: compEditCategoryId,
        // An item row stays the same รายการ; only its pricing type / unit change.
        listItem: compositeRules.find((r) => r.id === id)?.listItem,
        calculationType: compEditCalcType,
        unitId: compEditUnitId || undefined,
      })
      setCompositeRules(updated)
      setCompEditId(null)
      onShowToast('บันทึกข้อมูลประกอบสำเร็จ', 'อัปเดตข้อมูลประกอบเรียบร้อยแล้ว', 'SUCCESS')
    } catch (err: any) {
      onShowToast('ไม่สามารถบันทึกข้อมูลประกอบได้', err?.message || 'เกิดข้อผิดพลาด', 'ERROR')
    }
  }

  // ─── Calculation Options Helper ────────────────────────────
  const calcOptions = useMemo(
    () =>
      CALCULATION_OPTIONS.map((opt) => ({
        value: opt.type,
        label: opt.label,
      })),
    []
  )

  const activeUnits = useMemo(() => masterUnits.filter((u) => u.isActive), [masterUnits])

  const unitOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [{ value: '', label: '-- ไม่ระบุ --' }]
    for (const u of activeUnits) {
      list.push({ value: u.id, label: u.name })
    }
    return list
  }, [activeUnits])

  const categoryOptions = useMemo(() => {
    return categories.map((c) => ({
      value: c.id,
      label: c.name,
    }))
  }, [categories])

  const getCategoryName = (id: string) => {
    const found = categories.find((c) => c.id === id)
    return found ? found.name : '-'
  }

  const getCalcLabel = (type: CalculationType) => {
    const found = CALCULATION_OPTIONS.find((c) => c.type === type)
    return found ? found.label : type
  }

  const getUnitName = (id?: string) => {
    if (!id) return '-'
    const found = masterUnits.find((u) => u.id === id)
    return found ? found.name : '-'
  }

  // No pages: each table scrolls inside its frame (sticky header) when rows exceed the space.
  const paginatedCats = categories
  const paginatedUnits = masterUnits
  const paginatedComp = compositeRules

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden p-2.5 sm:p-3 text-xs">
      {/* หมวดหมู่ | รายการ | หน่วยนับ: always side by side, equal width, every screen size (owner 2026-11-02) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 flex-1 min-h-0">
        {/* ==================================================== */}
        {/* ตารางที่ 1: หมวดหมู่สินค้า */}
        {/* ==================================================== */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden min-w-0 min-h-0">
          {/* Table Toolbar */}
          <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center min-w-0`}>
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCategoryAdd())}
              placeholder="ชื่อหมวดหมู่ใหม่..."
              className="flex-1 min-w-0 h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
            />
            <ActionButton
              type="button"
              onClick={handleCategoryAdd}
              disabled={!newCatName.trim()}
              variant="primary"
              icon={<Plus />}
              className="shrink-0"
            >
              เพิ่มหมวดหมู่
            </ActionButton>
          </div>

          {/* Table Content */}
          <DataTableFrame fill className="flex-1 min-h-0 rounded-none bg-transparent">
            <table className="w-full text-center text-xs border-collapse table-fixed">
              <thead className="sticky top-0 z-10 bg-[#E3E3E3] dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-1 w-10 text-center border-r border-slate-200 dark:border-slate-700">
                    ลำดับ
                  </th>
                  <th className="py-2.5 px-1.5 text-center border-r border-slate-200 dark:border-slate-700">
                    หมวดหมู่
                  </th>
                  <th className="py-2.5 px-1 w-[4.5rem] text-center">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-slate-600 dark:text-slate-400 italic">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                ) : (
                  paginatedCats.map((cat, idx) => {
                    const globalIdx = idx + 1

                    if (catEditId === cat.id) {
                      return (
                        <tr key={cat.id} className="h-10 bg-amber-50/50 dark:bg-amber-950/20">
                          <td className="py-1 px-2 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {globalIdx}
                          </td>
                          <td className="py-1 px-2 text-center border-r border-slate-200 dark:border-slate-700">
                            <input
                              type="text"
                              value={catEditName}
                              onChange={(e) => setCatEditName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCategorySaveEdit(cat.id))}
                              className="w-full h-7 px-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-bold text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                              autoFocus
                            />
                          </td>
                          <td className="py-1 px-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleCategorySaveEdit(cat.id)}
                                className="w-7 h-7 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-center transition-colors cursor-pointer"
                                title="บันทึก"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setCatEditId(null)}
                                className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                                title="ยกเลิก"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    const suspended = cat.isActive === false
                    return (
                      <tr key={cat.id} className={`h-10 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${suspended ? 'opacity-60' : ''}`}>
                        <td className="py-1 px-2 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                          {globalIdx}
                        </td>
                        <td className="py-1 px-1.5 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate" title={cat.name}>
                          {cat.name}
                          {suspended && <span className={SUSPENDED_PILL}>ระงับ</span>}
                        </td>
                        <td className="py-1 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleCategoryStartEdit(cat)}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              title="แก้ไข"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {suspended ? (
                              <button
                                type="button"
                                onClick={() => void handleCategoryReactivate(cat)}
                                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                                title="เปิดใช้งาน"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleCategoryDelete(cat)}
                                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                title="ลบ"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}

              </tbody>
            </table>
          </DataTableFrame>
        </div>

        {/* ==================================================== */}
        {/* ตารางเพิ่มรายการ (owner 2026-11-02): รายการ inside a category */}
        {/* ==================================================== */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden min-w-0 min-h-0">
          {/* Table Toolbar: หมวดหมู่ that receives the item · item name · เพิ่ม */}
          <div className={`${TABLE_TOOLBAR_CLASSES} flex flex-wrap xl:flex-nowrap items-center min-w-0`}>
            <div className="w-full xl:w-28 shrink-0 min-w-0">
              <CustomSelect
                value={newItemCatId}
                onChange={(val) => setNewItemCatId(String(val))}
                options={[{ value: '', label: 'ทุกหมวดหมู่' }, ...categoryOptions]}
                placeholder="หมวดหมู่"
                className="w-full"
                buttonClassName="h-8 px-2 text-xs font-semibold rounded-xl justify-between"
              />
            </div>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleListItemAdd())}
              placeholder="ชื่อรายการใหม่..."
              className="flex-1 min-w-0 h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
            />
            <ActionButton
              type="button"
              onClick={handleListItemAdd}
              disabled={!newItemCatId || !newItemName.trim() || itemSaving}
              variant="primary"
              icon={<Plus />}
              className="shrink-0"
            >
              เพิ่ม
            </ActionButton>
          </div>

          {/* Table Content */}
          <DataTableFrame fill className="flex-1 min-h-0 rounded-none bg-transparent">
            <table className="w-full text-center text-xs border-collapse table-fixed">
              <thead className="sticky top-0 z-10 bg-[#E3E3E3] dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-1 w-10 text-center border-r border-slate-200 dark:border-slate-700">
                    ลำดับ
                  </th>
                  <th className="py-2.5 px-2 text-center border-r border-slate-200 dark:border-slate-700">
                    หมวดหมู่
                  </th>
                  <th className="py-2.5 px-2 text-center border-r border-slate-200 dark:border-slate-700">
                    รายการ
                  </th>
                  <th className="py-2.5 px-1 w-[4.5rem] text-center">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {listItemRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-600 dark:text-slate-400 italic">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                ) : (
                  listItemRows.map((row, idx) => {
                    const key = `${row.categoryId}::${row.name}`

                    if (itemEditKey === key) {
                      return (
                        <tr key={key} className="h-10 bg-amber-50/50 dark:bg-amber-950/20">
                          <td className="py-1 px-1 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {idx + 1}
                          </td>
                          <td className="py-1 px-2 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate">
                            {row.categoryName}
                          </td>
                          <td className="py-1 px-1.5 text-center border-r border-slate-200 dark:border-slate-700">
                            <input
                              type="text"
                              value={itemEditName}
                              onChange={(e) => setItemEditName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleListItemSaveEdit(row))}
                              className="w-full h-7 px-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-bold text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                              autoFocus
                            />
                          </td>
                          <td className="py-1 px-1 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleListItemSaveEdit(row)}
                                disabled={itemSaving}
                                className="w-7 h-7 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-center transition-colors cursor-pointer"
                                title="บันทึก"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setItemEditKey(null)}
                                className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                                title="ยกเลิก"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    if (itemDeleteKey === key) {
                      return (
                        <tr key={key} className="h-10 bg-red-50/60 dark:bg-red-950/30">
                          <td colSpan={3} className="py-1 px-2 text-center text-red-700 dark:text-red-400 font-bold text-xs truncate">
                            ยืนยันลบรายการ &quot;{row.name}&quot;?
                          </td>
                          <td className="py-1 px-1 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleListItemDelete(row)}
                                disabled={itemSaving}
                                className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-red-600 hover:bg-red-700 text-white cursor-pointer transition-colors shadow-2xs`}
                              >
                                ลบ
                              </button>
                              <button
                                type="button"
                                onClick={() => setItemDeleteKey(null)}
                                className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors`}
                              >
                                ยกเลิก
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={key} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-1 px-1 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                          {idx + 1}
                        </td>
                        <td className="py-1 px-2 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate">
                          {row.categoryName}
                        </td>
                        <td className="py-1 px-2 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate" title={row.name}>
                          {row.name}
                        </td>
                        <td className="py-1 px-1 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setItemEditKey(key)
                                setItemEditName(row.name)
                                setItemDeleteKey(null)
                              }}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              title="แก้ไข"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setItemDeleteKey(key)
                                setItemEditKey(null)
                              }}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                              title="ลบ"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </DataTableFrame>
        </div>

        {/* ==================================================== */}
        {/* ตารางที่ 2: หน่วยนับ */}
        {/* ==================================================== */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden min-w-0 min-h-0">
          {/* Table Toolbar */}
          <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center min-w-0`}>
            <input
              type="text"
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleUnitAdd())}
              placeholder="ชื่อหน่วยนับใหม่..."
              className="flex-1 min-w-0 h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
            />
            <ActionButton
              type="button"
              onClick={handleUnitAdd}
              disabled={!newUnitName.trim()}
              variant="primary"
              icon={<Plus />}
              className="shrink-0"
            >
              เพิ่มหน่วยนับ
            </ActionButton>
          </div>

          {/* Table Content */}
          <DataTableFrame fill className="flex-1 min-h-0 rounded-none bg-transparent">
            <table className="w-full text-center text-xs border-collapse table-fixed">
              <thead className="sticky top-0 z-10 bg-[#E3E3E3] dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-1 w-10 text-center border-r border-slate-200 dark:border-slate-700">
                    ลำดับ
                  </th>
                  <th className="py-2.5 px-1.5 text-center border-r border-slate-200 dark:border-slate-700">
                    หน่วยนับ
                  </th>
                  <th className="py-2.5 px-1 w-[4.5rem] text-center">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {masterUnits.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-slate-600 dark:text-slate-400 italic">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                ) : (
                  paginatedUnits.map((u, idx) => {
                    const globalIdx = idx + 1

                    if (unitEditId === u.id) {
                      return (
                        <tr key={u.id} className="h-10 bg-amber-50/50 dark:bg-amber-950/20">
                          <td className="py-1 px-2 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {globalIdx}
                          </td>
                          <td className="py-1 px-2 text-center border-r border-slate-200 dark:border-slate-700">
                            <input
                              type="text"
                              value={unitEditName}
                              onChange={(e) => setUnitEditName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleUnitSaveEdit(u.id))}
                              className="w-full h-7 px-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-bold text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                              autoFocus
                            />
                          </td>
                          <td className="py-1 px-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleUnitSaveEdit(u.id)}
                                className="w-7 h-7 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-center transition-colors cursor-pointer"
                                title="บันทึก"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setUnitEditId(null)}
                                className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                                title="ยกเลิก"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    const suspended = u.isActive === false
                    return (
                      <tr key={u.id} className={`h-10 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${suspended ? 'opacity-60' : ''}`}>
                        <td className="py-1 px-2 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                          {globalIdx}
                        </td>
                        <td className="py-1 px-1.5 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate" title={u.name}>
                          {u.name}
                          {suspended && <span className={SUSPENDED_PILL}>ระงับ</span>}
                        </td>
                        <td className="py-1 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleUnitStartEdit(u)}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              title="แก้ไข"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {suspended ? (
                              <button
                                type="button"
                                onClick={() => void handleUnitReactivate(u)}
                                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors cursor-pointer"
                                title="เปิดใช้งาน"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleUnitDelete(u)}
                                className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                title="ลบ"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}

              </tbody>
            </table>
          </DataTableFrame>
        </div>
      </div>

      {/* ==================================================== */}
      {/* ตารางที่ 3: ตารางประกอบข้อมูล (Full Width Below) */}
      {/* ==================================================== */}
      {/* Table 3: | ลำดับ | หมวดหมู่ | รายการ | วิธีคิดเงิน | หน่วยนับ | จัดการ | — only fills the add-product form, every value stays changeable there */}
      {/* owner 2026-11-07: one card like the three small tables — title + green [เพิ่มแถว] in its top bar, no bottom bar */}
      <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className={`${TABLE_TOOLBAR_CLASSES} flex items-center justify-between min-w-0`}>
          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 truncate">ตารางประกอบข้อมูล</h3>
          <ActionButton
            type="button"
            onClick={handleStartAddCompositeRow}
            disabled={isAddingCompositeRow || categories.length === 0}
            variant="primary"
            icon={<Plus />}
            className="shrink-0"
          >
            เพิ่มแถว
          </ActionButton>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
            <table className="w-full text-center text-xs border-collapse table-fixed">
              <thead className="sticky top-0 z-10 bg-[#E3E3E3] dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-1 w-12 text-center border-r border-slate-200 dark:border-slate-700">
                    ลำดับ
                  </th>
                  <th className="py-2.5 px-2 w-[22%] text-center border-r border-slate-200 dark:border-slate-700">
                    หมวดหมู่
                  </th>
                  <th className="py-2.5 px-2 w-[22%] text-center border-r border-slate-200 dark:border-slate-700">
                    รายการ
                  </th>
                  <th className="py-2.5 px-3 text-center border-r border-slate-200 dark:border-slate-700">
                    วิธีคิดเงิน
                  </th>
                  <th className="py-2.5 px-2 w-[18%] text-center border-r border-slate-200 dark:border-slate-700">
                    หน่วยนับ
                  </th>
                  <th className="py-2.5 px-1 w-16 text-center">
                    จัดการ
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {/* แถวสำหรับเพิ่มใหม่ (เพิ่มแถว) */}
                {isAddingCompositeRow && (
                  <tr className="h-11 bg-emerald-50/60 dark:bg-emerald-950/20">
                    <td className="py-1 px-2 text-center font-bold text-emerald-700 dark:text-emerald-400 border-r border-slate-200 dark:border-slate-700">
                      +
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                      <CustomSelect
                        value={newCompCategoryId}
                        onChange={(val) => {
                          setNewCompCategoryId(String(val))
                          setNewCompListItem('')
                        }}
                        options={categoryOptions}
                        placeholder="-- เลือกหมวดหมู่ --"
                        className="w-full"
                        buttonClassName="h-7 text-xs font-bold justify-between"
                      />
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                      <CustomSelect
                        value={newCompListItem}
                        onChange={(val) => setNewCompListItem(String(val))}
                        options={[
                          { value: '', label: 'ทั้งหมวดหมู่' },
                          ...getCategoryListItems(newCompCategoryId).map((i) => ({ value: i.name, label: i.name })),
                        ]}
                        className="w-full"
                        buttonClassName="h-7 text-xs font-bold justify-between"
                      />
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                      <CustomSelect
                        value={newCompCalcType}
                        onChange={(val) => setNewCompCalcType(val as CalculationType)}
                        options={calcOptions}
                        className="w-full"
                        buttonClassName="h-7 text-xs font-bold justify-between"
                      />
                    </td>
                    <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                      <CustomSelect
                        value={newCompUnitId}
                        onChange={(val) => setNewCompUnitId(String(val))}
                        options={unitOptions}
                        placeholder="-- ไม่ระบุ --"
                        className="w-full"
                        buttonClassName="h-7 text-xs font-bold justify-between"
                      />
                    </td>
                    <td className="py-1 px-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleSaveAddCompositeRow}
                          disabled={compositeSaving}
                          className="w-7 h-7 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center justify-center transition-colors cursor-pointer"
                          title="บันทึก"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAddingCompositeRow(false)}
                          className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                          title="ยกเลิก"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {compositeRules.length === 0 && !isAddingCompositeRow ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-600 dark:text-slate-400 italic">
                      ยังไม่มีรายการ
                    </td>
                  </tr>
                ) : (
                  paginatedComp.map((rule, idx) => {
                    const globalIdx = idx + 1

                    if (compEditId === rule.id) {
                      return (
                        <tr key={rule.id} className="h-11 bg-amber-50/50 dark:bg-amber-950/20">
                          <td className="py-1 px-2 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                            {globalIdx}
                          </td>
                          <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                            {rule.listItem ? (
                              <span className="font-bold text-slate-800 dark:text-slate-200 truncate block">{getCategoryName(rule.categoryId)}</span>
                            ) : (
                              <CustomSelect
                                value={compEditCategoryId}
                                onChange={(val) => setCompEditCategoryId(String(val))}
                                options={categoryOptions}
                                placeholder="-- เลือกหมวดหมู่ --"
                                className="w-full"
                                buttonClassName="h-7 text-xs font-bold justify-between"
                              />
                            )}
                          </td>
                          <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-200 truncate">
                            {rule.listItem || 'ทั้งหมวดหมู่'}
                          </td>
                          <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                            <CustomSelect
                              value={compEditCalcType}
                              onChange={(val) => setCompEditCalcType(val as CalculationType)}
                              options={calcOptions}
                              className="w-full"
                              buttonClassName="h-7 text-xs font-bold justify-between"
                            />
                          </td>
                          <td className="py-1 px-2 border-r border-slate-200 dark:border-slate-700">
                            <CustomSelect
                              value={compEditUnitId}
                              onChange={(val) => setCompEditUnitId(String(val))}
                              options={unitOptions}
                              placeholder="-- ไม่ระบุ --"
                              className="w-full"
                              buttonClassName="h-7 text-xs font-bold justify-between"
                            />
                          </td>
                          <td className="py-1 px-2 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSaveEditCompositeRow(rule.id)}
                                className="w-7 h-7 rounded-lg text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center justify-center transition-colors cursor-pointer"
                                title="บันทึก"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setCompEditId(null)}
                                className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                                title="ยกเลิก"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    }

                    return (
                      <tr key={rule.id} className="h-10 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-1 px-2 text-center font-bold text-slate-600 dark:text-slate-400 border-r border-slate-200 dark:border-slate-700">
                          {globalIdx}
                        </td>
                        <td className="py-1 px-3 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate">
                          {getCategoryName(rule.categoryId)}
                        </td>
                        <td className="py-1 px-3 text-center font-bold text-slate-800 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate" title={rule.listItem || undefined}>
                          {rule.listItem || <span className="text-slate-600 dark:text-slate-400 font-normal text-[11px]">ทั้งหมวดหมู่</span>}
                        </td>
                        <td className="py-1 px-3 text-center font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700">
                          <span className={`px-2.5 py-0.5 rounded-lg font-bold text-[11px] ${
                            rule.calculationType === 'NO_CHARGE'
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                              : rule.calculationType === 'SALE'
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                              : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                          }`}>
                            {getCalcLabel(rule.calculationType)}
                          </span>
                        </td>
                        <td className="py-1 px-3 text-center font-semibold text-slate-700 dark:text-slate-300 border-r border-slate-200 dark:border-slate-700">
                          {rule.unitId ? (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px]">
                              {getUnitName(rule.unitId)}
                            </span>
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400 text-[11px] font-normal">
                              - (เลือกเอง)
                            </span>
                          )}
                        </td>
                        <td className="py-1 px-2 text-center">
                          {/* บันทึกแล้วแสดงเฉพาะปุ่มแก้ไข (ไม่มีปุ่มลบในตารางประกอบ) */}
                          <div className="flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => handleStartEditCompositeRow(rule)}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              title="แก้ไข"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}

              </tbody>
            </table>
          </div>

        </div>
      </div>
    </div>
  )
}

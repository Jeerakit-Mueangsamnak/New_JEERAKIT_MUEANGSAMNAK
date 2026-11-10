import React from 'react'
import {
  LayoutDashboard,
  ShoppingBag,
  Receipt,
  FileCheck2,
  Calendar,
  FileText,
  Users,
  Package,
  Wallet,
  BarChart3,
  Settings,
  ShieldCheck,
  Store,
  MessageCircle,
} from 'lucide-react'

// Pages that are not in the menu (menu pages are handled in getPageMeta below).
const EXTRA_PAGE_NAMES: Record<string, string> = {
  '/account': 'ตั้งค่าส่วนตัว',
}

export interface PageMeta {
  name: string
  icon: React.ComponentType<{ className?: string }>
  colorClass: string
  dotClass: string
}

export function getPageMeta(
  pathname: string,
  searchParams?: { get: (k: string) => string | null } | null
): PageMeta {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    const view = searchParams?.get('view')
    if (view === 'assets') return { name: 'ธุรกรรมสินทรัพย์', icon: LayoutDashboard, colorClass: 'text-emerald-700 dark:text-emerald-400', dotClass: 'bg-emerald-500' }
    if (view === 'stock') return { name: 'บริหารงานสต็อก', icon: Package, colorClass: 'text-amber-700 dark:text-amber-400', dotClass: 'bg-amber-500' }
    if (view === 'business') return { name: 'วิเคราะห์ธุรกิจ', icon: BarChart3, colorClass: 'text-indigo-700 dark:text-indigo-400', dotClass: 'bg-indigo-500' }
    return { name: 'แดชบอร์ด', icon: LayoutDashboard, colorClass: 'text-emerald-700 dark:text-emerald-400', dotClass: 'bg-emerald-500' }
  }

  if (pathname === '/reports' || pathname.startsWith('/reports/')) {
    const view = searchParams?.get('view')
    if (view === 'finance') return { name: 'การเงิน', icon: Wallet, colorClass: 'text-emerald-700 dark:text-emerald-400', dotClass: 'bg-emerald-500' }
    if (view === 'sales-rental') return { name: 'ขาย เช่า และเอกสาร', icon: Receipt, colorClass: 'text-blue-700 dark:text-blue-400', dotClass: 'bg-blue-500' }
    if (view === 'operations') return { name: 'งานปฏิบัติการ', icon: FileCheck2, colorClass: 'text-sky-700 dark:text-sky-400', dotClass: 'bg-sky-500' }
    if (view === 'stock') return { name: 'สต็อกและสินค้า', icon: Package, colorClass: 'text-amber-700 dark:text-amber-400', dotClass: 'bg-amber-500' }
    if (view === 'business') return { name: 'วิเคราะห์ธุรกิจ', icon: BarChart3, colorClass: 'text-indigo-700 dark:text-indigo-400', dotClass: 'bg-indigo-500' }
    return { name: 'รายงานสรุป', icon: BarChart3, colorClass: 'text-emerald-700 dark:text-emerald-400', dotClass: 'bg-emerald-500' }
  }

  if (pathname === '/finance' || pathname.startsWith('/finance/')) {
    return { name: 'การเงิน', icon: Wallet, colorClass: 'text-emerald-700 dark:text-emerald-400', dotClass: 'bg-emerald-500' }
  }
  if (pathname === '/pos' || pathname.startsWith('/pos/')) {
    return { name: 'หน้าร้าน POS', icon: ShoppingBag, colorClass: 'text-blue-700 dark:text-blue-400', dotClass: 'bg-blue-500' }
  }
  if (pathname === '/bills' || pathname.startsWith('/bills/')) {
    return { name: 'จัดการบิลเช่า', icon: Receipt, colorClass: 'text-indigo-700 dark:text-indigo-400', dotClass: 'bg-indigo-500' }
  }
  if (pathname === '/documents' || pathname.startsWith('/documents/')) {
    return { name: 'จัดการเอกสาร', icon: FileCheck2, colorClass: 'text-sky-700 dark:text-sky-400', dotClass: 'bg-sky-500' }
  }
  if (pathname === '/appointments' || pathname.startsWith('/appointments/')) {
    return { name: 'ปฏิทินนัดหมาย', icon: Calendar, colorClass: 'text-teal-700 dark:text-teal-400', dotClass: 'bg-teal-500' }
  }
  if (pathname === '/customers' || pathname.startsWith('/customers/')) {
    return { name: 'ข้อมูลลูกค้า', icon: Users, colorClass: 'text-purple-700 dark:text-purple-400', dotClass: 'bg-purple-500' }
  }
  if (pathname === '/products' || pathname.startsWith('/products/')) {
    return { name: 'สินค้า / สต็อก', icon: Package, colorClass: 'text-amber-700 dark:text-amber-400', dotClass: 'bg-amber-500' }
  }
  if (pathname === '/quotations' || pathname.startsWith('/quotations/')) {
    return { name: 'ใบเสนอราคา', icon: FileText, colorClass: 'text-violet-700 dark:text-violet-400', dotClass: 'bg-violet-500' }
  }
  if (pathname === '/line') {
    return { name: 'คนใน LINE', icon: MessageCircle, colorClass: 'text-emerald-700 dark:text-emerald-400', dotClass: 'bg-emerald-500' }
  }
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return { name: 'ตั้งค่า', icon: Settings, colorClass: 'text-slate-700 dark:text-slate-300', dotClass: 'bg-slate-500' }
  }
  if (pathname === '/owner-permissions' || pathname.startsWith('/owner-permissions/')) {
    return { name: 'จัดการสิทธิ์ & รายงาน', icon: ShieldCheck, colorClass: 'text-amber-700 dark:text-amber-400', dotClass: 'bg-amber-500' }
  }

  for (const [prefix, name] of Object.entries(EXTRA_PAGE_NAMES)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return { name, icon: Store, colorClass: 'text-slate-700 dark:text-slate-300', dotClass: 'bg-emerald-500' }
    }
  }
  return { name: 'ระบบ', icon: Store, colorClass: 'text-slate-700 dark:text-slate-300', dotClass: 'bg-emerald-500' }
}

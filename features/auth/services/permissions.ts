import type { CurrentUser, MemberStatus } from '@/lib/types/rental-pos'

/**
 * Menu access (Master v4.3.1 §4.2): OWNER opens everything; a USER opens only the menus the
 * OWNER granted, one by one. Free-style inside a menu — no approval steps; risky actions ask
 * for the user's own PIN instead (§4.4). Must match public.menu_catalog in
 * supabase/baseline/00_baseline.sql. The database (RLS + RPC _require_menu) is the real gate;
 * this copy only drives the sidebar, page guard and the OWNER member screen.
 */
export const MENU_CATALOG = [
  { code: 'dashboard', label: 'แดชบอร์ด', href: '/dashboard', ownerOnly: false },
  { code: 'reports', label: 'รายงานสรุป', href: '/reports', ownerOnly: false },
  { code: 'appointments', label: 'ปฏิทินนัดหมาย', href: '/appointments', ownerOnly: false },
  { code: 'pos', label: 'หน้าร้าน POS', href: '/pos', ownerOnly: false },
  { code: 'bills', label: 'จัดการบิลเช่า', href: '/bills', ownerOnly: false },
  { code: 'documents', label: 'จัดการเอกสาร', href: '/documents', ownerOnly: false },
  { code: 'customers', label: 'ข้อมูลลูกค้า', href: '/customers', ownerOnly: false },
  { code: 'products', label: 'สินค้า/สต็อก', href: '/products', ownerOnly: false },
  { code: 'quotations', label: 'ใบเสนอราคา', href: '/quotations', ownerOnly: false },
  { code: 'finance', label: 'การเงิน', href: '/finance', ownerOnly: false },
  // Shop settings are OWNER only (route, menu and settings_update on the server).
  { code: 'settings', label: 'ตั้งค่าระบบ', href: '/settings', ownerOnly: true },
  { code: 'members', label: 'จัดการสิทธิ์ & รายงาน', href: '/owner-permissions', ownerOnly: true },
] as const

export type MenuCode = (typeof MENU_CATALOG)[number]['code']

const MENU_CODES: ReadonlySet<string> = new Set(MENU_CATALOG.map((m) => m.code))

export function isMenuCode(value: unknown): value is MenuCode {
  return typeof value === 'string' && MENU_CODES.has(value)
}

/** Menus an OWNER may hand to a USER (owner-only menus are never granted). */
export const GRANTABLE_MENUS = MENU_CATALOG.filter((m) => !m.ownerOnly)

/** Starting set for front-counter staff; the OWNER adjusts it per person. */
export const POS_STAFF_PRESET: MenuCode[] = ['pos', 'bills', 'customers']

export const MEMBER_STATUSES: readonly MemberStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED']

export function normalizeMemberStatus(status: unknown, isApproved: unknown): MemberStatus {
  if (status === 'SUSPENDED') return 'SUSPENDED'
  if (status === 'ACTIVE' && isApproved === true) return 'ACTIVE'
  return 'PENDING'
}

type MenuSubject = Pick<CurrentUser, 'role' | 'status' | 'menus'> | null | undefined

export function isActiveMember(user: MenuSubject): boolean {
  return user?.status === 'ACTIVE'
}

/** Mirrors public.has_menu(): OWNER holds every menu; a USER only what was granted. */
export function hasMenu(user: MenuSubject, code: MenuCode): boolean {
  if (!user || !isActiveMember(user)) return false
  if (user.role === 'OWNER') return true
  const entry = MENU_CATALOG.find((m) => m.code === code)
  if (!entry || entry.ownerOnly) return false
  return user.menus.includes(code)
}

/** Which menu a page belongs to (longest href prefix), or null for pages open to every member. */
/** Pages every active member may open whatever menus they have (own PIN / account security). */
export const MENU_FREE_PATHS = ['/account', '/settings/security'] as const

export function menuForPath(pathname: string | null | undefined): MenuCode | null {
  if (!pathname) return null
  if (MENU_FREE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null
  let best: (typeof MENU_CATALOG)[number] | null = null
  for (const m of MENU_CATALOG) {
    if (pathname === m.href || pathname.startsWith(m.href + '/')) {
      if (!best || m.href.length > best.href.length) best = m
    }
  }
  return best?.code ?? null
}

/** First page a user may open (used when they land on a menu they do not have). */
export function firstAllowedHref(user: MenuSubject): string | null {
  const m = MENU_CATALOG.find((entry) => hasMenu(user, entry.code))
  return m ? m.href : null
}

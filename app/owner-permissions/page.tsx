'use client'

import { useAskText } from '@/components/common/ConfirmDialogProvider'
import { SETTINGS_HELPER, SETTINGS_INPUT, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import { ActionButton, TAB_BUTTON_ACTIVE_CLASSES, TAB_BUTTON_BASE_CLASSES, TAB_BUTTON_INACTIVE_CLASSES, TAB_CONTAINER_CLASSES } from '@/components/common/ActionButton'
import { DataTableFrame, DATA_TABLE_CLASSES } from '@/components/common/DataTableFrame'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShieldCheck,
  Users,
  Activity,
  CheckCircle2,
  AlertTriangle,
  UserX,
  RefreshCw,
  Search,
  Receipt,
  Package,
  FileSpreadsheet,
  Trash2,
  Lock,
  Save,
  X,
  FileText,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { CustomSelect, SelectOption } from '@/components/common/CustomSelect'
import { GRANTABLE_MENUS, POS_STAFF_PRESET } from '@/features/auth/services/permissions'
import { listMembers, resetMemberPin, setMemberMenus, setMemberRole, setMemberStatus } from '@/app/actions/members'
import { fetchAuditLogs } from '@/features/audits/services/audit-storage'

type ActivityLogCategory = 'BILL' | 'STOCK' | 'SYSTEM' | 'CUSTOMER' | 'MEMBER' | 'FINANCE'

interface BusinessMemberUser {
  id: string
  userId?: string
  businessId?: string
  role?: 'OWNER' | 'USER'
  status?: string
  menus?: string[]
  profile?: {
    id?: string
    username?: string
    fullName?: string
    avatarUrl?: string
    createdAt?: string
    email?: string
  }
}

interface UserActivityLog {
  id: string
  actorId?: string
  actorName?: string
  action: string
  details?: string
  category: string
  createdAt: string
  metadata?: Record<string, unknown>
}

// Menu access (Master v4.3.1 §4.2): the OWNER grants whole menus per person; same list as
// public.menu_catalog. Owner-only menus (member management) are never offered here.
const PERMISSION_MODULE_LABELS: Record<string, string> = { MENU: 'เมนูที่ผู้ใช้นี้เข้าได้' }

const PERMISSIONS_CATALOG: Array<{ code: string; label: string; module: string; description: string }> =
  GRANTABLE_MENUS.map((m) => ({ code: m.code, label: m.label, module: 'MENU', description: m.href }))


type ActiveTab = 'PERMISSIONS' | 'AUDIT_REPORT' | 'AUDIT_LOGS'
type AuditSubTab = ActivityLogCategory

const categoryNames: Record<AuditSubTab, string> = {
  BILL: 'รายงานตรวจสอบการจัดการบิล',
  CUSTOMER: 'รายงานตรวจสอบการจัดการลูกค้า',
  STOCK: 'รายงานตรวจสอบการจัดการสต็อก',
  MEMBER: 'รายงานตรวจสอบสิทธิ์และสมาชิก',
  FINANCE: 'รายงานตรวจสอบการเงินและบัญชี',
  SYSTEM: 'รายงานตรวจสอบระบบทั่วไป',
}

import { getCurrentUser } from '@/app/actions/auth'

export default function OwnerPermissionsPage() {
  // Member changes are audited and the database requires a reason (in-app dialog).
  const askText = useAskText()
  const askReason = (question: string) => askText({ title: question })
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; role: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    async function loadUser() {
      try {
        const currentUser = await getCurrentUser()
        if (currentUser) {
          setUser({ id: currentUser.userId, role: currentUser.role })
        } else {
          router.push('/login')
        }
      } catch (err) {
        console.error('Failed to load user', err)
      } finally {
        setAuthLoading(false)
      }
    }
    loadUser()
  }, [router])

  const [activeTab, setActiveTab] = useState<ActiveTab>('PERMISSIONS')
  const [auditSubTab, setAuditSubTab] = useState<AuditSubTab>('BILL')

  // Members state
  const [members, setMembers] = useState<BusinessMemberUser[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Audit Logs state
  const [logs, setLogs] = useState<UserActivityLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [selectedActorId, setSelectedActorId] = useState<string>('ALL')
  const [searchTerm, setSearchTerm] = useState('')

  // Toast / Feedback message
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Modal states for delete confirmation
  const [deleteConfirmMember, setDeleteConfirmMember] = useState<BusinessMemberUser | null>(null)

  // Granular Permission Modal states
  const [permModalMember, setPermModalMember] = useState<BusinessMemberUser | null>(null)
  const [selectedPermCodes, setSelectedPermCodes] = useState<string[]>([])
  const [savingPerms, setSavingPerms] = useState(false)

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ message, type })
    setTimeout(() => setFeedback(null), 4000)
  }

  // Load members
  const loadMembers = useCallback(async () => {
    setLoadingMembers(true)
    try {
      const result = await listMembers()
      if (!result.success || !result.data) {
        setFeedback({ message: result.error || 'โหลดรายชื่อผู้ใช้งานไม่สำเร็จ', type: 'error' })
        return
      }
      setMembers(
        result.data.map((m) => ({
          id: m.userId,
          userId: m.userId,
          role: m.role,
          status: m.status,
          menus: m.menus,
          profile: {
            id: m.userId,
            username: m.username,
            fullName: m.displayName,
            email: m.email,
            createdAt: m.createdAt || undefined,
          },
        }))
      )
    } finally {
      setLoadingMembers(false)
    }
  }, [])

  // Load audit logs
  // Audit trail written by the database (append-only, OWNER read only — Master §29).
  const loadLogs = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const rows = await fetchAuditLogs({ actorId: selectedActorId && selectedActorId !== 'ALL' ? selectedActorId : undefined, limit: 500 })
      setLogs(
        rows.map((r) => ({
          id: r.id,
          actorId: r.userId,
          actorName: r.displayName,
          action: r.action,
          details: [r.reason, r.amount != null ? `${r.amount} บาท` : '', r.quantity != null ? `จำนวน ${r.quantity}` : '', r.pinVerified ? 'ยืนยัน PIN' : '']
            .filter(Boolean)
            .join(' · '),
          category: r.entityType,
          createdAt: r.createdAt,
          metadata: { before: r.before, after: r.after, result: r.result },
        }))
      )
    } catch (err) {
      setFeedback({ message: err instanceof Error ? err.message : 'โหลดประวัติไม่สำเร็จ', type: 'error' })
    } finally {
      setLoadingLogs(false)
    }
  }, [selectedActorId])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  useEffect(() => {
    if (activeTab === 'AUDIT_REPORT' || activeTab === 'AUDIT_LOGS') {
      loadLogs()
    }
  }, [activeTab, auditSubTab, selectedActorId, loadLogs])

  // Member Actions: each one is checked, audited, and applied by the database RPC
  const runMemberAction = async (
    member: BusinessMemberUser,
    action: () => Promise<{ success: boolean; error?: string }>,
    successMessage: string
  ) => {
    setActionLoading(member.id)
    try {
      const result = await action()
      if (!result.success) {
        showNotification(result.error || 'ทำรายการไม่สำเร็จ', 'error')
        return
      }
      showNotification(successMessage)
      await loadMembers()
    } finally {
      setActionLoading(null)
    }
  }

  const handleApprove = async (member: BusinessMemberUser) => {
    const reason = await askReason('เหตุผลที่อนุมัติให้เข้าใช้งาน')
    if (!reason) return
    await runMemberAction(member, () => setMemberStatus(member.id, 'ACTIVE', reason), 'อนุมัติผู้ใช้งานแล้ว')
  }

  const handleSuspend = async (member: BusinessMemberUser) => {
    const reason = await askReason('เหตุผลที่ระงับการใช้งาน')
    if (!reason) return
    await runMemberAction(member, () => setMemberStatus(member.id, 'SUSPENDED', reason), 'ระงับการใช้งานแล้ว')
  }

  const handleRoleChange = async (member: BusinessMemberUser, newRole: string) => {
    if (newRole !== 'OWNER' && newRole !== 'USER') return
    const reason = await askReason(`เหตุผลที่เปลี่ยนระดับสิทธิ์เป็น ${newRole}`)
    if (!reason) return
    await runMemberAction(member, () => setMemberRole(member.id, newRole, reason), 'เปลี่ยนระดับสิทธิ์แล้ว')
  }

  // Forgotten / blocked PIN of a USER (Master §4.3): clear it; the member sets a new one at next use.
  const handleResetPin = async (member: BusinessMemberUser) => {
    const reason = await askReason('เหตุผลที่ล้าง PIN (เช่น ลืม PIN / PIN ถูกล็อก)')
    if (!reason) return
    await runMemberAction(member, () => resetMemberPin(member.id, reason), 'ล้าง PIN แล้ว — ผู้ใช้ตั้ง PIN ใหม่ได้เมื่อเข้าระบบ')
  }

  const handleDeleteMember = async () => {
    if (!deleteConfirmMember) return
    setDeleteConfirmMember(null)
    // Master §3.3: users with history are never hard-deleted
    showNotification('ลบผู้ใช้งานไม่ได้เพราะต้องเก็บประวัติการทำรายการ กรุณาใช้ "ระงับสิทธิ์" แทน', 'error')
  }

  const handleOpenPermissionsModal = (member: BusinessMemberUser) => {
    if (member.role === 'OWNER') {
      showNotification('เจ้าของร้านมีสิทธิ์ทั้งหมดโดยสมบูรณ์ ไม่จำเป็นต้องกำหนดสิทธิ์รายบุคคล', 'error')
      return
    }
    setPermModalMember(member)
    setSelectedPermCodes(member.menus || [])
  }

  const handleTogglePermission = (code: string) => {
    setSelectedPermCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    )
  }

  const handleSelectAllPerms = () => {
    setSelectedPermCodes(PERMISSIONS_CATALOG.map((p) => p.code))
  }

  const handleClearAllPerms = () => {
    setSelectedPermCodes([])
  }

  const handlePresetPosPerms = () => {
    setSelectedPermCodes([...POS_STAFF_PRESET])
  }

  const handleSavePermissions = async () => {
    if (!permModalMember) return
    const reason = await askReason('เหตุผลที่เปลี่ยนสิทธิ์การทำงาน')
    if (!reason) return
    setSavingPerms(true)
    try {
      const result = await setMemberMenus(permModalMember.id, selectedPermCodes, reason)
      if (!result.success) {
        showNotification(result.error || 'บันทึกสิทธิ์ไม่สำเร็จ', 'error')
        return
      }
      setPermModalMember(null)
      showNotification('บันทึกสิทธิ์แล้ว')
      await loadMembers()
    } finally {
      setSavingPerms(false)
    }
  }

  // Format dates helper
  const formatDateTime = (isoString?: string) => {
    if (!isoString) return '-'
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return '-'
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear() + 543
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${day}/${month}/${year} ${hours}:${minutes} น.`
  }

  // Export audit logs to Excel
  const handleExportAuditExcel = () => {
    if (logs.length === 0) {
      showNotification('ไม่มีข้อมูลสำหรับส่งออก', 'error')
      return
    }

    const exportData = logs.map((log, idx) => ({
      ลำดับ: idx + 1,
      การกระทำ: log.action,
      หมวดหมู่: categoryNames[auditSubTab] || log.category,
      รายละเอียด: log.details || '-',
      'วันที่-เวลา': formatDateTime(log.createdAt),
      ผู้ทำรายการ: log.actorName || '-',
    }))


    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(exportData)
    XLSX.utils.book_append_sheet(wb, ws, auditSubTab)
    const filename = `${categoryNames[auditSubTab]}_${new Date().toISOString().slice(0, 10)}.xlsx`
    XLSX.writeFile(wb, filename)
    showNotification('ส่งออกไฟล์ Excel สำเร็จ')
  }

  if (authLoading || (user && user.role !== 'OWNER')) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-white">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">กำลังตรวจสอบสิทธิ์เจ้าของร้าน...</p>
        </div>
      </div>
    )
  }

  const actorOptions: SelectOption[] = [
    { value: 'ALL', label: '👥 ดูพนักงานทุกคน (All Staff)' },
    ...members.map((m) => ({
      value: m.userId || m.id,
      label: `${m.profile?.fullName || m.profile?.username || 'ไม่ระบุชื่อ'} (${m.role || 'USER'})`,
    })),
  ]

  const auditSubTabs: Array<{ id: AuditSubTab; label: string; icon: React.ElementType }> = [
    { id: 'BILL', label: 'บิล', icon: Receipt },
    { id: 'CUSTOMER', label: 'ลูกค้า', icon: Users },
    { id: 'STOCK', label: 'สต็อก', icon: Package },
    { id: 'MEMBER', label: 'สิทธิ์และสมาชิก', icon: ShieldCheck },
    { id: 'FINANCE', label: 'การเงิน', icon: Activity },
    { id: 'SYSTEM', label: 'ระบบ', icon: Lock },
  ]

  const ownerBadge = (
    <span className="px-1.5 py-px rounded-full bg-emerald-50 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
      OWNER
    </span>
  )

  return (
    <div className="h-full min-h-0 p-2 gap-2 bg-slate-100 dark:bg-slate-900 flex flex-col overflow-hidden text-xs">
      {/* Main Workspace Card */}
      <div className="w-full flex-1 min-h-0 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
        {/* Top Tabs */}
        <div className="px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className={`${TAB_CONTAINER_CLASSES} w-full min-w-0`}>
            <button
              type="button"
              onClick={() => setActiveTab('PERMISSIONS')}
              className={`${TAB_BUTTON_BASE_CLASSES} flex-1 min-w-0 ${activeTab === 'PERMISSIONS' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate min-w-0">สิทธิ์ผู้ใช้งาน</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('AUDIT_REPORT')}
              className={`${TAB_BUTTON_BASE_CLASSES} flex-1 min-w-0 ${
                activeTab === 'AUDIT_REPORT' || (activeTab as string) === 'AUDIT_LOGS' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES
              }`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate min-w-0">ประวัติการทำรายการ (Audit Log)</span>
            </button>
          </div>
        </div>

        {/* Content (tables scroll inside their own frame) */}
        <div className="w-full flex-1 min-h-0 min-w-0 p-2 gap-2 flex flex-col overflow-hidden">
            {/* Feedback alert toast */}
            {feedback && (
              <div
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold animate-in fade-in slide-in-from-top-1 flex items-center gap-2 border ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/80 dark:border-emerald-500 dark:text-emerald-200'
                    : 'bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-950/80 dark:border-rose-500 dark:text-rose-200'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                )}
                <span>{feedback.message}</span>
              </div>
            )}

            {/* ================= TAB 1: PERMISSION MATRIX ================= */}
            {activeTab === 'PERMISSIONS' && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                {/* Section Header */}
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <h3 className={SETTINGS_SECTION_TITLE}>
                      <Users className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>สิทธิ์ผู้ใช้งาน</span>
                      {ownerBadge}
                    </h3>
                    <span className={SETTINGS_HELPER}>คนใหม่ต้องอนุมัติก่อนใช้งาน</span>
                  </div>
                  <ActionButton
                    size="sm"
                    variant="neutral"
                    onClick={loadMembers}
                    disabled={loadingMembers}
                    icon={<RefreshCw className={loadingMembers ? 'animate-spin' : ''} />}
                  >
                    รีเฟรช
                  </ActionButton>
                </div>

                {/* Members Table */}
                <DataTableFrame fill rowCount={loadingMembers ? undefined : members.length} className="flex-1 p-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <table className={`${DATA_TABLE_CLASSES} text-xs`}>
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs">
                          <th className="px-3">รหัสผู้ใช้</th>
                          <th className="px-3">ชื่อแสดงผล</th>
                          <th className="px-3">Username</th>
                          <th className="px-3 text-center">ระดับสิทธิ์</th>
                          <th className="px-3 text-center">สถานะ</th>
                          <th className="px-3">วันที่สร้าง</th>
                          <th className="px-3 text-right sticky right-0 bg-[#E3E3E3] dark:bg-slate-800">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium">
                        {loadingMembers ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400">
                              <div className="flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                                <span>กำลังโหลด...</span>
                              </div>
                            </td>
                          </tr>
                        ) : members.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">
                              ไม่พบผู้ใช้งาน
                            </td>
                          </tr>
                        ) : (
                          members.map((member) => {
                            const isSelf = member.userId === user?.id
                            const isPending = member.status !== 'ACTIVE'

                            return (
                              <tr
                                key={member.id}
                                className={`hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors ${
                                  isPending ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''
                                }`}
                              >
                                {/* 1. User UUID */}
                                <td className="px-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                  <span title={member.userId || '-'}>
                                    {member.userId ? `${member.userId.slice(0, 8)}…` : '-'}
                                  </span>
                                </td>

                                {/* 2. Full Name */}
                                <td className="px-3 font-bold text-slate-900 dark:text-slate-100">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 flex items-center justify-center text-[10px] font-bold">
                                      {member.profile?.fullName?.[0] || 'U'}
                                    </div>
                                    <span className="truncate">{member.profile?.fullName || 'ไม่ระบุชื่อ'}</span>
                                    {isSelf && (
                                      <span className="px-1 py-px rounded bg-blue-50 dark:bg-blue-500/20 border border-blue-200 dark:border-blue-500/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold">
                                        คุณ
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* 3. Username / Email */}
                                <td className="px-3 font-mono text-slate-600 dark:text-slate-300 text-[11px]">
                                  {member.profile?.username || member.profile?.email || '-'}
                                </td>

                                {/* 4. Role Selector */}
                                <td className="px-3 text-center">
                                  <select
                                    value={member.role}
                                    disabled={isSelf || member.role === 'OWNER' || actionLoading === member.id}
                                    onChange={(e) => handleRoleChange(member, e.target.value)}
                                    className="h-7 px-2 py-0 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-60 cursor-pointer"
                                  >
                                    <option value="OWNER">OWNER (เจ้าของร้าน)</option>
                                    <option value="USER">USER (พนักงาน)</option>
                                  </select>
                                </td>

                                {/* 5. Status Badge */}
                                <td className="px-3 text-center whitespace-nowrap">
                                  {member.status === 'ACTIVE' ? (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400"></span>
                                      Active
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse"></span>
                                      {member.status === 'SUSPENDED' ? 'ระงับอยู่' : 'รออนุมัติ'}
                                    </span>
                                  )}
                                </td>

                                {/* 6. Created */}
                                <td className="px-3 text-slate-500 dark:text-slate-400 text-[11px] font-mono whitespace-nowrap">
                                  {formatDateTime(member.profile?.createdAt)}
                                </td>

                                {/* 7. Action Buttons (pinned right so they stay visible on tablet widths) */}
                                <td className={`px-3 text-right sticky right-0 ${isPending ? 'bg-amber-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-800'}`}>
                                  <div className="flex items-center justify-end gap-1">
                                    {member.status !== 'ACTIVE' && (
                                      <ActionButton
                                        size="sm"
                                        variant="primary"
                                        disabled={actionLoading === member.id}
                                        onClick={() => handleApprove(member)}
                                        title="อนุมัติให้เข้าใช้งาน"
                                        icon={<CheckCircle2 />}
                                      >
                                        อนุมัติ
                                      </ActionButton>
                                    )}

                                    {member.role === 'USER' && member.status === 'ACTIVE' && (
                                      <ActionButton
                                        size="sm"
                                        onClick={() => handleOpenPermissionsModal(member)}
                                        className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-600/20 dark:hover:bg-indigo-600/30 border border-indigo-200 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300"
                                        title="กำหนดเมนูที่เข้าได้"
                                        icon={<ShieldCheck />}
                                      >
                                        เมนู ({member.menus?.length || 0})
                                      </ActionButton>
                                    )}

                                    {member.role === 'USER' && member.status === 'ACTIVE' && !isSelf && (
                                      <ActionButton
                                        size="sm"
                                        disabled={actionLoading === member.id}
                                        onClick={() => handleResetPin(member)}
                                        className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-600/20 border border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-300"
                                        title="ล้าง PIN ที่ลืมหรือถูกล็อก"
                                      >
                                        ล้าง PIN
                                      </ActionButton>
                                    )}

                                    {member.status === 'ACTIVE' && !isSelf && (
                                      <ActionButton
                                        size="sm"
                                        disabled={actionLoading === member.id}
                                        onClick={() => handleSuspend(member)}
                                        className="bg-amber-50 hover:bg-amber-100 dark:bg-amber-600/20 dark:hover:bg-amber-600/30 border border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-300"
                                        title="ระงับการใช้งานชั่วคราว"
                                        icon={<UserX />}
                                      >
                                        ระงับ
                                      </ActionButton>
                                    )}

                                    {!isSelf && (
                                      <ActionButton
                                        size="sm"
                                        variant="ghost"
                                        disabled={actionLoading === member.id}
                                        onClick={() => setDeleteConfirmMember(member)}
                                        className="px-1.5 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                        title="ลบผู้ใช้นี้ออกจากร้าน"
                                        icon={<Trash2 />}
                                      />
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
            )}

            {/* ================= TAB 2: AUDIT REPORT ================= */}
            {(activeTab === 'AUDIT_REPORT' || (activeTab as string) === 'AUDIT_LOGS') && (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                {/* Section Header */}
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <h3 className={SETTINGS_SECTION_TITLE}>
                      <Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>ประวัติการทำรายการ</span>
                      {ownerBadge}
                    </h3>
                    <span className={SETTINGS_HELPER}>ดูว่าใครทำอะไร เมื่อไร</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ActionButton
                      size="sm"
                      onClick={handleExportAuditExcel}
                      disabled={logs.length === 0}
                      className="bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-600/20 dark:hover:bg-emerald-600/30 border border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                      icon={<FileSpreadsheet />}
                    >
                      Export
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      variant="neutral"
                      onClick={loadLogs}
                      disabled={loadingLogs}
                      title="รีเฟรชประวัติ"
                      icon={<RefreshCw className={loadingLogs ? 'animate-spin' : ''} />}
                    >
                      รีเฟรช
                    </ActionButton>
                  </div>
                </div>

                {/* Filters + category tabs */}
                <div className="shrink-0 flex flex-col lg:flex-row lg:items-center gap-2">
                  <div className={`${TAB_CONTAINER_CLASSES} max-w-full`}>
                    {auditSubTabs.map((t) => {
                      const Icon = t.icon
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setAuditSubTab(t.id)}
                          className={`${TAB_BUTTON_BASE_CLASSES} px-2.5 ${auditSubTab === t.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span>{t.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1 min-w-0">
                    <CustomSelect
                      value={selectedActorId}
                      onChange={(val) => setSelectedActorId(String(val))}
                      options={actorOptions}
                      className="w-full"
                    />
                    <div className="relative">
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="ค้นหาเลขบิล, ลูกค้า, รหัสสินค้า..."
                        className={`${SETTINGS_INPUT} pl-8`}
                      />
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                </div>

                {/* Audit Table */}
                <DataTableFrame fill rowCount={logs.length} className="flex-1 p-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                    <table className={`${DATA_TABLE_CLASSES} text-xs`}>
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs">
                          <th className="px-3 w-12 text-center">#</th>
                          <th className="px-3 text-center">การกระทำ</th>
                          <th className="px-3">หมวดหมู่</th>
                          <th className="px-3">รายละเอียด</th>
                          <th className="px-3">วันที่-เวลา</th>
                          <th className="px-3 text-right">ผู้ทำรายการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium">
                        {loadingLogs ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                              <div className="flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                                <span>กำลังโหลด...</span>
                              </div>
                            </td>
                          </tr>
                        ) : logs.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">
                              ไม่พบประวัติในหมวดนี้
                            </td>
                          </tr>
                        ) : (
                          logs.map((log, idx) => (
                            <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors">
                              <td className="px-3 text-center text-slate-400 dark:text-slate-500 font-mono">
                                {idx + 1}
                              </td>

                              <td className="px-3 text-center">
                                <span
                                  className={`inline-block px-1.5 py-px rounded-full text-[10px] font-bold border whitespace-nowrap ${
                                    log.action.includes('ลบ') || log.action.includes('ยกเลิก')
                                      ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400'
                                      : log.action.includes('แก้ไข') || log.action.includes('ปรับ')
                                      ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400'
                                      : 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-400'
                                  }`}
                                >
                                  {log.action}
                                </span>
                              </td>

                              <td className="px-3 text-emerald-700 dark:text-emerald-400 font-bold text-[11px] whitespace-nowrap">
                                {categoryNames[auditSubTab] || log.category}
                              </td>

                              <td className="px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate" title={log.details}>
                                {log.details || '-'}
                              </td>

                              <td className="px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px] whitespace-nowrap">
                                {formatDateTime(log.createdAt)}
                              </td>

                              <td className="px-3 text-right font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {log.actorName || '-'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                </DataTableFrame>
              </div>
            )}
          </div>
        </div>

      {/* Delete User Modal Confirmation */}
      {deleteConfirmMember && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-rose-200 dark:border-rose-500/40 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div className="p-3 bg-rose-50 dark:bg-rose-500/20 rounded-xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base">ยืนยันการลบผู้ใช้งาน</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">การดำเนินการนี้ไม่สามารถเรียกคืนได้</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              คุณต้องการลบผู้ใช้งาน{' '}
              <strong className="text-slate-900 dark:text-white">
                {deleteConfirmMember.profile?.fullName || deleteConfirmMember.profile?.username}
              </strong>{' '}
              ออกจากร้านใช่หรือไม่? พนักงานคนนี้จะไม่สามารถล็อกอินเข้าสู่ระบบได้อีกต่อไป
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmMember(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleDeleteMember}
                className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 dark:hover:bg-rose-500 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                ยืนยันการลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Granular Permissions Modal */}
      {permModalMember && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 max-w-2xl w-full shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xl">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                    <span>กำหนดสิทธิ์การทำงาน: {permModalMember.profile?.fullName || permModalMember.profile?.username}</span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold">
                      {permModalMember.role}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    เลือกสิทธิ์ที่อนุญาตให้พนักงานเข้าถึงและดำเนินการในระบบ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPermModalMember(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Actions Bar */}
            <div className="py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 text-xs shrink-0">
              <span className="text-slate-500 dark:text-slate-400 font-medium">
                เลือกแล้ว <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{selectedPermCodes.length}</strong> จาก {PERMISSIONS_CATALOG.length} สิทธิ์
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePresetPosPerms}
                  className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold text-xs border border-emerald-200 dark:border-emerald-500/30 transition-colors cursor-pointer"
                >
                  ⚡ ชุดพนักงานขาย (POS)
                </button>
                <button
                  type="button"
                  onClick={handleSelectAllPerms}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
                >
                  เลือกทั้งหมด
                </button>
                <button
                  type="button"
                  onClick={handleClearAllPerms}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
                >
                  ล้างทั้งหมด
                </button>
              </div>
            </div>

            {/* Permissions List (Grouped by module) */}
            <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1">
              {Object.entries(PERMISSION_MODULE_LABELS).map(([moduleKey, moduleLabel]) => {
                const modulePerms = PERMISSIONS_CATALOG.filter((p) => p.module === moduleKey)
                if (modulePerms.length === 0) return null

                return (
                  <div key={moduleKey} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-3">
                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2 flex items-center justify-between">
                      <span>{moduleLabel}</span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {modulePerms.filter((p) => selectedPermCodes.includes(p.code)).length}/{modulePerms.length}
                      </span>
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {modulePerms.map((perm) => {
                        const isChecked = selectedPermCodes.includes(perm.code)
                        return (
                          <label
                            key={perm.code}
                            className={`flex items-start gap-2.5 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                              isChecked
                                ? 'bg-indigo-50/70 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-500/40 text-slate-900 dark:text-slate-100'
                                : 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleTogglePermission(perm.code)}
                              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div className="min-w-0">
                              <span className="font-bold block text-[11px] leading-snug">{perm.label}</span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug block">
                                {perm.description}
                              </span>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
              <button
                type="button"
                disabled={savingPerms}
                onClick={() => setPermModalMember(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={savingPerms}
                onClick={handleSavePermissions}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 dark:hover:bg-indigo-500 text-white text-xs font-bold shadow flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingPerms ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>กำลังบันทึก...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>บันทึกสิทธิ์</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useAskText, useConfirm } from '@/components/common/ConfirmDialogProvider'
import { SETTINGS_INPUT } from '@/features/settings/components/settings-ui'
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
  FileText,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { CustomSelect, SelectOption } from '@/components/common/CustomSelect'
import { GRANTABLE_MENUS, POS_STAFF_PRESET } from '@/features/auth/services/permissions'
import { listMembers, resetMemberPin, setMemberActions, setMemberMenus, setMemberRole, setMemberStatus } from '@/app/actions/members'
import { auditCategoryOf, fetchAuditLogs } from '@/features/audits/services/audit-storage'
import { PermissionMatrixPanel } from '@/features/auth/components/PermissionMatrixPanel'

type ActivityLogCategory = 'BILL' | 'STOCK' | 'SYSTEM' | 'CUSTOMER' | 'MEMBER' | 'FINANCE'

interface BusinessMemberUser {
  id: string
  userId?: string
  businessId?: string
  role?: 'OWNER' | 'USER'
  status?: string
  menus?: string[]
  actions?: string[]
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
// public.menu_catalog. Owner-only menus (settings, member management) are never granted.

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
  const confirm = useConfirm()
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

  // Permission matrix of the selected member (menus are the only stored grant)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [selectedPermCodes, setSelectedPermCodes] = useState<string[]>([])
  const [selectedActionCodes, setSelectedActionCodes] = useState<string[]>([])
  const [actionGrantsAvailable, setActionGrantsAvailable] = useState(true)
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
      setActionGrantsAvailable(result.data.actionGrantsAvailable)
      setMembers(
        result.data.members.map((m) => ({
          id: m.userId,
          userId: m.userId,
          role: m.role,
          status: m.status,
          menus: m.menus,
          actions: m.actions,
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

  // After a reload the matrix shows what the server saved.
  useEffect(() => {
    const m = members.find((x) => x.id === selectedMemberId)
    setSelectedPermCodes(m?.menus || [])
    setSelectedActionCodes(m?.actions || [])
  }, [members, selectedMemberId])

  useEffect(() => {
    if (activeTab === 'AUDIT_REPORT' || activeTab === 'AUDIT_LOGS') {
      loadLogs()
    }
  }, [activeTab, selectedActorId, loadLogs])

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

  const handleDeleteMember = async (member: BusinessMemberUser) => {
    const ok = await confirm({
      title: 'ยืนยันการลบผู้ใช้งาน',
      message: `คุณต้องการลบผู้ใช้งาน ${member.profile?.fullName || member.profile?.username || ''} ออกจากร้านใช่หรือไม่? พนักงานคนนี้จะไม่สามารถล็อกอินเข้าสู่ระบบได้อีกต่อไป`,
      confirmLabel: 'ยืนยันการลบ',
      danger: true,
    })
    if (!ok) return
    // Master §3.3: users with history are never hard-deleted
    showNotification('ลบผู้ใช้งานไม่ได้เพราะต้องเก็บประวัติการทำรายการ กรุณาใช้ "ระงับสิทธิ์" แทน', 'error')
  }

  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null
  const savedMenus = selectedMember?.menus ?? []
  const savedActions = selectedMember?.actions ?? []
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c))
  const menusDirty = selectedMember?.role === 'USER' && !sameSet(selectedPermCodes, savedMenus)
  const actionsDirty = selectedMember?.role === 'USER' && !sameSet(selectedActionCodes, savedActions)
  const permsDirty = menusDirty || actionsDirty

  const handleSelectMember = (member: BusinessMemberUser) => {
    setSelectedMemberId(member.id)
    setSelectedPermCodes(member.menus || [])
    setSelectedActionCodes(member.actions || [])
  }

  const handleToggleAction = (code: string) => {
    setSelectedActionCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
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
    if (!selectedMember || selectedMember.role !== 'USER') return
    const reason = await askReason('เหตุผลที่เปลี่ยนสิทธิ์การทำงาน')
    if (!reason) return
    setSavingPerms(true)
    try {
      if (menusDirty) {
        const result = await setMemberMenus(selectedMember.id, selectedPermCodes, reason)
        if (!result.success) {
          showNotification(result.error || 'บันทึกสิทธิ์ไม่สำเร็จ', 'error')
          return
        }
      }
      if (actionsDirty) {
        const result = await setMemberActions(selectedMember.id, selectedActionCodes, reason)
        if (!result.success) {
          showNotification(result.error || 'บันทึกสิทธิ์การทำรายการไม่สำเร็จ', 'error')
          await loadMembers()
          return
        }
      }
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

  // Rows of the selected group (บิล / ลูกค้า / …) that match the search box.
  const searchText = searchTerm.trim().toLowerCase()
  const visibleLogs = logs.filter(
    (log) =>
      auditCategoryOf(log.category) === auditSubTab &&
      (!searchText ||
        [log.action, log.details, log.actorName, JSON.stringify(log.metadata ?? {})].some((v) => (v || '').toLowerCase().includes(searchText)))
  )

  // Export audit logs to Excel
  const handleExportAuditExcel = () => {
    if (visibleLogs.length === 0) {
      showNotification('ไม่มีข้อมูลสำหรับส่งออก', 'error')
      return
    }

    const exportData = visibleLogs.map((log, idx) => ({
      ลำดับ: idx + 1,
      การกระทำ: log.action,
      หมวดหมู่: categoryNames[auditCategoryOf(log.category)],
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

  return (
    <div className="h-full min-h-0 p-2 bg-slate-100 dark:bg-slate-900 flex flex-col overflow-hidden text-xs">
      <div className="w-full flex-1 min-h-0 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col">
        {/* Toolbar: tabs + the active tab's actions (same pattern as the appointments page) */}
        <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
          <div className={TAB_CONTAINER_CLASSES}>
            <button
              type="button"
              onClick={() => setActiveTab('PERMISSIONS')}
              className={`${TAB_BUTTON_BASE_CLASSES} ${activeTab === 'PERMISSIONS' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>สิทธิ์ผู้ใช้งาน</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('AUDIT_REPORT')}
              className={`${TAB_BUTTON_BASE_CLASSES} ${activeTab !== 'PERMISSIONS' ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
            >
              <FileText className="w-3.5 h-3.5 shrink-0" />
              <span>ประวัติการทำรายการ (Audit Log)</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            {activeTab !== 'PERMISSIONS' && (
              <ActionButton size="sm" variant="neutral" onClick={handleExportAuditExcel} disabled={visibleLogs.length === 0} icon={<FileSpreadsheet />}>
                Export
              </ActionButton>
            )}
            <ActionButton
              size="sm"
              variant="neutral"
              className="w-9 px-0"
              title="รีเฟรชข้อมูล"
              onClick={activeTab === 'PERMISSIONS' ? loadMembers : loadLogs}
              disabled={activeTab === 'PERMISSIONS' ? loadingMembers : loadingLogs}
              icon={<RefreshCw className={(activeTab === 'PERMISSIONS' ? loadingMembers : loadingLogs) ? 'animate-spin' : ''} />}
            />
          </div>
        </div>

            {/* Feedback alert toast */}
            {feedback && (
              <div
                className={`shrink-0 m-2 mb-0 px-3 py-1.5 rounded-lg text-xs font-bold animate-in fade-in slide-in-from-top-1 flex items-center gap-2 border ${
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

        {/* ================= TAB 1: USERS + PERMISSION MATRIX ================= */}
        {activeTab === 'PERMISSIONS' && (
          <div className="flex-1 min-h-0 flex flex-col 2xl:flex-row overflow-hidden">
            <div className="flex-1 min-h-0 min-w-0 flex flex-col border-b 2xl:border-b-0 2xl:border-r border-slate-200 dark:border-slate-700">
              <DataTableFrame fill rowCount={loadingMembers ? undefined : members.length} className="flex-1 min-h-0 rounded-none border-0 bg-transparent shadow-none p-0">
<table className={`${DATA_TABLE_CLASSES} text-xs`}>
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs">
                          <th className="px-3 hidden 2xl:table-cell">รหัสผู้ใช้</th>
                          <th className="px-3">ชื่อแสดงผล</th>
                          <th className="px-3">Username</th>
                          <th className="px-3 text-center">ระดับสิทธิ์</th>
                          <th className="px-3 text-center">สถานะ</th>
                          <th className="px-3 text-center">เมนู</th>
                          <th className="px-3 hidden 2xl:table-cell">วันที่สร้าง</th>
                          <th className="px-3 text-right sticky right-0 bg-[#E3E3E3] dark:bg-slate-800">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700 font-medium">
                        {loadingMembers ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400">
                              <div className="flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600 dark:text-emerald-400" />
                                <span>กำลังโหลด...</span>
                              </div>
                            </td>
                          </tr>
                        ) : members.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">
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
                                onClick={() => handleSelectMember(member)}
                                aria-selected={selectedMemberId === member.id}
                                className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors ${
                                  selectedMemberId === member.id
                                    ? 'bg-emerald-50 dark:bg-emerald-950/30'
                                    : isPending ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''
                                }`}
                              >
                                {/* 1. User UUID */}
                                <td className="px-3 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap hidden 2xl:table-cell">
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
                                  {/* stopPropagation: picking a role must not also select the row */}
                                  <div className="inline-block w-40" onClick={(e) => e.stopPropagation()}>
                                    <CustomSelect
                                      ariaLabel={`บทบาท ${member.profile?.fullName || member.profile?.username || ''}`}
                                      value={member.role ?? ''}
                                      disabled={isSelf || member.role === 'OWNER' || actionLoading === member.id}
                                      onChange={(value) => handleRoleChange(member, String(value))}
                                      buttonClassName="h-7 px-2 py-0 rounded-lg"
                                      options={[
                                        { value: 'OWNER', label: 'OWNER (เจ้าของร้าน)' },
                                        { value: 'USER', label: 'USER (พนักงาน)' },
                                      ]}
                                    />
                                  </div>
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

                                <td className="px-3 text-center font-mono text-slate-600 dark:text-slate-300">
                                  {member.role === 'OWNER' ? 'ทั้งหมด' : member.menus?.length || 0}
                                </td>

                                {/* 6. Created */}
                                <td className="px-3 text-slate-500 dark:text-slate-400 text-[11px] font-mono whitespace-nowrap hidden 2xl:table-cell">
                                  {formatDateTime(member.profile?.createdAt)}
                                </td>

                                {/* 7. Action Buttons (pinned right so they stay visible on tablet widths) */}
                                <td className={`px-3 text-right sticky right-0 ${isPending ? 'bg-amber-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-800'}`}>
                                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
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
                                        onClick={() => handleDeleteMember(member)}
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
            <div className="min-h-0 h-[55%] 2xl:h-auto 2xl:w-[420px] shrink-0 flex flex-col">
              <PermissionMatrixPanel
                member={
                  selectedMember
                    ? {
                        id: selectedMember.id,
                        name: selectedMember.profile?.fullName || selectedMember.profile?.username || 'ไม่ระบุชื่อ',
                        role: selectedMember.role,
                        status: selectedMember.status,
                      }
                    : null
                }
                draftMenus={selectedMember?.role === 'USER' ? selectedPermCodes : []}
                draftActions={selectedMember?.role === 'USER' ? selectedActionCodes : []}
                actionGrantsAvailable={actionGrantsAvailable}
                onToggleAction={handleToggleAction}
                dirty={Boolean(permsDirty)}
                saving={savingPerms}
                onToggle={handleTogglePermission}
                onPresetPos={handlePresetPosPerms}
                onSelectAll={handleSelectAllPerms}
                onClear={handleClearAllPerms}
                onCancel={() => {
                  setSelectedPermCodes(savedMenus)
                  setSelectedActionCodes(savedActions)
                }}
                onSave={() => void handleSavePermissions()}
              />
            </div>
          </div>
        )}

        {/* ================= TAB 2: AUDIT LOG ================= */}
        {activeTab !== 'PERMISSIONS' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="p-2 border-b border-slate-200 dark:border-slate-700 flex flex-col lg:flex-row lg:items-center gap-2 shrink-0">
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
            <DataTableFrame fill rowCount={visibleLogs.length} className="flex-1 min-h-0 rounded-none border-0 bg-transparent shadow-none p-0">
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
                        ) : visibleLogs.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400 italic">
                              ไม่พบประวัติในหมวดนี้
                            </td>
                          </tr>
                        ) : (
                          visibleLogs.map((log, idx) => (
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
                                {categoryNames[auditCategoryOf(log.category)]}
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
  )
}

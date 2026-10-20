'use client'

import { SETTINGS_INPUT, SETTINGS_LABEL, SETTINGS_SECTION_TITLE } from '@/features/settings/components/settings-ui'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BellRing,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Key,
  Lock,
  LogOut,
  Moon,
  Palette,
  QrCode,
  Save,
  Shield,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  User,
} from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'
import {
  TAB_CONTAINER_CLASSES,
  TAB_BUTTON_BASE_CLASSES,
  TAB_BUTTON_ACTIVE_CLASSES,
  TAB_BUTTON_INACTIVE_CLASSES,
} from '@/components/common/ActionButton'
import { SecuritySettings } from '@/features/auth/components/SecuritySettings'
import { useAuth } from '@/features/auth/contexts/AuthContext'
import { useTheme } from '@/lib/contexts/ThemeContext'
import { createClient } from '@/lib/supabase/client'
import { changeOwnPassword } from '@/app/actions/auth'
import { validatePassword } from '@/features/settings/utils/settings-page-utils'
import { NotificationSettingsPanel } from '@/features/settings/components/NotificationSettingsPanel'
import { normalizeNotificationPrefs } from '@/features/notifications/services/notification-prefs'
import type { NotificationSettings } from '@/features/settings/services/settings-storage'
import { rpc } from '@/lib/db/rpc'

export type MyAccountTab = 'PROFILE' | 'SECURITY' | 'NOTIFICATIONS' | 'APPEARANCE'

const INPUT_CLASSES = SETTINGS_INPUT
const LABEL_CLASSES = SETTINGS_LABEL
const SECTION_CLASSES = 'p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-3'
const SECTION_TITLE_CLASSES = SETTINGS_SECTION_TITLE

/** Shrinks a picked image to a small square JPEG (stored in profiles.avatar_url). */
async function toAvatarDataUrl(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('อ่านไฟล์รูปไม่ได้')
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * ตั้งค่าส่วนตัว: the signed-in user's own profile, password, PIN / 2FA, notifications and look.
 * Open to every active member; nothing here changes shop-wide settings.
 */
export function MyAccountPanel({ initialTab = 'PROFILE' }: { initialTab?: MyAccountTab }) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { user, signOut, refreshUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<MyAccountTab>(initialTab)

  // ── Notifications (own switches, profiles.notification_prefs) ─────────────────
  const savedPrefs = useMemo(() => normalizeNotificationPrefs(user?.notificationPrefs), [user?.notificationPrefs])
  const [prefsDraft, setPrefsDraft] = useState<NotificationSettings>(savedPrefs)
  const [prefsSaving, setPrefsSaving] = useState(false)
  useEffect(() => setPrefsDraft(savedPrefs), [savedPrefs])
  const prefsDirty = JSON.stringify(prefsDraft) !== JSON.stringify(savedPrefs)

  const handleSavePrefs = async () => {
    setPrefsSaving(true)
    try {
      await rpc('my_notification_prefs_set', { p_prefs: prefsDraft })
      await refreshUser()
      showToast('บันทึกการแจ้งเตือนแล้ว', 'มีผลกับการแจ้งเตือนรอบถัดไป', 'SUCCESS')
    } catch (err) {
      showToast('บันทึกการแจ้งเตือนไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setPrefsSaving(false)
    }
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user?.id) return
    let active = true
    void supabase
      .from('profiles')
      .select('first_name, last_name, display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setFirstName((data?.first_name as string) || '')
        setLastName((data?.last_name as string) || '')
        setDisplayName((data?.display_name as string) || '')
        setProfileLoaded(true)
      })
    return () => {
      active = false
    }
  }, [supabase, user?.id])

  const updateOwnProfile = async (patch: Record<string, string | null>) => {
    if (!user?.id) throw new Error('กรุณาเข้าสู่ระบบใหม่อีกครั้ง')
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
    if (error) throw new Error(error.message)
    await refreshUser()
  }

  const handleSaveProfile = async () => {
    setProfileSaving(true)
    try {
      await updateOwnProfile({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        display_name: displayName.trim() || null,
      })
      showToast('บันทึกโปรไฟล์แล้ว', '', 'SUCCESS')
    } catch (err) {
      showToast('บันทึกโปรไฟล์ไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      if (!file.type.startsWith('image/')) throw new Error('รองรับเฉพาะไฟล์รูปภาพ')
      if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์ต้องไม่เกิน 5 MB')
      await updateOwnProfile({ avatar_url: await toAvatarDataUrl(file) })
      showToast('อัปเดตรูปโปรไฟล์แล้ว', '', 'SUCCESS')
    } catch (err) {
      showToast('อัปเดตรูปโปรไฟล์ไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    } finally {
      e.target.value = ''
    }
  }

  const handleRemoveAvatar = async () => {
    if (!(await confirm({ title: 'ลบรูปโปรไฟล์?', message: 'ระบบจะแสดงตัวอักษรย่อแทนรูป', danger: true, confirmLabel: 'ลบรูป' }))) return
    try {
      await updateOwnProfile({ avatar_url: null })
      showToast('ลบรูปโปรไฟล์แล้ว', '', 'INFO')
    } catch (err) {
      showToast('ลบรูปโปรไฟล์ไม่สำเร็จ', err instanceof Error ? err.message : '', 'ERROR')
    }
  }

  // ── Password ───────────────────────────────────────────────────────────────
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmNewPwd, setConfirmNewPwd] = useState('')
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [pwdSuccess, setPwdSuccess] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [showOldPwd, setShowOldPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [showConfirmNewPwd, setShowConfirmNewPwd] = useState(false)

  const handleChangePassword = async () => {
    setPwdError(null)
    setPwdSuccess(false)
    if (!oldPwd) {
      setPwdError('กรุณากรอกรหัสผ่านเดิม')
      return
    }
    const val = validatePassword(newPwd, { username: user?.username, email: user?.email })
    if (!val.isValid) {
      setPwdError(val.error || 'รหัสผ่านใหม่ไม่ปลอดภัย')
      return
    }
    if (newPwd !== confirmNewPwd) {
      setPwdError('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }
    setPwdLoading(true)
    try {
      const res = await changeOwnPassword(oldPwd, newPwd)
      if (!res.success) throw new Error(res.error || 'ไม่สามารถเปลี่ยนรหัสผ่านได้')
      setPwdSuccess(true)
      setOldPwd('')
      setNewPwd('')
      setConfirmNewPwd('')
      showToast('เปลี่ยนรหัสผ่านสำเร็จ', '', 'SUCCESS')
      setTimeout(() => setPwdSuccess(false), 3000)
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน')
    } finally {
      setPwdLoading(false)
    }
  }

  // ── 2FA (TOTP) ─────────────────────────────────────────────────────────────
  const [isMfaEnrolled, setIsMfaEnrolled] = useState(false)
  const [mfaFactors, setMfaFactors] = useState<Array<{ id: string; status: string }>>([])
  const [isEnrollingMfa, setIsEnrollingMfa] = useState(false)
  const [mfaEnrollData, setMfaEnrollData] = useState<{ factorId: string; secret: string; qrCode: string; uri: string } | null>(null)
  const [mfaVerifyCode, setMfaVerifyCode] = useState('')
  const [mfaVerifyError, setMfaVerifyError] = useState<string | null>(null)
  const [mfaLoading, setMfaLoading] = useState(false)
  const [showUnenrollConfirm, setShowUnenrollConfirm] = useState(false)
  const [copiedSecret, setCopiedSecret] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active || error || !data) return
      const factors = (data.all || []) as Array<{ id: string; status: string }>
      setMfaFactors(factors)
      setIsMfaEnrolled(factors.some((f) => f.status === 'verified'))
    })
    return () => {
      active = false
    }
  }, [supabase])

  const handleStartMfaEnroll = async () => {
    setMfaLoading(true)
    setMfaVerifyError(null)
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (error) throw error
      setMfaEnrollData({ factorId: data.id, secret: data.totp.secret, qrCode: data.totp.qr_code, uri: data.totp.uri })
      setIsEnrollingMfa(true)
      setMfaVerifyCode('')
    } catch (err) {
      showToast('เกิดข้อผิดพลาด', err instanceof Error ? err.message : 'ไม่สามารถเริ่มต้นตั้งค่า 2FA ได้', 'ERROR')
    } finally {
      setMfaLoading(false)
    }
  }

  const handleVerifyMfaEnroll = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfaEnrollData?.factorId) return
    const clean = mfaVerifyCode.trim().replace(/\D/g, '')
    if (clean.length !== 6) {
      setMfaVerifyError('กรุณากรอกรหัส 6 หลักจากแอป Authenticator')
      return
    }
    setMfaLoading(true)
    setMfaVerifyError(null)
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: mfaEnrollData.factorId })
      if (challenge.error) throw challenge.error
      const verify = await supabase.auth.mfa.verify({
        factorId: mfaEnrollData.factorId,
        challengeId: challenge.data.id,
        code: clean,
      })
      if (verify.error) throw verify.error
      setIsEnrollingMfa(false)
      setMfaEnrollData(null)
      setMfaVerifyCode('')
      setIsMfaEnrolled(true)
      const { data } = await supabase.auth.mfa.listFactors()
      if (data) setMfaFactors((data.all || []) as Array<{ id: string; status: string }>)
      showToast('เปิดใช้งาน 2FA สำเร็จ', '', 'SUCCESS')
    } catch (err) {
      setMfaVerifyError(err instanceof Error ? err.message : 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง')
    } finally {
      setMfaLoading(false)
    }
  }

  const handleCancelMfaEnroll = async () => {
    if (mfaEnrollData?.factorId) {
      await supabase.auth.mfa.unenroll({ factorId: mfaEnrollData.factorId }).catch(() => undefined)
    }
    setIsEnrollingMfa(false)
    setMfaEnrollData(null)
    setMfaVerifyCode('')
    setMfaVerifyError(null)
  }

  const handleUnenrollMfa = async () => {
    const verifiedFactor = mfaFactors.find((f) => f.status === 'verified')
    if (!verifiedFactor) return
    setMfaLoading(true)
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedFactor.id })
      if (error) throw error
      setShowUnenrollConfirm(false)
      setIsMfaEnrolled(false)
      setMfaFactors(mfaFactors.filter((f) => f.id !== verifiedFactor.id))
      showToast('ปิดใช้งาน 2FA แล้ว', '', 'INFO')
    } catch (err) {
      showToast('เกิดข้อผิดพลาด', err instanceof Error ? err.message : 'ไม่สามารถปิดการใช้งาน 2FA ได้', 'ERROR')
    } finally {
      setMfaLoading(false)
    }
  }

  const handleCopySecret = () => {
    if (!mfaEnrollData?.secret) return
    void navigator.clipboard.writeText(mfaEnrollData.secret)
    setCopiedSecret(true)
    showToast('คัดลอกแล้ว', '', 'INFO')
    setTimeout(() => setCopiedSecret(false), 2000)
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  const clearUnlockFlags = () => {
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith('rental_pos_unlocked_')) sessionStorage.removeItem(key)
    })
  }
  const handleLogoutAll = async () => {
    if (!(await confirm({ title: 'ออกจากระบบทุกอุปกรณ์?', message: 'ทุกเครื่องที่ใช้บัญชีนี้ต้องเข้าสู่ระบบใหม่', danger: true, confirmLabel: 'ออกจากระบบทุกอุปกรณ์' }))) return
    clearUnlockFlags()
    await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined)
    await signOut()
  }

  const tabs: Array<{ id: MyAccountTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'PROFILE', label: 'โปรไฟล์', icon: User },
    { id: 'SECURITY', label: 'ความปลอดภัย / PIN / ล็อกอัตโนมัติ', icon: Shield },
    { id: 'NOTIFICATIONS', label: 'การแจ้งเตือน', icon: BellRing },
    { id: 'APPEARANCE', label: 'เครื่องนี้ / Theme', icon: Palette },
  ]

  const passwordField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    shown: boolean,
    setShown: (v: boolean) => void
  ) => (
    <div>
      <label className={LABEL_CLASSES}>{label}</label>
      <div className="relative">
        <input
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          autoComplete="off"
          className={`${INPUT_CLASSES} pr-8`}
        />
        <button
          type="button"
          onClick={() => setShown(!shown)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
          aria-label={shown ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        >
          {shown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-900 text-xs p-2">
      <div className="flex-1 min-h-0 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden flex flex-col">
        <div className="px-2 sm:px-2.5 py-1.5 sm:py-2 border-b border-slate-200 dark:border-slate-700 shrink-0 flex items-center overflow-x-auto no-scrollbar">
          <div className={TAB_CONTAINER_CLASSES}>
            {tabs.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`${TAB_BUTTON_BASE_CLASSES} ${tab === t.id ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES}`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
          <div className="mx-auto w-full max-w-3xl space-y-3">
            {tab === 'PROFILE' && (
              <>
                <div className={SECTION_CLASSES}>
                  <span className={SECTION_TITLE_CLASSES}>
                    <User className="w-4 h-4 text-blue-500" />
                    <span>ข้อมูลบัญชี</span>
                  </span>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-3xl font-black overflow-hidden">
                        {user?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={user.avatarUrl} alt={user.displayName} className="w-full h-full object-cover" />
                        ) : (
                          (user?.displayName || 'U').slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => avatarInputRef.current?.click()}
                          className="h-8 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] flex items-center gap-1"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>{user?.avatarUrl ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}</span>
                        </button>
                        {user?.avatarUrl && (
                          <button
                            type="button"
                            onClick={handleRemoveAvatar}
                            className="h-8 px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-red-600 font-bold text-[11px] flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>ลบรูป</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={LABEL_CLASSES}>ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)</label>
                        <div className={`${INPUT_CLASSES} flex items-center font-mono bg-slate-50 dark:bg-slate-900/60`}>
                          @{user?.username || '-'}
                        </div>
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>อีเมล</label>
                        <div className={`${INPUT_CLASSES} flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/60`}>
                          <span className="truncate">{user?.email || '-'}</span>
                          <span
                            className={`shrink-0 px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              user?.emailVerified
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {user?.emailVerified ? 'ยืนยันแล้ว' : 'รอการยืนยัน'}
                          </span>
                        </div>
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>ชื่อ</label>
                        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={!profileLoaded} className={INPUT_CLASSES} />
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>นามสกุล</label>
                        <input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={!profileLoaded} className={INPUT_CLASSES} />
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>ชื่อที่แสดงในระบบ</label>
                        <input
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          disabled={!profileLoaded}
                          placeholder="เว้นว่าง = ใช้ชื่อ-นามสกุล"
                          className={INPUT_CLASSES}
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLASSES}>บทบาท</label>
                        <div className={`${INPUT_CLASSES} flex items-center font-bold bg-slate-50 dark:bg-slate-900/60`}>
                          {user?.role === 'OWNER' ? 'เจ้าของร้าน (OWNER)' : 'พนักงาน (USER)'}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={profileSaving || !profileLoaded}
                      className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      <span>{profileSaving ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'SECURITY' && (
              <>
                {/* PIN (optional, one per user) */}
                <SecuritySettings />

                {/* Password */}
                <div className={SECTION_CLASSES}>
                  <span className={SECTION_TITLE_CLASSES}>
                    <Lock className="w-4 h-4 text-blue-500" />
                    <span>เปลี่ยนรหัสผ่าน</span>
                  </span>
                  {pwdError && (
                    <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{pwdError}</span>
                    </div>
                  )}
                  {pwdSuccess && (
                    <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>เปลี่ยนรหัสผ่านเรียบร้อยแล้ว</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {passwordField('รหัสผ่านเดิม', oldPwd, setOldPwd, showOldPwd, setShowOldPwd)}
                    {passwordField('รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)', newPwd, setNewPwd, showNewPwd, setShowNewPwd)}
                    {passwordField('ยืนยันรหัสผ่านใหม่', confirmNewPwd, setConfirmNewPwd, showConfirmNewPwd, setShowConfirmNewPwd)}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleChangePassword}
                      disabled={pwdLoading}
                      className="h-9 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs disabled:opacity-50"
                    >
                      {pwdLoading ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
                    </button>
                  </div>
                </div>

                  {/* Two-factor authentication (TOTP) */}
                    <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 text-xs">
                          <ShieldCheck className="w-4 h-4 text-emerald-500" />
                          <span>การยืนยันตัวตนสองชั้น (Two-Factor Authentication / TOTP)</span>
                        </span>
                        {isMfaEnrolled ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-[10px] flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            <span>เปิดใช้งานแล้ว (AAL2)</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-bold text-[10px]">
                            ยังไม่เปิดใช้งาน (AAL1)
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500">
                        เพิ่มความปลอดภัยระดับสูงให้กับบัญชีของคุณด้วย Time-based One-Time Password (TOTP)
                        ผ่านแอปพลิเคชันอย่าง Google Authenticator, Microsoft Authenticator หรือ 1Password
                      </p>

                      {/* Not Enrolled State */}
                      {!isMfaEnrolled && !isEnrollingMfa && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={handleStartMfaEnroll}
                            disabled={mfaLoading}
                            className="h-9 px-3.5 py-0 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <QrCode className="w-4 h-4" />
                            <span>{mfaLoading ? 'กำลังสร้างคำขอ...' : 'เปิดใช้งาน 2-Factor Authentication'}</span>
                          </button>
                        </div>
                      )}

                      {/* Enrollment Step-by-step Flow */}
                      {!isMfaEnrolled && isEnrollingMfa && mfaEnrollData && (
                        <div className="p-3 bg-slate-50 dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3 animate-in fade-in">
                          <div className="border-b border-slate-200 dark:border-slate-700 pb-2">
                            <h5 className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                              <span>ขั้นตอนที่ 1: สแกน QR Code หรือคัดลอก Secret Key</span>
                            </h5>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              เปิดแอป Authenticator บนมือถือของคุณ แล้วสแกนรูป QR ด้านล่างนี้ หรือพิมพ์คีย์ลับลงในแอป
                            </p>
                          </div>

                          <div className="flex flex-col sm:flex-row items-center gap-4">
                            {/* QR Code Preview */}
                            <div className="p-2 bg-white rounded-2xl border border-slate-200 shadow-sm shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={mfaEnrollData.qrCode}
                                alt="TOTP QR Code"
                                className="w-40 h-40 object-contain rounded-xl"
                              />
                            </div>

                            {/* Secret key string */}
                            <div className="flex-1 space-y-2 text-xs w-full">
                              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                รหัสคีย์ลับ (Secret Key สำหรับพิมพ์เอง)
                              </label>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 p-2.5 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[11px] select-all break-all text-slate-900 dark:text-slate-100 font-bold">
                                  {mfaEnrollData.secret}
                                </div>
                                <button
                                  type="button"
                                  onClick={handleCopySecret}
                                  className="p-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer shrink-0"
                                  title="คัดลอก Secret Key"
                                  aria-label="คัดลอก Secret Key"
                                >
                                  {copiedSecret ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-500">
                                ผู้ให้บริการ: Rental POS &bull; บัญชี: @{user?.username || user?.email || 'N/A'}
                              </p>
                            </div>
                          </div>

                          <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-3">
                            <h5 className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <Key className="w-3.5 h-3.5 text-emerald-500" />
                              <span>ขั้นตอนที่ 2: กรอกรหัสยืนยัน 6 หลักเพื่อเปิดใช้งาน</span>
                            </h5>

                            {mfaVerifyError && (
                              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span>{mfaVerifyError}</span>
                              </div>
                            )}

                            <form onSubmit={handleVerifyMfaEnroll} className="flex flex-wrap items-center gap-2.5">
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={6}
                                value={mfaVerifyCode}
                                onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                className="w-36 h-9 px-3 py-0 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-center font-mono font-bold tracking-widest text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                                autoFocus
                              />
                              <button
                                type="submit"
                                disabled={mfaLoading || mfaVerifyCode.trim().length !== 6}
                                className="h-9 px-3.5 py-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {mfaLoading ? 'กำลังตรวจสอบ...' : 'ยืนยันและเปิดใช้งาน 2FA'}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelMfaEnroll}
                                disabled={mfaLoading}
                                className="h-9 px-3.5 py-0 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
                              >
                                ยกเลิก
                              </button>
                            </form>
                          </div>
                        </div>
                      )}

                      {/* Enrolled Active State */}
                      {isMfaEnrolled && (
                        <div className="space-y-3 pt-1">
                          <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                <Smartphone className="w-4 h-4" />
                              </div>
                              <div>
                                <span className="font-bold text-xs text-slate-900 dark:text-slate-100 block">
                                  Authenticator App (TOTP)
                                </span>
                                <span className="text-[10px] text-slate-500">
                                  รับรหัส 6 หลักจากแอปพลิเคชันทุกครั้งเมื่อเข้าสู่ระบบ
                                </span>
                              </div>
                            </div>

                            {!showUnenrollConfirm && (
                              <button
                                type="button"
                                onClick={() => setShowUnenrollConfirm(true)}
                                className="h-9 px-3.5 py-0 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 font-bold text-xs border border-rose-200 dark:border-rose-900 transition-colors cursor-pointer"
                              >
                                ปิดใช้งาน 2FA
                              </button>
                            )}
                          </div>

                          {showUnenrollConfirm && (
                            <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl space-y-2 animate-in fade-in">
                              <span className="font-bold text-rose-800 dark:text-rose-300 text-xs flex items-center gap-1.5">
                                <AlertCircle className="w-4 h-4" />
                                <span>ยืนยันการปิดใช้งาน 2-Factor Authentication?</span>
                              </span>
                              <p className="text-[11px] text-rose-700 dark:text-rose-400">
                                หากปิดใช้งาน ระบบจะลดระดับความปลอดภัยของบัญชีลงเหลือ AAL1 (เข้าสู่ระบบด้วยรหัสผ่านอย่างเดียว)
                              </p>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleUnenrollMfa}
                                  disabled={mfaLoading}
                                  className="h-9 px-3.5 py-0 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {mfaLoading ? 'กำลังดำเนินการ...' : 'ยืนยันปิดใช้งาน 2FA'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowUnenrollConfirm(false)}
                                  disabled={mfaLoading}
                                  className="h-9 px-3.5 py-0 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                {/* Sessions */}
                <div className={SECTION_CLASSES}>
                  <span className={SECTION_TITLE_CLASSES}>
                    <LogOut className="w-4 h-4 text-rose-500" />
                    <span>เซสชันการใช้งาน</span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        clearUnlockFlags()
                        await signOut()
                      }}
                      className="h-9 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>ออกจากระบบเครื่องนี้</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleLogoutAll}
                      className="h-9 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 font-bold text-xs flex items-center gap-1.5"
                    >
                      <Shield className="w-4 h-4 text-indigo-500" />
                      <span>ออกจากระบบทุกอุปกรณ์</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'NOTIFICATIONS' && (
              <div className={SECTION_CLASSES}>
                <NotificationSettingsPanel value={prefsDraft} onChange={setPrefsDraft} />
                <p className="text-[11px] text-slate-500">
                  ตั้งเฉพาะของคุณเอง · เห็นเฉพาะเรื่องในเมนูที่คุณมีสิทธิ์ · มีผลกับการแจ้งเตือนรอบถัดไป
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPrefsDraft(savedPrefs)}
                    disabled={!prefsDirty || prefsSaving}
                    className="h-9 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSavePrefs()}
                    disabled={!prefsDirty || prefsSaving}
                    className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    <span>{prefsSaving ? 'กำลังบันทึก…' : 'บันทึก'}</span>
                  </button>
                </div>
              </div>
            )}

            {tab === 'APPEARANCE' && (
              <div className={SECTION_CLASSES}>
                <span className={SECTION_TITLE_CLASSES}>
                  <Palette className="w-4 h-4 text-blue-500" />
                  <span>ธีม</span>
                </span>
                <div className="grid grid-cols-2 gap-2 max-w-sm">
                  {([
                    { id: 'light', label: 'สว่าง', icon: Sun },
                    { id: 'dark', label: 'มืด', icon: Moon },
                  ] as const).map((m) => {
                    const Icon = m.icon
                    const active = theme === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTheme(m.id)}
                        className={`h-16 rounded-xl border flex flex-col items-center justify-center gap-1 font-bold text-xs ${
                          active
                            ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                        <span>{m.label}</span>
                        {active && <Check className="w-3.5 h-3.5" />}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-slate-500">ใช้กับเครื่อง/เบราว์เซอร์นี้เท่านั้น ไม่ถูกบันทึกไปที่เซิร์ฟเวอร์</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

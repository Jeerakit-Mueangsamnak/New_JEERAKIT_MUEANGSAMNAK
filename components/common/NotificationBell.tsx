'use client'

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  CheckCheck,
  Truck,
  AlertTriangle,
  Package,
  Calendar,
  ChevronRight,
  Sparkles,
  Send,
  Check,
} from 'lucide-react'
import {
  loadNotifications,
  markNotificationStatus,
  markAllNotificationsRead,
  fetchNotificationsFromSupabase,
  ActionableNotification,
  NotificationType,
  NotificationGroup,
  NOTIFICATION_GROUPS,
  notificationGroup,
} from '@/features/notifications/services/notification-storage'

interface NotificationBellProps {
  className?: string
}

export function NotificationBell({ className = '' }: NotificationBellProps) {
  const router = useRouter()

  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<ActionableNotification[]>([])
  const [group, setGroup] = useState<NotificationGroup | 'ALL'>('ALL')
  const containerRef = useRef<HTMLDivElement>(null)


  // Load notifications from persistence
  const refreshNotifications = useCallback(() => {
    const list = loadNotifications()
    setNotifications(list)
  }, [])

  useEffect(() => {
    refreshNotifications()
    void fetchNotificationsFromSupabase().catch(() => undefined)

    const handleStorageUpdate = () => {
      refreshNotifications()
    }

    window.addEventListener('storage', handleStorageUpdate)
    window.addEventListener('app-storage-update', handleStorageUpdate)

    return () => {
      window.removeEventListener('storage', handleStorageUpdate)
      window.removeEventListener('app-storage-update', handleStorageUpdate)
    }
  }, [refreshNotifications])

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => n.status === 'UNREAD').length
  }, [notifications])

  // Open (not yet handled) notices per tab
  const groupCounts = useMemo(() => {
    const counts: Record<NotificationGroup, number> = { SYSTEM: 0, WORK: 0, BILL: 0, STOCK: 0 }
    for (const n of notifications) if (n.status !== 'HANDLED') counts[notificationGroup(n)]++
    return counts
  }, [notifications])

  const visibleNotifications = useMemo(
    () => (group === 'ALL' ? notifications : notifications.filter((n) => notificationGroup(n) === group)),
    [notifications, group]
  )

  // Handle clicking outside popover to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleItemClick = (item: ActionableNotification) => {
    if (item.status === 'UNREAD') {
      void markNotificationStatus(item.id, 'READ').then(setNotifications).catch(() => undefined)
    }
    setIsOpen(false)
    if (item.data?.sourceType === 'BILL' && item.data?.sourceId) {
      router.push(`/bills?id=${item.data.sourceId}`)
    } else if (item.data?.sourceType === 'PRODUCT') {
      router.push('/products')
    } else if (item.data?.sourceType === 'APPOINTMENT') {
      router.push('/appointments')
    } else if (item.data?.sourceType === 'QUOTATION' && item.data?.sourceId) {
      router.push(`/quotations?id=${item.data.sourceId}`)
    }
  }

  // Bill notices: open the bill with the existing LINE send window
  const handleSendBill = (e: React.MouseEvent, item: ActionableNotification) => {
    e.stopPropagation()
    if (item.status === 'UNREAD') {
      void markNotificationStatus(item.id, 'READ').then(setNotifications).catch(() => undefined)
    }
    setIsOpen(false)
    router.push(`/bills?id=${encodeURIComponent(item.data.sourceId as string)}&send=line`)
  }

  const handleMarkHandled = (e: React.MouseEvent, item: ActionableNotification) => {
    e.stopPropagation()
    void markNotificationStatus(item.id, 'HANDLED').then(setNotifications).catch(() => undefined)
  }

  const handleMarkAllRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    void markAllNotificationsRead().then(setNotifications).catch(() => undefined)
  }

  const getIconForType = (type: NotificationType) => {
    switch (type) {
      case 'PAYMENT_DUE':
        return <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
      case 'RENTAL_DUE_SOON':
      case 'RENTAL_OVERDUE':
        return <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      case 'APPOINTMENT_DUE':
        return <Calendar className="w-4 h-4 text-teal-600 dark:text-teal-400" />
      case 'DELIVERY_DUE':
        return <Truck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      case 'LOW_STOCK':
        return <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" />
      default:
        return <Bell className="w-4 h-4 text-slate-600 dark:text-slate-400" />
    }
  }

  const getBadgeStyle = (item: ActionableNotification) => {
    if (item.status === 'HANDLED') {
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
    }
    switch (item.type) {
      case 'PAYMENT_DUE':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
      case 'RENTAL_DUE_SOON':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
      case 'DELIVERY_DUE':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
      case 'RENTAL_OVERDUE':
      case 'LOW_STOCK':
        return 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
      default:
        return 'bg-slate-100 text-slate-700'
    }
  }

  const getBadgeLabel = (item: ActionableNotification) => {
    if (item.status === 'HANDLED') return 'จัดการแล้ว'
    switch (item.type) {
      case 'PAYMENT_DUE':
        return 'ยอดค้าง'
      case 'RENTAL_DUE_SOON':
        return 'ใกล้ถึงวันคืน'
      case 'RENTAL_OVERDUE':
        return 'เลยกำหนดคืน'
      case 'DELIVERY_DUE':
        return 'ถึงวันส่งของ'
      case 'APPOINTMENT_DUE':
        return 'นัดหมาย'
      case 'LOW_STOCK':
        return 'สต็อกต่ำ'
      default:
        return 'แจ้งเตือน'
    }
  }

  return (
    <>
      <div ref={containerRef} className={`relative inline-block ${className}`}>
        {/* Bell Trigger Button */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="การแจ้งเตือน"
          title="การแจ้งเตือน"
          className={`relative p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
            isOpen
              ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-400 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700/80 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300'
          }`}
        >
          <Bell className="w-4 h-4" />

          {/* Badge (Only visible when unread count > 0) */}
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center leading-none shadow-sm animate-in zoom-in duration-200">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Popover Dropdown */}
        {isOpen && (
          <div className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#0d1b2e] rounded-2xl shadow-2xl border border-slate-200 dark:border-[#263954] z-50 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-150">
            {/* Header */}
            <div className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#091322] border-b border-slate-200 dark:border-[#263954] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
                  การแจ้งเตือน
                </span>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[10px] font-black">
                    {unreadCount} รายการใหม่
                  </span>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  title="ทำเครื่องหมายว่าอ่านแล้วทั้งหมด"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>อ่านทั้งหมด</span>
                </button>
              )}
            </div>

            {/* Tabs: ทั้งหมด / ระบบ / งานถึงกำหนด / บิล / สต็อก (count = not yet handled) */}
            <div className="px-2 py-1.5 border-b border-slate-200 dark:border-[#263954] flex gap-1 overflow-x-auto shrink-0">
              {[{ key: 'ALL' as const, label: 'ทั้งหมด' }, ...NOTIFICATION_GROUPS].map((g) => {
                const count = g.key === 'ALL' ? Object.values(groupCounts).reduce((a, b) => a + b, 0) : groupCounts[g.key]
                const active = group === g.key
                return (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGroup(g.key)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {g.label}
                    {count > 0 && <span className={`ml-1 ${active ? 'text-blue-100' : 'text-red-600 dark:text-red-400'}`}>{count}</span>}
                  </button>
                )
              })}
            </div>

            {/* Notification Items List */}
            <div className="overflow-y-auto max-h-[360px] divide-y divide-slate-100 dark:divide-slate-800/80">
              {visibleNotifications.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    ไม่มีการแจ้งเตือน
                  </p>
                  <p className="text-[11px] text-slate-400">
                    ทุกรายการอยู่ในสถานะเรียบร้อยแล้ว
                  </p>
                </div>
              ) : (
                visibleNotifications.map((item) => {
                  const isUnread = item.status === 'UNREAD'
                  const isActioned = item.status === 'HANDLED'

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      className={`p-3 transition-colors cursor-pointer flex items-start gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        isUnread
                          ? 'bg-blue-50/40 dark:bg-blue-950/20'
                          : isActioned
                            ? 'opacity-65'
                            : 'opacity-85'
                      }`}
                    >
                      {/* Icon */}
                      <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center shrink-0 mt-0.5">
                        {getIconForType(item.type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate block">
                            {item.title}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold shrink-0 ${getBadgeStyle(
                              item
                            )}`}
                          >
                            {getBadgeLabel(item)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                          {item.message}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(item.createdAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                        {!isActioned && (
                          <div className="flex gap-1.5 pt-1">
                            {item.data?.sourceType === 'BILL' && item.data?.sourceId && (
                              <button
                                type="button"
                                onClick={(e) => handleSendBill(e, item)}
                                className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Send className="w-3 h-3" />
                                ส่งบิล
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => handleMarkHandled(e, item)}
                              className="px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              จัดการแล้ว
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Unread indicator / arrow */}
                      <div className="flex items-center self-center shrink-0 text-slate-400">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400 shrink-0 mr-1" />
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

    </>
  )
}

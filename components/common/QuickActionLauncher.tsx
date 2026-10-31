'use client'

import { useToast } from '@/components/common/Toast'
import { useCreateCustomer } from '@/features/customers/hooks/useCreateCustomer'
import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { HEADER_ICON_BUTTON_CLASSES, HEADER_ICON_BUTTON_OPEN_CLASSES, HEADER_ICON_BUTTON_IDLE_CLASSES } from '@/components/common/ActionButton'
import {
  LayoutGrid,
  ShoppingBag,
  UserPlus,
  CalendarPlus,
  RefreshCw,
  CreditCard,
  FileText,
  ClipboardList,
  Sun,
  Moon,
} from 'lucide-react'
import { useTheme } from '@/lib/contexts/ThemeContext'
import { NewCustomerModal } from '@/features/customers/components/NewCustomerModal'
import { AddAppointmentModal } from '@/features/appointments/components/AddAppointmentModal'
import { addAppointment } from '@/features/appointments/services/appointment-storage'

interface QuickActionLauncherProps {
  className?: string
}

export function QuickActionLauncher({ className = '' }: QuickActionLauncherProps) {
  const { showToast } = useToast()
  const createCustomer = useCreateCustomer()
  const router = useRouter()
  const { toggleTheme, isDark } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Modals
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false)
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false)

  // Handle clicking outside to close launcher
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

  const handleAction = (action: () => void) => {
    setIsOpen(false)
    action()
  }

  const actions = [
    {
      id: 'pos',
      label: 'หน้าร้าน POS',
      icon: ShoppingBag,
      onClick: () => router.push('/pos'),
      color: 'text-blue-600 dark:text-blue-400 hover:text-blue-400',
    },
    {
      id: 'add-customer',
      label: 'เพิ่มลูกค้า',
      icon: UserPlus,
      onClick: () => setShowNewCustomerModal(true),
      color: 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-400',
    },
    {
      id: 'add-appointment',
      label: 'เพิ่มนัดหมาย',
      icon: CalendarPlus,
      onClick: () => setShowAddAppointmentModal(true),
      color: 'text-purple-600 dark:text-purple-400 hover:text-purple-400',
    },
    {
      id: 'returns',
      label: 'รับคืนสินค้า',
      icon: RefreshCw,
      onClick: () => router.push('/bills'),
      color: 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-400',
    },
    {
      id: 'payment',
      label: 'รับชำระเงิน',
      icon: CreditCard,
      onClick: () => router.push('/bills'),
      color: 'text-teal-700 dark:text-teal-400 hover:text-teal-400',
    },
    {
      id: 'quotation',
      label: 'ใบเสนอราคา',
      icon: FileText,
      onClick: () => router.push('/quotations'),
      color: 'text-cyan-700 dark:text-cyan-400 hover:text-cyan-400',
    },
    {
      id: 'stock-count',
      label: 'ตรวจนับสินค้า',
      icon: ClipboardList,
      onClick: () => router.push('/products?tab=count'),
      color: 'text-amber-700 dark:text-amber-400 hover:text-amber-400',
    },
    {
      id: 'theme',
      label: isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด',
      icon: isDark ? Sun : Moon,
      onClick: toggleTheme,
      color: isDark ? 'text-amber-400 hover:text-amber-300' : 'text-indigo-400 hover:text-indigo-300',
    },
  ]

  return (
    <>
      <div ref={containerRef} className={`relative inline-block ${className}`}>
        {/* Trigger Button - NotificationBell size: p-2 rounded-xl */}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label="เมนูลัด (Quick Actions)"
          title="เมนูลัด"
          className={`${HEADER_ICON_BUTTON_CLASSES} ${isOpen ? HEADER_ICON_BUTTON_OPEN_CLASSES : HEADER_ICON_BUTTON_IDLE_CLASSES}`}
        >
          <LayoutGrid className="w-4 h-4" />
        </button>

        {/* 9 Vertical Icon-Only Action Buttons: No background tray, no box border, no black overlay */}
        {isOpen && (
          <div className="absolute right-0 top-full mt-2.5 z-50 flex flex-col items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-150">
            {actions.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleAction(item.onClick)}
                  title={item.label}
                  aria-label={item.label}
                  className={`p-2 rounded-xl bg-slate-100 dark:bg-slate-800/90 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700/80 shadow-md transition-transform active:scale-95 flex items-center justify-center cursor-pointer ${item.color}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* New Customer Modal */}
      <NewCustomerModal
        isOpen={showNewCustomerModal}
        onClose={() => setShowNewCustomerModal(false)}
        onSave={async (c) => {
          try {
            await createCustomer(c)
            setShowNewCustomerModal(false)
          } catch (err) {
            console.error(err)
            showToast('บันทึกลูกค้าไม่สำเร็จ', err instanceof Error ? err.message : 'โปรดลองอีกครั้ง', 'ERROR')
          }
        }}
      />

      {/* Add Appointment Modal */}
      <AddAppointmentModal
        isOpen={showAddAppointmentModal}
        onClose={() => setShowAddAppointmentModal(false)}
        onSave={(newApt) => addAppointment(newApt)}
      />
    </>
  )
}

'use client'
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

import React from 'react'
import { AppModal, AppModalHeader, AppModalBody, AppModalFooter } from '@/components/common/AppModal'
import { AlertTriangle, Trash2 } from 'lucide-react'

interface BatchDeleteModalProps {
  isOpen: boolean
  count: number
  itemTypeLabel?: string
  onClose: () => void
  onConfirm: () => void
}

export function BatchDeleteModal({
  isOpen,
  count,
  itemTypeLabel = 'รายการเอกสาร',
  onClose,
  onConfirm
}: BatchDeleteModalProps) {
  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  return (
    <AppModal isOpen={isOpen} onClose={onClose} size="sm">
      <AppModalHeader
        onClose={onClose}
        icon={<AlertTriangle className="w-5 h-5 text-red-700 dark:text-red-400" />}
        title="ยืนยันการลบข้อมูล"
      />

      <AppModalBody className="space-y-3 text-xs">
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-slate-800 dark:text-slate-200 leading-relaxed font-bold text-xs">
          ต้องการลบ{itemTypeLabel}ที่เลือกจำนวน <span className="text-red-700 dark:text-red-400 text-sm font-black">{count}</span> รายการหรือไม่?
          <p className="text-[11px] font-normal text-slate-600 dark:text-slate-400 mt-1">
            การดำเนินการนี้ไม่สามารถยกเลิกได้ รายการทั้งหมดจะถูกลบออกจากฐานข้อมูลถาวร
          </p>
        </div>
      </AppModalBody>

      <AppModalFooter>
        <button
          type="button"
          onClick={onClose}
          className={`${COMMAND_BUTTON_SIZE_CLASSES} border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer`}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className={`${COMMAND_BUTTON_SIZE_CLASSES} bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900/40 text-white shadow-md shadow-red-600/30 flex items-center cursor-pointer disabled:cursor-not-allowed`}
        >
          <Trash2 className="w-4 h-4" />
          <span>ยืนยันการลบ</span>
        </button>
      </AppModalFooter>
    </AppModal>
  )
}

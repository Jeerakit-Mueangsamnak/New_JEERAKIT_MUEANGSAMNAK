'use client'

import { useEffect, useRef } from 'react'
import { useConfirm } from '@/components/common/ConfirmDialogProvider'

/**
 * While `active` (unsaved edits on the page): closing / reloading the tab asks the browser's own
 * "leave site?" question, and clicking a link to another page in the app asks first. "Stay" keeps
 * everything as it is; "leave" follows the link the normal way.
 */
export function useLeaveGuard(active: boolean) {
  const confirm = useConfirm()
  const passingRef = useRef(false)
  const bypassNextPopRef = useRef(false)

  useEffect(() => {
    if (!active) return
    const guardedUrl = new URL(window.location.href)
    const guardedState = window.history.state
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    const onPopState = (e: PopStateEvent) => {
      if (bypassNextPopRef.current) {
        bypassNextPopRef.current = false
        return
      }
      if (passingRef.current) return
      e.stopImmediatePropagation()
      window.history.pushState(guardedState, '', guardedUrl)
      void confirm({
        title: 'ยังไม่ได้บันทึกการตั้งค่า',
        message: 'มีค่าที่แก้ไว้แต่ยังไม่ได้กดบันทึก ถ้าออกจากหน้านี้ ค่าที่แก้จะหาย',
        confirmLabel: 'ออกโดยไม่บันทึก',
        cancelLabel: 'อยู่หน้านี้ต่อ',
        danger: true,
      }).then((leave) => {
        if (!leave) return
        bypassNextPopRef.current = true
        window.history.back()
        window.setTimeout(() => {
          bypassNextPopRef.current = false
        }, 1000)
      })
    }
    const onClick = (e: MouseEvent) => {
      if (passingRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      void confirm({
        title: 'ยังไม่ได้บันทึกการตั้งค่า',
        message: 'มีค่าที่แก้ไว้แต่ยังไม่ได้กดบันทึก ถ้าออกจากหน้านี้ ค่าที่แก้จะหาย',
        confirmLabel: 'ออกโดยไม่บันทึก',
        cancelLabel: 'อยู่หน้านี้ต่อ',
        danger: true,
      }).then((leave) => {
        if (!leave) return
        passingRef.current = true
        try {
          link.click()
        } finally {
          passingRef.current = false
        }
      })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('popstate', onPopState, true)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('popstate', onPopState, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, confirm])
}

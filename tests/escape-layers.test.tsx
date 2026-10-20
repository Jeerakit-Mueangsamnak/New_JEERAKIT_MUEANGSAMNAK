// @vitest-environment jsdom
import React, { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppModal } from '@/components/common/AppModal'
import { CustomSelect } from '@/components/common/CustomSelect'
import { ConfirmDialogProvider, useConfirm } from '@/components/common/ConfirmDialogProvider'

afterEach(cleanup)

const pressEscape = (target: Element | Document = document.activeElement ?? document.body) =>
  act(() => {
    fireEvent.keyDown(target, { key: 'Escape' })
  })

function FormModal({ onClose, children }: { onClose: () => void; children?: React.ReactNode }) {
  return (
    <AppModal isOpen onClose={onClose}>
      <input aria-label="note" defaultValue="กำลังกรอก" />
      {children}
    </AppModal>
  )
}

describe('P1-A4 Escape closes only the top layer', () => {
  it('Escape on a modal alone still closes it', () => {
    const onClose = vi.fn()
    render(<FormModal onClose={onClose} />)
    pressEscape(screen.getByLabelText('note'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape with a dropdown open closes the dropdown, not the modal; the next Escape closes the modal', () => {
    const onClose = vi.fn()
    render(
      <FormModal onClose={onClose}>
        <CustomSelect value="" onChange={() => {}} options={[{ value: 'a', label: 'ตัวเลือก A' }]} />
      </FormModal>
    )
    fireEvent.click(screen.getByRole('button', { name: /เลือกรายการ/ }))
    expect(screen.getByText('ตัวเลือก A')).toBeTruthy()
    pressEscape(screen.getByLabelText('note'))
    expect(screen.queryByText('ตัวเลือก A')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    pressEscape(screen.getByLabelText('note'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape on a confirm question answers "no" and keeps the modal behind it open', async () => {
    const onClose = vi.fn()
    let answer: boolean | undefined
    function Asker() {
      const confirm = useConfirm()
      return <button onClick={async () => { answer = await confirm({ title: 'ยืนยัน?' }) }}>ask</button>
    }
    render(
      <ConfirmDialogProvider>
        <FormModal onClose={onClose}>
          <Asker />
        </FormModal>
      </ConfirmDialogProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'ask' }))
    expect(screen.getByText('ยืนยัน?')).toBeTruthy()
    pressEscape(document.body)
    await act(async () => {})
    expect(answer).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('nested modals: Escape closes the inner one only', () => {
    function Nested() {
      const [outer, setOuter] = useState(true)
      const [inner, setInner] = useState(true)
      return (
        <>
          <AppModal isOpen={outer} onClose={() => setOuter(false)}><p>outer</p></AppModal>
          <AppModal isOpen={inner} onClose={() => setInner(false)}><p>inner</p></AppModal>
        </>
      )
    }
    render(<Nested />)
    pressEscape(document.body)
    expect(screen.queryByText('inner')).toBeNull()
    expect(screen.getByText('outer')).toBeTruthy()
    pressEscape(document.body)
    expect(screen.queryByText('outer')).toBeNull()
  })

  it('closeOnEsc=false on the top modal keeps both open', () => {
    const outerClose = vi.fn()
    render(
      <>
        <AppModal isOpen onClose={outerClose}><p>outer</p></AppModal>
        <AppModal isOpen onClose={() => {}} closeOnEsc={false}><p>inner</p></AppModal>
      </>
    )
    pressEscape(document.body)
    expect(outerClose).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QrPaymentDialog } from '@/features/pos/components/payment/QrPaymentDialog'

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: any) => <img {...props} />,
}))

afterEach(cleanup)

describe('QrPaymentDialog (QR Code in the middle of the screen)', () => {
  it('draws the shop PromptPay QR with the amount', async () => {
    render(<QrPaymentDialog isOpen onClose={vi.fn()} amount={25} promptPayId="0812345678" onConfirm={vi.fn()} />)
    expect(screen.getByText('25.00 บาท')).toBeTruthy()
    await waitFor(() => expect((screen.getByAltText('QR Code รับเงิน') as HTMLImageElement).src).toMatch(/^data:image\/png/))
    expect(screen.getByText('PromptPay: 0812345678')).toBeTruthy()
  })

  it('QR first: a smaller transfer is confirmed with that amount and names the rest for cash', () => {
    const onConfirm = vi.fn()
    render(<QrPaymentDialog isOpen editable onClose={vi.fn()} amount={30} onConfirm={onConfirm} />)
    expect(screen.getByText('ยังไม่ได้ตั้งค่า QR รับเงิน')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'ยอดที่ลูกค้าโอน' }), { target: { value: '10' } })
    expect(screen.getByText('ส่วนที่เหลือ 20.00 บาท รับต่อด้วยเงินสด')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'ได้รับเงินแล้ว' }))
    expect(onConfirm).toHaveBeenCalledWith(10)
  })
})

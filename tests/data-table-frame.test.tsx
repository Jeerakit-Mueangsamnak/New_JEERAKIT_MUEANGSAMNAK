// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DataTableFrame } from '@/components/common/DataTableFrame'

afterEach(cleanup)

describe('DataTableFrame vertical workspace', () => {
  it('keeps short table rows natural-sized while the scroll area fills the workspace', () => {
    const { container } = render(
      <DataTableFrame fill rowCount={1}>
        <table>
          <thead><tr><th>รายการ</th></tr></thead>
          <tbody><tr><td>ตัวอย่าง</td></tr></tbody>
        </table>
      </DataTableFrame>
    )

    const scrollArea = container.querySelector('.overflow-y-auto')
    expect(scrollArea?.className).toContain('h-full')
    expect(scrollArea?.className).not.toContain('[&_table]:h-full')
    expect(scrollArea?.className).toContain('[&_thead]:sticky')
    expect(scrollArea?.className).toContain('[&_thead]:top-0')
    expect(screen.getByText('แสดง 1 จากทั้งหมด 1 รายการ')).toBeTruthy()
  })

  it('keeps the fixed-height table mode and row count for ordinary tables', () => {
    const { container } = render(
      <DataTableFrame rowCount={3}>
        <table><tbody><tr><td>รายการ</td></tr></tbody></table>
      </DataTableFrame>
    )

    const scrollArea = container.querySelector('.overflow-y-auto')
    expect(scrollArea?.className).not.toContain('[&_table]:h-full')
    expect(scrollArea?.className).toContain('min-h-[320px] max-h-[380px]')
    expect(screen.getByText('แสดง 3 จากทั้งหมด 3 รายการ')).toBeTruthy()
  })

  it('keeps the table header and empty count visible when no rows are available', () => {
    render(
      <DataTableFrame fill rowCount={0}>
        <table><thead><tr><th>รายการ</th></tr></thead><tbody /></table>
      </DataTableFrame>
    )

    expect(screen.getByText('รายการ')).toBeTruthy()
    expect(screen.getByText('0 รายการ')).toBeTruthy()
  })
})

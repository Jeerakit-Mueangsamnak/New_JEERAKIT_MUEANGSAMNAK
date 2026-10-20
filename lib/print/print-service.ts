/**
 * Central printing. The app shell is hidden in print (globals.css shows only
 * #central-print-target), so anything to print is first rendered into that element,
 * then window.print() runs, then the element is removed.
 */
import { escapeDocumentHtml } from '@/features/documents/utils/document-html'

const TARGET_ID = 'central-print-target'

export type PrintOrientation = 'portrait' | 'landscape'

let cleanupTimer: ReturnType<typeof setTimeout> | null = null

function removeTarget(): void {
  document.getElementById(TARGET_ID)?.remove()
  document.getElementById(`${TARGET_ID}-page`)?.remove()
}

/**
 * Fills the print target (via `fill`, which may return a cleanup), then opens the browser
 * print dialog once the content and its images are laid out.
 */
export function openPrint(
  fill: (target: HTMLDivElement) => (() => void) | void,
  opts: { orientation?: PrintOrientation; margin?: string; title?: string } = {}
): void {
  if (typeof window === 'undefined') return
  if (cleanupTimer) clearTimeout(cleanupTimer)
  removeTarget()

  const pageStyle = document.createElement('style')
  pageStyle.id = `${TARGET_ID}-page`
  pageStyle.textContent = `@media print { @page { size: A4 ${opts.orientation ?? 'portrait'}; margin: ${opts.margin ?? '0'}; } }`
  document.head.appendChild(pageStyle)

  const target = document.createElement('div')
  target.id = TARGET_ID
  // Kept off-screen on screen; globals.css makes it the only visible element in print.
  target.style.position = 'fixed'
  target.style.left = '-10000px'
  target.style.top = '0'
  target.style.width = '210mm'
  document.body.appendChild(target)
  const cleanup = fill(target)

  const previousTitle = document.title
  if (opts.title) document.title = opts.title

  const done = () => {
    document.title = previousTitle
    window.removeEventListener('afterprint', done)
    cleanupTimer = setTimeout(() => {
      cleanup?.()
      removeTarget()
    }, 300)
  }
  window.addEventListener('afterprint', done)

  // Let the browser lay out (and load images) before the dialog takes its snapshot.
  const images = Array.from(target.querySelectorAll('img'))
  Promise.all(
    images.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null) })))
  ).then(() => requestAnimationFrame(() => requestAnimationFrame(() => window.print())))
}

/** Renders `html` into the print target and opens the browser print dialog. */
export function printHtml(
  html: string,
  opts: { orientation?: PrintOrientation; margin?: string; title?: string } = {}
): void {
  openPrint((target) => {
    target.innerHTML = html
  }, opts)
}

export interface PrintTableColumn {
  label: string
  align?: 'left' | 'right' | 'center'
}

export interface PrintTableOptions {
  title: string
  /** e.g. the current search / filter, shown under the title. */
  subtitle?: string
  columns: PrintTableColumn[]
  rows: Array<Array<string | number | null | undefined>>
  /** 'auto' (default): landscape when there are more than 6 columns. */
  orientation?: PrintOrientation | 'auto'
}

/**
 * Prints a plain report: title, print date and the table only. The header row repeats on
 * every page and a row is never split across pages. Returns false when there is nothing
 * to print (the caller shows "ไม่มีข้อมูลสำหรับพิมพ์").
 */
export function printTable(opts: PrintTableOptions): boolean {
  if (opts.rows.length === 0) return false
  const orientation = opts.orientation && opts.orientation !== 'auto'
    ? opts.orientation
    : opts.columns.length > 6 ? 'landscape' : 'portrait'
  const printedAt = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' })
  const align = (c?: PrintTableColumn) => `text-align:${c?.align ?? 'left'}`

  const head = opts.columns.map((c) => `<th style="${align(c)}">${escapeDocumentHtml(c.label)}</th>`).join('')
  const body = opts.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td style="${align(opts.columns[i])}">${escapeDocumentHtml(cell ?? '')}</td>`)
          .join('')}</tr>`
    )
    .join('')

  printHtml(
    `<style>
      .print-report { font-family: 'Sarabun', 'Noto Sans Thai', sans-serif; color: #0f172a; font-size: 10.5px; }
      .print-report h1 { font-size: 15px; font-weight: 800; margin: 0; }
      .print-report .meta { font-size: 10px; color: #475569; margin: 2px 0 8px; }
      .print-report table { width: 100%; border-collapse: collapse; }
      .print-report thead { display: table-header-group; }
      .print-report tr { break-inside: avoid; page-break-inside: avoid; }
      .print-report th { background: #e2e8f0 !important; font-weight: 700; }
      .print-report th, .print-report td { border: 1px solid #94a3b8; padding: 3px 5px; vertical-align: top; }
    </style>
    <div class="print-report">
      <h1>${escapeDocumentHtml(opts.title)}</h1>
      <div class="meta">พิมพ์เมื่อ ${escapeDocumentHtml(printedAt)}${opts.subtitle ? ` · ${escapeDocumentHtml(opts.subtitle)}` : ''} · ${opts.rows.length} รายการ</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>`,
    { orientation, margin: '10mm', title: opts.title }
  )
  return true
}

/** One A4 page per document (customer forms, bills); `pages` are already-rendered HTML. */
export function printDocuments(pages: string[], title?: string): boolean {
  if (pages.length === 0) return false
  printHtml(
    `<div class="print-multi-document-container">${pages
      .map((p) => `<div class="print-document-wrapper" style="width:210mm;min-height:297mm;box-sizing:border-box;">${p}</div>`)
      .join('')}</div>`,
    { orientation: 'portrait', margin: '0', title }
  )
  return true
}

/**
 * Central printing. The app shell is hidden in print (globals.css shows only
 * #central-print-target), so anything to print is first rendered into that element,
 * then window.print() runs, then the element is removed.
 */
import { escapeDocumentHtml } from '@/features/documents/utils/document-html'
import { askTapToPrint, shareDocumentImages } from '@/lib/print/print-share-images'

const TARGET_ID = 'central-print-target'

export type PrintOrientation = 'portrait' | 'landscape'

/** Cleanup returned by the last `fill` (e.g. unmounting a React root), run when that document is removed. */
let pendingCleanup: (() => void) | null = null
let pageHideHooked = false

/** iPad (also iPadOS that reports itself as a Mac), iPhone, iPod. */
function isAppleTouchDevice(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** Running as a Home Screen web app (no Safari bar): iOS may give such apps no print window. */
function isStandaloneWebApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function removeTarget(): void {
  pendingCleanup?.()
  pendingCleanup = null
  document.getElementById(TARGET_ID)?.remove()
  document.getElementById(`${TARGET_ID}-page`)?.remove()
}

/**
 * Fills the print target (via `fill`, which may return a cleanup), then opens the browser
 * print dialog once the content and its images are laid out.
 *
 * The printed document stays (off-screen) until the next print or until the page is left
 * (owner 2026-11-11: the print preview did not load). On iPad / phones, and in some desktop
 * browsers, window.print() returns and "afterprint" fires while the print window is still
 * building its preview; removing the document then left the preview empty.
 */
/** Replaces the print target with a new, empty one (and its page size / margin) and returns it. */
function mountTarget(opts: { orientation?: PrintOrientation; margin?: string }): HTMLDivElement {
  removeTarget()
  if (!pageHideHooked) {
    window.addEventListener('pagehide', removeTarget)
    pageHideHooked = true
  }

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
  return target
}

export function openPrint(
  fill: (target: HTMLDivElement) => (() => void) | void,
  opts: { orientation?: PrintOrientation; margin?: string; title?: string } = {}
): void {
  if (typeof window === 'undefined') return
  const target = mountTarget(opts)
  pendingCleanup = fill(target) || null

  const previousTitle = document.title
  if (opts.title) document.title = opts.title

  // Only the tab title (the PDF's file name) goes back; the document itself stays, see above.
  const done = () => {
    document.title = previousTitle
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)

  // iPad / iPhone (Safari) open the print window only while the tap is still "fresh": waiting for the images
  // first made the print button do nothing on iPad (owner 2026-11-18). Safari builds its preview later
  // anyway, so the images are in by then.
  if (isAppleTouchDevice()) {
    // The Home Screen icon (no Safari bar) gives no print window: the document goes to the share
    // sheet as pictures, whose "พิมพ์" opens the iPad print window (owner 2026-11-19).
    if (isStandaloneWebApp()) {
      void shareDocumentImages(target, opts.title, () => {
        done()
        removeTarget()
      })
      return
    }
    void target.offsetHeight
    // Safari opens the print window only while the tap is fresh; a print that came later (a form read
    // from the server first) gets one "พิมพ์" tap instead of doing nothing.
    if (navigator.userActivation?.isActive === false) {
      askTapToPrint()
      return
    }
    window.print()
    return
  }

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

/** The printed markup of `pages`: one A4 page each. */
function documentPagesHtml(pages: string[]): string {
  return `<div class="print-multi-document-container">${pages
    .map((p) => `<div class="print-document-wrapper" style="width:210mm;min-height:297mm;box-sizing:border-box;">${p}</div>`)
    .join('')}</div>`
}

/**
 * The page margin of a shop form on iPad / iPhone: there the print keeps the printer's own margins, so the
 * form is printed inside 10mm margins, centred (globals.css), for 1cm of paper left and right (owner 2026-11-20).
 * PCs print the full sheet to the paper's edge; the sheet itself has the 1cm margins.
 */
const APPLE_FORM_PAGE_MARGIN = '10mm'

/** One A4 page per document (customer forms, bills); `pages` are already-rendered HTML. */
export function printDocuments(pages: string[], title?: string): boolean {
  if (pages.length === 0) return false
  const formPages = pages.some((p) => p.includes('print-form-page'))
  const margin = formPages && isAppleTouchDevice() ? APPLE_FORM_PAGE_MARGIN : '0'
  printHtml(documentPagesHtml(pages), { orientation: 'portrait', margin, title })
  return true
}

/**
 * Puts `pages` in the print target without opening a print window, for a document shown on screen: the
 * browser's / iPad's own print (Share › Print, Ctrl+P) then prints that document instead of a blank page
 * (owner 2026-11-25, bill preview). Returns a cleanup that removes it, unless a later print replaced it.
 */
export function stagePrintDocuments(pages: string[]): () => void {
  if (typeof window === 'undefined' || pages.length === 0) return () => {}
  const formPages = pages.some((p) => p.includes('print-form-page'))
  const margin = formPages && isAppleTouchDevice() ? APPLE_FORM_PAGE_MARGIN : '0'
  const target = mountTarget({ orientation: 'portrait', margin })
  target.innerHTML = documentPagesHtml(pages)
  return () => {
    if (document.getElementById(TARGET_ID) === target) removeTarget()
  }
}

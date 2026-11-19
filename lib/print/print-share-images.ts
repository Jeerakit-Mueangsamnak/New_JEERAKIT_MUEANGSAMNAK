/**
 * Printing on iPad / iPhone where window.print() alone cannot open the iPad print window:
 * - the web app opened from the Home Screen icon ignores window.print(): the document is turned into PNG
 *   pictures (one per A4 page) and handed to the share sheet, whose "พิมพ์" opens the iPad print window with
 *   its preview and page pictures. No PDF (owner 2026-11-19, the shop's old system printed the same way).
 * - Safari opens the print window only right after a tap: when the print comes later (a form read from the
 *   server first), one "พิมพ์" tap opens it.
 */
import { COMMAND_BUTTON_SIZE_CLASSES } from '@/components/common/ActionButton'

const OVERLAY_ID = 'print-share-overlay'

const CLOSE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'

function fileBaseName(title?: string): string {
  const name = (title ?? '').replace(/[\\/:*?"<>|]+/g, '-').trim()
  return name || 'เอกสาร'
}

function waitForImages(root: HTMLElement): Promise<unknown> {
  const images = Array.from(root.querySelectorAll('img'))
  return Promise.all(
    images.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = () => r(null) })))
  )
}

function isError(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === name
}

/** A small centred window (text + content + X). `onClosed` runs once, when it closes. */
function openSmallWindow(text: string, onClosed: () => void) {
  document.getElementById(OVERLAY_ID)?.remove()
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4'
  const card = document.createElement('div')
  card.className =
    'relative w-full max-w-sm max-h-full overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-4 space-y-3 text-center'
  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'ปิด')
  closeButton.className =
    'absolute top-2 right-2 p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
  closeButton.innerHTML = CLOSE_ICON
  const message = document.createElement('p')
  message.className = 'text-sm font-bold text-slate-800 dark:text-slate-100 pt-1 px-6'
  message.textContent = text
  const body = document.createElement('div')
  body.className = 'space-y-2'
  card.append(closeButton, message, body)
  overlay.appendChild(card)
  document.body.appendChild(overlay)

  const win = {
    closed: false,
    message,
    body,
    close: () => {
      if (win.closed) return
      win.closed = true
      overlay.remove()
      onClosed()
    },
  }
  closeButton.addEventListener('click', win.close)
  return win
}

function printButton(onTap: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `${COMMAND_BUTTON_SIZE_CLASSES} w-full bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white flex items-center justify-center cursor-pointer`
  button.textContent = 'พิมพ์'
  button.addEventListener('click', onTap)
  return button
}

/** Safari: the tap is too old to open the print window; one "พิมพ์" tap opens it (the document is ready). */
export function askTapToPrint(): void {
  const win = openSmallWindow('เอกสารพร้อมพิมพ์', () => {})
  win.body.appendChild(
    printButton(() => {
      win.close()
      window.print()
    })
  )
}

/**
 * The rendered document as PNG pictures: one per A4 page (`.print-document-wrapper`), otherwise the whole
 * `target` as one picture (a table report).
 */
export async function documentToPictures(target: HTMLElement, title?: string): Promise<File[]> {
  await waitForImages(target)
  await document.fonts?.ready
  const { domToBlob } = await import('modern-screenshot')
  const wrappers = Array.from(target.querySelectorAll<HTMLElement>('.print-document-wrapper'))
  // The target itself sits off-screen; its picture must start at the page's own top left.
  const pages = wrappers.length > 0 ? wrappers : [target]
  const base = fileBaseName(title)
  const files: File[] = []
  for (const [i, page] of pages.entries()) {
    const blob = await domToBlob(page, {
      scale: 2,
      backgroundColor: '#ffffff',
      style: page === target ? { position: 'static', left: '0', top: '0' } : null,
    })
    files.push(new File([blob], `${base}${pages.length > 1 ? `-${i + 1}` : ''}.png`, { type: 'image/png' }))
  }
  return files
}

/**
 * Opens the share sheet with the pictures ("พิมพ์" there opens the iPad print window with its preview).
 * 'cancelled' = the sheet was closed; 'failed' = it did not open (no file sharing, or the tap was too old).
 */
export async function sharePrintPictures(files: File[]): Promise<'shared' | 'cancelled' | 'failed'> {
  if (files.length === 0 || typeof navigator.share !== 'function' || !navigator.canShare?.({ files })) return 'failed'
  try {
    // Files only: a title would be shared as an extra text item next to the pictures.
    await navigator.share({ files })
    return 'shared'
  } catch (error) {
    if (isError(error, 'AbortError')) return 'cancelled'
    console.error('[print] share sheet failed', error)
    return 'failed'
  }
}

/**
 * Home Screen web app, a print button without the document picker: shows "กำลังเตรียมเอกสาร...", turns
 * `target` into pictures, then opens the share sheet. When the iPad refuses to open it by itself (the tap
 * is too old by then), a "พิมพ์" button opens it. Without file sharing, the pictures are shown to
 * long-press › แชร์ › พิมพ์. `onDone` runs when it closes.
 */
export async function shareDocumentImages(target: HTMLElement, title: string | undefined, onDone: () => void): Promise<void> {
  const urls: string[] = []
  const win = openSmallWindow('กำลังเตรียมเอกสาร...', () => {
    urls.forEach((u) => URL.revokeObjectURL(u))
    onDone()
  })

  let files: File[]
  try {
    files = await documentToPictures(target, title)
  } catch (error) {
    console.error('[print] document to picture failed', error)
    if (!win.closed) win.message.textContent = 'เตรียมเอกสารสำหรับพิมพ์ไม่สำเร็จ กรุณาลองใหม่'
    return
  }
  if (win.closed) return

  const showPictures = () => {
    win.message.textContent = 'กดค้างที่ภาพ แล้วเลือก แชร์ › พิมพ์'
    win.body.replaceChildren(
      ...files.map((file) => {
        const url = URL.createObjectURL(file)
        urls.push(url)
        const img = document.createElement('img')
        img.src = url
        img.alt = file.name
        img.className = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white'
        img.style.setProperty('-webkit-touch-callout', 'default')
        return img
      })
    )
  }

  if (typeof navigator.share !== 'function' || !navigator.canShare?.({ files })) {
    showPictures()
    return
  }

  const share = async () => {
    try {
      // Files only: a title would be shared as an extra text item next to the pictures.
      await navigator.share({ files })
      win.close()
    } catch (error) {
      if (isError(error, 'AbortError')) {
        win.close()
      } else if (isError(error, 'NotAllowedError')) {
        win.message.textContent = 'เอกสารพร้อมพิมพ์'
        win.body.replaceChildren(printButton(() => { void share() }))
      } else {
        console.error('[print] share sheet failed', error)
        showPictures()
      }
    }
  }
  await share()
}

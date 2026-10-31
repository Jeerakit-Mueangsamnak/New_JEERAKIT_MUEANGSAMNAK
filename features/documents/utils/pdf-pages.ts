// Browser-only: renders every PDF page to a JPEG data URL so an imported form keeps its exact look.
// Thai text inside PDFs often loses vowels/tone marks when extracted, so pages are kept as images.
// The pages are stored inside the form itself (no separate file), so the whole form must fit the
// library's size limit: each page gets an equal share and is made smaller only when it needs to —
// lower JPEG quality first, then a narrower page. Clean / text pages keep the first (sharpest) step.
const PAGE_WIDTHS_PX = [1000, 820, 680]
const JPEG_QUALITIES = [0.72, 0.6, 0.5, 0.42]

export async function renderPdfPagesToImages(
  buffer: ArrayBuffer,
  maxPages: number,
  totalBudgetChars = Number.POSITIVE_INFINITY
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) })
  try {
    const pdf = await task.promise
    if (pdf.numPages > maxPages) {
      throw new Error(`ไฟล์มี ${pdf.numPages} หน้า (รับได้สูงสุด ${maxPages} หน้า)`)
    }
    const perPageChars = Math.floor(totalBudgetChars / pdf.numPages)
    const images: string[] = []
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo)
      let image = ''
      sizes: for (const widthPx of PAGE_WIDTHS_PX) {
        const viewport = page.getViewport({ scale: widthPx / page.getViewport({ scale: 1 }).width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('เบราว์เซอร์นี้วาดหน้า PDF ไม่ได้')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise
        try {
          for (const quality of JPEG_QUALITIES) {
            image = canvas.toDataURL('image/jpeg', quality)
            if (image.length <= perPageChars) break sizes
          }
        } finally {
          canvas.width = 0
          canvas.height = 0
        }
      }
      images.push(image)
      page.cleanup()
    }
    return images
  } finally {
    await task.destroy()
  }
}

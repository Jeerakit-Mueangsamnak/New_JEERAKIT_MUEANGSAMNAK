// Draws the four chat-menu pictures (owner 2026-11-21: plain background with the button names, no product photos).
//   pnpm exec node scripts/generate-rich-menu-images.mjs
// Reads lib/line/rich-menu.labels.json (the same file the menu code reads, so picture and buttons agree) and writes
// public/line/rich-menu/<KIND>.png at 2500 px wide (LINE: 800–2500 wide, at most 1 MB). Uses the Chromium that Playwright
// already installed, so Thai text is shaped by the browser; nothing is sent anywhere.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { menus } = JSON.parse(fs.readFileSync(path.join(root, 'lib/line/rich-menu.labels.json'), 'utf8'))
const out = path.join(root, 'public/line/rich-menu')
fs.mkdirSync(out, { recursive: true })

const WIDTH = 2500
const ROW = 843
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const browser = await chromium.launch()
try {
  for (const m of menus) {
    const height = ROW * m.rows
    const cells = m.items
      .map((it) => `<div class="cell"><span>${esc(it.label)}</span></div>`)
      .join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${m.colour}}
      .grid{width:${WIDTH}px;height:${height}px;display:grid;grid-template-columns:repeat(${m.cols},1fr);grid-template-rows:repeat(${m.rows},${ROW}px)}
      .cell{display:flex;align-items:center;justify-content:center;text-align:center;padding:0 90px;box-sizing:border-box;
        border:6px solid rgba(255,255,255,.55);color:#fff;font:700 ${m.cols === 3 ? 118 : 138}px/1.25 "Leelawadee UI","Tahoma","Noto Sans Thai","Segoe UI",sans-serif}
    </style></head><body><div class="grid">${cells}</div></body></html>`
    const page = await browser.newPage({ viewport: { width: WIDTH, height }, deviceScaleFactor: 1 })
    await page.setContent(html)
    await page.evaluate(() => document.fonts.ready)
    const file = path.join(out, `${m.kind}.png`)
    await page.screenshot({ path: file, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height } })
    await page.close()
    const bytes = fs.statSync(file).size
    console.log(`${m.kind}: ${WIDTH}x${height}, ${(bytes / 1024).toFixed(0)} KB`)
    if (bytes > 1_000_000) throw new Error(`${m.kind}.png is over 1 MB`)
  }
} finally {
  await browser.close()
}

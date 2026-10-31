import { test, expect } from './fixtures';

// Light and dark mode: every main page is opened in both themes, every visible text is checked
// against the colour actually behind it, and a full-page screenshot is kept for a human look.
// WCAG AA (owner rule 2026-10-27): normal text needs 4.5:1, large text (24px+, or 18.66px+ bold) 3:1.
// Separators like "|" and "•" are skipped.
const PAGES = [
  '/dashboard', '/reports', '/appointments', '/pos', '/bills', '/documents', '/customers',
  '/products', '/quotations', '/finance/statement', '/settings', '/owner-permissions', '/account',
];
const MIN_CONTRAST = 4.5;
const MIN_CONTRAST_LARGE = 3;

type LowContrast = { text: string; ratio: number; fg: string; bg: string; where: string };

for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`${theme}: ${path} text is readable`, async ({ page }, info) => {
      test.skip(info.project.name !== 'chromium', 'colour check runs once, on Chromium');
      await page.addInitScript((t) => localStorage.setItem('rental_pos_theme', t), theme);
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?![\s\S]*\bdark\b)/);

      const issues = await page.evaluate(([minNormal, minLarge]) => {
        const parse = (c: string) => {
          const m = c.match(/rgba?\(([^)]+)\)/)
          if (!m) return null
          const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean)
          return [Number(r), Number(g), Number(b), Number(a)] as const
        }
        const lum = ([r, g, b]: readonly number[]) => {
          const ch = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
          return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
        }
        // Effective background: blend translucent layers from the element up to the page.
        const backgroundOf = (el: Element | null): number[] | null => {
          const layers: (readonly number[])[] = []
          for (let node = el; node; node = node.parentElement) {
            const cs = getComputedStyle(node)
            if (cs.backgroundImage !== 'none') return null // gradient/image: cannot judge, skip
            const c = parse(cs.backgroundColor)
            if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break }
          }
          let out = [255, 255, 255]
          for (const [r, g, b, a] of layers.reverse()) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)]
          return out
        }
        const found: LowContrast[] = []
        const seen = new Set<string>()
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.textContent || '').trim()
          const el = n.parentElement
          if (!text || /^[|•·\-–—/]+$/.test(text) || !el || el.closest('svg, [aria-hidden="true"], .pos-a4-fit-sheet, [data-contrast-skip]')) continue
          const cs = getComputedStyle(el)
          const rect = el.getBoundingClientRect()
          if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3 || rect.width === 0 || rect.height === 0) continue
          if (el.closest('[disabled], [aria-disabled="true"]')) continue
          const fg = parse(cs.color); const bg = backgroundOf(el)
          if (!fg || !bg) continue
          const blended = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])]
          const [hi, lo] = [lum(blended), lum(bg)].sort((a, b) => b - a)
          const ratio = (hi + 0.05) / (lo + 0.05)
          const size = parseFloat(cs.fontSize)
          const min = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? minLarge : minNormal
          const key = `${text.slice(0, 40)}|${cs.color}`
          if (ratio < min && !seen.has(key)) {
            seen.add(key)
            const where = [el.tagName.toLowerCase(), ...(el.className && typeof el.className === 'string' ? [el.className.split(' ').slice(0, 6).join(' ')] : [])].join(' .')
            found.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, fg: cs.color, bg: `rgb(${bg.map(Math.round).join(',')})`, where })
          }
        }
        return found
      }, [MIN_CONTRAST, MIN_CONTRAST_LARGE] as const)

      await page.screenshot({ path: `${process.env.THEME_SHOTS_DIR || 'test-results/theme'}/${theme}${path.replace(/\//g, '_')}.png`, fullPage: true })
      if (issues.length) console.log(`[${theme}] ${path}\n` + issues.map((i) => `  ${i.ratio}:1 "${i.text}" fg=${i.fg} bg=${i.bg} <${i.where}>`).join('\n'))
      expect(issues, `low-contrast text on ${path} (${theme})`).toEqual([])
    });
  }
}

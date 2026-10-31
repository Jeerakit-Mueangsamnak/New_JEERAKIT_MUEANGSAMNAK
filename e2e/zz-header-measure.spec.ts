import { test } from './fixtures';

// TEMPORARY (delete after use): measures the app header at several widths.
for (const theme of ['light', 'dark'] as const) {
  for (const width of [768, 820, 1024, 1280, 1920]) {
    test(`header ${theme} ${width}`, async ({ page }, info) => {
      test.skip(info.project.name !== 'chromium', 'chromium only');
      await page.addInitScript((t) => localStorage.setItem('rental_pos_theme', t), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/bills');
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20000 });
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        const r = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : null);
        const bottom = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().bottom * 10) / 10 : null);
        const header = document.querySelector('main header')
        const menuHead = [...document.querySelectorAll('aside div')].find((d) => d.textContent?.trim().startsWith('เมนูหลัก') && d.children.length <= 2) || null
        const visible = (el: Element) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 }
        const items = header ? [...header.querySelectorAll(':scope > div > *')].filter(visible).map((el) => ({
          what: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18),
          h: r(el),
          bg: getComputedStyle(el).backgroundColor,
        })) : []
        const ctrls = header ? [...header.querySelectorAll(':scope > div > *')].filter(visible) : []
        const root = header?.nextElementSibling?.querySelector('div') as HTMLElement | null
        const rb = root?.getBoundingClientRect(); const cs = root ? getComputedStyle(root) : null
        const align = ctrls.length && rb && cs ? {
          ctrlLeft: Math.round(ctrls[0].getBoundingClientRect().left), contentLeft: Math.round(rb.left + parseFloat(cs.paddingLeft)),
          ctrlRight: Math.round(ctrls[ctrls.length - 1].getBoundingClientRect().right), contentRight: Math.round(rb.right - parseFloat(cs.paddingRight)),
        } : null
        const aside = document.querySelector('aside')
        const hb = header?.getBoundingClientRect()
        const boxes = ctrls.map((el) => el.getBoundingClientRect())
        const gaps = boxes.slice(1).map((b, i) => Math.round((b.left - boxes[i].right) * 10) / 10)
        const vgap = boxes.map((b) => hb ? `${Math.round(b.top - hb.top)}/${Math.round(hb.bottom - 1 - b.bottom)}` : '')
        const menuLabel = [...document.querySelectorAll('aside span')].find((s) => s.textContent?.trim() === 'เมนูหลัก')
        const firstItem = document.querySelector('aside nav a, aside nav [role="button"]')
        const ab = aside?.getBoundingClientRect()
        const menu = ab && menuLabel && firstItem ? {
          labelLeft: Math.round(menuLabel.getBoundingClientRect().left - ab.left),
          itemBoxLeft: Math.round(firstItem.getBoundingClientRect().left - ab.left),
          itemTextLeft: Math.round((firstItem.querySelector('span')?.getBoundingClientRect().left ?? 0) - ab.left),
          itemIconLeft: Math.round((firstItem.querySelector('svg')?.getBoundingClientRect().left ?? 0) - ab.left),
        } : null
        return {
          gaps, vgap, menu,
          align, asideShadow: aside ? getComputedStyle(aside).boxShadow.slice(0, 20) : null,
          headerH: r(header), headerBottom: bottom(header), headerBg: header ? getComputedStyle(header).backgroundColor : null,
          menuHeadVisible: menuHead ? visible(menuHead) && menuHead.getBoundingClientRect().left >= 0 : false,
          menuHeadBottom: bottom(menuHead), menuBg: menuHead ? getComputedStyle(menuHead.parentElement!).backgroundColor : null,
          items,
        }
      })
      console.log(`[${theme} ${width}] ` + JSON.stringify(m))
      await page.screenshot({ path: `${process.env.THEME_SHOTS_DIR || 'test-results/theme'}/header-${theme}-${width}.png`, clip: { x: 0, y: 0, width, height: 140 } })
    });
  }
}

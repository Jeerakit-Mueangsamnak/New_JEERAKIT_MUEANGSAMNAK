/**
 * หมายเหตุ lines of a shop form (owner 2026-11-12). The shop's forms carry their notes as numbered lines
 * ("1.…" … "6.…") written in the form itself, under the "หมายเหตุ" heading. Settings → ภาษีและเอกสาร → หมายเหตุ
 * keeps the shop's own wording per form; at print the form's lines are swapped for it. The stored form is not changed.
 */
import type { DocumentTemplate } from '@/lib/types/document'
import { loadSystemSettings } from '@/features/settings/services/settings-storage'

export const FORM_NOTE_LINES = 6

const decode = (s: string) =>
  s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Each numbered line after the heading: where its text sits in the form (the part after "n."). */
function findNoteLines(schema: string): Array<{ numStart: number; start: number; end: number; text: string }> {
  const heading = schema.indexOf('หมายเหตุ')
  if (heading < 0) return []
  const found: Array<{ numStart: number; start: number; end: number; text: string }> = []
  let from = heading
  for (let n = 1; n <= FORM_NOTE_LINES; n++) {
    const re = new RegExp(`>\\s*${n}\\s*\\.([^<]*)<`, 'g')
    re.lastIndex = from
    const m = re.exec(schema)
    if (!m) break
    const start = m.index + m[0].length - 1 - m[1].length
    found.push({ numStart: m.index + 1, start, end: start + m[1].length, text: decode(m[1]).trim() })
    from = start + m[1].length
  }
  return found
}

/** The form's own note lines (text only, without the number); always FORM_NOTE_LINES long. */
export function readFormNotes(schema: string): string[] {
  const texts = findNoteLines(schema).map((l) => l.text)
  return Array.from({ length: FORM_NOTE_LINES }, (_, i) => texts[i] ?? '')
}

/** The form with its note lines replaced by the shop's wording (lines left as they are when none is saved). */
export function applyFormNotes(schema: string, notes: readonly string[] | undefined): string {
  if (!notes) return schema
  let out = schema
  // from the last line back, so earlier positions stay valid
  findNoteLines(schema).reverse().forEach((line, k, all) => {
    const i = all.length - 1 - k
    if (notes[i] === undefined) return
    const text = notes[i].trim()
    // an emptied line prints nothing, its number included
    out = text ? out.slice(0, line.start) + encode(text) + out.slice(line.end) : out.slice(0, line.numStart) + out.slice(line.end)
  })
  return out
}

/** The form as shown and printed: its หมายเหตุ lines in the shop's wording from Settings (when saved). */
export function formSchemaWithNotes(template: Pick<DocumentTemplate, 'id' | 'templateSchema'>): string {
  return applyFormNotes(template.templateSchema, loadSystemSettings().documentNotes?.[template.id])
}

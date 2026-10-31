import { LINE_LIMITS } from './messages'
import { type LineFlexMessage } from './types'

/**
 * Flex cards the shop sends (driver job, next step, customer notices). One layout for all:
 * title, optional text, label/value rows, buttons. Actions are postbacks, https links or tel:
 * (checked again by assertValidMessages and the database).
 */

export interface FlexRow {
  label: string
  value: string
}

export type FlexButton =
  | { label: string; postback: string; displayText?: string; primary?: boolean }
  | { label: string; uri: string; primary?: boolean }

const BRAND = '#06C755'
const shorten = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`)

function button(b: FlexButton) {
  const label = shorten(b.label, LINE_LIMITS.actionLabelLength)
  const action =
    'postback' in b
      ? { type: 'postback', label, data: b.postback, ...(b.displayText ? { displayText: shorten(b.displayText, 300) } : {}) }
      : { type: 'uri', label, uri: b.uri }
  return { type: 'button', style: b.primary ? 'primary' : 'secondary', height: 'sm', ...(b.primary ? { color: BRAND } : {}), action }
}

export function cardMessage(input: { altText: string; title: string; text?: string; rows?: FlexRow[]; buttons?: FlexButton[] }): LineFlexMessage {
  const rows = (input.rows ?? []).filter((r) => r.value.trim() !== '')
  const body: unknown[] = [{ type: 'text', text: shorten(input.title, 200), weight: 'bold', size: 'md', wrap: true }]
  if (input.text) body.push({ type: 'text', text: shorten(input.text, 2000), size: 'sm', color: '#333333', wrap: true })
  if (rows.length) {
    body.push({ type: 'separator', margin: 'md' })
    body.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      spacing: 'sm',
      contents: rows.map((r) => ({
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          { type: 'text', text: shorten(r.label, 40), size: 'sm', color: '#888888', flex: 2 },
          { type: 'text', text: shorten(r.value, 500), size: 'sm', color: '#111111', flex: 5, wrap: true },
        ],
      })),
    })
  }
  const buttons = (input.buttons ?? []).slice(0, 4)
  return {
    type: 'flex',
    altText: shorten(input.altText, LINE_LIMITS.altTextLength),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      ...(buttons.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons.map(button) } } : {}),
    },
  }
}

/** Google Maps search link for a written place (null when there is no place). */
export function mapUrl(place: string | null | undefined): string | null {
  const p = (place ?? '').trim()
  return p ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.slice(0, 300))}` : null
}

/** tel: link from a written phone (digits and + only; null when too short). */
export function telUrl(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/[^\d+]/g, '')
  return d.replace(/\D/g, '').length >= 9 ? `tel:${d}` : null
}

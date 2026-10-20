import { type LineMessage } from './types'

/** Limits from the LINE Messaging API reference; the database checks the same (_line_messages_valid). */
export const LINE_LIMITS = {
  messagesPerRequest: 5,
  textLength: 5000,
  altTextLength: 400,
  buttonsTextLength: 160,
  buttonsActions: 4,
  actionLabelLength: 20,
  postbackDataLength: 300,
} as const

export class LineMessageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LineMessageError'
  }
}

function isText(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim() !== '' && v.length <= max
}

/** Throws LineMessageError when a message would be refused by LINE or by the outbox. */
export function assertValidMessages(messages: unknown): asserts messages is LineMessage[] {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > LINE_LIMITS.messagesPerRequest) {
    throw new LineMessageError('LINE_MESSAGE_COUNT')
  }
  for (const m of messages as Array<Record<string, unknown>>) {
    if (!m || typeof m !== 'object') throw new LineMessageError('LINE_MESSAGE_SHAPE')
    if (m.type === 'text') {
      if (!isText(m.text, LINE_LIMITS.textLength)) throw new LineMessageError('LINE_TEXT_INVALID')
      continue
    }
    if (m.type === 'template') {
      const t = m.template as { type?: unknown; text?: unknown; actions?: unknown } | undefined
      if (!isText(m.altText, LINE_LIMITS.altTextLength) || !t || t.type !== 'buttons' || !isText(t.text, LINE_LIMITS.buttonsTextLength)) {
        throw new LineMessageError('LINE_TEMPLATE_INVALID')
      }
      if (!Array.isArray(t.actions) || t.actions.length < 1 || t.actions.length > LINE_LIMITS.buttonsActions) {
        throw new LineMessageError('LINE_TEMPLATE_ACTIONS')
      }
      for (const a of t.actions as Array<Record<string, unknown>>) {
        if (!isText(a?.label, LINE_LIMITS.actionLabelLength)) throw new LineMessageError('LINE_ACTION_LABEL')
        if (a.type === 'postback' && isText(a.data, LINE_LIMITS.postbackDataLength)) continue
        if (a.type === 'uri' && typeof a.uri === 'string' && /^https:\/\//.test(a.uri)) continue
        throw new LineMessageError('LINE_ACTION_INVALID')
      }
      continue
    }
    throw new LineMessageError('LINE_MESSAGE_TYPE')
  }
}

/**
 * LINE Messaging API shapes used by the shop (a small, checked subset). Everything under
 * lib/line runs on the server only; nothing here may be imported by a client component.
 */

export interface LineTextMessage {
  type: 'text'
  text: string
}

export type LineAction =
  | { type: 'postback'; label: string; data: string; displayText?: string }
  | { type: 'uri'; label: string; uri: string }

export interface LineButtonsMessage {
  type: 'template'
  altText: string
  template: { type: 'buttons'; text: string; actions: LineAction[] }
}

/** Flex message (bubble / carousel). Actions inside are postbacks, https links or tel: only. */
export interface LineFlexMessage {
  type: 'flex'
  altText: string
  contents: { type: 'bubble' | 'carousel'; [key: string]: unknown }
}

export type LineMessage = LineTextMessage | LineButtonsMessage | LineFlexMessage

/** Result of one call to LINE (or the mock). Never carries the token or the request body. */
export interface ProviderResult {
  ok: boolean
  /** HTTP status; 0 = no answer (network error / timeout). */
  status: number
  requestId?: string
  errorCode?: string
  retryAfterSeconds?: number
}

export interface LineProvider {
  readonly kind: 'mock' | 'http'
  push(input: { to: string; messages: LineMessage[]; retryKey: string }): Promise<ProviderResult>
  reply(input: { replyToken: string; messages: LineMessage[] }): Promise<ProviderResult>
  /** The LINE display name of a friend of the OA (null when LINE does not answer). */
  profile?(userId: string): Promise<{ displayName: string } | null>
}

export const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/

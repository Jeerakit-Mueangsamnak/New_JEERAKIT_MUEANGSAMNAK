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
  profile?(userId: string): Promise<{ displayName: string; pictureUrl?: string | null } | null>
  /** Chat menus (rich menu). Optional: only the real provider and the mock have them. */
  createRichMenu?(body: unknown): Promise<ProviderResult & { richMenuId?: string }>
  uploadRichMenuImage?(richMenuId: string, image: Uint8Array, contentType: string): Promise<ProviderResult>
  /** The menu everyone sees unless they have their own */
  setDefaultRichMenu?(richMenuId: string): Promise<ProviderResult>
  cancelDefaultRichMenu?(): Promise<ProviderResult>
  /** One person's own menu (it wins over the default); unlink = back to the default */
  linkRichMenu?(userId: string, richMenuId: string): Promise<ProviderResult>
  unlinkRichMenu?(userId: string): Promise<ProviderResult>
  deleteRichMenu?(richMenuId: string): Promise<ProviderResult>
}

export const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/

import type { QRCodeToDataURLOptions } from 'qrcode'

/**
 * A QR picture (data URL) for `text`. The qrcode library is loaded the first time a QR is made
 * (LINE links, driver codes, PromptPay), not with the page.
 */
export async function qrDataUrl(text: string, options: QRCodeToDataURLOptions): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(text, options)
}

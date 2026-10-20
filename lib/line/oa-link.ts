/** The shop's official account "send a message" link with the text already typed in. The
 * LINE ID comes from Settings › กิจการ; without it there is no link (the code still works). */
export function lineOaMessageUrl(lineId: string | null | undefined, text: string): string | null {
  const id = (lineId || '').trim()
  if (!/^@?[A-Za-z0-9._-]{2,40}$/.test(id)) return null
  return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(text)}`
}

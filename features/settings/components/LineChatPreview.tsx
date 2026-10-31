'use client'

/**
 * What the recipient sees in LINE (1:1 chat with the shop OA). Used beside Settings › LINE
 * (แจ้งเตือน / ข้อความ) and คนใน LINE. The chat colours are LINE's own and stay the same in dark
 * mode (Master §39.8). Values in the bubbles are samples, never real data.
 */

export interface LineChatBubble {
  /** shop = message from the OA (left), me = what the person typed (right) */
  from: 'shop' | 'me'
  text: string
  /** buttons under a shop message (e.g. รับงาน / เสร็จแล้ว) */
  buttons?: string[]
  /** greyed note instead of a real message */
  empty?: boolean
}

export function LineChatPreview({
  shopName,
  caption,
  bubbles,
  note = 'ใช้ข้อมูลตัวอย่างแทนค่าจริง',
}: {
  shopName: string
  caption?: React.ReactNode
  bubbles: LineChatBubble[]
  note?: string
}) {
  return (
    <div className="space-y-2" data-testid="line-chat-preview">
      {caption && <p className="text-[11px] text-slate-600 dark:text-slate-400">{caption}</p>}
      <div className="rounded-[22px] border-[6px] border-slate-900 dark:border-slate-950 bg-[#8fa8c9] overflow-hidden pb-3">
        <div className="bg-black/20 text-white px-3 py-2 flex items-center gap-2 text-[11px] font-semibold">
          <span className="w-6 h-6 rounded-full bg-[#06C755] grid place-items-center text-[9px] font-bold shrink-0">ร้าน</span>
          <span className="truncate">{shopName}</span>
          <span className="ml-auto font-normal opacity-80">LINE</span>
        </div>
        <div className="px-2.5 pt-3 grid gap-2 content-start min-h-[200px]">
          <span className="justify-self-center text-[10px] text-white bg-black/20 rounded-full px-2.5">วันนี้</span>
          {bubbles.map((b, i) =>
            b.from === 'me' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[220px] rounded-[16px_4px_16px_16px] bg-[#a6e3b8] px-3 py-2 text-[11px] leading-relaxed text-[#111] whitespace-pre-wrap break-words">
                  {b.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-1.5">
                <span className="w-7 h-7 rounded-full bg-[#06C755] grid place-items-center text-[9px] font-bold text-white shrink-0">ร้าน</span>
                <div
                  className={`max-w-[220px] rounded-[4px_16px_16px_16px] bg-white text-[11px] leading-relaxed whitespace-pre-wrap break-words overflow-hidden ${
                    b.empty ? 'italic text-[#6b7078]' : 'text-[#111]'
                  }`}
                >
                  <div className="px-3 py-2">{b.text}</div>
                  {b.buttons && b.buttons.length > 0 && (
                    <div className="border-t border-[#e3e6ea] divide-y divide-[#e3e6ea]">
                      {b.buttons.map((label) => (
                        <div key={label} className="text-center py-1.5 font-semibold text-[#2a62c9]">
                          {label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
      {note && <p className="text-[11px] text-slate-500 dark:text-slate-400">{note}</p>}
    </div>
  )
}

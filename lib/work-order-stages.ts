/**
 * The 9 job steps of an appointment (work_order.events). Same order as the database
 * (_work_order_stages, migration 20261015090000): สั่งงาน and ปิดงาน are the shop's, the steps
 * between are pressed by the dispatched driver on LINE. A step counts for the current dispatch
 * only: the events after the latest DISPATCH (a new driver starts again at รับงาน; the earlier
 * events stay in the list as history).
 */
export interface WorkStage {
  key: string
  label: string
}

export const WORK_ORDER_STAGES_DELIVERY: WorkStage[] = [
  { key: 'DISPATCH', label: 'สั่งงาน' },
  { key: 'ACCEPT', label: 'รับงาน' },
  { key: 'PREPARE', label: 'เตรียม' },
  { key: 'PREPARED', label: 'เตรียมเสร็จ' },
  { key: 'TRANSIT', label: 'ออกส่ง' },
  { key: 'ARRIVED', label: 'ถึงหน้างาน' },
  { key: 'INSPECT', label: 'ตรวจรายการ' },
  { key: 'COMPLETED', label: 'ส่งเสร็จ' },
  { key: 'CLOSED', label: 'ปิดงาน' },
]

export const WORK_ORDER_STAGES_RETURN: WorkStage[] = [
  { key: 'DISPATCH', label: 'สั่งงานเก็บ' },
  { key: 'ACCEPT', label: 'รับงาน' },
  { key: 'TRANSIT', label: 'ออกเก็บ' },
  { key: 'ARRIVED', label: 'ถึงหน้างาน' },
  { key: 'INSPECT', label: 'ตรวจรายการ' },
  { key: 'COLLECTED', label: 'เก็บบางส่วน/ครบ' },
  { key: 'RETURN', label: 'กลับร้าน' },
  { key: 'RECEIVED', label: 'รับคืนสินค้า' },
  { key: 'CLOSED', label: 'ปิดงาน' },
]

/** type = the appointment type code ('RETURN' or anything else). */
export const stagesForType = (type?: string | null): WorkStage[] =>
  type === 'RETURN' ? WORK_ORDER_STAGES_RETURN : WORK_ORDER_STAGES_DELIVERY

/** Label of a step for LINE replies (either list). */
export function stageLabel(key: string, type?: string | null): string {
  const k = key.toUpperCase()
  return (
    stagesForType(type).find((s) => s.key === k)?.label ??
    [...WORK_ORDER_STAGES_DELIVERY, ...WORK_ORDER_STAGES_RETURN].find((s) => s.key === k)?.label ??
    k
  )
}

/**
 * Events of the current dispatch: from the latest DISPATCH on (all of them when none). A
 * WITHDRAW after it (the shop took the driver off the job) ends that dispatch: nothing is current.
 */
export function currentRunEvents<E extends { stage: string; status: string }>(events?: E[]): E[] {
  const list = events ?? []
  let from = 0
  let withdrawn = -1
  list.forEach((e, i) => {
    if (e.status !== 'DONE') return
    const stage = e.stage.toUpperCase()
    if (stage === 'DISPATCH') from = i
    if (stage === 'WITHDRAW') withdrawn = i
  })
  return withdrawn > from ? [] : list.slice(from)
}

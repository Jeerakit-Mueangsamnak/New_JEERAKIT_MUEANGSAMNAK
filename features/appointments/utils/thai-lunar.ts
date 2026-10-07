/**
 * Thai lunar calendar (Suriyayatra) — used to mark วันพระ (ขึ้น/แรม 8 ค่ำ, ขึ้น 15 ค่ำ, แรม 14/15 ค่ำ) on the calendar.
 *
 * Integer arithmetic ported from pythaidate's CsDate/LSYear (MIT License, Copyright 2023 Mark Hollow),
 * which follows J.C. Eade, "The Calendrical Systems of Mainland South-East Asia".
 * Checked against the official Thai calendar for 2569 (every วันพระ) and the 2570 Buddhist holidays.
 */

type CalType = 'A' | 'B' | 'C' | 'c' // A 354 days, B 355 (leap day), C 384 (leap month), c = B+C clash to resolve

interface LSYear {
  horakhun: number
  tithi: number
  langsak: number
  nyd: number
  nextNyd: number
  leapday: boolean
  calType: CalType
  offset: boolean
  offsetDays: number
}

const DAYS_IN_800_YEARS = 292207
const UNITS_PER_DAY = 800
const EPOCH_OFFSET = 373
const CS_JULIAN_DAY_OFFSET = 1954167
const UNIX_EPOCH_JD = 2440588

const fdiv = (a: number, b: number) => Math.floor(a / b)
const mod = (a: number, b: number) => ((a % b) + b) % b

function lsYear(year: number): LSYear {
  const base = year * DAYS_IN_800_YEARS + EPOCH_OFFSET
  const horakhun = fdiv(base, UNITS_PER_DAY) + 1
  const kammacapon = UNITS_PER_DAY - mod(base, UNITS_PER_DAY)
  const avoQuot = fdiv(horakhun * 11 + 650, 692)
  let avoman = mod(horakhun * 11 + 650, 692)
  if (avoman === 0) avoman = 692
  let tithi = mod(avoQuot + horakhun, 30)
  if (avoman === 692) tithi -= 1
  const weekday = mod(horakhun, 7)

  const horakhun1 = fdiv((year + 1) * DAYS_IN_800_YEARS + EPOCH_OFFSET, UNITS_PER_DAY) + 1
  const tithi1 = mod(fdiv(horakhun1 * 11 + 650, 692) + horakhun1, 30)

  const langsak = Math.max(1, tithi)
  let nyd = langsak
  if (nyd < 6) nyd += 29
  nyd = mod(weekday - nyd + 1 + 35, 7)

  const leapday = kammacapon <= 207

  let calType: CalType = 'A'
  if (tithi > 24 || tithi < 6) calType = 'C'
  if (tithi === 25 && tithi1 === 5) calType = 'A'
  if ((leapday && avoman <= 126) || (!leapday && avoman <= 137)) calType = calType !== 'C' ? 'B' : 'c'

  const nextNyd = mod(nyd + (calType === 'A' ? 4 : calType === 'B' ? 5 : 6), 7)
  return { horakhun, tithi, langsak, nyd, nextNyd, leapday, calType, offset: false, offsetDays: 0 }
}

const year0Cache = new Map<number, LSYear>()

function calculateYear0(year: number): LSYear {
  const cached = year0Cache.get(year)
  if (cached) return cached

  const y = [lsYear(year - 2), lsYear(year - 1), lsYear(year), lsYear(year + 1), lsYear(year + 2)]

  for (let i = 0; i < 5; i++) {
    if (y[2].tithi === 24 && y[3].tithi === 6) {
      y[i].calType = 'C'
      y[i].nextNyd = mod(y[i].nextNyd + 2, 7)
    }
  }
  // A leap day and a leap month can't share a year: move the leap day to the neighbouring year
  // that keeps the weekday sequence correct.
  for (const i of [1, 2, 3]) {
    if (y[i].calType === 'c') {
      const j = y[i].nyd === y[i - 1].nextNyd ? 1 : -1
      y[i + j].calType = 'B'
      y[i + j].nextNyd = mod(y[i + j].nextNyd + 1, 7)
    }
  }
  for (const i of [1, 2, 3]) {
    if (y[i - 1].nextNyd !== y[i].nyd && y[i].nextNyd !== y[i + 1].nyd) {
      y[i].offset = true
      y[i].langsak += 1
      y[i].nyd = mod(y[i].nyd + 6, 7)
      y[i].nextNyd = mod(y[i].nextNyd + 6, 7)
    }
  }
  for (const item of y) if (item.calType === 'c') item.calType = 'C'

  const y0 = y[2]
  y0.offsetDays = y0.langsak
  if (y0.offsetDays < 6 + Number(y0.offset)) y0.offsetDays += 29

  year0Cache.set(year, y0)
  return y0
}

// Day-of-year thresholds per calendar type → lunar day within the month (1–30).
const MONTH_STARTS: Record<'A' | 'B' | 'C', number[]> = {
  A: [383, 354, 324, 295, 265, 236, 206, 177, 147, 118, 88, 59, 29],
  B: [384, 355, 325, 296, 266, 237, 207, 178, 148, 119, 89, 59, 29],
  C: [384, 354, 325, 295, 266, 236, 207, 177, 148, 118, 88, 59, 29],
}

function lunarDayOfMonth(cal: 'A' | 'B' | 'C', days: number): number {
  for (const start of MONTH_STARTS[cal]) {
    if (days > start) return days - start
  }
  return days
}

/** Lunar day of month (1–15 = ขึ้น, 16–30 = แรม) for a Julian Day Number. */
function lunarDayFromJd(jd: number): number {
  const hk = jd - CS_JULIAN_DAY_OFFSET
  let year = fdiv(hk * 800 - 373, DAYS_IN_800_YEARS)
  let days: number
  if (mod(hk, DAYS_IN_800_YEARS) === 95333) {
    year -= 1
    days = 365
  } else {
    days = hk - calculateYear0(year).horakhun
  }
  let y0 = calculateYear0(year)
  let daysInYear = 365 + Number(y0.leapday)
  while (days > daysInYear) {
    year += 1
    days -= daysInYear
    y0 = calculateYear0(year)
    daysInYear = 365 + Number(y0.leapday)
  }
  return lunarDayOfMonth(y0.calType as 'A' | 'B' | 'C', y0.offsetDays + days)
}

const toJd = (d: Date) => fdiv(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()), 86400000) + UNIX_EPOCH_JD

/** วันพระ: ขึ้น 8, ขึ้น 15, แรม 8 ค่ำ, and the last day of the month (แรม 14 or 15 ค่ำ). */
export function isBuddhistHolyDay(date: Date): boolean {
  const jd = toJd(date)
  const day = lunarDayFromJd(jd)
  return day === 8 || day === 15 || day === 23 || lunarDayFromJd(jd + 1) === 1
}

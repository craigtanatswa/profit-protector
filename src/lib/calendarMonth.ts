/** Local-device calendar month boundaries (shopkeeper sales scope). */

export function getLocalCalendarMonthBoundsIso(now = new Date()): {
  monthStartIso: string
  monthEndIso: string
} {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { monthStartIso: start.toISOString(), monthEndIso: end.toISOString() }
}

export function getLocalCalendarMonthBoundsMs(now = new Date()): {
  start: number
  end: number
} {
  const { monthStartIso, monthEndIso } = getLocalCalendarMonthBoundsIso(now)
  return {
    start: new Date(monthStartIso).getTime(),
    end: new Date(monthEndIso).getTime(),
  }
}

/** Stable key for “current calendar month” — bumps when month rolls over. */
export function calendarMonthKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth()}`
}

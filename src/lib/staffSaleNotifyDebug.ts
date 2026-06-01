const PREFIX = '[staff-sale-notify]'

/**
 * Trace staff sale notifications in Metro/device logs.
 * Filter console output with: staff-sale-notify
 */
export function logStaffSaleNotify(
  step: string,
  detail?: Record<string, unknown> | string,
): void {
  if (!__DEV__) return

  if (detail === undefined) {
    console.log(PREFIX, step)
    return
  }

  if (typeof detail === 'string') {
    console.log(PREFIX, step, detail)
    return
  }

  console.log(PREFIX, step, detail)
}

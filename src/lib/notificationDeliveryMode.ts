/**
 * While the user has an active app session (owner signed in or shopkeeper mode),
 * business alerts use the in-app banner sink instead of OS local notifications.
 * On login / staff entry this is true; on login screen it is false so scheduled locals can appear.
 */
let businessAlertsPreferInAppOnly = false

export function setBusinessAlertsPreferInAppOnly(value: boolean) {
  businessAlertsPreferInAppOnly = value
}

export function shouldScheduleOsLocalBusinessAlerts(): boolean {
  return !businessAlertsPreferInAppOnly
}

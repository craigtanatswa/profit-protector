import { createContext, useContext } from 'react'

export type AppChromeContextValue = {
  /**
   * When true, `StaffModeBanner` already pads the top by the status-bar inset,
   * so screens under the tab navigator must not add `insets.top` again.
   */
  staffBannerConsumesTopSafeArea: boolean
}

export const AppChromeContext = createContext<AppChromeContextValue>({
  staffBannerConsumesTopSafeArea: false,
})

export function useAppChrome(): AppChromeContextValue {
  return useContext(AppChromeContext)
}

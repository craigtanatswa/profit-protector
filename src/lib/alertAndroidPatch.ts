import { Alert, Platform } from 'react-native'

import { enqueueAlert } from './appAlertQueue'

const PATCH_KEY = '__profitProtectorAppAlertPatched'
const root = globalThis as typeof globalThis & { [PATCH_KEY]?: boolean }

if (Platform.OS === 'android' && !root[PATCH_KEY]) {
  root[PATCH_KEY] = true
  const nativeAlert = Alert.alert.bind(Alert)
  Alert.alert = (title, message, buttons, options) => {
    const resolvedButtons =
      buttons && buttons.length > 0 ? [...buttons] : [{ text: 'OK' }]
    enqueueAlert({
      title: title ?? '',
      message,
      buttons: resolvedButtons,
      options,
      fallback: () => nativeAlert(title, message, buttons, options),
    })
  }
}

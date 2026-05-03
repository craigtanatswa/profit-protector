import * as Application from 'expo-application'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

const DEVICE_ID_KEY = 'pp_device_id'

export async function getDeviceId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY)
  if (stored) return stored

  const androidId = Application.getAndroidId() ?? ''
  const random = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    androidId + Date.now().toString(),
  )
  const deviceId = random.slice(0, 32)
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId)
  return deviceId
}

export async function getDeviceName(): Promise<string> {
  return Application.applicationName ?? 'Android Device'
}

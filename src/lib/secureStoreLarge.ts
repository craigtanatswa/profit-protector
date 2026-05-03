import * as SecureStore from 'expo-secure-store'

const META_SUFFIX = '-pp-chunk-meta'
const CHUNK_SUFFIX = '-pp-chunk-'

/** Keep under expo-secure-store ~2048 byte limit (UTF-8) */
const MAX_VALUE_BYTES = 2000

function metaKey(storageKey: string) {
  return `${storageKey}${META_SUFFIX}`
}

function chunkKey(storageKey: string, index: number) {
  return `${storageKey}${CHUNK_SUFFIX}${index}`
}

async function deleteChunks(storageKey: string): Promise<void> {
  const meta = await SecureStore.getItemAsync(metaKey(storageKey))
  if (meta) {
    const count = parseInt(meta, 10)
    if (Number.isFinite(count) && count > 0) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(chunkKey(storageKey, i)).catch(() => {})
      }
    }
    await SecureStore.deleteItemAsync(metaKey(storageKey)).catch(() => {})
  }
}

function splitUtf8ToChunks(value: string): string[] {
  const enc = new TextEncoder()
  const bytes = enc.encode(value)
  if (bytes.length <= MAX_VALUE_BYTES) return [value]
  const chunks: string[] = []
  const dec = new TextDecoder()
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + MAX_VALUE_BYTES, bytes.length)
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end--
      if (end === start) end = start + 1
    }
    chunks.push(dec.decode(bytes.subarray(start, end)))
    start = end
  }
  return chunks
}

/**
 * Persists a string in SecureStore, splitting into multiple keys when value exceeds the platform limit
 * (e.g. Supabase auth session JSON).
 */
export async function secureStoreSetLarge(storageKey: string, value: string): Promise<void> {
  await deleteChunks(storageKey)
  await SecureStore.deleteItemAsync(storageKey).catch(() => {})

  const byteLen = new TextEncoder().encode(value).length
  if (__DEV__) {
    console.log(`[SecureStore] set "${storageKey}" ${byteLen} bytes`)
  }

  if (byteLen <= MAX_VALUE_BYTES) {
    await SecureStore.setItemAsync(storageKey, value)
    return
  }

  const parts = splitUtf8ToChunks(value)
  await SecureStore.setItemAsync(metaKey(storageKey), String(parts.length))
  for (let i = 0; i < parts.length; i++) {
    await SecureStore.setItemAsync(chunkKey(storageKey, i), parts[i])
  }
}

export async function secureStoreGetLarge(storageKey: string): Promise<string | null> {
  const meta = await SecureStore.getItemAsync(metaKey(storageKey))
  if (meta) {
    const count = parseInt(meta, 10)
    if (!Number.isFinite(count) || count < 1) return null
    let out = ''
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(storageKey, i))
      if (part == null) return null
      out += part
    }
    return out
  }
  return SecureStore.getItemAsync(storageKey)
}

export async function secureStoreRemoveLarge(storageKey: string): Promise<void> {
  await deleteChunks(storageKey)
  await SecureStore.deleteItemAsync(storageKey).catch(() => {})
}

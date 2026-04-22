import { File as FsFile, Paths } from 'expo-file-system'
import { copyAsync } from 'expo-file-system/legacy'

const LOGO_BASENAME = 'pp-business-logo'
const LOGO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const

function extensionFromMime(mime: string): (typeof LOGO_EXTENSIONS)[number] | null {
  const m = mime.toLowerCase()
  if (m.includes('png')) return '.png'
  if (m.includes('webp')) return '.webp'
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg'
  return null
}

function logoCandidates(): FsFile[] {
  return LOGO_EXTENSIONS.map((ext) => new FsFile(Paths.document, `${LOGO_BASENAME}${ext}`))
}

/** File URI for React Native <Image source={{ uri }}>, or null if none saved. */
export function getBusinessLogoDisplayUri(): string | null {
  for (const f of logoCandidates()) {
    if (f.exists) return f.uri
  }
  return null
}

export function hasBusinessLogo(): boolean {
  return getBusinessLogoDisplayUri() != null
}

/** data:image/...;base64,... for HTML print/PDF, or null */
export async function getBusinessLogoDataUri(): Promise<string | null> {
  for (const f of logoCandidates()) {
    if (!f.exists) continue
    try {
      const b64 = await f.base64()
      const ext = f.extension.toLowerCase()
      const mime =
        ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
      return `data:${mime};base64,${b64}`
    } catch {
      return null
    }
  }
  return null
}

export function removeBusinessLogo(): void {
  for (const f of logoCandidates()) {
    if (f.exists) {
      try {
        f.delete()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Opens the system file picker (images only) and saves the selection as the business logo.
 * Uses expo-file-system's picker — same native module as the rest of this file — so it works
 * without expo-image-picker / ExponentImagePicker in the dev client.
 */
export async function pickAndSaveBusinessLogoFromDevice(): Promise<void> {
  const result = (await FsFile.pickFileAsync(undefined, 'image/*')) as FsFile | FsFile[]
  const picked: FsFile | undefined = Array.isArray(result) ? result[0] : result
  if (picked == null || !picked.exists) {
    throw new Error('No image selected')
  }

  let ext = picked.extension.toLowerCase()
  if (!LOGO_EXTENSIONS.includes(ext as (typeof LOGO_EXTENSIONS)[number])) {
    const fromMime = extensionFromMime(picked.type ?? '')
    if (fromMime) {
      ext = fromMime
    } else {
      throw new Error('Please choose a JPG, PNG, or WebP image.')
    }
  }

  removeBusinessLogo()
  const dest = new FsFile(Paths.document, `${LOGO_BASENAME}${ext}`)
  // Android document picker returns content:// URIs; File.copy() only supports file:// paths.
  // Legacy copyAsync uses the platform copy path that reads content URIs into app storage.
  await copyAsync({ from: picked.uri, to: dest.uri })
}

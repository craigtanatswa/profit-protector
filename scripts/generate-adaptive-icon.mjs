/**
 * Builds assets/adaptive-icon-foreground.png for Android launcher icons.
 *
 * Android adaptive icons mask/crop the outer ~17% of the foreground layer.
 * Keep the full circled logo inside the center 66% "safe zone":
 *   - Canvas: 1024 x 1024 px
 *   - Logo width: ~670 px (~65% of canvas)
 *   - Black background in icon.png is made transparent so backgroundColor shows through
 *
 * Re-run after changing assets/icon.png:
 *   node scripts/generate-adaptive-icon.mjs
 */

import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const source = path.join(root, 'assets', 'icon.png')
const output = path.join(root, 'assets', 'adaptive-icon-foreground.png')

const CANVAS = 1024
const LOGO_SIZE = 670
const BLACK_THRESHOLD = 40

const resized = await sharp(source)
  .resize(LOGO_SIZE, LOGO_SIZE, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const { data, info } = resized

for (let i = 0; i < data.length; i += 4) {
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  if (r <= BLACK_THRESHOLD && g <= BLACK_THRESHOLD && b <= BLACK_THRESHOLD) {
    data[i + 3] = 0
  }
}

const logo = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png()
  .toBuffer()

const left = Math.round((CANVAS - info.width) / 2)
const top = Math.round((CANVAS - info.height) / 2)

await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: logo, left, top }])
  .png()
  .toFile(output)

console.log(`Wrote ${output}`)

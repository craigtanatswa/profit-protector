import type { Product, ProductTrackingMode } from '../types'

export function normalizeTrackingMode(raw: unknown): ProductTrackingMode {
  return raw === 'cut' ? 'cut' : 'count'
}

export function isCutProduct(
  product: Pick<Product, 'trackingMode'> | { trackingMode?: string | null },
): boolean {
  return product.trackingMode === 'cut'
}

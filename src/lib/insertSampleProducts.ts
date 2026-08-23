import { database } from '../database'
import Business from '../database/models/Business'
import type ProductModel from '../database/models/Product'
import { supabase } from './supabase'
import { getPersonalisation, normalizeBusinessType } from './appPersonalisation'

export async function insertSampleProductsForBusiness(businessId: string): Promise<void> {
  const db = database
  if (!db) return

  let bizType = 'tuck_shop'
  try {
    const biz = await db.get<Business>('businesses').find(businessId)
    bizType = normalizeBusinessType(biz.businessType)
  } catch {
    // ignore
  }

  const { sampleProducts } = getPersonalisation(bizType)

  for (const sp of sampleProducts) {
    await db.write(async () => {
      const product = await db.get<ProductModel>('products').create((p) => {
        p.businessId = businessId
        p.name = sp.name
        p.category = sp.category
        p.unit = sp.unit
        p.trackingMode = 'count'
        p.costPriceCents = sp.suggestedCostCents
        p.sellingPriceCents = sp.suggestedPriceCents
        p.stockQty = 10
        p.lowStockThreshold = 5
        p.isActive = true
        p.updatedAt = new Date()
      })
      supabase
        .from('products')
        .insert({
          id: product.id,
          business_id: businessId,
          name: sp.name,
          category: sp.category,
          unit: sp.unit,
          tracking_mode: 'count',
          cost_price_cents: sp.suggestedCostCents,
          selling_price_cents: sp.suggestedPriceCents,
          stock_qty: 10,
          low_stock_threshold: 5,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) console.warn('Sample product sync:', error.message)
        })
    })
  }
}

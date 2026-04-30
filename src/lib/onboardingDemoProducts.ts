import type { BusinessType } from '../stores/onboardingStore'

export interface DemoProductRow {
  name: string
  price: number
  cost: number
  qty: number
}

export function getDemoProductsForBusinessType(
  businessType: BusinessType | null,
): DemoProductRow[] {
  const t = businessType ?? 'tuck_shop'

  const sets: Record<BusinessType, DemoProductRow[]> = {
    tuck_shop: [
      { name: 'Cooking Oil 2L', price: 450, cost: 320, qty: 2 },
      { name: 'Sugar 2kg', price: 200, cost: 140, qty: 1 },
      { name: 'Bread', price: 120, cost: 80, qty: 3 },
    ],
    hardware: [
      { name: 'Padlock 60mm', price: 350, cost: 220, qty: 1 },
      { name: 'Paint Brush 2"', price: 150, cost: 90, qty: 2 },
      { name: 'Nails 2kg bag', price: 280, cost: 180, qty: 1 },
    ],
    tech_shop: [
      { name: 'USB-C Cable 1m', price: 650, cost: 350, qty: 3 },
      { name: 'Screen Protector', price: 450, cost: 220, qty: 2 },
      { name: 'Power Bank 10000mAh', price: 2200, cost: 1400, qty: 1 },
    ],
    salon: [
      { name: 'Relaxer Treatment', price: 800, cost: 450, qty: 1 },
      { name: 'Hair Shampoo', price: 350, cost: 200, qty: 1 },
      { name: 'Styling Gel', price: 250, cost: 150, qty: 2 },
    ],
    clothing: [
      { name: 'T-Shirt (M)', price: 500, cost: 300, qty: 2 },
      { name: 'Jeans (32)', price: 1200, cost: 750, qty: 1 },
      { name: 'Cap', price: 350, cost: 200, qty: 1 },
    ],
    pharmacy: [
      { name: 'Paracetamol 500mg', price: 150, cost: 80, qty: 2 },
      { name: 'Cough Syrup', price: 420, cost: 260, qty: 1 },
      { name: 'Vitamins C 30s', price: 380, cost: 220, qty: 1 },
    ],
    restaurant: [
      { name: 'Sadza & Beef', price: 450, cost: 260, qty: 2 },
      { name: 'Chicken & Chips', price: 600, cost: 350, qty: 1 },
      { name: 'Soft Drink', price: 150, cost: 80, qty: 3 },
    ],
    other: [
      { name: 'Cooking Oil 2L', price: 450, cost: 320, qty: 2 },
      { name: 'Sugar 2kg', price: 200, cost: 140, qty: 1 },
      { name: 'Bread', price: 120, cost: 80, qty: 3 },
    ],
  }

  return sets[t] ?? sets.tuck_shop
}

export function computeDemoTotals(rows: DemoProductRow[]): {
  totalRevenue: number
  totalCost: number
  totalProfit: number
} {
  let totalRevenue = 0
  let totalCost = 0
  for (const r of rows) {
    totalRevenue += r.price * r.qty
    totalCost += r.cost * r.qty
  }
  return {
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
  }
}

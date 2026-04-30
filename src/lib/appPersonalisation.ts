/** Normalises legacy `business_type` strings from older installs */
export function normalizeBusinessType(raw: string): string {
  const legacy: Record<string, string> = {
    'Retail Shop': 'tuck_shop',
    Hardware: 'hardware',
    'Salon/Barber': 'salon',
    'Restaurant/Takeaway': 'restaurant',
    Pharmacy: 'pharmacy',
    Other: 'other',
  }
  return legacy[raw] ?? raw
}

export interface AppPersonalisation {
  defaultCategories: string[]
  sampleProducts: Array<{
    name: string
    category: string
    unit: string
    suggestedCostCents: number
    suggestedPriceCents: number
  }>
  dashboardGreetingContext: string
  lowStockMessage: string
  receiptFooter: string
  currencyDefault: string
}

export function getPersonalisation(businessType: string): AppPersonalisation {
  const t = normalizeBusinessType(businessType)

  const tuckShop: AppPersonalisation = {
    defaultCategories: ['Groceries', 'Beverages', 'Household', 'Snacks'],
    sampleProducts: [
      {
        name: 'Cooking Oil 2L',
        category: 'Groceries',
        unit: 'Each',
        suggestedCostCents: 320,
        suggestedPriceCents: 450,
      },
      {
        name: 'Sugar 2kg',
        category: 'Groceries',
        unit: 'Each',
        suggestedCostCents: 140,
        suggestedPriceCents: 200,
      },
      {
        name: 'Coca Cola 500ml',
        category: 'Beverages',
        unit: 'Each',
        suggestedCostCents: 80,
        suggestedPriceCents: 130,
      },
    ],
    dashboardGreetingContext: 'shop',
    lowStockMessage: 'Running low — time to reorder',
    receiptFooter: 'Thank you for shopping with us!',
    currencyDefault: 'usd',
  }

  const techShop: AppPersonalisation = {
    defaultCategories: ['Phones', 'Accessories', 'Audio', 'Chargers & Cables', 'Computing'],
    sampleProducts: [
      {
        name: 'USB-C Cable 1m',
        category: 'Chargers & Cables',
        unit: 'Each',
        suggestedCostCents: 350,
        suggestedPriceCents: 650,
      },
      {
        name: 'Phone Case (Universal)',
        category: 'Accessories',
        unit: 'Each',
        suggestedCostCents: 400,
        suggestedPriceCents: 750,
      },
      {
        name: 'Wireless Earbuds',
        category: 'Audio',
        unit: 'Each',
        suggestedCostCents: 2500,
        suggestedPriceCents: 4500,
      },
    ],
    dashboardGreetingContext: 'shop',
    lowStockMessage: 'Gadget running low — reorder popular items',
    receiptFooter: 'Thank you — enjoy your tech!',
    currencyDefault: 'usd',
  }

  const hardware: AppPersonalisation = {
    defaultCategories: ['Tools', 'Paint', 'Plumbing', 'Electrical', 'Fasteners'],
    sampleProducts: [
      {
        name: 'Hammer',
        category: 'Tools',
        unit: 'Each',
        suggestedCostCents: 550,
        suggestedPriceCents: 850,
      },
      {
        name: 'Paint 5L',
        category: 'Paint',
        unit: 'Each',
        suggestedCostCents: 1200,
        suggestedPriceCents: 1800,
      },
      {
        name: 'PVC Pipe 2m',
        category: 'Plumbing',
        unit: 'Each',
        suggestedCostCents: 350,
        suggestedPriceCents: 550,
      },
    ],
    dashboardGreetingContext: 'store',
    lowStockMessage: 'Stock low — order before you run out',
    receiptFooter: 'Thank you for your business!',
    currencyDefault: 'usd',
  }

  const salon: AppPersonalisation = {
    defaultCategories: ['Hair Products', 'Nail Products', 'Skin Care', 'Services'],
    sampleProducts: [
      {
        name: 'Relaxer',
        category: 'Hair Products',
        unit: 'Each',
        suggestedCostCents: 450,
        suggestedPriceCents: 800,
      },
      {
        name: 'Shampoo',
        category: 'Hair Products',
        unit: 'Each',
        suggestedCostCents: 200,
        suggestedPriceCents: 350,
      },
      {
        name: 'Hair Colour',
        category: 'Hair Products',
        unit: 'Each',
        suggestedCostCents: 300,
        suggestedPriceCents: 500,
      },
    ],
    dashboardGreetingContext: 'salon',
    lowStockMessage: 'Product running low',
    receiptFooter: 'Thank you — see you again soon!',
    currencyDefault: 'usd',
  }

  const clothing: AppPersonalisation = {
    defaultCategories: ['Tops', 'Bottoms', 'Dresses', 'Accessories', 'Shoes'],
    sampleProducts: [
      {
        name: 'T-Shirt',
        category: 'Tops',
        unit: 'Each',
        suggestedCostCents: 300,
        suggestedPriceCents: 500,
      },
      {
        name: 'Jeans',
        category: 'Bottoms',
        unit: 'Each',
        suggestedCostCents: 750,
        suggestedPriceCents: 1200,
      },
      {
        name: 'Cap',
        category: 'Accessories',
        unit: 'Each',
        suggestedCostCents: 200,
        suggestedPriceCents: 350,
      },
    ],
    dashboardGreetingContext: 'shop',
    lowStockMessage: 'Size running low — restock soon',
    receiptFooter: 'Thank you for shopping with us!',
    currencyDefault: 'usd',
  }

  const pharmacy: AppPersonalisation = {
    defaultCategories: ['Medication', 'Vitamins', 'First Aid', 'Baby Care', 'Personal Care'],
    sampleProducts: [
      {
        name: 'Paracetamol 500mg x20',
        category: 'Medication',
        unit: 'Pack',
        suggestedCostCents: 80,
        suggestedPriceCents: 150,
      },
      {
        name: 'Vitamin C 30s',
        category: 'Vitamins',
        unit: 'Box',
        suggestedCostCents: 220,
        suggestedPriceCents: 380,
      },
      {
        name: 'Bandage Roll',
        category: 'First Aid',
        unit: 'Each',
        suggestedCostCents: 120,
        suggestedPriceCents: 200,
      },
    ],
    dashboardGreetingContext: 'pharmacy',
    lowStockMessage: 'Medication running low',
    receiptFooter: 'Your health is our priority.',
    currencyDefault: 'usd',
  }

  const restaurant: AppPersonalisation = {
    defaultCategories: ['Main Meals', 'Sides', 'Drinks', 'Snacks'],
    sampleProducts: [
      {
        name: 'Sadza & Beef',
        category: 'Main Meals',
        unit: 'Plate',
        suggestedCostCents: 260,
        suggestedPriceCents: 450,
      },
      {
        name: 'Chicken & Chips',
        category: 'Main Meals',
        unit: 'Plate',
        suggestedCostCents: 350,
        suggestedPriceCents: 600,
      },
      {
        name: 'Soft Drink',
        category: 'Drinks',
        unit: 'Each',
        suggestedCostCents: 80,
        suggestedPriceCents: 150,
      },
    ],
    dashboardGreetingContext: 'kitchen',
    lowStockMessage: 'Ingredient running low',
    receiptFooter: 'Thank you — enjoy your meal!',
    currencyDefault: 'usd',
  }

  switch (t) {
    case 'hardware':
      return hardware
    case 'tech_shop':
      return techShop
    case 'salon':
      return salon
    case 'clothing':
      return clothing
    case 'pharmacy':
      return pharmacy
    case 'restaurant':
      return restaurant
    case 'tuck_shop':
    case 'other':
    default:
      return tuckShop
  }
}

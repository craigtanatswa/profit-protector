import { create } from 'zustand'
import { lineTotalCents } from '../lib/quantity'
import type { ProductTrackingMode } from '../types'

type PaymentMethod = 'cash_usd' | 'cash_zig' | 'ecocash' | 'bank_transfer' | 'credit'

interface CartItem {
  productId: string
  productName: string
  qty: number
  unitPriceCents: number
  costPriceCents: number
  unit?: string
  trackingMode?: ProductTrackingMode
}

interface CartState {
  items: CartItem[]
  discountCents: number
  paymentMethod: PaymentMethod
  customerId: string | null

  addItem: (product: Omit<CartItem, 'qty'>, qty: number) => void
  updateItemQty: (productId: string, qty: number) => void
  removeItem: (productId: string) => void
  setDiscount: (cents: number) => void
  setPaymentMethod: (method: PaymentMethod) => void
  setCustomer: (customerId: string | null) => void
  clearCart: () => void

  get subtotalCents(): number
  get totalCents(): number
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  discountCents: 0,
  paymentMethod: 'cash_usd',
  customerId: null,

  addItem: (product, qty) =>
    set((state) => {
      const existing = state.items.find((i) => i.productId === product.productId)
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === product.productId
              ? { ...i, qty: i.qty + qty }
              : i
          ),
        }
      }
      return { items: [...state.items, { ...product, qty }] }
    }),

  updateItemQty: (productId, qty) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.productId === productId ? { ...i, qty } : i
      ),
    })),

  removeItem: (productId) =>
    set((state) => ({
      items: state.items.filter((i) => i.productId !== productId),
    })),

  setDiscount: (cents) => set({ discountCents: cents }),

  setPaymentMethod: (method) => set({ paymentMethod: method }),

  setCustomer: (customerId) => set({ customerId }),

  clearCart: () =>
    set({
      items: [],
      discountCents: 0,
      paymentMethod: 'cash_usd',
      customerId: null,
    }),

  get subtotalCents(): number {
    return get().items.reduce((sum, i) => sum + lineTotalCents(i.qty, i.unitPriceCents), 0)
  },

  get totalCents(): number {
    return get().subtotalCents - get().discountCents
  },
}))

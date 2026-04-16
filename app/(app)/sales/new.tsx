/*
 * Run this SQL in Supabase SQL Editor if not already done:
 *
 * create table sales (
 *   id text primary key,
 *   business_id text references businesses(id),
 *   total_cents integer not null,
 *   discount_cents integer not null default 0,
 *   payment_method text not null,
 *   note text,
 *   receipt_number text not null,
 *   created_at timestamptz default now()
 * );
 *
 * create table sale_items (
 *   id text primary key,
 *   sale_id text references sales(id),
 *   product_id text,
 *   product_name_snapshot text not null,
 *   qty integer not null,
 *   unit_price_cents integer not null,
 *   cost_price_cents integer not null
 * );
 *
 * create table stock_movements (
 *   id text primary key,
 *   business_id text references businesses(id),
 *   product_id text,
 *   product_name_snapshot text not null,
 *   action text not null,
 *   qty_change integer not null,
 *   reason text,
 *   supplier text,
 *   created_at timestamptz default now()
 * );
 *
 * create table customers (
 *   id text primary key,
 *   business_id text references businesses(id),
 *   name text not null,
 *   phone text,
 *   outstanding_balance_cents integer not null default 0,
 *   created_at timestamptz default now()
 * );
 *
 * create table credit_sales (
 *   id text primary key,
 *   sale_id text references sales(id),
 *   customer_id text references customers(id),
 *   amount_cents integer not null,
 *   amount_paid_cents integer not null default 0,
 *   is_settled boolean not null default false,
 *   created_at timestamptz default now()
 * );
 *
 * alter table sales enable row level security;
 * alter table sale_items enable row level security;
 * alter table stock_movements enable row level security;
 * alter table customers enable row level security;
 * alter table credit_sales enable row level security;
 *
 * create policy "Users manage their sales"
 *   on sales for all using (
 *     business_id in (select id from businesses where user_id = auth.uid())
 *   );
 * create policy "Users manage their sale items"
 *   on sale_items for all using (
 *     sale_id in (select id from sales where business_id in (
 *       select id from businesses where user_id = auth.uid()
 *     ))
 *   );
 * create policy "Users manage their stock movements"
 *   on stock_movements for all using (
 *     business_id in (select id from businesses where user_id = auth.uid())
 *   );
 * create policy "Users manage their customers"
 *   on customers for all using (
 *     business_id in (select id from businesses where user_id = auth.uid())
 *   );
 * create policy "Users manage their credit sales"
 *   on credit_sales for all using (
 *     customer_id in (select id from customers where business_id in (
 *       select id from businesses where user_id = auth.uid()
 *     ))
 *   );
 */

import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

import { ScreenHeader } from '../../../src/components/layout'
import { Badge, Button, EmptyState } from '../../../src/components/ui'
import { useAuthStore } from '../../../src/stores/authStore'
import { useCartStore } from '../../../src/stores/cartStore'
import { useProducts } from '../../../src/hooks/useProducts'
import { useSales } from '../../../src/hooks/useSales'
import { useCustomers } from '../../../src/hooks/useCustomers'
import { database } from '../../../src/database'
import { supabase } from '../../../src/lib/supabase'
import { formatCurrency, formatReceiptNumber } from '../../../src/lib/formatters'
import type { Product, Customer } from '../../../src/types'
import type ProductModel from '../../../src/database/models/Product'
import type SaleModel from '../../../src/database/models/Sale'
import type SaleItemModel from '../../../src/database/models/SaleItem'
import type StockMovementModel from '../../../src/database/models/StockMovement'
import type CustomerModel from '../../../src/database/models/Customer'
import type CreditSaleModel from '../../../src/database/models/CreditSale'

const COLORS = {
  primary: '#0047AB',
  primaryDark: '#003380',
  primaryLight: '#E6EEFF',
  background: '#F4F6FB',
  card: '#FFFFFF',
  border: '#DDE3F0',
  textPrimary: '#0D1B3E',
  textSecondary: '#5A6A8A',
  success: '#0A7A4B',
  warning: '#B45309',
  danger: '#C0152A',
} as const

type PaymentMethod = 'cash_usd' | 'cash_zig' | 'ecocash' | 'bank_transfer' | 'credit'

const PAYMENT_METHODS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash_usd', label: 'Cash $' },
  { key: 'cash_zig', label: 'Cash ZiG' },
  { key: 'ecocash', label: 'EcoCash' },
  { key: 'bank_transfer', label: 'Bank' },
  { key: 'credit', label: 'Credit' },
]

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function NewSaleScreen() {
  const router = useRouter()
  const business = useAuthStore((s) => s.business)
  const businessId = business?.id ?? ''

  const {
    items,
    discountCents,
    paymentMethod,
    customerId,
    addItem,
    updateItemQty,
    removeItem,
    setDiscount,
    setPaymentMethod,
    setCustomer,
    clearCart,
  } = useCartStore()

  const subtotalCents = useCartStore((s) =>
    s.items.reduce((sum, i) => sum + i.qty * i.unitPriceCents, 0),
  )
  const totalCents = subtotalCents - discountCents

  const { products } = useProducts(businessId)
  const { totalSalesCount } = useSales(businessId)
  const { customers, createCustomer } = useCustomers(businessId)

  const [searchText, setSearchText] = useState('')
  const [showQtyModal, setShowQtyModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [discountInput, setDiscountInput] = useState('')

  const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return products
    const q = searchText.toLowerCase()
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)),
    )
  }, [products, searchText])

  const cartItemMap = useMemo(() => {
    const map = new Map<string, number>()
    items.forEach((i) => map.set(i.productId, i.qty))
    return map
  }, [items])

  const selectedCustomer = useMemo(
    () => (customerId ? customers.find((c) => c.id === customerId) ?? null : null),
    [customers, customerId],
  )

  const discountExceedsTotal = discountCents > subtotalCents

  const canComplete =
    items.length > 0 &&
    !discountExceedsTotal &&
    !(paymentMethod === 'credit' && !customerId)

  // ---- Handlers ----

  const handleClose = useCallback(() => {
    if (items.length > 0) {
      Alert.alert(
        'Discard sale?',
        'You have items in your cart. This will clear them.',
        [
          { text: 'Keep Selling', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              clearCart()
              router.back()
            },
          },
        ],
      )
    } else {
      router.back()
    }
  }, [items.length, clearCart, router])

  const handleProductTap = useCallback(
    (product: Product) => {
      if (product.stockQty <= 0) return

      const inCart = cartItemMap.get(product.id)
      if (inCart) {
        setSelectedProduct(product)
        setShowQtyModal(true)
      } else {
        addItem(
          {
            productId: product.id,
            productName: product.name,
            unitPriceCents: product.sellingPriceCents,
            costPriceCents: product.costPriceCents,
          },
          1,
        )
      }
    },
    [cartItemMap, addItem],
  )

  const handleProductLongPress = useCallback((product: Product) => {
    setSelectedProduct(product)
    setShowQtyModal(true)
  }, [])

  const handleDiscountChange = useCallback(
    (text: string) => {
      setDiscountInput(text)
      const num = parseFloat(text)
      if (isNaN(num) || num < 0) {
        setDiscount(0)
      } else {
        setDiscount(Math.round(num * 100))
      }
    },
    [setDiscount],
  )

  const handleCompleteSale = useCallback(async () => {
    if (!database || !business || !canComplete) return

    setIsProcessing(true)
    Keyboard.dismiss()

    try {
      const receiptNumber = formatReceiptNumber(totalSalesCount + 1)

      const newSaleId = await database.write(async () => {
        const newSale = await database!.get<SaleModel>('sales').create((s) => {
          s.businessId = business.id
          s.totalCents = totalCents
          s.discountCents = discountCents
          s.paymentMethod = paymentMethod
          s.receiptNumber = receiptNumber
        })

        for (const item of items) {
          await database!.get<SaleItemModel>('sale_items').create((si) => {
            si.saleId = newSale.id
            si.productId = item.productId
            si.productNameSnapshot = item.productName
            si.qty = item.qty
            si.unitPriceCents = item.unitPriceCents
            si.costPriceCents = item.costPriceCents
          })

          const productRecord = await database!.get<ProductModel>('products').find(item.productId)
          await productRecord.update((p) => {
            p.stockQty = p.stockQty - item.qty
          })

          await database!.get<StockMovementModel>('stock_movements').create((sm) => {
            sm.businessId = business.id
            sm.productId = item.productId
            sm.productNameSnapshot = item.productName
            sm.action = 'sale'
            sm.qtyChange = -item.qty
          })
        }

        if (paymentMethod === 'credit' && customerId) {
          await database!.get<CreditSaleModel>('credit_sales').create((cs) => {
            cs.saleId = newSale.id
            cs.customerId = customerId
            cs.amountCents = totalCents
            cs.amountPaidCents = 0
            cs.isSettled = false
          })

          const customerRecord = await database!
            .get<CustomerModel>('customers')
            .find(customerId)
          await customerRecord.update((c) => {
            c.outstandingBalanceCents = c.outstandingBalanceCents + totalCents
          })
        }

        return newSale.id
      })

      // Fire-and-forget Supabase sync
      syncToSupabase(
        newSaleId,
        business.id,
        totalCents,
        discountCents,
        paymentMethod,
        formatReceiptNumber(totalSalesCount + 1),
        items,
        customerId,
      ).catch((err) => console.warn('[sync] Sale sync failed:', err))

      clearCart()
      setDiscountInput('')
      router.push({
        pathname: '/(app)/sales/[id]',
        params: { id: newSaleId, showReceipt: 'true' },
      })
    } catch (err: any) {
      Alert.alert('Sale Failed', err?.message ?? 'An unexpected error occurred')
    } finally {
      setIsProcessing(false)
    }
  }, [
    database,
    business,
    canComplete,
    totalSalesCount,
    totalCents,
    discountCents,
    paymentMethod,
    items,
    customerId,
    clearCart,
    router,
  ])

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScreenHeader
        title="New Sale"
        leftAction={{ icon: 'close', onPress: handleClose }}
        showBorder
      />

      <View style={styles.productArea}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputRow}>
            <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor={COLORS.textSecondary}
              value={searchText}
              onChangeText={setSearchText}
              returnKeyType="search"
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Product List */}
        <FlatList
          data={filteredProducts}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.productListContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No products found"
              subtitle="Try a different search term"
            />
          }
          renderItem={({ item: product }) => {
            const qtyInCart = cartItemMap.get(product.id)
            const outOfStock = product.stockQty <= 0
            const lowStock =
              product.stockQty > 0 && product.stockQty <= product.lowStockThreshold

            return (
              <TouchableOpacity
                style={[styles.productRow, outOfStock && styles.productRowDisabled]}
                activeOpacity={0.7}
                disabled={outOfStock}
                onPress={() => handleProductTap(product)}
                onLongPress={() => handleProductLongPress(product)}
              >
                <View style={styles.productLeft}>
                  <View style={styles.productNameRow}>
                    <Text style={styles.productName} numberOfLines={1}>
                      {product.name}
                    </Text>
                    {lowStock && <View style={styles.warningDot} />}
                  </View>
                  <Text style={styles.productMeta} numberOfLines={1}>
                    {product.category ? `${product.category} · ` : ''}
                    {product.unit}
                  </Text>
                </View>
                <View style={styles.productRight}>
                  <Text style={styles.productPrice}>
                    {formatCurrency(product.sellingPriceCents)}
                  </Text>
                  {outOfStock ? (
                    <Badge label="Out of stock" variant="danger" size="sm" />
                  ) : qtyInCart ? (
                    <View style={styles.qtyBadge}>
                      <Text style={styles.qtyBadgeText}>{qtyInCart}</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            )
          }}
        />
      </View>

      {/* Cart Panel */}
      <CartPanel
        items={items}
        subtotalCents={subtotalCents}
        totalCents={totalCents}
        discountCents={discountCents}
        discountInput={discountInput}
        discountExceedsTotal={discountExceedsTotal}
        paymentMethod={paymentMethod}
        selectedCustomer={selectedCustomer}
        onDiscountChange={handleDiscountChange}
        onPaymentMethodChange={setPaymentMethod}
        onOpenCustomerPicker={() => setShowCustomerModal(true)}
        onChangeCustomer={() => setShowCustomerModal(true)}
        onItemLongPress={(productId: string) => {
          const product = products.find((p) => p.id === productId)
          if (product) {
            setSelectedProduct(product)
            setShowQtyModal(true)
          }
        }}
      />

      {/* Confirm Button */}
      <TouchableOpacity
        style={[styles.confirmButton, !canComplete && styles.confirmButtonDisabled]}
        activeOpacity={0.85}
        disabled={!canComplete || isProcessing}
        onPress={handleCompleteSale}
      >
        {isProcessing ? (
          <Text style={styles.confirmButtonText}>Processing...</Text>
        ) : (
          <Text style={styles.confirmButtonText}>
            Complete Sale · {formatCurrency(Math.max(totalCents, 0))}
          </Text>
        )}
      </TouchableOpacity>

      {/* Quantity Editor Modal */}
      {showQtyModal && selectedProduct && (
        <QuantityEditorModal
          product={selectedProduct}
          currentQty={cartItemMap.get(selectedProduct.id) ?? 0}
          onUpdate={(qty) => {
            if (qty <= 0) {
              removeItem(selectedProduct.id)
            } else {
              const inCart = cartItemMap.get(selectedProduct.id)
              if (inCart) {
                updateItemQty(selectedProduct.id, qty)
              } else {
                addItem(
                  {
                    productId: selectedProduct.id,
                    productName: selectedProduct.name,
                    unitPriceCents: selectedProduct.sellingPriceCents,
                    costPriceCents: selectedProduct.costPriceCents,
                  },
                  qty,
                )
              }
            }
            setShowQtyModal(false)
            setSelectedProduct(null)
          }}
          onRemove={() => {
            removeItem(selectedProduct.id)
            setShowQtyModal(false)
            setSelectedProduct(null)
          }}
          onClose={() => {
            setShowQtyModal(false)
            setSelectedProduct(null)
          }}
        />
      )}

      {/* Customer Picker Modal */}
      {showCustomerModal && (
        <CustomerPickerModal
          customers={customers}
          onSelect={(customer) => {
            setCustomer(customer.id)
            setShowCustomerModal(false)
          }}
          onCreate={async (name, phone) => {
            const newCustomer = await createCustomer(name, phone)
            setCustomer(newCustomer.id)
            setShowCustomerModal(false)
          }}
          onClose={() => setShowCustomerModal(false)}
        />
      )}
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Cart Panel
// ---------------------------------------------------------------------------

interface CartPanelProps {
  items: { productId: string; productName: string; qty: number; unitPriceCents: number }[]
  subtotalCents: number
  totalCents: number
  discountCents: number
  discountInput: string
  discountExceedsTotal: boolean
  paymentMethod: PaymentMethod
  selectedCustomer: Customer | null
  onDiscountChange: (text: string) => void
  onPaymentMethodChange: (method: PaymentMethod) => void
  onOpenCustomerPicker: () => void
  onChangeCustomer: () => void
  onItemLongPress: (productId: string) => void
}

function CartPanel({
  items,
  subtotalCents,
  totalCents,
  discountCents,
  discountInput,
  discountExceedsTotal,
  paymentMethod,
  selectedCustomer,
  onDiscountChange,
  onPaymentMethodChange,
  onOpenCustomerPicker,
  onChangeCustomer,
  onItemLongPress,
}: CartPanelProps) {
  const customerSectionAnim = useRef(new Animated.Value(paymentMethod === 'credit' ? 1 : 0)).current

  const handlePaymentChange = useCallback(
    (method: PaymentMethod) => {
      onPaymentMethodChange(method)
      Animated.timing(customerSectionAnim, {
        toValue: method === 'credit' ? 1 : 0,
        duration: 250,
        useNativeDriver: false,
      }).start()
    },
    [onPaymentMethodChange, customerSectionAnim],
  )

  if (items.length === 0) {
    return (
      <View style={cartStyles.collapsed}>
        <Ionicons name="cart-outline" size={20} color={COLORS.textSecondary} />
        <Text style={cartStyles.collapsedText}>Tap a product to add it to the sale</Text>
      </View>
    )
  }

  const customerHeight = customerSectionAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 80],
  })

  return (
    <View style={cartStyles.expanded}>
      {/* Cart Items */}
      <ScrollView style={cartStyles.itemsList} nestedScrollEnabled>
        {items.map((item) => (
          <TouchableOpacity
            key={item.productId}
            style={cartStyles.itemRow}
            activeOpacity={0.7}
            onLongPress={() => onItemLongPress(item.productId)}
          >
            <View style={cartStyles.itemLeft}>
              <Text style={cartStyles.itemName} numberOfLines={1}>
                {item.productName}
              </Text>
              <View style={cartStyles.qtyPill}>
                <Text style={cartStyles.qtyPillText}>×{item.qty}</Text>
              </View>
            </View>
            <Text style={cartStyles.itemTotal}>
              {formatCurrency(item.qty * item.unitPriceCents)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Discount */}
      <View style={cartStyles.discountRow}>
        <Text style={cartStyles.discountLabel}>Discount</Text>
        <View style={cartStyles.discountInputWrapper}>
          <Text style={cartStyles.discountPrefix}>$</Text>
          <TextInput
            style={cartStyles.discountInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={COLORS.textSecondary}
            value={discountInput}
            onChangeText={onDiscountChange}
          />
        </View>
      </View>
      {discountExceedsTotal && (
        <Text style={cartStyles.discountError}>Exceeds total</Text>
      )}

      {/* Totals */}
      <View style={cartStyles.totalsSection}>
        <View style={cartStyles.totalRow}>
          <Text style={cartStyles.totalLabel}>Subtotal</Text>
          <Text style={cartStyles.totalValue}>{formatCurrency(subtotalCents)}</Text>
        </View>
        {discountCents > 0 && (
          <View style={cartStyles.totalRow}>
            <Text style={cartStyles.totalLabel}>Discount</Text>
            <Text style={[cartStyles.totalValue, { color: COLORS.danger }]}>
              -{formatCurrency(discountCents)}
            </Text>
          </View>
        )}
        <View style={cartStyles.totalDivider} />
        <View style={cartStyles.totalRow}>
          <Text style={cartStyles.grandTotalLabel}>Total</Text>
          <Text style={cartStyles.grandTotalValue}>
            {formatCurrency(Math.max(totalCents, 0))}
          </Text>
        </View>
      </View>

      {/* Payment Method */}
      <View style={cartStyles.paymentSection}>
        <Text style={cartStyles.paymentLabel}>Payment Method</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {PAYMENT_METHODS.map((pm) => {
            const isActive = paymentMethod === pm.key
            return (
              <TouchableOpacity
                key={pm.key}
                style={[
                  cartStyles.paymentPill,
                  isActive ? cartStyles.paymentPillActive : cartStyles.paymentPillInactive,
                ]}
                onPress={() => handlePaymentChange(pm.key)}
              >
                <Text
                  style={[
                    cartStyles.paymentPillText,
                    isActive
                      ? cartStyles.paymentPillTextActive
                      : cartStyles.paymentPillTextInactive,
                  ]}
                >
                  {pm.label}
                </Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView>
      </View>

      {/* Customer (credit only) */}
      <Animated.View style={[cartStyles.customerSection, { maxHeight: customerHeight, overflow: 'hidden' }]}>
        {paymentMethod === 'credit' && (
          <View style={cartStyles.customerInner}>
            <Text style={cartStyles.customerLabel}>Customer (required for credit)</Text>
            {selectedCustomer ? (
              <View style={cartStyles.customerSelected}>
                <View style={{ flex: 1 }}>
                  <Text style={cartStyles.customerName}>{selectedCustomer.name}</Text>
                  {selectedCustomer.outstandingBalanceCents > 0 && (
                    <Text style={cartStyles.customerOwes}>
                      Owes {formatCurrency(selectedCustomer.outstandingBalanceCents)}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={onChangeCustomer}>
                  <Text style={cartStyles.changeText}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Button
                label="Select or Add Customer"
                variant="secondary"
                size="sm"
                onPress={onOpenCustomerPicker}
                fullWidth={false}
              />
            )}
          </View>
        )}
      </Animated.View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Quantity Editor Modal
// ---------------------------------------------------------------------------

interface QtyModalProps {
  product: Product
  currentQty: number
  onUpdate: (qty: number) => void
  onRemove: () => void
  onClose: () => void
}

function QuantityEditorModal({ product, currentQty, onUpdate, onRemove, onClose }: QtyModalProps) {
  const [qty, setQty] = useState(Math.max(currentQty, 1))
  const isInCart = currentQty > 0

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={modalStyles.sheet}>
          <View style={modalStyles.handle} />

          <Text style={modalStyles.productName}>{product.name}</Text>
          <Text style={modalStyles.pricePerUnit}>
            {formatCurrency(product.sellingPriceCents)} per {product.unit}
          </Text>

          <View style={modalStyles.qtyRow}>
            <TouchableOpacity
              style={[modalStyles.qtyButton, qty <= 1 && modalStyles.qtyButtonDisabled]}
              disabled={qty <= 1}
              onPress={() => setQty((q) => Math.max(1, q - 1))}
            >
              <Text style={modalStyles.qtyButtonText}>−</Text>
            </TouchableOpacity>
            <Text style={modalStyles.qtyNumber}>{qty}</Text>
            <TouchableOpacity
              style={[
                modalStyles.qtyButton,
                qty >= product.stockQty && modalStyles.qtyButtonDisabled,
              ]}
              disabled={qty >= product.stockQty}
              onPress={() => setQty((q) => Math.min(product.stockQty, q + 1))}
            >
              <Text style={modalStyles.qtyButtonText}>+</Text>
            </TouchableOpacity>
          </View>

          <Text style={modalStyles.stockInfo}>{product.stockQty} in stock</Text>
          <Text style={modalStyles.lineTotal}>
            Total: {formatCurrency(qty * product.sellingPriceCents)}
          </Text>

          <View style={modalStyles.actions}>
            {isInCart && (
              <View style={{ flex: 1, marginRight: 6 }}>
                <Button label="Remove from cart" variant="danger" size="md" onPress={onRemove} />
              </View>
            )}
            <View style={{ flex: 1, marginLeft: isInCart ? 6 : 0 }}>
              <Button
                label={isInCart ? 'Update' : 'Add to cart'}
                variant="primary"
                size="md"
                onPress={() => onUpdate(qty)}
              />
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Customer Picker Modal
// ---------------------------------------------------------------------------

interface CustomerPickerProps {
  customers: Customer[]
  onSelect: (customer: Customer) => void
  onCreate: (name: string, phone?: string) => Promise<void>
  onClose: () => void
}

function CustomerPickerModal({ customers, onSelect, onCreate, onClose }: CustomerPickerProps) {
  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return customers
    const q = search.toLowerCase()
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)),
    )
  }, [customers, search])

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    setIsCreating(true)
    try {
      await onCreate(newName, newPhone || undefined)
    } catch {
      Alert.alert('Error', 'Could not create customer')
    } finally {
      setIsCreating(false)
    }
  }, [newName, newPhone, onCreate])

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={cpStyles.container}>
        {/* Header */}
        <View style={cpStyles.header}>
          <Text style={cpStyles.headerTitle}>Select Customer</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={cpStyles.searchContainer}>
          <View style={cpStyles.searchRow}>
            <Ionicons name="search-outline" size={18} color={COLORS.textSecondary} />
            <TextInput
              style={cpStyles.searchInput}
              placeholder="Search by name or phone..."
              placeholderTextColor={COLORS.textSecondary}
              value={search}
              onChangeText={setSearch}
            />
          </View>
        </View>

        {/* Customer List */}
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title="No customers yet"
              subtitle="Add a customer to record credit sales"
            />
          }
          renderItem={({ item: customer }) => (
            <TouchableOpacity
              style={cpStyles.customerRow}
              activeOpacity={0.7}
              onPress={() => onSelect(customer)}
            >
              <View style={{ flex: 1 }}>
                <Text style={cpStyles.customerName}>{customer.name}</Text>
                {customer.phone && (
                  <Text style={cpStyles.customerPhone}>{customer.phone}</Text>
                )}
              </View>
              {customer.outstandingBalanceCents > 0 && (
                <Badge
                  label={`Owes ${formatCurrency(customer.outstandingBalanceCents)}`}
                  variant="warning"
                  size="sm"
                />
              )}
            </TouchableOpacity>
          )}
        />

        {/* Add New Customer */}
        <View style={cpStyles.addSection}>
          {showAddForm ? (
            <View style={cpStyles.addForm}>
              <TextInput
                style={cpStyles.addInput}
                placeholder="Customer name (required)"
                placeholderTextColor={COLORS.textSecondary}
                value={newName}
                onChangeText={setNewName}
              />
              <TextInput
                style={cpStyles.addInput}
                placeholder="Phone number (optional)"
                placeholderTextColor={COLORS.textSecondary}
                value={newPhone}
                onChangeText={setNewPhone}
                keyboardType="phone-pad"
              />
              <Button
                label="Add Customer"
                variant="primary"
                size="md"
                onPress={handleCreate}
                loading={isCreating}
                disabled={!newName.trim()}
              />
            </View>
          ) : (
            <Button
              label="+ Add New Customer"
              variant="secondary"
              size="md"
              onPress={() => setShowAddForm(true)}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Supabase sync (fire-and-forget)
// ---------------------------------------------------------------------------

async function syncToSupabase(
  saleId: string,
  businessId: string,
  totalCents: number,
  discountCents: number,
  paymentMethod: string,
  receiptNumber: string,
  items: { productId: string; productName: string; qty: number; unitPriceCents: number; costPriceCents: number }[],
  customerId: string | null,
) {
  try {
    await supabase.from('sales').insert({
      id: saleId,
      business_id: businessId,
      total_cents: totalCents,
      discount_cents: discountCents,
      payment_method: paymentMethod,
      receipt_number: receiptNumber,
      created_at: new Date().toISOString(),
    })

    const saleItemRows = items.map((item) => ({
      id: `${saleId}_${item.productId}`,
      sale_id: saleId,
      product_id: item.productId,
      product_name_snapshot: item.productName,
      qty: item.qty,
      unit_price_cents: item.unitPriceCents,
      cost_price_cents: item.costPriceCents,
    }))
    if (saleItemRows.length > 0) {
      await supabase.from('sale_items').insert(saleItemRows)
    }

    const movementRows = items.map((item) => ({
      id: `${saleId}_mv_${item.productId}`,
      business_id: businessId,
      product_id: item.productId,
      product_name_snapshot: item.productName,
      action: 'sale',
      qty_change: -item.qty,
      created_at: new Date().toISOString(),
    }))
    if (movementRows.length > 0) {
      await supabase.from('stock_movements').insert(movementRows)
    }

    if (paymentMethod === 'credit' && customerId) {
      await supabase.from('credit_sales').insert({
        id: `${saleId}_cs`,
        sale_id: saleId,
        customer_id: customerId,
        amount_cents: totalCents,
        amount_paid_cents: 0,
        is_settled: false,
        created_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn('[sync] Supabase sale sync error:', err)
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  productArea: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    marginLeft: 8,
    padding: 0,
  },
  productListContent: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    flexGrow: 1,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
    minHeight: 64,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  productRowDisabled: {
    opacity: 0.5,
  },
  productLeft: {
    flex: 1,
    marginRight: 12,
  },
  productNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  productName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  warningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.warning,
    marginLeft: 6,
  },
  productMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  productRight: {
    alignItems: 'flex-end',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.primary,
  },
  qtyBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  qtyBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
})

const cartStyles = StyleSheet.create({
  collapsed: {
    height: 72,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  collapsedText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  expanded: {
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  itemsList: {
    maxHeight: 176,
  },
  itemRow: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.background,
  },
  itemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemName: {
    fontSize: 14,
    color: COLORS.textPrimary,
    flex: 1,
  },
  qtyPill: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  qtyPillText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginLeft: 12,
  },
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  discountLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  discountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    width: 120,
    height: 36,
    paddingHorizontal: 8,
    backgroundColor: COLORS.card,
  },
  discountPrefix: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginRight: 4,
  },
  discountInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },
  discountError: {
    fontSize: 12,
    color: COLORS.danger,
    textAlign: 'right',
    marginTop: 4,
  },
  totalsSection: {
    marginTop: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  totalLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  totalValue: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  totalDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 6,
  },
  grandTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  grandTotalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  paymentSection: {
    marginTop: 12,
  },
  paymentLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  paymentPill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginRight: 8,
    borderWidth: 1,
  },
  paymentPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  paymentPillInactive: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
  },
  paymentPillText: {
    fontSize: 13,
    fontWeight: '500',
  },
  paymentPillTextActive: {
    color: '#FFFFFF',
  },
  paymentPillTextInactive: {
    color: COLORS.textSecondary,
  },
  customerSection: {
    marginTop: 0,
  },
  customerInner: {
    paddingTop: 12,
  },
  customerLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  customerSelected: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerName: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  customerOwes: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 2,
  },
  changeText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '500',
  },
})

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  productName: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  pricePerUnit: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 16,
  },
  qtyButton: {
    width: 56,
    height: 56,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonDisabled: {
    opacity: 0.4,
  },
  qtyButtonText: {
    fontSize: 28,
    color: COLORS.textPrimary,
  },
  qtyNumber: {
    fontSize: 36,
    fontWeight: '700',
    color: COLORS.primary,
    minWidth: 80,
    textAlign: 'center',
  },
  stockInfo: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  lineTotal: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
})

const cpStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  searchContainer: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textPrimary,
    marginLeft: 8,
    padding: 0,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
    backgroundColor: COLORS.card,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  customerName: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  customerPhone: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  addSection: {
    padding: 16,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  addForm: {
    gap: 12,
  },
  addInput: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
  },
})

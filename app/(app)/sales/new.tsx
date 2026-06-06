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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Q } from '@nozbe/watermelondb'

import { ScreenHeader } from '../../../src/components/layout'
import { Badge, Button, EmptyState } from '../../../src/components/ui'
import { sendLowStockNotification } from '../../../src/lib/notifications'
import { useAuthStore } from '../../../src/stores/authStore'
import { useCartStore } from '../../../src/stores/cartStore'
import { useProducts } from '../../../src/hooks/useProducts'
import { useSales } from '../../../src/hooks/useSales'
import { useCustomers } from '../../../src/hooks/useCustomers'
import { useQuietOfflineRefreshOnFocus } from '../../../src/hooks/useQuietOfflineRefreshOnFocus'
import { database } from '../../../src/database'
import { appendReceiptSuffix, formatShortReceipt6 } from '../../../src/lib/receiptNumber'
import { wmRaw } from '../../../src/lib/watermelonRaw'
import { useMoneyFormat } from '../../../src/hooks/useMoneyFormat'
import type { Product, Customer } from '../../../src/types'
import type ProductModel from '../../../src/database/models/Product'
import type SaleModel from '../../../src/database/models/Sale'
import type SaleItemModel from '../../../src/database/models/SaleItem'
import type StockMovementModel from '../../../src/database/models/StockMovement'
import type CustomerModel from '../../../src/database/models/Customer'
import type CreditSaleModel from '../../../src/database/models/CreditSale'
import type PaymentRecordModel from '../../../src/database/models/PaymentRecord'
import * as Crypto from 'expo-crypto'
import { logActivity } from '../../../src/lib/activityLogger'
import {
  pushShopkeeperSaleRemote,
  pullShopkeeperCloudSnapshotFast,
  flushPendingShopkeeperOutbound,
  enqueuePendingShopkeeperSaleId,
} from '../../../src/lib/shopkeeperAuth'
import { logStaffSaleNotify } from '../../../src/lib/staffSaleNotifyDebug'

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

const DEPOSIT_PAYMENT_METHODS = PAYMENT_METHODS.filter((p) => p.key !== 'credit')

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function NewSaleScreen() {
  const router = useRouter()
  const { formatMoney } = useMoneyFormat()
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const businessId = business?.id ?? ''

  const paymentMethodOptions =
    activeRole === 'shopkeeper'
      ? PAYMENT_METHODS.filter((p) => p.key !== 'credit')
      : PAYMENT_METHODS

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

  useEffect(() => {
    if (activeRole !== 'shopkeeper') return
    if (paymentMethod === 'credit') setPaymentMethod('cash_usd')
  }, [activeRole, paymentMethod, setPaymentMethod])

  const subtotalCents = useCartStore((s) =>
    s.items.reduce((sum, i) => sum + i.qty * i.unitPriceCents, 0),
  )
  const totalCents = subtotalCents - discountCents

  const { products, refetch: refetchProducts } = useProducts(businessId)
  const { refetch: refetchSales } = useSales(businessId)
  const { customers, createCustomer, refreshLocal: refreshCustomersLocal } =
    useCustomers(businessId)

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      refetchProducts()
      refetchSales()
      void refreshCustomersLocal()
    }, [refetchProducts, refetchSales, refreshCustomersLocal]),
  )

  const [searchText, setSearchText] = useState('')
  const [showQtyModal, setShowQtyModal] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [discountInput, setDiscountInput] = useState('')
  const [collectCreditDeposit, setCollectCreditDeposit] = useState(false)
  const [creditDepositInput, setCreditDepositInput] = useState('')
  const [creditDepositMethod, setCreditDepositMethod] = useState<PaymentMethod>('cash_usd')

  const creditDepositCents = useMemo(() => {
    if (!collectCreditDeposit || !creditDepositInput.trim()) return 0
    const num = parseFloat(creditDepositInput)
    if (isNaN(num) || num <= 0) return 0
    return Math.round(num * 100)
  }, [collectCreditDeposit, creditDepositInput])

  const creditDepositInvalid =
    collectCreditDeposit &&
    (creditDepositCents <= 0 || creditDepositCents >= totalCents)

  const creditRemainingCents = totalCents - creditDepositCents

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
    !(paymentMethod === 'credit' && !customerId) &&
    !(paymentMethod === 'credit' && creditDepositInvalid)

  const handlePaymentMethodChange = useCallback(
    (method: PaymentMethod) => {
      setPaymentMethod(method)
      if (method !== 'credit') {
        setCollectCreditDeposit(false)
        setCreditDepositInput('')
        setCreditDepositMethod('cash_usd')
      }
    },
    [setPaymentMethod],
  )

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

  const handleAddProduct = useCallback(
    (product: Product) => {
      if (product.stockQty <= 0) return
      addItem(
        {
          productId: product.id,
          productName: product.name,
          unitPriceCents: product.sellingPriceCents,
          costPriceCents: product.costPriceCents,
        },
        1,
      )
    },
    [addItem],
  )

  const handleIncrease = useCallback(
    (product: Product) => {
      const currentQty = cartItemMap.get(product.id) ?? 0
      if (currentQty >= product.stockQty) return
      updateItemQty(product.id, currentQty + 1)
    },
    [cartItemMap, updateItemQty],
  )

  const handleDecrease = useCallback(
    (productId: string) => {
      const currentQty = cartItemMap.get(productId) ?? 0
      if (currentQty <= 1) {
        removeItem(productId)
      } else {
        updateItemQty(productId, currentQty - 1)
      }
    },
    [cartItemMap, removeItem, updateItemQty],
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
      const authSnapshot = useAuthStore.getState()
      const activeRole = authSnapshot.activeRole

      if (activeRole === 'shopkeeper') {
        const suffix =
          authSnapshot.shopkeeperSession?.shopkeeper.receiptSuffix?.trim().toUpperCase() ?? ''
        if (!suffix) {
          Alert.alert(
            'Receipt suffix missing',
            'Ask your business owner to set a receipt suffix for your account under Manage Staff.',
          )
          setIsProcessing(false)
          return
        }
      }

      // Shared timestamp for all product updates in this write.
      const saleProductUpdatedMs = Date.now()

      const newSaleId = await database.write(async () => {
        let receiptNumber: string
        if (activeRole === 'shopkeeper') {
          const skId = authSnapshot.shopkeeperSession?.shopkeeper.id ?? null
          const suffix =
            authSnapshot.shopkeeperSession?.shopkeeper.receiptSuffix?.trim().toUpperCase() ?? ''
          if (!skId || !suffix) {
            throw new Error('Staff session is incomplete. Please sign in again.')
          }
          const salesBeforeShopkeeper = await database!
            .get<SaleModel>('sales')
            .query(
              Q.where('business_id', business.id),
              Q.where('created_by_shopkeeper_id', skId),
            )
            .fetchCount()
          receiptNumber = appendReceiptSuffix(
            formatShortReceipt6(salesBeforeShopkeeper),
            suffix,
          )
        } else {
          const salesBeforeOwner = await database!
            .get<SaleModel>('sales')
            .query(
              Q.where('business_id', business.id),
              Q.where('created_by_shopkeeper_id', Q.eq(null)),
            )
            .fetchCount()
          receiptNumber = formatShortReceipt6(salesBeforeOwner)
        }

        const shopkeeperCreatorId =
          activeRole === 'shopkeeper'
            ? authSnapshot.shopkeeperSession?.shopkeeper.id ?? null
            : null

        const newSaleUuid = Crypto.randomUUID()
        const newSale = await database!.get<SaleModel>('sales').create((s) => {
          s._raw.id = newSaleUuid
          s.businessId = business.id
          s.totalCents = totalCents
          s.discountCents = discountCents
          s.paymentMethod = paymentMethod
          s.receiptNumber = receiptNumber
          if (shopkeeperCreatorId) s.createdByShopkeeperId = shopkeeperCreatorId
        })

        for (const item of items) {
          const siRecord = await database!.get<SaleItemModel>('sale_items').create((si) => {
            si.saleId = newSale.id
            si.productId = item.productId
            si.productNameSnapshot = item.productName
            si.qty = item.qty
            si.unitPriceCents = item.unitPriceCents
            si.costPriceCents = item.costPriceCents
          })

          const productRecord = await database!.get<ProductModel>('products').find(item.productId)
          const newStockQty = productRecord.stockQty - item.qty
          await productRecord.update((p) => {
            p.stockQty = newStockQty
            wmRaw(p).updated_at = saleProductUpdatedMs
          })

          const skMovementId =
            activeRole === 'shopkeeper' ? `sk_mov_${siRecord.id}` : undefined
          await database!.get<StockMovementModel>('stock_movements').create((sm) => {
            if (skMovementId) sm._raw.id = skMovementId
            sm.businessId = business.id
            sm.productId = item.productId
            sm.productNameSnapshot = item.productName
            sm.action = 'sale'
            sm.qtyChange = -item.qty
            wmRaw(sm).created_at = saleProductUpdatedMs
          })
        }

        if (paymentMethod === 'credit' && customerId) {
          const initialPaidCents = creditDepositCents
          const remainingCreditCents = totalCents - initialPaidCents

          await database!.get<CreditSaleModel>('credit_sales').create((cs) => {
            cs.saleId = newSale.id
            cs.customerId = customerId
            cs.amountCents = totalCents
            cs.amountPaidCents = initialPaidCents
            cs.isSettled = initialPaidCents >= totalCents
          })

          const customerRecord = await database!
            .get<CustomerModel>('customers')
            .find(customerId)
          await customerRecord.update((c) => {
            if (remainingCreditCents > 0) {
              c.outstandingBalanceCents = c.outstandingBalanceCents + remainingCreditCents
            }
            c.updatedAt = new Date(Date.now())
          })

          if (initialPaidCents > 0) {
            await database!.get<PaymentRecordModel>('payment_records').create((r) => {
              r.customerId = customerId
              r.amountCents = initialPaidCents
              r.paymentMethod = creditDepositMethod
              r.notes = `Deposit on sale ${receiptNumber}`
            })
          }
        }

        return newSale.id
      })

      const saleRowAfterWrite = await database.get<SaleModel>('sales').find(newSaleId)
      const receiptNumber = saleRowAfterWrite.receiptNumber.trim() || 'Sale'
      const saleCreatedMs =
        saleRowAfterWrite.createdAt instanceof Date
          ? saleRowAfterWrite.createdAt.getTime()
          : Date.now()
      const staffName =
        activeRole === 'shopkeeper'
          ? authSnapshot.shopkeeperSession?.shopkeeper.fullName?.trim() || 'Staff'
          : undefined
      const saleDetails = {
        totalCents,
        itemCount: items.length,
        paymentMethod,
        receiptNumber,
        ...(staffName ? { staffName } : {}),
      }

      const activityLogId = await logActivity({
        action: 'sale_completed',
        entityType: 'sale',
        entityId: newSaleId,
        entityName: receiptNumber,
        details: saleDetails,
      })

      const skTok = useAuthStore.getState().shopkeeperSession?.sessionToken
      const skBizId = business.id
      const skIdForPush = authSnapshot.shopkeeperSession?.shopkeeper.id ?? null

      if (activeRole === 'shopkeeper' && skTok && database && skIdForPush) {
        // Offline-first: complete the sale locally above; sync to Supabase after navigation.
        void (async () => {
          logStaffSaleNotify('shopkeeper.sale_complete.start_push', {
            saleId: newSaleId,
            receiptNumber,
            activityLogId: activityLogId ?? null,
          })
          try {
            await flushPendingShopkeeperOutbound(skTok, skBizId, skIdForPush)
            const saleRow = await database!.get<SaleModel>('sales').find(newSaleId)
            const itemRows = await database!
              .get<SaleItemModel>('sale_items')
              .query(Q.where('sale_id', newSaleId))
              .fetch()
            const createdMs =
              saleRow.createdAt instanceof Date ? saleRow.createdAt.getTime() : saleCreatedMs
            const createdAtIso = new Date(createdMs).toISOString()
            const { ok: pushed } = await pushShopkeeperSaleRemote(skTok, {
              sale: {
                id: saleRow.id,
                business_id: saleRow.businessId,
                total_cents: saleRow.totalCents,
                discount_cents: saleRow.discountCents,
                payment_method: saleRow.paymentMethod,
                receipt_number: saleRow.receiptNumber,
                note: saleRow.note ?? null,
                created_at: createdAtIso,
              },
              sale_items: itemRows.map((si) => ({
                id: si.id,
                sale_id: si.saleId,
                product_id: si.productId,
                product_name_snapshot: si.productNameSnapshot,
                qty: si.qty,
                unit_price_cents: si.unitPriceCents,
                cost_price_cents: si.costPriceCents,
              })),
              stock_movements: itemRows.map((si) => ({
                id: `sk_mov_${si.id}`,
                business_id: saleRow.businessId,
                product_id: si.productId,
                product_name_snapshot: si.productNameSnapshot,
                action: 'sale',
                qty_change: -si.qty,
                reason: null,
                supplier: '',
                created_at: createdAtIso,
              })),
              activity_log: {
                id: activityLogId ?? `${newSaleId}_log`,
                action: 'sale_completed',
                entity_type: 'sale',
                entity_id: newSaleId,
                entity_name: receiptNumber,
                details: saleDetails,
                created_at: createdAtIso,
              },
            })
            if (pushed) {
              logStaffSaleNotify('shopkeeper.sale_complete.push_ok', { saleId: newSaleId })
              await pullShopkeeperCloudSnapshotFast(skTok, skBizId, skIdForPush, {
                flushOutbound: false,
              }).catch(() => {})
            } else {
              logStaffSaleNotify('shopkeeper.sale_complete.push_queued', { saleId: newSaleId })
              await enqueuePendingShopkeeperSaleId(skBizId, newSaleId)
            }
          } catch (e) {
            logStaffSaleNotify('shopkeeper.sale_complete.push_error', {
              saleId: newSaleId,
              message: e instanceof Error ? e.message : String(e),
            })
            console.warn('[shopkeeper] deferred push_sale:', e)
            await enqueuePendingShopkeeperSaleId(skBizId, newSaleId).catch(() => {})
          }
        })()
      }

      const { triggerSync } = useAuthStore.getState()
      if (activeRole === 'owner') triggerSync(business.id).catch(() => {})

      // Fire-and-forget low stock notifications — must not block sale completion
      ;(async () => {
        for (const item of items) {
          try {
            const product = await database!.get<ProductModel>('products').find(item.productId)
            if (
              product.lowStockThreshold > 0 &&
              product.stockQty <= product.lowStockThreshold
            ) {
              sendLowStockNotification({
                businessId: business.id,
                productId: product.id,
                productName: product.name,
                currentStock: product.stockQty,
                threshold: product.lowStockThreshold,
                unit: product.unit,
              }).catch((err) => console.warn('Notification failed:', err.message))
            }
          } catch {
            // Ignore lookup failures
          }
        }
      })()

      clearCart()
      setDiscountInput('')
      setCollectCreditDeposit(false)
      setCreditDepositInput('')
      setCreditDepositMethod('cash_usd')
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
    totalCents,
    discountCents,
    paymentMethod,
    items,
    customerId,
    creditDepositCents,
    creditDepositMethod,
    clearCart,
    router,
  ])

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
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
            const qtyInCart = cartItemMap.get(product.id) ?? 0
            const outOfStock = product.stockQty <= 0
            const atMax = qtyInCart >= product.stockQty
            const lowStock =
              product.stockQty > 0 && product.stockQty <= product.lowStockThreshold

            return (
              <View style={[styles.productRow, outOfStock && styles.productRowDisabled]}>
                {/* Left: product info — tap to add if not in cart yet */}
                <TouchableOpacity
                  style={styles.productLeft}
                  activeOpacity={outOfStock || qtyInCart > 0 ? 1 : 0.6}
                  disabled={outOfStock || qtyInCart > 0}
                  onPress={() => handleAddProduct(product)}
                  onLongPress={() => handleProductLongPress(product)}
                >
                  <View style={styles.productNameRow}>
                    <Text style={styles.productName} numberOfLines={1}>
                      {product.name}
                    </Text>
                    {lowStock && <View style={styles.warningDot} />}
                  </View>
                  <Text style={styles.productMeta} numberOfLines={1}>
                    {product.category ? `${product.category} · ` : ''}
                    {product.unit}
                    {' · '}{formatMoney(product.sellingPriceCents)}
                  </Text>
                </TouchableOpacity>

                {/* Right: add button OR inline qty stepper */}
                <View style={styles.productRight}>
                  {outOfStock ? (
                    <Badge label="Out of stock" variant="danger" size="sm" />
                  ) : qtyInCart > 0 ? (
                    <View style={styles.stepperRow}>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => handleDecrease(product.id)}
                      >
                        <Ionicons
                          name={qtyInCart === 1 ? 'close' : 'remove'}
                          size={16}
                          color={qtyInCart === 1 ? COLORS.danger : COLORS.textPrimary}
                        />
                      </TouchableOpacity>
                      <Text style={styles.stepperQty}>{qtyInCart}</Text>
                      <TouchableOpacity
                        style={[styles.stepperBtn, styles.stepperBtnAdd, atMax && styles.stepperBtnDisabled]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        disabled={atMax}
                        onPress={() => handleIncrease(product)}
                      >
                        <Ionicons name="add" size={16} color={atMax ? COLORS.textSecondary : '#FFFFFF'} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.addBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => handleAddProduct(product)}
                    >
                      <Ionicons name="add" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
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
        paymentMethods={paymentMethodOptions}
        selectedCustomer={selectedCustomer}
        formatMoney={formatMoney}
        onDiscountChange={handleDiscountChange}
        onPaymentMethodChange={handlePaymentMethodChange}
        collectCreditDeposit={collectCreditDeposit}
        creditDepositInput={creditDepositInput}
        creditDepositMethod={creditDepositMethod}
        creditDepositCents={creditDepositCents}
        creditRemainingCents={creditRemainingCents}
        creditDepositInvalid={creditDepositInvalid}
        onCollectCreditDepositChange={setCollectCreditDeposit}
        onCreditDepositInputChange={setCreditDepositInput}
        onCreditDepositMethodChange={setCreditDepositMethod}
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
            Complete Sale · {formatMoney(Math.max(totalCents, 0))}
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
          onCreate={async (name, phone, nationalId) => {
            const newCustomer = await createCustomer(name, phone, nationalId)
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
  paymentMethods: { key: PaymentMethod; label: string }[]
  selectedCustomer: Customer | null
  formatMoney: (usdCents: number) => string
  onDiscountChange: (text: string) => void
  onPaymentMethodChange: (method: PaymentMethod) => void
  collectCreditDeposit: boolean
  creditDepositInput: string
  creditDepositMethod: PaymentMethod
  creditDepositCents: number
  creditRemainingCents: number
  creditDepositInvalid: boolean
  onCollectCreditDepositChange: (value: boolean) => void
  onCreditDepositInputChange: (text: string) => void
  onCreditDepositMethodChange: (method: PaymentMethod) => void
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
  paymentMethods,
  selectedCustomer,
  formatMoney,
  onDiscountChange,
  onPaymentMethodChange,
  collectCreditDeposit,
  creditDepositInput,
  creditDepositMethod,
  creditDepositCents,
  creditRemainingCents,
  creditDepositInvalid,
  onCollectCreditDepositChange,
  onCreditDepositInputChange,
  onCreditDepositMethodChange,
  onOpenCustomerPicker,
  onChangeCustomer,
  onItemLongPress,
}: CartPanelProps) {
  const { height: windowHeight } = useWindowDimensions()
  const cartScrollRef = useRef<ScrollView>(null)
  const cartScrollMaxHeight = Math.round(windowHeight * 0.52)

  const handlePaymentChange = useCallback(
    (method: PaymentMethod) => {
      onPaymentMethodChange(method)
    },
    [onPaymentMethodChange],
  )

  useEffect(() => {
    if (!collectCreditDeposit) return
    const timer = setTimeout(() => {
      cartScrollRef.current?.scrollToEnd({ animated: true })
    }, 150)
    return () => clearTimeout(timer)
  }, [collectCreditDeposit])

  if (items.length === 0) {
    return (
      <View style={cartStyles.collapsed}>
        <Ionicons name="cart-outline" size={20} color={COLORS.textSecondary} />
        <Text style={cartStyles.collapsedText}>Tap a product to add it to the sale</Text>
      </View>
    )
  }

  return (
    <View style={cartStyles.expanded}>
      <ScrollView
        ref={cartScrollRef}
        style={{ maxHeight: cartScrollMaxHeight }}
        contentContainerStyle={cartStyles.scrollContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
      {/* Cart Items */}
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
            {formatMoney(item.qty * item.unitPriceCents)}
          </Text>
        </TouchableOpacity>
      ))}

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
          <Text style={cartStyles.totalValue}>{formatMoney(subtotalCents)}</Text>
        </View>
        {discountCents > 0 && (
          <View style={cartStyles.totalRow}>
            <Text style={cartStyles.totalLabel}>Discount</Text>
            <Text style={[cartStyles.totalValue, { color: COLORS.danger }]}>
              -{formatMoney(discountCents)}
            </Text>
          </View>
        )}
        <View style={cartStyles.totalDivider} />
        <View style={cartStyles.totalRow}>
          <Text style={cartStyles.grandTotalLabel}>Total</Text>
          <Text style={cartStyles.grandTotalValue}>
            {formatMoney(Math.max(totalCents, 0))}
          </Text>
        </View>
      </View>

      {/* Payment Method */}
      <View style={cartStyles.paymentSection}>
        <Text style={cartStyles.paymentLabel}>Payment Method</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {paymentMethods.map((pm) => {
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
      {paymentMethod === 'credit' && (
          <View style={cartStyles.customerInner}>
            <Text style={cartStyles.customerLabel}>Customer (required for credit)</Text>
            {selectedCustomer ? (
              <View style={cartStyles.customerSelected}>
                <View style={{ flex: 1 }}>
                  <Text style={cartStyles.customerName}>{selectedCustomer.name}</Text>
                  {selectedCustomer.outstandingBalanceCents > 0 && (
                    <Text style={cartStyles.customerOwes}>
                      Owes {formatMoney(selectedCustomer.outstandingBalanceCents)}
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

            <TouchableOpacity
              style={cartStyles.depositToggleRow}
              activeOpacity={0.7}
              onPress={() => onCollectCreditDepositChange(!collectCreditDeposit)}
            >
              <Ionicons
                name={collectCreditDeposit ? 'checkbox' : 'square-outline'}
                size={20}
                color={collectCreditDeposit ? COLORS.primary : COLORS.textSecondary}
              />
              <Text style={cartStyles.depositToggleText}>Collect partial payment now</Text>
            </TouchableOpacity>

            {collectCreditDeposit && (
              <View style={cartStyles.depositSection}>
                <View style={cartStyles.depositAmountRow}>
                  <Text style={cartStyles.depositLabel}>Amount paid now</Text>
                  <View style={cartStyles.discountInputWrapper}>
                    <Text style={cartStyles.discountPrefix}>$</Text>
                    <TextInput
                      style={cartStyles.discountInput}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={COLORS.textSecondary}
                      value={creditDepositInput}
                      onChangeText={onCreditDepositInputChange}
                    />
                  </View>
                </View>
                {creditDepositInvalid && (
                  <Text style={cartStyles.discountError}>
                    Enter an amount greater than 0 and less than the total
                  </Text>
                )}
                {creditDepositCents > 0 && !creditDepositInvalid && (
                  <Text style={cartStyles.depositRemainder}>
                    {formatMoney(creditRemainingCents)} on credit
                  </Text>
                )}
                <Text style={cartStyles.depositMethodLabel}>Deposit payment method</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {DEPOSIT_PAYMENT_METHODS.map((pm) => {
                    const isActive = creditDepositMethod === pm.key
                    return (
                      <TouchableOpacity
                        key={pm.key}
                        style={[
                          cartStyles.paymentPill,
                          isActive ? cartStyles.paymentPillActive : cartStyles.paymentPillInactive,
                        ]}
                        onPress={() => onCreditDepositMethodChange(pm.key)}
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
            )}
          </View>
        )}
      </ScrollView>
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
  const { formatMoney } = useMoneyFormat()
  const [qty, setQty] = useState(Math.max(currentQty, 1))
  const isInCart = currentQty > 0

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={modalStyles.sheet}>
          <View style={modalStyles.handle} />

          <Text style={modalStyles.productName}>{product.name}</Text>
          <Text style={modalStyles.pricePerUnit}>
            {formatMoney(product.sellingPriceCents)} per {product.unit}
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
            Total: {formatMoney(qty * product.sellingPriceCents)}
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
// Add Customer Sheet (nested modal)
// ---------------------------------------------------------------------------

interface AddCustomerSheetProps {
  visible: boolean
  onClose: () => void
  onCreate: (name: string, phone?: string, nationalId?: string) => Promise<void>
}

function AddCustomerSheetModal({ visible, onClose, onCreate }: AddCustomerSheetProps) {
  const insets = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(600)).current

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0)
      return
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0)
    })

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [visible])

  useEffect(() => {
    if (visible) {
      setName('')
      setPhone('')
      setNationalId('')
      setIsCreating(false)
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start()
    } else {
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 220,
        useNativeDriver: true,
      }).start()
    }
  }, [visible, slideAnim])

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return
    setIsCreating(true)
    try {
      await onCreate(name, phone || undefined, nationalId || undefined)
    } catch {
      Alert.alert('Error', 'Could not create customer')
    } finally {
      setIsCreating(false)
    }
  }, [name, phone, nationalId, onCreate])

  const keyboardLift =
    keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom) : 0

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={acStyles.overlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={acStyles.kav}
          keyboardVerticalOffset={insets.bottom}
        >
          <Animated.View
            style={[
              acStyles.sheet,
              {
                transform: [{ translateY: slideAnim }],
                paddingBottom: insets.bottom + 16,
              },
              keyboardLift > 0 && { marginBottom: keyboardLift },
            ]}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              <View style={acStyles.handleBar} />

              <Text style={acStyles.title}>Add Customer</Text>
              <Text style={acStyles.subtitle}>Add a customer to record credit sales</Text>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                <View style={acStyles.fields}>
                  <Text style={acStyles.fieldLabel}>Full Name</Text>
                  <TextInput
                    style={acStyles.input}
                    placeholder="e.g. Tendai Moyo"
                    placeholderTextColor={COLORS.textSecondary}
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    maxLength={60}
                  />

                  <Text style={acStyles.fieldLabel}>Phone Number</Text>
                  <TextInput
                    style={acStyles.input}
                    placeholder="e.g. 0771234567"
                    placeholderTextColor={COLORS.textSecondary}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                  />
                  <Text style={acStyles.fieldHint}>Optional</Text>

                  <Text style={acStyles.fieldLabel}>ID Number</Text>
                  <TextInput
                    style={acStyles.input}
                    placeholder="e.g. 63-1234567A12"
                    placeholderTextColor={COLORS.textSecondary}
                    value={nationalId}
                    onChangeText={setNationalId}
                    autoCapitalize="characters"
                    maxLength={30}
                  />
                  <Text style={acStyles.fieldHint}>Optional</Text>
                </View>
              </ScrollView>

              <View style={acStyles.buttons}>
                <View style={{ flex: 1 }}>
                  <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Add Customer"
                    variant="primary"
                    size="md"
                    onPress={handleCreate}
                    loading={isCreating}
                    disabled={!name.trim()}
                  />
                </View>
              </View>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Customer Picker Modal
// ---------------------------------------------------------------------------

interface CustomerPickerProps {
  customers: Customer[]
  onSelect: (customer: Customer) => void
  onCreate: (name: string, phone?: string, nationalId?: string) => Promise<void>
  onClose: () => void
}

function CustomerPickerModal({ customers, onSelect, onCreate, onClose }: CustomerPickerProps) {
  const { formatMoney } = useMoneyFormat()
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return customers
    const q = search.toLowerCase()
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q)) ||
        (c.nationalId && c.nationalId.toLowerCase().includes(q)),
    )
  }, [customers, search])

  return (
    <>
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
                placeholder="Search by name, phone, or ID..."
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
            style={cpStyles.customerList}
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
                    label={`Owes ${formatMoney(customer.outstandingBalanceCents)}`}
                    variant="warning"
                    size="sm"
                  />
                )}
              </TouchableOpacity>
            )}
          />

          {/* Add New Customer */}
          <View style={cpStyles.addSection}>
            <Button
              label="+ Add New Customer"
              variant="secondary"
              size="md"
              onPress={() => setShowAddModal(true)}
            />
          </View>
        </SafeAreaView>
      </Modal>

      <AddCustomerSheetModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreate={onCreate}
      />
    </>
  )
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
    justifyContent: 'center',
    minWidth: 80,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepperBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnAdd: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  stepperBtnDisabled: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    opacity: 0.5,
  },
  stepperQty: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
    minWidth: 20,
    textAlign: 'center',
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
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
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
  customerInner: {
    paddingTop: 12,
    paddingBottom: 4,
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
  depositToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  depositToggleText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  depositSection: {
    marginTop: 10,
    paddingBottom: 12,
  },
  depositAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  depositLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  depositRemainder: {
    fontSize: 12,
    color: COLORS.warning,
    marginTop: 4,
  },
  depositMethodLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 10,
    marginBottom: 6,
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

const acStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
    marginBottom: 20,
  },
  fields: {
    gap: 8,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
  },
  fieldHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
})

const cpStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  customerList: {
    flex: 1,
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
})

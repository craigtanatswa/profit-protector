/*
 * Run this SQL in Supabase SQL Editor if not already done:
 *
 * create table products (
 *   id text primary key,
 *   business_id text references businesses(id),
 *   name text not null,
 *   category text,
 *   unit text not null,
 *   cost_price_cents integer not null default 0,
 *   selling_price_cents integer not null default 0,
 *   stock_qty integer not null default 0,
 *   low_stock_threshold integer not null default 5,
 *   is_active boolean not null default true,
 *   created_at timestamptz default now(),
 *   updated_at timestamptz default now()
 * );
 *
 * alter table products enable row level security;
 *
 * create policy "Users can manage their own products"
 * on products for all
 * using (
 *   business_id in (
 *     select id from businesses where user_id = auth.uid()
 *   )
 * );
 */

import React, { useEffect, useState } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ionicons } from '@expo/vector-icons'
import { Q } from '@nozbe/watermelondb'

import { Button, Card, Input, LoadingScreen } from '../../../src/components/ui'
import { KeyboardAvoidingWrapper, ScreenHeader } from '../../../src/components/layout'
import { useAuthStore } from '../../../src/stores/authStore'
import { database } from '../../../src/database'
import { getPersonalisation, normalizeBusinessType } from '../../../src/lib/appPersonalisation'
import { supabase } from '../../../src/lib/supabase'
import type ProductModel from '../../../src/database/models/Product'
import type StockMovementModel from '../../../src/database/models/StockMovement'

// ─── Constants ────────────────────────────────────────────────────────────────

const STANDARD_UNITS = ['Each', 'Plate', 'kg', 'g', 'litre', 'ml', 'box', 'dozen', 'pair'] as const
const ALL_UNITS = [...STANDARD_UNITS, 'other'] as const

// ─── Zod Schema ───────────────────────────────────────────────────────────────

const productSchema = z.object({
  name: z
    .string()
    .min(1, 'Product name is required')
    .min(2, 'Product name must be at least 2 characters')
    .max(80, 'Product name is too long'),
  category: z.string().max(40).optional(),
  unit: z.string().min(1, 'Please select a unit of measure'),
  customUnit: z.string().optional(),
  costPrice: z
    .string()
    .min(1, 'Cost price is required')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0,
      'Enter a valid price',
    ),
  sellingPrice: z
    .string()
    .min(1, 'Selling price is required')
    .refine(
      (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0,
      'Selling price must be greater than 0',
    ),
  stockQty: z
    .string()
    .min(1, 'Stock quantity is required')
    .refine(
      (v) => !isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 0,
      'Enter a valid quantity',
    ),
  lowStockThreshold: z
    .string()
    .min(1, 'Low stock threshold is required')
    .refine(
      (v) => !isNaN(parseInt(v, 10)) && parseInt(v, 10) >= 0,
      'Enter a valid number',
    ),
})

type ProductFormValues = z.infer<typeof productSchema>

type Db = NonNullable<typeof database>

/** Opening stock on add-product is logged as a purchase so history matches on-hand qty. */
async function createOpeningBalancePurchase(
  db: Db,
  params: {
    businessId: string
    productId: string
    productName: string
    qty: number
    createdAtMs: number
  },
): Promise<StockMovementModel> {
  return db.get<StockMovementModel>('stock_movements').create((m) => {
    m.businessId = params.businessId
    m.productId = params.productId
    m.productNameSnapshot = params.productName
    m.action = 'purchase'
    m.qtyChange = params.qty
    m.reason = 'opening'
    m.supplier = 'Opening balance'
    m._raw.created_at = params.createdAtMs
  })
}

function fireOpeningMovementSupabaseSync(
  movement: StockMovementModel,
  businessId: string,
  productId: string,
  productName: string,
  qty: number,
) {
  const createdAt =
    movement.createdAt instanceof Date
      ? movement.createdAt.toISOString()
      : new Date().toISOString()
  supabase
    .from('stock_movements')
    .insert({
      id: movement.id,
      business_id: businessId,
      product_id: productId,
      product_name_snapshot: productName,
      action: 'purchase',
      qty_change: qty,
      reason: 'opening',
      supplier: 'Opening balance',
      created_at: createdAt,
    })
    .then(({ error }) => {
      if (error) console.warn('Stock movement sync failed:', error.message)
    })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddProductScreen() {
  const router = useRouter()
  const { productId } = useLocalSearchParams<{ productId?: string }>()
  const isEditMode = !!productId
  const business = useAuthStore((s) => s.business)

  const [isSaving, setIsSaving] = useState(false)
  const [isLoaded, setIsLoaded] = useState(!isEditMode)
  const [existingCategories, setExistingCategories] = useState<string[]>([])

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: '',
      category: '',
      unit: '',
      customUnit: '',
      costPrice: '',
      sellingPrice: '',
      stockQty: '',
      lowStockThreshold: '5',
    },
  })

  const watchedUnit = useWatch({ control, name: 'unit' })
  const watchedCostPrice = useWatch({ control, name: 'costPrice' })
  const watchedSellingPrice = useWatch({ control, name: 'sellingPrice' })
  const watchedLowStockThreshold = useWatch({ control, name: 'lowStockThreshold' })

  const personalisation = React.useMemo(
    () => getPersonalisation(normalizeBusinessType(business?.businessType ?? 'other')),
    [business?.businessType],
  )
  const categoryPills =
    existingCategories.length > 0 ? existingCategories : personalisation.defaultCategories

  // ── Default unit for new products by business type ─────────────────────────
  useEffect(() => {
    if (isEditMode || !business?.businessType) return
    const raw = normalizeBusinessType(business.businessType)
    const defaultUnit = raw === 'restaurant' ? 'Plate' : 'Each'
    setValue('unit', defaultUnit)
  }, [isEditMode, business?.businessType, setValue])

  // ── Load product in edit mode ──────────────────────────────────────────────
  useEffect(() => {
    if (!productId) return
    const db = database
    if (!db) {
      Alert.alert('Error', 'Database not available')
      router.back()
      return
    }
    db.get<ProductModel>('products')
      .find(productId)
      .then((record) => {
        const isStandard = (STANDARD_UNITS as readonly string[]).includes(record.unit)
        setValue('name', record.name)
        setValue('category', record.category ?? '')
        setValue('unit', isStandard ? record.unit : 'other')
        setValue('customUnit', isStandard ? '' : record.unit)
        setValue('costPrice', (record.costPriceCents / 100).toFixed(2))
        setValue('sellingPrice', (record.sellingPriceCents / 100).toFixed(2))
        setValue('stockQty', record.stockQty.toString())
        setValue('lowStockThreshold', record.lowStockThreshold.toString())
        setIsLoaded(true)
      })
      .catch(() => {
        Alert.alert('Error', 'Could not load product details')
        router.back()
      })
  }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load existing categories for suggestions ───────────────────────────────
  useEffect(() => {
    if (!business?.id) return
    const db = database
    if (!db) return
    db.get<ProductModel>('products')
      .query(Q.where('business_id', business.id), Q.where('is_active', true))
      .fetch()
      .then((records) => {
        const cats = records
          .map((r) => r.category)
          .filter((c): c is string => typeof c === 'string' && c.length > 0)
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort()
        setExistingCategories(cats)
      })
      .catch(() => {})
  }, [business?.id])

  // ── Profit margin calculation ──────────────────────────────────────────────
  const costValue = parseFloat(watchedCostPrice) || 0
  const sellValue = parseFloat(watchedSellingPrice) || 0
  const profitCents = Math.round((sellValue - costValue) * 100)
  const marginPercent =
    costValue > 0 ? ((sellValue - costValue) / costValue) * 100 : 0
  const bothPricesEntered =
    watchedCostPrice.length > 0 &&
    watchedSellingPrice.length > 0 &&
    !isNaN(costValue) &&
    !isNaN(sellValue) &&
    costValue > 0

  // ── Deactivate product (edit mode) ─────────────────────────────────────────
  const handleDeactivate = () => {
    Alert.alert(
      'Remove Product',
      'This will hide the product from your list. All sales history will be kept. You can restore it later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Product',
          style: 'destructive',
          onPress: async () => {
            if (!productId) return
            const db = database
            if (!db) return
            try {
              const record = await db
                .get<ProductModel>('products')
                .find(productId)
              await db.write(async () => {
                await record.update((p) => {
                  p.isActive = false
                  p.updatedAt = new Date()
                })
              })
              supabase
                .from('products')
                .update({
                  is_active: false,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', productId)
                .then(({ error }) => {
                  if (error) console.warn('Supabase sync failed:', error.message)
                })
              router.back()
            } catch {
              Alert.alert('Error', 'Could not remove product. Please try again.')
            }
          },
        },
      ],
    )
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const onSubmit = async (values: ProductFormValues) => {
    const db = database
    if (!db || !business) {
      Alert.alert(
        'Save Failed',
        !db
          ? 'Local database is not available (WatermelonDB requires a development build with native modules).'
          : 'Business is not loaded. Sign out and sign in again.',
      )
      return
    }
    setIsSaving(true)
    try {
      const costPriceCents = Math.round(parseFloat(values.costPrice) * 100)
      const sellingPriceCents = Math.round(parseFloat(values.sellingPrice) * 100)
      const stockQty = parseInt(values.stockQty, 10)
      const lowStockThreshold = parseInt(values.lowStockThreshold, 10)
      const finalUnit =
        values.unit === 'other'
          ? (values.customUnit?.trim() || 'other')
          : values.unit

      if (isEditMode && productId) {
        const record = await db.get<ProductModel>('products').find(productId)
        let backfillOpening: StockMovementModel | null = null
        await db.write(async () => {
          await record.update((product) => {
            product.name = values.name.trim()
            product.category = values.category?.trim() ?? ''
            product.unit = finalUnit
            product.costPriceCents = costPriceCents
            product.sellingPriceCents = sellingPriceCents
            product.stockQty = stockQty
            product.lowStockThreshold = lowStockThreshold
            product.updatedAt = new Date()
          })

          const existingMovements = await db
            .get<StockMovementModel>('stock_movements')
            .query(Q.where('product_id', productId))
            .fetch()
          if (existingMovements.length === 0 && stockQty > 0) {
            const createdAtMs =
              record.createdAt instanceof Date
                ? record.createdAt.getTime()
                : Date.now()
            backfillOpening = await createOpeningBalancePurchase(db, {
              businessId: business.id,
              productId: record.id,
              productName: values.name.trim(),
              qty: stockQty,
              createdAtMs,
            })
          }
        })
        supabase
          .from('products')
          .update({
            name: values.name.trim(),
            category: values.category?.trim() ?? '',
            unit: finalUnit,
            cost_price_cents: costPriceCents,
            selling_price_cents: sellingPriceCents,
            stock_qty: stockQty,
            low_stock_threshold: lowStockThreshold,
            updated_at: new Date().toISOString(),
          })
          .eq('id', productId)
          .then(({ error }) => {
            if (error) console.warn('Supabase sync failed:', error.message)
          })
        if (backfillOpening != null) {
          fireOpeningMovementSupabaseSync(
            backfillOpening,
            business.id,
            productId,
            values.name.trim(),
            stockQty,
          )
        }
        Alert.alert(
          'Changes Saved',
          `${values.name.trim()} has been updated.`,
          [{ text: 'OK', onPress: () => router.back() }],
        )
      } else {
        let openingMovement: StockMovementModel | null = null
        const newRecord = await db.write(async () => {
          const product = await db.get<ProductModel>('products').create((p) => {
            p.businessId = business.id
            p.name = values.name.trim()
            p.category = values.category?.trim() ?? ''
            p.unit = finalUnit
            p.costPriceCents = costPriceCents
            p.sellingPriceCents = sellingPriceCents
            p.stockQty = stockQty
            p.lowStockThreshold = lowStockThreshold
            p.isActive = true
            p.updatedAt = new Date()
          })
          if (stockQty > 0) {
            const createdAtMs =
              product.createdAt instanceof Date
                ? product.createdAt.getTime()
                : Date.now()
            openingMovement = await createOpeningBalancePurchase(db, {
              businessId: business.id,
              productId: product.id,
              productName: values.name.trim(),
              qty: stockQty,
              createdAtMs,
            })
          }
          return product
        })
        supabase
          .from('products')
          .insert({
            id: newRecord.id,
            business_id: business.id,
            name: values.name.trim(),
            category: values.category?.trim() ?? '',
            unit: finalUnit,
            cost_price_cents: costPriceCents,
            selling_price_cents: sellingPriceCents,
            stock_qty: stockQty,
            low_stock_threshold: lowStockThreshold,
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .then(({ error }) => {
            if (error) console.warn('Supabase sync failed:', error.message)
          })
        if (openingMovement != null) {
          fireOpeningMovementSupabaseSync(
            openingMovement,
            business.id,
            newRecord.id,
            values.name.trim(),
            stockQty,
          )
        }
        Alert.alert(
          'Product Added',
          `${values.name.trim()} has been added to your inventory.`,
          [{ text: 'OK', onPress: () => router.back() }],
        )
      }
    } catch (error) {
      Alert.alert(
        'Save Failed',
        error instanceof Error ? error.message : JSON.stringify(error),
      )
    } finally {
      setIsSaving(false)
    }
  }

  // ── Early return: loading state in edit mode ───────────────────────────────
  if (!isLoaded) {
    return <LoadingScreen message="Loading product..." />
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Header — trash button overlaid to achieve danger red colour */}
      <View>
        <ScreenHeader
          title={isEditMode ? 'Edit Product' : 'Add Product'}
          leftAction={{ icon: 'arrow-back-outline', onPress: () => router.back() }}
          showBorder
        />
        {isEditMode && (
          <TouchableOpacity
            onPress={handleDeactivate}
            style={styles.headerTrashBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={24} color="#C0152A" />
          </TouchableOpacity>
        )}
      </View>

      {/* Body: scroll + absolute save bar */}
      <View style={styles.body}>
        <KeyboardAvoidingWrapper>
          <View style={styles.scrollContent}>

            {/* ── Section 1: Product Details ─────────────────────────── */}
            <Text style={styles.sectionLabel}>Product Details</Text>
            <Card style={styles.card}>

              {/* Name */}
              <Controller
                control={control}
                name="name"
                render={({ field: { value, onChange } }) => (
                  <Input
                    label="Product Name"
                    placeholder="e.g. Coca Cola 500ml"
                    value={value}
                    onChangeText={onChange}
                    autoCapitalize="words"
                    maxLength={80}
                    hint="Be specific — include size or variant"
                    error={errors.name?.message}
                  />
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Category */}
              <Controller
                control={control}
                name="category"
                render={({ field: { value, onChange } }) => (
                  <View>
                    <View style={styles.labelRow}>
                      <Text style={styles.fieldLabel}>Category</Text>
                      <Text style={styles.optionalSuffix}> (optional)</Text>
                    </View>
                    <Input
                      placeholder="e.g. Beverages, Hardware, Groceries"
                      value={value ?? ''}
                      onChangeText={onChange}
                      autoCapitalize="words"
                      maxLength={40}
                      error={errors.category?.message}
                    />
                    {categoryPills.length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        <Text style={styles.quickSelectLabel}>Quick select:</Text>
                        <View style={styles.pillsRow}>
                          {categoryPills.map((cat) => (
                            <TouchableOpacity
                              key={cat}
                              onPress={() => onChange(cat)}
                              style={styles.categoryPill}
                              activeOpacity={0.75}
                            >
                              <Text style={styles.categoryPillText}>{cat}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Unit of Measure */}
              <Controller
                control={control}
                name="unit"
                render={({ field: { value, onChange } }) => (
                  <View>
                    <Text style={styles.fieldLabel}>Unit of Measure</Text>
                    <View style={styles.unitGrid}>
                      {ALL_UNITS.map((unit) => {
                        const selected = value === unit
                        return (
                          <TouchableOpacity
                            key={unit}
                            onPress={() => onChange(unit)}
                            activeOpacity={0.8}
                            style={[
                              styles.unitPill,
                              selected
                                ? styles.unitPillSelected
                                : styles.unitPillUnselected,
                            ]}
                          >
                            <Text
                              style={[
                                styles.unitPillText,
                                selected
                                  ? styles.unitPillTextSelected
                                  : styles.unitPillTextUnselected,
                              ]}
                            >
                              {unit}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                    {errors.unit != null && (
                      <Text style={styles.errorText}>{errors.unit.message}</Text>
                    )}
                  </View>
                )}
              />

              {/* Custom unit input — shown only when "other" is selected */}
              {watchedUnit === 'other' && (
                <>
                  <View style={styles.fieldSpacer} />
                  <Controller
                    control={control}
                    name="customUnit"
                    render={({ field: { value, onChange } }) => (
                      <Input
                        placeholder="Describe your unit"
                        value={value ?? ''}
                        onChangeText={onChange}
                        autoCapitalize="words"
                        error={errors.customUnit?.message}
                      />
                    )}
                  />
                </>
              )}
            </Card>

            {/* ── Section 2: Pricing ─────────────────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Pricing</Text>
            <Card style={styles.card}>

              {/* Cost Price */}
              <Controller
                control={control}
                name="costPrice"
                render={({ field: { value, onChange } }) => (
                  <Input
                    label="Cost Price"
                    hint="What you paid for this item"
                    keyboardType="decimal-pad"
                    leftIcon={<Text style={styles.currencySymbol}>$</Text>}
                    placeholder="0.00"
                    value={value}
                    onChangeText={onChange}
                    error={errors.costPrice?.message}
                  />
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Selling Price */}
              <Controller
                control={control}
                name="sellingPrice"
                render={({ field: { value, onChange } }) => (
                  <Input
                    label="Selling Price"
                    hint="What you charge customers"
                    keyboardType="decimal-pad"
                    leftIcon={<Text style={styles.currencySymbol}>$</Text>}
                    placeholder="0.00"
                    value={value}
                    onChangeText={onChange}
                    error={errors.sellingPrice?.message}
                  />
                )}
              />

              {/* Live profit margin row */}
              <View style={styles.marginRow}>
                {bothPricesEntered ? (
                  <Text
                    style={[
                      styles.marginText,
                      profitCents > 0
                        ? styles.marginPositive
                        : profitCents === 0
                        ? styles.marginNeutral
                        : styles.marginNegative,
                    ]}
                  >
                    {`$${(Math.abs(profitCents) / 100).toFixed(2)} ${
                      profitCents < 0 ? 'loss' : 'profit'
                    } · ${marginPercent.toFixed(1)}% margin`}
                  </Text>
                ) : (
                  <Text style={styles.marginPlaceholder}>
                    Enter both prices to see margin
                  </Text>
                )}
              </View>
            </Card>

            {/* ── Section 3: Stock ──────────────────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Stock</Text>
            <Card style={styles.card}>

              {/* Opening / Current stock */}
              <Controller
                control={control}
                name="stockQty"
                render={({ field: { value, onChange } }) => (
                  <Input
                    label={isEditMode ? 'Current Stock' : 'Opening Stock'}
                    hint={
                      isEditMode
                        ? 'Update the current stock count'
                        : 'How many units do you have right now?'
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    leftIcon={
                      <Ionicons name="cube-outline" size={18} color="#5A6A8A" />
                    }
                    value={value}
                    onChangeText={onChange}
                    error={errors.stockQty?.message}
                  />
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Low stock alert threshold */}
              <Controller
                control={control}
                name="lowStockThreshold"
                render={({ field: { value, onChange } }) => (
                  <View>
                    <Input
                      label="Low Stock Alert"
                      hint="Get warned when stock drops to this level"
                      keyboardType="number-pad"
                      placeholder="5"
                      leftIcon={
                        <Ionicons
                          name="warning-outline"
                          size={18}
                          color="#B45309"
                        />
                      }
                      value={value}
                      onChangeText={onChange}
                      error={errors.lowStockThreshold?.message}
                    />
                    {watchedLowStockThreshold.length > 0 &&
                      !isNaN(parseInt(watchedLowStockThreshold, 10)) && (
                        <Text style={styles.thresholdHelper}>
                          {`Currently: alert when stock reaches ${parseInt(
                            watchedLowStockThreshold,
                            10,
                          )} units`}
                        </Text>
                      )}
                  </View>
                )}
              />
            </Card>

            {/* Spacer so content clears the fixed save bar */}
            <View style={styles.bottomSpacer} />
          </View>
        </KeyboardAvoidingWrapper>

        {/* Fixed save button */}
        <View style={styles.saveBar}>
          <Button
            variant="primary"
            fullWidth
            size="lg"
            label={isEditMode ? 'Save Changes' : 'Add Product'}
            loading={isSaving}
            icon={
              !isSaving ? (
                <Ionicons
                  name="checkmark-circle-outline"
                  size={20}
                  color="#FFFFFF"
                />
              ) : undefined
            }
            onPress={handleSubmit(onSubmit)}
          />
        </View>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  headerTrashBtn: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 120,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5A6A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  sectionLabelTop: {
    marginTop: 24,
  },
  card: {
    borderColor: '#DDE3F0',
  },
  fieldSpacer: {
    height: 16,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  optionalSuffix: {
    fontSize: 13,
    color: '#5A6A8A',
  },
  suggestionsContainer: {
    marginTop: 10,
  },
  quickSelectLabel: {
    fontSize: 12,
    color: '#5A6A8A',
    marginBottom: 6,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    backgroundColor: '#E6EEFF',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  categoryPillText: {
    fontSize: 12,
    color: '#0047AB',
  },
  unitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  unitPill: {
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    minWidth: '30%',
    alignItems: 'center',
  },
  unitPillSelected: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  unitPillUnselected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE3F0',
  },
  unitPillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  unitPillTextSelected: {
    color: '#FFFFFF',
  },
  unitPillTextUnselected: {
    color: '#5A6A8A',
  },
  errorText: {
    fontSize: 12,
    color: '#C0152A',
    marginTop: 4,
  },
  currencySymbol: {
    fontSize: 16,
    color: '#5A6A8A',
  },
  marginRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#DDE3F0',
  },
  marginText: {
    fontSize: 13,
    fontWeight: '500',
  },
  marginPositive: {
    color: '#0A7A4B',
  },
  marginNeutral: {
    color: '#5A6A8A',
  },
  marginNegative: {
    color: '#C0152A',
  },
  marginPlaceholder: {
    fontSize: 13,
    color: '#5A6A8A',
    fontStyle: 'italic',
  },
  thresholdHelper: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 4,
  },
  bottomSpacer: {
    height: 20,
  },
  saveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#DDE3F0',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
})

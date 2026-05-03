import { Ionicons } from '@expo/vector-icons'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { Q } from '@nozbe/watermelondb'
import { zodResolver } from '@hookform/resolvers/zod'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { z } from 'zod'

import { KeyboardAvoidingWrapper, ScreenHeader } from '../../../src/components/layout'
import { ProductPickerModal } from '../../../src/components/inventory/ProductPickerModal'
import { Button, Card, Input } from '../../../src/components/ui'
import { database } from '../../../src/database'
import type ProductModel from '../../../src/database/models/Product'
import type StockMovementModel from '../../../src/database/models/StockMovement'
import { formatDate } from '../../../src/lib/formatters'
import { useAuthStore } from '../../../src/stores/authStore'
import type { Product } from '../../../src/types'
import { getProductById } from '../../../src/hooks/useProducts'
import { supabase } from '../../../src/lib/supabase'
import { logActivity } from '../../../src/lib/activityLogger'
import { wmRaw } from '../../../src/lib/watermelonRaw'

// ─── Schema ───────────────────────────────────────────────────────────────────

const purchaseSchema = z.object({
  productId: z.string().min(1, 'Please select a product'),
  qtyReceived: z
    .string()
    .min(1, 'Quantity is required')
    .refine(
      (v) => !isNaN(parseInt(v, 10)) && parseInt(v, 10) > 0,
      'Quantity must be greater than 0',
    ),
  costPerUnit: z
    .string()
    .optional()
    .refine(
      (v) => !v || (!isNaN(parseFloat(v)) && parseFloat(v) >= 0),
      'Enter a valid cost',
    ),
  purchaseDate: z.number(),
  supplierName: z.string().max(80).optional(),
  referenceNo: z.string().max(40).optional(),
  notes: z.string().max(200).optional(),
  updateCostPrice: z.boolean(),
})

type PurchaseFormValues = z.infer<typeof purchaseSchema>

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isToday(date: Date): boolean {
  const now = new Date()
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  )
}

function formatDisplayDate(date: Date): string {
  const label = formatDate(date.getTime())
  return isToday(date) ? `Today, ${label}` : label
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PurchaseScreen() {
  const { productId: routeProductId } = useLocalSearchParams<{ productId?: string }>()
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [purchaseDate, setPurchaseDate] = useState(new Date())
  const [supplierExpanded, setSupplierExpanded] = useState(false)
  const [previousSuppliers, setPreviousSuppliers] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      productId: '',
      qtyReceived: '',
      costPerUnit: '',
      purchaseDate: Date.now(),
      supplierName: '',
      referenceNo: '',
      notes: '',
      updateCostPrice: false,
    },
  })

  const watchedQty = useWatch({ control, name: 'qtyReceived' })
  const watchedCost = useWatch({ control, name: 'costPerUnit' })
  const watchedSupplier = useWatch({ control, name: 'supplierName' })
  const watchedUpdateCost = useWatch({ control, name: 'updateCostPrice' })

  // Pre-select product from route param
  useEffect(() => {
    if (!routeProductId) return
    getProductById(routeProductId)
      .then((product) => {
        setSelectedProduct(product)
        setValue('productId', product.id)
      })
      .catch(() => {})
  }, [routeProductId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load previous suppliers
  useEffect(() => {
    if (!business?.id || !database) return
    database
      .get<StockMovementModel>('stock_movements')
      .query(
        Q.where('business_id', business.id),
        Q.where('supplier', Q.notEq('')),
        Q.sortBy('created_at', Q.desc),
      )
      .fetch()
      .then((records) => {
        const suppliers = records
          .map((r) => r.supplier)
          .filter((s): s is string => typeof s === 'string' && s.length > 0)
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 5)
        setPreviousSuppliers(suppliers)
      })
      .catch(() => {})
  }, [business?.id])

  // Derived values
  const qtyNum = parseInt(watchedQty, 10)
  const validQty = !isNaN(qtyNum) && qtyNum > 0
  const costNum = parseFloat(watchedCost ?? '')
  const validCost = watchedCost && watchedCost.length > 0 && !isNaN(costNum) && costNum >= 0
  const newStockQty = selectedProduct && validQty ? selectedProduct.stockQty + qtyNum : null
  const costDifferentFromProduct =
    selectedProduct &&
    validCost &&
    Math.round(costNum * 100) !== selectedProduct.costPriceCents

  function handleSelectProduct(product: Product) {
    setSelectedProduct(product)
    setValue('productId', product.id)
    setShowPicker(false)
  }

  function handleClearProduct() {
    setSelectedProduct(null)
    setValue('productId', '')
    setValue('qtyReceived', '')
  }

  function handleDateChange(_event: DateTimePickerEvent, date?: Date) {
    setShowDatePicker(false)
    if (date) {
      setPurchaseDate(date)
      setValue('purchaseDate', date.getTime())
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const onSubmit = async (values: PurchaseFormValues) => {
    if (!database || !business) {
      Alert.alert(
        'Save Failed',
        !database
          ? 'Local database is not available.'
          : 'Business not loaded. Please sign out and sign in again.',
      )
      return
    }

    setIsSaving(true)
    try {
      const qty = parseInt(values.qtyReceived, 10)
      const costCents =
        values.costPerUnit && values.costPerUnit.length > 0
          ? Math.round(parseFloat(values.costPerUnit) * 100)
          : null

      const productRecord = await database.get<ProductModel>('products').find(values.productId)
      const prevQty = productRecord.stockQty
      const newQty = prevQty + qty

      await database.write(async () => {
        // Update product stock
        await productRecord.update((p) => {
          p.stockQty = newQty
          wmRaw(p).updated_at = Date.now()
          if (values.updateCostPrice && costCents !== null) {
            p.costPriceCents = costCents
          }
        })

        // Create stock movement
        await database!.get<StockMovementModel>('stock_movements').create((m) => {
          m.businessId = business.id
          m.productId = values.productId
          m.productNameSnapshot = productRecord.name
          m.action = 'purchase'
          m.qtyChange = qty
          m.reason = values.notes ?? ''
          m.supplier = values.supplierName ?? ''
          wmRaw(m).created_at = values.purchaseDate || Date.now()
        })
      })

      await logActivity({
        action: 'stock_received',
        entityType: 'stock_movement',
        entityId: values.productId,
        entityName: productRecord.name,
        details: { qty },
      })

      if (activeRole === 'owner') {
        const updatePayload: Record<string, unknown> = {
          stock_qty: newQty,
          updated_at: new Date().toISOString(),
        }
        if (values.updateCostPrice && costCents !== null) {
          updatePayload.cost_price_cents = costCents
        }
        supabase
          .from('products')
          .update(updatePayload)
          .eq('id', values.productId)
          .then(({ error }) => {
            if (error) console.warn('Product sync failed:', error.message)
          })

        supabase
          .from('stock_movements')
          .insert({
            business_id: business.id,
            product_id: values.productId,
            product_name_snapshot: productRecord.name,
            action: 'purchase',
            qty_change: qty,
            reason: values.notes ?? '',
            supplier: values.supplierName ?? '',
            created_at: new Date(values.purchaseDate || Date.now()).toISOString(),
          })
          .then(({ error }) => {
            if (error) console.warn('Stock movement sync failed:', error.message)
          })
      }

      Alert.alert(
        'Stock Updated',
        `${qty} ${productRecord.unit} of ${productRecord.name} added.\nNew stock: ${newQty} ${productRecord.unit}`,
        [{ text: 'OK', onPress: () => router.back() }],
      )
    } catch (error) {
      Alert.alert(
        'Save Failed',
        error instanceof Error ? error.message : JSON.stringify(error),
      )
      setIsSaving(false)
    }
  }

  const canSave = !!selectedProduct && validQty

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        title="Receive Stock"
        leftAction={{ icon: 'arrow-back-outline', onPress: () => router.back() }}
        showBorder
      />

      <View style={styles.body}>
        <KeyboardAvoidingWrapper>
          <View style={styles.scrollContent}>

            {/* ── Section 1: Product ───────────────────────────────────── */}
            <Text style={styles.sectionLabel}>Product</Text>
            <Card style={styles.card}>
              {selectedProduct ? (
                <View style={styles.selectedProductRow}>
                  <View style={styles.selectedProductInfo}>
                    <Text style={styles.selectedProductName}>{selectedProduct.name}</Text>
                    <Text style={styles.selectedProductStock}>
                      Current stock: {selectedProduct.stockQty} {selectedProduct.unit}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleClearProduct}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.changeText}>Change</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.productPickerTrigger}
                  onPress={() => setShowPicker(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.productPickerLeft}>
                    <Ionicons name="cube-outline" size={18} color="#5A6A8A" style={{ marginRight: 8 }} />
                    <Text style={styles.productPickerPlaceholder}>Select a product...</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#5A6A8A" />
                </TouchableOpacity>
              )}
              {errors.productId && (
                <Text style={styles.errorText}>{errors.productId.message}</Text>
              )}
            </Card>

            {/* ── Section 2: Stock Received ────────────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Stock Received</Text>
            <Card style={styles.card}>

              {/* Quantity Received */}
              <Controller
                control={control}
                name="qtyReceived"
                render={({ field: { value, onChange } }) => (
                  <View>
                    <Input
                      label="Quantity Received"
                      keyboardType="number-pad"
                      placeholder="0"
                      leftIcon={
                        <Ionicons name="add-circle-outline" size={18} color="#0047AB" />
                      }
                      value={value}
                      onChangeText={onChange}
                      error={errors.qtyReceived?.message}
                      hint={
                        selectedProduct
                          ? `Current stock: ${selectedProduct.stockQty} → will become ${
                              validQty
                                ? selectedProduct.stockQty + qtyNum
                                : selectedProduct.stockQty + ' + qty'
                            }`
                          : 'Select a product first'
                      }
                    />
                    {selectedProduct && validQty && newStockQty !== null && (
                      <View style={styles.projectedRow}>
                        <Text style={styles.projectedLabel}>New stock level:</Text>
                        <Text style={styles.projectedValue}>
                          {newStockQty} {selectedProduct.unit}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Cost Price Per Unit */}
              <Controller
                control={control}
                name="costPerUnit"
                render={({ field: { value, onChange } }) => (
                  <View>
                    <Input
                      label="Cost Price Per Unit"
                      hint={
                        selectedProduct
                          ? `Previous cost: $${(selectedProduct.costPriceCents / 100).toFixed(2)}`
                          : 'What you paid per unit'
                      }
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      leftIcon={<Text style={styles.currencySymbol}>$</Text>}
                      value={value ?? ''}
                      onChangeText={onChange}
                      error={errors.costPerUnit?.message}
                    />
                    {costDifferentFromProduct && (
                      <View style={styles.updateCostRow}>
                        <Ionicons
                          name="warning-outline"
                          size={16}
                          color="#B45309"
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.updateCostText}>
                          Update product cost price to ${costNum.toFixed(2)}?
                        </Text>
                        <Controller
                          control={control}
                          name="updateCostPrice"
                          render={({ field: { value: toggleVal, onChange: toggleChange } }) => (
                            <Switch
                              value={toggleVal}
                              onValueChange={toggleChange}
                              trackColor={{ false: '#DDE3F0', true: '#0047AB' }}
                              thumbColor="#FFFFFF"
                              style={{ marginLeft: 8 }}
                            />
                          )}
                        />
                      </View>
                    )}
                  </View>
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Purchase Date */}
              <View>
                <Text style={styles.fieldLabel}>Purchase Date</Text>
                <Text style={styles.fieldHint}>When did you receive this stock?</Text>
                <TouchableOpacity
                  style={styles.datePickerTrigger}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color="#5A6A8A"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.datePickerText}>{formatDisplayDate(purchaseDate)}</Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker
                    value={purchaseDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    maximumDate={new Date()}
                    onChange={handleDateChange}
                  />
                )}
              </View>
            </Card>

            {/* ── Section 3: Supplier Details ──────────────────────────── */}
            {!supplierExpanded ? (
              <TouchableOpacity
                style={styles.expandSupplierBtn}
                onPress={() => setSupplierExpanded(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.expandSupplierText}>+ Add supplier details (optional)</Text>
              </TouchableOpacity>
            ) : (
              <>
                <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Supplier Details</Text>
                <Card style={styles.card}>

                  {/* Supplier Name */}
                  <Controller
                    control={control}
                    name="supplierName"
                    render={({ field: { value, onChange } }) => (
                      <View>
                        <Input
                          label="Supplier Name"
                          placeholder="e.g. Delta Beverages, Local Market"
                          autoCapitalize="words"
                          maxLength={80}
                          leftIcon={
                            <Ionicons name="business-outline" size={18} color="#5A6A8A" />
                          }
                          value={value ?? ''}
                          onChangeText={onChange}
                          error={errors.supplierName?.message}
                        />
                        {previousSuppliers.length > 0 && (
                          <View style={styles.suggestionsContainer}>
                            <Text style={styles.quickSelectLabel}>Recent suppliers:</Text>
                            <View style={styles.pillsRow}>
                              {previousSuppliers.map((s) => (
                                <TouchableOpacity
                                  key={s}
                                  onPress={() => onChange(s)}
                                  style={styles.supplierPill}
                                  activeOpacity={0.75}
                                >
                                  <Text style={styles.supplierPillText}>{s}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                  />

                  <View style={styles.fieldSpacer} />

                  {/* Reference No. */}
                  <Controller
                    control={control}
                    name="referenceNo"
                    render={({ field: { value, onChange } }) => (
                      <Input
                        label="Reference No."
                        placeholder="e.g. INV-2025-001"
                        hint="Invoice or delivery note number"
                        autoCapitalize="characters"
                        maxLength={40}
                        leftIcon={
                          <Ionicons name="document-outline" size={18} color="#5A6A8A" />
                        }
                        value={value ?? ''}
                        onChangeText={onChange}
                        error={errors.referenceNo?.message}
                      />
                    )}
                  />
                </Card>
              </>
            )}

            {/* ── Section 4: Notes ─────────────────────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Notes</Text>
            <Card style={styles.card}>
              <Controller
                control={control}
                name="notes"
                render={({ field: { value, onChange } }) => (
                  <Input
                    label="Notes"
                    placeholder="Any additional notes about this delivery..."
                    multiline
                    numberOfLines={3}
                    maxLength={200}
                    value={value ?? ''}
                    onChangeText={onChange}
                    error={errors.notes?.message}
                  />
                )}
              />
            </Card>

            {/* ── Purchase Summary ─────────────────────────────────────── */}
            {selectedProduct && validQty && newStockQty !== null && (
              <>
                <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>
                  Purchase Summary
                </Text>
                <Card
                  style={[
                    styles.card,
                    styles.summaryCard,
                  ]}
                >
                  <Text style={styles.summaryTitle}>Purchase Summary</Text>

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Product:</Text>
                    <Text style={styles.summaryValue}>{selectedProduct.name}</Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Qty receiving:</Text>
                    <Text style={[styles.summaryValue, styles.summaryValuePrimary]}>
                      {qtyNum} {selectedProduct.unit}
                    </Text>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Stock after:</Text>
                    <Text style={[styles.summaryValue, styles.summaryValueSuccess]}>
                      {newStockQty} {selectedProduct.unit}
                    </Text>
                  </View>

                  {validCost && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Total cost:</Text>
                      <Text style={styles.summaryValue}>
                        ${(costNum * qtyNum).toFixed(2)}
                      </Text>
                    </View>
                  )}

                  {watchedSupplier && watchedSupplier.trim().length > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Supplier:</Text>
                      <Text style={styles.summaryValue}>{watchedSupplier.trim()}</Text>
                    </View>
                  )}
                </Card>
              </>
            )}

            <View style={styles.bottomSpacer} />
          </View>
        </KeyboardAvoidingWrapper>

        {/* Fixed Save Bar */}
        <View style={styles.saveBar}>
          <Button
            variant="primary"
            fullWidth
            size="lg"
            label="Save Stock Purchase"
            loading={isSaving}
            disabled={!canSave}
            icon={
              !isSaving ? (
                <Ionicons name="save-outline" size={20} color="#FFFFFF" />
              ) : undefined
            }
            onPress={handleSubmit(onSubmit)}
          />
        </View>
      </View>

      {/* Product Picker Modal */}
      <ProductPickerModal
        visible={showPicker}
        businessId={business?.id ?? ''}
        onSelect={handleSelectProduct}
        onClose={() => setShowPicker(false)}
      />
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
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

  // Selected product display
  selectedProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedProductInfo: {
    flex: 1,
    marginRight: 12,
  },
  selectedProductName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  selectedProductStock: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 2,
  },
  changeText: {
    fontSize: 13,
    color: '#0047AB',
    fontWeight: '500',
  },

  // Product picker trigger
  productPickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  productPickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  productPickerPlaceholder: {
    fontSize: 16,
    color: '#A0AEC0',
  },

  // Projected stock row
  projectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  projectedLabel: {
    fontSize: 12,
    color: '#5A6A8A',
    marginRight: 4,
  },
  projectedValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0047AB',
  },

  // Update cost price prompt
  updateCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: '#FFF8EC',
    borderRadius: 8,
    padding: 10,
  },
  updateCostText: {
    flex: 1,
    fontSize: 13,
    color: '#B45309',
  },

  // Date picker
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0D1B3E',
    marginBottom: 4,
  },
  fieldHint: {
    fontSize: 12,
    color: '#718096',
    marginBottom: 8,
  },
  datePickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  datePickerText: {
    fontSize: 16,
    color: '#0D1B3E',
  },

  // Supplier expand
  expandSupplierBtn: {
    marginTop: 20,
    paddingVertical: 4,
  },
  expandSupplierText: {
    fontSize: 14,
    color: '#0047AB',
    fontWeight: '500',
  },

  // Supplier suggestions
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
  supplierPill: {
    backgroundColor: '#E6EEFF',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  supplierPillText: {
    fontSize: 12,
    color: '#0047AB',
  },

  // Summary card
  summaryCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#0047AB',
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryKey: {
    fontSize: 13,
    color: '#5A6A8A',
  },
  summaryValue: {
    fontSize: 13,
    color: '#0D1B3E',
    fontWeight: '500',
  },
  summaryValuePrimary: {
    color: '#0047AB',
    fontWeight: '600',
  },
  summaryValueSuccess: {
    color: '#0A7A4B',
    fontWeight: '600',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#DDE3F0',
    marginVertical: 6,
  },

  // Misc
  currencySymbol: {
    fontSize: 16,
    color: '#5A6A8A',
  },
  errorText: {
    fontSize: 12,
    color: '#C0152A',
    marginTop: 6,
  },
  bottomSpacer: {
    height: 20,
  },

  // Fixed save bar
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

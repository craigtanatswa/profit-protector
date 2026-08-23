import { Ionicons } from '@expo/vector-icons'
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker'
import { zodResolver } from '@hookform/resolvers/zod'
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { z } from 'zod'
import * as Crypto from 'expo-crypto'

import { KeyboardAvoidingWrapper, ScreenHeader } from '../../../src/components/layout'
import { ProductPickerModal } from '../../../src/components/inventory/ProductPickerModal'
import { Card, Input } from '../../../src/components/ui'
import { database } from '../../../src/database'
import type ProductModel from '../../../src/database/models/Product'
import type StockMovementModel from '../../../src/database/models/StockMovement'
import { formatDate } from '../../../src/lib/formatters'
import { useAuthStore } from '../../../src/stores/authStore'
import { getProductById } from '../../../src/hooks/useProducts'
import type { AdjustmentReason, Product } from '../../../src/types'
import {
  pushShopkeeperStockAdjustmentRemote,
  enqueuePendingShopkeeperStockAdjustment,
  flushPendingShopkeeperOutbound,
} from '../../../src/lib/shopkeeperAuth'
import { useShopkeeperStockAccessGate } from '../../../src/hooks/useShopkeeperStockAccessGate'
import { StockAccessPendingModal } from '../../../src/components/modals/StockAccessPendingModal'
import { logActivity } from '../../../src/lib/activityLogger'
import { sendLowStockNotification } from '../../../src/lib/notifications'
import { wmRaw } from '../../../src/lib/watermelonRaw'
import { isCutProduct } from '../../../src/lib/cutProducts'
import { addQty, formatQty, formatQtyWithUnit, parseQty, subtractQty } from '../../../src/lib/quantity'

type AdjustmentDirection = 'remove' | 'add'

function buildAdjustmentSchema(isShopkeeper: boolean) {
  return z
    .object({
      productId: z.string().min(1, 'Please select a product'),
      reason: z.enum(['damaged', 'theft', 'expired', 'correction'], {
        message: 'Please select a reason',
      }),
      direction: z.enum(['remove', 'add']),
      qty: z
        .string()
        .min(1, 'Quantity is required')
        .refine((v) => {
          const n = parseQty(v)
          return n != null && n > 0
        }, 'Quantity must be greater than 0'),
      description: z.string().max(150).optional(),
      adjustmentDate: z.number(),
    })
    .superRefine((data, ctx) => {
      if (isShopkeeper && data.reason === 'correction') {
        ctx.addIssue({
          code: 'custom',
          message: 'Correction adjustments are only available to the business owner.',
          path: ['reason'],
        })
      }
    })
}

type AdjustmentFormValues = z.infer<ReturnType<typeof buildAdjustmentSchema>>

// ─── Reason config ────────────────────────────────────────────────────────────

const REASONS: AdjustmentReason[] = ['damaged', 'theft', 'expired', 'correction']

const REASON_CONFIG: Record<
  AdjustmentReason,
  {
    icon: string
    label: string
    sublabel: string
    selectedBorder: string
    selectedBg: string
    selectedColor: string
  }
> = {
  damaged: {
    icon: 'warning-outline',
    label: 'Damaged',
    sublabel: 'Broken or unusable stock',
    selectedBorder: '#B45309',
    selectedBg: '#FFF8F0',
    selectedColor: '#B45309',
  },
  theft: {
    icon: 'alert-circle-outline',
    label: 'Theft / Loss',
    sublabel: 'Missing or stolen items',
    selectedBorder: '#C0152A',
    selectedBg: '#FFF0F0',
    selectedColor: '#C0152A',
  },
  expired: {
    icon: 'time-outline',
    label: 'Expired',
    sublabel: 'Past expiry date',
    selectedBorder: '#B45309',
    selectedBg: '#FFF8F0',
    selectedColor: '#B45309',
  },
  correction: {
    icon: 'create-outline',
    label: 'Correction',
    sublabel: 'Fix a counting error',
    selectedBorder: '#0047AB',
    selectedBg: '#E6EEFF',
    selectedColor: '#0047AB',
  },
}

const REASON_PLACEHOLDERS: Record<AdjustmentReason, string> = {
  damaged: 'e.g. Dropped during delivery, 3 bottles broken',
  theft: 'e.g. Discovered missing during evening count',
  expired: 'e.g. Expired 01 Apr 2025, disposed of',
  correction: 'e.g. Recount showed 5 extra units, entering correct figure',
}

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

// ─── Screen width ─────────────────────────────────────────────────────────────

const { width: screenWidth } = Dimensions.get('window')
const CARD_WIDTH = (screenWidth - 48 - 10) / 2

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdjustStockScreen() {
  const { productId: routeProductId, reason: routeReason } = useLocalSearchParams<{
    productId?: string
    reason?: string
  }>()

  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const isShopkeeper = activeRole === 'shopkeeper'
  const {
    ensureStockAccess,
    pendingVisible,
    pendingAccessType,
    closePending,
    shopkeeperName,
  } = useShopkeeperStockAccessGate()

  useFocusEffect(
    useCallback(() => {
      if (!isShopkeeper) return
      void ensureStockAccess('adjust')
    }, [isShopkeeper, ensureStockAccess]),
  )

  const adjustmentSchema = useMemo(() => buildAdjustmentSchema(isShopkeeper), [isShopkeeper])
  const reasonChoices = useMemo(
    () => (isShopkeeper ? REASONS.filter((r) => r !== 'correction') : REASONS),
    [isShopkeeper],
  )

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [selectedReason, setSelectedReason] = useState<AdjustmentReason | null>(null)
  const [direction, setDirection] = useState<AdjustmentDirection>('remove')
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [adjustmentDate, setAdjustmentDate] = useState(new Date())
  const [isLoading, setIsLoading] = useState(false)

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AdjustmentFormValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      productId: '',
      direction: 'remove',
      qty: '',
      description: '',
      adjustmentDate: Date.now(),
    },
  })

  const watchedQty = useWatch({ control, name: 'qty' })

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

  // Pre-select reason from route param (shopkeepers cannot use correction)
  useEffect(() => {
    const validAll: AdjustmentReason[] = ['damaged', 'theft', 'expired', 'correction']
    const valid = isShopkeeper ? validAll.filter((r) => r !== 'correction') : validAll
    if (routeReason && valid.includes(routeReason as AdjustmentReason)) {
      const r = routeReason as AdjustmentReason
      setSelectedReason(r)
      setValue('reason', r)
    }
  }, [routeReason, isShopkeeper, setValue])

  // Owner-only correction — clear invalid selection if session role changes
  useEffect(() => {
    if (!isShopkeeper || selectedReason !== 'correction') return
    setSelectedReason(null)
    setValue('reason', 'damaged')
  }, [isShopkeeper, selectedReason, setValue])

  // ── Derived values ──────────────────────────────────────────────────────────

  const parsedQty = parseQty(watchedQty)
  const validQty = parsedQty != null && parsedQty > 0
  const isRemoval = selectedReason !== 'correction' || direction === 'remove'
  const currentQty = selectedProduct?.stockQty ?? 0

  const projectedQty =
    validQty && parsedQty != null
      ? isRemoval
        ? subtractQty(currentQty, parsedQty)
        : addQty(currentQty, parsedQty)
      : null

  function stockAfterColor(qty: number): string {
    if (!selectedProduct) return '#5A6A8A'
    if (qty <= 0) return '#C0152A'
    if (qty <= selectedProduct.lowStockThreshold) return '#B45309'
    return '#0A7A4B'
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleSelectProduct(product: Product) {
    setSelectedProduct(product)
    setValue('productId', product.id)
    setShowProductPicker(false)
  }

  function handleClearProduct() {
    setSelectedProduct(null)
    setValue('productId', '')
    setValue('qty', '')
  }

  function handleSelectReason(reason: AdjustmentReason) {
    setSelectedReason(reason)
    setValue('reason', reason)
    if (reason !== 'correction') {
      setDirection('remove')
      setValue('direction', 'remove')
    }
  }

  function handleToggleDirection(dir: AdjustmentDirection) {
    setDirection(dir)
    setValue('direction', dir)
  }

  function handleDateChange(_event: DateTimePickerEvent, date?: Date) {
    setShowDatePicker(false)
    if (date) {
      setAdjustmentDate(date)
      setValue('adjustmentDate', date.getTime())
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  const onSave = handleSubmit(async (values) => {
    if (!database || !business || !selectedProduct) {
      Alert.alert('Save Failed', 'Missing required data.')
      return
    }

    const qty = parseQty(values.qty)
    if (qty == null || qty <= 0) {
      Alert.alert('Invalid quantity', 'Enter a quantity greater than 0.')
      return
    }
    if (!isCutProduct(selectedProduct) && !Number.isInteger(qty)) {
      Alert.alert('Invalid quantity', 'Packed items must be adjusted by a whole number.')
      return
    }
    const isRemoving =
      values.reason !== 'correction' || values.direction === 'remove'

    // Runtime validation: qty does not exceed stock for removals
    if (isRemoving && qty > selectedProduct.stockQty) {
      Alert.alert(
        'Cannot Remove Stock',
        `Cannot remove ${formatQtyWithUnit(qty, selectedProduct.unit)}. Current stock is only ${formatQtyWithUnit(selectedProduct.stockQty, selectedProduct.unit)}.`,
      )
      return
    }

    setIsLoading(true)
    try {
      const qtyChange = isRemoving ? -qty : qty
      const newStockQty = isRemoving
        ? subtractQty(selectedProduct.stockQty, qty)
        : addQty(selectedProduct.stockQty, qty)
      const reasonString = values.description
        ? `${values.reason}: ${values.description}`
        : values.reason

      const updatedMs = Date.now()
      const movementId = Crypto.randomUUID()
      const adjustmentCreatedMs = values.adjustmentDate || Date.now()

      const productRecord = await database
        .get<ProductModel>('products')
        .find(values.productId)

      await database.write(async () => {
        await productRecord.update((p) => {
          p.stockQty = newStockQty
          wmRaw(p).updated_at = updatedMs
        })

        await database!
          .get<StockMovementModel>('stock_movements')
          .create((m) => {
            m._raw.id = movementId
            m.businessId = business.id
            m.productId = selectedProduct.id
            m.productNameSnapshot = selectedProduct.name
            m.action = 'adjustment'
            m.qtyChange = qtyChange
            m.reason = reasonString
            m.supplier = ''
            wmRaw(m).created_at = adjustmentCreatedMs
          })
      })

      const staffName =
        activeRole === 'shopkeeper'
          ? useAuthStore.getState().shopkeeperSession?.shopkeeper.fullName?.trim() || 'Staff'
          : undefined
      const adjustmentDetails = {
        qtyChange,
        reason: reasonString,
        unit: selectedProduct.unit,
        ...(staffName ? { staffName } : {}),
      }

      const activityLogId = await logActivity({
        action: 'stock_adjusted',
        entityType: 'stock_movement',
        entityId: selectedProduct.id,
        entityName: selectedProduct.name,
        details: adjustmentDetails,
      })

      if (activeRole === 'owner') {
        // Offline-first: local write already visible via WatermelonDB reactive subscriptions.
        // Fast path: push products + movements to cloud immediately so Realtime fires to shopkeeper.
        // Full sync runs in background to reconcile all other tables.
        useAuthStore.getState().triggerInventorySync(business.id)
      } else if (activeRole === 'shopkeeper') {
        const tok = useAuthStore.getState().shopkeeperSession?.sessionToken
        const skId = useAuthStore.getState().shopkeeperSession?.shopkeeper.id
        const adjustmentPayload = {
          product_patch: {
            product_id: values.productId,
            stock_qty: newStockQty,
            updated_at: new Date(updatedMs).toISOString(),
          },
          stock_movement: {
            id: movementId,
            business_id: business.id,
            product_id: selectedProduct.id,
            product_name_snapshot: selectedProduct.name,
            action: 'adjustment',
            qty_change: qtyChange,
            reason: reasonString,
            supplier: '',
            created_at: new Date(adjustmentCreatedMs).toISOString(),
          },
          activity_log: {
            id: activityLogId ?? Crypto.randomUUID(),
            action: 'stock_adjusted' as const,
            entity_type: 'stock_movement' as const,
            entity_id: selectedProduct.id,
            entity_name: selectedProduct.name,
            details: adjustmentDetails,
            created_at: new Date(adjustmentCreatedMs).toISOString(),
          },
        }
        void (async () => {
          if (!tok || !skId) return
          try {
            await flushPendingShopkeeperOutbound(tok, business.id, skId)
            const ok = await pushShopkeeperStockAdjustmentRemote(tok, adjustmentPayload)
            if (!ok) {
              await enqueuePendingShopkeeperStockAdjustment(
                business.id,
                movementId,
                adjustmentPayload.activity_log.id,
              )
            }
          } catch {
            await enqueuePendingShopkeeperStockAdjustment(
              business.id,
              movementId,
              adjustmentPayload.activity_log.id,
            )
          }
        })()
      }

      if (
        selectedProduct.lowStockThreshold > 0 &&
        newStockQty <= selectedProduct.lowStockThreshold
      ) {
        sendLowStockNotification({
          businessId: business.id,
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          currentStock: newStockQty,
          threshold: selectedProduct.lowStockThreshold,
          unit: selectedProduct.unit,
        }).catch((err) =>
          console.warn('Low stock notification failed:', err?.message ?? err),
        )
      }

      const unit = selectedProduct.unit
      const productName = selectedProduct.name
      const reasonLabel =
        REASON_CONFIG[values.reason as AdjustmentReason]?.label ?? values.reason

      const successMessage = isRemoving
        ? `${formatQtyWithUnit(qty, unit)} of ${productName} removed.\nReason: ${reasonLabel}\nNew stock: ${formatQtyWithUnit(newStockQty, unit)}`
        : `${formatQtyWithUnit(qty, unit)} of ${productName} added.\nReason: Correction\nNew stock: ${formatQtyWithUnit(newStockQty, unit)}`

      Alert.alert('Stock Adjusted', successMessage, [
        {
          text: 'OK',
          onPress: () => {
            router.back()
            if (isRemoving && newStockQty <= selectedProduct.lowStockThreshold) {
              setTimeout(() => {
                Alert.alert(
                  'Low Stock Warning',
                  `${productName} is now low on stock (${newStockQty} ${unit} remaining). Consider ordering more soon.`,
                  [
                    { text: 'Dismiss' },
                    {
                      text: 'Order Stock',
                      onPress: () =>
                        router.push({
                          pathname: '/(app)/inventory/purchase',
                          params: { productId: selectedProduct.id },
                        }),
                    },
                  ],
                )
              }, 500)
            }
          },
        },
      ])
    } catch (error) {
      Alert.alert(
        'Save Failed',
        error instanceof Error ? error.message : JSON.stringify(error),
      )
    } finally {
      setIsLoading(false)
    }
  })

  // ── Button state ────────────────────────────────────────────────────────────

  const isSaveDisabled =
    !selectedReason || !selectedProduct || !watchedQty || !validQty || isLoading

  let saveButtonBg = '#C0152A'
  if (selectedReason === 'correction') {
    saveButtonBg = direction === 'remove' ? '#B45309' : '#0047AB'
  }
  if (isSaveDisabled) {
    saveButtonBg = '#A0AEC0'
  }

  function getSummaryBorderColor(): string {
    if (!selectedReason) return '#DDE3F0'
    if (selectedReason === 'correction') {
      return direction === 'remove' ? '#B45309' : '#0047AB'
    }
    return '#C0152A'
  }

  const showSummary = !!selectedProduct && !!selectedReason && validQty

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        title="Adjust Stock"
        leftAction={{ icon: 'arrow-back-outline', onPress: () => router.back() }}
        showBorder
      />

      <View style={styles.body}>
        <KeyboardAvoidingWrapper>
          <View style={styles.scrollContent}>

            {/* ── Reason Selector ─────────────────────────────────────── */}
            <Text style={styles.sectionLabel}>Reason for Adjustment</Text>
            <View style={styles.reasonGrid}>
              {reasonChoices.map((reasonKey) => {
                const config = REASON_CONFIG[reasonKey]
                const isSelected = selectedReason === reasonKey
                return (
                  <TouchableOpacity
                    key={reasonKey}
                    style={[
                      styles.reasonCard,
                      isSelected && {
                        borderColor: config.selectedBorder,
                        backgroundColor: config.selectedBg,
                      },
                    ]}
                    onPress={() => handleSelectReason(reasonKey)}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={config.icon as keyof typeof Ionicons.glyphMap}
                      size={28}
                      color={isSelected ? config.selectedColor : '#5A6A8A'}
                    />
                    <Text
                      style={[
                        styles.reasonLabel,
                        isSelected && { color: config.selectedColor },
                      ]}
                    >
                      {config.label}
                    </Text>
                    <Text
                      style={[
                        styles.reasonSublabel,
                        isSelected && { color: config.selectedColor },
                      ]}
                    >
                      {config.sublabel}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            {errors.reason && (
              <Text style={styles.errorText}>{errors.reason.message}</Text>
            )}

            {/* ── Section 1: Product ───────────────────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Product</Text>
            <Card style={styles.card}>
              {selectedProduct ? (
                <View style={styles.selectedProductRow}>
                  <View style={styles.selectedProductInfo}>
                    <Text style={styles.selectedProductName}>
                      {selectedProduct.name}
                    </Text>
                    <Text style={styles.selectedProductStock}>
                      Current stock: {formatQtyWithUnit(selectedProduct.stockQty, selectedProduct.unit)}
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
                  onPress={() => setShowProductPicker(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.productPickerLeft}>
                    <Ionicons
                      name="cube-outline"
                      size={18}
                      color="#5A6A8A"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.productPickerPlaceholder}>
                      Select a product...
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#5A6A8A" />
                </TouchableOpacity>
              )}
              {errors.productId && (
                <Text style={styles.errorText}>{errors.productId.message}</Text>
              )}
            </Card>

            {/* ── Section 2: Adjustment Details ───────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>
              Adjustment Details
            </Text>
            <Card style={styles.card}>
              {/* Direction toggle — correction only */}
              {selectedReason === 'correction' && (
                <View style={styles.directionToggleRow}>
                  <TouchableOpacity
                    style={[
                      styles.directionPill,
                      direction === 'remove' && styles.directionPillSelected,
                    ]}
                    onPress={() => handleToggleDirection('remove')}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.directionPillText,
                        direction === 'remove' && styles.directionPillTextSelected,
                      ]}
                    >
                      Remove stock
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.directionPill,
                      direction === 'add' && styles.directionPillSelected,
                    ]}
                    onPress={() => handleToggleDirection('add')}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.directionPillText,
                        direction === 'add' && styles.directionPillTextSelected,
                      ]}
                    >
                      Add stock
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Quantity field */}
              <Controller
                control={control}
                name="qty"
                render={({ field: { value, onChange } }) => (
                  <View>
                    <Input
                      label={
                        selectedProduct
                          ? `${isRemoval ? 'Quantity to Remove' : 'Quantity to Add'} (${selectedProduct.unit})`
                          : isRemoval
                            ? 'Quantity to Remove'
                            : 'Quantity to Add'
                      }
                      keyboardType={
                        selectedProduct && isCutProduct(selectedProduct)
                          ? 'decimal-pad'
                          : 'number-pad'
                      }
                      placeholder={
                        selectedProduct && isCutProduct(selectedProduct) ? '0.00' : '0'
                      }
                      leftIcon={
                        <Ionicons
                          name={
                            isRemoval
                              ? 'remove-circle-outline'
                              : 'add-circle-outline'
                          }
                          size={18}
                          color={isRemoval ? '#C0152A' : '#0047AB'}
                        />
                      }
                      value={value}
                      onChangeText={onChange}
                      error={errors.qty?.message}
                    />
                    {selectedProduct && validQty && projectedQty !== null && (
                      <View style={styles.projectedRow}>
                        <Text style={styles.projectedLabel}>
                          Stock after adjustment:
                        </Text>
                        <Text
                          style={[
                            styles.projectedValue,
                            { color: stockAfterColor(projectedQty) },
                          ]}
                        >
                          {formatQtyWithUnit(projectedQty, selectedProduct.unit)}
                        </Text>
                      </View>
                    )}
                    {selectedProduct &&
                      validQty &&
                      isRemoval &&
                      parsedQty > currentQty && (
                        <Text style={styles.overStockError}>
                          Cannot remove more than current stock ({formatQty(currentQty)})
                        </Text>
                      )}
                  </View>
                )}
              />

              <View style={styles.fieldSpacer} />

              {/* Description field */}
              <Controller
                control={control}
                name="description"
                render={({ field: { value, onChange } }) => (
                  <Input
                    label={
                      selectedReason === 'correction'
                        ? 'Reason for Correction'
                        : 'Description (optional)'
                    }
                    placeholder={
                      selectedReason
                        ? REASON_PLACEHOLDERS[selectedReason]
                        : 'Add a description...'
                    }
                    multiline
                    numberOfLines={2}
                    maxLength={150}
                    value={value ?? ''}
                    onChangeText={onChange}
                    error={errors.description?.message}
                    hint={
                      selectedReason === 'correction'
                        ? 'Describe what happened so you can audit this later'
                        : undefined
                    }
                  />
                )}
              />
            </Card>

            {/* ── Section 3: Date ──────────────────────────────────────── */}
            <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>Date</Text>
            <Card style={styles.card}>
              <Text style={styles.fieldLabel}>Adjustment Date</Text>
              <Text style={styles.fieldHint}>When did this happen?</Text>
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
                <Text style={styles.datePickerText}>
                  {formatDisplayDate(adjustmentDate)}
                </Text>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={adjustmentDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  maximumDate={new Date()}
                  onChange={handleDateChange}
                />
              )}
            </Card>

            {/* ── Adjustment Summary ───────────────────────────────────── */}
            {showSummary && selectedProduct && selectedReason && (
              <>
                <Text style={[styles.sectionLabel, styles.sectionLabelTop]}>
                  Adjustment Summary
                </Text>
                <Card
                  style={[
                    styles.card,
                    styles.summaryCard,
                    { borderLeftColor: getSummaryBorderColor() },
                  ]}
                >
                  <Text style={styles.summaryTitle}>Adjustment Summary</Text>

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Product:</Text>
                    <Text style={styles.summaryValue} numberOfLines={1}>
                      {selectedProduct.name}
                    </Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Reason:</Text>
                    <Text style={styles.summaryValue}>
                      {REASON_CONFIG[selectedReason].label}
                    </Text>
                  </View>

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Adjustment:</Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        { color: isRemoval ? '#C0152A' : '#0047AB' },
                      ]}
                    >
                      {isRemoval ? '−' : '+'}
                      {formatQtyWithUnit(parsedQty ?? 0, selectedProduct.unit)}
                    </Text>
                  </View>

                  <View style={styles.summaryDivider} />

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryKey}>Stock before:</Text>
                    <Text style={[styles.summaryValue, { color: '#5A6A8A' }]}>
                      {formatQtyWithUnit(currentQty, selectedProduct.unit)}
                    </Text>
                  </View>

                  {projectedQty !== null && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Stock after:</Text>
                      <Text
                        style={[
                          styles.summaryValue,
                          { color: stockAfterColor(projectedQty) },
                        ]}
                      >
                        {formatQtyWithUnit(projectedQty, selectedProduct.unit)}
                      </Text>
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
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: saveButtonBg }]}
            onPress={isSaveDisabled ? undefined : onSave}
            disabled={isSaveDisabled}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <View style={styles.saveButtonInner}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={20}
                  color="#FFFFFF"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.saveButtonText}>Save Adjustment</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Product Picker Modal */}
      <ProductPickerModal
        visible={showProductPicker}
        businessId={business?.id ?? ''}
        onSelect={handleSelectProduct}
        onClose={() => setShowProductPicker(false)}
      />

      <StockAccessPendingModal
        visible={pendingVisible}
        accessType={pendingAccessType}
        shopkeeperName={shopkeeperName}
        onCancel={closePending}
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
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
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
  errorText: {
    fontSize: 12,
    color: '#C0152A',
    marginTop: 6,
  },
  overStockError: {
    fontSize: 12,
    color: '#C0152A',
    marginTop: 4,
  },
  bottomSpacer: {
    height: 20,
  },

  // Reason grid
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reasonCard: {
    width: CARD_WIDTH,
    height: 88,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
    padding: 12,
    justifyContent: 'flex-start',
  },
  reasonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
    marginTop: 6,
  },
  reasonSublabel: {
    fontSize: 11,
    color: '#5A6A8A',
    marginTop: 2,
  },

  // Product selector
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

  // Direction toggle (correction only)
  directionToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  directionPill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
  },
  directionPillSelected: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  directionPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
  },
  directionPillTextSelected: {
    color: '#FFFFFF',
  },

  // Live preview
  projectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  projectedLabel: {
    fontSize: 12,
    color: '#5A6A8A',
  },
  projectedValue: {
    fontSize: 12,
    fontWeight: '600',
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

  // Summary card
  summaryCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#C0152A',
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
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#DDE3F0',
    marginVertical: 6,
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
  saveButton: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
})

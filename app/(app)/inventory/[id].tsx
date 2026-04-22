import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

import { ScreenHeader } from '../../../src/components/layout'
import { Button, Card, EmptyState } from '../../../src/components/ui'
import { useProductDetail } from '../../../src/hooks/useProductDetail'
import { useQuietOfflineRefreshOnFocus } from '../../../src/hooks/useQuietOfflineRefreshOnFocus'
import { useMoneyFormat } from '../../../src/hooks/useMoneyFormat'
import type { StockMovement } from '../../../src/types'

// ─── Types ───────────────────────────────────────────────────────────────────

type MovementFilter = 'All' | 'Sales' | 'Purchases' | 'Adjustments'

interface MovementWithBalance extends StockMovement {
  balance: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateName(name: string, max = 24): string {
  return name.length > max ? name.slice(0, max) + '...' : name
}

function formatMovementDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const movStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const timeStr = `${hh}:${mm}`

  if (movStart === todayStart) return `Today, ${timeStr}`
  if (movStart === yesterdayStart) return `Yesterday, ${timeStr}`

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${date.getDate()} ${months[date.getMonth()]} · ${timeStr}`
}

function getMarginBadge(marginNum: number): { bg: string; text: string } {
  if (marginNum < 0) return { bg: '#FCEBEB', text: '#C0152A' }
  if (marginNum < 10) return { bg: '#FAEEDA', text: '#854F0B' }
  if (marginNum < 20) return { bg: '#EAF3DE', text: '#3B6D11' }
  return { bg: '#E6EEFF', text: '#0047AB' }
}

function getMovementIconInfo(m: StockMovement): {
  icon: keyof typeof Ionicons.glyphMap
  bgColor: string
  iconColor: string
} {
  if (m.action === 'sale') {
    return { icon: 'cart-outline', bgColor: '#E6EEFF', iconColor: '#0047AB' }
  }
  if (m.action === 'purchase') {
    return { icon: 'arrow-down-circle-outline', bgColor: '#EAF3DE', iconColor: '#0A7A4B' }
  }
  // adjustment
  if (m.qtyChange < 0) {
    return { icon: 'remove-circle-outline', bgColor: '#FCEBEB', iconColor: '#C0152A' }
  }
  return { icon: 'add-circle-outline', bgColor: '#E6EEFF', iconColor: '#0047AB' }
}

function parseReasonLabel(m: StockMovement): string {
  if (m.action === 'sale') return 'Sold'
  if (m.action === 'purchase') return 'Received'
  const reason = (m.reason ?? '').toLowerCase()
  if (reason.startsWith('damaged')) return 'Damaged'
  if (reason.startsWith('theft')) return 'Theft'
  if (reason.startsWith('expired')) return 'Expired'
  if (reason.startsWith('correction')) return 'Correction'
  return 'Adjusted'
}

function parseReasonSubLabel(m: StockMovement): string {
  if (m.action === 'sale') return 'Sale recorded'
  if (m.action === 'purchase') return m.supplier ?? 'Stock received'
  const reason = m.reason ?? ''
  const colonIdx = reason.indexOf(':')
  if (colonIdx !== -1) {
    const description = reason.substring(colonIdx + 1).trim()
    if (description) return description
  }
  return 'Manual adjustment'
}

function formatQtyChange(m: StockMovement, unit: string): { text: string; color: string } {
  if (m.qtyChange > 0) {
    return { text: `+${m.qtyChange} ${unit}`, color: '#0A7A4B' }
  }
  return { text: `\u2212${Math.abs(m.qtyChange)} ${unit}`, color: '#C0152A' }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBlock({
  height,
  opacity,
  borderRadius = 12,
  style,
}: {
  height: number
  opacity: Animated.AnimatedInterpolation<number>
  borderRadius?: number
  style?: object
}) {
  return (
    <Animated.View
      style={[
        {
          height,
          backgroundColor: '#DDE3F0',
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProductDetailScreen() {
  const router = useRouter()
  const { formatMoney } = useMoneyFormat()
  const { id } = useLocalSearchParams<{ id: string }>()
  const productId = Array.isArray(id) ? id[0] : (id ?? '')

  const { product, movements, isLoading, error, refreshFromLocal } =
    useProductDetail(productId)

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      void refreshFromLocal()
    }, [refreshFromLocal]),
  )

  const [movementFilter, setMovementFilter] = useState<MovementFilter>('All')

  // Pulse animation for skeleton
  const pulseAnim = useRef(new Animated.Value(0.4)).current
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    )
    pulse.start()
    return () => pulse.stop()
  }, [pulseAnim])

  // Running balances — work backwards from current stock (accurate even with Q.take)
  const movementsWithBalance = useMemo<MovementWithBalance[]>(() => {
    if (!product) return movements.map((m) => ({ ...m, balance: 0 }))
    let balance = product.stockQty
    return movements.map((m) => {
      const balanceAfter = balance
      balance -= m.qtyChange
      return { ...m, balance: balanceAfter }
    })
  }, [movements, product])

  // Filtered with balance
  const displayMovements = useMemo<MovementWithBalance[]>(() => {
    if (movementFilter === 'All') return movementsWithBalance
    return movementsWithBalance.filter((m) => {
      switch (movementFilter) {
        case 'Sales': return m.action === 'sale'
        case 'Purchases': return m.action === 'purchase'
        case 'Adjustments': return m.action === 'adjustment'
        default: return true
      }
    })
  }, [movementsWithBalance, movementFilter])

  // Lifetime stats
  const salesMovements = useMemo(
    () => movements.filter((m) => m.action === 'sale'),
    [movements],
  )
  const totalSold = useMemo(
    () => salesMovements.reduce((sum, m) => sum + Math.abs(m.qtyChange), 0),
    [salesMovements],
  )

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader
          title="Product Detail"
          leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
          showBorder
        />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <SkeletonBlock height={180} opacity={pulseAnim} style={{ marginBottom: 12 }} />
          <View style={styles.skeletonRow}>
            <SkeletonBlock height={80} opacity={pulseAnim} style={{ flex: 1 }} />
            <SkeletonBlock height={80} opacity={pulseAnim} style={{ flex: 1 }} />
            <SkeletonBlock height={80} opacity={pulseAnim} style={{ flex: 1 }} />
          </View>
          <View style={{ gap: 8, marginTop: 16 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <SkeletonBlock
                key={i}
                height={56}
                opacity={pulseAnim}
                borderRadius={8}
              />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  // ── Error / not found ─────────────────────────────────────────────────────
  if (error || !product) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader
          title="Product Detail"
          leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
          showBorder
        />
        <EmptyState
          icon="cube-outline"
          title="Product not found"
          subtitle="This product may have been removed"
          actionLabel="Go Back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    )
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const {
    name,
    category,
    unit,
    costPriceCents,
    sellingPriceCents,
    stockQty,
    lowStockThreshold,
  } = product

  const profitCents = sellingPriceCents - costPriceCents
  const marginPercent =
    costPriceCents > 0
      ? ((profitCents / costPriceCents) * 100).toFixed(1)
      : '0.0'
  const marginNum = parseFloat(marginPercent)
  const marginBadge = getMarginBadge(marginNum)

  const stockColor =
    stockQty === 0
      ? '#C0152A'
      : stockQty <= lowStockThreshold
      ? '#B45309'
      : '#0A7A4B'

  const stockValueCents = stockQty * sellingPriceCents
  const totalRevenueCents = totalSold * sellingPriceCents
  const totalProfitCents = totalSold * profitCents

  // ── Navigation helpers ────────────────────────────────────────────────────
  const goToReceive = () =>
    router.push({
      pathname: '/(app)/inventory/purchase',
      params: { productId },
    })

  const goToAdjust = () =>
    router.push({
      pathname: '/(app)/inventory/adjust',
      params: { productId },
    })

  const goToEdit = () =>
    router.push({
      pathname: '/(app)/inventory/add',
      params: { productId },
    })

  // ── Render ────────────────────────────────────────────────────────────────
  const FILTERS: MovementFilter[] = ['All', 'Sales', 'Purchases', 'Adjustments']

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        title={truncateName(name)}
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        rightAction={{ icon: 'create-outline', onPress: goToEdit }}
        showBorder
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── SECTION 1: Hero Card ────────────────────────────────────── */}
        <Card padding="lg" style={styles.heroCard}>
          {/* Top row */}
          <View style={styles.heroTopRow}>
            {/* Left: name, category, unit */}
            <View style={styles.heroLeft}>
              <Text style={styles.heroName}>{name}</Text>
              {category != null && category.length > 0 && (
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryPillText}>{category}</Text>
                </View>
              )}
              <Text style={styles.heroUnit}>Sold by the {unit}</Text>
            </View>

            {/* Right: price, cost, margin */}
            <View style={styles.heroRight}>
              <Text style={styles.heroSellingPrice}>
                {formatMoney(sellingPriceCents)}
              </Text>
              <Text style={styles.heroCostPrice}>
                Cost: {formatMoney(costPriceCents)}
              </Text>
              <View
                style={[
                  styles.marginPill,
                  { backgroundColor: marginBadge.bg },
                ]}
              >
                <Text style={[styles.marginPillText, { color: marginBadge.text }]}>
                  {marginPercent}% margin
                </Text>
              </View>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.heroDivider} />

          {/* Stock status row */}
          <View style={styles.stockRow}>
            {/* Column 1 — In Stock */}
            <View style={styles.stockCol}>
              <Text style={styles.stockLabel}>In Stock</Text>
              <Text style={[styles.stockValueLarge, { color: stockColor }]}>
                {stockQty} {unit}
              </Text>
            </View>

            <View style={styles.stockDivider} />

            {/* Column 2 — Stock Value */}
            <View style={styles.stockCol}>
              <Text style={styles.stockLabel}>Stock Value</Text>
              <Text style={[styles.stockValueMed, { color: '#0047AB' }]}>
                {formatMoney(stockValueCents)}
              </Text>
            </View>

            <View style={styles.stockDivider} />

            {/* Column 3 — Alert At */}
            <View style={styles.stockCol}>
              <Text style={styles.stockLabel}>Alert At</Text>
              <Text style={[styles.stockValueMed, { color: '#0D1B3E' }]}>
                {lowStockThreshold} {unit}
              </Text>
            </View>
          </View>

          {/* Out of stock banner */}
          {stockQty === 0 && (
            <View style={styles.outOfStockBanner}>
              <Ionicons name="alert-circle" size={16} color="#C0152A" />
              <Text style={styles.outOfStockText}>
                Out of stock — tap &apos;Receive Stock&apos; to reorder
              </Text>
            </View>
          )}

          {/* Low stock banner */}
          {stockQty > 0 && stockQty <= lowStockThreshold && (
            <View style={styles.lowStockBanner}>
              <Ionicons name="warning" size={16} color="#B45309" />
              <Text style={styles.lowStockText}>
                Low stock — only {stockQty} {unit} remaining
              </Text>
            </View>
          )}
        </Card>

        {/* ── Stat Summary Row ────────────────────────────────────────── */}
        <View style={styles.statSummaryRow}>
          <View style={styles.statSummaryCol}>
            <Text style={styles.statSummaryValue}>{totalSold}</Text>
            <Text style={styles.statSummaryLabel}>Total Sold</Text>
          </View>
          <View style={styles.statSummaryCol}>
            <Text style={[styles.statSummaryValue, { color: '#0047AB' }]}>
              {formatMoney(totalRevenueCents)}
            </Text>
            <Text style={styles.statSummaryLabel}>Total Revenue</Text>
          </View>
          <View style={styles.statSummaryCol}>
            <Text
              style={[
                styles.statSummaryValue,
                { color: totalProfitCents >= 0 ? '#0A7A4B' : '#C0152A' },
              ]}
            >
              {formatMoney(totalProfitCents)}
            </Text>
            <Text style={styles.statSummaryLabel}>Total Profit</Text>
          </View>
        </View>

        {/* ── SECTION 2: Quick Actions ─────────────────────────────────── */}
        <Text style={styles.sectionLabel}>Quick Actions</Text>
        <View style={styles.quickActionsRow}>
          {/* Receive Stock */}
          <TouchableOpacity
            style={[
              styles.actionCard,
              { backgroundColor: '#E6EEFF', borderColor: 'rgba(0,71,171,0.3)' },
            ]}
            onPress={goToReceive}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-down-circle" size={24} color="#0047AB" />
            <Text style={[styles.actionCardLabel, { color: '#0047AB' }]}>
              Receive Stock
            </Text>
          </TouchableOpacity>

          {/* Adjust Stock */}
          <TouchableOpacity
            style={[
              styles.actionCard,
              { backgroundColor: '#FFF8F0', borderColor: 'rgba(180,83,9,0.3)' },
            ]}
            onPress={goToAdjust}
            activeOpacity={0.8}
          >
            <Ionicons name="swap-vertical" size={24} color="#B45309" />
            <Text style={[styles.actionCardLabel, { color: '#B45309' }]}>
              Adjust Stock
            </Text>
          </TouchableOpacity>

          {/* Edit Details */}
          <TouchableOpacity
            style={[
              styles.actionCard,
              { backgroundColor: '#F4F6FB', borderColor: '#DDE3F0' },
            ]}
            onPress={goToEdit}
            activeOpacity={0.8}
          >
            <Ionicons name="create" size={24} color="#5A6A8A" />
            <Text style={[styles.actionCardLabel, { color: '#5A6A8A' }]}>
              Edit Details
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── SECTION 3: Pricing & Margins ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>Pricing &amp; Margins</Text>
        <Card padding="md" style={styles.sectionCard}>
          {/* Selling Price */}
          <View style={styles.priceRow}>
            <Text style={styles.priceRowLabel}>Selling Price</Text>
            <Text style={[styles.priceRowValue, { color: '#0047AB', fontWeight: '600' }]}>
              {formatMoney(sellingPriceCents)}
            </Text>
          </View>

          {/* Cost Price */}
          <View style={styles.priceRow}>
            <Text style={styles.priceRowLabel}>Cost Price</Text>
            <Text style={[styles.priceRowValue, { color: '#0D1B3E' }]}>
              {formatMoney(costPriceCents)}
            </Text>
          </View>

          {/* Profit Per Unit */}
          <View style={styles.priceRow}>
            <Text style={styles.priceRowLabel}>Profit Per Unit</Text>
            <Text
              style={[
                styles.priceRowValue,
                {
                  color:
                    profitCents > 0
                      ? '#0A7A4B'
                      : profitCents < 0
                      ? '#C0152A'
                      : '#5A6A8A',
                },
              ]}
            >
              {formatMoney(profitCents)}
            </Text>
          </View>

          {/* Margin */}
          <View style={styles.priceRow}>
            <Text style={styles.priceRowLabel}>Margin</Text>
            <Text
              style={[
                styles.priceRowValue,
                {
                  color:
                    marginNum > 0
                      ? '#0A7A4B'
                      : marginNum < 0
                      ? '#C0152A'
                      : '#5A6A8A',
                },
              ]}
            >
              {marginPercent}%
            </Text>
          </View>

          {/* Total Stock Value */}
          <View style={[styles.priceRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.priceRowLabel, { fontWeight: '500' }]}>
              Total Stock Value
            </Text>
            <Text style={[styles.priceRowValue, { color: '#0047AB', fontWeight: '600' }]}>
              {formatMoney(stockValueCents)}
            </Text>
          </View>
        </Card>

        {/* ── SECTION 4: Stock Movement History ────────────────────────── */}
        <Text style={styles.sectionLabel}>Stock Movement History</Text>

        {/* Filter pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterPillsContent}
          style={styles.filterPillsScroll}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              style={[
                styles.filterPill,
                movementFilter === f && styles.filterPillActive,
              ]}
              onPress={() => setMovementFilter(f)}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.filterPillText,
                  movementFilter === f && styles.filterPillTextActive,
                ]}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Movement list */}
        <Card padding="none" style={styles.sectionCard}>
          {displayMovements.length === 0 ? (
            <View style={styles.movementEmpty}>
              <Ionicons name="time-outline" size={20} color="#DDE3F0" />
              <Text style={styles.movementEmptyText}>No movement history yet</Text>
            </View>
          ) : (
            displayMovements.map((m, index) => {
              const iconInfo = getMovementIconInfo(m)
              const qtyDisplay = formatQtyChange(m, unit)
              const isLast = index === displayMovements.length - 1

              return (
                <View
                  key={m.id}
                  style={[
                    styles.movementRow,
                    !isLast && styles.movementRowBorder,
                  ]}
                >
                  {/* Left: icon + labels */}
                  <View style={styles.movementLeft}>
                    <View
                      style={[
                        styles.movementIconCircle,
                        { backgroundColor: iconInfo.bgColor },
                      ]}
                    >
                      <Ionicons
                        name={iconInfo.icon}
                        size={16}
                        color={iconInfo.iconColor}
                      />
                    </View>
                    <View style={styles.movementTextCol}>
                      <Text style={styles.movementActionLabel}>
                        {parseReasonLabel(m)}
                      </Text>
                      <Text style={styles.movementSubLabel} numberOfLines={1}>
                        {parseReasonSubLabel(m)}
                      </Text>
                      <Text style={styles.movementBalance}>
                        Balance: {m.balance} {unit}
                      </Text>
                    </View>
                  </View>

                  {/* Right: qty + date */}
                  <View style={styles.movementRight}>
                    <Text style={[styles.movementQty, { color: qtyDisplay.color }]}>
                      {qtyDisplay.text}
                    </Text>
                    <Text style={styles.movementDate}>
                      {formatMovementDate(m.createdAt)}
                    </Text>
                  </View>
                </View>
              )
            })
          )}
        </Card>

        {/* bottom spacer for fixed action bar */}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* ── Fixed Bottom Action Bar ──────────────────────────────────────── */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomBarButtons}>
          <View style={{ flex: 1 }}>
            <Button
              label="Receive Stock"
              onPress={goToReceive}
              variant="secondary"
              size="md"
              icon={
                <Ionicons
                  name="arrow-down-circle-outline"
                  size={18}
                  color="#0047AB"
                />
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Adjust Stock"
              onPress={goToAdjust}
              variant="primary"
              size="md"
              icon={
                <Ionicons
                  name="swap-vertical-outline"
                  size={18}
                  color="#FFFFFF"
                />
              }
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },

  // Skeleton
  skeletonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },

  // Hero card
  heroCard: {
    marginBottom: 12,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLeft: {
    flex: 1,
    marginRight: 12,
  },
  heroName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#E6EEFF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#0047AB',
  },
  heroUnit: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 4,
  },
  heroRight: {
    alignItems: 'flex-end',
  },
  heroSellingPrice: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0047AB',
  },
  heroCostPrice: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 2,
  },
  marginPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginTop: 4,
  },
  marginPillText: {
    fontSize: 12,
    fontWeight: '500',
  },
  heroDivider: {
    height: 1,
    backgroundColor: '#DDE3F0',
    marginVertical: 12,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stockCol: {
    flex: 1,
    alignItems: 'center',
  },
  stockDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#DDE3F0',
  },
  stockLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    textAlign: 'center',
    marginBottom: 4,
  },
  stockValueLarge: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  stockValueMed: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  outOfStockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FCEBEB',
    borderWidth: 1,
    borderColor: '#C0152A',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  outOfStockText: {
    fontSize: 13,
    color: '#C0152A',
    marginLeft: 6,
    flex: 1,
  },
  lowStockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8F0',
    borderWidth: 1,
    borderColor: '#B45309',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  lowStockText: {
    fontSize: 13,
    color: '#B45309',
    marginLeft: 6,
    flex: 1,
  },

  // Stat summary row
  statSummaryRow: {
    flexDirection: 'row',
    backgroundColor: '#F4F6FB',
    paddingVertical: 8,
    marginBottom: 12,
  },
  statSummaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  statSummaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
  },
  statSummaryLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    textAlign: 'center',
    marginTop: 2,
  },

  // Section label
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5A6A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },

  // Quick actions
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  actionCard: {
    flex: 1,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  actionCardLabel: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },

  // Pricing rows
  sectionCard: {
    marginBottom: 16,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F6FB',
  },
  priceRowLabel: {
    fontSize: 14,
    color: '#5A6A8A',
  },
  priceRowValue: {
    fontSize: 15,
  },

  // Filter pills
  filterPillsScroll: {
    marginBottom: 8,
  },
  filterPillsContent: {
    paddingBottom: 8,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
  },
  filterPillActive: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  filterPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },

  // Movement list
  movementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  movementRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F6FB',
  },
  movementLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    marginRight: 12,
  },
  movementIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  movementTextCol: {
    flex: 1,
  },
  movementActionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0D1B3E',
  },
  movementSubLabel: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  movementBalance: {
    fontSize: 11,
    color: '#5A6A8A',
    marginTop: 2,
  },
  movementRight: {
    alignItems: 'flex-end',
  },
  movementQty: {
    fontSize: 16,
    fontWeight: '700',
  },
  movementDate: {
    fontSize: 11,
    color: '#5A6A8A',
    textAlign: 'right',
    marginTop: 2,
  },
  movementEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  movementEmptyText: {
    fontSize: 13,
    color: '#5A6A8A',
  },

  // Bottom action bar
  bottomBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#DDE3F0',
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  bottomBarButtons: {
    flexDirection: 'row',
    gap: 12,
  },
})

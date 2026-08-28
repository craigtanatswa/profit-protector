import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import type { DimensionValue, TextStyle, ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'

import { useAppChrome } from '../../src/context/AppChromeContext'
import { Button, Card, Badge, MetricCard, NotificationBanner } from '../../src/components/ui'
import { useAuthStore } from '../../src/stores/authStore'
import { ShopPickerBar } from '../../src/components/shops/ShopPickerBar'
import { useActiveShop } from '../../src/hooks/useActiveShop'
import { useDashboard } from '../../src/hooks/useDashboard'
import { useQuietOfflineRefreshOnFocus } from '../../src/hooks/useQuietOfflineRefreshOnFocus'
import { useSubscription } from '../../src/hooks/useSubscription'
import type { CashBreakdownItem, RecentSaleEntry } from '../../src/hooks/useDashboard'
import { formatPaymentMethod } from '../../src/lib/formatters'
import { normalizeBusinessType } from '../../src/lib/appPersonalisation'
import { useMoneyFormat } from '../../src/hooks/useMoneyFormat'
import type { Customer, PaymentMethod, Product } from '../../src/types'
import {
  clearShopkeeperSession as clearStoredShopkeeperSession,
  pullShopkeeperCloudSnapshotFast,
} from '../../src/lib/shopkeeperAuth'
import { logActivity } from '../../src/lib/activityLogger'
import { formatPlanPrice } from '../../src/lib/plans'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const CARD_WIDTH = (SCREEN_WIDTH - 32 - 10) / 2

const PAYMENT_DOT_COLORS: Record<string, string> = {
  cash_usd: '#0047AB',
  cash_zig: '#003380',
  ecocash: '#0A7A4B',
  bank_transfer: '#B45309',
  credit: '#C0152A',
}

// ---------------------------------------------------------------------------
// Greeting helper
// ---------------------------------------------------------------------------

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function greetingNameSuffix(businessTypeRaw: string): string {
  const t = normalizeBusinessType(businessTypeRaw)
  if (t === 'restaurant') return ' — ready for service?'
  if (t === 'salon') return ' — ready for the day?'
  return ''
}

// ---------------------------------------------------------------------------
// Time formatter for sale rows
// ---------------------------------------------------------------------------

function formatSaleTime(timestamp: number): string {
  const saleDate = new Date(timestamp)
  const now = new Date()
  const isToday = saleDate.toDateString() === now.toDateString()
  if (isToday) {
    const h = String(saleDate.getHours()).padStart(2, '0')
    const m = String(saleDate.getMinutes()).padStart(2, '0')
    return `${h}:${m}`
  }
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${saleDate.getDate()} ${months[saleDate.getMonth()]}`
}

// ---------------------------------------------------------------------------
// Long date formatter for date strip
// ---------------------------------------------------------------------------

function formatLongDate(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function SkeletonBox({
  width,
  height,
  style,
  borderRadius = 8,
}: {
  width?: DimensionValue
  height: number
  style?: ViewStyle
  borderRadius?: number
}) {
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.85,
          duration: 750,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 750,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return (
    <Animated.View
      style={[
        {
          backgroundColor: '#DDE3F0',
          borderRadius,
          height,
          width: width ?? '100%',
          opacity,
        },
        style,
      ]}
    />
  )
}

function DashboardSkeleton({ topInset }: { topInset: number }) {
  return (
    <View style={styles.skeletonRoot}>
      {/* Header skeleton */}
      <View style={[styles.skeletonHeader, { paddingTop: topInset + 22 }]}>
        <SkeletonBox width={160} height={14} style={styles.skeletonMb6} />
        <SkeletonBox width={220} height={22} />
      </View>

      {/* Date strip (rounded panel) */}
      <View style={[styles.skeletonDateStrip, { paddingBottom: 16 }]}>
        <View style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, flex: 1 }}>
          <SkeletonBox width={180} height={12} />
          <SkeletonBox width={80} height={12} />
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.skeletonContent}>
        {/* Section label */}
        <SkeletonBox height={12} width={140} style={styles.skeletonSectionLabel} />

        {/* 2×2 metric cards */}
        <View style={styles.skeletonMetricsRow}>
          <SkeletonBox width={CARD_WIDTH} height={88} borderRadius={12} />
          <SkeletonBox width={CARD_WIDTH} height={88} borderRadius={12} />
        </View>
        <View style={[styles.skeletonMetricsRow, styles.mt10]}>
          <SkeletonBox width={CARD_WIDTH} height={88} borderRadius={12} />
          <SkeletonBox width={CARD_WIDTH} height={88} borderRadius={12} />
        </View>

        {/* Cash card */}
        <SkeletonBox height={120} borderRadius={12} style={styles.skeletonCard} />

        {/* Quick actions */}
        <View style={styles.skeletonActionsRow}>
          <SkeletonBox width={(SCREEN_WIDTH - 32 - 24) / 4} height={72} borderRadius={12} />
          <SkeletonBox width={(SCREEN_WIDTH - 32 - 24) / 4} height={72} borderRadius={12} />
          <SkeletonBox width={(SCREEN_WIDTH - 32 - 24) / 4} height={72} borderRadius={12} />
          <SkeletonBox width={(SCREEN_WIDTH - 32 - 24) / 4} height={72} borderRadius={12} />
        </View>

        {/* Low stock */}
        <SkeletonBox height={56} borderRadius={12} style={styles.skeletonCard} />
        <SkeletonBox height={56} borderRadius={12} style={styles.skeletonCard} />

        {/* Recent sales */}
        <SkeletonBox height={72} borderRadius={12} style={styles.skeletonCard} />
        <SkeletonBox height={72} borderRadius={12} style={styles.skeletonCard} />
        <SkeletonBox height={72} borderRadius={12} style={styles.skeletonCard} />
      </ScrollView>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ label, style }: { label: string; style?: TextStyle }) {
  return (
    <Text style={[styles.sectionLabel, style]}>{label.toUpperCase()}</Text>
  )
}

// ---------------------------------------------------------------------------
// Metrics section
// ---------------------------------------------------------------------------

interface MetricsSectionProps {
  todaysSalesCents: number
  todaysTransactionCount: number
  todaysProfitCents: number
  todaysMarginPercent: number
  totalStockValueCents: number
  totalProductCount: number
  outstandingCreditCents: number
  creditCustomerCount: number
  isShopkeeper: boolean
}

function MetricsSection({
  todaysSalesCents,
  todaysTransactionCount,
  todaysProfitCents,
  todaysMarginPercent,
  totalStockValueCents,
  totalProductCount,
  outstandingCreditCents,
  creditCustomerCount,
  isShopkeeper,
}: MetricsSectionProps) {
  const { formatMoney } = useMoneyFormat()
  const salesVariant = todaysSalesCents > 0 ? 'success' : 'default'
  const profitVariant =
    todaysProfitCents > 0 ? 'success' : todaysProfitCents < 0 ? 'danger' : 'default'
  const creditVariant = outstandingCreditCents > 0 ? 'warning' : 'default'

  const iconColorFor = (v: 'default' | 'success' | 'warning' | 'danger') => {
    if (v === 'success') return '#0A7A4B'
    if (v === 'warning') return '#B45309'
    if (v === 'danger') return '#C0152A'
    return '#5A6A8A'
  }

  return (
    <>
      <SectionLabel label="Today's Performance" style={styles.metricsSectionLabel} />
      <View style={styles.metricsGrid}>
        <View style={{ width: CARD_WIDTH }}>
          <MetricCard
            label="Today's Sales"
            value={formatMoney(todaysSalesCents)}
            subValue={`${todaysTransactionCount} transaction${todaysTransactionCount !== 1 ? 's' : ''}`}
            variant={salesVariant}
            icon={
              <Ionicons
                name="trending-up"
                size={20}
                color={iconColorFor(salesVariant)}
              />
            }
            onPress={() => router.push('/(app)/sales')}
          />
        </View>
        {!isShopkeeper ? (
          <View style={{ width: CARD_WIDTH }}>
            <MetricCard
              label="Today's Profit"
              value={formatMoney(todaysProfitCents)}
              subValue={`${todaysMarginPercent}% margin`}
              variant={profitVariant}
              icon={
                <Ionicons
                  name="analytics"
                  size={20}
                  color={iconColorFor(profitVariant)}
                />
              }
              onPress={() => router.push('/(app)/reports' as never)}
            />
          </View>
        ) : (
          <View style={{ width: CARD_WIDTH }}>
            <MetricCard
              label="Items Sold Today"
              value={`${todaysTransactionCount}`}
              subValue="sales recorded"
              variant="default"
              icon={<Ionicons name="bag-check" size={20} color={iconColorFor('default')} />}
              onPress={() => router.push('/(app)/sales')}
            />
          </View>
        )}
        <View style={{ width: CARD_WIDTH }}>
          <MetricCard
            label="Stock Value"
            value={formatMoney(totalStockValueCents)}
            subValue={`${totalProductCount} product${totalProductCount !== 1 ? 's' : ''}`}
            variant="default"
            icon={<Ionicons name="cube" size={20} color={iconColorFor('default')} />}
            onPress={() => router.push('/(app)/inventory')}
          />
        </View>
        {!isShopkeeper ? (
          <View style={{ width: CARD_WIDTH }}>
            <MetricCard
              label="Credit Owed"
              value={formatMoney(outstandingCreditCents)}
              subValue={`${creditCustomerCount} customer${creditCustomerCount !== 1 ? 's' : ''}`}
              variant={creditVariant}
              icon={
                <Ionicons
                  name="people"
                  size={20}
                  color={iconColorFor(creditVariant)}
                />
              }
              onPress={() => router.push('/(app)/customers' as never)}
            />
          </View>
        ) : null}
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Cash breakdown card
// ---------------------------------------------------------------------------

function CashBreakdownCard({ cashBreakdown }: { cashBreakdown: CashBreakdownItem[] }) {
  const { formatMoney } = useMoneyFormat()
  // Credit row shows total outstanding (same as Credit Owed metric), not cash — exclude from "Total collected"
  const total = cashBreakdown.reduce(
    (sum, item) => sum + (item.method === 'credit' ? 0 : item.totalCents),
    0,
  )

  return (
    <>
      <SectionLabel label="Cash Collected Today" style={styles.cashSectionLabel} />
      <Card style={styles.sectionCard}>
        {cashBreakdown.length === 0 ? (
          <Text style={styles.emptyText}>No sales recorded today</Text>
        ) : (
          <>
            {cashBreakdown.map((item, index) => (
              <View
                key={item.method}
                style={[
                  styles.cashRow,
                  index < cashBreakdown.length - 1 && styles.cashRowBorder,
                ]}
              >
                <View style={styles.cashRowLeft}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          PAYMENT_DOT_COLORS[item.method] ?? '#5A6A8A',
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.cashMethodLabel,
                      item.method === 'credit' && styles.creditMethodLabel,
                    ]}
                  >
                    {item.method === 'credit'
                      ? 'Credit (not yet paid)'
                      : formatPaymentMethod(item.method)}
                  </Text>
                </View>
                <View style={styles.cashRowRight}>
                  <Text style={styles.cashAmount}>
                    {formatMoney(item.totalCents)}
                  </Text>
                  <Text style={styles.cashCount}>
                    {item.method === 'credit'
                      ? item.creditCountKind === 'sales'
                        ? `(${item.count} sale${item.count !== 1 ? 's' : ''})`
                        : `(${item.count} customer${item.count !== 1 ? 's' : ''})`
                      : `(${item.count} sale${item.count !== 1 ? 's' : ''})`}
                  </Text>
                </View>
              </View>
            ))}

            <View style={styles.cashDivider} />

            <View style={styles.cashTotalRow}>
              <Text style={styles.cashTotalLabel}>Total collected</Text>
              <Text style={styles.cashTotalAmount}>{formatMoney(total)}</Text>
            </View>
          </>
        )}
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

interface QuickActionProps {
  backgroundColor: string
  iconName: React.ComponentProps<typeof Ionicons>['name']
  iconColor: string
  label: string
  labelColor: string
  onPress: () => void
}

function QuickAction({
  backgroundColor,
  iconName,
  iconColor,
  label,
  labelColor,
  onPress,
}: QuickActionProps) {
  const isPrimary = backgroundColor === '#0047AB'
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.quickAction,
        { backgroundColor },
        isPrimary && styles.quickActionPrimary,
      ]}
    >
      <Ionicons name={iconName} size={26} color={iconColor} />
      <Text style={[styles.quickActionLabel, { color: labelColor }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function QuickActionsSection({ isShopkeeper }: { isShopkeeper: boolean }) {
  return (
    <>
      <SectionLabel label="Quick Actions" style={styles.quickSectionLabel} />
      <View style={styles.quickActionsRow}>
        <QuickAction
          backgroundColor="#0047AB"
          iconName="add"
          iconColor="#FFFFFF"
          label="New Sale"
          labelColor="#FFFFFF"
          onPress={() => router.push('/(app)/sales/new' as never)}
        />
        {!isShopkeeper ? (
          <QuickAction
            backgroundColor="#FFFFFF"
            iconName="cube-outline"
            iconColor="#5A6A8A"
            label="Add Product"
            labelColor="#5A6A8A"
            onPress={() => router.push('/(app)/inventory/add' as never)}
          />
        ) : null}
        <QuickAction
          backgroundColor="#FFFFFF"
          iconName="arrow-down-circle"
          iconColor="#5A6A8A"
          label="Add Stock"
          labelColor="#5A6A8A"
          onPress={() => router.push('/(app)/inventory/purchase')}
        />
        {!isShopkeeper ? (
          <QuickAction
            backgroundColor="#FFFFFF"
            iconName="bar-chart"
            iconColor="#5A6A8A"
            label="Reports"
            labelColor="#5A6A8A"
            onPress={() => router.push('/(app)/reports' as never)}
          />
        ) : null}
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Low stock section
// ---------------------------------------------------------------------------

function LowStockSection({
  products,
  isShopkeeper,
}: {
  products: Product[]
  isShopkeeper: boolean
}) {
  if (products.length === 0) return null

  const visible = products.slice(0, 3)
  const hasMore = products.length > 3

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.dot, styles.warningDot]} />
          <SectionLabel label="Low Stock Alerts" style={styles.warningLabel} />
        </View>
        {hasMore && (
          <TouchableOpacity onPress={() => router.push('/(app)/inventory')}>
            <Text style={styles.viewAllLink}>
              View all ({products.length})
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {visible.map((product) => {
        const isOut = product.stockQty === 0
        return (
          <Card
            key={product.id}
            style={[
              styles.lowStockCard,
              { borderLeftColor: isOut ? '#C0152A' : '#B45309' },
            ]}
          >
            <View style={styles.lowStockRow}>
              <View style={styles.flex}>
                <Text style={styles.lowStockName}>{product.name}</Text>
                <Text
                  style={[
                    styles.lowStockStatus,
                    { color: isOut ? '#C0152A' : '#B45309' },
                  ]}
                >
                  {isOut
                    ? 'Out of stock'
                    : `Only ${product.stockQty} ${product.unit} left`}
                </Text>
              </View>
              {!isShopkeeper ? (
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/inventory/purchase',
                      params: { productId: product.id },
                    })
                  }
                  style={styles.orderBtn}
                >
                  <Text style={styles.orderBtnText}>Order +</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </Card>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Recent sales section
// ---------------------------------------------------------------------------

function RecentSalesSection({ recentSales }: { recentSales: RecentSaleEntry[] }) {
  const { formatMoney } = useMoneyFormat()
  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <SectionLabel label="Recent Sales" style={styles.recentSalesLabel} />
        <TouchableOpacity onPress={() => router.push('/(app)/sales')}>
          <Text style={styles.viewAllLink}>View all</Text>
        </TouchableOpacity>
      </View>

      {recentSales.length === 0 ? (
        <Card style={styles.sectionCard}>
          <View style={styles.emptySalesContainer}>
            <Ionicons name="receipt-outline" size={32} color="#DDE3F0" />
            <Text style={styles.emptySalesText}>No sales yet today</Text>
            <Button
              label="Record First Sale"
              onPress={() => router.push('/(app)/sales/new' as never)}
              variant="primary"
              size="sm"
              fullWidth={false}
            />
          </View>
        </Card>
      ) : (
        recentSales.map(({ sale, saleItems }) => {
          // Profit = actual revenue received (after discount) minus COGS.
          const cog = saleItems.reduce((sum, item) => sum + item.costPriceCents * item.qty, 0)
          const profit = sale.totalCents - cog

          const paymentVariant: 'info' | 'warning' | 'danger' | 'neutral' =
            sale.paymentMethod === 'credit'
              ? 'danger'
              : sale.paymentMethod === 'bank_transfer'
              ? 'warning'
              : 'info'

          return (
            <Card
              key={sale.id}
              style={styles.recentSaleCard}
              onPress={() =>
                router.push({
                  pathname: '/(app)/sales/[id]',
                  params: { id: sale.id },
                })
              }
            >
              <View style={styles.recentSaleRow}>
                <View style={styles.flex}>
                  <Text style={styles.receiptNumber}>{sale.receiptNumber}</Text>
                  <View style={styles.saleMeta}>
                    <Badge
                      label={formatPaymentMethod(sale.paymentMethod)}
                      variant={paymentVariant}
                      size="sm"
                    />
                    <Text style={styles.saleTime}>
                      {' '}· {formatSaleTime(sale.createdAt)}
                    </Text>
                  </View>
                </View>
                <View style={styles.saleAmountCol}>
                  <Text style={styles.saleTotal}>
                    {formatMoney(sale.totalCents)}
                  </Text>
                  {profit > 0 && (
                    <Text style={styles.saleProfit}>
                      +{formatMoney(profit)} profit
                    </Text>
                  )}
                </View>
              </View>
            </Card>
          )
        })
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Outstanding credit section
// ---------------------------------------------------------------------------

function CreditSection({ customers }: { customers: Customer[] }) {
  const { formatMoney } = useMoneyFormat()
  if (customers.length === 0) return null

  const visible = customers.slice(0, 3)

  return (
    <>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionHeaderLeft}>
          <View style={[styles.dot, styles.dangerDot]} />
          <SectionLabel label="Outstanding Credit" style={styles.dangerLabel} />
        </View>
        <TouchableOpacity onPress={() => router.push('/(app)/customers' as never)}>
          <Text style={styles.viewAllLink}>View all</Text>
        </TouchableOpacity>
      </View>

      {visible.map((customer) => (
        <Card key={customer.id} style={styles.creditCard}>
          <View style={styles.creditRow}>
            <View style={styles.flex}>
              <Text style={styles.creditName}>{customer.name}</Text>
              {customer.phone != null && (
                <Text style={styles.creditPhone}>{customer.phone}</Text>
              )}
            </View>
            <View style={styles.creditRight}>
              <Text style={styles.creditAmount}>
                {formatMoney(customer.outstandingBalanceCents)}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/(app)/customers/[id]',
                    params: { id: customer.id },
                  } as never)
                }
              >
                <Text style={styles.collectLink}>Collect →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Card>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main dashboard screen
// ---------------------------------------------------------------------------

export default function DashboardScreen() {
  const insets = useSafeAreaInsets()
  const { staffBannerConsumesTopSafeArea } = useAppChrome()
  const headerTopInset = staffBannerConsumesTopSafeArea ? 0 : insets.top
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [emailSecurityBannerVisible, setEmailSecurityBannerVisible] = useState(false)
  const [bellSeen, setBellSeen] = useState(false)
  const bellShakeAnim = useRef(new Animated.Value(0)).current

  const {
    activeRole,
    business,
    clearShopkeeperSession,
    shopkeeperSession,
    triggerSync,
  } = useAuthStore()
  const businessId = business?.id ?? ''
  const isShopkeeper = activeRole === 'shopkeeper'
  const ownerName = isShopkeeper
    ? shopkeeperSession?.shopkeeper.fullName ?? 'there'
    : business?.ownerName ?? 'there'
  const recoveryVerified = business?.recoveryEmailVerified === true
  const { subscription, daysRemainingInTrial } = useSubscription()
  const {
    shops,
    shopId,
    hasMultipleShops,
    shopsLoading,
    setSelectedShopId,
  } = useActiveShop()

  const {
    todaysSalesCents,
    todaysProfitCents,
    todaysTransactionCount,
    todaysMarginPercent,
    totalStockValueCents,
    totalProductCount,
    outstandingCreditCents,
    creditCustomerCount,
    cashBreakdown,
    lowStockProducts,
    recentSales,
    creditCustomers,
    isLoading,
    refetch,
  } = useDashboard(businessId, {
    shopId,
    scopedToShop: shopsLoading || hasMultipleShops,
  })

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      refetch()
    }, [refetch]),
  )

  useFocusEffect(
    useCallback(() => {
      if (!isShopkeeper || !businessId || !shopkeeperSession?.sessionToken) return undefined
      let cancelled = false
      void (async () => {
        await pullShopkeeperCloudSnapshotFast(
          shopkeeperSession.sessionToken,
          businessId,
          shopkeeperSession.shopkeeper.id,
        ).catch(() => {})
        if (!cancelled) refetch()
      })()
      return () => {
        cancelled = true
      }
    }, [
      isShopkeeper,
      businessId,
      shopkeeperSession?.sessionToken,
      shopkeeperSession?.shopkeeper.id,
      refetch,
    ]),
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!business?.id || isShopkeeper) return
      if (business.recoveryEmailVerified) {
        if (!cancelled) setEmailSecurityBannerVisible(false)
        return
      }
      const flag = await SecureStore.getItemAsync('shown_email_prompt')
      if (!cancelled && flag === 'false') {
        setEmailSecurityBannerVisible(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [business?.id, business?.recoveryEmailVerified, isShopkeeper])

  useEffect(() => {
    if (business?.recoveryEmailVerified) {
      setEmailSecurityBannerVisible(false)
    }
  }, [business?.recoveryEmailVerified])

  // ── Notification bell logic ────────────────────────────────────────────
  const notifHash = `${lowStockProducts.length}:${recoveryVerified ? '1' : '0'}`
  const hasUnreadNotifs =
    !isShopkeeper && !bellSeen && (lowStockProducts.length > 0 || !recoveryVerified)

  useEffect(() => {
    if (isShopkeeper) return
    let cancelled = false
    void (async () => {
      const savedHash = await SecureStore.getItemAsync('notifications_seen_hash')
      if (!cancelled) setBellSeen(savedHash === notifHash)
    })()
    return () => {
      cancelled = true
    }
  }, [isShopkeeper, notifHash])

  useEffect(() => {
    if (!hasUnreadNotifs) return
    const doShake = () => {
      bellShakeAnim.setValue(0)
      Animated.sequence([
        Animated.timing(bellShakeAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(bellShakeAnim, { toValue: -1, duration: 80, useNativeDriver: true }),
        Animated.timing(bellShakeAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
        Animated.timing(bellShakeAnim, { toValue: -1, duration: 80, useNativeDriver: true }),
        Animated.timing(bellShakeAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
      ]).start()
    }
    doShake()
    const interval = setInterval(doShake, 3000)
    return () => clearInterval(interval)
  }, [hasUnreadNotifs, bellShakeAnim])

  const bellRotate = bellShakeAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-20deg', '0deg', '20deg'],
  })

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      if (businessId && isShopkeeper && shopkeeperSession?.sessionToken) {
        await pullShopkeeperCloudSnapshotFast(
          shopkeeperSession.sessionToken,
          businessId,
          shopkeeperSession.shopkeeper.id,
          { authoritativeProducts: true },
        ).catch(() => {})
      } else if (businessId && !isShopkeeper) {
        await triggerSync(businessId)
      }
    } finally {
      refetch()
      setIsRefreshing(false)
    }
  }

  const handleShopkeeperSignOut = () => {
    Alert.alert('Sign out?', 'Return to the login screen?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logActivity({ action: 'account_logout', entityType: 'account' })
          await clearStoredShopkeeperSession()
          clearShopkeeperSession()
          router.replace('/(auth)/login')
        },
      },
    ])
  }

  if (isLoading && !isRefreshing) {
    return (
      <>
        <StatusBar style="light" />
        <DashboardSkeleton topInset={headerTopInset} />
      </>
    )
  }

  const todayDate = formatLongDate(new Date())

  return (
    <>
      <StatusBar style="light" />
      <NotificationBanner
        visible={emailSecurityBannerVisible && !isShopkeeper}
        title="Secure your account"
        message="Add a recovery email in Settings to protect your business data"
        type="warning"
        productId={null}
        topOffsetExtra={56}
        onPress={() => {
          setEmailSecurityBannerVisible(false)
          void SecureStore.setItemAsync('shown_email_prompt', 'true')
          router.push({ pathname: '/(app)/settings', params: { focus: 'security' } })
        }}
        onDismiss={() => {
          void SecureStore.setItemAsync('shown_email_prompt', 'true')
          setEmailSecurityBannerVisible(false)
        }}
      />
      <View style={styles.root}>
        {!isShopkeeper &&
          subscription?.status === 'trial' &&
          daysRemainingInTrial <= 7 && (
          <View
            style={[
              styles.trialBannerOuter,
              {
                backgroundColor:
                  daysRemainingInTrial === 0 || daysRemainingInTrial === 1
                    ? '#C0152A'
                    : daysRemainingInTrial <= 3
                      ? '#B45309'
                      : '#0047AB',
              },
            ]}
          >
            <View style={styles.trialBannerRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
                <Ionicons name="time-outline" size={14} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.trialBannerMsg} numberOfLines={2}>
                  {daysRemainingInTrial === 0
                    ? 'Trial ends today — subscribe now'
                    : daysRemainingInTrial === 1
                      ? '1 day left in your free trial'
                      : `${daysRemainingInTrial} days left in free trial`}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push('/(app)/paywall')}
                activeOpacity={0.85}
                style={styles.trialBannerChip}
              >
                <Text style={styles.trialBannerChipTxt}>Subscribe {formatPlanPrice('pro')}/mo</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {/* ── Custom cobalt header ── */}
        <View style={[styles.header, { paddingTop: 14 }]}>
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              <Text style={styles.greetingText}>
                Good {getGreeting()},
              </Text>
              <View style={styles.nameRow}>
                <Text style={styles.businessName}>
                  {ownerName}
                  {business?.businessType != null && business.businessType.length > 0
                    ? greetingNameSuffix(business.businessType)
                    : ''}
                </Text>
                {recoveryVerified ? (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/(app)/settings', params: { focus: 'security' } })}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    style={styles.verifiedBadge}
                  >
                    <Text style={styles.verifiedBadgeText}>Verified</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/(app)/settings', params: { focus: 'security' } })}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                    style={styles.shieldIcon}
                  >
                    <Ionicons name="shield-outline" size={14} color="rgba(255,255,255,0.5)" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={styles.headerRight}>
              {isShopkeeper ? (
                <TouchableOpacity style={styles.staffSignOutBtn} onPress={handleShopkeeperSignOut}>
                  <Text style={styles.staffSignOutText}>Sign out</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.headerActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setBellSeen(true)
                      router.push('/(app)/notifications' as never)
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.bellWrapper}
                  >
                    <Animated.View style={{ transform: [{ rotate: bellRotate }] }}>
                      <Ionicons
                        name={hasUnreadNotifs ? 'notifications' : 'notifications-outline'}
                        size={24}
                        color="white"
                      />
                    </Animated.View>
                    {hasUnreadNotifs && <View style={styles.bellBadge} />}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>

          {/* ── Date strip inside header as rounded panel ── */}
          <View style={styles.dateStrip}>
            <Text style={styles.dateText}>{todayDate}</Text>
            {!isShopkeeper ? (
              <TouchableOpacity
                onPress={() => router.push('/(app)/reports' as never)}
                style={styles.reportsLinkRow}
              >
                <Text style={styles.reportsLink}>View Reports</Text>
                <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* ── Scrollable content ── */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#FFFFFF"
              colors={['#0047AB']}
            />
          }
        >
          {hasMultipleShops ? (
            <ShopPickerBar
              shops={shops}
              selectedId={shopId}
              onSelect={setSelectedShopId}
              kicker="Viewing"
              readOnly={isShopkeeper}
            />
          ) : null}

          {/* Metrics */}
          <MetricsSection
            todaysSalesCents={todaysSalesCents}
            todaysTransactionCount={todaysTransactionCount}
            todaysProfitCents={todaysProfitCents}
            todaysMarginPercent={todaysMarginPercent}
            totalStockValueCents={totalStockValueCents}
            totalProductCount={totalProductCount}
            outstandingCreditCents={outstandingCreditCents}
            creditCustomerCount={creditCustomerCount}
            isShopkeeper={isShopkeeper}
          />

          {/* Cash breakdown */}
          <CashBreakdownCard cashBreakdown={cashBreakdown} />

          {/* Quick actions */}
          <QuickActionsSection isShopkeeper={isShopkeeper} />

          {/* Low stock */}
          <LowStockSection products={lowStockProducts} isShopkeeper={isShopkeeper} />

          {/* Recent sales */}
          <RecentSalesSection recentSales={recentSales} />

          {/* Outstanding credit */}
          {!isShopkeeper ? <CreditSection customers={creditCustomers} /> : null}

          <View style={styles.bottomPad} />
        </ScrollView>
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  trialBannerOuter: {
    minHeight: 36,
    justifyContent: 'center',
    width: '100%',
  },
  trialBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 36,
    gap: 12,
  },
  trialBannerMsg: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  trialBannerChip: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  trialBannerChipTxt: {
    fontSize: 11,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  flex: {
    flex: 1,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 20,
    paddingBottom: 0,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greetingText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    flexWrap: 'wrap',
    gap: 6,
  },
  businessName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  verifiedBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  verifiedBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  shieldIcon: {
    marginLeft: 2,
  },
  bellWrapper: {
    position: 'relative',
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#C0152A',
    borderWidth: 1.5,
    borderColor: '#0047AB',
  },
  staffSignOutBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  staffSignOutText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  // ── Date strip (rounded panel inside header) ──────────────────────────
  dateStrip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 12,
    marginBottom: 16,
  },
  dateText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  reportsLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  reportsLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
  },

  // ── Scroll ────────────────────────────────────────────────────────────
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },

  // ── Section label ─────────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5A6A8A',
    letterSpacing: 0.5,
  },
  metricsSectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  cashSectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  quickSectionLabel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  recentSalesLabel: {
    // inline in row
  },
  warningLabel: {
    color: '#B45309',
  },
  dangerLabel: {
    color: '#C0152A',
  },

  // ── Section header row (with "View all") ─────────────────────────────
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewAllLink: {
    fontSize: 13,
    color: '#0047AB',
  },

  // ── Metrics grid ─────────────────────────────────────────────────────
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
  },

  // ── Section card (full-width) ─────────────────────────────────────────
  sectionCard: {
    marginHorizontal: 16,
  },

  // ── Cash breakdown ────────────────────────────────────────────────────
  cashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 40,
  },
  cashRowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F6FB',
  },
  cashRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cashRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cashMethodLabel: {
    fontSize: 14,
    color: '#0D1B3E',
    marginLeft: 8,
  },
  creditMethodLabel: {
    color: '#C0152A',
  },
  cashAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  cashCount: {
    fontSize: 12,
    color: '#5A6A8A',
    marginLeft: 6,
  },
  cashDivider: {
    height: 1,
    backgroundColor: '#DDE3F0',
    marginVertical: 8,
  },
  cashTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cashTotalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  cashTotalAmount: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0047AB',
  },
  emptyText: {
    fontSize: 14,
    color: '#5A6A8A',
    textAlign: 'center',
    paddingVertical: 16,
  },

  // ── Quick actions ─────────────────────────────────────────────────────
  quickActionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  quickAction: {
    flex: 1,
    height: 72,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DDE3F0',
  },
  quickActionPrimary: {
    borderWidth: 0,
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },

  // ── Low stock ─────────────────────────────────────────────────────────
  lowStockCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderRadius: 12,
  },
  lowStockRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lowStockName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  lowStockStatus: {
    fontSize: 12,
    marginTop: 2,
  },
  orderBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0047AB',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginLeft: 8,
  },
  orderBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0047AB',
  },

  // ── Recent sales ──────────────────────────────────────────────────────
  recentSaleCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#0047AB',
  },
  recentSaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  receiptNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  saleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  saleTime: {
    fontSize: 12,
    color: '#5A6A8A',
  },
  saleAmountCol: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  saleTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0047AB',
  },
  saleProfit: {
    fontSize: 12,
    color: '#0A7A4B',
    marginTop: 2,
  },
  emptySalesContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  emptySalesText: {
    fontSize: 14,
    color: '#5A6A8A',
    marginTop: 8,
    marginBottom: 12,
    textAlign: 'center',
  },

  // ── Credit section ────────────────────────────────────────────────────
  creditCard: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  creditRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creditName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  creditPhone: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  creditRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  creditAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#C0152A',
  },
  collectLink: {
    fontSize: 12,
    color: '#0047AB',
    marginTop: 2,
  },

  // ── Dots ──────────────────────────────────────────────────────────────
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  warningDot: {
    backgroundColor: '#B45309',
  },
  dangerDot: {
    backgroundColor: '#C0152A',
  },

  // ── Bottom padding ────────────────────────────────────────────────────
  bottomPad: {
    height: 40,
  },

  // ── Skeleton styles ───────────────────────────────────────────────────
  skeletonRoot: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  skeletonHeader: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  skeletonMb6: {
    marginBottom: 6,
  },
  skeletonDateStrip: {
    backgroundColor: '#0047AB',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  skeletonContent: {
    padding: 16,
  },
  skeletonSectionLabel: {
    marginBottom: 10,
  },
  skeletonMetricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  mt10: {
    marginTop: 10,
  },
  skeletonCard: {
    marginTop: 10,
  },
  skeletonActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
})

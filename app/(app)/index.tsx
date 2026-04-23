import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
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
import type { ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'

import { Button, Card, Badge, MetricCard } from '../../src/components/ui'
import { useAuthStore } from '../../src/stores/authStore'
import { checkAndNotifyLowStock } from '../../src/lib/notifications'
import { useDashboard } from '../../src/hooks/useDashboard'
import { useQuietOfflineRefreshOnFocus } from '../../src/hooks/useQuietOfflineRefreshOnFocus'
import type { CashBreakdownItem, RecentSaleEntry } from '../../src/hooks/useDashboard'
import { formatPaymentMethod } from '../../src/lib/formatters'
import { useMoneyFormat } from '../../src/hooks/useMoneyFormat'
import type { Customer, PaymentMethod, Product } from '../../src/types'

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
  width?: number | string
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
      <View style={[styles.skeletonHeader, { paddingTop: topInset + 16 }]}>
        <SkeletonBox width={160} height={14} style={styles.skeletonMb6} />
        <SkeletonBox width={220} height={22} />
      </View>

      {/* Date strip */}
      <View style={styles.skeletonDateStrip}>
        <SkeletonBox width={180} height={12} />
        <SkeletonBox width={80} height={12} />
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
// Dashboard sync indicator (white palette for cobalt header)
// ---------------------------------------------------------------------------

function DashboardSyncIndicator() {
  const syncStatus = useAuthStore((s) => s.syncStatus)
  const lastSyncedAt = useAuthStore((s) => s.lastSyncedAt)
  const spinAnim = useRef(new Animated.Value(0)).current
  const loopRef = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => {
    if (syncStatus === 'syncing') {
      spinAnim.setValue(0)
      loopRef.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      )
      loopRef.current.start()
    } else {
      loopRef.current?.stop()
      loopRef.current = null
      spinAnim.setValue(0)
    }
    return () => loopRef.current?.stop()
  }, [syncStatus, spinAnim])

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  function timeAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000)
    if (secs < 10) return 'just now'
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  }

  if (syncStatus === 'syncing') {
    return (
      <View style={styles.syncRow}>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons name="sync" size={14} color="rgba(255,255,255,0.9)" />
        </Animated.View>
        <Text style={styles.syncText}>Syncing...</Text>
      </View>
    )
  }

  if (syncStatus === 'error') {
    return (
      <View style={styles.syncRow}>
        <Ionicons name="warning" size={14} color="rgba(255,200,100,0.95)" />
        <Text style={styles.syncText}>Sync failed</Text>
      </View>
    )
  }

  if (syncStatus === 'success' && lastSyncedAt) {
    return (
      <View style={styles.syncRow}>
        <Ionicons name="checkmark-circle" size={14} color="rgba(255,255,255,0.9)" />
        <Text style={styles.syncText}>Synced {timeAgo(lastSyncedAt)}</Text>
      </View>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ label, style }: { label: string; style?: ViewStyle }) {
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
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.quickAction, { backgroundColor }]}
    >
      <Ionicons name={iconName} size={28} color={iconColor} />
      <Text style={[styles.quickActionLabel, { color: labelColor }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function QuickActionsSection() {
  return (
    <>
      <SectionLabel label="Quick Actions" style={styles.quickSectionLabel} />
      <View style={styles.quickActionsRow}>
        <QuickAction
          backgroundColor="#0047AB"
          iconName="add-circle"
          iconColor="#FFFFFF"
          label="New Sale"
          labelColor="#FFFFFF"
          onPress={() => router.push('/(app)/sales/new' as never)}
        />
        <QuickAction
          backgroundColor="#E6EEFF"
          iconName="arrow-down-circle"
          iconColor="#0047AB"
          label="Add Stock"
          labelColor="#0047AB"
          onPress={() => router.push('/(app)/inventory/purchase')}
        />
        <QuickAction
          backgroundColor="#FFF8F0"
          iconName="swap-vertical"
          iconColor="#B45309"
          label="Adjust"
          labelColor="#B45309"
          onPress={() => router.push('/(app)/inventory/adjust')}
        />
        <QuickAction
          backgroundColor="#F4F6FB"
          iconName="bar-chart"
          iconColor="#5A6A8A"
          label="Reports"
          labelColor="#5A6A8A"
          onPress={() => router.push('/(app)/reports' as never)}
        />
      </View>
    </>
  )
}

// ---------------------------------------------------------------------------
// Low stock section
// ---------------------------------------------------------------------------

function LowStockSection({ products }: { products: Product[] }) {
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
  const [isRefreshing, setIsRefreshing] = useState(false)

  const { business, triggerSync } = useAuthStore()
  const businessId = business?.id ?? ''
  const ownerName = business?.ownerName ?? 'there'

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
  } = useDashboard(businessId)

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      refetch()
    }, [refetch]),
  )

  const handleRefresh = async () => {
    setIsRefreshing(true)
    refetch()
    if (businessId) {
      await triggerSync(businessId)
      checkAndNotifyLowStock(businessId).catch(() => {})
    }
    setIsRefreshing(false)
  }

  if (isLoading && !isRefreshing) {
    return (
      <>
        <StatusBar style="light" />
        <DashboardSkeleton topInset={insets.top} />
      </>
    )
  }

  const todayDate = formatLongDate(new Date())

  return (
    <>
      <StatusBar style="light" />
      <View style={styles.root}>
        {/* ── Custom cobalt header ── */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              <Text style={styles.greetingText}>
                Good {getGreeting()},
              </Text>
              <Text style={styles.businessName}>{ownerName}</Text>
            </View>
            <View style={styles.headerRight}>
              <DashboardSyncIndicator />
              <Ionicons
                name="notifications-outline"
                size={24}
                color="white"
                style={styles.bellIcon}
              />
            </View>
          </View>
        </View>

        {/* ── Date strip ── */}
        <View style={styles.dateStrip}>
          <Text style={styles.dateText}>{todayDate}</Text>
          <TouchableOpacity onPress={() => router.push('/(app)/reports' as never)}>
            <Text style={styles.reportsLink}>View Reports →</Text>
          </TouchableOpacity>
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
          />

          {/* Cash breakdown */}
          <CashBreakdownCard cashBreakdown={cashBreakdown} />

          {/* Quick actions */}
          <QuickActionsSection />

          {/* Low stock */}
          <LowStockSection products={lowStockProducts} />

          {/* Recent sales */}
          <RecentSalesSection recentSales={recentSales} />

          {/* Outstanding credit */}
          <CreditSection customers={creditCustomers} />

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
  flex: {
    flex: 1,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  header: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 20,
    paddingBottom: 20,
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
  greetingText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  businessName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
  },
  bellIcon: {
    marginLeft: 12,
  },

  // ── Date strip ────────────────────────────────────────────────────────
  dateStrip: {
    backgroundColor: '#003380',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  dateText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
  },
  reportsLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '500',
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
    borderLeftWidth: 3,
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
    backgroundColor: '#E6EEFF',
    borderRadius: 6,
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
    backgroundColor: '#003380',
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

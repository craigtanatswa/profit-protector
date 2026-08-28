import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import {
  Animated,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { Q } from '@nozbe/watermelondb'

import { ScreenHeader } from '../../../src/components/layout'
import { EmptyState } from '../../../src/components/ui'
import { SaleCard } from '../../../src/components/sales/SaleCard'
import { SalesTutorialModal } from '../../../src/components/sales/SalesTutorialModal'
import { FilterPanel, DEFAULT_FILTERS } from '../../../src/components/sales/FilterPanel'
import type { FilterState, ShopkeeperOption, ShopOption } from '../../../src/components/sales/FilterPanel'
import { useAuthStore } from '../../../src/stores/authStore'
import { useSalesWithItems } from '../../../src/hooks/useSales'
import { useQuietOfflineRefreshOnFocus } from '../../../src/hooks/useQuietOfflineRefreshOnFocus'
import { useMoneyFormat } from '../../../src/hooks/useMoneyFormat'
import type { SaleWithItems } from '../../../src/hooks/useSales'
import { pullShopkeeperSalesForCurrentMonth } from '../../../src/lib/shopkeeperAuth'
import { database } from '../../../src/database'
import type ShopkeeperModel from '../../../src/database/models/Shopkeeper'
import { useShops } from '../../../src/hooks/useShops'
import { formatShopLabel } from '../../../src/lib/shops'

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function subDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - n)
  return d
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0)
}

function formatGroupDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  if (isSameDay(date, now)) return 'Today'
  if (isSameDay(date, subDays(now, 1))) return 'Yesterday'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Section {
  title: string
  subtotalCents: number
  data: SaleWithItems[]
}

// ─── Stable list separators ───────────────────────────────────────────────────
const ItemSep = () => <View style={styles.itemSeparator} />
const SectionSep = () => <View style={styles.sectionSep} />

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  const opacity = useRef(new Animated.Value(0.4)).current
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [opacity])
  return <Animated.View style={[styles.skeleton, { opacity }]} />
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SalesScreen() {
  const router = useRouter()
  const { formatMoney } = useMoneyFormat()
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const shopkeeperSession = useAuthStore((s) => s.shopkeeperSession)
  const isShopkeeper = activeRole === 'shopkeeper'
  const shopkeeperIdForQuery = isShopkeeper ? shopkeeperSession?.shopkeeper.id ?? null : null

  // ─── Load shopkeepers for owner filter ──────────────────────────────────────
  const [shopkeeperOptions, setShopkeeperOptions] = useState<ShopkeeperOption[]>([])

  useEffect(() => {
    if (isShopkeeper || !business?.id || !database) return
    database
      .get<ShopkeeperModel>('shopkeepers')
      .query(Q.where('business_id', business.id), Q.where('is_active', true))
      .fetch()
      .then((records) =>
        setShopkeeperOptions(
          records.map((r) => ({ id: r.id, fullName: r.fullName })),
        ),
      )
      .catch(() => {})
  }, [isShopkeeper, business?.id])

  // Build a lookup map for rendering staff labels on each card
  const { shops, shopById, hasMultipleShops } = useShops(business?.id ?? '')
  const shopOptions = useMemo<ShopOption[]>(
    () => shops.map((shop) => ({ id: shop.id, label: formatShopLabel(shop) })),
    [shops],
  )

  const staffNameMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const sk of shopkeeperOptions) {
      map[sk.id] = sk.fullName
    }
    return map
  }, [shopkeeperOptions])

  // ─── Filters ─────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)

  const { dateFilter, selectedMethods, sortOption, creatorFilter, shopFilter } = filters

  // ─── Data ─────────────────────────────────────────────────────────────────────

  const { salesWithItems, isLoading, refetch } = useSalesWithItems(
    business?.id ?? '',
    isShopkeeper
      ? { shopkeeperId: shopkeeperIdForQuery }
      : { ownerCreatorFilter: creatorFilter },
  )

  // Show the sales tutorial once when the owner has no sales yet.
  useEffect(() => {
    if (isLoading || isShopkeeper || !business?.id || salesWithItems.length > 0) return
    let cancelled = false
    void (async () => {
      const key = `sales_tutorial_shown_${business.id}`
      const seen = await SecureStore.getItemAsync(key)
      if (!cancelled && seen !== 'true') {
        setShowTutorial(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isLoading, isShopkeeper, business?.id, salesWithItems.length])

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      refetch()
    }, [refetch]),
  )

  // ─── Filtered + sorted ────────────────────────────────────────────────────────

  const filtered = useMemo<SaleWithItems[]>(() => {
    let result = salesWithItems

    if (dateFilter !== 'all') {
      const now = new Date()
      result = result.filter(({ sale }) => {
        const saleDate = new Date(sale.createdAt)
        switch (dateFilter) {
          case 'today':    return isSameDay(saleDate, now)
          case 'yesterday': return isSameDay(saleDate, subDays(now, 1))
          case 'this_week': return saleDate >= startOfWeek(now)
          case 'this_month': return saleDate >= startOfMonth(now)
          default: return true
        }
      })
    }

    if (selectedMethods.length > 0 && !selectedMethods.includes('all')) {
      result = result.filter(({ sale }) => selectedMethods.includes(sale.paymentMethod))
    }

    if (shopFilter !== 'all') {
      result = result.filter(({ sale }) => sale.shopId === shopFilter)
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim()
      result = result.filter(
        ({ sale, saleItems }) =>
          sale.receiptNumber.toLowerCase().includes(q) ||
          saleItems.some((item) => item.productNameSnapshot.toLowerCase().includes(q)),
      )
    }

    switch (sortOption) {
      case 'oldest':
        result = [...result].sort((a, b) => a.sale.createdAt - b.sale.createdAt)
        break
      case 'highest':
        result = [...result].sort((a, b) => b.sale.totalCents - a.sale.totalCents)
        break
      case 'lowest':
        result = [...result].sort((a, b) => a.sale.totalCents - b.sale.totalCents)
        break
      default:
        result = [...result].sort((a, b) => b.sale.createdAt - a.sale.createdAt)
    }

    return result
  }, [salesWithItems, dateFilter, selectedMethods, sortOption, searchText, shopFilter])

  // ─── Summary strip ────────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    const count = filtered.length
    const totalCents = filtered.reduce((sum, { sale }) => sum + sale.totalCents, 0)
    const profitCents = filtered.reduce((sum, { sale, saleItems }) => {
      const cog = saleItems.reduce((s, item) => s + item.costPriceCents * item.qty, 0)
      return sum + sale.totalCents - cog
    }, 0)
    return { count, totalCents, profitCents }
  }, [filtered])

  // ─── Sections ─────────────────────────────────────────────────────────────────

  const sections = useMemo<Section[]>(() => {
    const groups: Record<string, SaleWithItems[]> = {}
    const groupOrder: string[] = []
    for (const entry of filtered) {
      const label = formatGroupDate(entry.sale.createdAt)
      if (!groups[label]) {
        groups[label] = []
        groupOrder.push(label)
      }
      groups[label].push(entry)
    }
    return groupOrder.map((title) => ({
      title,
      subtotalCents: groups[title].reduce((sum, { sale }) => sum + sale.totalCents, 0),
      data: groups[title],
    }))
  }, [filtered])

  // ─── Active filter pills ──────────────────────────────────────────────────────

  const hasActiveFilters =
    dateFilter !== 'all' ||
    (selectedMethods.length > 0 && !selectedMethods.includes('all')) ||
    creatorFilter !== 'all' ||
    shopFilter !== 'all' ||
    searchText.trim().length > 0

  const activePills: { label: string; onRemove: () => void }[] = []

  if (creatorFilter !== 'all') {
    const label =
      creatorFilter === 'owner'
        ? 'Owner'
        : staffNameMap[creatorFilter] ?? 'Staff'
    activePills.push({
      label: `By: ${label}`,
      onRemove: () => setFilters((f) => ({ ...f, creatorFilter: 'all' })),
    })
  }

  if (shopFilter !== 'all') {
    const shop = shopById[shopFilter]
    activePills.push({
      label: shop ? formatShopLabel(shop) : 'Shop',
      onRemove: () => setFilters((f) => ({ ...f, shopFilter: 'all' })),
    })
  }

  if (dateFilter !== 'all') {
    const label =
      dateFilter === 'today' ? 'Today'
      : dateFilter === 'yesterday' ? 'Yesterday'
      : dateFilter === 'this_week' ? 'This week'
      : 'This month'
    activePills.push({
      label,
      onRemove: () => setFilters((f) => ({ ...f, dateFilter: 'all' })),
    })
  }

  const PAYMENT_LABELS: Record<string, string> = {
    cash_usd: 'Cash $', cash_zig: 'Cash ZiG', ecocash: 'EcoCash',
    bank_transfer: 'Bank', credit: 'Credit',
  }

  if (!selectedMethods.includes('all')) {
    for (const method of selectedMethods) {
      activePills.push({
        label: PAYMENT_LABELS[method] ?? method,
        onRemove: () =>
          setFilters((f) => {
            const next = f.selectedMethods.filter((m) => m !== method)
            return { ...f, selectedMethods: next.length === 0 ? ['all'] : next }
          }),
      })
    }
  }

  if (searchText.trim()) {
    activePills.push({
      label: `"${searchText.trim()}"`,
      onRemove: () => setSearchText(''),
    })
  }

  // ─── List renderers ───────────────────────────────────────────────────────────

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderTitle}>{section.title}</Text>
        <Text style={styles.sectionHeaderSubtotal}>{formatMoney(section.subtotalCents)}</Text>
      </View>
    ),
    [formatMoney],
  )

  const renderItem = useCallback(
    ({ item: entry }: { item: SaleWithItems }) => {
      // For owner: show who made the sale. Null = owner themselves.
      let staffLabel: string | undefined
      if (!isShopkeeper) {
        const skId = entry.sale.createdByShopkeeperId
        staffLabel = skId ? (staffNameMap[skId] ?? 'Staff') : 'Owner'
      }
      return (
        <SaleCard
          sale={entry.sale}
          saleItems={entry.saleItems}
          staffLabel={staffLabel}
          shopLabel={
            hasMultipleShops && entry.sale.shopId && shopById[entry.sale.shopId]
              ? formatShopLabel(shopById[entry.sale.shopId])
              : undefined
          }
          onPress={() =>
            router.push({
              pathname: '/(app)/sales/[id]',
              params: { id: entry.sale.id },
            })
          }
        />
      )
    },
    [isShopkeeper, staffNameMap, router, hasMultipleShops, shopById],
  )

  // ─── Refresh ──────────────────────────────────────────────────────────────────

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      if (isShopkeeper && shopkeeperSession?.sessionToken) {
        await pullShopkeeperSalesForCurrentMonth(shopkeeperSession.sessionToken)
      }
    } catch {
      /* pull errors are non-fatal */
    }
    refetch()
    setTimeout(() => setIsRefreshing(false), 800)
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const noSalesAtAll = !isLoading && salesWithItems.length === 0
  const noResultsFromFilter = !isLoading && salesWithItems.length > 0 && filtered.length === 0

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="Sales"
        rightAction={{ icon: 'funnel-outline', onPress: () => setShowFilterPanel(true) }}
        showBorder
      />

      {isShopkeeper ? (
        <Text style={styles.scopeHint}>
          Your sales this calendar month — the list clears when a new month starts.
        </Text>
      ) : null}

      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Sales</Text>
          <Text style={styles.summaryValue}>{summary.count}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={styles.summaryValue}>{formatMoney(summary.totalCents)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>Profit</Text>
          <Text style={styles.summaryValue}>{formatMoney(summary.profitCents)}</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color="#5A6A8A" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by receipt no. or product..."
            placeholderTextColor="#5A6A8A"
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchText('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close-circle" size={18} color="#5A6A8A" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Active filter pills */}
      {hasActiveFilters && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillsScroll}
          contentContainerStyle={styles.pillsContent}
        >
          {activePills.map((pill) => (
            <View key={pill.label} style={styles.activePill}>
              <Text style={styles.activePillText}>{pill.label}</Text>
              <TouchableOpacity
                onPress={pill.onRemove}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={styles.activePillRemove}> ×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Main content */}
      {isLoading ? (
        <ScrollView style={styles.listArea} contentContainerStyle={styles.skeletonContent}>
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </ScrollView>
      ) : noSalesAtAll ? (
        <View style={styles.emptyWrapper}>
          <EmptyState
            icon="receipt-outline"
            title="No sales yet"
            subtitle={
              creatorFilter !== 'all'
                ? 'No sales match this filter'
                : 'Complete your first sale to see it here'
            }
            actionLabel={creatorFilter !== 'all' ? 'Clear Filter' : 'New Sale'}
            onAction={() =>
              creatorFilter !== 'all'
                ? setFilters(DEFAULT_FILTERS)
                : router.push('/(app)/sales/new')
            }
          />
        </View>
      ) : noResultsFromFilter ? (
        <View style={styles.emptyWrapper}>
          <EmptyState
            icon="search-outline"
            title="No sales found"
            subtitle="Try changing your filters or search term"
            actionLabel="Clear Filters"
            onAction={() => {
              setSearchText('')
              setFilters(DEFAULT_FILTERS)
            }}
          />
        </View>
      ) : (
        <SectionList
          style={styles.listArea}
          contentContainerStyle={styles.listContent}
          sections={sections}
          keyExtractor={(entry) => entry.sale.id}
          stickySectionHeadersEnabled
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#0047AB"
              colors={['#0047AB']}
            />
          }
          renderSectionHeader={renderSectionHeader}
          renderItem={renderItem}
          ItemSeparatorComponent={ItemSep}
          SectionSeparatorComponent={SectionSep}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => router.push('/(app)/sales/new')}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Filter panel */}
      <FilterPanel
        visible={showFilterPanel}
        current={filters}
        onApply={(next) => setFilters(next)}
        onClose={() => setShowFilterPanel(false)}
        shopkeepers={isShopkeeper ? undefined : shopkeeperOptions}
        shops={hasMultipleShops ? shopOptions : undefined}
      />

      {!isShopkeeper ? (
        <SalesTutorialModal
          visible={showTutorial}
          ownerName={business?.ownerName ?? undefined}
          onComplete={() => {
            setShowTutorial(false)
            if (business?.id) {
              void SecureStore.setItemAsync(`sales_tutorial_shown_${business.id}`, 'true')
            }
            router.push('/(app)/sales/new')
          }}
          onDismiss={() => {
            setShowTutorial(false)
            if (business?.id) {
              void SecureStore.setItemAsync(`sales_tutorial_shown_${business.id}`, 'true')
            }
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  scopeHint: {
    fontSize: 13,
    color: '#5A6A8A',
    paddingHorizontal: 16,
    paddingBottom: 10,
    paddingTop: 4,
    lineHeight: 18,
  },

  // Summary strip
  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0047AB',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  summaryValue: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  summaryDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.3)' },

  // Search bar
  searchWrapper: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchBar: {
    height: 44,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#0D1B3E', paddingVertical: 0 },

  // Active filter pills
  pillsScroll: { paddingBottom: 0 },
  pillsContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    flexDirection: 'row',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0047AB',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  activePillText: { fontSize: 12, color: '#FFFFFF', fontWeight: '500' },
  activePillRemove: { fontSize: 14, color: '#FFFFFF', fontWeight: '700' },

  // List
  listArea: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 88, flexGrow: 1 },
  skeletonContent: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F4F6FB',
    paddingTop: 8,
    paddingBottom: 4,
  },
  sectionHeaderTitle: { fontSize: 13, fontWeight: '600', color: '#5A6A8A' },
  sectionHeaderSubtotal: { fontSize: 13, fontWeight: '600', color: '#0047AB' },

  // Separators
  itemSeparator: { height: 8 },
  sectionSep: { height: 4 },

  // Empty state
  emptyWrapper: { flex: 1, paddingBottom: 80 },

  // Skeleton
  skeleton: { height: 80, backgroundColor: '#DDE3F0', borderRadius: 12 },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0047AB',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
})

import { Ionicons } from '@expo/vector-icons'
import { router, Stack } from 'expo-router'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Animated,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

import { ScreenHeader } from '../../../src/components/layout'
import { ProductCard } from '../../../src/components/products/ProductCard'
import { SortModal, type SortOption } from '../../../src/components/products/SortModal'
import { EmptyState } from '../../../src/components/ui'
import { useProducts } from '../../../src/hooks/useProducts'
import { formatCurrency } from '../../../src/lib/formatters'
import { useAuthStore } from '../../../src/stores/authStore'
import type { Product } from '../../../src/types'

// ---------------------------------------------------------------------------
// Skeleton card shown while products are loading
// ---------------------------------------------------------------------------

function SkeletonCard({ opacity }: { opacity: Animated.Value }) {
  return <Animated.View style={[styles.skeleton, { opacity }]} />
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function InventoryScreen() {
  const { business } = useAuthStore()
  const businessId = business?.id ?? ''

  const { products, isLoading, refetch } = useProducts(businessId)

  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [sortOption, setSortOption] = useState<SortOption>('name_asc')
  const [showSortModal, setShowSortModal] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Skeleton pulse animation
  const pulseAnim = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    )
    anim.start()
    return () => anim.stop()
  }, [pulseAnim])

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const categories = useMemo(() => {
    const cats = products
      .map((p) => p.category)
      .filter((c): c is string => c != null && c.length > 0)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort()
    return ['All', ...cats]
  }, [products])

  const filteredProducts = useMemo(() => {
    let result = products
    if (selectedCategory !== 'All') {
      result = result.filter((p) => p.category === selectedCategory)
    }
    if (searchText.trim().length > 0) {
      const query = searchText.toLowerCase().trim()
      result = result.filter((p) => p.name.toLowerCase().includes(query))
    }
    return result
  }, [products, selectedCategory, searchText])

  const sortedProducts = useMemo(() => {
    const result = [...filteredProducts]
    switch (sortOption) {
      case 'name_asc':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'name_desc':
        result.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'price_asc':
        result.sort((a, b) => a.sellingPriceCents - b.sellingPriceCents)
        break
      case 'price_desc':
        result.sort((a, b) => b.sellingPriceCents - a.sellingPriceCents)
        break
      case 'stock_asc':
        result.sort((a, b) => a.stockQty - b.stockQty)
        break
      case 'stock_desc':
        result.sort((a, b) => b.stockQty - a.stockQty)
        break
    }
    return result
  }, [filteredProducts, sortOption])

  const stockValue = useMemo(
    () =>
      filteredProducts.reduce(
        (sum, p) => sum + p.sellingPriceCents * p.stockQty,
        0,
      ),
    [filteredProducts],
  )

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    refetch()
    setTimeout(() => setIsRefreshing(false), 600)
  }, [refetch])

  const navigateToAdd = useCallback(() => {
    router.push('/inventory/add' as never)
  }, [])

  const navigateToPurchase = useCallback(() => {
    router.push('/inventory/purchase' as never)
  }, [])

  const navigateToAdjust = useCallback(() => {
    router.push('/inventory/adjust' as never)
  }, [])

  const navigateToDetail = useCallback((id: string) => {
    router.push(`/inventory/${id}` as never)
  }, [])

  const renderProduct = useCallback(
    ({ item }: { item: Product }) => (
      <ProductCard product={item} onPress={() => navigateToDetail(item.id)} />
    ),
    [navigateToDetail],
  )

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  const renderEmpty = useCallback(() => {
    if (searchText.trim().length > 0 || selectedCategory !== 'All') {
      const subtitle =
        searchText.trim().length > 0
          ? `No products match "${searchText}"`
          : `No products in "${selectedCategory}"`
      return (
        <EmptyState
          icon="search-outline"
          title="No products found"
          subtitle={subtitle}
        />
      )
    }
    return (
      <EmptyState
        icon="cube-outline"
        title="No products yet"
        subtitle="Add your first product to start tracking stock and recording sales"
        actionLabel="Add Product"
        onAction={navigateToAdd}
      />
    )
  }, [searchText, selectedCategory, navigateToAdd])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        title="Stock & Products"
        showBorder
        rightAction={{
          icon: 'options-outline',
          onPress: () => setShowSortModal(true),
        }}
      />

      {/* Action row: sort + receive stock + adjust */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionRowSort}
          onPress={() => setShowSortModal(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="swap-vertical-outline" size={18} color="#5A6A8A" />
          <Text style={styles.actionRowSortText}>Sort</Text>
        </TouchableOpacity>

        <View style={styles.actionRowButtons}>
          <TouchableOpacity
            style={styles.receiveStockBtn}
            onPress={navigateToPurchase}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-down-circle-outline" size={16} color="#0047AB" style={{ marginRight: 6 }} />
            <Text style={styles.receiveStockText}>Receive Stock</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.adjustBtn}
            onPress={navigateToAdjust}
            activeOpacity={0.8}
          >
            <Ionicons name="swap-vertical-outline" size={16} color="#5A6A8A" style={{ marginRight: 6 }} />
            <Text style={styles.adjustText}>Adjust</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchBar}>
          <Ionicons
            name="search-outline"
            size={18}
            color="#5A6A8A"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search products..."
            placeholderTextColor="#5A6A8A"
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
            clearButtonMode="never"
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

      {/* Category filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillsContainer}
        keyboardShouldPersistTaps="handled"
      >
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.pill, selectedCategory === cat && styles.pillSelected]}
            onPress={() => setSelectedCategory(cat)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.pillText,
                selectedCategory === cat && styles.pillTextSelected,
              ]}
            >
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Summary row */}
      {!isLoading && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryCount}>
            {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}
          </Text>
          <Text style={styles.summaryValue}>
            Stock value: {formatCurrency(stockValue)}
          </Text>
        </View>
      )}

      {/* List or skeletons */}
      {isLoading ? (
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} opacity={pulseAnim} />
          ))}
        </View>
      ) : (
        <FlatList
          data={sortedProducts}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          contentContainerStyle={[
            styles.listContent,
            sortedProducts.length === 0 && styles.listContentEmpty,
          ]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={renderEmpty}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#0047AB"
              colors={['#0047AB']}
            />
          }
        />
      )}

      {/* Floating Action Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={navigateToAdd}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Sort Modal */}
      <SortModal
        visible={showSortModal}
        sortOption={sortOption}
        onSelect={setSortOption}
        onClose={() => setShowSortModal(false)}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
  },
  actionRowSort: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionRowSortText: {
    fontSize: 13,
    color: '#5A6A8A',
    fontWeight: '500',
  },
  actionRowButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiveStockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6EEFF',
    borderWidth: 1,
    borderColor: '#0047AB',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  receiveStockText: {
    fontSize: 13,
    color: '#0047AB',
    fontWeight: '600',
  },
  adjustBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  adjustText: {
    fontSize: 13,
    color: '#5A6A8A',
    fontWeight: '600',
  },

  // Search
  searchWrapper: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0D1B3E',
    paddingVertical: 0,
  },

  // Category pills
  pillsContainer: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  pillSelected: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },

  // Summary row
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  summaryCount: {
    fontSize: 13,
    color: '#5A6A8A',
  },
  summaryValue: {
    fontSize: 13,
    color: '#0D1B3E',
    fontWeight: '500',
  },

  // Product list
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 96,
  },
  listContentEmpty: {
    flexGrow: 1,
  },

  // Skeleton loading
  skeletonList: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 10,
  },
  skeleton: {
    height: 112,
    backgroundColor: '#DDE3F0',
    borderRadius: 12,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0047AB',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
})

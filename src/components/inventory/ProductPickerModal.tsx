import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'

import { EmptyState } from '../ui'
import { useProducts } from '../../hooks/useProducts'
import { formatQty } from '../../lib/quantity'
import type { Product } from '../../types'

interface ProductPickerModalProps {
  visible: boolean
  onClose: () => void
  onSelect: (product: Product) => void
  businessId: string
}

export function ProductPickerModal({
  visible,
  onClose,
  onSelect,
  businessId,
}: ProductPickerModalProps) {
  const [search, setSearch] = useState('')
  const { products } = useProducts(businessId)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q.length > 0
      ? products.filter((p) => p.name.toLowerCase().includes(q))
      : products
  }, [products, search])

  function stockColor(product: Product): string {
    if (product.stockQty <= 0) return '#C0152A'
    if (product.stockQty <= product.lowStockThreshold) return '#B45309'
    return '#0A7A4B'
  }

  function handleClose() {
    onClose()
    setSearch('')
  }

  const renderItem = useCallback(
    ({ item }: { item: Product }) => (
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          onSelect(item)
          setSearch('')
        }}
        activeOpacity={0.7}
      >
        <View style={styles.rowInfo}>
          <Text style={styles.productName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.productMeta}>
            {[item.category, item.unit].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={styles.stockInfo}>
          <Text style={[styles.stockQty, { color: stockColor(item) }]}>
            {formatQty(item.stockQty)}
          </Text>
          <Text style={styles.stockUnit}>{item.unit} in stock</Text>
        </View>
      </TouchableOpacity>
    ),
    [onSelect],
  )

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Select Product</Text>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={24} color="#0D1B3E" />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <View style={styles.searchBar}>
            <Ionicons
              name="search-outline"
              size={18}
              color="#5A6A8A"
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              placeholderTextColor="#A0AEC0"
              value={search}
              onChangeText={setSearch}
              autoFocus
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color="#5A6A8A" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* List */}
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={15}
          maxToRenderPerBatch={15}
          windowSize={5}
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title="No products found"
              subtitle={
                search.length > 0
                  ? `No products match "${search}"`
                  : 'Add products first before recording stock'
              }
              actionLabel={search.length === 0 ? 'Add Product' : undefined}
              onAction={
                search.length === 0
                  ? () => {
                      handleClose()
                      router.push('/inventory/add' as never)
                    }
                  : undefined
              }
            />
          }
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE3F0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  searchWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE3F0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F6FB',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 8,
    height: 44,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0D1B3E',
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 64,
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
    backgroundColor: '#FFFFFF',
  },
  rowInfo: {
    flex: 1,
    marginRight: 12,
  },
  productName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  productMeta: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  stockInfo: {
    alignItems: 'flex-end',
  },
  stockQty: {
    fontSize: 14,
    fontWeight: '500',
  },
  stockUnit: {
    fontSize: 11,
    color: '#5A6A8A',
    marginTop: 2,
  },
})

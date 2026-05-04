import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { Card } from '../ui/Card'
import { Badge } from '../ui/Badge'
import { useMoneyFormat } from '../../hooks/useMoneyFormat'
import type { Product } from '../../types'

interface ProductCardProps {
  product: Product
  onPress: () => void
}

export const ProductCard = React.memo(function ProductCard({ product, onPress }: ProductCardProps) {
  const { formatMoney } = useMoneyFormat()
  const { name, category, sellingPriceCents, unit, stockQty, lowStockThreshold } = product

  const isOutOfStock = stockQty === 0
  const isLowStock = stockQty > 0 && stockQty <= lowStockThreshold

  const borderStyle: ViewStyle = isOutOfStock
    ? { borderLeftWidth: 3, borderLeftColor: '#C0152A', borderColor: '#DDE3F0' }
    : isLowStock
      ? { borderLeftWidth: 3, borderLeftColor: '#B45309', borderColor: '#DDE3F0' }
      : { borderColor: '#DDE3F0' }

  const badgeVariant: 'success' | 'warning' | 'danger' = isOutOfStock
    ? 'danger'
    : isLowStock
      ? 'warning'
      : 'success'

  const badgeLabel = isOutOfStock ? 'Out of stock' : isLowStock ? 'Low stock' : 'In stock'

  return (
    <Card onPress={onPress} padding="md" style={borderStyle}>
      <View style={styles.row}>
        <View style={styles.nameContainer}>
          <Text style={styles.productName} numberOfLines={2}>
            {name}
          </Text>
          {category != null && category.length > 0 && (
            <Text style={styles.category} numberOfLines={1}>
              {category}
            </Text>
          )}
        </View>
        <View style={styles.priceContainer}>
          <Text style={styles.price}>{formatMoney(sellingPriceCents)}</Text>
          <Text style={styles.unitLabel}>per {unit}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <View style={styles.stockInfo}>
          <Ionicons name="cube-outline" size={14} color="#5A6A8A" />
          <Text style={styles.stockText}>
            {stockQty} {unit} in stock
          </Text>
        </View>
        <Badge variant={badgeVariant} label={badgeLabel} size="sm" />
      </View>
    </Card>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameContainer: {
    flex: 1,
    flexShrink: 1,
    marginRight: 12,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  category: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  priceContainer: {
    alignItems: 'flex-end',
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0047AB',
  },
  unitLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    textAlign: 'right',
    marginTop: 2,
  },
  divider: {
    height: 0.5,
    backgroundColor: '#DDE3F0',
    marginVertical: 10,
  },
  stockInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stockText: {
    fontSize: 13,
    color: '#5A6A8A',
    marginLeft: 4,
  },
})

import React from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'

import { ScreenHeader } from '../../../src/components/layout'
import { EmptyState } from '../../../src/components/ui'
import { useAuthStore } from '../../../src/stores/authStore'
import { useSales } from '../../../src/hooks/useSales'
import { formatCurrency, formatDateTime } from '../../../src/lib/formatters'

export default function SalesScreen() {
  const router = useRouter()
  const business = useAuthStore((s) => s.business)
  const { sales, isLoading } = useSales(business?.id ?? '')

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Sales"
        rightAction={{ icon: 'add-circle-outline', onPress: () => router.push('/(app)/sales/new') }}
        showBorder
      />

      <FlatList
        data={sales}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              icon="receipt-outline"
              title="No sales yet"
              subtitle="Tap + to record your first sale"
              actionLabel="New Sale"
              onAction={() => router.push('/(app)/sales/new')}
            />
          ) : null
        }
        renderItem={({ item: sale }) => (
          <TouchableOpacity
            style={styles.saleRow}
            activeOpacity={0.7}
            onPress={() => router.push({ pathname: '/(app)/sales/[id]', params: { id: sale.id } })}
          >
            <View style={styles.saleLeft}>
              <Text style={styles.receiptNum}>{sale.receiptNumber}</Text>
              <Text style={styles.saleDate}>{formatDateTime(sale.createdAt)}</Text>
            </View>
            <Text style={styles.saleTotal}>{formatCurrency(sale.totalCents)}</Text>
          </TouchableOpacity>
        )}
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => router.push('/(app)/sales/new')}
      >
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6FB',
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#DDE3F0',
  },
  saleLeft: {
    flex: 1,
  },
  receiptNum: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  saleDate: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 2,
  },
  saleTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0047AB',
  },
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

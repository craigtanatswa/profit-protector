import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import React, { useCallback, useMemo, useState } from 'react'
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActivityLogEntry, activityLogTitle, staffDisplayName } from '../../../src/components/activity/ActivityLogEntry'
import { ScreenHeader } from '../../../src/components/layout'
import { EmptyState } from '../../../src/components/ui'
import { useActivityLog } from '../../../src/hooks/useActivityLog'
import { useAuthStore } from '../../../src/stores/authStore'
import type { ActivityLog } from '../../../src/types'

type Filter = 'all' | 'owner' | 'staff'

export default function ActivityLogScreen() {
  const router = useRouter()
  const business = useAuthStore((s) => s.business)
  const activeRole = useAuthStore((s) => s.activeRole)
  const { logs } = useActivityLog(business?.id ?? '')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const triggerSync = useAuthStore((s) => s.triggerSync)

  useFocusEffect(
    useCallback(() => {
      if (!business?.id) return
      void triggerSync(business.id)
    }, [business?.id, triggerSync]),
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return logs.filter((log) => {
      if (filter === 'owner' && log.actorRole !== 'owner') return false
      if (filter === 'staff' && log.actorRole !== 'shopkeeper') return false
      if (!needle) return true
      return [
        activityLogTitle(log),
        log.actorName,
        staffDisplayName(log),
        log.entityName ?? '',
        log.action,
        log.entityType,
        log.details?.staffName != null ? String(log.details.staffName) : '',
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [filter, logs, query])

  const sections = useMemo(() => groupByDay(filtered), [filtered])

  if (activeRole !== 'owner') return null

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="Activity Log"
        leftAction={{ icon: 'arrow-back', onPress: () => router.back() }}
        showBorder
      />
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color="#5A6A8A" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search activity"
          placeholderTextColor="#A0AEC0"
          style={styles.searchInput}
        />
      </View>
      <View style={styles.filters}>
        {(['all', 'owner', 'staff'] as const).map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.filterPill, filter === item && styles.filterPillActive]}
            onPress={() => setFilter(item)}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {item === 'all' ? 'All' : item === 'owner' ? 'Owner' : 'Staff'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={sections}
        keyExtractor={(item) => item.title}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View>
            <Text style={styles.dayTitle}>{item.title}</Text>
            {item.data.map((log) => (
              <ActivityLogEntry key={log.id} log={log} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="list-outline"
            title="No activity yet"
            subtitle="Actions taken by the owner and staff will appear here."
          />
        }
      />
    </SafeAreaView>
  )
}

function groupByDay(logs: ActivityLog[]) {
  const map = new Map<string, ActivityLog[]>()
  logs.forEach((log) => {
    const key = new Date(log.createdAt).toDateString()
    map.set(key, [...(map.get(key) ?? []), log])
  })
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }))
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F4F6FB' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: '#0D1B3E' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
  },
  filterPillActive: { backgroundColor: '#0047AB', borderColor: '#0047AB' },
  filterText: { fontSize: 13, color: '#5A6A8A', fontWeight: '500' },
  filterTextActive: { color: '#FFFFFF' },
  listContent: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  dayTitle: { fontSize: 12, fontWeight: '700', color: '#5A6A8A', marginTop: 10, marginBottom: 8 },
})

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Q } from '@nozbe/watermelondb'

import { ScreenHeader } from '../../../src/components/layout'
import { Button, EmptyState, Input, LoadingScreen } from '../../../src/components/ui'
import {
  CustomerCard,
  HighlightWrapper,
} from '../../../src/components/customers/CustomerCard'
import { useCustomers } from '../../../src/hooks/useCustomers'
import { useQuietOfflineRefreshOnFocus } from '../../../src/hooks/useQuietOfflineRefreshOnFocus'
import { useAuthStore } from '../../../src/stores/authStore'
import { useMoneyFormat } from '../../../src/hooks/useMoneyFormat'
import { database } from '../../../src/database'
import type { Customer } from '../../../src/types'
import type CustomerModel from '../../../src/database/models/Customer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterTab = 'All' | 'Owing' | 'Settled'

// ---------------------------------------------------------------------------
// Validation helpers (no external deps)
// ---------------------------------------------------------------------------

function validateName(name: string): string | null {
  if (!name.trim()) return 'Name is required'
  if (name.trim().length < 2) return 'Name must be at least 2 characters'
  if (name.trim().length > 60) return 'Name is too long'
  return null
}

function validatePhone(phone: string): string | null {
  if (!phone.trim()) return null // optional
  if (phone.trim().length !== 10) return 'Phone must be 10 digits'
  if (!phone.trim().startsWith('07')) return 'Phone must start with 07'
  return null
}

// ---------------------------------------------------------------------------
// AddCustomerModal
// ---------------------------------------------------------------------------

interface AddCustomerModalProps {
  visible: boolean
  businessId: string
  onClose: () => void
  onSuccess: (newId: string) => void
}

function AddCustomerModal({
  visible,
  businessId,
  onClose,
  onSuccess,
}: AddCustomerModalProps) {
  const insets = useSafeAreaInsets()
  const slideAnim = useRef(new Animated.Value(600)).current

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (visible) {
      setName('')
      setPhone('')
      setNameError(null)
      setPhoneError(null)
      setIsSaving(false)
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start()
    } else {
      Animated.timing(slideAnim, {
        toValue: 600,
        duration: 220,
        useNativeDriver: true,
      }).start()
    }
  }, [visible, slideAnim])

  const handleSave = useCallback(async () => {
    const nErr = validateName(name)
    const pErr = validatePhone(phone)
    setNameError(nErr)
    setPhoneError(pErr)
    if (nErr || pErr) return

    if (!database) return

    setIsSaving(true)
    try {
      // Check for duplicates
      const allCustomers = await database
        .get<CustomerModel>('customers')
        .query(Q.where('business_id', businessId))
        .fetch()

      const duplicate = allCustomers.find(
        (c) => c.name.toLowerCase() === name.trim().toLowerCase(),
      )

      if (duplicate) {
        setIsSaving(false)
        Alert.alert(
          'Duplicate Customer',
          `A customer named "${name.trim()}" already exists. Do you want to add them anyway?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add Anyway',
              onPress: () => doCreate(),
            },
          ],
        )
        return
      }

      await doCreate()
    } catch {
      setIsSaving(false)
      Alert.alert('Error', 'Failed to save customer. Please try again.')
    }
  }, [name, phone, businessId])

  const doCreate = useCallback(async () => {
    if (!database) return
    setIsSaving(true)
    try {
      const record = await database.write(async () => {
        return database!.get<CustomerModel>('customers').create((c) => {
          c.businessId = businessId
          c.name = name.trim()
          c.phone = phone.trim() || null
          c.outstandingBalanceCents = 0
          c.isActive = true
        })
      })

      // Fire and forget sync
      const { triggerSync, business } = useAuthStore.getState()
      if (business) {
        triggerSync(business.id).catch(() => {})
      }

      onSuccess(record.id)
    } catch {
      setIsSaving(false)
      Alert.alert('Error', 'Failed to save customer. Please try again.')
    }
  }, [name, phone, businessId, onSuccess])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalKav}
        >
          <Animated.View
            style={[
              styles.modalSheet,
              {
                transform: [{ translateY: slideAnim }],
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <Pressable onPress={(e) => e.stopPropagation()}>
              {/* Handle bar */}
              <View style={styles.handleBar} />

              <Text style={styles.modalTitle}>Add Customer</Text>
              <Text style={styles.modalSubtitle}>
                Add a customer to track credit sales
              </Text>

              <View style={styles.modalFields}>
                <Input
                  label="Full Name"
                  placeholder="e.g. Tendai Moyo"
                  value={name}
                  onChangeText={(t) => {
                    setName(t)
                    if (nameError) setNameError(null)
                  }}
                  autoCapitalize="words"
                  maxLength={60}
                  error={nameError ?? undefined}
                  leftIcon={
                    <Ionicons name="person-outline" size={18} color="#5A6A8A" />
                  }
                />

                <View style={{ height: 12 }} />

                <Input
                  label="Phone Number"
                  placeholder="e.g. 0771234567"
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(t)
                    if (phoneError) setPhoneError(null)
                  }}
                  keyboardType="phone-pad"
                  error={phoneError ?? undefined}
                  hint="Optional — used for WhatsApp receipts later"
                  leftIcon={
                    <Ionicons name="call-outline" size={18} color="#5A6A8A" />
                  }
                />
              </View>

              <View style={styles.modalButtons}>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Cancel"
                    onPress={onClose}
                    variant="ghost"
                    size="md"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label="Add Customer"
                    onPress={handleSave}
                    variant="primary"
                    size="md"
                    loading={isSaving}
                  />
                </View>
              </View>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Customer List Screen
// ---------------------------------------------------------------------------

export default function CustomersScreen() {
  const insets = useSafeAreaInsets()
  const { formatMoney } = useMoneyFormat()
  const business = useAuthStore((s) => s.business)
  const {
    customers,
    isLoading,
    refreshLocal,
    refreshLocalFetchOnly,
    commitLocalMerge,
  } = useCustomers(business?.id ?? '')

  useQuietOfflineRefreshOnFocus(
    useCallback(() => {
      void refreshLocal()
    }, [refreshLocal]),
  )

  const [searchText, setSearchText] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('All')
  const [showAddModal, setShowAddModal] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [newCustomerId, setNewCustomerId] = useState<string | null>(null)

  // Clear highlight after 2 seconds
  useEffect(() => {
    if (!newCustomerId) return
    const t = setTimeout(() => setNewCustomerId(null), 2000)
    return () => clearTimeout(t)
  }, [newCustomerId])

  // Sort by outstanding balance descending
  const sorted = useMemo(
    () =>
      [...customers].sort(
        (a, b) => b.outstandingBalanceCents - a.outstandingBalanceCents,
      ),
    [customers],
  )

  // Filter
  const filtered = useMemo(() => {
    let result = sorted

    if (activeTab === 'Owing') {
      result = result.filter((c) => c.outstandingBalanceCents > 0)
    } else if (activeTab === 'Settled') {
      result = result.filter((c) => c.outstandingBalanceCents === 0)
    }

    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)),
      )
    }

    return result
  }, [sorted, activeTab, searchText])

  // Summary
  const summary = useMemo(
    () => ({
      total: customers.length,
      totalOwedCents: customers.reduce(
        (sum, c) => sum + c.outstandingBalanceCents,
        0,
      ),
      settledCount: customers.filter((c) => c.outstandingBalanceCents === 0)
        .length,
    }),
    [customers],
  )

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // 1) Read WatermelonDB only — end spinner here so the indicator hides ~50% sooner
      //    than fetch + merge + list re-render in one atomic refreshLocal().
      await refreshLocalFetchOnly()
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false)
    }
    // 2) Apply balances to React state (after spinner stops)
    commitLocalMerge()
    // 3) Cloud sync in background (never blocks the refresh control)
    const { triggerSync, business: biz } = useAuthStore.getState()
    if (biz) void triggerSync(biz.id).catch(() => {})
  }, [refreshLocalFetchOnly, commitLocalMerge])

  const handleAddSuccess = useCallback((newId: string) => {
    setShowAddModal(false)
    setNewCustomerId(newId)
    // Reset to All tab so the new customer is visible
    setActiveTab('All')
    setSearchText('')
  }, [])

  const handleNavigateToDetail = useCallback((customer: Customer) => {
    router.push({
      pathname: '/(app)/customers/[id]',
      params: { id: customer.id },
    })
  }, [])

  // Empty state decision
  function renderEmptyState() {
    if (customers.length === 0) {
      return (
        <View style={styles.emptyWrapper}>
          <EmptyState
            icon="people-outline"
            title="No customers yet"
            subtitle="Add customers to track credit sales and outstanding balances"
            actionLabel="Add First Customer"
            onAction={() => setShowAddModal(true)}
          />
        </View>
      )
    }

    if (searchText.trim()) {
      return (
        <View style={styles.emptyWrapper}>
          <EmptyState
            icon="search-outline"
            title="No customers found"
            subtitle={`No customers match "${searchText}"`}
          />
        </View>
      )
    }

    if (activeTab === 'Owing') {
      return (
        <View style={styles.emptyWrapper}>
          <EmptyState
            icon="checkmark-circle-outline"
            title="No outstanding balances"
            subtitle="All customers are settled up"
          />
        </View>
      )
    }

    if (activeTab === 'Settled') {
      return (
        <View style={styles.emptyWrapper}>
          <EmptyState
            icon="people-outline"
            title="No settled customers"
            subtitle="Customers with zero balance will appear here"
          />
        </View>
      )
    }

    return null
  }

  if (isLoading) {
    return <LoadingScreen />
  }

  const TABS: FilterTab[] = ['All', 'Owing', 'Settled']

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Customers"
        rightAction={{
          icon: 'person-add-outline',
          onPress: () => setShowAddModal(true),
        }}
        showBorder
      />

      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{summary.total}</Text>
          <Text style={styles.summaryLabel}>customers</Text>
        </View>
        <View style={[styles.summaryItem, styles.summaryItemCenter]}>
          <Text style={styles.summaryValue}>
            {formatMoney(summary.totalOwedCents)}
          </Text>
          <Text style={styles.summaryLabel}>owed</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{summary.settledCount}</Text>
          <Text style={styles.summaryLabel}>settled</Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color="#5A6A8A" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or phone..."
            placeholderTextColor="#A0AEC0"
            value={searchText}
            onChangeText={setSearchText}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Ionicons name="close-circle" size={18} color="#A0AEC0" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter tabs */}
      <View style={styles.tabsRow}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[
              styles.tabPill,
              activeTab === tab && styles.tabPillActive,
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                activeTab === tab && styles.tabLabelActive,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          filtered.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#0047AB"
            colors={['#0047AB']}
          />
        }
        ListEmptyComponent={renderEmptyState()}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <HighlightWrapper isHighlighted={item.id === newCustomerId}>
            <CustomerCard
              customer={item}
              onPress={() => handleNavigateToDetail(item)}
            />
          </HighlightWrapper>
        )}
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setShowAddModal(true)}
        activeOpacity={0.85}
      >
        <Ionicons name="person-add" size={24} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Add Customer Modal */}
      {business && (
        <AddCustomerModal
          visible={showAddModal}
          businessId={business.id}
          onClose={() => setShowAddModal(false)}
          onSuccess={handleAddSuccess}
        />
      )}
    </SafeAreaView>
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
  summaryStrip: {
    backgroundColor: '#E6EEFF',
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'flex-start',
  },
  summaryItemCenter: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0047AB',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#5A6A8A',
    marginTop: 1,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0D1B3E',
    padding: 0,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  tabPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 20,
  },
  tabPillActive: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
  },
  tabLabelActive: {
    color: '#FFFFFF',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 100,
  },
  listContentEmpty: {
    flex: 1,
  },
  emptyWrapper: {
    flex: 1,
    minHeight: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: 24,
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalKav: {
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE3F0',
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 4,
    marginBottom: 20,
  },
  modalFields: {
    width: '100%',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
})

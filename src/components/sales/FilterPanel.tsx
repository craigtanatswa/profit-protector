import React, { useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Button } from '../ui/Button'

export type DateFilter = 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month'
export type SortOption = 'newest' | 'oldest' | 'highest' | 'lowest'
/** 'all' = everyone, 'owner' = owner-only, any other string = shopkeeper ID */
export type CreatorFilter = 'all' | 'owner' | string

export interface FilterState {
  dateFilter: DateFilter
  selectedMethods: string[]
  sortOption: SortOption
  /** Owner-only: which seller's sales to show. */
  creatorFilter: CreatorFilter
}

export interface ShopkeeperOption {
  id: string
  fullName: string
}

interface FilterPanelProps {
  visible: boolean
  current: FilterState
  onApply: (state: FilterState) => void
  onClose: () => void
  /** Pass the business's shopkeepers so the owner gets a "Sold by" section. */
  shopkeepers?: ShopkeeperOption[]
}

const DATE_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
]

const PAYMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cash_usd', label: 'Cash $' },
  { value: 'cash_zig', label: 'Cash ZiG' },
  { value: 'ecocash', label: 'EcoCash' },
  { value: 'bank_transfer', label: 'Bank' },
  { value: 'credit', label: 'Credit' },
]

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'highest', label: 'Highest value' },
  { value: 'lowest', label: 'Lowest value' },
]

export const DEFAULT_FILTERS: FilterState = {
  dateFilter: 'all',
  selectedMethods: ['all'],
  sortOption: 'newest',
  creatorFilter: 'all',
}

export function FilterPanel({ visible, current, onApply, onClose, shopkeepers }: FilterPanelProps) {
  const [dateFilter, setDateFilter] = useState<DateFilter>(current.dateFilter)
  const [selectedMethods, setSelectedMethods] = useState<string[]>(current.selectedMethods)
  const [sortOption, setSortOption] = useState<SortOption>(current.sortOption)
  const [creatorFilter, setCreatorFilter] = useState<CreatorFilter>(current.creatorFilter)

  // Sync local state when panel opens
  React.useEffect(() => {
    if (visible) {
      setDateFilter(current.dateFilter)
      setSelectedMethods(current.selectedMethods)
      setSortOption(current.sortOption)
      setCreatorFilter(current.creatorFilter)
    }
  }, [visible, current.dateFilter, current.selectedMethods, current.sortOption, current.creatorFilter])

  function toggleMethod(value: string) {
    if (value === 'all') {
      setSelectedMethods(['all'])
      return
    }
    setSelectedMethods((prev) => {
      const withoutAll = prev.filter((m) => m !== 'all')
      if (withoutAll.includes(value)) {
        const next = withoutAll.filter((m) => m !== value)
        return next.length === 0 ? ['all'] : next
      }
      return [...withoutAll, value]
    })
  }

  function handleReset() {
    setDateFilter('all')
    setSelectedMethods(['all'])
    setSortOption('newest')
    setCreatorFilter('all')
    onApply(DEFAULT_FILTERS)
    onClose()
  }

  function handleApply() {
    onApply({ dateFilter, selectedMethods, sortOption, creatorFilter })
    onClose()
  }

  const showSoldBy = shopkeepers !== undefined && shopkeepers.length > 0

  const creatorOptions: { value: CreatorFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'owner', label: 'Owner' },
    ...(shopkeepers ?? []).map((sk) => ({ value: sk.id, label: sk.fullName })),
  ]

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          <Text style={styles.panelTitle}>Filter Sales</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Sold By — owner only */}
            {showSoldBy && (
              <>
                <Text style={styles.sectionLabel}>Sold By</Text>
                <View style={styles.pillRow}>
                  {creatorOptions.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.pill,
                        creatorFilter === opt.value ? styles.pillSelected : styles.pillUnselected,
                      ]}
                      onPress={() => setCreatorFilter(opt.value)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          creatorFilter === opt.value
                            ? styles.pillTextSelected
                            : styles.pillTextUnselected,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Date Range */}
            <Text style={[styles.sectionLabel, showSoldBy && styles.sectionLabelSpaced]}>
              Date Range
            </Text>
            <View style={styles.pillRow}>
              {DATE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.pill,
                    dateFilter === opt.value ? styles.pillSelected : styles.pillUnselected,
                  ]}
                  onPress={() => setDateFilter(opt.value)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.pillText,
                      dateFilter === opt.value
                        ? styles.pillTextSelected
                        : styles.pillTextUnselected,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Payment Method */}
            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Payment Method</Text>
            <View style={styles.pillRow}>
              {PAYMENT_OPTIONS.map((opt) => {
                const active = selectedMethods.includes(opt.value)
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.pill,
                      active ? styles.pillSelected : styles.pillUnselected,
                    ]}
                    onPress={() => toggleMethod(opt.value)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        active ? styles.pillTextSelected : styles.pillTextUnselected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* Sort By */}
            <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>Sort By</Text>
            <View style={styles.pillRow}>
              {SORT_OPTIONS.map((opt) => {
                const active = sortOption === opt.value
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.pill,
                      active ? styles.pillSelected : styles.pillUnselected,
                    ]}
                    onPress={() => setSortOption(opt.value)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        active ? styles.pillTextSelected : styles.pillTextUnselected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <View style={styles.buttonRow}>
              <View style={styles.buttonFlex}>
                <Button label="Reset Filters" onPress={handleReset} variant="ghost" fullWidth />
              </View>
              <View style={styles.buttonFlex}>
                <Button label="Apply" onPress={handleApply} variant="primary" fullWidth />
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#DDE3F0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#5A6A8A',
    marginBottom: 8,
  },
  sectionLabelSpaced: {
    marginTop: 20,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pillSelected: {
    backgroundColor: '#0047AB',
  },
  pillUnselected: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
  },
  pillText: {
    fontSize: 13,
  },
  pillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  pillTextUnselected: {
    color: '#5A6A8A',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
  },
  buttonFlex: {
    flex: 1,
  },
})

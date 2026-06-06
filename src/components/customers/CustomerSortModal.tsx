import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'

export type CustomerSortOption =
  | 'balance_desc'
  | 'balance_asc'
  | 'name_asc'
  | 'name_desc'
  | 'date_desc'
  | 'date_asc'

interface CustomerSortModalProps {
  visible: boolean
  sortOption: CustomerSortOption
  onSelect: (option: CustomerSortOption) => void
  onClose: () => void
}

const SORT_OPTIONS: { value: CustomerSortOption; label: string }[] = [
  { value: 'balance_desc', label: 'Balance owed (High to Low)' },
  { value: 'balance_asc', label: 'Balance owed (Low to High)' },
  { value: 'name_asc', label: 'Name (A to Z)' },
  { value: 'name_desc', label: 'Name (Z to A)' },
  { value: 'date_desc', label: 'Date added (Newest first)' },
  { value: 'date_asc', label: 'Date added (Oldest first)' },
]

export function CustomerSortModal({
  visible,
  sortOption,
  onSelect,
  onClose,
}: CustomerSortModalProps) {
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

          <View style={styles.titleRow}>
            <Text style={styles.titleText}>Sort by</Text>
          </View>

          {SORT_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={styles.optionRow}
              onPress={() => {
                onSelect(option.value)
                onClose()
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.optionText}>{option.label}</Text>
              {sortOption === option.value && (
                <Ionicons name="checkmark" size={18} color="#0047AB" />
              )}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.cancelRow}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE3F0',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  titleRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
  },
  titleText: {
    fontSize: 14,
    color: '#5A6A8A',
    fontWeight: '500',
  },
  optionRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#DDE3F0',
  },
  optionText: {
    fontSize: 16,
    color: '#0D1B3E',
  },
  cancelRow: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
  },
  cancelText: {
    fontSize: 16,
    color: '#C0152A',
    fontWeight: '500',
  },
})

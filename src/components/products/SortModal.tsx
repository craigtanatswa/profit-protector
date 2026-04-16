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

export type SortOption =
  | 'name_asc'
  | 'name_desc'
  | 'price_asc'
  | 'price_desc'
  | 'stock_asc'
  | 'stock_desc'

interface SortModalProps {
  visible: boolean
  sortOption: SortOption
  onSelect: (option: SortOption) => void
  onClose: () => void
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name_asc', label: 'Name (A to Z)' },
  { value: 'name_desc', label: 'Name (Z to A)' },
  { value: 'price_asc', label: 'Price (Low to High)' },
  { value: 'price_desc', label: 'Price (High to Low)' },
  { value: 'stock_asc', label: 'Stock (Low to High)' },
  { value: 'stock_desc', label: 'Stock (High to Low)' },
]

export function SortModal({ visible, sortOption, onSelect, onClose }: SortModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => { /* prevent close on sheet tap */ }}>
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

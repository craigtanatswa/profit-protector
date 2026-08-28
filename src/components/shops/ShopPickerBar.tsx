import React, { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

import { formatShopLabel } from '../../lib/shops'
import type { Shop } from '../../types'

export function ShopPickerBar({
  shops,
  selectedId,
  onSelect,
  readOnly = false,
  kicker,
}: {
  shops: Shop[]
  selectedId: string | null
  onSelect?: (shopId: string) => void
  readOnly?: boolean
  kicker?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = shops.find((shop) => shop.id === selectedId) ?? shops[0] ?? null
  if (!selected) return null

  const label = formatShopLabel(selected)
  const kickerText = kicker ?? (readOnly ? 'Shop' : 'Recording at')

  return (
    <>
      <TouchableOpacity
        style={styles.bar}
        activeOpacity={readOnly ? 1 : 0.75}
        disabled={readOnly}
        onPress={() => {
          if (!readOnly) setOpen(true)
        }}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="storefront-outline" size={16} color="#0047AB" />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.kicker}>{kickerText}</Text>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
        {!readOnly ? <Ionicons name="chevron-down" size={18} color="#5A6A8A" /> : null}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Choose shop</Text>
            {shops.map((shop) => {
              const active = shop.id === selected.id
              return (
                <TouchableOpacity
                  key={shop.id}
                  style={[styles.option, active && styles.optionActive]}
                  onPress={() => {
                    onSelect?.(shop.id)
                    setOpen(false)
                  }}
                >
                  <View style={styles.optionText}>
                    <Text style={[styles.optionName, active && styles.optionNameActive]}>
                      {shop.name}
                    </Text>
                    <Text style={styles.optionAddress}>{shop.address}</Text>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={20} color="#0047AB" /> : null}
                </TouchableOpacity>
              )
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDE3F0',
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E6EEFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1 },
  kicker: {
    fontSize: 11,
    color: '#5A6A8A',
    fontWeight: '500',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0D1B3E',
    marginTop: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(13, 27, 62, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEF2F8',
  },
  optionActive: {
    backgroundColor: '#F5F8FF',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderBottomWidth: 0,
  },
  optionText: { flex: 1 },
  optionName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0D1B3E',
  },
  optionNameActive: { color: '#0047AB' },
  optionAddress: {
    fontSize: 13,
    color: '#5A6A8A',
    marginTop: 2,
  },
})

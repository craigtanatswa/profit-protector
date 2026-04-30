import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface PillOption {
  value: string
  label: string
}

interface PillSelectorProps {
  options: PillOption[]
  selected: string | null
  onSelect: (value: string) => void
  /** Reserved for future use — onboarding uses single-select only */
  multiSelect?: boolean
}

export function PillSelector({
  options,
  selected,
  onSelect,
}: PillSelectorProps) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const isSelected = selected === opt.value
        return (
          <TouchableOpacity
            key={opt.value}
            activeOpacity={0.85}
            onPress={() => onSelect(opt.value)}
            style={[styles.pill, isSelected ? styles.pillOn : styles.pillOff]}
          >
            <Text style={[styles.pillText, isSelected ? styles.pillTextOn : styles.pillTextOff]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 0.5,
  },
  pillOff: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE3F0',
  },
  pillOn: {
    backgroundColor: '#0047AB',
    borderColor: '#0047AB',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '500',
  },
  pillTextOff: {
    color: '#5A6A8A',
  },
  pillTextOn: {
    color: '#FFFFFF',
  },
})

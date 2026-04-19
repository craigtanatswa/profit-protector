import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

export type MetricCardVariant = 'default' | 'success' | 'warning' | 'danger'

interface MetricCardProps {
  label: string
  value: string
  subValue?: string
  variant?: MetricCardVariant
  /** Rendered in the top-right corner of the card */
  icon?: React.ReactNode
  onPress?: () => void
}

const valueColorByVariant: Record<MetricCardVariant, string> = {
  default: '#0D1B3E',
  success: '#0A7A4B',
  warning: '#B45309',
  danger: '#C0152A',
}

export function MetricCard({
  label,
  value,
  subValue,
  variant = 'default',
  icon,
  onPress,
}: MetricCardProps) {
  const valueColor = valueColorByVariant[variant]

  const content = (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.label}>{label}</Text>
        {icon != null && <View style={styles.iconWrapper}>{icon}</View>}
      </View>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      {subValue != null && <Text style={styles.subValue}>{subValue}</Text>}
    </View>
  )

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        {content}
      </TouchableOpacity>
    )
  }

  return content
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DDE3F0',
    padding: 14,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconWrapper: {
    marginLeft: 8,
  },
  label: {
    fontSize: 12,
    color: '#5A6A8A',
    fontWeight: '500',
    flex: 1,
  },
  value: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0D1B3E',
  },
  subValue: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 3,
  },
})

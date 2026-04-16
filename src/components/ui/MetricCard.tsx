import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

type Variant = 'default' | 'success' | 'warning' | 'danger'

interface MetricCardProps {
  label: string
  value: string
  subValue?: string
  variant?: Variant
  icon?: React.ReactNode
  onPress?: () => void
}

const valueColorByVariant: Record<Variant, string> = {
  default: '#1A202C',
  success: '#003380',
  warning: '#854F0B',
  danger: '#A32D2D',
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
      {icon != null && <View style={styles.iconWrapper}>{icon}</View>}
      <Text style={styles.label}>{label}</Text>
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
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 16,
  },
  iconWrapper: {
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 4,
  },
  value: {
    fontSize: 24,
    fontWeight: '700',
  },
  subValue: {
    fontSize: 12,
    color: '#718096',
    marginTop: 2,
  },
})

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'
type Size = 'sm' | 'md'

interface BadgeProps {
  label: string
  variant: Variant
  size?: Size
}

const variantStyles: Record<Variant, { background: string; textColor: string }> = {
  success: { background: '#E6EEFF', textColor: '#003380' },
  warning: { background: '#FAEEDA', textColor: '#854F0B' },
  danger: { background: '#FCEBEB', textColor: '#A32D2D' },
  info: { background: '#E6EFFC', textColor: '#0047AB' },
  neutral: { background: '#F1EFE8', textColor: '#5F5E5A' },
}

const sizeStyles: Record<Size, { fontSize: number; paddingVertical: number; paddingHorizontal: number }> = {
  sm: { fontSize: 11, paddingVertical: 2, paddingHorizontal: 8 },
  md: { fontSize: 12, paddingVertical: 4, paddingHorizontal: 12 },
}

export function Badge({ label, variant, size = 'md' }: BadgeProps) {
  const vs = variantStyles[variant]
  const ss = sizeStyles[size]

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: vs.background,
          paddingVertical: ss.paddingVertical,
          paddingHorizontal: ss.paddingHorizontal,
        },
      ]}
    >
      <Text style={[styles.label, { fontSize: ss.fontSize, color: vs.textColor }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 20,
    alignSelf: 'center',
  },
  label: {
    fontWeight: '500',
  },
})

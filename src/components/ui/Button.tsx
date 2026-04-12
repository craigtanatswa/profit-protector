import React from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  label: string
  onPress: () => void
  variant?: Variant
  size?: Size
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  icon?: React.ReactNode
}

const variantStyles: Record<Variant, { background: string; textColor: string; borderColor?: string }> = {
  primary: { background: '#0047AB', textColor: '#FFFFFF' },
  secondary: { background: '#FFFFFF', textColor: '#0047AB', borderColor: '#0047AB' },
  danger: { background: '#E53E3E', textColor: '#FFFFFF' },
  ghost: { background: 'transparent', textColor: '#718096' },
}

const sizeStyles: Record<Size, { height: number; fontSize: number; paddingHorizontal: number }> = {
  sm: { height: 36, fontSize: 13, paddingHorizontal: 12 },
  md: { height: 48, fontSize: 15, paddingHorizontal: 16 },
  lg: { height: 56, fontSize: 17, paddingHorizontal: 20 },
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = true,
  icon,
}: ButtonProps) {
  const vs = variantStyles[variant]
  const ss = sizeStyles[size]
  const isDisabled = disabled || loading
  const minHeight = Math.max(ss.height, 48)

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        styles.base,
        {
          backgroundColor: vs.background,
          minHeight,
          paddingHorizontal: ss.paddingHorizontal,
          borderWidth: vs.borderColor ? 1 : 0,
          borderColor: vs.borderColor ?? 'transparent',
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.5 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vs.textColor} />
      ) : (
        <View style={styles.inner}>
          {icon != null && <View style={styles.iconWrapper}>{icon}</View>}
          <Text style={[styles.label, { fontSize: ss.fontSize, color: vs.textColor }]}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrapper: {
    marginRight: 8,
  },
  label: {
    fontWeight: '600',
  },
})

import React from 'react'
import {
  StyleSheet,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

type Padding = 'none' | 'sm' | 'md' | 'lg'

interface CardProps {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  padding?: Padding
}

const paddingValues: Record<Padding, number> = {
  none: 0,
  sm: 8,
  md: 16,
  lg: 24,
}

export function Card({ children, style, onPress, padding = 'md' }: CardProps) {
  const containerStyle = [
    styles.card,
    { padding: paddingValues[padding] },
    style,
  ]

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.92} style={containerStyle}>
        {children}
      </TouchableOpacity>
    )
  }

  return <View style={containerStyle}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9ECEF',
    borderRadius: 12,
  },
})

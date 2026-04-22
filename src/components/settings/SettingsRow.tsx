import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'

export interface SettingsRowProps {
  icon: keyof typeof Ionicons.glyphMap
  iconColor?: string
  iconBackground?: string
  label: string
  value?: string
  description?: string
  onPress?: () => void
  rightElement?: React.ReactNode
  showChevron?: boolean
  destructive?: boolean
  disabled?: boolean
  isLast?: boolean
}

export function SettingsRow({
  icon,
  iconColor = '#0047AB',
  iconBackground = '#E6EEFF',
  label,
  value,
  description,
  onPress,
  rightElement,
  showChevron,
  destructive = false,
  disabled = false,
  isLast = false,
}: SettingsRowProps) {
  const resolvedIconColor = destructive ? '#C0152A' : iconColor
  const resolvedIconBg = destructive ? '#FCEBEB' : iconBackground
  const resolvedLabelColor = destructive ? '#C0152A' : '#0D1B3E'
  const shouldShowChevron = showChevron !== undefined ? showChevron : !!onPress

  const content = (
    <View style={[styles.row, !isLast && styles.rowBorder, disabled && styles.disabled]}>
      <View style={[styles.iconContainer, { backgroundColor: resolvedIconBg }]}>
        <Ionicons name={icon} size={18} color={resolvedIconColor} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.label, { color: resolvedLabelColor }]}>{label}</Text>
        {description != null ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>

      {value != null ? (
        <Text style={styles.value}>{value}</Text>
      ) : null}

      {rightElement ?? null}

      {shouldShowChevron && onPress != null ? (
        <Ionicons name="chevron-forward" size={16} color="#DDE3F0" style={styles.chevron} />
      ) : null}
    </View>
  )

  if (onPress != null && !disabled) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    )
  }

  return content
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  rowBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#F4F6FB',
  },
  disabled: {
    opacity: 0.5,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    color: '#0D1B3E',
  },
  description: {
    fontSize: 12,
    color: '#5A6A8A',
    marginTop: 1,
  },
  value: {
    fontSize: 14,
    color: '#5A6A8A',
    marginRight: 8,
  },
  chevron: {
    marginLeft: 4,
  },
})

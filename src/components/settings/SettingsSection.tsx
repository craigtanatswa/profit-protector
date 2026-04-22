import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { SettingsRowProps } from './SettingsRow'

interface SettingsSectionProps {
  title: string
  children: React.ReactNode
  marginTop?: number
}

export function SettingsSection({ title, children, marginTop = 20 }: SettingsSectionProps) {
  const childArray = React.Children.toArray(children)

  return (
    <View style={[styles.container, { marginTop }]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.card}>
        {childArray.map((child, index) => {
          if (React.isValidElement<SettingsRowProps>(child)) {
            return React.cloneElement(child, {
              isLast: index === childArray.length - 1,
            })
          }
          return child
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {},
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5A6A8A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#DDE3F0',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
})

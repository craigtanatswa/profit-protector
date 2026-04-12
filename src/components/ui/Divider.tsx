import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

interface DividerProps {
  spacing?: number
  label?: string
}

export function Divider({ spacing = 0, label }: DividerProps) {
  if (label) {
    return (
      <View style={[styles.labeledContainer, { marginVertical: spacing }]}>
        <View style={styles.line} />
        <Text style={styles.labelText}>{label}</Text>
        <View style={styles.line} />
      </View>
    )
  }

  return <View style={[styles.simpleLine, { marginVertical: spacing }]} />
}

const styles = StyleSheet.create({
  simpleLine: {
    height: 1,
    backgroundColor: '#E9ECEF',
  },
  labeledContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#E9ECEF',
  },
  labelText: {
    fontSize: 12,
    color: '#718096',
    paddingHorizontal: 12,
  },
})

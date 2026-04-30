import React from 'react'
import { StyleSheet, View } from 'react-native'

const PRIMARY = '#0047AB'
const BORDER = '#DDE3F0'

interface OnboardingProgressProps {
  total: number
  /** 0-indexed */
  current: number
}

export function OnboardingProgress({ total, current }: OnboardingProgressProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: total }, (_, i) => {
        const done = i < current
        const active = i === current
        if (done) {
          return <View key={i} style={styles.dotFilled} />
        }
        if (active) {
          return <View key={i} style={styles.pillActive} />
        }
        return <View key={i} style={styles.dotUpcoming} />
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 8,
  },
  dotFilled: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  pillActive: {
    width: 20,
    height: 8,
    borderRadius: 4,
    backgroundColor: PRIMARY,
  },
  dotUpcoming: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BORDER,
  },
})

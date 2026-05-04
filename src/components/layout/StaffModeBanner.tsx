import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** Content row height below the status-bar inset (used for stacking overlays). */
export const STAFF_MODE_BANNER_ROW_HEIGHT = 28

interface StaffModeBannerProps {
  shopkeeperName: string
  onSignOut: () => void
}

export function StaffModeBanner({ shopkeeperName, onSignOut }: StaffModeBannerProps) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Ionicons name="person-outline" size={13} color="rgba(255,255,255,0.8)" />
          <Text style={styles.text} numberOfLines={1}>
            Staff: {shopkeeperName}
          </Text>
        </View>
        <TouchableOpacity onPress={onSignOut} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0047AB',
  },
  row: {
    minHeight: STAFF_MODE_BANNER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  text: { marginLeft: 4, fontSize: 12, color: '#FFFFFF', flex: 1 },
  signOut: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
})

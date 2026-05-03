import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

interface StaffModeBannerProps {
  shopkeeperName: string
  onSignOut: () => void
}

export function StaffModeBanner({ shopkeeperName, onSignOut }: StaffModeBannerProps) {
  return (
    <View style={styles.root}>
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
  )
}

const styles = StyleSheet.create({
  root: {
    height: 28,
    backgroundColor: '#0047AB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  left: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  text: { marginLeft: 4, fontSize: 12, color: '#FFFFFF', flex: 1 },
  signOut: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
})

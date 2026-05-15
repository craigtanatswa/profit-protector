import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppChrome } from '../../context/AppChromeContext'
import { BrandLogo } from './BrandLogo'

const HEADER_BG = '#0047AB'

type IconAction = { icon: keyof typeof Ionicons.glyphMap; onPress: () => void }
type LabelAction = { label: string; onPress: () => void }

interface ScreenHeaderProps {
  title: string
  subtitle?: string
  leftAction?: IconAction
  rightAction?: IconAction | LabelAction
  showBorder?: boolean
}

function isLabelAction(action: IconAction | LabelAction): action is LabelAction {
  return 'label' in action
}

export function ScreenHeader({
  title,
  subtitle,
  leftAction,
  rightAction,
  showBorder = true,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets()
  const { staffBannerConsumesTopSafeArea } = useAppChrome()
  const topPad = (staffBannerConsumesTopSafeArea ? 0 : insets.top) + 14

  return (
    <>
      <StatusBar style="light" />
      <View
        style={[
          styles.container,
          showBorder && styles.border,
          { paddingTop: topPad, paddingBottom: 12 },
        ]}
      >
        {/* Left: optional back/action button */}
        {leftAction != null && (
          <TouchableOpacity
            onPress={leftAction.onPress}
            style={styles.leftAction}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name={leftAction.icon} size={24} color="#FFFFFF" />
          </TouchableOpacity>
        )}

        {/* Logo + Title — left-aligned, takes remaining space */}
        <View style={styles.titleRow}>
          <BrandLogo variant="mark" color="blue" width={33} height={33} onBlueBackground />
          <View style={styles.titleStack}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle != null && (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        {/* Right action */}
        <View style={styles.rightSlot}>
          {rightAction != null && (
            isLabelAction(rightAction) ? (
              <TouchableOpacity
                onPress={rightAction.onPress}
                style={styles.actionTouch}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.rightLabel}>{rightAction.label}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={rightAction.onPress}
                style={styles.actionTouch}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name={rightAction.icon} size={24} color="#FFFFFF" />
              </TouchableOpacity>
            )
          )}
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: HEADER_BG,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  border: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.22)',
  },
  leftAction: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleStack: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.82)',
    marginTop: 1,
  },
  rightSlot: {
    alignItems: 'flex-end',
  },
  actionTouch: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightLabel: {
    fontSize: 15,
    color: '#FFFFFF',
    fontWeight: '500',
  },
})

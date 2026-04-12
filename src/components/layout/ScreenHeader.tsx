import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

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
  return (
    <View style={[styles.container, showBorder && styles.border]}>
      <View style={styles.leftSlot}>
        {leftAction != null && (
          <TouchableOpacity
            onPress={leftAction.onPress}
            style={styles.actionTouch}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name={leftAction.icon} size={24} color="#1A202C" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle != null && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

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
              <Ionicons name={rightAction.icon} size={24} color="#1A202C" />
            </TouchableOpacity>
          )
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  border: {
    borderBottomWidth: 1,
    borderBottomColor: '#E9ECEF',
  },
  leftSlot: {
    width: 44,
    alignItems: 'flex-start',
  },
  rightSlot: {
    width: 44,
    alignItems: 'flex-end',
  },
  actionTouch: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A202C',
  },
  subtitle: {
    fontSize: 13,
    color: '#718096',
    marginTop: 2,
  },
  rightLabel: {
    fontSize: 15,
    color: '#0047AB',
    fontWeight: '500',
  },
})

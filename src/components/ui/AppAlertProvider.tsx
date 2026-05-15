import React, { useCallback, useLayoutEffect, useState } from 'react'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type AlertButton,
} from 'react-native'

import type { QueuedAlert } from '../../lib/appAlertQueue'
import { peekAlert, shiftAlert, subscribeAlertQueue } from '../../lib/appAlertQueue'

/** Matches tailwind/Button + ScreenHeader chrome */
const color = {
  primary: '#0047AB',
  onSurface: '#1A202C',
  onSurfaceMuted: '#5A6A8A',
  danger: '#C0152A',
  surface: '#FFFBFE',
  scrim: 'rgba(0, 25, 45, 0.45)',
  outlineMuted: '#DDE3F0',
}

function buttonBg(btn: AlertButton): string {
  switch (btn.style) {
    case 'destructive':
      return color.danger
    case 'cancel':
      return color.onSurfaceMuted
    default:
      return color.primary
  }
}

function ActionButton({
  btn,
  onPress,
  fullWidth = false,
}: {
  btn: AlertButton
  onPress: (b: AlertButton) => void
  fullWidth?: boolean
}) {
  const bg = buttonBg(btn)
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={() => onPress(btn)}
      style={[
        styles.actionBtn,
        fullWidth ? styles.actionBtnFull : undefined,
        { backgroundColor: bg },
      ]}
    >
      <Text style={styles.actionBtnLabel}>{btn.text}</Text>
    </TouchableOpacity>
  )
}

function Actions({
  buttons,
  onPress,
}: {
  buttons: AlertButton[]
  onPress: (b: AlertButton) => void
}) {
  if (buttons.length <= 2) {
    return (
      <View style={styles.actionsRow}>
        {buttons.map((btn, index) => (
          <ActionButton key={`row-${index}`} btn={btn} onPress={onPress} />
        ))}
      </View>
    )
  }

  return (
    <View style={styles.actionsStack}>
      {[...buttons].reverse().map((btn, index) => (
        <ActionButton key={`stack-${index}`} btn={btn} onPress={onPress} fullWidth />
      ))}
    </View>
  )
}

export function AppAlertProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<QueuedAlert | null>(() =>
    Platform.OS === 'android' ? peekAlert() ?? null : null,
  )
  const { width: screenW } = useWindowDimensions()
  const cardMax = Math.min(400, Math.round(screenW * 0.9))

  const sync = useCallback(() => {
    setCurrent(Platform.OS === 'android' ? peekAlert() ?? null : null)
  }, [])

  useLayoutEffect(() => {
    sync()
    return subscribeAlertQueue(sync)
  }, [sync])

  const runAction = useCallback((btn: AlertButton) => {
    shiftAlert()
    setCurrent(peekAlert() ?? null)
    queueMicrotask(() => btn.onPress?.())
  }, [])

  const handleScrimPress = useCallback(() => {
    const c = peekAlert()
    if (!c) return
    if (c.options?.cancelable === false) return
    const cancelBtn = c.buttons.find((b) => b.style === 'cancel')
    if (cancelBtn) {
      runAction(cancelBtn)
      return
    }
    shiftAlert()
    setCurrent(peekAlert() ?? null)
  }, [runAction])

  if (Platform.OS !== 'android' || current == null) {
    return <>{children}</>
  }

  const cancelable = current.options?.cancelable !== false
  const titleLen = current.title.length
  const hasMessage = current.message != null && current.message !== ''
  const hasBodyAboveDivider = titleLen > 0 || hasMessage

  return (
    <>
      {children}
      <Modal transparent visible animationType="fade" onRequestClose={handleScrimPress}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss alert"
          disabled={!cancelable}
          onPress={handleScrimPress}
          style={[StyleSheet.absoluteFill, styles.centerContent]}
        >
          <Pressable
            accessibilityRole="alert"
            accessibilityViewIsModal
            onPress={(e) => e.stopPropagation()}
            style={[styles.card, { width: cardMax }]}
          >
            {titleLen > 0 ? (
              <Text style={styles.title} accessibilityRole="header">
                {current.title}
              </Text>
            ) : null}
            {hasMessage ? (
              <Text
                style={[styles.supporting, titleLen === 0 ? styles.supportingNoTitle : undefined]}
              >
                {current.message}
              </Text>
            ) : null}
            <View style={[styles.divider, !hasBodyAboveDivider && styles.dividerTightTop]} />
            <Actions buttons={current.buttons} onPress={runAction} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: color.scrim,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: color.primary,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 12,
    elevation: 6,
    shadowColor: '#08142B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    color: color.onSurface,
    fontWeight: '400',
    letterSpacing: 0,
  },
  supporting: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 20,
    color: color.onSurfaceMuted,
    fontWeight: '400',
  },
  supportingNoTitle: {
    marginTop: 0,
  },
  divider: {
    marginTop: 24,
    height: StyleSheet.hairlineWidth,
    marginHorizontal: -8,
    backgroundColor: color.outlineMuted,
  },
  dividerTightTop: {
    marginTop: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 16,
    paddingBottom: 4,
  },
  actionsStack: {
    gap: 8,
    paddingTop: 16,
    paddingBottom: 4,
  },
  actionBtn: {
    borderRadius: 100,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0,
  },
  actionBtnFull: {
    alignSelf: 'stretch',
  },
  actionBtnLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.25,
    textAlign: 'center',
  },
})

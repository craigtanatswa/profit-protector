import React, { useEffect, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/** Keyboard height while open; 0 when closed. Use to lift bottom sheets above the keyboard. */
export function useKeyboardHeight(enabled = true): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setKeyboardHeight(0)
      return
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'

    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0)
    })

    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [enabled])

  return keyboardHeight
}

interface KeyboardAvoidingWrapperProps {
  children: React.ReactNode
  style?: ViewStyle
  scrollRef?: React.RefObject<ScrollView | null>
  keyboardVerticalOffset?: number
  contentContainerStyle?: StyleProp<ViewStyle>
  scrollViewProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'ref'>
}

export function KeyboardAvoidingWrapper({
  children,
  style,
  scrollRef,
  keyboardVerticalOffset = 0,
  contentContainerStyle,
  scrollViewProps,
}: KeyboardAvoidingWrapperProps) {
  const insets = useSafeAreaInsets()
  const bottomPad = Math.max(insets.bottom, 12)

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={keyboardVerticalOffset}
      style={[{ flex: 1 }, style]}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[{ flexGrow: 1, paddingBottom: bottomPad }, contentContainerStyle]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        {...scrollViewProps}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

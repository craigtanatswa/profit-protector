import React from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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

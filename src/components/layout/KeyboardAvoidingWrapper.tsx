import React from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

interface KeyboardAvoidingWrapperProps {
  children: React.ReactNode
  style?: ViewStyle
}

export function KeyboardAvoidingWrapper({ children, style }: KeyboardAvoidingWrapperProps) {
  const insets = useSafeAreaInsets()
  const bottomPad = Math.max(insets.bottom, 12)

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[{ flex: 1 }, style]}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

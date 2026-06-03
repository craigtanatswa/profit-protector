import React, { useEffect, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function ModalSheet({
  visible,
  onClose,
  title,
  children,
  avoidKeyboard = false,
}: {
  visible: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  avoidKeyboard?: boolean
}) {
  const insets = useSafeAreaInsets()
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    if (!visible || !avoidKeyboard) {
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
  }, [visible, avoidKeyboard])

  const keyboardLift =
    avoidKeyboard && keyboardHeight > 0 ? Math.max(0, keyboardHeight - insets.bottom) : 0

  const body = avoidKeyboard ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
      bounces={false}
    >
      {children}
    </ScrollView>
  ) : (
    children
  )

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={modalSheetStyles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={avoidKeyboard ? insets.bottom : 0}
      >
        <View style={modalSheetStyles.root}>
          <TouchableOpacity style={modalSheetStyles.overlay} activeOpacity={1} onPress={onClose} />
          <View
            style={[
              modalSheetStyles.sheet,
              keyboardLift > 0 && { marginBottom: keyboardLift },
            ]}
          >
            <View style={modalSheetStyles.handle} />
            <Text style={modalSheetStyles.title}>{title}</Text>
            {body}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

export const modalSheetStyles = StyleSheet.create({
  kav: { flex: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#DDE3F0',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0D1B3E',
    marginBottom: 20,
  },
})

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  AppState,
  type AppStateStatus,
  Dimensions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

const SCREEN_WIDTH = Dimensions.get('window').width
const H_PADDING = 48
const GAP_TOTAL = 40
const BOX_WIDTH = (SCREEN_WIDTH - H_PADDING - GAP_TOTAL) / 6

export interface OTPInputProps {
  length?: number
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  error?: string
  disabled?: boolean
}

export function OTPInput({
  length = 6,
  value,
  onChange,
  autoFocus = true,
  error,
  disabled = false,
}: OTPInputProps) {
  const inputRef = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)

  const digits = value.replace(/\D/g, '').slice(0, length)
  const activeIndex = Math.min(digits.length, length - 1)

  // After leaving the app (e.g. email inbox) and returning, a tiny off-screen
  // input + Pressable->focus() often leaves the modal untappable on Android/iOS.
  // Nudge focus when the app becomes active again.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const onAppState = (state: AppStateStatus) => {
      if (state === 'active' && !disabled) {
        if (t) clearTimeout(t)
        t = setTimeout(() => {
          t = undefined
          inputRef.current?.focus()
        }, 80)
      }
    }
    const sub = AppState.addEventListener('change', onAppState)
    return () => {
      sub.remove()
      if (t) clearTimeout(t)
    }
  }, [disabled])

  const handleChange = useCallback(
    (text: string) => {
      const next = text.replace(/\D/g, '').slice(0, length)
      onChange(next)
    },
    [length, onChange],
  )

  return (
    <View style={styles.wrap}>
      {/*
        Full-size transparent input over the boxes so touches go straight to
        the native field (reliable after app resume). A 1x1 + Pressable focus
        bridge breaks with Modal + backgrounding on many devices.
      */}
      <View style={styles.row} collapsable={false}>
        {Array.from({ length }).map((_, i) => {
          const ch = digits[i] ?? ''
          const isActiveBox = focused && i === activeIndex && digits.length < length
          const isFilled = ch !== ''
          let borderColor = '#DDE3F0'
          if (error) {
            borderColor = '#C0152A'
          } else if (isActiveBox || isFilled) {
            borderColor = '#0047AB'
          }

          return (
            <View
              key={i}
              style={[
                styles.box,
                { width: BOX_WIDTH, borderColor },
              ]}
            >
              {ch !== '' ? (
                <Text style={styles.boxText}>{ch}</Text>
              ) : isActiveBox ? (
                <View style={styles.cursor} />
              ) : null}
            </View>
          )
        })}

        <TextInput
          ref={inputRef}
          value={digits}
          onChangeText={handleChange}
          keyboardType="number-pad"
          maxLength={length}
          editable={!disabled}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          showSoftInputOnFocus
          style={styles.overlayInput}
          caretHidden
          importantForAutofill="no"
          underlineColorAndroid="transparent"
        />
      </View>

      {error != null && error !== '' ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  row: {
    position: 'relative',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  overlayInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    zIndex: 1,
  },
  box: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0D1B3E',
    textAlign: 'center',
  },
  cursor: {
    width: 2,
    height: 20,
    backgroundColor: '#0047AB',
    borderRadius: 1,
  },
  errorText: {
    fontSize: 12,
    color: '#C0152A',
    marginTop: 6,
    textAlign: 'center',
  },
})

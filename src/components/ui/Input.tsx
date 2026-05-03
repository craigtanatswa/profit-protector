import React, { useState } from 'react'
import {
  KeyboardTypeOptions,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'

interface InputProps {
  label?: string
  placeholder?: string
  value: string
  onChangeText: (text: string) => void
  onBlur?: () => void
  error?: string
  hint?: string
  secureTextEntry?: boolean
  keyboardType?: KeyboardTypeOptions
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: boolean
  editable?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  multiline?: boolean
  numberOfLines?: number
  maxLength?: number
}

export function Input({
  label,
  placeholder,
  value,
  onChangeText,
  onBlur,
  error,
  hint,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoCorrect = true,
  editable = true,
  leftIcon,
  rightIcon,
  multiline = false,
  numberOfLines,
  maxLength,
}: InputProps) {  const [isFocused, setIsFocused] = useState(false)

  const borderColor = error
    ? '#E53E3E'
    : isFocused
    ? '#0047AB'
    : '#E9ECEF'

  return (
    <View style={styles.wrapper}>
      {label != null && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.inputContainer,
          { borderColor },
          multiline && styles.multilineContainer,
        ]}
      >
        {leftIcon != null && <View style={styles.leftIcon}>{leftIcon}</View>}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#A0AEC0"
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          editable={editable}
          multiline={multiline}
          numberOfLines={numberOfLines}
          maxLength={maxLength}
          onFocus={() => setIsFocused(true)}
          onBlur={() => { setIsFocused(false); onBlur?.() }}
          style={[
            styles.input,
            leftIcon != null && styles.inputWithLeftIcon,
            rightIcon != null && styles.inputWithRightIcon,
            multiline && styles.multilineInput,
          ]}
        />
        {rightIcon != null && <View style={styles.rightIcon}>{rightIcon}</View>}
      </View>
      {error != null && <Text style={styles.errorText}>{error}</Text>}
      {error == null && hint != null && <Text style={styles.hintText}>{hint}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    color: '#1A202C',
    fontWeight: '500',
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
  },
  multilineContainer: {
    height: undefined,
    alignItems: 'flex-start',
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1A202C',
    padding: 0,
  },
  multilineInput: {
    textAlignVertical: 'top',
  },
  inputWithLeftIcon: {
    marginLeft: 8,
  },
  inputWithRightIcon: {
    marginRight: 8,
  },
  leftIcon: {
    justifyContent: 'center',
  },
  rightIcon: {
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#E53E3E',
    marginTop: 4,
  },
  hintText: {
    fontSize: 12,
    color: '#718096',
    marginTop: 4,
  },
})

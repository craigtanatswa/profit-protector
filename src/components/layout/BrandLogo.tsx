import React from 'react'
import { Image, type ImageStyle, type StyleProp } from 'react-native'

const brandLogo = require('../../../assets/brand-logo.png')
const logoMark = require('../../../assets/logo-mark.png')

type Variant = 'full' | 'mark'

interface BrandLogoProps {
  variant?: Variant
  width: number
  height?: number
  style?: StyleProp<ImageStyle>
}

export function BrandLogo({ variant = 'full', width, height, style }: BrandLogoProps) {
  const source = variant === 'full' ? brandLogo : logoMark
  const aspectHeight = height ?? width

  return (
    <Image
      source={source}
      style={[{ width, height: aspectHeight, resizeMode: 'contain' }, style]}
      accessibilityLabel="Profit Protector"
    />
  )
}

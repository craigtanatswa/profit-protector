import React from 'react'
import { Image, type ImageStyle, type StyleProp } from 'react-native'

const brandLogo = require('../../../assets/brand-logo.png')
const brandLogoWhite = require('../../../assets/brand-logo-white.png')
const logoMark = require('../../../assets/logo-mark.png')
const logoMarkWhite = require('../../../assets/brand-logo-white.png')

type Variant = 'full' | 'mark'
type Color = 'blue' | 'white'

interface BrandLogoProps {
  variant?: Variant
  color?: Color
  width: number
  height?: number
  style?: StyleProp<ImageStyle>
}

export function BrandLogo({ variant = 'full', color = 'blue', width, height, style }: BrandLogoProps) {
  const isWhite = color === 'white'
  const source =
    variant === 'full'
      ? isWhite ? brandLogoWhite : brandLogo
      : isWhite ? logoMarkWhite : logoMark
  const aspectHeight = height ?? width

  return (
    <Image
      source={source}
      style={[{ width, height: aspectHeight, resizeMode: 'contain' }, style]}
      accessibilityLabel="Profit Protector"
    />
  )
}

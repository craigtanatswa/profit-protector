import React from 'react'
import { Image, View, type ImageStyle, type StyleProp } from 'react-native'

const brandLogo = require('../../../assets/brand-logo.png')
const brandLogoWhite = require('../../../assets/brand-logo-white.png')
const logoMark = require('../../../assets/logo-mark.png')
const logoMarkBlue = require('../../../assets/logo-mark-blue.png')

type Variant = 'full' | 'mark'
type Color = 'blue' | 'white'

interface BrandLogoProps {
  variant?: Variant
  color?: Color
  width: number
  height?: number
  style?: StyleProp<ImageStyle>
  /**
   * When true, wraps the logo in a white circle so the blue logo
   * is visible against a blue header background.
   */
  onBlueBackground?: boolean
}

export function BrandLogo({
  variant = 'full',
  color = 'blue',
  width,
  height,
  style,
  onBlueBackground = false,
}: BrandLogoProps) {
  const isWhite = color === 'white'
  const aspectHeight = height ?? width

  // When placed on a blue background, use the blue logo mark
  // wrapped in a white circle for contrast.
  if (onBlueBackground) {
    // Tight white ring: total diameter = logo + thin padding on each side
    const circleSize = aspectHeight + 4
    return (
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Image
          source={logoMarkBlue}
          style={[{ width, height: aspectHeight, resizeMode: 'contain' }, style]}
          accessibilityLabel="Profit Protector"
        />
      </View>
    )
  }

  const source =
    variant === 'full'
      ? isWhite ? brandLogoWhite : brandLogo
      : isWhite ? brandLogoWhite : logoMark
  const finalSize = aspectHeight

  return (
    <Image
      source={source}
      style={[{ width, height: finalSize, resizeMode: 'contain' }, style]}
      accessibilityLabel="Profit Protector"
    />
  )
}

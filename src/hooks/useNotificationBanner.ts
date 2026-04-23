import { useState, useCallback } from 'react'
import type { NotificationBannerProps } from '../components/ui/NotificationBanner'

interface ShowBannerParams {
  title: string
  message: string
  type: 'warning' | 'danger'
  productId?: string | null
}

interface UseNotificationBannerReturn {
  bannerProps: NotificationBannerProps
  showBanner: (params: ShowBannerParams) => void
  hideBanner: () => void
}

export function useNotificationBanner(): UseNotificationBannerReturn {
  const [bannerState, setBannerState] = useState<{
    visible: boolean
    title: string
    message: string
    type: 'warning' | 'danger'
    productId: string | null
  }>({
    visible: false,
    title: '',
    message: '',
    type: 'warning',
    productId: null,
  })

  const showBanner = useCallback((params: ShowBannerParams) => {
    setBannerState({
      visible: true,
      title: params.title,
      message: params.message,
      type: params.type,
      productId: params.productId ?? null,
    })
  }, [])

  const hideBanner = useCallback(() => {
    setBannerState((prev) => ({ ...prev, visible: false }))
  }, [])

  const bannerProps: NotificationBannerProps = {
    visible: bannerState.visible,
    title: bannerState.title,
    message: bannerState.message,
    type: bannerState.type,
    productId: bannerState.productId,
    onPress: () => {},
    onDismiss: hideBanner,
  }

  return { bannerProps, showBanner, hideBanner }
}

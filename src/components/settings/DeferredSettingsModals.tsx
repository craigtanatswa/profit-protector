import React, { useEffect, useState } from 'react'
import { InteractionManager } from 'react-native'

import type { SettingsOwnerModalsProps } from './SettingsOwnerModals'

type Props = SettingsOwnerModalsProps & {
  anyVisible: boolean
}

export function DeferredSettingsModals({ anyVisible, ...modalProps }: Props) {
  const [Host, setHost] = useState<React.ComponentType<SettingsOwnerModalsProps> | null>(null)

  useEffect(() => {
    if (Host) return

    const load = () => {
      void import('./SettingsOwnerModals').then((m) => {
        setHost(() => m.SettingsOwnerModals)
      })
    }

    if (anyVisible) {
      load()
      return
    }

    const task = InteractionManager.runAfterInteractions(load)
    return () => task.cancel()
  }, [anyVisible, Host])

  if (!Host || !anyVisible) return null
  return <Host {...modalProps} />
}

import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

import {
  consumeQueuedTutorial,
  subscribeQueuedTutorial,
  type TutorialScreen,
} from '../lib/tutorialReplay'

/** Shows a queued tutorial when this screen is focused, or immediately if it already is. */
export function useQueuedTutorialOnFocus(
  screen: TutorialScreen,
  enabled: boolean,
  showTutorial: () => void,
) {
  const focusedRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true
      if (enabled && consumeQueuedTutorial(screen)) {
        showTutorial()
      }
      return () => {
        focusedRef.current = false
      }
    }, [enabled, screen, showTutorial]),
  )

  useEffect(() => {
    if (!enabled) return
    return subscribeQueuedTutorial((queuedScreen) => {
      if (queuedScreen !== screen || !focusedRef.current) return
      if (consumeQueuedTutorial(screen)) {
        showTutorial()
      }
    })
  }, [enabled, screen, showTutorial])
}

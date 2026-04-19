import { useFocusEffect } from 'expo-router'
import { useCallback, useRef } from 'react'

type RefreshFn = () => void | Promise<void>

/**
 * Whenever this screen becomes focused, re-read local WatermelonDB-driven data
 * via the given callback (refetch / refreshLocal / refreshFromLocal).
 * Does not show loading UI — callers should keep “quiet” refetches from flashing skeletons.
 */
export function useQuietOfflineRefreshOnFocus(refresh: RefreshFn) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useFocusEffect(
    useCallback(() => {
      void Promise.resolve(refreshRef.current())
    }, []),
  )
}

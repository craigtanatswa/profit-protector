import { useEffect } from 'react'
import { AppState } from 'react-native'

import { applyServerFirstRunUxResetIfNeeded } from '../lib/firstRunUx'
import { supabase } from '../lib/supabase'

/**
 * Polls `businesses.first_run_ux_reset_at` (set from admin Testing) and clears
 * local welcome/tutorial SecureStore flags when the timestamp advances.
 */
export function useApplyFirstRunUxReset(businessId: string | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !businessId) return

    let cancelled = false

    async function check() {
      const { data, error } = await supabase
        .from('businesses')
        .select('first_run_ux_reset_at')
        .eq('id', businessId)
        .maybeSingle()

      if (cancelled || error || !data) return
      const resetAt = data.first_run_ux_reset_at as string | null | undefined
      await applyServerFirstRunUxResetIfNeeded(businessId, resetAt)
    }

    void check()

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check()
    })

    return () => {
      cancelled = true
      sub.remove()
    }
  }, [businessId, enabled])
}

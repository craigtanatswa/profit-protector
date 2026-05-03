import React from 'react'

import { useHasPermission, type AccessPermissions } from '../../lib/accessControl'

interface AccessGuardProps {
  permission: keyof AccessPermissions
  fallback?: React.ReactNode
  children: React.ReactNode
}

export function AccessGuard({ permission, fallback = null, children }: AccessGuardProps) {
  const allowed = useHasPermission(permission)
  return <>{allowed ? children : fallback}</>
}

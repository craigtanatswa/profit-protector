import { useAuthStore } from '../stores/authStore'
import type { UserRole } from '../types'

export interface AccessPermissions {
  canViewDashboard: boolean
  canRecordSales: boolean
  canViewSalesHistory: boolean
  canAddProducts: boolean
  canEditProducts: boolean
  canReceiveStock: boolean
  canAdjustStock: boolean
  canViewInventory: boolean
  canViewCustomers: boolean
  canRecordPayments: boolean
  canViewReports: boolean
  canExportData: boolean
  canViewSettings: boolean
  canViewActivityLog: boolean
  canManageShopkeepers: boolean
  canChangePassword: boolean
  canDeleteBusiness: boolean
  canClearData: boolean
  canViewBusinessId: boolean
}

export function getPermissions(role: UserRole): AccessPermissions {
  if (role === 'owner') {
    return {
      canViewDashboard: true,
      canRecordSales: true,
      canViewSalesHistory: true,
      canAddProducts: true,
      canEditProducts: true,
      canReceiveStock: true,
      canAdjustStock: true,
      canViewInventory: true,
      canViewCustomers: true,
      canRecordPayments: true,
      canViewReports: true,
      canExportData: true,
      canViewSettings: true,
      canViewActivityLog: true,
      canManageShopkeepers: true,
      canChangePassword: true,
      canDeleteBusiness: true,
      canClearData: true,
      canViewBusinessId: true,
    }
  }

  return {
    canViewDashboard: true,
    canRecordSales: true,
    canViewSalesHistory: true,
    canAddProducts: false,
    canEditProducts: false,
    canReceiveStock: true,
    canAdjustStock: true,
    canViewInventory: true,
    canViewCustomers: true,
    canRecordPayments: false,
    canViewReports: false,
    canExportData: false,
    canViewSettings: true,
    canViewActivityLog: false,
    canManageShopkeepers: false,
    canChangePassword: false,
    canDeleteBusiness: false,
    canClearData: false,
    canViewBusinessId: false,
  }
}

export function usePermissions(): AccessPermissions {
  const activeRole = useAuthStore((s) => s.activeRole)
  return getPermissions(activeRole)
}

export function useHasPermission(permission: keyof AccessPermissions): boolean {
  return usePermissions()[permission]
}

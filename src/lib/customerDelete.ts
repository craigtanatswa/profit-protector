import { Alert } from 'react-native'

import { database } from '../database'
import type CustomerModel from '../database/models/Customer'
import { logActivity } from './activityLogger'
import { wmRaw } from './watermelonRaw'
import { useAuthStore } from '../stores/authStore'

export interface CustomerDeleteTarget {
  id: string
  name: string
  outstandingBalanceCents: number
}

export function confirmDeleteCustomer(
  customer: CustomerDeleteTarget,
  onDeleted: () => void,
): void {
  if (customer.outstandingBalanceCents > 0) {
    Alert.alert(
      'Cannot Delete Customer',
      'Cannot delete a customer with an outstanding balance. Record a payment first.',
    )
    return
  }

  Alert.alert(
    `Delete ${customer.name}?`,
    'This will not delete their sales history. Their credit records will remain.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Customer',
        style: 'destructive',
        onPress: () => {
          void softDeleteCustomer(customer.id, customer.name, onDeleted)
        },
      },
    ],
  )
}

export async function softDeleteCustomer(
  customerId: string,
  customerName: string,
  onDeleted: () => void,
): Promise<void> {
  if (!database) return

  try {
    const now = Date.now()
    await database.write(async () => {
      const record = await database!.get<CustomerModel>('customers').find(customerId)
      await record.update((c) => {
        c.isActive = false
        c.updatedAt = new Date(now)
        wmRaw(c).updated_at = now
      })
    })

    await logActivity({
      action: 'customer_deleted',
      entityType: 'customer',
      entityId: customerId,
      entityName: customerName,
    })

    const { triggerSync, business, activeRole } = useAuthStore.getState()
    if (business && activeRole === 'owner') {
      triggerSync(business.id).catch(() => {})
    }

    onDeleted()
  } catch {
    Alert.alert('Error', 'Failed to delete customer.')
  }
}

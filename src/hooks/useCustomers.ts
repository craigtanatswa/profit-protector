import { useCallback, useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Customer } from '../types'
import type CustomerModel from '../database/models/Customer'

function mapCustomerRecord(record: CustomerModel): Customer {
  return {
    id: record.id,
    businessId: record.businessId,
    name: record.name,
    phone: record.phone ?? undefined,
    outstandingBalanceCents: record.outstandingBalanceCents,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

export function useCustomers(businessId: string) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!businessId || !database) {
      setCustomers([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const subscription = database
      .get<CustomerModel>('customers')
      .query(
        Q.where('business_id', businessId),
        Q.sortBy('name', Q.asc),
      )
      .observe()
      .subscribe({
        next: (records) => {
          setCustomers(records.map(mapCustomerRecord))
          setIsLoading(false)
        },
        error: () => {
          setIsLoading(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [businessId])

  const createCustomer = useCallback(
    async (name: string, phone?: string): Promise<Customer> => {
      if (!database) throw new Error('Database not available')

      const record = await database.write(async () => {
        return database!.get<CustomerModel>('customers').create((c) => {
          c.businessId = businessId
          c.name = name.trim()
          c.phone = phone?.trim() || null
          c.outstandingBalanceCents = 0
        })
      })

      return mapCustomerRecord(record)
    },
    [businessId],
  )

  return { customers, isLoading, createCustomer }
}

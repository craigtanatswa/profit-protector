import { useEffect, useState } from 'react'
import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import type { Sale } from '../types'
import type SaleModel from '../database/models/Sale'

function mapSaleRecord(record: SaleModel): Sale {
  return {
    id: record.id,
    businessId: record.businessId,
    totalCents: record.totalCents,
    discountCents: record.discountCents,
    paymentMethod: record.paymentMethod as Sale['paymentMethod'],
    note: record.note ?? undefined,
    receiptNumber: record.receiptNumber,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Date.now(),
  }
}

export function useSales(businessId: string) {
  const [sales, setSales] = useState<Sale[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [totalSalesCount, setTotalSalesCount] = useState(0)

  useEffect(() => {
    if (!businessId || !database) {
      setSales([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const subscription = database
      .get<SaleModel>('sales')
      .query(
        Q.where('business_id', businessId),
        Q.sortBy('created_at', Q.desc),
      )
      .observe()
      .subscribe({
        next: (records) => {
          setSales(records.map(mapSaleRecord))
          setTotalSalesCount(records.length)
          setIsLoading(false)
        },
        error: () => {
          setIsLoading(false)
        },
      })

    return () => subscription.unsubscribe()
  }, [businessId])

  return { sales, isLoading, totalSalesCount }
}

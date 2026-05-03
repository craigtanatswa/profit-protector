import { NativeModules } from 'react-native'
import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'
import { schema } from './schema'
import { migrations } from './migrations'

import Business from './models/Business'
import Product from './models/Product'
import Sale from './models/Sale'
import SaleItem from './models/SaleItem'
import StockMovement from './models/StockMovement'
import Customer from './models/Customer'
import CreditSale from './models/CreditSale'
import PaymentRecord from './models/PaymentRecord'
import Shopkeeper from './models/Shopkeeper'
import ActivityLog from './models/ActivityLog'

const modelClasses = [
  Business,
  Product,
  Sale,
  SaleItem,
  StockMovement,
  Customer,
  CreditSale,
  PaymentRecord,
  Shopkeeper,
  ActivityLog,
]

/**
 * WatermelonDB requires native modules (WMDatabaseBridge). They are not included in Expo Go.
 * Use a development build (`npx expo prebuild` / EAS) after configuring the native dependency.
 */
const nativeBridgeAvailable = NativeModules.WMDatabaseBridge != null

let database: Database | null = null

if (nativeBridgeAvailable) {
  try {
    const adapter = new SQLiteAdapter({
      schema,
      migrations,
      jsi: true,
      onSetUpError: (error) => console.error('DB setup error:', error),
    })
    database = new Database({
      adapter,
      modelClasses,
    })
  } catch (e) {
    console.warn('[database] Failed to open SQLite adapter:', e)
    database = null
  }
}

export { database }

export type HelpFaqItem = {
  id: string
  question: string
  answer: string
}

export const HELP_SUPPORT_INTRO =
  'Quick answers to common questions. Tap a topic to expand it. If you still need help, send us a message using the button above.'

export const HELP_SUPPORT_FAQS: HelpFaqItem[] = [
  {
    id: 'add-product',
    question: 'How do I add a product?',
    answer:
      'Open Stock & Products from the bottom menu, then tap Add Product (or the + button). Enter the product name, selling price, cost price if you track it, and optional details like SKU or low-stock alert level. Save to add it to your inventory.',
  },
  {
    id: 'cut-products',
    question: 'How do I sell meat or cloth cut from one piece?',
    answer:
      'Pro is for packed goods (bottles, bags, each). On Pro+ (and during the trial), choose Cut from a piece when adding a product to sell meat, cloth, or similar by the kg or metre. Set a rate and the leftover amount on the piece. At sale time, type the cut size — the price is calculated automatically and remaining stock updates.',
  },
  {
    id: 'make-sale',
    question: 'How do I record a sale?',
    answer:
      'Go to Sales and tap New Sale. Add items from your product list, choose payment type (cash, mobile money, credit, and so on), then complete the sale. The sale appears in your Sales history and stock levels update automatically.',
  },
  {
    id: 'adjust-stock',
    question: 'How do I receive or adjust stock?',
    answer:
      'Open Stock & Products, tap a product, then use Receive Stock when new stock arrives or Adjust Stock to fix counts after a stocktake or correction. Each change is logged so you can review it later in Activity Log.',
  },
  {
    id: 'download-reports',
    question: 'How do I download reports?',
    answer:
      'Open Reports, pick the date range you need, then tap Export. You can download a PDF summary or a CSV file that opens in Excel or Google Sheets. Reports include sales, profit, and inventory insights for the period you selected.',
  },
  {
    id: 'shopkeeper-stock',
    question: 'Can shopkeepers adjust my stock without my permission?',
    answer:
      'No. Shopkeepers must request your approval before they can receive or adjust stock. You approve or deny the request in the app; if approved, they get temporary access for that action type. All stock changes are recorded in Activity Log.',
  },
  {
    id: 'multiple-shops',
    question: 'Can I record sales from more than one shop?',
    answer:
      'Pro covers one shop. On Pro+ (and during the trial), open Settings → Shops to add another establishment (up to 5). Your current location is saved as Shop 1 with a short address; each extra shop is Shop 2, Shop 3, and so on. Shop 1’s products are copied into the new shop once, then each shop keeps its own catalog — adding or editing a product in one shop does not change the others. When you have more than one shop, pick the shop on New Sale, Stock & Products, and Home (it remembers the last one you used) and assign each shopkeeper to a shop when you create their account.',
  },
  {
    id: 'manage-staff',
    question: 'How do I add or manage staff?',
    answer:
      'In Settings, open Manage Staff to invite shopkeepers, set their login details, and remove access when someone leaves. Each staff member signs in with their own username and only sees what their role allows. Pro includes you plus one staff account; Pro+ (and the trial) allow up to 5, assigned to a shop when you have more than one location.',
  },
  {
    id: 'customers-credit',
    question: 'How do credit sales and customers work?',
    answer:
      'Add customers from the Customers tab. When recording a sale, you can mark it as credit and link it to a customer. Track outstanding balances on the customer profile and record payments when they settle up.',
  },
  {
    id: 'activity-log',
    question: 'What is the Activity Log?',
    answer:
      'Activity Log in Settings shows a timeline of important actions—sales, stock changes, staff logins, and approvals—so you can see who did what and when. Useful for auditing and resolving disputes.',
  },
  {
    id: 'sync-backup',
    question: 'Is my data backed up and synced?',
    answer:
      'Your business data syncs to the cloud when you are online. Sign in on a new device with the same account to restore your products, sales, and settings. Keep your phone connected periodically so changes stay up to date.',
  },
  {
    id: 'recovery',
    question: 'What if I forget my password?',
    answer:
      'On the login screen, use Forgot Password and follow the steps. For extra protection, add a recovery email in Settings so you can verify identity if you change phones or lose access.',
  },
  {
    id: 'low-stock',
    question: 'How do low-stock alerts work?',
    answer:
      'When adding or editing a product, set a low-stock threshold. Profit Protector notifies you when quantity falls at or below that level so you can reorder before you run out.',
  },
  {
    id: 'subscription',
    question: 'How does the trial and subscription work?',
    answer:
      'New businesses start with a trial that includes Pro+ features: extra shops, up to 5 staff, and cut-to-order stock such as meat and cloth. Before the trial ends, open Settings and choose a plan. Pro is one shop of packed goods with you plus one helper. Pro+ keeps the extra shops, staff, and cut-to-order stock. Payment history is available under Settings if you need receipts.',
  },
]

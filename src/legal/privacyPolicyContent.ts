/**
 * Privacy policy text for Profit Protector.
 * Update PRIVACY_CONTACT_EMAIL before publishing to production.
 */
export const PRIVACY_POLICY_LAST_UPDATED = '26 April 2026'

export const PRIVACY_CONTACT_EMAIL = 'privacy@profitprotector.app'

export type LegalSection = {
  title: string
  paragraphs: string[]
}

const intro: { title: string; paragraphs: string[] } = {
  title: 'Introduction',
  paragraphs: [
    'This Privacy Policy describes how Profit Protector (“we”, “us”, or “our”) collects, uses, stores, and protects information when you use the Profit Protector mobile application (the “App”). The App is designed to help small businesses in Zimbabwe and elsewhere manage day-to-day operations such as sales, stock, customers, and basic reporting.',
    'By creating an account or using the App, you acknowledge that you have read this policy. If you do not agree, you should not use the App.',
    'We aim to follow widely recognised data protection practices. Users in Zimbabwe should note that certain obligations may also arise under the Cyber and Data Protection Act [Chapter 12:07] and other applicable laws, depending on how and where we process your information. This policy is not legal advice; consult a professional if you need guidance specific to your situation.',
  ],
}

export const PRIVACY_POLICY_SECTIONS: LegalSection[] = [
  {
    title: 'Information We Collect',
    paragraphs: [
      'Account and identity information: your Zimbabwe-format mobile number (used to build your sign-in identity), a password you choose, your name and your business’s name, business type, optional login username, preferred currency (including USD, ZiG, or “both”), and an optional recovery email address if you provide one.',
      'Authentication metadata: our authentication provider may process your email identifier (derived from your phone number for sign-in), session tokens, and security-related events needed to keep your account secure.',
      'Business operational data you enter: product catalogue and stock levels, sales transactions and receipts, customer names and contact details you record, credit and payment information you choose to store, low-stock preferences, and similar records needed for inventory and point-of-sale features.',
      'Content you upload: for example, a business logo you select from your device for receipts or display within the App.',
      'Device and app information: we may process limited technical data such as device type, operating system, app version, and diagnostic or crash information as allowed by your platform, to keep the App reliable and secure.',
      'Notifications: if you grant permission, the App may schedule local notifications on your device (for example, low- or out-of-stock alerts). We do not need your contacts list, precise location, or other sensitive device permissions for core features unless you explicitly grant them in the future for an optional feature we describe at that time.',
    ],
  },
  {
    title: 'How We Use Information',
    paragraphs: [
      'We use the information above to: create and secure your account; sync your business data between your device and our servers; perform inventory, sales, and customer management as you direct; generate reports and exports you request; send verification or recovery messages to an email you provide; and show in-app or local notifications you have opted into.',
      'We use service providers (described under Third-Party Services) to host authentication and data, send transactional emails where applicable, and deliver the App through app stores. We do not sell your personal information to third parties, and we do not use it for third-party advertising in the current version of the App.',
      'We may use aggregated or de-identified information to understand how the App is used and to improve performance and security. Such information does not identify you personally.',
    ],
  },
  {
    title: 'Data Storage',
    paragraphs: [
      'Data you enter is stored in two main ways: (1) on your device, using a local database for offline use and faster access, and (2) on secure cloud infrastructure operated by our backend provider, so your records can be backed up, synced when you are online, and restored if you sign in on another device.',
      'Our cloud services are provided using infrastructure that may be located outside Zimbabwe, including in regions our suppliers select for performance and reliability. When data is transferred across borders, we rely on appropriate safeguards as offered by our providers and consistent with this policy.',
      'We retain your information for as long as your account is active and as needed to provide the App, comply with law, resolve disputes, and enforce our terms. You may request deletion of your account or personal data as described in User Rights, subject to legal retention requirements.',
    ],
  },
  {
    title: 'Security',
    paragraphs: [
      'We use industry-appropriate technical and organisational measures, including encryption in transit for network communication, access controls, and separation of your business data in our database using your authenticated identity. You are responsible for choosing a strong password and keeping it confidential.',
      'No method of storage or transmission is completely secure. If we become aware of a data incident that significantly affects you, we will take reasonable steps to mitigate harm and, where the law requires, inform affected users and regulators.',
    ],
  },
  {
    title: 'User Rights',
    paragraphs: [
      'Depending on applicable law, you may have the right to: access the personal information we hold about you; request correction of inaccurate data; object to or restrict certain processing; withdraw consent where processing is based on consent (this may limit App functionality); and request erasure, subject to legal exceptions.',
      'To exercise these rights, contact us using the details in Contact Information. We will respond within a reasonable time. If you are unsatisfied, you may have the right to complain to a data protection or consumer authority in your country.',
      'For account data tied to the App, you can also update many details directly in Settings (e.g. recovery email, password) and by editing business records in the App. Deletion of your full account or certain cloud-held records may require a verified request and may take a short period to process across our systems.',
    ],
  },
  {
    title: 'Third-Party Services',
    paragraphs: [
      'The App relies on the following types of service providers, who process data only as needed to run the product:',
      'Supabase: authentication, database, and related backend services for your account and synced business data.',
      'Expo and platform services: app distribution, over-the-air updates, and in some builds push or device capabilities as configured.',
      'Your device’s app store (Apple App Store or Google Play) and the operating system: processing required for installation, updates, and platform security. Their privacy policies also apply to their collection of data about your use of the store and device.',
      'We may add or replace sub-processors for similar purposes; when we do, we will update this policy or provide notice in the App or by email where appropriate.',
    ],
  },
  {
    title: 'Children',
    paragraphs: [
      'The App is intended for business users and is not directed at children. We do not knowingly collect personal information from anyone under 16. If you believe a child has provided us information, contact us and we will take steps to delete it.',
    ],
  },
  {
    title: 'Changes to This Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. The “Last updated” date at the top of the screen in the App will be revised when we make material changes. Where the law or app store rules require, we will provide additional notice (for example, in the App or by email) before the new terms take effect.',
      'If you continue to use the App after the effective date of an update, you accept the revised policy, except where the law requires your explicit consent for certain changes.',
    ],
  },
  {
    title: 'Contact Information',
    paragraphs: [
      `For privacy questions, data subject requests, or concerns about this policy, contact us at: ${PRIVACY_CONTACT_EMAIL}.`,
      'We will use reasonable efforts to respond to legitimate inquiries within a reasonable period, in line with applicable law. Please include a description of your request and, where relevant, the phone number or email associated with your account so we can verify your identity before disclosing or changing information.',
    ],
  },
]

export const PRIVACY_POLICY_INTRO = intro

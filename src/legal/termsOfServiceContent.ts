/**
 * Terms of Service for Profit Protector.
 * Update TERMS_CONTACT_EMAIL before publishing to production.
 * This document is a practical template, not a substitute for legal advice.
 */
import type { LegalSection } from './privacyPolicyContent'

export const TERMS_OF_SERVICE_LAST_UPDATED = '26 April 2026'

export const TERMS_CONTACT_EMAIL = 'legal@profitprotector.app'

const intro: { title: string; paragraphs: string[] } = {
  title: 'Agreement to These Terms',
  paragraphs: [
    'These Terms of Service (“Terms”) are a contract between you (“you” or “your”) and the operator of Profit Protector (“we”, “us”, or “our”) governing your access to and use of the Profit Protector mobile application and related services (together, the “Service”). The Service helps small and medium businesses, including users in Zimbabwe, record sales, manage inventory, track customers, and use basic business tools. Features may be added or changed over time.',
    'By installing the App, creating an account, or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service. If you are using the Service on behalf of a business, you represent that you have authority to bind that business, and “you” includes that entity.',
  ],
}

export const TERMS_OF_SERVICE_SECTIONS: LegalSection[] = [
  {
    title: 'Acceptance of Terms',
    paragraphs: [
      'You must be at least the age of digital consent in your country (in Zimbabwe, you should be at least 18, or you must use the Service only with the involvement of a parent or guardian, as applicable) and have legal capacity to enter this agreement.',
      'Your use of the Service is also subject to our Privacy Policy, which describes how we handle personal and business data (including when we use service providers such as Supabase to host and process information). The Privacy Policy is incorporated by reference. Where the Privacy Policy and these Terms conflict on a specific point, these Terms will govern your contractual obligations, and the Privacy Policy will govern data practices.',
      'We may require you to accept updated Terms or additional terms for certain features (for example, beta programs). Your continued use after notice may constitute acceptance, except where the law requires a different process.',
    ],
  },
  {
    title: 'User Accounts and Security',
    paragraphs: [
      'You may create an account using a valid Zimbabwe-format mobile number and a password you choose, in line with the App’s current registration flow. For technical reasons, your sign-in identity with our authentication system may be represented using an email-style identifier generated from your phone number; you remain responsible for all activity on your account.',
      'You must provide accurate business and contact information and keep it up to date. You are responsible for safeguarding your password, device access, and any optional username you select. You must notify us promptly if you suspect unauthorized access. We are not liable for loss arising from your failure to protect your credentials, except where the law does not allow that exclusion.',
      'We may use reasonable security measures, rate limits, or identity checks to protect the Service and other users, including to reduce fraud, abuse, or account takeover.',
    ],
  },
  {
    title: 'Acceptable Use',
    paragraphs: [
      'You will use the Service only for lawful business purposes and in compliance with all applicable laws in Zimbabwe and, where relevant, the laws of any other place from which you access or use the Service.',
      'You are responsible for the business records you create (including product descriptions, prices, tax treatment as shown in the App, and customer details you store). The Service may display or export information you enter; you must ensure that use complies with your obligations to your customers, employees, and regulators, including any licensing or record-keeping rules that apply to your trade.',
      'The Service may support user-generated or user-entered content, such as notes, product names, business logos, or similar items you upload, and may allow simple interactions (for example, in-app features that reference your data or future collaboration tools). You retain your rights in content you own; for content you provide to the Service, you grant us a worldwide, non-exclusive, royalty-free licence to host, process, back up, display, and transmit that content as needed to run, secure, and improve the Service and to comply with the law. You are responsible for not uploading or storing material you do not have the right to use.',
    ],
  },
  {
    title: 'Prohibited Activities',
    paragraphs: [
      'You must not, and must not allow others to: (a) use the Service to break the law, defraud any person, or misrepresent the nature of a transaction; (b) attempt to access accounts, data, or systems you are not authorized to use; (c) reverse engineer, scrape, or probe the Service except to the extent permitted by applicable law; (d) introduce malware, overload infrastructure, or interfere with other users’ use; (e) resell, sublicense, or operate the Service as a service bureau for third parties without our written permission; (f) use the Service in any way that infringes third-party intellectual property, privacy, or publicity rights; or (g) send unsolicited bulk communications through or in connection with the Service.',
      'We may investigate suspected violations and cooperate with law enforcement. Breach of this section may result in immediate suspension or termination of your account, without prejudice to other remedies we may have.',
    ],
  },
  {
    title: 'Suspension and Termination',
    paragraphs: [
      'You may stop using the Service at any time. You may also request account deletion in accordance with the in-App process and our Privacy Policy, subject to our need to retain certain information where the law requires.',
      'We may suspend or terminate your access if you materially breach these Terms, if we are required to do so by law, if continuing would create serious security or legal risk, or if we decide to withdraw or replace the Service (where we will give reasonable notice if practicable).',
      'On termination, your right to use the Service ceases. We may delete or de-identify your data in line with the Privacy Policy and our retention practices. Provisions of these Terms that by their nature should survive (including disclaimers, limitations, and governing law) will remain in effect.',
    ],
  },
  {
    title: 'Disclaimers',
    paragraphs: [
      'The Service is provided on an “as is” and “as available” basis. To the maximum extent permitted by law, we disclaim all implied warranties, including any implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.',
      'We do not warrant that the Service will be error-free, uninterrupted, or free of harmful components, or that data will never be lost or corrupted. The Service is a tool to help you run your business; it does not constitute accounting, tax, legal, or professional advice. You should verify critical figures, comply with your statutory reporting obligations, and obtain professional advice as needed.',
      'Some jurisdictions do not allow certain disclaimers; in those cases, our warranties are limited to the fullest extent the law allows.',
    ],
  },
  {
    title: 'Limitation of Liability',
    paragraphs: [
      'To the maximum extent permitted by law, in no event will we, our affiliates, or our service providers be liable for any indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenue, data, or goodwill, arising out of or related to the Service, even if we have been advised of the possibility of such damages.',
      'To the maximum extent permitted by law, our total liability for all claims relating to the Service in any twelve-month period is limited to the greater of: (a) the amount you paid us for the Service in that period (if any; the Service may be offered without charge in certain cases), and (b) where no fees apply, a nominal amount in United States dollars (USD) that reflects a reasonable cap for a free consumer and small-business app—specifically, one hundred U.S. dollars (USD 100) or the equivalent in your local currency at the time of the claim, whichever framing applicable law makes enforceable. If your jurisdiction does not allow certain limitations, our liability is limited to the maximum permitted.',
      'Nothing in these Terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence where such limitation is prohibited, or for fraud or wilful misconduct.',
    ],
  },
  {
    title: 'Governing Law and Disputes (Zimbabwe)',
    paragraphs: [
      'These Terms are governed by the laws of the Republic of Zimbabwe, without regard to conflict-of-law rules that would require the application of another country’s laws.',
      'The courts of Zimbabwe have non-exclusive jurisdiction over disputes arising from or relating to these Terms or the Service, subject to any mandatory rights you may have as a consumer to bring proceedings in your home jurisdiction. For cross-border use, nothing in this section limits forum rules that the law of your place of residence requires to apply in your favour.',
    ],
  },
  {
    title: 'Changes to These Terms',
    paragraphs: [
      'We may modify these Terms from time to time. We will post the “Last updated” date in the App and, where a change is material, we will provide additional notice (for example, an in-App message or, where we have your email, an email) when reasonable and required by law or app store rules.',
      'If you do not agree to the revised Terms, you must stop using the Service. Continued use after the effective date of changes constitutes your acceptance, except where applicable law requires your explicit consent to specific changes (for example, certain new uses of data may be covered in the Privacy Policy).',
    ],
  },
  {
    title: 'Contact Information',
    paragraphs: [
      `For questions about these Terms, or to send legal notices related to the Service, contact: ${TERMS_CONTACT_EMAIL}.`,
      'Please include your business name, the phone number associated with your account (if applicable), and a clear description of your request. We may need to verify your identity before taking action on account-related matters.',
    ],
  },
]

export const TERMS_OF_SERVICE_INTRO = intro

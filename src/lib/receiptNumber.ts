import * as Crypto from 'expo-crypto'

const RECEIPT_CODE_PREFIX = 'RCP-'

/** Sales numbers per (letter pair) before rolling the digit run (0001–9999, then 0001 with next pair). */
const DIGITS_PER_BLOCK = 9_999
/** Two-letter block index runs AA…AZ, BA…BZ, … up to one step before the pair would repeat. */
const LETTER_PAIRS = 26 * 26
/** Last countIndex in the plain scheme (0001AA … 9999ZZ) is 6,759,323 = 9,999×676−1. */
const MAX_COUNT_IN_SEQUENCE = DIGITS_PER_BLOCK * LETTER_PAIRS - 1

/**
 * Full receipt id: RCP- + 6 body characters (4 decimal digits 0001–9999 + 2 letters A–Z).
 * Digits run 0001…9999; then 0001 with the next right-hand letter; after AZ, BA as described.
 * Index is 0 for the first sale, 1 for the second, etc. (count of prior sales in this business).
 */
export function formatShortReceipt6(countIndex: number): string {
  if (countIndex < 0) countIndex = 0
  if (countIndex > MAX_COUNT_IN_SEQUENCE) {
    return `${RECEIPT_CODE_PREFIX}${formatOverflow6()}`
  }
  const b = Math.floor(countIndex / DIGITS_PER_BLOCK)
  const d = 1 + (countIndex % DIGITS_PER_BLOCK)
  const dStr = String(d).padStart(4, '0')
  const l2 = b % 26
  const l1 = Math.floor(b / 26) % 26
  const body = dStr + String.fromCharCode(65 + l1) + String.fromCharCode(65 + l2)
  return `${RECEIPT_CODE_PREFIX}${body}`
}

/** 6 char body when the bounded sequence is exhausted; cryptographically unique. */
function formatOverflow6(): string {
  const u = Crypto.randomUUID().replace(/-/g, '').toUpperCase()
  return u.slice(0, 6)
}

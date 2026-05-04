const RECEIPT_CODE_PREFIX = 'RCP-'

/** Sales numbers per letter-block before rolling the digit run (001–999, then 001 with next letter suffix). */
const DIGITS_PER_BLOCK = 999

const DIGITS_BIG = BigInt(DIGITS_PER_BLOCK)
const BASE26 = 26n

/** First tier uses this many letters; after 001…999ZZZ the block gains another letter (001AAAA…) with the same odometer rules. */
const INITIAL_LETTER_COUNT = 3

/**
 * Full receipt id: RCP- + 3 decimal digits (001–999) + k letters A–Z (k starts at 3, then 4, 5, … as tiers fill).
 * Digits run 001…999; the rightmost letter advances fastest; then the digit run resets. When k letters are exhausted,
 * k increases by one and counting continues from 001 + k A’s.
 * Index is 0 for the first sale, 1 for the second, etc. (count of prior sales in this business).
 */
export function formatShortReceipt6(countIndex: number): string {
  let idx: bigint
  if (!Number.isFinite(countIndex) || countIndex < 0) {
    idx = 0n
  } else {
    idx = BigInt(Math.floor(countIndex))
  }

  let letterCount = INITIAL_LETTER_COUNT

  while (true) {
    let combinations = 1n
    for (let i = 0; i < letterCount; i++) {
      combinations *= BASE26
    }
    const tierSize = DIGITS_BIG * combinations
    if (idx < tierSize) break
    idx -= tierSize
    letterCount++
  }

  const b = idx / DIGITS_BIG
  const d = Number(idx % DIGITS_BIG) + 1
  const dStr = String(d).padStart(3, '0')

  let rest = b
  const letterChars: string[] = []
  for (let i = 0; i < letterCount; i++) {
    letterChars.push(String.fromCharCode(65 + Number(rest % BASE26)))
    rest /= BASE26
  }
  letterChars.reverse()

  return `${RECEIPT_CODE_PREFIX}${dStr}${letterChars.join('')}`
}

/**
 * Shopkeeper receipts append a distinct suffix (e.g. RCP-042AAB-FRONT) so counters stay unique per staff member.
 */
export function appendReceiptSuffix(baseReceipt: string, suffix: string): string {
  const s = suffix.trim().toUpperCase()
  if (!s) return baseReceipt
  return `${baseReceipt}-${s}`
}

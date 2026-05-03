import * as Crypto from 'expo-crypto'

export async function hashPasswordClient(password: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    password + 'pp_shopkeeper_salt_2025',
  )
}

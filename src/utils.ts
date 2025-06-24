/**
 * Validates if a string is a valid Ethereum address
 * @param address - the address to check
 * @returns true if it's a valid Ethereum address
 */
export const isEthereumAddress = (address: string | undefined): boolean => {
  if (address && address.match(/^0x[a-fA-F0-9]{40}$/) !== null) return true
  return false
}

export const getRandomBigInt = (bits = 128): bigint => {
  const bytes = Math.ceil(bits / 8)
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)

  let result = 0n
  for (const byte of array) {
    result = (result << 8n) | BigInt(byte)
  }

  return result
}

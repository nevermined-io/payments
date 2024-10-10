export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const isEthereumAddress = (address: string | undefined): boolean => {
  if (address && address.match(/^0x[a-fA-F0-9]{40}$/) !== null)
    return true
  return false
}

export const jsonReplacer = (_key: any, value: { toString: () => any }) => {
  return typeof value === 'bigint' ? value.toString() : value
}
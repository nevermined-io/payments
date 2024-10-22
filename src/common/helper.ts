export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const jsonReplacer = (_key: any, value: { toString: () => any }) => {
  return typeof value === 'bigint' ? value.toString() : value
}

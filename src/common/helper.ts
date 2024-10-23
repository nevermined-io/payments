import { Endpoint } from '../payments'

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const jsonReplacer = (_key: any, value: { toString: () => any }) => {
  return typeof value === 'bigint' ? value.toString() : value
}

export const getServiceHostFromEndpoints = (endpoints: Endpoint[]): string => {
  let serviceHost = ''
  endpoints.some((endpoint) => {
    const _endpoint = Object.values(endpoint)[0]
    serviceHost = new URL(_endpoint).origin
  })
  return serviceHost
}

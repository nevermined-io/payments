import { Payments } from '../../src/payments.js'
import type { EnvironmentName } from '../../src/environments.js'

export const TEST_ENVIRONMENT: EnvironmentName = (process.env.TEST_ENVIRONMENT as EnvironmentName) || 'staging_sandbox'
export const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

export const SUBSCRIBER_API_KEY =
  process.env.TEST_SUBSCRIBER_API_KEY ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDcxZTZGN2Y4QzY4ZTdlMkU5NkIzYzkwNjU1YzJEMmNBMzc2QmMzZmQiLCJqdGkiOiIweDMwN2Y0NWRkMTBiOTc1YjhlNDU5NzNkMmNiNTljY2MzZDQ2NjFmY2RiOTJiMTVmMjI2ZDNhY2Q0NjdkODYyMDUiLCJleHAiOjE3OTY5MzM3MjcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.0khtYy6bG_m6mDE2Oa1sozQLBHve2yVwyUeeM9DAHzFxhwK86JSfGL973Sg8FzhTfD2xhzYWiFP3KV2GjWNnDRs'
export const BUILDER_API_KEY =
  process.env.TEST_BUILDER_API_KEY ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDlkREQwMkQ0RTExMWFiNWNFNDc1MTE5ODdCMjUwMGZjQjU2MjUyYzYiLCJqdGkiOiIweDQ2YzY3OTk5MTY5NDBhZmI4ZGNmNmQ2NmRmZmY4MGE0YmVhYWMyY2NiYWZlOTlkOGEwOTAwYTBjMzhmZjdkNjEiLCJleHAiOjE3OTU1NDI4NzAsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.n51gkto9Jw-MXxnXW92XDAB_CnHUFxkritWp9Lj1qFASmtf_TuQwU57bauIEGrQygumX8S3pXqRqeGRWT2AJiRs'

// Factory functions
export function createPaymentsSubscriber() {
  return Payments.getInstance({
    nvmApiKey: SUBSCRIBER_API_KEY,
    environment: TEST_ENVIRONMENT,
  })
}

export function createPaymentsBuilder() {
  return Payments.getInstance({
    nvmApiKey: BUILDER_API_KEY,
    environment: TEST_ENVIRONMENT,
  })
}

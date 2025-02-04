import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Account } from '../../src/accounts/account'
import { EnvironmentName } from '../../src/environments'
describe('Session Key E2E Test', () => {
  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'local'

  it('should create and use a session key', async () => {

    const agentSessionPrivateKey = generatePrivateKey()
    const agentSessionKeySigner = privateKeyToAccount(agentSessionPrivateKey)
    const accountObject = Account.getInstance({
      environment: testingEnvironment as EnvironmentName,
    })
    console.log('Agent session key signer address:', agentSessionKeySigner.address)
    const nvmApiKey = await accountObject.createNvmApiKey(agentSessionKeySigner)
    console.log('NVM API Key:', nvmApiKey)
  })
  // it('should create and use a session key', async () => {
  //   const agentSessionPrivateKey = generatePrivateKey()
  //   console.log('Agent session private key:', agentSessionPrivateKey)
  //   const agentSessionKeySigner = privateKeyToAccount(agentSessionPrivateKey)
  //   console.log('Agent session key signer address:', agentSessionKeySigner.address)
  //   // Create a session key
  //   const sessionKey = await createSessionKey(agentSessionKeySigner.address)
  //   console.log('Session key:', sessionKey)
  //   expect(sessionKey).toBeDefined()

  //   // Use the session key
  //   const result = await useSessionKey(sessionKey, agentSessionKeySigner)
  //   console.log('Session Key address:', result.account.address)
  //   expect(result).toBeDefined() // Adjust the expectation based on the actual return value of useSessionKey
  // })
})

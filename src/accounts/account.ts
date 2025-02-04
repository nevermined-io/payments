import { createKernelClient, Nevermined, NvmAccount, NvmApiKey, NvmApp, NVMAppEnvironments } from '@nevermined-io/sdk'
import { EnvironmentInfo, EnvironmentName, Environments } from '../environments'

// const entryPoint = getEntryPoint('0.6')
// const publicClient = createPublicClient({
//   transport: http(),
//   chain: arbitrumSepolia,
// })

// export const createSessionKey = async (sessionKeyAddress: Address) => {
//   const signer = privateKeyToAccount(process.env.PRIVATE_KEY as Hex)
//   console.log('Signer address:', signer.address)
//   const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
//     entryPoint,
//     signer,
//     kernelVersion: KERNEL_V2_4,
//   })

//   const masterAccount = await createKernelAccount(publicClient, {
//     entryPoint,
//     plugins: {
//       sudo: ecdsaValidator,
//     },
//     kernelVersion: KERNEL_V2_4,
//   })
//   console.log('Account address:', sessionKeyAddress, 'Master account:', masterAccount.address)

//   // Create an "empty account" as the signer -- you only need the public
//   // key (address) to do this.
//   const emptySessionKeySigner = addressToEmptyAccount(sessionKeyAddress)

//   const sessionKeyValidator = await signerToSessionKeyValidator(publicClient, {
//     entryPoint,
//     signer: emptySessionKeySigner,
//     validatorData: {
//       paymaster: oneAddress,
//       permissions: [],
//     },
//     kernelVersion: KERNEL_V2_4,
//   })

//   const sessionKeyAccount = await createKernelAccount(publicClient, {
//     entryPoint,
//     plugins: {
//       sudo: ecdsaValidator,
//       regular: sessionKeyValidator,
//     },
//     kernelVersion: KERNEL_V2_4,
//   })

//   console.log('Session key account:', sessionKeyAccount.address)

//   return await serializeSessionKeyAccount(sessionKeyAccount)
// }

// export const useSessionKey = async (serializedSessionKey: string, sessionKeySigner: any) => {
//   const sessionKeyAccount = await deserializeSessionKeyAccount(
//     publicClient,
//     entryPoint,
//     KERNEL_V2_4,
//     serializedSessionKey,
//     sessionKeySigner,
//   )

//   const kernelPaymaster = createZeroDevPaymasterClient({
//     chain: arbitrumSepolia,
//     transport: http(process.env.PAYMASTER_RPC),
//   })
//   const kernelClient = createKernelAccountClient({
//     account: sessionKeyAccount,
//     chain: arbitrumSepolia,
//     bundlerTransport: http(process.env.BUNDLER_RPC),
//     paymaster: {
//       getPaymasterData(userOperation) {
//         return kernelPaymaster.sponsorUserOperation({ userOperation })
//       },
//     },
//   })

//   return kernelClient
// }

export interface AccountOptions {
  /**
   * The Nevermined environment to connect to.
   * If you are developing an agent it's recommended to use the "testing" environment.
   * When deploying to production use the "arbitrum" environment.
   */
  environment: EnvironmentName
}

export class Account {
  public environment: EnvironmentInfo
  public nvmApp: NvmApp

  public static getInstance(signer: NvmAccount, options: AccountOptions): Account {
    return new Account(options)
  }

  /**
   * Initialize the payments class.
   *
   * @param options - The options to initialize the payments class.
   *
   * @returns An instance of {@link Payments}
   */
  private constructor(options: AccountOptions) {
    this.environment = Environments[options.environment]
    this.initializaSdk()
  }

  async initializaSdk() {
    this.nvmApp = await NvmApp.getInstance(NVMAppEnvironments.Staging)
    this.nvmApp.connect()
  }

  public async createNvmApiKey(account: any) {
    const body = { address: account.address }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        // Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/api-keys/create', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    const sessionKey = await response.json()

    const credential = await this.nvmApp.sdk.utils.jwt.generateClientAssertion(account, 'Sign message to login')
    const marketplaceAuthToken = await this.nvmApp.sdk.services.marketplace.login(credential)

    
    const kernelClient = await createKernelClient(account, 421614, 'db7bb0f6-7640-4199-8cfe-46c7f74861b4')
    const issuerAccount = await NvmAccount.fromZeroDevSigner(kernelClient)
    const nodeInfo = await this.nvmApp.sdk.services.node.getNeverminedNodeInfo()
    const nvmApiKeyEncrypted = await NvmApiKey.generate(
      this.nvmApp.sdk.utils.signature,
      issuerAccount,
      sessionKey,
      marketplaceAuthToken,
      nodeInfo['provider-address'] as string,
      nodeInfo['ecdsa-public-key'] as string,
    )
    return nvmApiKeyEncrypted

  }
}

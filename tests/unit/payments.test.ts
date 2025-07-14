import { isEthereumAddress } from "../../src/utils"
import { Payments } from "../../src/payments"
import { getServiceHostFromEndpoints } from "../../src/common/helper"
import { Endpoint } from "../../src/common/types"

describe('Payments (unit)', () => {

  const nvmApiKeyHash = process.env.TEST_PROXY_BEARER_TOKEN || 'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweGUyNjQ4MTNjOGZmY2NkMjBmNTMyNDZhYWI2YzMxMTEyZWYyZjQyMGM3YjYxNzU1NjUyOGM3ZWMwNzc3NGVmOTAiLCJleHAiOjE3NTg4MTYwNzQsImlhdCI6MTcyNzI1ODQ3NX0.Wa64furZZZpuKBva3nlAyfblU5CHCMEhz7jyEBkVow8QVuwcwznN-7eXrdfy_5E4W3xVxLXToZmFENd6cmRz1Bw'


  describe('Unit test: Payments', () => {  

    it('can initialize correctly', () => {
      const payments = Payments.getInstance({ 
        nvmApiKey: nvmApiKeyHash,
        environment: 'staging_testnet'
      })
      expect(payments).toBeDefined()
      expect(payments.plans).toBeDefined()
    })


    it('can validate if is a Ethereum Address', () => {      
      expect(isEthereumAddress('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d')).toBeTruthy()
      expect(isEthereumAddress('0x75faf114eafb1BDbe2F0316DF893fd58CE46')).toBeFalsy()
      expect(isEthereumAddress(undefined)).toBeFalsy()
    })

    it('can get the service host from Endpoints[]', () => {    
      const endpoints: Endpoint[] = [
       { 'POST': `https://one-backend.testing.nevermined.app/api/v1/agents/:agentId/tasks` },
       { 'GET': `https://one-backend.testing.nevermined.app/api/v1/agents/:agentId/tasks/invoke` }
      ]  
      const serviceHost = getServiceHostFromEndpoints(endpoints)
      expect(serviceHost).toEqual('https://one-backend.testing.nevermined.app')
    })
  })
  
})

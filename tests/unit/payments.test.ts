import { isEthereumAddress } from "../../src/utils"
import { PaymentsError } from "../../src/common/payments.error"

import { Payments } from "../../src/payments"

describe('Payments (unit)', () => {

  const nvmApiKeyHash = process.env.TEST_PROXY_BEARER_TOKEN || 'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweGUyNjQ4MTNjOGZmY2NkMjBmNTMyNDZhYWI2YzMxMTEyZWYyZjQyMGM3YjYxNzU1NjUyOGM3ZWMwNzc3NGVmOTAiLCJleHAiOjE3NTg4MTYwNzQsImlhdCI6MTcyNzI1ODQ3NX0.Wa64furZZZpuKBva3nlAyfblU5CHCMEhz7jyEBkVow8QVuwcwznN-7eXrdfy_5E4W3xVxLXToZmFENd6cmRz1Bw'


  describe('Unit test: Payments', () => {  

    it('can initialize correctly', () => {
      const payments = Payments.getInstance({ 
        nvmApiKey: nvmApiKeyHash,
        environment: 'staging'
      })
      expect(payments).toBeDefined()
      expect(payments.query).toBeDefined()
    })

    it('doesnt initialize if there is no api key', () => {      
      expect(() => 
        Payments.getInstance({ environment: 'staging'})
      ).toThrow(PaymentsError)
    })


    it('can validate if is a Ethereum Address', () => {      
      expect(isEthereumAddress('0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d')).toBeTruthy()
      expect(isEthereumAddress('0x75faf114eafb1BDbe2F0316DF893fd58CE46')).toBeFalsy()
      expect(isEthereumAddress(undefined)).toBeFalsy()
    })

  })
  
})

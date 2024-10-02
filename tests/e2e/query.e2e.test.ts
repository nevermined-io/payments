import { AIQueryApi } from "../../src/api/query-api"

describe('Query API (e2e)', () => {

  const backendHost = process.env.TEST_BASE_URL || 'http://localhost:3001'
  const webSocketHost = process.env.TEST_WS_SERVER || 'ws://localhost:3001'
  const proxyHost = process.env.TEST_PROXY_URL
  const nvmApiKeyHash = process.env.TEST_PROXY_BEARER_TOKEN || 'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweGUyNjQ4MTNjOGZmY2NkMjBmNTMyNDZhYWI2YzMxMTEyZWYyZjQyMGM3YjYxNzU1NjUyOGM3ZWMwNzc3NGVmOTAiLCJleHAiOjE3NTg4MTYwNzQsImlhdCI6MTcyNzI1ODQ3NX0.Wa64furZZZpuKBva3nlAyfblU5CHCMEhz7jyEBkVow8QVuwcwznN-7eXrdfy_5E4W3xVxLXToZmFENd6cmRz1Bw'

  describe('AIQueryApi', () => {
    let api: AIQueryApi
    const opts = {       
      backendHost, 
      proxyHost, 
      bearerToken: nvmApiKeyHash, 
      webSocketHost, 
      webSocket: { bearerToken: nvmApiKeyHash } 
    }
    const SLEEP_DURATION = 30_000

    beforeEach(async () => {
      api = new AIQueryApi(opts)
    })
  
  
    it('api is defined', () => {
      expect(api).toBeDefined()  
    })

    it.skip('can subscribe', async () => {
      console.log('TEST:: Subscribing to the server')
      await api.subscribe(eventsReceived)
      console.log('TEST:: Subscribed to the server')
      await sleep(SLEEP_DURATION)
      api.disconnect()
      console.log('TEST:: Disconnected from the server')
    }, SLEEP_DURATION *2)

  })
  
})

const eventsReceived = (data: any) => {
  console.log('Event received', data)
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

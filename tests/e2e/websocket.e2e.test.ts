import { EnvironmentName } from "../../src/environments"
import { Payments } from "../../src/payments"

describe.skip('Websocket (e2e)', () => {

  const subscriberNvmApiKeyHash = process.env.TEST_SUBSCRIBER_API_KEY || 'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweGMyMWVjM2IyZmRlN2IwODYwOWMyN2I1MWM5ODcwMjNjZmY2ODBlMDhiYWJlY2IzY2FkNTQ1YTVjYjg1OTYwZjgiLCJleHAiOjE3NTk1MDgxNjQsImlhdCI6MTcyNzk1MDU2NX0.EuZA8pZehudk_IXd8hKewBUiPzE5xNAIVkPm5o9Y40J27F9Y6AF54halHXn_ywjwzUHZqEWI5rDqCHYBxhLLnRs'
  
  const testingEnvironment = process.env.TEST_ENVIRONMENT || 'staging'
  const SLEEP_DURATION = 3_000

  let paymentsSubscriber: Payments

  describe('Websocket', () => {

    it('can initialize correctly', () => {
      paymentsSubscriber = Payments.getInstance({ 
        nvmApiKey: subscriberNvmApiKeyHash,
        environment: testingEnvironment as EnvironmentName,        
      })
      expect(paymentsSubscriber).toBeDefined()
      expect(paymentsSubscriber.query).toBeDefined()

    })

    it('can subscribe', async () => {
      console.log('TEST:: Subscribing to the server')
      
      await paymentsSubscriber.query.subscribe(eventsReceived)
      console.log('TEST:: Subscribed to the server')
      // await sleep(SLEEP_DURATION)
      
      console.log('TEST:: Disconnected from the server')
    }, SLEEP_DURATION * 3)

    it('can logout', () => {
      paymentsSubscriber.logout()
      expect(paymentsSubscriber.isLoggedIn).toBeFalsy()
      expect(paymentsSubscriber.query.isWebSocketConnected()).toBeFalsy()
    })

  })
  
})

const eventsReceived = (data: any) => {
  console.log('Event received', data)
}
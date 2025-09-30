import { randomUUID } from 'crypto'
import { OrganizationMemberRole } from '../../src/common/types'
import { Payments } from '../../src/payments'

describe('Organizations Integration Test', () => {
  const organizationAdminApiKey =
    'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweGUwODY2NDBmQjcwM0NlMGQyNmZlODI0QTM2YTcyOTVjQjFFNzc2NmQiLCJqdGkiOiIweGU3ZGQ4M2Y3MmFlMGU0NWNkYjViYTgyMzllZDNmNDE1ZGYwYWE3ZWNiNDAwMWRlZjJjYWZmYzM3OTgxNWNjMWEiLCJleHAiOjE3OTA3Nzk5NzAsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.sSDgvyJ79PS2zlXUFKVPRAxMDYAp4uxnDV15cXjXGY9eCc6TxdBFLxElW9JVCqDqf7DQs-MyKSug8tVVa0OsnBs'
  let payments: Payments

  beforeAll(() => {
    payments = Payments.getInstance({
      nvmApiKey: organizationAdminApiKey,
      environment: 'staging_sandbox',
    })
  })

  it('should create a user', async () => {
    const user = await payments.organizations.createUser(
      randomUUID().toString(),
      `${randomUUID().toString()}@example.com`,
      OrganizationMemberRole.Client,
    )
    console.log(user)
    expect(user).toBeDefined()
  })
})

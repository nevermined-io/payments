/**
 * Mock Payments SDK for testing
 */

export interface MockPlan {
  did: string
  name: string
  planType: string
  createdAt: string
}

export interface MockPlanBalance {
  planId: string
  planName: string
  planType: string
  holderAddress: string
  balance: bigint
  creditsContract: string
  isSubscriber: boolean
  pricePerCredit: number
}

export interface MockAgent {
  did: string
  name: string
  planDid: string
  createdAt: string
}

export interface MockX402Token {
  accessToken: string
}

export class MockPlansAPI {
  private plans: MockPlan[] = [
    {
      did: 'did:nvm:test-plan-1',
      name: 'Test Plan 1',
      planType: 'credits',
      createdAt: '2026-01-31T00:00:00Z',
    },
    {
      did: 'did:nvm:test-plan-2',
      name: 'Test Plan 2',
      planType: 'time',
      createdAt: '2026-01-30T00:00:00Z',
    },
  ]

  async getPlans() {
    return { data: this.plans }
  }

  async getPlan(planId: string) {
    const plan = this.plans.find((p) => p.did === planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }
    return plan
  }

  async getPlanBalance(planId: string, _accountAddress?: string): Promise<MockPlanBalance> {
    const plan = this.plans.find((p) => p.did === planId)
    if (!plan) {
      throw new Error(`Plan ${planId} not found`)
    }

    return {
      planId: plan.did,
      planName: plan.name,
      planType: plan.planType,
      holderAddress: '0x1234567890123456789012345678901234567890',
      balance: BigInt(1000),
      creditsContract: '0x0987654321098765432109876543210987654321',
      isSubscriber: true,
      pricePerCredit: 0.01,
    }
  }
}

export class MockAgentsAPI {
  private agents: MockAgent[] = [
    {
      did: 'did:nvm:test-agent-1',
      name: 'Test Agent 1',
      planDid: 'did:nvm:test-plan-1',
      createdAt: '2026-01-31T00:00:00Z',
    },
  ]

  async getAgent(agentId: string) {
    const agent = this.agents.find((a) => a.did === agentId)
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }
    return agent
  }
}

export class MockX402TokenAPI {
  async getX402AccessToken(planId: string): Promise<MockX402Token> {
    return {
      accessToken: `mock-token-for-${planId}`,
    }
  }
}

export class MockPayments {
  plans = new MockPlansAPI()
  agents = new MockAgentsAPI()
  x402 = new MockX402TokenAPI()

  static getInstance() {
    return new MockPayments()
  }
}

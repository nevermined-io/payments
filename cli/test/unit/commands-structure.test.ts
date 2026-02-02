/**
 * Structural tests for CLI commands
 * Tests command structure, flags, and help text without requiring API calls
 */

import { expect, test, describe } from '@jest/globals'
import ConfigInit from '../../src/commands/config/init.js'
import ConfigShow from '../../src/commands/config/show.js'
import ConfigSet from '../../src/commands/config/set.js'
import PlansList from '../../src/commands/plans/list.js'
import PlansGet from '../../src/commands/plans/get.js'
import PlansBalance from '../../src/commands/plans/balance.js'
import AgentsGet from '../../src/commands/agents/get.js'
import X402GetToken from '../../src/commands/x402/get-token.js'

describe('Command Structure Tests', () => {
  describe('Config Commands', () => {
    test('ConfigInit has correct description', () => {
      expect(ConfigInit.description).toBe('Initialize CLI configuration')
    })

    test('ConfigInit has correct flags', () => {
      expect(ConfigInit.flags).toHaveProperty('api-key')
      expect(ConfigInit.flags).toHaveProperty('environment')
      expect(ConfigInit.flags).toHaveProperty('interactive')
    })

    test('ConfigShow has correct description', () => {
      expect(ConfigShow.description).toBe('Display current configuration')
    })

    test('ConfigSet has correct args', () => {
      expect(ConfigSet.args).toHaveProperty('key')
      expect(ConfigSet.args).toHaveProperty('value')
    })
  })

  describe('Plans Commands', () => {
    test('PlansList has correct description', () => {
      expect(PlansList.description).toBe('List all payment plans')
    })

    test('PlansGet has correct args', () => {
      expect(PlansGet.args).toHaveProperty('planId')
    })

    test('PlansBalance has correct args and flags', () => {
      expect(PlansBalance.args).toHaveProperty('planId')
      expect(PlansBalance.flags).toHaveProperty('account')
    })
  })

  describe('Agents Commands', () => {
    test('AgentsGet has correct args', () => {
      expect(AgentsGet.args).toHaveProperty('agentId')
    })
  })

  describe('X402 Commands', () => {
    test('X402GetToken has correct args', () => {
      expect(X402GetToken.args).toHaveProperty('planId')
    })

    test('X402GetToken has correct description', () => {
      expect(X402GetToken.description).toBe('Get an X402 access token for a plan')
    })
  })

  describe('Base Flags', () => {
    test('All commands have baseFlags', () => {
      const commands = [
        ConfigInit,
        ConfigShow,
        ConfigSet,
        PlansList,
        PlansGet,
        PlansBalance,
        AgentsGet,
        X402GetToken,
      ]

      commands.forEach((Command) => {
        expect(Command.flags).toHaveProperty('profile')
        expect(Command.flags).toHaveProperty('format')
        expect(Command.flags).toHaveProperty('verbose')
      })
    })
  })
})

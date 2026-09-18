/**
 * Structural tests for CLI commands
 * Tests command structure, flags, and help text without requiring API calls
 */

import { expect, test, describe } from '@jest/globals'
import ConfigInit from '../../src/commands/config/init.js'
import ConfigShow from '../../src/commands/config/show.js'
import ConfigSet from '../../src/commands/config/set.js'
// The plans/agents/x402 commands are GENERATED (verb-prefixed files); the
// hand-written `plans/list.js`-style modules this file used to import were
// removed in the rename and are the reason it sat in the ignore list (#446).
import PlansList from '../../src/commands/plans/get-plans.js'
import PlansGet from '../../src/commands/plans/get-plan.js'
import PlansBalance from '../../src/commands/plans/get-plan-balance.js'
import AgentsGet from '../../src/commands/agents/get-agent.js'
import X402GetToken from '../../src/commands/x402token/get-x402-access-token.js'

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
    // Descriptions on generated commands come from the generator, so the exact
    // prose is not this test's to pin — presence is the structural property.
    test('PlansList has a description', () => {
      expect(typeof PlansList.description).toBe('string')
      expect(PlansList.description.length).toBeGreaterThan(0)
    })

    test('PlansGet has correct args', () => {
      expect(PlansGet.args).toHaveProperty('plan')
    })

    test('PlansBalance has correct args and flags', () => {
      expect(PlansBalance.args).toHaveProperty('plan')
      expect(PlansBalance.flags).toHaveProperty('account-address')
    })
  })

  describe('Agents Commands', () => {
    test('AgentsGet has correct args', () => {
      expect(AgentsGet.args).toHaveProperty('agent')
    })
  })

  describe('X402 Commands', () => {
    test('X402GetToken has correct args', () => {
      expect(X402GetToken.args).toHaveProperty('plan')
    })

    test('X402GetToken has a description', () => {
      expect(typeof X402GetToken.description).toBe('string')
      expect(X402GetToken.description).toMatch(/X402 access token/)
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

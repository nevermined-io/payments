#!/usr/bin/env node

/**
 * CLI Sync Check - Verifies CLI commands match SDK API
 * Used in CI to ensure CLI is up-to-date with SDK changes
 */

import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { APIScanner } from './api-scanner.js'
import { MANUALLY_MAINTAINED_COMMANDS } from './manually-maintained.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface SyncIssue {
  type: 'missing' | 'extra' | 'outdated'
  message: string
}

/**
 * Convert camelCase to kebab-case (same logic as command generator)
 */
function camelToKebab(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')  // Handle consecutive capitals: ERC20Config -> ERC20-Config
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')     // Handle camelCase: myVariable -> my-Variable
    .toLowerCase()
}

async function getCommandFiles(dir: string, topic: string): Promise<Set<string>> {
  const commands = new Set<string>()
  const topicDir = join(dir, 'src', 'commands', topic)

  if (!existsSync(topicDir)) {
    return commands
  }

  const files = await readdir(topicDir)

  for (const file of files) {
    if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      // Just remove the .ts extension - we'll compare kebab-case to kebab-case
      const kebabName = file.replace('.ts', '')
      commands.add(kebabName)
    }
  }

  return commands
}

async function main() {
  console.log('🔍 CLI Sync Check - Verifying CLI matches SDK API')
  console.log('=' .repeat(60))

  const cliRoot = resolve(__dirname, '../..')
  const sdkRoot = resolve(cliRoot, '..')

  console.log(`\n📁 SDK Path: ${sdkRoot}`)
  console.log(`📁 CLI Path: ${cliRoot}`)

  // Scan SDK API
  console.log('\n📊 Scanning SDK API...')
  const scanner = new APIScanner(sdkRoot)

  let apis
  try {
    apis = scanner.scanAPIs()
    console.log(`✅ Found ${apis.length} API classes`)
  } catch (error) {
    console.error('❌ Failed to scan SDK API:', error)
    process.exit(1)
  }

  // Check each API
  const issues: SyncIssue[] = []

  for (const api of apis) {
    const topic = api.name.replace('API', '').toLowerCase()
    console.log(`\n🔎 Checking ${topic}...`)

    // Get existing command files (kebab-case names)
    const existingCommands = await getCommandFiles(cliRoot, topic)

    // Get expected commands from API (convert to kebab-case)
    const expectedCommands = new Map(
      api.methods.map(m => [camelToKebab(m.name), m.name])
    )

    // Check for missing commands
    for (const [kebabName, methodName] of expectedCommands) {
      if (!existingCommands.has(kebabName)) {
        const message = `Missing command: ${topic} ${methodName}`
        console.log(`   ❌ ${message}`)
        issues.push({ type: 'missing', message })
      } else {
        console.log(`   ✅ ${methodName}`)
      }
    }

    // Check for extra commands (removed from SDK), skipping manually-maintained ones
    for (const commandName of existingCommands) {
      if (expectedCommands.has(commandName)) {
        continue
      }
      if (MANUALLY_MAINTAINED_COMMANDS.has(`${topic}/${commandName}`)) {
        console.log(`   ✓ ${commandName} (manually maintained)`)
        continue
      }
      const message = `Extra command (not in SDK): ${topic} ${commandName}`
      console.log(`   ⚠️  ${message}`)
      issues.push({ type: 'extra', message })
    }
  }

  // Report results
  console.log('\n' + '='.repeat(60))

  if (issues.length === 0) {
    console.log('✅ CLI is in sync with SDK API')
    console.log(`   All ${apis.reduce((sum, api) => sum + api.methods.length, 0)} commands match`)
    process.exit(0)
  } else {
    console.log(`❌ CLI is OUT OF SYNC with SDK API`)
    console.log(`   Found ${issues.length} issues:`)

    const missingCount = issues.filter(i => i.type === 'missing').length
    const extraCount = issues.filter(i => i.type === 'extra').length

    if (missingCount > 0) {
      console.log(`   - ${missingCount} missing commands`)
    }
    if (extraCount > 0) {
      console.log(`   - ${extraCount} extra commands`)
    }

    console.log('\n💡 To fix:')
    console.log('   Run: pnpm cli:generate')
    console.log('   Then: pnpm build:manifest')

    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

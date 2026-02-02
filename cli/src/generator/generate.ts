#!/usr/bin/env node

/**
 * Main command generation script
 * Scans the Payments SDK API and generates oclif commands
 */

import { resolve, join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { APIScanner } from './api-scanner.js'
import { CommandGenerator } from './command-generator.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  console.log('🔍 Nevermined Payments CLI - Command Generator')
  console.log('=' .repeat(60))

  // Paths
  const cliRoot = resolve(__dirname, '../..')
  const sdkRoot = resolve(cliRoot, '..')
  const outputDir = resolve(cliRoot, 'src')

  console.log(`\n📁 SDK Path: ${sdkRoot}`)
  console.log(`📁 Output Path: ${outputDir}`)

  // Step 1: Scan the API
  console.log('\n📊 Step 1: Scanning Payments SDK API...')
  const scanner = new APIScanner(sdkRoot)

  let apis
  try {
    apis = scanner.scanAPIs()
    console.log(`✅ Found ${apis.length} API classes`)

    // Show summary
    for (const api of apis) {
      console.log(`   - ${api.name}: ${api.methods.length} methods`)
    }
  } catch (error) {
    console.error('❌ Failed to scan API:', error)
    process.exit(1)
  }

  // Step 2: Generate commands
  console.log('\n🔨 Step 2: Generating commands...')
  const generator = new CommandGenerator(
    outputDir,
    join(outputDir, 'generator-metadata.json')
  )

  try {
    await generator.generateCommands(apis)
    console.log('✅ Commands generated successfully')
  } catch (error) {
    console.error('❌ Failed to generate commands:', error)
    process.exit(1)
  }

  // Step 3: Summary
  console.log('\n📈 Summary:')
  let totalMethods = 0
  for (const api of apis) {
    totalMethods += api.methods.length
  }

  console.log(`   Total API classes: ${apis.length}`)
  console.log(`   Total methods: ${totalMethods}`)
  console.log(`   Total commands: ${totalMethods}`)

  // Step 4: Next steps
  console.log('\n✨ Next steps:')
  console.log('   1. Review generated commands in src/commands/')
  console.log('   2. Run: yarn build:manifest')
  console.log('   3. Test commands: nvm <topic> <command> --help')
  console.log('   4. Run tests: yarn test')

  console.log('\n🎉 Done!\n')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

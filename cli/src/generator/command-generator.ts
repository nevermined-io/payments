/**
 * Command Generator - Generates oclif command files from API scanner output
 * Uses manual commands as templates and generates new commands from SDK API
 */

import { writeFile, mkdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'
import { MethodInfo, APIClassInfo } from './api-scanner.js'

export interface CommandMetadata {
  className: string
  methodName: string
  customizations?: {
    flags?: Record<string, any>
    examples?: string[]
    beforeInit?: string
    afterInit?: string
  }
}

export class CommandGenerator {
  private outputDir: string
  private metadataPath: string
  private metadata: Map<string, CommandMetadata>

  constructor(outputDir: string, metadataPath?: string) {
    this.outputDir = outputDir
    this.metadataPath = metadataPath || join(outputDir, 'generator-metadata.json')
    this.metadata = new Map()
  }

  /**
   * Load metadata about custom command modifications
   */
  async loadMetadata(): Promise<void> {
    if (!existsSync(this.metadataPath)) {
      return
    }

    try {
      const content = await readFile(this.metadataPath, 'utf-8')
      const data = JSON.parse(content)

      for (const key in data) {
        this.metadata.set(key, data[key])
      }
    } catch (error) {
      console.warn(`Failed to load metadata: ${error}`)
    }
  }

  /**
   * Save metadata about custom command modifications
   */
  async saveMetadata(): Promise<void> {
    const data: Record<string, CommandMetadata> = {}

    for (const [key, value] of this.metadata.entries()) {
      data[key] = value
    }

    await mkdir(dirname(this.metadataPath), { recursive: true })
    await writeFile(this.metadataPath, JSON.stringify(data, null, 2))
  }

  /**
   * Generate all commands from API classes
   */
  async generateCommands(apis: APIClassInfo[]): Promise<void> {
    await this.loadMetadata()

    for (const api of apis) {
      for (const method of api.methods) {
        await this.generateCommand(api, method)
      }
    }

    await this.saveMetadata()
  }

  /**
   * Generate a single command file
   */
  private async generateCommand(api: APIClassInfo, method: MethodInfo): Promise<void> {
    const commandPath = this.getCommandPath(api.name, method.name)
    const metadataKey = `${api.name}.${method.name}`

    // Check if command already exists and has customizations
    const existingMetadata = this.metadata.get(metadataKey)

    const commandContent = this.generateCommandContent(api, method, existingMetadata)

    await mkdir(dirname(commandPath), { recursive: true })
    await writeFile(commandPath, commandContent)

    console.log(`Generated: ${commandPath}`)
  }

  /**
   * Get the file path for a command
   */
  private getCommandPath(className: string, methodName: string): string {
    // Convert PlansAPI -> plans, AgentsAPI -> agents
    const topic = className.replace('API', '').toLowerCase()

    // Convert camelCase method name to kebab-case
    const commandName = this.camelToKebab(methodName)

    return join(this.outputDir, 'commands', topic, `${commandName}.ts`)
  }

  /**
   * Generate the TypeScript content for a command
   */
  private generateCommandContent(
    api: APIClassInfo,
    method: MethodInfo,
    metadata?: CommandMetadata
  ): string {
    const className = this.getCommandClassName(method.name)
    const topic = api.name.replace('API', '').toLowerCase()
    const apiProperty = this.getAPIProperty(api.name)

    const hasArgs = this.hasPositionalArgs(method)
    const flags = this.generateFlags(method, metadata?.customizations?.flags)
    const examples = this.generateExamples(method, metadata?.customizations?.examples, topic)
    const runMethod = this.generateRunMethod(method, apiProperty, metadata, hasArgs)

    const imports = hasArgs ? 'import { Args, Flags } from \'@oclif/core\'' : 'import { Flags } from \'@oclif/core\''

    return `${imports}
import { BaseCommand } from '../../base-command.js'

/**
 * ${method.description || `${method.name} command`}
 */
export default class ${className} extends BaseCommand {
  static override description = ${JSON.stringify(method.description || `${api.name} ${method.name}`)}

  static override examples = [
${examples}
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
${flags}
  }

${this.generateArgs(method)}

  public async run(): Promise<void> {
${runMethod}
  }
}
`
  }

  /**
   * Generate flag definitions from method parameters
   */
  private generateFlags(method: MethodInfo, customFlags?: Record<string, any>): string {
    const flags: string[] = []

    for (const param of method.parameters) {
      // Skip positional args (first parameter with ID in name)
      const isPositionalArg = param.name.toLowerCase().includes('id') &&
                             method.parameters.indexOf(param) === 0
      if (isPositionalArg) {
        continue
      }

      // Skip optional complex-type parameters (programmatic-only, not suitable for CLI)
      if (param.optional && this.isComplexType(param.type)) {
        continue
      }

      // For required complex objects, create a string flag for JSON input
      if (this.isComplexType(param.type)) {
        const flagName = this.camelToKebab(param.name)
        flags.push(`    '${flagName}': Flags.string({\n      description: ${JSON.stringify(param.description || `${param.name} as JSON string`)},\n      required: ${!param.optional}\n    }),`)
        continue
      }

      const flagName = this.camelToKebab(param.name)
      const flagDef = this.generateFlagDefinition(param)

      flags.push(`    '${flagName}': ${flagDef},`)
    }

    // Add custom flags if any
    if (customFlags) {
      for (const [name, def] of Object.entries(customFlags)) {
        flags.push(`    '${name}': ${JSON.stringify(def)},`)
      }
    }

    return flags.join('\n')
  }

  /**
   * Generate a single flag definition
   */
  private generateFlagDefinition(param: { name: string; type: string; optional: boolean; description?: string; defaultValue?: string }): string {
    let flagType = 'Flags.string'

    if (param.type === 'number') {
      flagType = 'Flags.integer'
    } else if (param.type === 'boolean') {
      flagType = 'Flags.boolean'
    }

    const parts: string[] = [flagType]

    if (param.description) {
      parts.push(`{\n      description: ${JSON.stringify(param.description)}`)

      if (param.optional) {
        parts.push(`      required: false`)
      } else {
        parts.push(`      required: true`)
      }

      if (param.defaultValue) {
        parts.push(`      default: ${param.defaultValue}`)
      }

      return parts.join(',\n') + '\n    }'
    }

    return `${flagType}({ required: ${!param.optional} })`
  }

  /**
   * Generate args definitions for positional arguments
   */
  private generateArgs(method: MethodInfo): string {
    // Only the first parameter with 'id' in the name becomes a positional arg
    if (method.parameters.length === 0) {
      return ''
    }

    const firstParam = method.parameters[0]
    if (!firstParam.name.toLowerCase().includes('id')) {
      return ''
    }

    const argName = firstParam.name.replace(/Id$/, '')

    return `  static override args = {
    ${argName}: Args.string({
      description: ${JSON.stringify(firstParam.description || `${argName} identifier`)},
      required: ${!firstParam.optional},
    }),
  }
`
  }

  /**
   * Generate example commands
   */
  private generateExamples(method: MethodInfo, customExamples?: string[], topic?: string): string {
    const examples: string[] = []

    // Add custom examples first (they're CLI examples)
    if (customExamples && customExamples.length > 0) {
      examples.push(...customExamples)
    }

    // Generate default CLI example if none exist
    if (examples.length === 0) {
      const commandName = this.camelToKebab(method.name)

      // Find ID parameter for the example
      const idParam = method.parameters.find(p => p.name.toLowerCase().includes('id'))
      const idExample = idParam ? `<${idParam.name}>` : ''

      examples.push(`$ nvm ${topic} ${commandName} ${idExample}`.trim())
    }

    return examples.map(ex => `    '${ex.replace(/'/g, "\\'")}'`).join(',\n')
  }

  /**
   * Check if method has positional arguments
   */
  private hasPositionalArgs(method: MethodInfo): boolean {
    // Only the first parameter with 'id' in the name is treated as positional
    return method.parameters.length > 0 &&
           method.parameters[0].name.toLowerCase().includes('id')
  }

  /**
   * Generate the run method implementation
   */
  private generateRunMethod(
    method: MethodInfo,
    apiProperty: string,
    metadata?: CommandMetadata,
    hasArgs: boolean = false
  ): string {
    const lines: string[] = []

    // Parse flags and args
    if (hasArgs) {
      lines.push('    const { flags, args } = await this.parse(this.constructor as any)')
    } else {
      lines.push('    const { flags } = await this.parse(this.constructor as any)')
    }

    // Add custom before-init code
    if (metadata?.customizations?.beforeInit) {
      lines.push('')
      lines.push(metadata.customizations.beforeInit)
    }

    // Initialize payments
    lines.push('')
    lines.push('    const payments = await this.initPayments()')

    // Add custom after-init code
    if (metadata?.customizations?.afterInit) {
      lines.push('')
      lines.push(metadata.customizations.afterInit)
    }

    // Build method call
    lines.push('')
    lines.push('    try {')

    const methodCall = this.generateMethodCall(method, apiProperty)
    lines.push(`      const result = await payments.${apiProperty}.${method.name}(${methodCall})`)

    lines.push('')
    lines.push('      this.formatter.output(result)')
    lines.push('    } catch (error) {')
    lines.push('      this.handleError(error)')
    lines.push('    }')

    return lines.join('\n')
  }

  /**
   * Check if type is a complex object that needs JSON parsing
   */
  private isComplexType(type: string): boolean {
    // Strip '| undefined' suffix from optional types before checking
    const baseType = type.replace(/\s*\|\s*undefined$/, '').trim()

    // Complex objects have literal braces or are explicitly 'object'
    if (baseType.includes('{') || baseType === 'object') {
      return true
    }

    // Types ending with Config, Metadata, Options are likely interfaces
    if (/(Config|Metadata|Options|Settings|Params)$/.test(baseType)) {
      return true
    }

    return false
  }

  /**
   * Generate method call arguments
   */
  private generateMethodCall(method: MethodInfo, _apiProperty: string): string {
    const args: string[] = []
    const hasComplexTypes = method.parameters.some(p =>
      this.isComplexType(p.type) &&
      !(p.name.toLowerCase().includes('id') && method.parameters.indexOf(p) === 0)
    )

    for (const param of method.parameters) {
      // Check if this is a positional arg (first parameter with ID in name)
      const isPositionalArg = param.name.toLowerCase().includes('id') &&
                             method.parameters.indexOf(param) === 0

      // Skip optional complex-type parameters (programmatic-only)
      if (param.optional && this.isComplexType(param.type)) {
        continue
      }

      if (isPositionalArg) {
        const argName = param.name.replace(/Id$/, '')
        args.push(`args.${argName}`)
      } else if (this.isComplexType(param.type)) {
        // Required complex object - use JSON input flag with await
        const flagName = this.camelToKebab(param.name)
        args.push(`await this.parseJsonInput(flags['${flagName}'])`)
      } else {
        // Regular flag (string, number, boolean, Address, etc.)
        const flagName = this.camelToKebab(param.name)
        args.push(`flags['${flagName}']`)
      }
    }

    // Return with or without await prefix based on whether we have complex types
    return args.join(', ')
  }

  /**
   * Get the API property name (e.g., PlansAPI -> plans)
   */
  private getAPIProperty(className: string): string {
    const name = className.replace('API', '')
    const lowercaseName = name.charAt(0).toLowerCase() + name.slice(1)

    // Handle special cases
    if (lowercaseName === 'x402Token') return 'x402'
    if (lowercaseName === 'facilitator') return 'facilitator'

    return lowercaseName
  }

  /**
   * Get the command class name (e.g., getPlan -> GetPlan)
   */
  private getCommandClassName(methodName: string): string {
    return methodName.charAt(0).toUpperCase() + methodName.slice(1)
  }

  /**
   * Convert camelCase to kebab-case
   * Handles consecutive capitals like ERC20 -> erc20, APlan -> aplan
   */
  private camelToKebab(str: string): string {
    return str
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')  // Handle consecutive capitals: ERC20Config -> ERC20-Config
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')     // Handle camelCase: myVariable -> my-Variable
      .toLowerCase()
  }
}

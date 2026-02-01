/**
 * API Scanner - Analyzes the Payments SDK API using ts-morph
 * Extracts method signatures, parameters, and JSDoc comments
 */

import { Project, MethodDeclaration, SyntaxKind, JSDoc, Type } from 'ts-morph'
import { join } from 'path'

export interface MethodParameter {
  name: string
  type: string
  optional: boolean
  description?: string
  defaultValue?: string
}

export interface MethodInfo {
  name: string
  className: string
  description: string
  parameters: MethodParameter[]
  returnType: string
  examples: string[]
  isAsync: boolean
}

export interface APIClassInfo {
  name: string
  description: string
  methods: MethodInfo[]
}

export class APIScanner {
  private project: Project
  private sdkPath: string

  constructor(sdkPath: string) {
    this.sdkPath = sdkPath
    this.project = new Project({
      tsConfigFilePath: join(sdkPath, 'tsconfig.json'),
    })
  }

  /**
   * Scan all API classes in the SDK
   */
  scanAPIs(): APIClassInfo[] {
    const apiClasses: APIClassInfo[] = []

    // Scan API files (relative to SDK root)
    const apiFiles = [
      'src/api/plans-api.ts',
      'src/api/agents-api.ts',
      'src/x402/token.ts',
      'src/x402/facilitator-api.ts',
      'src/api/organizations-api/organizations-api.ts',
    ]

    for (const relativePath of apiFiles) {
      const filePath = join(this.sdkPath, relativePath)
      const sourceFile = this.project.addSourceFileAtPath(filePath)
      if (!sourceFile) {
        console.warn(`File not found: ${filePath}`)
        continue
      }

      // Find all exported classes
      const classes = sourceFile.getClasses().filter((cls) => cls.isExported())

      for (const cls of classes) {
        const classInfo = this.scanClass(cls)
        if (classInfo) {
          apiClasses.push(classInfo)
        }
      }
    }

    return apiClasses
  }

  /**
   * Scan a single class
   */
  private scanClass(cls: any): APIClassInfo | null {
    const className = cls.getName()
    if (!className || !className.endsWith('API')) {
      return null
    }

    // Get class description from JSDoc
    const jsDocs = cls.getJsDocs()
    const description = this.extractDescription(jsDocs)

    // Get all public methods
    const methods = cls
      .getMethods()
      .filter((method: MethodDeclaration) => {
        const modifiers = method.getModifiers()
        const isPublic = !modifiers.some(
          (m) => m.getKind() === SyntaxKind.PrivateKeyword || m.getKind() === SyntaxKind.ProtectedKeyword
        )
        // Skip static methods and getInstance
        const isStatic = modifiers.some((m) => m.getKind() === SyntaxKind.StaticKeyword)
        const name = method.getName()
        return isPublic && !isStatic && name !== 'getInstance' && !name.startsWith('_')
      })
      .map((method: MethodDeclaration) => this.scanMethod(method, className || ''))
      .filter((m: MethodInfo | null): m is MethodInfo => m !== null)

    return {
      name: className,
      description,
      methods,
    }
  }

  /**
   * Scan a single method
   */
  private scanMethod(method: MethodDeclaration, className: string): MethodInfo | null {
    const name = method.getName()
    if (!name) return null

    // Get JSDoc
    const jsDocs = method.getJsDocs()
    const description = this.extractDescription(jsDocs)
    const examples = this.extractExamples(jsDocs)
    const paramDocs = this.extractParamDocs(jsDocs)

    // Get parameters
    const parameters = method.getParameters().map((param) => {
      const paramName = param.getName()
      const paramType = this.simplifyType(param.getType())
      const optional = param.isOptional() || param.hasInitializer()
      const defaultValue = param.getInitializer()?.getText()

      return {
        name: paramName,
        type: paramType,
        optional,
        description: paramDocs[paramName],
        defaultValue,
      }
    })

    // Get return type
    const returnTypeNode = method.getReturnType()
    const returnType = this.simplifyType(returnTypeNode)

    // Check if async
    const isAsync = method.isAsync()

    return {
      name,
      className,
      description,
      parameters,
      returnType,
      examples,
      isAsync,
    }
  }

  /**
   * Extract description from JSDoc
   */
  private extractDescription(jsDocs: JSDoc[]): string {
    if (jsDocs.length === 0) return ''

    const doc = jsDocs[0]
    const description = doc.getDescription().trim()

    // Remove leading asterisks and clean up
    return description
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter((line) => line.length > 0)
      .join(' ')
  }

  /**
   * Extract examples from JSDoc
   */
  private extractExamples(jsDocs: JSDoc[]): string[] {
    const examples: string[] = []

    for (const doc of jsDocs) {
      const tags = doc.getTags()
      for (const tag of tags) {
        if (tag.getTagName() === 'example') {
          const exampleText = tag.getComment()
          if (typeof exampleText === 'string') {
            examples.push(exampleText.trim())
          }
        }
      }
    }

    return examples
  }

  /**
   * Extract parameter documentation from JSDoc
   */
  private extractParamDocs(jsDocs: JSDoc[]): Record<string, string> {
    const paramDocs: Record<string, string> = {}

    for (const doc of jsDocs) {
      const tags = doc.getTags()
      for (const tag of tags) {
        if (tag.getTagName() === 'param') {
          const comment = tag.getComment()
          if (typeof comment === 'string') {
            // Extract parameter name and description
            // Format: @param paramName - description
            const match = comment.match(/^(\w+)\s*-?\s*(.+)$/s)
            if (match) {
              const [, paramName, description] = match
              paramDocs[paramName] = description.trim()
            }
          }
        }
      }
    }

    return paramDocs
  }

  /**
   * Simplify TypeScript type to a human-readable string
   */
  private simplifyType(type: Type): string {
    const typeText = type.getText()

    // Simplify common patterns
    if (typeText.includes('Promise<')) {
      const match = typeText.match(/Promise<(.+)>/)
      if (match) {
        return match[1]
      }
    }

    // Simplify union types
    if (typeText.includes('|')) {
      return typeText
    }

    // Simplify complex types
    if (typeText.length > 100) {
      if (typeText.includes('{')) {
        return 'object'
      }
      if (typeText.includes('[')) {
        return 'array'
      }
    }

    return typeText
  }

  /**
   * Get all API classes and their methods
   */
  getAPISummary(): string {
    const apis = this.scanAPIs()
    let summary = 'Nevermined Payments SDK API Summary\n'
    summary += '=' .repeat(50) + '\n\n'

    for (const api of apis) {
      summary += `${api.name}\n`
      summary += '-'.repeat(api.name.length) + '\n'
      if (api.description) {
        summary += `${api.description}\n\n`
      }

      for (const method of api.methods) {
        summary += `  ${method.name}(`
        summary += method.parameters.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ')
        summary += `): ${method.returnType}\n`

        if (method.description) {
          summary += `    ${method.description}\n`
        }
      }

      summary += '\n'
    }

    return summary
  }
}

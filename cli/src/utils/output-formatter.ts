import Table from 'cli-table3'
import chalk from 'chalk'

export type OutputFormat = 'table' | 'json' | 'quiet'

export class OutputFormatter {
  private format: OutputFormat

  constructor(format: OutputFormat = 'table') {
    this.format = format
  }

  /**
   * Format and output data based on the configured format
   */
  output(data: any, options?: TableOptions): void {
    switch (this.format) {
      case 'json':
        console.log(JSON.stringify(data, null, 2))
        break
      case 'quiet':
        // No output in quiet mode
        break
      case 'table':
      default:
        if (Array.isArray(data) && options) {
          this.outputTable(data, options)
        } else {
          this.outputObject(data)
        }
        break
    }
  }

  /**
   * Output a table for array data
   */
  private outputTable(data: any[], options: TableOptions): void {
    if (data.length === 0) {
      console.log(chalk.yellow('No data found'))
      return
    }

    const table = new Table({
      head: options.columns.map((col) => chalk.cyan(col.header)),
      style: {
        head: [],
        border: [],
      },
    })

    data.forEach((item) => {
      const row = options.columns.map((col) => {
        const value = this.getNestedValue(item, col.key)
        return col.formatter ? col.formatter(value) : String(value ?? '')
      })
      table.push(row)
    })

    console.log(table.toString())
  }

  /**
   * Output a single object in key-value format
   */
  private outputObject(data: any): void {
    if (typeof data !== 'object' || data === null) {
      console.log(data)
      return
    }

    const table = new Table({
      style: {
        head: [],
        border: [],
      },
    })

    Object.entries(data).forEach(([key, value]) => {
      const formattedValue =
        typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
      table.push([chalk.cyan(key), formattedValue])
    })

    console.log(table.toString())
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }

  /**
   * Output an error message
   */
  error(message: string): void {
    if (this.format !== 'quiet') {
      console.error(chalk.red('Error:'), message)
    }
  }

  /**
   * Output a success message
   */
  success(message: string): void {
    if (this.format !== 'quiet') {
      console.log(chalk.green('✓'), message)
    }
  }

  /**
   * Output a warning message
   */
  warning(message: string): void {
    if (this.format !== 'quiet') {
      console.log(chalk.yellow('⚠'), message)
    }
  }

  /**
   * Output an info message
   */
  info(message: string): void {
    if (this.format !== 'quiet') {
      console.log(chalk.blue('ℹ'), message)
    }
  }
}

export interface TableColumn {
  header: string
  key: string
  formatter?: (value: any) => string
}

export interface TableOptions {
  columns: TableColumn[]
}

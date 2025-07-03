/**
 * Mock for @a2a-js/sdk
 * This mock provides stub implementations for all the classes and functions
 * that are imported from the actual @a2a-js/sdk package.
 */

// Mock classes
export class InMemoryTaskStore {
  constructor() {}

  async createTask(task: any): Promise<any> {
    return { id: 'mock-task-id', ...task }
  }

  async getTask(taskId: string): Promise<any> {
    return { id: taskId, status: 'completed' }
  }

  async updateTask(taskId: string, updates: any): Promise<any> {
    return { id: taskId, ...updates }
  }

  async deleteTask(taskId: string): Promise<void> {
    // Mock implementation
  }

  async listTasks(): Promise<any[]> {
    return []
  }
}

export class DefaultRequestHandler {
  constructor() {}

  async handleRequest(request: any): Promise<any> {
    return { success: true, data: 'mock-response' }
  }
}

export class A2AExpressApp {
  constructor() {}

  start(port: number): void {
    // Mock implementation
  }

  stop(): void {
    // Mock implementation
  }
}

export class RequestContext {
  constructor() {}

  getUserId(): string {
    return 'mock-user-id'
  }

  getRequestId(): string {
    return 'mock-request-id'
  }
}

// Mock functions
export const createTask = jest.fn().mockResolvedValue({ id: 'mock-task-id' })
export const getTask = jest.fn().mockResolvedValue({ id: 'mock-task-id', status: 'completed' })
export const updateTask = jest.fn().mockResolvedValue({ id: 'mock-task-id', updated: true })
export const deleteTask = jest.fn().mockResolvedValue(undefined)

// Export all as default for compatibility with both ESM and CommonJS
const defaultExport = {
  InMemoryTaskStore,
  DefaultRequestHandler,
  A2AExpressApp,
  RequestContext,
  createTask,
  getTask,
  updateTask,
  deleteTask,
}

export default defaultExport

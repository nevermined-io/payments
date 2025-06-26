/**
 * Abstract base class for implementing a payments A2A agent executor.
 * Users should extend this class and implement the handleTask method.
 */
import type { TaskContext, TaskHandlerResult } from './types'

export abstract class PaymentsAgentExecutor {
  /**
   * Handles an incoming A2A task. Must be implemented by the user.
   * @param context - The context of the incoming task, including user message and bearer token.
   * @returns A promise resolving to the handler result (parts, metadata, etc.).
   */
  abstract handleTask(context: TaskContext): Promise<TaskHandlerResult>

  /**
   * Handles task cancellation. Can be overridden by the user.
   * @param taskId - The ID of the task to cancel.
   * @returns A promise that resolves when cancellation is complete.
   */
  abstract cancelTask(taskId: string): Promise<void>
}

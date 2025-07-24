/**
 * PaymentsError extends Error to provide detailed error information for payments and authentication.
 * Supports error codes for unauthorized, payment required, and other payment-related errors.
 */
export class PaymentsError extends Error {
  code: string

  /**
   * Creates a new PaymentsError instance.
   * @param message - The error message
   * @param code - The error code (e.g., 'unauthorized', 'payment_required')
   */
  constructor(message: string, code: string = 'payments_error') {
    super(message)
    this.name = 'PaymentsError'
    this.code = code
  }

  static fromBackend(message: string, error: any) {
    return new PaymentsError(`${message}. ${error.message}`, error.code)
  }

  /**
   * Creates an unauthorized error (missing or invalid credentials).
   * @param message - Optional custom message
   */
  static unauthorized(message: string = 'Unauthorized') {
    return new PaymentsError(message, 'unauthorized')
  }

  /**
   * Creates a payment required error (insufficient credits, etc.).
   * @param message - Optional custom message
   */
  static paymentRequired(message: string = 'Payment required') {
    return new PaymentsError(message, 'payment_required')
  }

  /**
   * Creates a generic validation error.
   * @param message - Optional custom message
   */
  static validation(message: string = 'Validation error') {
    return new PaymentsError(message, 'validation')
  }

  /**
   * Creates an internal error.
   * @param message - Optional custom message
   */
  static internal(message: string = 'Internal error') {
    return new PaymentsError(message, 'internal')
  }
}

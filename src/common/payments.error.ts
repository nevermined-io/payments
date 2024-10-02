export class PaymentsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentsError'
  }
}

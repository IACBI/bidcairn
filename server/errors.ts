export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  message: string,
  status = 409,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}

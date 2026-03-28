export class ValidationError extends Error {
  readonly kind = "ValidationError" as const;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly kind = "NotFoundError" as const;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ReadFailedError extends Error {
  readonly kind = "ReadFailedError" as const;
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ReadFailedError";
    this.cause = cause;
  }
}

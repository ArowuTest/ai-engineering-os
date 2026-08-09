export class DomainValidationError extends Error {
  readonly field: string;

  constructor(field: string, message = `${field} must be a non-blank string`) {
    super(message);
    this.name = 'DomainValidationError';
    this.field = field;
  }
}

export function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainValidationError(field);
  }
  return value.trim();
}
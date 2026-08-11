export class DomainValidationError extends Error {
  readonly field: string;

  constructor(field: string, message = `${field} must be a non-blank string`) {
    super(message);
    this.name = 'DomainValidationError';
    this.field = field;
  }
}

export const STABLE_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function requireNonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainValidationError(field);
  }
  return value.trim();
}

export function requireStableIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !STABLE_IDENTIFIER_PATTERN.test(value)) {
    throw new DomainValidationError(
      field,
      `${field} must match ${STABLE_IDENTIFIER_PATTERN.source}`,
    );
  }
  return value;
}

// Defense in depth after native secure-field/policy checks. Apply only to
// contextual text, never opaque evidence IDs or application identities.
export function redactComputerActivityText(value: string): string {
  return value
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi, "Bearer [redacted]")
    .replace(
      /\b(password|passwd|api[_-]?key|secret|(?:access|refresh)[_-]?token)\s*[:=]\s*["']?[^\s"',;]+["']?/gi,
      (_match, name: string) => `${name}=[redacted]`,
    )
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, (candidate) => {
      const digits = candidate.replace(/\D/g, "");
      let sum = 0;
      for (let index = digits.length - 1, offset = 0; index >= 0; index--, offset++) {
        let digit = Number(digits[index]);
        if (offset % 2 === 1) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
      }
      return sum % 10 === 0 ? "[redacted]" : candidate;
    });
}

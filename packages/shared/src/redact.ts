/**
 * Redaction helpers for structured logs. Secrets, tokens, pairing codes, IP
 * addresses and free-form input contents must never be written verbatim.
 */

const SENSITIVE_KEYS = [
  'token',
  'accesstoken',
  'refreshtoken',
  'jwt',
  'secret',
  'password',
  'privatekey',
  'signature',
  'mac',
  'nonce',
  'code',
  'pairingcode',
  'credential',
  'clipboard',
  'text',
  'authorization',
];

const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

/** Mask an IPv4 address, keeping only the first octet (e.g. 203.x.x.x). */
export function redactIp(value: string): string {
  return value.replace(IPV4, (_m, a) => `${a}.x.x.x`);
}

/** Truncate a token/secret to a short, non-reversible hint. */
export function redactToken(value: string): string {
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}…${'*'.repeat(4)}`;
}

/**
 * Deep-redact an object for logging. Sensitive keys are replaced with a marker;
 * string values are scanned for IP addresses. Depth-limited to avoid cycles.
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (input == null) return input;
  if (typeof input === 'string') return redactIp(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        out[k] = typeof v === 'string' ? redactToken(v) : '[redacted]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return '[unserializable]';
}

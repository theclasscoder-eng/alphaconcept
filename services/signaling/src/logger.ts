import { pino, type Logger } from 'pino';
import { redact } from '@rdp/shared';

/** Create a structured logger. Sensitive fields are redacted before serialization. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    // Belt-and-suspenders: pino's own redaction for common paths...
    redact: {
      paths: [
        'token',
        'signature',
        'mac',
        'nonce',
        'code',
        'req.headers.authorization',
        '*.token',
        '*.signature',
      ],
      censor: '[redacted]',
    },
    // ...plus a serializer that deep-redacts arbitrary payloads we log.
    serializers: {
      payload: (value: unknown) => redact(value),
    },
  });
}

export type { Logger };

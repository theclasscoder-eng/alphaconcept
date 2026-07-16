/**
 * Browser-safe entry point. Re-exports everything EXCEPT `crypto.ts`, which
 * depends on `node:crypto` and must not be pulled into a browser/renderer
 * bundle. The renderer only needs constants, coordinate math, rate limiting,
 * and the message schemas/types.
 */
export * from './constants.js';
export * from './coordinates.js';
export * from './rate-limit.js';
export * from './signaling.js';
export * from './input.js';

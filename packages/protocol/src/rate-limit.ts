/**
 * Deterministic token-bucket rate limiter used at trust boundaries:
 *   - host-side input-event flood protection (mouse-move throttling),
 *   - signaling-server pairing / session-request / message throttling.
 *
 * Time is injected so behaviour is fully unit-testable.
 */
export interface TokenBucketOptions {
  /** Maximum tokens the bucket can hold (burst size). */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
  /** Optional clock (defaults to Date.now). */
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
    this.tokens = options.capacity;
    this.lastRefill = this.now();
  }

  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefill = t;
  }

  /** Attempt to consume `cost` tokens. Returns true if allowed. */
  tryConsume(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Current token count (after refill), for diagnostics/tests. */
  available(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * Keyed rate limiter: one bucket per key (device id, ip, etc.). Buckets are
 * created lazily and can be pruned to bound memory.
 */
export class KeyedRateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();
  constructor(private readonly options: TokenBucketOptions) {}

  tryConsume(key: string, cost = 1): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.options);
      this.buckets.set(key, bucket);
    }
    return bucket.tryConsume(cost);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }

  get size(): number {
    return this.buckets.size;
  }
}

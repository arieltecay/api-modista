import { MemoryStore, type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import RateLimitHit from '../models/RateLimitHit/index.js';
import { logger } from '../services/logger.js';

const isDuplicateKey = (error: unknown): boolean => (error as { code?: number })?.code === 11000;
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rate limit counters kept in MongoDB, so every serverless instance counts the same client together
 * (the default store lives in each instance's memory, which on Vercel makes the real limit much higher).
 */
export class MongoRateLimitStore implements Store {
  /** Keeps the counters of different limiters apart. */
  readonly prefix: string;
  /** False: keys are shared with other instances. */
  readonly localKeys = false;
  private windowMs = 0;
  private readonly now: () => number;
  /** Counts per instance while MongoDB is unreachable: a degraded limit is better than none. */
  private readonly fallback = new MemoryStore();
  private lastFailureLog = 0;

  constructor({ prefix, now = Date.now }: { prefix: string; now?: () => number }) {
    this.prefix = prefix;
    this.now = now;
  }

  init(options: Pick<Options, 'windowMs'>): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options as Options);
  }

  /** Logs at most once a minute (a Mongo outage would otherwise flood the logs, one line per request). */
  private noteFailure(error: unknown): void {
    if (this.now() - this.lastFailureLog < 60_000) return;
    this.lastFailureLog = this.now();
    logger.error(`[RateLimit:${this.prefix}] MongoDB no responde: se cuenta en memoria por instancia`, error);
  }

  private rowKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /** One atomic upsert: add a hit inside the window, or start a new window when it already ended. */
  async increment(key: string): Promise<IncrementResponse> {
    try {
      return await this.incrementInMongo(key);
    } catch (error) {
      this.noteFailure(error);
      const { totalHits, resetTime } = await this.fallback.increment(this.rowKey(key));
      return { totalHits, resetTime }; // the memory store reuses one object: take a copy
    }
  }

  private async incrementInMongo(key: string): Promise<IncrementResponse> {
    const now = new Date(this.now());
    const windowEnd = new Date(now.getTime() + this.windowMs);
    const live = { $gt: ['$resetAt', now] };
    const update = [
      { $set: { hits: { $cond: [live, { $add: ['$hits', 1] }, 1] }, resetAt: { $cond: [live, '$resetAt', windowEnd] } } },
    ];

    // Two first hits can race on the unique key; the loser simply retries as an update.
    for (let attempt = 0; ; attempt += 1) {
      try {
        const row = await RateLimitHit.findOneAndUpdate({ key: this.rowKey(key) }, update, { upsert: true, new: true });
        return { totalHits: row.hits, resetTime: row.resetAt };
      } catch (error) {
        if (!isDuplicateKey(error) || attempt > 0) throw error;
      }
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await RateLimitHit.updateOne({ key: this.rowKey(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
    } catch (error) {
      this.noteFailure(error);
      this.fallback.decrement(this.rowKey(key));
    }
  }

  async resetKey(key: string): Promise<void> {
    await RateLimitHit.deleteOne({ key: this.rowKey(key) });
  }

  async resetAll(): Promise<void> {
    await RateLimitHit.deleteMany({ key: new RegExp(`^${escapeRegex(this.prefix)}:`) });
  }
}

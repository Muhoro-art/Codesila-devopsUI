// src/infra/cache/redis.ts — Redis client singleton (§2.4.3)
import Redis from "ioredis";
import { env } from "../../config/env";
import logger from "../../config/logger";

let redis: Redis | null = null;

/**
 * Returns a shared Redis client instance.
 * Connects lazily on first call; returns null if REDIS_URL is not configured.
 */
export function getRedis(): Redis | null {
  if (redis) return redis;
  if (!env.REDIS_URL) {
    logger.warn("REDIS_URL not set — falling back to in-memory caching");
    return null;
  }

  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;           // stop retrying after 5 failures
      return Math.min(times * 200, 2000);   // exponential backoff up to 2s
    },
    lazyConnect: true,
  });

  redis.on("connect", () => logger.info("Redis connected"));
  redis.on("error", (err) => logger.error({ err }, "Redis error"));

  redis.connect().catch((err) => {
    logger.error({ err }, "Redis initial connection failed");
    redis = null;
  });

  return redis;
}

/**
 * Gracefully disconnect Redis (call on shutdown).
 */
export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

// ─── Simple cache helpers ────────────────────────────────────

export async function cacheGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  return r.get(key);
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds = 300,
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(key, value, "EX", ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(key);
}

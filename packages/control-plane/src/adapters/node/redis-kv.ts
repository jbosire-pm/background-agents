/**
 * Redis implementation of the KeyValueStore interface.
 *
 * Drop-in replacement for Cloudflare KV, supporting TTL-based expiration.
 */

import type { KeyValueStore, KeyValuePutOptions } from "@open-inspect/shared";

type RedisClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number>;
};

export class RedisKeyValueStore implements KeyValueStore {
  constructor(private readonly redis: RedisClient) {}

  async get(key: string, typeOrOptions?: string): Promise<unknown> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;

    if (typeOrOptions === "json") {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    return raw;
  }

  async put(key: string, value: string, options?: KeyValuePutOptions): Promise<void> {
    if (options?.expirationTtl) {
      await this.redis.set(key, value, "EX", options.expirationTtl);
    } else {
      await this.redis.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

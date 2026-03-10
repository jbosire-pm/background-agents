/**
 * Portable key-value store interface.
 *
 * Models the KVNamespace API used by bots and control plane.
 * Implementations: Cloudflare KV, Redis (Node.js), in-memory (testing).
 */

export interface KeyValueGetOptions {
  type?: "text" | "json";
}

export interface KeyValuePutOptions {
  expirationTtl?: number;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  get(key: string, typeOrOptions?: string | KeyValueGetOptions): Promise<unknown>;
  put(key: string, value: string, options?: KeyValuePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
}

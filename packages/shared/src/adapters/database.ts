/**
 * Portable database adapter interface.
 *
 * Models the D1Database API so existing stores can swap
 * D1Database for DatabaseAdapter with minimal changes.
 * Implementations: D1 (Cloudflare), PostgreSQL (Node.js).
 */

export interface DatabaseResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface BoundStatement {
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}

export interface PreparedStatement {
  bind(...values: unknown[]): BoundStatement;
}

export interface DatabaseAdapter {
  prepare(query: string): PreparedStatement;
  exec(query: string): Promise<void>;
  batch(statements: BoundStatement[]): Promise<DatabaseResult[]>;
}

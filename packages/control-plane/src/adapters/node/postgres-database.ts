/**
 * PostgreSQL implementation of the DatabaseAdapter interface.
 *
 * Translates D1-style ? parameter placeholders to PostgreSQL $1-style,
 * allowing existing DB stores to work unchanged.
 */

import type {
  DatabaseAdapter,
  DatabaseResult,
  PreparedStatement,
  BoundStatement,
} from "@open-inspect/shared";

type PgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

function translatePlaceholders(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

class PostgresBoundStatement implements BoundStatement {
  constructor(
    private readonly pool: PgPool,
    private readonly query: string,
    private readonly values: unknown[]
  ) {}

  async all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const pgQuery = translatePlaceholders(this.query);
    const result = await this.pool.query(pgQuery, this.values);
    return { results: result.rows as T[], success: true };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const pgQuery = translatePlaceholders(this.query);
    const result = await this.pool.query(pgQuery, this.values);
    if (result.rows.length === 0) return null;
    if (column) return (result.rows[0] as Record<string, unknown>)[column] as T;
    return result.rows[0] as T;
  }

  async run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const pgQuery = translatePlaceholders(this.query);
    const result = await this.pool.query(pgQuery, this.values);
    return { results: result.rows as T[], success: true };
  }
}

class PostgresPreparedStatement implements PreparedStatement {
  constructor(
    private readonly pool: PgPool,
    private readonly query: string
  ) {}

  bind(...values: unknown[]): BoundStatement {
    return new PostgresBoundStatement(this.pool, this.query, values);
  }
}

export class PostgresDatabaseAdapter implements DatabaseAdapter {
  constructor(private readonly pool: PgPool) {}

  prepare(query: string): PreparedStatement {
    return new PostgresPreparedStatement(this.pool, query);
  }

  async exec(query: string): Promise<void> {
    const statements = query
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await this.pool.query(translatePlaceholders(statement));
    }
  }

  async batch(statements: BoundStatement[]): Promise<DatabaseResult[]> {
    const results: DatabaseResult[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

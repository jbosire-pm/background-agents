/**
 * PostgreSQL implementation of the DatabaseAdapter interface.
 *
 * Translates D1-style ? parameter placeholders to PostgreSQL $1-style,
 * allowing existing DB stores to work unchanged.
 *
 * Supports both D1 patterns:
 *   db.prepare("SELECT ...").first()          // no bind
 *   db.prepare("SELECT ...").bind(...).all()  // with bind
 */

type PgPool = {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

function translatePlaceholders(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

class PostgresStatement {
  constructor(
    private readonly pool: PgPool,
    private readonly query: string,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]): PostgresStatement {
    return new PostgresStatement(this.pool, this.query, values);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }> {
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

  async run<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }> {
    const pgQuery = translatePlaceholders(this.query);
    const result = await this.pool.query(pgQuery, this.values);
    return { results: result.rows as T[], success: true };
  }
}

export class PostgresDatabaseAdapter {
  constructor(private readonly pool: PgPool) {}

  prepare(query: string): PostgresStatement {
    return new PostgresStatement(this.pool, query, []);
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

  async batch(statements: PostgresStatement[]): Promise<{ results: unknown[]; success: boolean }[]> {
    const results: { results: unknown[]; success: boolean }[] = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }
}

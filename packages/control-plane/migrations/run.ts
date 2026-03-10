/**
 * PostgreSQL migration runner for Open-Inspect.
 *
 * Usage: npx tsx packages/control-plane/migrations/run.ts
 *
 * Reads DATABASE_URL from environment and applies pending migrations.
 */

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

async function run(): Promise<void> {
  await client.connect();
  console.log("Connected to PostgreSQL");

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  const { rows } = await client.query(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
  );
  const currentVersion = rows.length > 0 ? (rows[0].version as number) : 0;
  console.log(`Current schema version: ${currentVersion}`);

  const migrationsDir = path.dirname(new URL(import.meta.url).pathname);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    if (version <= currentVersion) {
      console.log(`  Skip ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`  Applying ${file}...`);

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      console.log(`  Applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`  Failed to apply ${file}:`, err);
      throw err;
    }
  }

  console.log("Migrations complete");
  await client.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/**
 * Runs every .sql file in `dir`, in filename order, exactly once per
 * service, tracked in a shared `schema_migrations` table. Plain, boring,
 * and easy to reason about — deliberately not using a heavier migration
 * framework for Phase 1.
 *
 * Phase 1 runs every service against ONE shared Postgres database, so two
 * services both have a `001_init.sql` (different content, same filename).
 * The tracking key is (service, filename), not filename alone — otherwise
 * one service's migration row satisfies the "already applied" check for a
 * different service's same-named file and its DDL silently never runs.
 *
 * A Postgres advisory lock (keyed by service name) also serializes this
 * against itself: all services start their migration runner concurrently
 * on container boot, so without the lock two processes can both pass the
 * "not yet applied" check before either inserts its tracking row, race to
 * INSERT, and the loser's whole transaction (including its CREATE TABLE)
 * rolls back on the unique-constraint violation.
 */
export async function runMigrations(pool: Pool, dir: string, service: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      service TEXT NOT NULL,
      filename TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (service, filename)
    );
  `);

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const lockClient = await pool.connect();
  try {
    // hashtext() gives a stable bigint from the service name for pg_advisory_lock.
    await lockClient.query('SELECT pg_advisory_lock(hashtext($1))', [service]);

    for (const file of files) {
      const { rows } = await lockClient.query(
        'SELECT 1 FROM schema_migrations WHERE service = $1 AND filename = $2',
        [service, file],
      );
      if (rows.length > 0) continue;

      const sql = readFileSync(join(dir, file), 'utf-8');
      try {
        await lockClient.query('BEGIN');
        await lockClient.query(sql);
        await lockClient.query('INSERT INTO schema_migrations (service, filename) VALUES ($1, $2)', [
          service,
          file,
        ]);
        await lockClient.query('COMMIT');
        // eslint-disable-next-line no-console
        console.log(`[migrate] ${service}: applied ${file}`);
      } catch (err) {
        await lockClient.query('ROLLBACK');
        throw new Error(`[migrate] ${service}: failed applying ${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [service]);
    lockClient.release();
  }
}

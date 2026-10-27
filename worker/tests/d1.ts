/**
 * Tiny D1 shim backed by Node's built-in SQLite (node:sqlite).
 * Lets the storage/service layer run against real SQL in CI without workerd.
 */

import { DatabaseSync } from "node:sqlite";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export function makeD1(): D1Database {
  const db = new DatabaseSync(":memory:");

  const wrap = (sql: string, params: unknown[] = []): any => ({
    bind(...args: unknown[]) {
      return wrap(sql, args.map((v) => (v === undefined ? null : v)));
    },
    async first() {
      const row = db.prepare(sql).get(...(params as any[]));
      return row ?? null;
    },
    async all() {
      const results = db.prepare(sql).all(...(params as any[]));
      return { results, success: true, meta: {} };
    },
    async run() {
      const info = db.prepare(sql).run(...(params as any[]));
      return { success: true, meta: info, results: [] };
    },
  });

  return {
    prepare: (sql: string) => wrap(sql) as D1PreparedStatement,
    async batch(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((s) => s.run()));
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

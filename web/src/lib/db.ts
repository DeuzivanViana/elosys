import Database from "better-sqlite3";
import path from "node:path";

// Elosys is rewrite-only (see ADs/imutabilidade.md): the .db is a build
// artifact produced by the Python crawlers in /elosys. This app only reads
// it — never writes, never migrates. Point ELOSYS_DB_PATH at a different
// file (e.g. a nightly build) without touching any code here.
const DB_PATH = process.env.ELOSYS_DB_PATH ?? path.join(process.cwd(), "..", "elosys.db");

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  _db.pragma("query_only = ON");
  return _db;
}

const _tables = new Set<string>();
let _tablesLoaded = false;

/** Whether a table exists in the current .db. Used for tables that a rule
 * populates optionally (ai-review, candidate-supplier-partner) so their
 * pages render an empty state instead of a 500 before the rule has run. */
export function hasTable(name: string): boolean {
  if (!_tablesLoaded) {
    for (const r of db().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>) {
      _tables.add(r.name);
    }
    _tablesLoaded = true;
  }
  return _tables.has(name);
}

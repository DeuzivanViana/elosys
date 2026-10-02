import Database from "better-sqlite3";
import path from "node:path";

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

export function hasTable(name: string): boolean {
  if (!_tablesLoaded) {
    for (const r of db().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>) {
      _tables.add(r.name);
    }
    _tablesLoaded = true;
  }
  return _tables.has(name);
}

import { DatabaseSync } from "node:sqlite";

// Local files use Node's driver for deterministic file-handle release on Windows.
// Match the execute/batch/transaction subset used by the remote libSQL store.
export function createLocalClient(filename) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
  let pending = Promise.resolve();
  function enqueue(fn) {
    const result = pending.then(fn);
    pending = result.catch(() => {});
    return result;
  }
  function execute(statement) {
    const { sql, args = [] } =
      typeof statement === "string" ? { sql: statement } : statement;
    const prepared = db.prepare(sql);
    if (prepared.columns().length)
      return { rows: prepared.all(...args), rowsAffected: 0 };
    const result = prepared.run(...args);
    return { rows: [], rowsAffected: result.changes };
  }
  function transaction(mode) {
    if (mode !== "write") throw new Error("Only write transactions are used");
    return new Promise((resolve, reject) => {
      enqueue(
        () =>
          new Promise((release) => {
            try {
              db.exec("BEGIN IMMEDIATE");
            } catch (error) {
              reject(error);
              release();
              return;
            }
            let closed = false;
            function finish(sql) {
              if (closed) return;
              db.exec(sql);
              closed = true;
              release();
            }
            resolve({
              async execute(statement) {
                if (closed) throw new Error("Transaction is closed");
                return execute(statement);
              },
              async commit() {
                finish("COMMIT");
              },
              async rollback() {
                finish("ROLLBACK");
              },
              close() {
                finish("ROLLBACK");
              },
            });
          }),
      );
    });
  }
  return {
    execute: (statement) => enqueue(() => execute(statement)),
    transaction,
    async batch(statements, mode) {
      const tx = await transaction(mode);
      try {
        const results = [];
        for (const statement of statements)
          results.push(await tx.execute(statement));
        await tx.commit();
        return results;
      } finally {
        tx.close();
      }
    },
    close: () => db.close(),
  };
}

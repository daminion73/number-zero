import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, transaction } from "../backend/store.js";
import { createServer } from "../server.js";

test(
  "async rollback hides partial writes and leaves queued transactions usable",
  { timeout: 5000 },
  async () => {
    const db = await openStore(":memory:");
    try {
      await db.execute(
        "INSERT INTO users(id,name,balance_cents) VALUES(1,'A',137)",
      );
      let entered, release;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const resume = new Promise((resolve) => {
        release = resolve;
      });
      const failed = transaction(db, async (tx) => {
        await tx.execute("UPDATE users SET balance_cents=12 WHERE id=1");
        entered();
        await resume;
        throw new Error("simulated failure after debit");
      });
      const rejected = assert.rejects(failed, /failure after debit/);
      await started;
      const read = db.execute("SELECT balance_cents FROM users WHERE id=1");
      const next = transaction(db, async (tx) => {
        const before = (
          await tx.execute("SELECT balance_cents FROM users WHERE id=1")
        ).rows[0];
        assert.equal(before.balance_cents, 137);
        await setTimeout(5);
        await tx.execute(
          "UPDATE users SET balance_cents=balance_cents+23 WHERE id=1",
        );
      });
      await setTimeout(5);
      release();
      await rejected;
      assert.equal((await read).rows[0].balance_cents, 137);
      await next;
      assert.equal(
        (await db.execute("SELECT balance_cents FROM users WHERE id=1")).rows[0]
          .balance_cents,
        160,
      );
    } finally {
      db.close();
    }
  },
);

test("local batch rollback, foreign keys, persistence and Windows file cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "number-zero-store-"));
  const filename = join(directory, "nested folder", "wallet é.sqlite");
  let db;
  try {
    db = await openStore(filename);
    await assert.rejects(
      db.batch(
        [
          "INSERT INTO users(id,name,balance_cents) VALUES(1,'A',137)",
          "INSERT INTO sessions VALUES('invalid',99,100,0)",
        ],
        "write",
      ),
      /FOREIGN KEY/,
    );
    assert.equal((await db.execute("SELECT * FROM users")).rows.length, 0);
    await db.execute(
      "INSERT INTO users(id,name,balance_cents) VALUES(1,'A',137)",
    );
    db.close();
    db = await openStore(filename);
    assert.equal(
      (await db.execute("SELECT balance_cents FROM users WHERE id=1")).rows[0]
        .balance_cents,
      137,
    );
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("incomplete hosted configuration never falls back to an ephemeral wallet", async () => {
  for (const config of [
    { url: "libsql://example.turso.io" },
    { authToken: "test-not-a-real-token" },
    { url: "file:wallet.db", authToken: "test-not-a-real-token" },
  ])
    await assert.rejects(openStore(":memory:", config), /Turso requires/);
  await assert.rejects(createServer({ env: { RENDER: "true" } }), /ephemeral/);
});

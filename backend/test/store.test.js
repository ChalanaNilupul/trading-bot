const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../src/store");

test("load returns null when the state file does not exist", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(store.load(path.join(dir, "missing.json")), null);
});

test("load restores valid JSON state", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, JSON.stringify({ cash: 1000 }));

  assert.deepEqual(store.load(file), { cash: 1000 });
});

test("load throws instead of silently resetting on corrupt JSON", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-store-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, "state.json");
  fs.writeFileSync(file, "{invalid json");

  assert.throws(() => store.load(file), /Cannot safely load state file/);
});

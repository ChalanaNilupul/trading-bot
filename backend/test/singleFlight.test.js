const test = require("node:test");
const assert = require("node:assert/strict");
const { createSingleFlight } = require("../src/singleFlight");

function deferred() {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

test("overlapping calls share one task execution", async () => {
  const gate = deferred();
  let executions = 0;

  const run = createSingleFlight(async () => {
    executions += 1;
    await gate.promise;
    return "completed";
  });

  const first = run();
  const second = run();

  assert.equal(first, second);
  assert.equal(executions, 0);

  await Promise.resolve();
  assert.equal(executions, 1);

  gate.resolve();

  assert.equal(await first, "completed");
  assert.equal(await second, "completed");
  assert.equal(executions, 1);
});

test("lock releases after a rejected task", async () => {
  let executions = 0;

  const run = createSingleFlight(async () => {
    executions += 1;

    if (executions === 1) {
      throw new Error("simulated failure");
    }

    return "recovered";
  });

  await assert.rejects(run(), /simulated failure/);
  assert.equal(await run(), "recovered");
  assert.equal(executions, 2);
});

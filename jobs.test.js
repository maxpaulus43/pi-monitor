import assert from "node:assert/strict";
import { test } from "node:test";
import { Jobs, clean, describe } from "./jobs.ts";

const cwd = process.cwd();

test("returns immediately, captures both streams, and notifies exactly once", async () => {
  const finished = [];
  const jobs = new Jobs((job) => finished.push(job.id));
  try {
    const job = jobs.start("sleep 0.1; printf hello; printf error >&2", cwd);
    assert.equal(job.status, "running");
    assert.deepEqual(finished, []);
    await job.done;
    assert.equal(job.status, "completed");
    assert.match(job.output, /hello/);
    assert.match(job.output, /error/);
    assert.deepEqual(finished, [job.id]);
  } finally { await jobs.close(); }
});

test("nonzero exit and spawn failure are reported", async () => {
  const jobs = new Jobs();
  try {
    const failed = jobs.start("exit 7", cwd);
    const missing = jobs.start("true", `${cwd}/nonexistent-directory`);
    await Promise.all([failed.done, missing.done]);
    assert.equal(failed.status, "failed");
    assert.equal(failed.code, 7);
    assert.equal(missing.status, "failed");
    assert.match(missing.error, /ENOENT/);
  } finally { await jobs.close(); }
});

test("bounds output and strips terminal controls", async () => {
  const jobs = new Jobs();
  try {
    const job = jobs.start("printf '\\033[31mred\\033[0m'; yes x | head -c 70000", cwd);
    await job.done;
    assert.equal(job.output.length, 32768);
    assert.equal(job.truncated, true);
    assert.match(describe(job), /Earlier output discarded/);
    assert.equal(clean("\x1b[31mred\x1b[0m\x07\x1b]52;c;secret\x07"), "red");
  } finally { await jobs.close(); }
});

test("stop kills a TERM-resistant descendant and is idempotent", { timeout: 5000 }, async () => {
  const jobs = new Jobs();
  try {
    const job = jobs.start("bash -c 'trap \"\" TERM; echo ready; while :; do sleep 1; done' & wait", cwd);
    while (!job.output.includes("ready")) await new Promise((resolve) => setTimeout(resolve, 10));
    await Promise.all([jobs.stop(job.id), jobs.stop(job.id), job.done]);
    assert.equal(job.status, "cancelled");
    assert.throws(() => process.kill(-job.child.pid, 0), { code: "ESRCH" });
  } finally { await jobs.close(); }
});

test("shutdown suppresses completion delivery and rejects new jobs", async () => {
  const finished = [];
  const jobs = new Jobs((job) => finished.push(job.id));
  const job = jobs.start("sleep 30", cwd);
  await jobs.close();
  await jobs.close();
  assert.equal(job.status, "cancelled");
  assert.deepEqual(finished, []);
  assert.throws(() => jobs.start("true", cwd), /closed/);
});

test("rejects empty commands and unknown ids", async () => {
  const jobs = new Jobs();
  assert.throws(() => jobs.start("  ", cwd), /empty/);
  assert.throws(() => jobs.get("missing"), /Unknown/);
  await jobs.close();
});

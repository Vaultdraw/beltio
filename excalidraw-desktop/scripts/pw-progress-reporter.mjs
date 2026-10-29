// Playwright reporter that writes the run's progress to $E2E_PROGRESS_FILE after every test.
//
// Playwright calls a reporter's onEnd only after the web server and global teardown have
// finished, so the JSON reporter writes nothing while a teardown hangs. This file is written as
// each test reaches its final result, so test-tier.mjs knows the outcome even then.
// Shape: { total, done, failed: [titles], ended: false | "passed" | "failed" | ... }.
import { renameSync, writeFileSync } from "node:fs";

export default class ProgressReporter {
  constructor() {
    this.file = process.env.E2E_PROGRESS_FILE;
    this.state = { total: 0, done: 0, failed: [], ended: false };
    this.final = new Set();
  }

  printsToStdio() {
    return false;
  }

  write() {
    if (!this.file) {
      return;
    }
    // Write then rename, so a reader never sees half a file.
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state));
    renameSync(`${this.file}.tmp`, this.file);
  }

  onBegin(_config, suite) {
    this.state.total = suite.allTests().length;
    this.write();
  }

  onTestEnd(test, result) {
    const id = test.id;
    if (this.final.has(id)) {
      return;
    }
    // Final unless a retry will follow (a failure with retries left).
    const failedAttempt =
      result.status !== "skipped" && result.status !== test.expectedStatus;
    if (failedAttempt && result.retry < test.retries) {
      return;
    }
    this.final.add(id);
    this.state.done = this.final.size;
    if (test.outcome() === "unexpected") {
      this.state.failed.push(test.titlePath().filter(Boolean).join(" › "));
    }
    this.write();
  }

  onError() {
    this.state.errors = (this.state.errors ?? 0) + 1;
    this.write();
  }

  onEnd(result) {
    this.state.ended = result.status;
    this.write();
  }
}

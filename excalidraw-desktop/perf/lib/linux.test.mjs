import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  isLinux,
  linuxPerfBinary,
  parseProcStat,
  parseProcStatus,
  parseSmapsRollup,
  descendantsOf,
  webKitGtkRole,
  webKitHelpersOf,
  lowEndCommand,
  parseCpuBrand,
  parseMemBytes,
  sampleProcsLinux,
  sampleFootprintLinux,
  listProcessesLinux,
} from "./linux.mjs";

test("isLinux follows process.platform", () => {
  assert.equal(isLinux, process.platform === "linux");
});

test("linuxPerfBinary: PERF_APP_BIN, then CARGO_TARGET_DIR, then src-tauri/target", () => {
  assert.equal(linuxPerfBinary("/wt", { PERF_APP_BIN: "/x/bin" }), "/x/bin");
  assert.equal(
    linuxPerfBinary("/wt", { CARGO_TARGET_DIR: "/home/k/target" }),
    path.join("/home/k/target", "release", "excalidraw-vault"),
  );
  assert.equal(
    linuxPerfBinary("/wt", {}),
    path.join(
      "/wt",
      "excalidraw-desktop",
      "src-tauri",
      "target",
      "release",
      "excalidraw-vault",
    ),
  );
});

test("/proc/<pid>/stat: utime + stime in clock ticks, comm with spaces and parentheses", () => {
  // Real shape (Debian trixie): fields after the comm; utime=1 stime=2 (fields 14 and 15; the 3 after them is cutime).
  const stat =
    "50675 (bash) S 7 7 7 0 -1 4194560 372 1886 0 40 1 2 3 21 20 0 1 0 9151058 7098368 797 18446744073709551615 0 0 0 0 0 0 65536 4 65538 1 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
  assert.equal(parseProcStat(stat), 0.03);
  const tricky =
    "7 (Web Content (x)) R 1 1 1 0 -1 0 0 0 0 0 150 50 0 0 20 0 1 0 0 0 0 0";
  assert.equal(parseProcStat(tricky, 100), 2);
  assert.ok(Number.isNaN(parseProcStat("garbage")));
  assert.ok(Number.isNaN(parseProcStat("")));
});

test("/proc/<pid>/status and smaps_rollup parsers", () => {
  const status =
    "Name:\tWebKitWebProcess\nVmPeak:\t  900000 kB\nVmHWM:\t  123456 kB\nVmRSS:\t  100000 kB\nThreads:\t12\n";
  assert.deepEqual(parseProcStatus(status), { rssKB: 100000, hwmKB: 123456 });
  assert.ok(Number.isNaN(parseProcStatus("Name: x\n").rssKB));
  assert.equal(
    parseSmapsRollup("Rss:   3240 kB\nPss:   1119 kB\nPss_Anon: 1 kB\n"),
    1119,
  );
  assert.ok(Number.isNaN(parseSmapsRollup(null)));
});

test("descendantsOf walks the parent-pid chain (bwrap hops included), no cycles", () => {
  const list = [
    { pid: 1, ppid: 0, comm: "systemd" },
    { pid: 10, ppid: 1, comm: "/t/release/excalidraw-vault" },
    {
      pid: 11,
      ppid: 10,
      comm: "bwrap --args 40 /usr/lib/webkit2gtk-4.1/WebKitWebProcess 23 29",
    },
    {
      pid: 12,
      ppid: 11,
      comm: "/usr/lib/aarch64-linux-gnu/webkit2gtk-4.1/WebKitWebProcess 23 29",
    },
    {
      pid: 13,
      ppid: 10,
      comm: "/usr/lib/aarch64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess 25 31",
    },
    { pid: 20, ppid: 1, comm: "/usr/lib/webkit2gtk-4.1/WebKitWebProcess 1 2" }, // another app's
    { pid: 21, ppid: 13, comm: "xdg-dbus-proxy" },
  ];
  assert.deepEqual(
    descendantsOf(list, 10)
      .map((p) => p.pid)
      .sort((a, b) => a - b),
    [11, 12, 13, 21],
  );
  assert.deepEqual(descendantsOf(list, 999), []);
  assert.deepEqual(webKitHelpersOf(list, 10), [
    { pid: 12, role: "webContent" },
    { pid: 13, role: "network" },
  ]);
  assert.deepEqual(
    webKitHelpersOf(
      [
        { pid: 2, ppid: 1, comm: "a" },
        { pid: 1, ppid: 2, comm: "b" },
      ],
      1,
    ),
    [],
  );
});

test("webKitGtkRole maps the helper names, ignores look-alikes", () => {
  assert.equal(
    webKitGtkRole("/usr/lib/webkit2gtk-4.1/WebKitWebProcess 5 7"),
    "webContent",
  );
  assert.equal(webKitGtkRole("WebKitNetworkProcess"), "network");
  assert.equal(webKitGtkRole("/a/WebKitGPUProcess 1"), "gpu");
  assert.equal(
    webKitGtkRole("bwrap --ro-bind /usr/lib/WebKitWebProcess x"),
    null,
  ); // not the first token
  assert.equal(webKitGtkRole("MyWebKitWebProcessWatcher"), null);
  assert.equal(webKitGtkRole(undefined), null);
});

test("lowEndCommand: systemd scope with quota and memory cap, else nice + taskset", () => {
  const s = lowEndCommand("/bin/app", { systemd: true });
  assert.equal(s.cmd, "systemd-run");
  assert.deepEqual(s.args, [
    "--user",
    "--scope",
    "--quiet",
    "-p",
    "CPUQuota=25%",
    "-p",
    "MemoryHigh=1G",
    "--",
    "/bin/app",
  ]);
  assert.match(s.note, /CPUQuota=25%/);
  const c = lowEndCommand("/bin/app", {
    systemd: true,
    cpuQuota: "100%",
    memoryHigh: "768M",
  });
  assert.ok(
    c.args.includes("CPUQuota=100%") && c.args.includes("MemoryHigh=768M"),
  );
  const n = lowEndCommand("/bin/app", { systemd: false });
  assert.equal(n.cmd, "nice");
  assert.deepEqual(n.args, ["-n", "19", "taskset", "-c", "0-1", "/bin/app"]);
  assert.match(n.note, /unavailable/);
});

test("machine parsers: CPU brand from cpuinfo or lscpu, memory = min(cgroup, MemTotal)", () => {
  assert.equal(
    parseCpuBrand("processor : 0\nmodel name : Intel(R) Core(TM) i5\n"),
    "Intel(R) Core(TM) i5",
  );
  assert.equal(
    parseCpuBrand("CPU part : 0x000\n", "Vendor ID: Apple\nModel name: -\n"),
    "Apple",
  );
  assert.equal(
    parseCpuBrand("", "Vendor ID: ARM\nModel name: Cortex-A72\n"),
    "ARM Cortex-A72",
  );
  assert.equal(parseCpuBrand("", ""), "");
  const meminfo = "MemTotal:       12303448 kB\nMemFree: 1 kB\n";
  assert.equal(parseMemBytes(meminfo, "2147483648\n"), 2147483648);
  assert.equal(parseMemBytes(meminfo, "max"), 12303448 * 1024);
  assert.equal(parseMemBytes(meminfo, ""), 12303448 * 1024);
  assert.equal(parseMemBytes("", "2147483648"), 2147483648);
});

test(
  "live /proc sampling on this process (Linux only)",
  { skip: !isLinux },
  () => {
    const m = sampleProcsLinux([process.pid, 99998]);
    assert.ok(m.get(process.pid).rssKB > 0 && m.get(process.pid).cpuSec >= 0);
    assert.equal(m.has(99998), false);
    const f = sampleFootprintLinux([process.pid]);
    assert.ok(
      f.get(process.pid).footprint > 0 &&
        f.get(process.pid).peak >= f.get(process.pid).footprint * 0.5,
    );
    const me = listProcessesLinux().find((p) => p.pid === process.pid);
    assert.ok(me && me.ppid > 0 && /node/.test(me.comm));
  },
);

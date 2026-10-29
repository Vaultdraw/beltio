// The web server for pw.config.mjs: writes its pid, answers every request.
require("node:fs").writeFileSync(process.env.PIDS_FILE, JSON.stringify([process.pid]));
require("node:http")
  .createServer((_q, s) => s.end("ok"))
  .listen(Number(process.env.E2E_PORT), "127.0.0.1");

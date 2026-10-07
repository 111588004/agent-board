// Reads `npm pack --dry-run --json` from stdin; fails if the built web UI or the CLI entry is missing.
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const files = JSON.parse(s)[0].files.map((f) => f.path);
  const missing = ["src/cli.js", "src/server.js", "web/dist/index.html"].filter((f) => !files.includes(f));
  if (!files.some((f) => /^web\/dist\/assets\/.+\.js$/.test(f))) missing.push("web/dist/assets/*.js");
  if (missing.length) {
    console.error("package is missing: " + missing.join(", ") + " — did `cd web && npm run build` run?");
    process.exit(1);
  }
  console.log(`package OK: ${files.length} files`);
});

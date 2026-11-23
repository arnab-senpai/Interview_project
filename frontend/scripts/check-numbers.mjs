// Checks that the browser's numbers agree with the server's.
//   1. The TypeScript formula engine gives the same answers as the Python one
//      on tests/formula_cases.json.
//   2. Every compiled chapter's default values, solved in TypeScript, match the
//      values the Python compiler wrote (pass the build's topics.public.json).
//   3. Sandbox telemetry sanity: utilisation follows the design, a cache absorbs
//      its hits, and the origin behind a CDN is not the busiest part.
// Usage: node scripts/check-numbers.mjs [path/to/topics.public.json]
import { build } from "esbuild";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = mkdtempSync(join(tmpdir(), "check-numbers-"));
const outfile = join(out, "bundle.mjs");
await build({
  stdin: {
    contents: `export * from "./src/content/formula.ts"; export * from "./src/content/numbers.ts"; export { computeTopologyTelemetry } from "./src/utils/telemetry.ts";`,
    resolveDir: resolve(here, ".."),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "error",
});
const m = await import(pathToFileURL(outfile).href);

let failures = 0;
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

// 1. Formula parity
const cases = JSON.parse(readFileSync(join(root, "tests/formula_cases.json"), "utf8"));
for (const c of cases.cases) {
  const got = m.evalFormula(c.expr, cases.env);
  if (!close(got, c.value)) fail(`formula ${c.expr}: got ${got}, want ${c.value}`);
}
console.log(`formula cases: ${cases.cases.length}`);

// 2. Chapter defaults
const built = process.argv[2] ?? join(root, "data/build/topics.public.json");
if (existsSync(built)) {
  const topics = JSON.parse(readFileSync(built, "utf8"));
  let n = 0;
  for (const [id, t] of Object.entries(topics)) {
    const inputs = Object.fromEntries(t.numbers.inputs.map((i) => [i.id, i.default]));
    const env = m.solveValues(inputs, t.numbers.values);
    for (const [k, v] of Object.entries(t.defaults)) {
      n += 1;
      if (!close(env[k], v)) fail(`${id}.${k}: browser ${env[k]}, server ${v}`);
    }
  }
  console.log(`chapter values compared: ${n}`);
} else {
  console.log(`no compiled content at ${built}; skipping the chapter comparison (run backend/scripts/build_content.py)`);
}

// 3. Telemetry sanity
const node = (id, kind, cap) => ({ id, kind, label: id, specs: cap ? { maxQpsPerNode: cap } : {} });
const edge = (from, to, transport = "sync") => ({ id: `${from}-${to}`, from, to, transport });
{
  const nodes = [node("c", "client"), node("lb", "lb", 50000), node("api", "service", 2000), node("cache", "cache", 100000), node("db", "database", 5000)];
  const edges = [edge("c", "lb"), edge("lb", "api"), edge("api", "cache"), edge("api", "db")];
  const low = m.computeTopologyTelemetry(nodes, edges, [], 1000, 0.9, null);
  const high = m.computeTopologyTelemetry(nodes, edges, [], 4000, 0.9, null);
  if (!close(low.nodeRps.db, 100)) fail(`cache-aside: db should see misses only (100), got ${low.nodeRps.db}`);
  if (close(low.nodeUtilization.api, high.nodeUtilization.api)) fail("utilisation must follow the ingress rate");
  if (high.bottleneckNodeId !== "api") fail(`busiest at 4k rps should be api, got ${high.bottleneckNodeId}`);
  if (high.healthTier !== "saturated") fail(`api at 200% should be saturated, got ${high.healthTier}`);
}
{
  const nodes = [node("c", "client"), node("cdn", "cdn", 1000000), node("origin", "service", 3000)];
  const t = m.computeTopologyTelemetry(nodes, [edge("c", "cdn"), edge("cdn", "origin")], [], 20000, 0.95, null);
  if (!close(t.nodeRps.origin, 1000)) fail(`origin behind a CDN should see 1000 rps, got ${t.nodeRps.origin}`);
}
{
  // GB labels are decimal.
  if (m.formatBytes(1e9) !== "1 GB") fail(`formatBytes(1e9) = ${m.formatBytes(1e9)}`);
  if (m.formatBytes(11e12) !== "11 TB") fail(`formatBytes(11e12) = ${m.formatBytes(11e12)}`);
}
console.log("telemetry checks: 4");

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("numbers agree");

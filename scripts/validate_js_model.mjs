import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
require("../extension/lib/phishingan.js");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "extension/model/model.json"), "utf8"));
globalThis.PhishinGAN.setModel(model);

const casesPath = path.join(root, "reports/js_validation.json");
if (!fs.existsSync(casesPath)) {
  console.error(
    "missing reports/js_validation.json\n" +
      "Generate it first (needs the processed dataset):\n" +
      "  phishingan build-data\n" +
      "  PYTHONPATH=src python scripts/make_js_validation.py"
  );
  process.exit(2);
}

const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const diffs = [];
for (const item of cases) {
  const actual = globalThis.PhishinGAN.scoreText(item.text).probability;
  const diff = Math.abs(actual - item.expected);
  diffs.push({ diff, expected: item.expected, actual, title: item.title || item.source });
}
diffs.sort((a, b) => b.diff - a.diff);
const max = diffs[0];
const mean = diffs.reduce((sum, item) => sum + item.diff, 0) / diffs.length;
const p95 = diffs[Math.floor(diffs.length * 0.05)].diff;

console.log(`cases: ${diffs.length}`);
console.log(`mean abs diff: ${mean.toExponential(3)}`);
console.log(`p95 abs diff:  ${p95.toExponential(3)}`);
console.log(`max abs diff:  ${max.diff.toExponential(3)}`);
console.log("worst 5:");
for (const item of diffs.slice(0, 5)) {
  console.log(
    `  ${item.diff.toExponential(2)}  expected=${item.expected.toFixed(4)} actual=${item.actual.toFixed(4)}  ${item.title}`
  );
}
if (max.diff > 0.02) {
  console.error("PARITY FAILED: max diff > 0.02");
  process.exit(1);
}
console.log("PARITY OK");

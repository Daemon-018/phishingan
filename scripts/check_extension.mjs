import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
require("../extension/lib/phishingan.js");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "extension/model/model.json"), "utf8"));
globalThis.PhishinGAN.setModel(model);

const datasetPath = path.join(root, "data/processed/dataset.csv");
if (!fs.existsSync(datasetPath)) {
  console.error("missing dataset; run `phishingan build-data` first");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const raw = fs.readFileSync(datasetPath, "utf8");
const table = parseCsv(raw);
const header = table[0];
const idx = Object.fromEntries(header.map((name, i) => [name, i]));
const testRows = table
  .slice(1)
  .filter((row) => row[idx.split] === "test")
  .map((row) => ({
    text: row[idx.text],
    label: Number(row[idx.label]),
    source: row[idx.source],
  }));

const perSource = Number(process.env.PER_SOURCE || 120);
const samples = [];
for (const source of ["classic", "llm"]) {
  for (const label of [0, 1]) {
    const bucket = testRows.filter((row) => row.source === source && row.label === label);
    const step = Math.max(1, Math.floor(bucket.length / perSource));
    for (let i = 0; i < bucket.length && samples.length < 100000; i += step) {
      samples.push(bucket[i]);
    }
  }
}

function pagePayload(text) {
  return {
    url: "https://mail.google.com/mail/u/0/#inbox/example",
    hostname: "mail.google.com",
    title: "Inbox message",
    text: text.slice(0, 8000),
    links: [],
    forms: [],
  };
}

function pageModePayload(text) {
  return {
    url: "https://example.com/login",
    hostname: "example.com",
    title: "Account sign in",
    text: text.slice(0, 8000),
    links: [],
    forms: [],
  };
}

function evaluate(mode) {
  const stats = { email: {}, page: {} };
  for (const source of ["classic", "llm"]) {
    for (const label of [0, 1]) {
      stats.email[`${source}_${label}`] = { tp: 0, fp: 0, tn: 0, fn: 0, n: 0 };
      stats.page[`${source}_${label}`] = { tp: 0, fp: 0, tn: 0, fn: 0, n: 0 };
    }
  }

  const started = process.hrtime.bigint();
  for (const sample of samples) {
    const emailResult = globalThis.PhishinGAN.scanPage(pagePayload(sample.text));
    const pageResult = globalThis.PhishinGAN.scanPage(pageModePayload(sample.text));
    for (const [key, result] of [
      ["email", emailResult],
      ["page", pageResult],
    ]) {
      const bucket = stats[key][`${sample.source}_${sample.label}`];
      bucket.n += 1;
      const flagged = result.verdict !== "legitimate";
      if (sample.label === 1) {
        if (flagged) bucket.tp += 1;
        else bucket.fn += 1;
      } else if (flagged) {
        bucket.fp += 1;
      } else {
        bucket.tn += 1;
      }
    }
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return { stats, elapsedMs, perScanMs: elapsedMs / (samples.length * 2) };
}

const { stats, perScanMs } = evaluate();

function summarize(name) {
  for (const source of ["classic", "llm"]) {
    const pos = stats[name][`${source}_1`];
    const neg = stats[name][`${source}_0`];
    const recall = pos.tp / Math.max(1, pos.tp + pos.fn);
    const fpr = neg.fp / Math.max(1, neg.fp + neg.tn);
    const precision = pos.tp / Math.max(1, pos.tp + neg.fp);
    console.log(
      `${name.padEnd(6)} ${source.padEnd(8)} n=${pos.n + neg.n}  recall=${recall.toFixed(3)}  FPR=${fpr.toFixed(3)}  precision=${precision.toFixed(3)}`
    );
  }
}

console.log(`samples per bucket: ${samples.length / 4}`);
summarize("email");
summarize("page");
console.log(`per scan: ${perScanMs.toFixed(1)} ms`);

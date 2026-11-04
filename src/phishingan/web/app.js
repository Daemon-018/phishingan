const els = {
  input: document.getElementById("messageInput"),
  charCount: document.getElementById("charCount"),
  chips: document.getElementById("sampleChips"),
  button: document.getElementById("scanBtn"),
  error: document.getElementById("errorBox"),
  empty: document.getElementById("emptyState"),
  result: document.getElementById("resultContent"),
  gauge: document.getElementById("gaugeFill"),
  risk: document.getElementById("riskScore"),
  badge: document.getElementById("verdictBadge"),
  title: document.getElementById("verdictTitle"),
  detail: document.getElementById("verdictDetail"),
  stats: document.getElementById("statLine"),
  modelValue: document.getElementById("modelValue"),
  modelBar: document.getElementById("modelBar"),
  ruleValue: document.getElementById("ruleValue"),
  ruleBar: document.getElementById("ruleBar"),
  reasons: document.getElementById("reasonList"),
  reasonCount: document.getElementById("reasonCount"),
  urlSection: document.getElementById("urlSection"),
  urlList: document.getElementById("urlList"),
  sentenceSection: document.getElementById("sentenceSection"),
  sentenceList: document.getElementById("sentenceList"),
  highlightSection: document.getElementById("highlightSection"),
  highlighted: document.getElementById("highlightedText"),
  rawSection: document.getElementById("rawSection"),
  rawJson: document.getElementById("rawJson"),
  rawToggle: document.getElementById("rawToggle"),
};

const VERDICTS = {
  phishing: {
    title: "Likely phishing",
    detail: "Several independent signals point to a credential or payment trap. Do not click the links or reply.",
    className: "verdict-phishing",
  },
  suspicious: {
    title: "Suspicious",
    detail: "Some signals look wrong, but the evidence is mixed. Verify the sender through a channel you already trust.",
    className: "verdict-suspicious",
  },
  legitimate: {
    title: "Looks legitimate",
    detail: "No strong phishing pattern was found. Stay careful with unexpected attachments and links.",
    className: "verdict-legitimate",
  },
};

const CIRCUMFERENCE = 2 * Math.PI * 52;
let lastResult = null;
let samples = [];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function updateCount() {
  const count = els.input.value.length;
  els.charCount.textContent = `${count.toLocaleString()} char${count === 1 ? "" : "s"}`;
}

async function loadSamples() {
  try {
    const response = await fetch("/api/samples");
    const data = await response.json();
    samples = data.samples || [];
    samples.forEach((sample, index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = sample.title;
      chip.title = sample.tag;
      chip.addEventListener("click", () => {
        document.querySelectorAll(".chip").forEach((node) => node.classList.remove("active"));
        chip.classList.add("active");
        els.input.value = sample.text;
        updateCount();
        els.input.focus();
      });
      els.chips.appendChild(chip);
    });
  } catch (error) {
    console.warn("samples unavailable", error);
  }
}

function setBars(result) {
  const modelPct = result.model.available ? Math.round(result.model.probability * 100) : 0;
  const rulePct = Math.round(result.rules.score * 100);
  els.modelValue.textContent = result.model.available ? `${modelPct}%` : "not loaded";
  els.ruleValue.textContent = `${rulePct}%`;
  els.modelBar.style.width = `${modelPct}%`;
  els.ruleBar.style.width = `${rulePct}%`;
}

function renderReasons(reasons) {
  els.reasons.replaceChildren();
  els.reasonCount.textContent = `${reasons.length} signal${reasons.length === 1 ? "" : "s"}`;
  reasons.forEach((reason) => {
    const li = document.createElement("li");
    li.className = "reason";
    li.dataset.category = reason.category;

    const icon = document.createElement("span");
    icon.className = "reason-icon";
    icon.textContent = { content: "TXT", url: "URL", model: "ML", sentence: "SEN" }[reason.category] || "SIG";

    const body = document.createElement("div");
    body.className = "reason-body";
    const label = document.createElement("strong");
    label.textContent = reason.label;
    const detail = document.createElement("p");
    detail.textContent = reason.detail;
    body.append(label, detail);

    const meter = document.createElement("div");
    meter.className = "reason-meter";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(8, reason.strength)}%`;
    meter.appendChild(fill);

    li.append(icon, body, meter);
    els.reasons.appendChild(li);
  });
}

function renderUrls(urls) {
  els.urlSection.hidden = urls.length === 0;
  els.urlList.replaceChildren();
  urls.forEach((url) => {
    const card = document.createElement("div");
    card.className = "url-item";

    const top = document.createElement("div");
    top.className = "url-top";
    const text = document.createElement("span");
    text.className = "url-text";
    text.textContent = url.defanged;
    const risk = document.createElement("span");
    risk.className = "url-risk";
    risk.textContent = `risk ${url.risk}`;
    top.append(text, risk);

    const flags = document.createElement("div");
    flags.className = "url-flags";
    if (url.flags.length === 0) {
      const flag = document.createElement("span");
      flag.className = "flag";
      flag.style.color = "var(--muted)";
      flag.style.borderColor = "var(--border)";
      flag.style.background = "transparent";
      flag.textContent = "no structural red flags";
      flags.appendChild(flag);
    } else {
      url.flags.forEach((item) => {
        const flag = document.createElement("span");
        flag.className = "flag";
        flag.textContent = item.label;
        flags.appendChild(flag);
      });
    }

    card.append(top, flags);
    els.urlList.appendChild(card);
  });
}

function renderSentences(sentences) {
  els.sentenceSection.hidden = sentences.length === 0;
  els.sentenceList.replaceChildren();
  sentences.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.text;
    els.sentenceList.appendChild(li);
  });
}

function renderHighlighted(text, spans) {
  els.highlightSection.hidden = spans.length === 0;
  if (spans.length === 0) {
    els.highlighted.textContent = "";
    return;
  }
  let html = "";
  let cursor = 0;
  spans.forEach((span) => {
    if (span.start < cursor) return;
    html += escapeHtml(text.slice(cursor, span.start));
    html += `<mark>${escapeHtml(text.slice(span.start, span.end))}</mark>`;
    cursor = span.end;
  });
  html += escapeHtml(text.slice(cursor));
  els.highlighted.innerHTML = html;
}

function render(result) {
  lastResult = result;
  const config = VERDICTS[result.verdict] || VERDICTS.suspicious;

  els.empty.hidden = true;
  els.result.hidden = false;

  els.risk.textContent = result.risk_score;
  els.gauge.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - result.risk_score / 100));
  els.gauge.classList.remove("stroke-phishing", "stroke-suspicious", "stroke-legitimate");
  els.gauge.classList.add(`stroke-${result.verdict}`);

  els.badge.textContent = result.verdict;
  els.badge.className = `verdict-badge ${config.className}`;
  els.title.textContent = config.title;
  els.title.className = config.className;
  els.detail.textContent = result.model.available
    ? config.detail
    : `${config.detail} The ML model is not loaded, so this verdict comes from rules only.`;

  els.stats.innerHTML = [
    `<span><b>${result.stats.words.toLocaleString()}</b> words</span>`,
    `<span><b>${result.stats.links}</b> links</span>`,
    `<span><b>${result.confidence}%</b> confidence</span>`,
    `<span>threshold <b>${Math.round(result.model.threshold * 100)}%</b></span>`,
  ].join("");

  setBars(result);
  renderReasons(result.reasons);
  renderUrls(result.urls);
  renderSentences(result.suspicious_sentences);
  renderHighlighted(result.text, result.highlights);

  els.rawJson.textContent = JSON.stringify(result, null, 2);
  els.rawSection.hidden = !els.rawToggle.checked;
}

async function scan() {
  const text = els.input.value.trim();
  els.error.hidden = true;
  if (text.length < 10) {
    els.error.textContent = "Paste at least a sentence so the detector has something to analyse.";
    els.error.hidden = false;
    return;
  }

  els.button.disabled = true;
  els.button.querySelector("span").textContent = "Analyzing…";
  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "The scan failed.");
    }
    render(data);
  } catch (error) {
    els.error.textContent = error.message || "The scan failed. Try again.";
    els.error.hidden = false;
  } finally {
    els.button.disabled = false;
    els.button.querySelector("span").textContent = "Analyze message";
  }
}

els.button.addEventListener("click", scan);
els.input.addEventListener("input", updateCount);
els.rawToggle.addEventListener("change", () => {
  els.rawSection.hidden = !els.rawToggle.checked;
});
els.input.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    scan();
  }
});

updateCount();
loadSamples();

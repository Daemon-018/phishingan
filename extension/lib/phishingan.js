/*
 * PhishinGAN local scoring engine.
 *
 * Reproduces the Python TF-IDF + logistic-regression pipeline in plain
 * JavaScript. No network calls, no API keys, no tokens.
 *
 * Load with:
 *   <script src="lib/phishingan.js"></script>
 *   await PhishinGAN.loadModel("model/model.json");
 */
(function (root) {
  "use strict";

  const VERSION = 1;
  let MODEL = null;

  const TLD_PATTERN =
    "com|net|org|io|co|ai|app|dev|info|biz|online|site|website|shop|store|" +
    "xyz|top|club|live|icu|vip|work|link|click|support|help|finance|bank|" +
    "secure|account|update|verify|zip|mov|cam|rest|fit|buzz|monster|quest|" +
    "sbs|cfd|lgbt|gq|tk|ml|cf|ga|gov|edu|mil|int|us|uk|in|au|ca|de|fr|es|" +
    "it|nl|ru|cn|jp|br|za|ae|sg|example";

  const URL_RE = new RegExp(
    "(?:" +
      "https?:\\/\\/[^\\s<>\"')\\]]+" +
      "|www\\.[^\\s<>\"')\\]]+" +
      "|(?<![\\w@.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:" +
      TLD_PATTERN +
      ")(?:\\/[^\\s<>\"')\\]]*)?)" ,
    "gi"
  );

  const TRAILING = /[.,;:!?)\]}'"]+$/;
  const EMAIL_HOSTS = [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "mail.yahoo.com",
    "mail.proton.me",
    "mail.zoho.com",
  ];
  const FEATURE_LABELS = {};
  const MULTI_LABEL_SUFFIXES = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "co.in", "net.in", "org.in",
    "co.jp", "ne.jp", "or.jp", "com.au", "net.au", "org.au", "com.br",
    "com.mx", "com.sg", "com.hk", "com.tw", "co.za", "co.nz", "co.kr",
    "com.tr", "com.ar", "com.cn", "com.my", "co.id", "co.th", "com.ph",
    "com.vn", "com.pk", "com.sa", "com.eg",
  ]);

  /* ------------------------------------------------------------------ */
  /* small utilities                                                     */
  /* ------------------------------------------------------------------ */

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripAccents(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function preprocess(value) {
    return stripAccents(String(value == null ? "" : value).toLowerCase());
  }

  function sigmoid(value) {
    if (value >= 0) {
      const z = Math.exp(-value);
      return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
  }

  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    return haystack.split(needle).length - 1;
  }

  function countTermHits(lower, terms) {
    let total = 0;
    for (const term of terms || []) {
      if (term.includes(" ")) {
        total += countOccurrences(lower, term);
      } else {
        const matches = lower.match(
          new RegExp("\\b" + escapeRegExp(term) + "\\b", "g")
        );
        total += matches ? matches.length : 0;
      }
    }
    return total;
  }

  function splitSentences(text) {
    const value = String(text || "");
    const parts = value
      .split(/(?<=[.!?])\s+|\n{2,}/)
      .map((part) => part.trim())
      .filter((part) => part.length > 3);
    if (parts.length) return parts;
    return value.trim() ? [value.trim()] : [];
  }

  function shannonEntropy(value) {
    if (!value) return 0;
    const counts = new Map();
    for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / value.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 3;
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        const insert = current[j - 1] + 1;
        const del = previous[j] + 1;
        const replace = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
        current.push(Math.min(insert, del, replace));
      }
      previous = current;
    }
    return previous[b.length];
  }

  function isIpHost(host) {
    if (!host) return false;
    const value = host.replace(/^\[|\]$/g, "");
    if (value.includes(":")) return true;
    const parts = value.split(".");
    return (
      parts.length === 4 &&
      parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    );
  }

  function registrableBase(host) {
    const labels = String(host || "").toLowerCase().split(".").filter(Boolean);
    if (labels.length < 2) return labels[0] || "";
    if (
      labels.length >= 3 &&
      MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join("."))
    ) {
      return labels[labels.length - 3];
    }
    return labels[labels.length - 2];
  }

  function ownsBrand(host, brand) {
    const map = (MODEL && MODEL.url && MODEL.url.brand_domains) || {};
    const domains = map[brand] || [brand + ".com"];
    if (domains.some((domain) => host === domain || host.endsWith("." + domain))) {
      return true;
    }
    // Country sites such as google.co.in and paypal.de.
    return registrableBase(host) === brand;
  }

  function brandImpersonation(host, brands) {
    const labels = host.split(".").filter(Boolean);
    if (labels.length < 2) return null;
    const base = labels[labels.length - 2];
    for (const brand of brands || []) {
      if (ownsBrand(host, brand)) continue;
      if (host.includes(brand)) return brand;
      if (Math.abs(base.length - brand.length) <= 2 && levenshtein(base, brand) <= 1) {
        return brand;
      }
    }
    return null;
  }

  function registrableDomain(host) {
    const labels = String(host || "").toLowerCase().split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    if (MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join("."))) {
      return labels.slice(-3).join(".");
    }
    return labels.slice(-2).join(".");
  }

  /* ------------------------------------------------------------------ */
  /* URL extraction and scoring                                          */
  /* ------------------------------------------------------------------ */

  function extractUrls(text, limit) {
    const max = limit || 20;
    const seen = new Set();
    const urls = [];
    if (!text) return urls;
    URL_RE.lastIndex = 0;
    let match;
    while ((match = URL_RE.exec(text)) !== null) {
      const url = match[0].replace(TRAILING, "");
      if (url.length < 4) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(url);
      if (urls.length >= max) break;
    }
    return urls;
  }

  function analyzeUrl(raw, config) {
    const cfg = config || (MODEL && MODEL.url) || {};
    const shorteners = new Set(cfg.shorteners || []);
    const suspiciousTlds = new Set(cfg.suspicious_tlds || []);
    const brands = cfg.brands || [];

    const url = String(raw || "").trim().replace(TRAILING, "");
    const candidate = /^https?:\/\//i.test(url) ? url : "http://" + url;
    let parsed = null;
    try {
      parsed = new URL(candidate);
    } catch (error) {
      parsed = null;
    }

    const host = parsed ? parsed.hostname.toLowerCase().replace(/^\.+|\.+$/g, "") : "";
    const scheme = parsed ? parsed.protocol.replace(":", "").toLowerCase() : "";
    const labels = host.split(".").filter(Boolean);
    const tld = labels.length ? labels[labels.length - 1] : "";
    const isIp = isIpHost(host);
    const brand = host ? brandImpersonation(host, brands) : null;
    const hyphens = (host.match(/-/g) || []).length;
    const subdomains = Math.max(0, labels.length - 2);
    const entropy = shannonEntropy(host);
    const path = parsed ? parsed.pathname : "";
    const port = parsed ? parsed.port : "";

    const flags = [];
    const add = (code, label, points) => flags.push({ code, label, points });

    if (isIp) add("ip_host", "Link uses a raw IP address instead of a domain", 3);
    if (host.includes("xn--")) add("punycode", "Link uses punycode, often used to fake a brand", 3);
    if (shorteners.has(host)) add("shortener", "Link is hidden behind a URL shortener", 1);
    if (suspiciousTlds.has(tld)) add("tld", "Link uses a high-abuse top-level domain (." + tld + ")", 2);
    if (brand) add("brand", "Link imitates the brand “" + brand + "”", 3);
    if (url.includes("@")) add("userinfo", "Link contains an @ trick that hides the real host", 2);
    if (port && port !== "80" && port !== "443") add("port", "Link uses an unusual port (" + port + ")", 1);
    if (scheme === "http") add("plain_http", "Link is unencrypted HTTP", 0.5);
    if (url.length > 75) add("long_url", "Link is unusually long", 1);
    if (host.length > 30) add("long_host", "Link hostname is unusually long", 1);
    if (subdomains >= 3) add("subdomains", "Link stacks many subdomains", 1);
    if (hyphens >= 2) add("hyphens", "Link hostname contains several hyphens", 1);
    if ((host.match(/\d/g) || []).length >= 4) add("digits", "Link hostname contains many digits", 1);
    if (path.length > 60) add("long_path", "Link path is unusually long or encoded", 0.5);

    const points = Math.min(8, flags.reduce((sum, flag) => sum + flag.points, 0));
    return {
      url,
      defanged: defang(url),
      host,
      tld,
      points: Math.round(points * 100) / 100,
      flags,
      features: {
        length: url.length,
        host_length: host.length,
        entropy: Math.round(entropy * 1000) / 1000,
        subdomains,
        hyphens,
        is_ip: isIp ? 1 : 0,
        is_punycode: host.includes("xn--") ? 1 : 0,
        is_shortener: shorteners.has(host) ? 1 : 0,
        is_suspicious_tld: suspiciousTlds.has(tld) ? 1 : 0,
        has_brand: brand ? 1 : 0,
        is_http: scheme === "http" ? 1 : 0,
        has_at: url.includes("@") ? 1 : 0,
      },
    };
  }

  function defang(url) {
    return String(url)
      .replace(/https:\/\//gi, "hxxps://")
      .replace(/http:\/\//gi, "hxxp://")
      .replace(/\./g, "[.]")
      .replace(/@/g, "[@]");
  }

  function urlFeatures(urls, config) {
    const infos = (urls || []).map((url) => analyzeUrl(url, config));
    const out = {
      url_count: 0,
      url_max_points: 0,
      url_total_points: 0,
      url_ip_count: 0,
      url_punycode_count: 0,
      url_shortener_count: 0,
      url_suspicious_tld_count: 0,
      url_brand_count: 0,
      url_http_count: 0,
      url_at_count: 0,
      url_max_length: 0,
      url_max_host_length: 0,
      url_max_entropy: 0,
      url_max_subdomains: 0,
      url_max_hyphens: 0,
    };
    if (!infos.length) return out;
    out.url_count = infos.length;
    out.url_max_points = Math.max(...infos.map((info) => info.points));
    out.url_total_points = infos.reduce((sum, info) => sum + info.points, 0);
    out.url_ip_count = infos.reduce((sum, info) => sum + info.features.is_ip, 0);
    out.url_punycode_count = infos.reduce((sum, info) => sum + info.features.is_punycode, 0);
    out.url_shortener_count = infos.reduce((sum, info) => sum + info.features.is_shortener, 0);
    out.url_suspicious_tld_count = infos.reduce(
      (sum, info) => sum + info.features.is_suspicious_tld,
      0
    );
    out.url_brand_count = infos.reduce((sum, info) => sum + info.features.has_brand, 0);
    out.url_http_count = infos.reduce((sum, info) => sum + info.features.is_http, 0);
    out.url_at_count = infos.reduce((sum, info) => sum + info.features.has_at, 0);
    out.url_max_length = Math.max(...infos.map((info) => info.features.length));
    out.url_max_host_length = Math.max(...infos.map((info) => info.features.host_length));
    out.url_max_entropy = Math.max(...infos.map((info) => info.features.entropy));
    out.url_max_subdomains = Math.max(...infos.map((info) => info.features.subdomains));
    out.url_max_hyphens = Math.max(...infos.map((info) => info.features.hyphens));
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* TF-IDF blocks                                                       */
  /* ------------------------------------------------------------------ */

  function sklearnTokens(text) {
    const matches = preprocess(text).match(/[\p{L}\p{N}_]{2,}/gu);
    return matches || [];
  }

  function wordCounts(text) {
    const tokens = sklearnTokens(text);
    const counts = new Map();
    for (let n = 1; n <= 2; n += 1) {
      for (let i = 0; i + n <= tokens.length; i += 1) {
        const gram = tokens.slice(i, i + n).join(" ");
        counts.set(gram, (counts.get(gram) || 0) + 1);
      }
    }
    return counts;
  }

  function charWbCounts(text, minN, maxN) {
    // The trained char vectorizer lowercases but does not strip accents.
    const doc = String(text == null ? "" : text).toLowerCase().replace(/\s+/g, " ").trim();
    const counts = new Map();
    if (!doc) return counts;
    const trigger = (gram) => counts.set(gram, (counts.get(gram) || 0) + 1);
    for (const word of doc.split(" ")) {
      if (!word) continue;
      const padded = " " + word + " ";
      for (let n = minN; n <= maxN; n += 1) {
        let offset = 0;
        trigger(padded.slice(offset, offset + n));
        while (offset + n < padded.length) {
          offset += 1;
          trigger(padded.slice(offset, offset + n));
        }
        if (offset === 0) break;
      }
    }
    return counts;
  }

  function tfidfBlock(counts, block) {
    const index = block._index;
    const values = [];
    for (const [term, count] of counts) {
      const position = index.get(term);
      if (position === undefined) continue;
      const tf = 1 + Math.log(count);
      values.push([position, tf * block.idf[position]]);
    }
    let norm = 0;
    for (const [, value] of values) norm += value * value;
    norm = Math.sqrt(norm);
    let dot = 0;
    const contributions = [];
    if (norm > 0) {
      for (const [position, value] of values) {
        const normalized = value / norm;
        const contribution = normalized * block.coef[position];
        dot += contribution;
        contributions.push({ term: block.terms[position], score: contribution });
      }
    }
    return { dot, contributions };
  }

  /* ------------------------------------------------------------------ */
  /* Handcrafted features                                                */
  /* ------------------------------------------------------------------ */

  function extractFeatures(text) {
    const value = String(text || "");
    const lower = value.toLowerCase();
    const wordList = lower.match(/[a-z']+/g) || [];
    const sentences = splitSentences(value);
    const sentenceLengths = sentences.length
      ? sentences.map((sentence) => (sentence.match(/[A-Za-z']+/g) || []).length)
      : [0];

    const nWords = wordList.length;
    const nSentences = sentences.length;
    const meanLength =
      sentenceLengths.reduce((sum, length) => sum + length, 0) /
      Math.max(1, sentenceLengths.length);
    const variance =
      sentenceLengths.reduce((sum, length) => sum + (length - meanLength) ** 2, 0) /
      Math.max(1, sentenceLengths.length);
    const stdLength = Math.sqrt(variance);
    const burstiness = meanLength ? stdLength / meanLength : 0;

    const uniqueRatio =
      new Set(wordList.slice(0, 300)).size / Math.max(1, Math.min(wordList.length, 300));
    const alphaChars = value.match(/\p{L}/gu) || [];
    const uppercaseRatio = alphaChars.length
      ? alphaChars.filter((char) => char === char.toUpperCase() && char !== char.toLowerCase()).length /
        alphaChars.length
      : 0;

    const feats = {
      n_chars: value.length,
      n_words: nWords,
      n_sentences: nSentences,
      avg_sentence_words: meanLength,
      std_sentence_words: stdLength,
      burstiness,
      type_token_ratio: uniqueRatio,
      avg_word_length: wordList.length
        ? wordList.reduce((sum, word) => sum + word.length, 0) / wordList.length
        : 0,
      uppercase_ratio: uppercaseRatio,
      digit_ratio: (value.match(/[0-9]/g) || []).length / Math.max(1, value.length),
      punctuation_ratio:
        (value.match(/[^\p{L}\p{N}\s]/gu) || []).length / Math.max(1, value.length),
      exclaim_count: (value.match(/!/g) || []).length,
      question_count: (value.match(/\?/g) || []).length,
      newline_count: (value.match(/\n/g) || []).length,
      email_address_count: (value.match(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g) || []).length,
      has_html: /<(?:html|body|a\s|div|table)\b/i.test(value) ? 1 : 0,
    };

    const lexicons = (MODEL && MODEL.lexicons) || {};
    for (const [category, terms] of Object.entries(lexicons)) {
      const hits = countTermHits(lower, terms);
      feats["lex_" + category + "_hits"] = hits;
      feats["lex_" + category + "_rate"] = (hits * 100) / Math.max(1, nWords);
    }

    Object.assign(feats, urlFeatures(extractUrls(value), MODEL && MODEL.url));
    return feats;
  }

  function handBlock(feats) {
    const names = MODEL.hand.names;
    const mean = MODEL.hand.mean;
    const scale = MODEL.hand.scale;
    const coef = MODEL.hand.coef;
    const labels = MODEL.hand.labels || FEATURE_LABELS;
    let dot = 0;
    const contributions = [];
    for (let i = 0; i < names.length; i += 1) {
      const raw = Number(feats[names[i]] || 0);
      const standardized = (raw - mean[i]) / (scale[i] || 1);
      const contribution = standardized * coef[i];
      dot += contribution;
      contributions.push({
        name: names[i],
        label: labels[names[i]] || names[i].replace(/_/g, " "),
        score: contribution,
      });
    }
    return { dot, contributions };
  }

  /* ------------------------------------------------------------------ */
  /* Rules                                                               */
  /* ------------------------------------------------------------------ */

  function ruleSignals(feats) {
    const signals = [];
    const add = (key, label, weight, detail) => {
      if (weight <= 0) return;
      signals.push({
        key,
        category: "content",
        label,
        weight: Math.round(weight * 100) / 100,
        detail,
      });
    };

    const cred = feats.lex_credential_hits || 0;
    if (cred >= 2) add("credential", "Requests credentials or payment data", 3, Math.round(cred) + " credential-related phrases found");
    else if (cred >= 1) add("credential", "Mentions account verification", 1.5, "1 credential-related phrase found");

    const urgency = feats.lex_urgency_hits || 0;
    if (urgency >= 2) add("urgency", "Creates artificial urgency", 2, Math.round(urgency) + " urgency phrases found");
    else if (urgency >= 1) add("urgency", "Mild urgency language", 1, "1 urgency phrase found");

    const threat = feats.lex_threat_hits || 0;
    if (threat >= 2) add("threat", "Threatens account loss or suspension", 2, Math.round(threat) + " threat phrases found");
    else if (threat >= 1) add("threat", "Hints at account consequences", 1, "1 threat phrase found");

    const reward = feats.lex_reward_hits || 0;
    if (reward >= 2) add("reward", "Promises a prize, refund or reward", 1.5, Math.round(reward) + " reward phrases found");
    else if (reward >= 1) add("reward", "Mentions a reward or refund", 0.75, "1 reward phrase found");

    const cta = feats.lex_cta_hits || 0;
    if (cta >= 2) add("cta", "Pushes a specific click or download action", 1, Math.round(cta) + " calls to action");
    else if (cta >= 1) add("cta", "Contains a call to action", 0.5, "1 call to action");

    const greeting = feats.lex_generic_greeting_hits || 0;
    if (greeting >= 1) add("generic_greeting", "Uses a generic greeting instead of your name", 0.75, "No personal salutation");

    const ai = feats.lex_ai_phrases_hits || 0;
    if (ai >= 2) add("ai_phrases", "Uses polished LLM-style stock phrases", 0.75, Math.round(ai) + " stock phrases found");
    else if (ai >= 1) add("ai_phrases", "Mild LLM-style phrasing", 0.35, "1 stock phrase found");

    const urlPoints = feats.url_total_points || 0;
    if (urlPoints) add("urls", "Contains links with risky structure", Math.min(4, urlPoints / 2), Math.round(feats.url_count || 0) + " link(s) scored by URL rules");

    if ((feats.uppercase_ratio || 0) > 0.18) add("caps", "Uses excessive capitals", 0.5, "More than 18% of letters are uppercase");
    if ((feats.exclaim_count || 0) >= 3) add("exclaim", "Uses repeated exclamation marks", 0.5, Math.round(feats.exclaim_count) + " exclamation marks");
    if (feats.has_html) add("html", "Contains HTML markup", 0.25, "HTML email body detected");

    return signals;
  }

  function pageSignals(payload, urlInfos, config) {
    const signals = [];
    const forms = payload.forms || [];
    const passwordForms = forms.filter((form) => form.hasPassword);
    const host = String(payload.hostname || "").toLowerCase();
    const title = String(payload.title || "").toLowerCase();
    const brands = (config && config.brands) || [];
    const brandInTitle = brands.find((brand) => title.includes(brand));
    const brandInHost = brands.find((brand) => ownsBrand(host, brand));
    const secure =
      String(payload.url || "").toLowerCase().startsWith("https:") ||
      payload.secure === true;
    const pageHost = (() => {
      try {
        return new URL(String(payload.url || "")).hostname.toLowerCase();
      } catch (error) {
        return host;
      }
    })();
    const pageInfo = urlInfos.find(
      (info) => info.host === pageHost || info.host === host
    );
    const add = (key, label, weight, detail) => {
      signals.push({ key, category: "page", label, weight, detail });
    };

    if (passwordForms.length && passwordForms.some((form) => form.crossOrigin)) {
      add(
        "cross_origin_password",
        "Password form posts to a different website",
        3.5,
        "A login form on this page sends data to another origin."
      );
    }
    if (passwordForms.length && brandInTitle && !brandInHost) {
      add(
        "brand_mismatch",
        "Login page imitates a brand it does not belong to",
        3,
        "The page title mentions “" + brandInTitle + "” but the domain does not."
      );
    }
    if (passwordForms.length && !secure) {
      add("insecure_login", "Login form on an insecure page", 1, "The page is not served over HTTPS.");
    }
    if (passwordForms.length && pageInfo && pageInfo.features.is_punycode) {
      add("punycode_login", "Login page uses a punycode domain", 3, "Punycode can disguise a look-alike brand.");
    }
    if (
      passwordForms.length &&
      pageInfo &&
      pageInfo.flags.some((flag) => flag.code === "brand")
    ) {
      const brandFlag = pageInfo.flags.find((flag) => flag.code === "brand");
      add(
        "brand_host",
        "Login form on a look-alike domain",
        3.5,
        brandFlag ? brandFlag.label + "." : "The domain imitates a known brand."
      );
    }
    if (passwordForms.length && pageInfo && pageInfo.features.is_suspicious_tld) {
      add("cheap_tld_login", "Login form on a high-abuse domain", 1.5, "Credential pages on cheap TLDs are common in phishing kits.");
    }
    if (forms.some((form) => form.method === "post" && form.crossOrigin && form.hasPassword)) {
      add("credential_post", "Credentials are posted off-site", 0.75, "Cross-origin POST from a login form.");
    }

    return signals;
  }

  /* ------------------------------------------------------------------ */
  /* Model loading and scoring                                           */
  /* ------------------------------------------------------------------ */

  function setModel(data) {
    MODEL = data;
    MODEL.word._index = new Map(data.word.terms.map((term, index) => [term, index]));
    MODEL.char._index = new Map(data.char.terms.map((term, index) => [term, index]));
    return MODEL;
  }

  async function loadModel(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("could not load PhishinGAN model");
    return setModel(await response.json());
  }

  function scoreText(text) {
    if (!MODEL) throw new Error("PhishinGAN model is not loaded");
    const feats = extractFeatures(text);
    const word = tfidfBlock(wordCounts(text), MODEL.word);
    const char = tfidfBlock(charWbCounts(String(text).slice(0, 4000), 3, 4), MODEL.char);
    const hand = handBlock(feats);
    const logit = MODEL.intercept + word.dot + char.dot + hand.dot;
    return {
      probability: sigmoid(logit),
      logit,
      feats,
      word,
      char,
      hand,
    };
  }

  function topContributions(contributions, count, minimum) {
    return contributions
      .filter((item) => item.score > (minimum || 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, count);
  }

  function lexiconHits(text) {
    const lower = String(text || "").toLowerCase();
    const hits = [];
    for (const [category, terms] of Object.entries((MODEL && MODEL.lexicons) || {})) {
      for (const term of terms) {
        const pattern = term.includes(" ")
          ? escapeRegExp(term)
          : "\\b" + escapeRegExp(term) + "\\b";
        if (new RegExp(pattern, "i").test(lower)) {
          hits.push({ term, category });
        }
      }
    }
    return hits;
  }

  function dedupeReasons(reasons) {
    const seen = new Set();
    const unique = [];
    for (const reason of reasons) {
      const key = reason.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(reason);
    }
    return unique;
  }

  function buildResult(probability, feats, rules, options) {
    const opts = options || {};
    const rulePoints = rules.reduce((sum, signal) => sum + signal.weight, 0);
    const ruleScore = Math.min(1, rulePoints / 10);
    const modelWeight = opts.modelWeight == null ? 0.8 : opts.modelWeight;
    const ruleWeight = opts.ruleWeight == null ? 0.2 : opts.ruleWeight;
    const finalScore = modelWeight * probability + ruleWeight * ruleScore;

    const threshold = MODEL.threshold;
    const phishingCut = Math.min(0.85, Math.max(0.5, threshold));
    const suspiciousCut = Math.max(0.25, phishingCut - 0.3);
    let verdict = "legitimate";
    if (finalScore >= phishingCut) verdict = "phishing";
    else if (finalScore >= suspiciousCut) verdict = "suspicious";

    const reasons = [];
    for (const rule of rules) {
      reasons.push({
        category: rule.category || "content",
        label: rule.label,
        detail: rule.detail,
        weight: rule.weight,
      });
    }
    return {
      verdict,
      riskScore: Math.round(finalScore * 100),
      confidence: Math.round(Math.max(finalScore, 1 - finalScore) * 100),
      probability,
      finalScore,
      ruleScore,
      rulePoints,
      reasons,
      feats,
      thresholds: { phishing: phishingCut, suspicious: suspiciousCut },
    };
  }

  function scanText(text, options) {
    if (!MODEL) throw new Error("PhishinGAN model is not loaded");
    const scored = scoreText(text);
    const rules = ruleSignals(scored.feats);
    const base = buildResult(scored.probability, scored.feats, rules, options || {});

    const urls = extractUrls(text).map((url) => analyzeUrl(url));
    const urlFlags = new Map();
    for (const info of urls) {
      for (const flag of info.flags) {
        const current = urlFlags.get(flag.code);
        if (!current || flag.points > current.points) urlFlags.set(flag.code, flag);
      }
    }
    for (const flag of urlFlags.values()) {
      base.reasons.push({
        category: "url",
        label: flag.label,
        detail: "Structural URL signal; the link was not opened.",
        weight: flag.points,
      });
    }

    const terms = topContributions(scored.word.contributions, 5, 0.01);
    for (const item of terms) {
      base.reasons.push({
        category: "model",
        label: "Phishing-associated wording: “" + item.term + "”",
        detail: "This token increases the model's phishing score.",
        weight: Math.min(3, item.score),
      });
    }
    const features = topContributions(scored.hand.contributions, 4, 0.01);
    for (const item of features) {
      base.reasons.push({
        category: "model",
        label: item.label.charAt(0).toUpperCase() + item.label.slice(1),
        detail: "Handcrafted signal weighted toward phishing by the model.",
        weight: Math.min(3, item.score),
      });
    }

    base.reasons = dedupeReasons(base.reasons)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
    const top = base.reasons.length ? base.reasons[0].weight : 1;
    base.reasons.forEach((reason) => {
      reason.strength = Math.round((100 * reason.weight) / Math.max(top, 0.01));
    });

    const highlightTerms = terms.map((item) => item.term);
    highlightTerms.push(...lexiconHits(text).map((hit) => hit.term));

    return {
      verdict: base.verdict,
      risk_score: base.riskScore,
      confidence: base.confidence,
      model: {
        available: true,
        probability: Math.round(scored.probability * 10000) / 10000,
        weight: options && options.modelWeight != null ? options.modelWeight : 0.8,
        threshold: Math.round(base.thresholds.phishing * 10000) / 10000,
        error: null,
      },
      rules: {
        score: Math.round(base.ruleScore * 10000) / 10000,
        points: Math.round(base.rulePoints * 100) / 100,
        weight: options && options.ruleWeight != null ? options.ruleWeight : 0.2,
      },
      reasons: base.reasons,
      urls: urls.map((info) => ({
        url: info.url,
        defanged: info.defanged,
        host: info.host,
        risk: Math.round(Math.min(1, info.points / 8) * 100),
        flags: info.flags,
      })),
      highlights: highlightTerms,
      stats: {
        characters: scored.feats.n_chars,
        words: Math.round(scored.feats.n_words),
        sentences: Math.round(scored.feats.n_sentences),
        links: urls.length,
      },
      thresholds: {
        phishing: Math.round(base.thresholds.phishing * 10000) / 10000,
        suspicious: Math.round(base.thresholds.suspicious * 10000) / 10000,
      },
    };
  }

  function isEmailHost(host) {
    const value = String(host || "").toLowerCase();
    return EMAIL_HOSTS.some((item) => value === item || value.endsWith("." + item));
  }

  function scanPage(payload) {
    if (!MODEL) throw new Error("PhishinGAN model is not loaded");
    const data = payload || {};
    const host = String(data.hostname || "").toLowerCase();
    const emailMode = isEmailHost(host);
    const links = Array.isArray(data.links) ? data.links : [];
    const forms = Array.isArray(data.forms) ? data.forms : [];

    const combined = [
      data.title || "",
      data.text || "",
      links.map((link) => link.href || "").join("\n"),
      forms.map((form) => form.action || "").join("\n"),
    ]
      .join("\n")
      .slice(0, 12000);

    const hasPasswordForm = forms.some((form) => form.hasPassword);
    const loginMode = !emailMode && hasPasswordForm;
    const modelWeight = emailMode ? 0.8 : loginMode ? 0 : 0.7;
    const ruleWeight = emailMode ? 0.2 : loginMode ? 1 : 0.3;
    const textResult = scanText(combined, { modelWeight, ruleWeight });

    const allUrls = [];
    const seen = new Set();
    const candidates = [data.url || ""]
      .concat(extractUrls(combined))
      .concat(links.map((link) => link.href || ""));
    for (const url of candidates) {
      const key = String(url).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      allUrls.push(url);
    }
    const urlInfos = allUrls.map((url) => analyzeUrl(url));
    const extra = pageSignals(
      {
        hostname: host,
        url: data.url,
        secure: data.secure === true,
        title: data.title,
        forms,
      },
      urlInfos,
      MODEL.url
    );
    const extraPoints = extra.reduce((sum, signal) => sum + signal.weight, 0);
    // A login page is supposed to ask for credentials, so the email-trained
    // text model cannot judge it. Judge login pages on domain and form
    // evidence instead; a real paypal.com login must stay quiet.
    const structuralScore = extraPoints
      ? 1 - Math.exp(-extraPoints / 5)
      : 0;
    let finalScore;
    let rulePoints;
    let ruleScore;
    const reasons = [];
    if (loginMode) {
      rulePoints = extraPoints;
      finalScore = structuralScore;
      ruleScore = finalScore;
      for (const signal of extra) {
        reasons.push({
          category: "page",
          label: signal.label,
          detail: signal.detail,
          weight: signal.weight,
        });
      }
    } else {
      rulePoints = textResult.rules.points + extraPoints;
      ruleScore = Math.min(1, rulePoints / 10);
      const textFinal =
        modelWeight * textResult.model.probability + ruleWeight * textResult.rules.score;
      finalScore = Math.max(textFinal, structuralScore);
      reasons.push(...textResult.reasons);
      for (const signal of extra) {
        reasons.push({
          category: "page",
          label: signal.label,
          detail: signal.detail,
          weight: signal.weight,
        });
      }
    }

    const phishingCut = textResult.thresholds.phishing;
    const suspiciousCut = textResult.thresholds.suspicious;
    let verdict = "legitimate";
    if (finalScore >= phishingCut) verdict = "phishing";
    else if (finalScore >= suspiciousCut) verdict = "suspicious";

    const loginUrlCodes = new Set(["brand", "punycode", "tld"]);
    for (const info of urlInfos) {
      for (const flag of info.flags) {
        if (loginMode && !loginUrlCodes.has(flag.code)) continue;
        reasons.push({
          category: "url",
          label: flag.label,
          detail: "Structural URL signal; the link was not opened.",
          weight: flag.points,
        });
      }
    }
    const unique = dedupeReasons(reasons)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10);
    const top = unique.length ? unique[0].weight : 1;
    unique.forEach((reason) => {
      reason.strength = Math.round((100 * reason.weight) / Math.max(top, 0.01));
    });

    return {
      verdict,
      risk_score: Math.round(finalScore * 100),
      confidence: Math.round(Math.max(finalScore, 1 - finalScore) * 100),
      model: {
        available: true,
        probability: Math.round(textResult.model.probability * 10000) / 10000,
        weight: modelWeight,
        threshold: Math.round(phishingCut * 10000) / 10000,
        error: null,
      },
      rules: {
        score: Math.round(ruleScore * 10000) / 10000,
        points: Math.round(rulePoints * 100) / 100,
        weight: ruleWeight,
      },
      reasons: unique,
      urls: urlInfos.map((info) => ({
        url: info.url,
        defanged: info.defanged,
        host: info.host,
        risk: Math.round(Math.min(1, info.points / 8) * 100),
        flags: info.flags,
      })),
      highlights: textResult.highlights,
      stats: {
        characters: textResult.stats.characters,
        words: textResult.stats.words,
        sentences: textResult.stats.sentences,
        links: urlInfos.length,
        forms: forms.length,
        password_forms: forms.filter((form) => form.hasPassword).length,
      },
      thresholds: {
        phishing: Math.round(phishingCut * 10000) / 10000,
        suspicious: Math.round(suspiciousCut * 10000) / 10000,
      },
      mode: emailMode ? "email" : loginMode ? "login" : "page",
      hostname: host,
    };
  }

  root.PhishinGAN = {
    VERSION,
    loadModel,
    setModel,
    scoreText,
    scanText,
    scanPage,
    extractUrls,
    analyzeUrl,
    extractFeatures,
    defang,
    isEmailHost,
    registrableDomain,
    get model() {
      return MODEL;
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);

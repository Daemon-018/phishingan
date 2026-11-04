import { createRequire } from "module";
import fs from "fs";
import path from "path";

const require = createRequire(import.meta.url);
require("../extension/lib/phishingan.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
globalThis.PhishinGAN.setModel(
  JSON.parse(fs.readFileSync(path.join(root, "extension/model/model.json"), "utf8"))
);

function page(overrides) {
  return {
    secure: true,
    title: "",
    text: "",
    links: [],
    forms: [],
    ...overrides,
  };
}

const paypalText =
  "Sign in to your PayPal account. Email or mobile number. Password. Log In. Forgot password? New to PayPal? Sign up.";

const cases = [
  {
    name: "real PayPal login",
    expect: ["legitimate", "suspicious"],
    payload: page({
      url: "https://www.paypal.com/signin",
      hostname: "www.paypal.com",
      title: "Log in to your PayPal account",
      text: paypalText,
      links: [{ href: "https://www.paypal.com/us/webapps/mpp/account-selection" }],
      forms: [
        {
          action: "https://www.paypal.com/signin",
          method: "post",
          hasPassword: true,
          crossOrigin: false,
        },
      ],
    }),
  },
  {
    name: "PayPal lookalike, off-site credential POST",
    expect: ["phishing"],
    payload: page({
      url: "http://paypal-secure-login.xyz/verify",
      hostname: "paypal-secure-login.xyz",
      secure: false,
      title: "Log in to your PayPal account",
      text: paypalText,
      forms: [
        {
          action: "http://203.0.113.7/steal",
          method: "post",
          hasPassword: true,
          crossOrigin: true,
        },
      ],
    }),
  },
  {
    name: "real Microsoft login",
    expect: ["legitimate", "suspicious"],
    payload: page({
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      hostname: "login.microsoftonline.com",
      title: "Sign in to your Microsoft account",
      text: "Sign in. Email, phone, or Skype. No account? Create one! Can't access your account?",
      forms: [
        {
          action: "https://login.microsoftonline.com/common/login",
          method: "post",
          hasPassword: true,
          crossOrigin: false,
        },
      ],
    }),
  },
  {
    name: "real Google login",
    expect: ["legitimate", "suspicious"],
    payload: page({
      url: "https://accounts.google.com/signin/v2/identifier",
      hostname: "accounts.google.com",
      title: "Sign in - Google Accounts",
      text: "Sign in. Use your Google Account. Email or phone. Forgot email? Next. Create account.",
      forms: [
        {
          action: "https://accounts.google.com/signin/v2/challenge/pwd",
          method: "post",
          hasPassword: true,
          crossOrigin: false,
        },
      ],
    }),
  },
  {
    name: "punycode PayPal lookalike",
    expect: ["phishing", "suspicious"],
    payload: page({
      url: "https://www.xn--pypal-4ve.com/login",
      hostname: "www.xn--pypal-4ve.com",
      title: "Log in to your PayPal account",
      text: paypalText,
      forms: [
        {
          action: "https://www.xn--pypal-4ve.com/login",
          method: "post",
          hasPassword: true,
          crossOrigin: false,
        },
      ],
    }),
  },
  {
    name: "cheap-TLD brand impersonation",
    expect: ["phishing", "suspicious"],
    payload: page({
      url: "https://paypal-login.xyz/signin",
      hostname: "paypal-login.xyz",
      title: "Log in to your PayPal account",
      text: paypalText,
      forms: [
        {
          action: "https://paypal-login.xyz/signin",
          method: "post",
          hasPassword: true,
          crossOrigin: false,
        },
      ],
    }),
  },
  {
    name: "router login on private HTTP",
    expect: ["legitimate", "suspicious"],
    payload: page({
      url: "http://192.168.1.1/admin",
      hostname: "192.168.1.1",
      secure: false,
      title: "Router login",
      text: "Router administration. Enter your password to continue.",
      forms: [
        {
          action: "http://192.168.1.1/admin",
          method: "post",
          hasPassword: true,
          crossOrigin: false,
        },
      ],
    }),
  },
  {
    name: "news article, no login",
    expect: ["legitimate"],
    payload: page({
      url: "https://www.bbc.com/news/world",
      hostname: "www.bbc.com",
      title: "World news today",
      text: "Officials met on Tuesday to discuss the latest developments. The report is expected later this week.",
      links: [{ href: "https://www.bbc.com/news/business" }],
    }),
  },
];

let failures = 0;
for (const item of cases) {
  const result = globalThis.PhishinGAN.scanPage(item.payload);
  const ok = item.expect.includes(result.verdict);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${item.name}\n      verdict=${result.verdict} risk=${result.risk_score} model=${result.model.probability} rules=${result.rules.points}`
  );
  const top = result.reasons.slice(0, 3).map((reason) => reason.label);
  if (top.length) console.log(`      top: ${top.join(" | ")}`);
}
console.log(failures ? `\n${failures} scenario(s) failed` : "\nall scenarios passed");
process.exit(failures ? 1 : 0);

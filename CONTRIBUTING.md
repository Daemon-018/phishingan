# Contributing to PhishinGAN

PhishinGAN is a two-person project. This file is the short version of how we work together so we don't step on each other's changes.

**Rule of thumb:** `main` is always green. Nobody pushes straight to `main` — every change goes through a branch and a pull request, even a one-line fix.

---

## 1. One-time setup

```bash
git clone https://github.com/Daemon-018/phishingan.git
cd phishingan

# Python (3.10+)
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# JavaScript tests
npm install
```

Check that you're starting from a working tree:

```bash
pytest -q
node scripts/test_page_scenarios.mjs
node scripts/test_content_dom.mjs
```

If those pass, you're ready.

---

## 2. The daily loop

```bash
git switch main
git pull --ff-only
git switch -c feat/short-description   # or fix/, docs/, test/
```

Make the change, then before you push:

```bash
pytest -q
npm run test:scenarios
npm run test:dom
```

Push and open a PR:

```bash
git push -u origin feat/short-description
gh pr create --fill
```

CI runs the same tests on every push and PR. A PR is ready to merge when CI is green and the other person has looked at it.

---

## 3. Branch names

| Prefix | Use for |
|---|---|
| `feat/` | New detection signal, UI feature, option |
| `fix/` | Bug fix (link the issue or describe the repro) |
| `docs/` | README, comments, this file |
| `test/` | Tests only, no behaviour change |
| `chore/` | Build scripts, CI, dependencies |

Keep branches small and short-lived. One idea per PR is easier to review than five.

---

## 4. What "done" means

- [ ] The change works in the extension **and** the Python path when it touches detection logic.
- [ ] `pytest -q` passes.
- [ ] Scenario and DOM tests pass.
- [ ] If the model, features, or public suffix list changed: `node scripts/validate_js_model.mjs` still matches Python.
- [ ] New behaviour has a test. Bug fixes get a regression test.
- [ ] README is updated if install steps, settings, or metrics changed.
- [ ] No secrets, tokens, or personal data in the diff.

Never commit an API key, a `.env`, or a GitHub token. The extension is designed to work with **zero** keys — keep it that way.

---

## 5. Commit messages

Short imperative subject, then a body if the *why* isn't obvious.

```
fix: stop treating paypal.xyz as an official PayPal domain

_owns_brand() matched the brand as a substring, so any TLD passed.
Now the registrable domain must equal the brand's real domain.
```

---

## 6. Who owns what

Not a hard boundary — just who to ask first.

| Area | Primary |
|---|---|
| `extension/` — engine, content script, UI, manifests | both |
| `src/phishingan/` — Python model, features, scanner, API | both |
| `scripts/` + `.github/workflows/` — build, tests, CI | both |
| Releases, repo settings, GitHub access | Daemon-018 |

If you're unsure, open a draft PR or an issue and ask. Draft PRs are cheap.

---

## 7. Good first tasks

Pick anything from the v0.2 backlog; these are scoped and independent:

1. **Brand-ownership fix** — `_owns_brand()` in `src/phishingan/features/urls.py` treats `paypal.xyz` as official. Must compare the registrable domain to the brand's real domain, in both Python and `extension/lib/phishingan.js`.
2. **Zero-width scrub** — strip zero-width spaces, soft hyphens, and bidi control characters in `src/phishingan/data.py` and the JS cleaner before tokenising.
3. **Stale result on navigation** — `extension/background.js` never clears the badge/result when the tab changes URL. Add a `chrome.tabs.onUpdated` listener.
4. **Notification dedupe** — don't fire the same notification twice for the same tab and verdict.
5. **More regression scenarios** — add real/fake login page cases to `scripts/test_page_scenarios.mjs`.

Larger tracks: sender/header analysis, Credential Guard (hook submit/fetch/XHR/sendBeacon before a password leaves the page), shadow DOM + iframe scanning, allowlist/options page, Playwright end-to-end tests.

---

## 8. Questions

Open an issue or ping the other person directly. If something in this file is wrong or missing, fix it in a `docs/` PR — that counts as contributing.

# Future: an AI "Ask anything" helper — without the surprise bill

**Status: not built.** Today the Ask drawer is a plain FAQ (`public/js/faq.js`): answers are data, many are
generated from the numbers on screen, and none state the conclusion ("show the clues, hand the question back").
An AI helper would sit *behind* that FAQ as a fallback — never in front of it — so most questions never cost anything.

## Non-negotiables (so abuse can't become your bill)
1. **Never ship an API key to the browser.** All calls go through our server (`POST /api/ask`).
2. **A hard spend cap at the provider.** Set a monthly limit in the Anthropic Console (Billing → limits). When it's hit,
   the API simply stops; the app falls back to the FAQ. This is the real safety net — set it *before* writing any code.
3. **Our own budget guard.** Server keeps a daily counter of tokens/requests; above the cap → return the FAQ-only answer.
4. **Per-device and per-IP rate limits** (device key already exists; e.g. 10 questions/day/device, 30/day/IP).
5. **Cache.** Normalise the question; reuse answers for repeats. Most kid questions repeat.
6. **Small + short.** Cheapest suitable model, low `max_tokens`, short context (the FAQ entries + the current step only).
7. **Bot protection** before the first call (e.g. Cloudflare Turnstile) and a kill switch env var (`ASK_AI=off`).
8. **Log (without personal data)** question counts and spend so a spike is visible immediately.

## Behaviour guardrails (the product principle)
- System prompt: *Socratic.* Never assert "the Earth is X". Point to the clues and the tools; ask a question back;
  suggest an experiment. Respectful of every idea ("any idea is welcome — let's test it").
- Reading level: grade 2–3 on the kids' path. Refuse off-topic and unsafe requests; keep answers short.
- Retrieval first: pass the matching FAQ entries and the live data summary; the model rephrases, it doesn't invent facts.
- Add the same answer-light unit test used for the FAQ (no outright conclusions) as an eval over sample questions.

## Rough shape
`POST /api/ask {question, step}` → check kill switch → check device/IP/daily budget → FAQ search (return if confident)
→ cache lookup → call model with retrieved entries → store in cache → return `{answer, source:'faq'|'ai'}`.

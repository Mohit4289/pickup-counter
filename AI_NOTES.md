# AI Notes

## AI Tools Used
- **Antigravity / Gemini 3.8 Flash**: Used for project scaffolding, schema modeling, drafting SQL transaction logic, and writing concurrency test cases.

## Effective Prompt
```text
Write a PostgreSQL transaction for placing an order that locks the selected product rows using SELECT ... FOR UPDATE sorted by product ID to avoid deadlocks, computes stock minus pending active holds (expires_at > NOW()) and paid uncollected orders, and fails with an InsufficientStockError if any item is short.
```
**Why it worked well:**
Being explicit about sorting IDs before acquiring row locks and specifying the exact dynamic formula for available stock eliminated deadlock vulnerabilities and prevented race conditions.

## Specific Error Caught & Fixed
- **Issue:** The AI initially used `express.json()` without capturing the raw buffer, then attempted to verify HMAC-SHA256 by stringifying `req.body` (`JSON.stringify(req.body)`).
- **How I noticed:** In JSON parsing and re-serialization, key order and whitespace differences can alter the byte sequence, causing valid cryptographic signatures to fail verification.
- **Resolution:** Configured Express JSON middleware with a `verify` hook (`express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })`) to retain the exact incoming raw buffer for byte-for-byte HMAC-SHA256 signature checks.

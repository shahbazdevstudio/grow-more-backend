# Grow More — Phases 1, 2 & 3

Personal finance + business app: accounts, income, expenses, transfers, budgets, savings, analytics, plus **Coding**, **Daraz** and **Trading** business modules, and **Notes** + **To-Do**.
Vanilla HTML/CSS/JS frontend · Node/Express/MongoDB backend · fully separate.

```
Backend/   config · controllers · routes · models · middleware · services · validators · utils · scripts · tests · server.js
Frontend/  index.html · css · js (core) · components · pages · assets · tools · server.js (tiny static server)
```

## Run it locally
```bash
cd Backend && npm install && cd ../Frontend && npm install && cd ..
# terminal 1: cd Backend && npm run dev   (API on :5000)
# terminal 2: cd Frontend && npm run dev  (app on :5173, proxies /api to the production backend)
```
`Backend/.env` and `Frontend/.env` are already filled in. **First start:** because no owner exists yet, the server creates it with
`INITIAL_PIN` (**1973**). Log in with 1973, then delete the `INITIAL_PIN` line from `Backend/.env`.
Database: `growmore_phase2` on your Atlas cluster. To set/reset the PIN later: `npm run set-pin` (uses `INITIAL_PIN`) or `npm run setup` (asks).

## Deploy on Vercel (two projects: Backend + Frontend)
1. **MongoDB Atlas -> Network Access -> 0.0.0.0/0** (Vercel has no fixed IP).
2. **Backend project:** Vercel -> Add New -> Project -> import the repo, **Root Directory = `Backend`**, Framework "Other".
   Settings -> Environment Variables: paste `Backend/.env.vercel`. Also set `CLIENT_ORIGIN` = your Frontend URL (e.g. `https://grow-more-shahbaz.vercel.app`). Deploy -> note its URL.
3. **Frontend project:** import the same repo, **Root Directory = `Frontend`**, Framework "Other" (vercel.json sets the build).
   Before deploying, open `Frontend/vercel.json` and replace `https://grow-more-backend-ten.vercel.app` with the Backend URL from step 2.
   The Frontend proxies `/api/*` to the Backend, so the browser only ever talks to one domain (cookies stay first-party, no CORS problems).
4. Open the Frontend URL and log in with PIN **1973** (created on the first request). Then delete `INITIAL_PIN` in the Backend project and redeploy.

## Images (Cloudinary)
Account logos and product photos are uploaded to Cloudinary (folders `growmore/accounts`, `growmore/products`); MongoDB stores only the https URL
(`logoData` / `image`), and the Cloudinary id stays server-side so the old file is deleted when you replace, remove or delete the record.
The browser resizes the picture first (logo 256 px, product 480 px), the API signs and forwards it - the API secret never reaches the browser.
Nothing is written to disk, so this works on Vercel. Needs `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

## Forgot the PIN / locked out?
Both need access to the server, so only you can do them:
In `Backend/`: `npm run reset-lock` (clears a lockout) · `npm run setup` (sets a new PIN).

## How money is calculated
Balances are **never stored**. `balance = opening balance + income − expenses − transfers out + transfers in`,
computed from the ledger of non-deleted transactions. Edits and deletes therefore fix balances automatically, and
no balance can be updated twice. Transfers are one record touching two accounts and are excluded from income and
expense reports. Saving the same form twice (double-tap, retry) is idempotent via a request id.
Deleting a transaction is soft (Undo is offered). An account can only be deleted/archived at zero balance; accounts
with history are archived, never erased.

## Security design
* PIN: HMAC-peppered + bcrypt (cost 12). No plain text, never returned by the API.
* Lockout (server-side, global): 3 wrong tolerated, 4th locks 5 min; each later group adds 5 min (5, 10, 15…, capped at 24 h);
  failures are forgotten after 24 h; PIN checks are serialised so parallel guesses can't skip the counter.
  Wrong "current PIN" while changing the PIN counts too.
* Session: httpOnly cookie holding a signed JWT (never in localStorage/JS), sliding idle expiry (your auto-lock setting),
  24 h absolute cap, revoked everywhere on PIN change or "Sign out other devices".
* Helmet, strict CORS allow-list, CSRF guard (custom header + Origin check), per-IP rate limits, `$`/`.` key rejection
  (NoSQL injection), body-size limit, validated inputs, generic 500s, strict CSP on the frontend, XSS-safe templating.
* Every record has a `user`; every query is scoped to the authenticated user (verified by tests with a second user).
* Production: serve both over HTTPS, `NODE_ENV=production`, `COOKIE_SECURE=true`, and `COOKIE_SAMESITE=none` only if the
  frontend and API are on different domains (same-site subdomains can stay `lax`). Set `TRUST_PROXY=1` behind a proxy.
* Known trade-off: the lockout is per-account, so someone who can reach your API could keep it locked; the IP rate limit
  reduces this. Run the API privately or behind your own access control if that matters to you.
* **Never share or commit `.env`.** If a `.env` was ever uploaded or shared, rotate the MongoDB password and PIN.

## Phase 2 — business modules
**One source of truth:** a paid Coding or Daraz record posts exactly one ledger transaction (tagged `module` + `moduleRef`) to the
account you pick, so balances, analytics and exports include business money automatically. Those transactions are *managed*:
the main Transactions list shows them but refuses edits/deletes (HTTP 409) — change them in their module so nothing drifts.
Business spending is **excluded from your personal daily/monthly budget**; Analytics has an All / Personal / Business switch.

**Coding** — income (client payment, project, retainer, other) and expenses (hosting, domain, marketing, advertising, tools, other).
*Pending payments* move no money until you tap **Received** and choose the account. Overview: income, costs, net profit & margin,
pending/overdue, available cash (all-time income − costs), top clients, cost breakdown, monthly (12 months) and yearly reports.

**Daraz** — products (photo, SKU, category, prices, supplier, low-stock level) and stock movements:
*purchase* (money out of an account, or no account = stock you already own), *sale* (money in, net of Daraz fees; no account =
**pending payout** until you receive it), *write-off* (loss at average cost), *add stock*. Business expenses: flyer bags, packaging,
shipping, other (optionally tied to one product).
* Stock, average cost and profit are **derived**, never stored. Costing = weighted average. COGS = quantity × average cost at the time of sale.
* Stock can never go negative at any date: sales/edits/deletes that would break it are refused with a clear message.
* Total investment = stock purchased + business expenses (your example: 10,000 + 500 + 300 = **10,800**).
  Net profit = revenue − COGS − expenses − Daraz fees − write-offs. Unsold stock is shown as *stock value*, not as a loss.
* Business balance = Daraz money received − Daraz money spent (cash basis); pending payouts are shown separately.

## Phase 3 — trading, notes, to-do, advanced savings & analytics
**Trading (manual, no live prices, no automatic trading)** — assets (crypto, stocks, other), buys and sells with quantity (up to 8 decimals),
price, fee, date and an optional account. Your formulas, exactly: *Profit/Loss = Selling value − Purchase cost − Applicable fees* and
*Return % = Net profit ÷ Purchase cost × 100*, where purchase cost = units sold × your average buy price, and applicable fees = the buy fees
attached to those units + the sell fee. Selling more than you hold (on any date) is refused. You enter each asset's price by hand; portfolio value,
unrealised P/L, realised P/L, fees, win rate, allocation and realised-profit-by-month are derived. Holdings with no price are valued at cost.
**Buys and sells move your account balances but are capital movements — never income, expenses or personal budget.**
Trading transactions are *managed* like Coding/Daraz ones (edit them in Trading).

**Notes** — title, body, category, pin, created/updated dates; bold, italic, underline, bullet and numbered lists. Search, category and date
filters. Note HTML is sanitised on the server (whitelist: p, br, strong, em, u, ul, ol, li — no attributes, no scripts) *and* again in the browser.
Closing the editor with unsaved text asks first.
**To-Do** — tasks with description and due date, quick-add, tick/untick, grouped Overdue / Today / Upcoming / No date, pending/completed/all.
Deleting a note or task offers Undo.

**Advanced savings** — Overview adds *where your savings come from* (by the Source you give each transfer), a 12-month saved/withdrawn chart with
your savings rate, and an "Add money" shortcut on each goal. A new History tab lists every move into/out of savings, filterable by source.
**Advanced analytics** — Analytics → *Insights*: net worth over 12 months (**accounts + investments at cost**, so moving money into an investment never looks
like losing it; Daraz stock is not included), monthly cash flow with savings rate, spending by weekday, biggest expenses, and a month-end spending forecast
against your monthly limit.

## Logos
No brand logos are bundled (they must be the genuine official files). Drop official SVG/PNG files into
`Frontend/assets/logos/` (`meezan.svg`, `jazzcash.svg`, `easypaisa.svg`) or upload one per account in the account form.

## Tests
`cd Backend && npm test` — tests against a real MongoDB (set `MONGODB_URI`; Cloudinary is replaced by a local fake): lockout rules, auth/CSRF/injection,
ledger maths incl. a 120-operation randomised consistency check, user isolation, budgets, savings, analytics, export,
the Coding module, Daraz stock/costing maths, stock-safety rules, ledger-integrity checks and a randomised buy/sell/edit/delete/restore test,
the trading maths (your formulas), holdings rules, notes sanitiser (XSS), To-Do ordering, savings sources and the net-worth insight.

## Status & roadmap
Phase 1 ✅ loading screen · PIN + lockout · dashboard · accounts · income/expenses/transfers · edit/delete/undo ·
search & filters · analytics (Chart.js) · daily/monthly budget · savings & goals · dark/light · mobile app layout · settings ·
backup/export (JSON, CSV).
Phase 2 ✅ Coding module · Daraz inventory, stock history, business expenses, profit & loss, pending payouts · personal/business split.
Phase 3 ✅ Trading & crypto (manual) · Notes · To-Do · advanced savings · advanced analytics.
All planned modules are now built.
Not built: importing/restoring a backup file, live market prices (by design), multi-user sign-in (data model is already per-user).

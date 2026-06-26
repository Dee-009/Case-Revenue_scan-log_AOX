# Case Scan Log

Supervisor tool: scan/type a case number, it auto-fills Pan Number, Account, Product Type,
Units, and Price by looking up your existing Supabase data (Cases, Line Items, Accounts).
Each scan is added to a running table with totals at the bottom, and the whole table can be
downloaded as an Excel file.

No command line needed anywhere in this setup — GitHub Desktop + Vercel's website handle
everything.

## 1. Get the code into a new GitHub repo (GitHub Desktop, no terminal)

1. Open **GitHub Desktop** → File → **New repository**.
2. Name it `case-scan-log`, pick a local path, click **Create repository**.
3. GitHub Desktop just created an empty folder on your computer. Open that folder in
   File Explorer and copy ALL the files from this project into it (keep the `src` folder
   structure intact).
4. Go back to GitHub Desktop — it will show all the new files staged for commit.
5. Type a commit message like "Initial case scan log app" → **Commit to main**.
6. Click **Publish repository** (top bar) → keep it private → **Publish**.

That's it — no `git`, no terminal.

## 2. Add your Supabase keys (so they aren't committed to GitHub)

Your Supabase URL and anon key should NOT go in the code itself — they go into Vercel's
environment variable settings instead (step 3). The `.env.example` file just shows what's
needed; do not rename it to `.env` and commit it.

You can find your anon key in Supabase: Project Settings → API → "anon public" key, for
project `asdunkqodixbhbohxtuq` (SK Public — the same project your other QC apps use).

## 3. Deploy on Vercel (website only, no terminal)

1. Go to vercel.com → **Add New... → Project**.
2. Import the `case-scan-log` GitHub repo you just published.
3. Vercel auto-detects Vite. Before clicking Deploy, open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = `https://asdunkqodixbhbohxtuq.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (paste your anon key)
4. Click **Deploy**. In ~1 minute you'll get a live URL like `case-scan-log.vercel.app`.

## 4. Making changes later

Edit files locally (e.g. in VS Code, just editing — no terminal commands needed) → switch to
GitHub Desktop → it shows the changed files → write a commit message → **Commit to main** →
**Push origin**. Vercel automatically redeploys within a minute or two, every time you push.

## How the lookup works

When the supervisor scans/types a case number and hits Enter, the app:
1. Looks up that case in the `Cases` table (Pan Number, Account Number, Primary Product,
   Business Unit).
2. Sums `Units` and `Price Net` for that case from `Line Items` (a case can have more than
   one line item).
3. Looks up `Practice Name` from `Accounts` using the Account Number, so the table shows the
   actual practice/account name (e.g. a ClearChoice or Aspen location) rather than a number.
4. Adds the row to the on-screen table and also saves it to a new Supabase table,
   `supervisor_scan_log`, tagged with today's date. This means if the page is refreshed or
   the browser is closed mid-shift, today's scanned cases reload automatically — nothing is
   lost.

Duplicate scans of the same case number on the same screen are flagged instead of being
added twice.

## Excel export

"Download Excel" generates a `.xlsx` file (case number, pan number, account, product type,
units, price, plus a TOTAL row) entirely in the browser — no backend or extra service
involved.

## Notes / things worth deciding later

- Right now `Account` shows the Practice Name from your Accounts table. If you'd rather see
  a clean label like "ClearChoice" / "Aspen" / "TRI" instead of the full practice name, that
  mapping logic (e.g. via your existing `ClearChoice Hierarchy` table or a keyword match on
  Practice Name) can be added — let me know which accounts map to which label.
- `supervisor_scan_log` currently has RLS disabled (matches the pattern your other QC apps
  use with the anon key). If this needs to be locked down later, RLS policies can be added
  without changing the app.
- If a supervisor needs to log in (so scans are attributed to a person), that's a small
  addition using Supabase Auth — not included yet since it wasn't asked for.

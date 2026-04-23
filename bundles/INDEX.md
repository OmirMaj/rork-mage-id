# MAGE ID — Claude Projects Bundles


> Upload these 16 files to a Claude Project. Together they
> contain the entire MAGE ID codebase (app/, components/, contexts/,
> utils/, backend/, lib/, hooks/, types/, constants/, config). Bundles are
> grouped by subsystem and ordered for reading — **start with 00-OVERVIEW**.


## Bundle list

| # | File | Files | Size (KB) | What's in it |
|---|------|------:|----------:|--------------|
| 00 | `00-OVERVIEW.md` | 9 | 13 | MAGE ID — Project Overview & Build Config |
| 01 | `01-FOUNDATIONS.md` | 20 | 41 | Foundations — Routing, Layouts & Desktop Shell |
| 02 | `02-TYPES-CONSTANTS.md` | 13 | 183 | Types & Constants |
| 03 | `03-CONTEXTS.md` | 8 | 128 | Contexts — Cross-Screen Domain State |
| 04 | `04-AUTH-PAYWALL.md` | 7 | 109 | Auth, Onboarding, Subscription Paywall |
| 05 | `05-PROJECTS-HOME.md` | 5 | 197 | Projects — Home Tab & Project Detail |
| 06 | `06-ESTIMATES-MATERIALS.md` | 13 | 385 | Estimates, Estimate Wizard & Materials |
| 07 | `07-SCHEDULE.md` | 22 | 552 | Schedule — Tasks, Gantt, CPM & AI Builder |
| 08 | `08-INVOICING-FINANCE.md` | 21 | 387 | Invoicing, Change Orders, Cash Flow & Finance |
| 09 | `09-FIELD-OPS.md` | 13 | 225 | Field Operations — Daily Reports, Punch, RFIs, Submittals, Warranties |
| 10 | `10-CLIENT-PORTAL.md` | 8 | 169 | Client Portal, Messaging & Sharing |
| 11 | `11-BIDS-COMPANIES-HIRE.md` | 14 | 236 | Bids, Companies, Hiring & Marketplace Listings |
| 12 | `12-DISCOVER-MARKETPLACE-EQUIPMENT.md` | 18 | 275 | Discover, Marketplace, Equipment & Integrations |
| 13 | `13-SETTINGS-CONTACTS-EXPORT.md` | 8 | 201 | Settings, Contacts, Data Export & Documents |
| 14 | `14-AI-FEATURES.md` | 8 | 117 | AI Features — Copilot, Voice & Service Layer |
| 15 | `15-UTILITIES-BACKEND.md` | 13 | 80 | Utilities, Offline Sync & Backend (tRPC + Supabase) |


## Coverage

200 source files included in bundles. 0 not bundled (UI utilities, tests, or helpers reachable through the bundled files).


## How to use

1. Create a new Claude Project.
2. Upload all `.md` files in this directory.
3. In the project instructions, paste the contents of `00-OVERVIEW.md`'s
   Overview section (or direct Claude to read 00 first).
4. Ask questions — Claude will have every file's path + source available.

## Regenerating

```bash
python3 scripts/generate_bundles.py
```
Idempotent; safe to rerun after code changes.

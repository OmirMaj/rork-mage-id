# MAGE ID — Auth Email Templates

Branded replacements for Supabase Auth's default `Confirm signup`, `Magic link`,
`Reset password`, etc. Supabase hosts these templates — they aren't imported at
runtime, so updating this folder does **not** affect production until you paste
the HTML into the dashboard.

## Paste instructions

1. Supabase Dashboard → project `nteoqhcswappxxjlpvap` (MAGE ID).
2. **Authentication → Email Templates**.
3. Pick the template (e.g. `Confirm signup`).
4. **Subject heading**:
   - Confirm signup: `Confirm your email to get started with MAGE ID`
5. **Message (HTML)**: paste the entire file from this folder.
6. Save. Test by signing up a throwaway address in the app.

## Templates in this folder

| File | Supabase template | Sender |
| --- | --- | --- |
| `confirm-signup.html` | `Confirm signup` | `MAGE ID <noreply@mageid.app>` (configured in Supabase SMTP) |

## Supabase merge tags

Supabase Go-template variables available in every Auth email:

- `{{ .ConfirmationURL }}` — signed confirmation link (required for Confirm signup)
- `{{ .Token }}` — 6-digit OTP (for magic-link / otp-style flows)
- `{{ .TokenHash }}` — hashed OTP (for custom verify endpoints)
- `{{ .SiteURL }}` — Site URL from **Authentication → URL Configuration**
- `{{ .Email }}` — recipient
- `{{ .Data.<key> }}` — anything we passed via `options.data` in `signUp()`.
  We pass `name`, so `{{ .Data.name }}` is available.

## SMTP / sender

Auth emails go out through the Supabase-managed SMTP (or custom SMTP if you've
wired Resend at the project level). Transactional / non-auth emails (welcome
series, invoice receipts, etc.) continue to go through the `send-email` edge
function in `supabase/functions/send-email/` — that path uses Resend directly
and gives us attachments + templating.

## Keep in sync with the in-app modal

The post-signup "check your inbox" modal lives at
`components/ConfirmEmailModal.tsx`. Copy tone there should match the email —
if you rewrite one, scan the other.

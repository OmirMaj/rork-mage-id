# Archived Legal Text

One file per version of the Terms of Service and the Privacy Policy that an account could have accepted:

`<kind>-<version>-<first 8 characters of the hash>.txt`

Each file is the exact text the acceptance hash was taken over: the words inside `<main>` of the page, markup removed, white space collapsed, UTF-8, no trailing newline. `shasum -a 256 <file>` prints the value stored in `public.legal_acceptances.text_sha256` for that version.

- Written by `scripts/archive-legal-text.ts`, the same script that computes the hash. Run `bun run scripts/archive-legal-text.ts` after changing a page and its constants.
- Never edit or delete a file here. An old file is the only readable copy of what an old version said.
- `scripts/validate-legal-acceptance.ts` fails the build when the file for the current version is missing or does not hash to the constant in `utils/legalAcceptanceCore.ts`.
- The hash is of the page in this repository (`marketing/terms.html`, `marketing/privacy.html`). The live site is published from that folder on a push to `main`. Nothing compares the live page with the file.

These files are the legal text itself, kept word for word. They are not written in the house style of the app's own copy and must not be reformatted.

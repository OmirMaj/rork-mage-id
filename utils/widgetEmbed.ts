// utils/widgetEmbed.ts — the canonical Instant Estimate embed snippet.
//
// This string exists in two places a contractor can copy it from: the in-app
// setup screen (app/widget-setup.tsx) and the public docs page
// (marketing/widget/index.html). If they ever drift, somebody pastes a snippet
// that doesn't work on their website and has no way to tell why — so the
// builder lives here, RN-free, and scripts/validate-widget-estimate.ts asserts
// the marketing page still matches it.

/** Slug placeholder shown before a contractor has set their company name. */
export const WIDGET_SLUG_PLACEHOLDER = 'your-company-slug';
export const WIDGET_NAME_PLACEHOLDER = 'Your Company';

export function buildEmbedSnippet(slug: string, companyName: string): string {
  return [
    '<!-- MAGE ID Instant Estimate -->',
    '<script src="https://mageid.app/widget/embed.js"',
    `        data-mage-contractor="${slug}"`,
    `        data-mage-name="${companyName}"`,
    '        defer></script>',
  ].join('\n');
}

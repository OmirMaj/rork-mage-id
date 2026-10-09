// scripts/marketing-screens/publish.ts: turn the raw shots into what the site
// uses, and write the manifest.
//
//   bun run scripts/marketing-screens/publish.ts
//
// Reads OUT (default .marketing-screens-out). Writes:
//   SITE (default: none)   shipped/<id>.png, <id>@1x.webp, <id>@2x.webp, the
//                          same under in-testing/, manifest.json and a README
//                          in in-testing/. For the site builder.
//   marketing/screenshots/screens/   app-<id>-1x.webp and -2x.webp (the names
//                          scripts/validate-marketing-screenshots.ts can read:
//                          letters, digits, dot, dash), in-testing/ beside
//                          them, and app-screens.json.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCREENS } from './screens';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.OUT ?? join(ROOT, '.marketing-screens-out');
const SITE = process.env.SITE;
const REPO_DIR = join(ROOT, 'marketing', 'screenshots', 'screens');
const W = 393, H = 852;

const IN_TESTING_README = `# In testing

Every image in this folder shows a feature that is SWITCHED OFF in the app
people can install today (constants/featureFlags.ts). They were shot from a
second build with those switches turned on, by scripts/marketing-screens.

They may only ever be shown on the site under an "In Testing" label. Never
put one beside the shipped screens, in a feature list, or anywhere a reader
could take it for something they get today.

- The Scan The Room images show a hand-built test room
  (scripts/fixtures/scan-room/bathroom.json). No phone has scanned it.
- The Living Model's 3D replay is drawn by the web build. It is not on the
  phone in this phase.
- Clearance Check is not here. It stays hidden until a named architect or
  expediter has read its table, and the harness does not pretend one has.
`;

function webp(src: string, dest: string, scale: 1 | 2, quality: number): number {
  const r = spawnSync('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-sharp_yuv', '-resize', String(W * scale), String(H * scale), src, '-o', dest]);
  if (r.status !== 0) throw new Error(`cwebp failed for ${src}: ${r.stderr}`);
  return statSync(dest).size;
}
/** Under about 120 KB at 2x where that does no visible damage: step the quality down, never below 72. */
function webp2x(src: string, dest: string): number {
  let size = 0;
  for (const q of [86, 82, 78, 74, 72]) { size = webp(src, dest, 2, q); if (size <= 120_000) break; }
  return size;
}

const manifest: Record<string, unknown>[] = [];
for (const set of ['shipped', 'in-testing'] as const) {
  const dir = join(OUT, set);
  if (!existsSync(dir)) continue;
  const siteDir = SITE ? join(SITE, set) : null;
  const repoDir = set === 'shipped' ? REPO_DIR : join(REPO_DIR, 'in-testing');
  if (siteDir) { rmSync(siteDir, { recursive: true, force: true }); mkdirSync(siteDir, { recursive: true }); }
  mkdirSync(repoDir, { recursive: true });
  for (const f of readdirSync(repoDir)) if (/^app-.*\.webp$/.test(f)) rmSync(join(repoDir, f));
  for (const screen of SCREENS.filter((s) => s.set === set)) {
    const frames: { name: string; caption?: string; theme: string }[] = [{ name: screen.id, theme: 'light' }];
    (screen.sequence ?? []).forEach((s, i) => frames.push({ name: `${screen.id}-seq-${i + 1}`, caption: s.caption, theme: 'light' }));
    if (screen.dark) frames.push({ name: `${screen.id}-dark`, theme: 'dark' });
    for (const frame of frames) {
      const png = join(dir, `${frame.name}.png`);
      if (!existsSync(png)) { console.log(`! missing ${set}/${frame.name}.png (not shot)`); continue; }
      const repo1 = join(repoDir, `app-${frame.name}-1x.webp`), repo2 = join(repoDir, `app-${frame.name}-2x.webp`);
      const s1 = webp(png, repo1, 1, 82), s2 = webp2x(png, repo2);
      if (siteDir) {
        copyFileSync(png, join(siteDir, `${frame.name}.png`));
        copyFileSync(repo1, join(siteDir, `${frame.name}@1x.webp`));
        copyFileSync(repo2, join(siteDir, `${frame.name}@2x.webp`));
      }
      const seq = /-seq-(\d+)$/.exec(frame.name);
      manifest.push({
        id: frame.name, screen: screen.id, title: screen.title, about: frame.caption ? `${screen.title}: ${frame.caption}` : screen.about,
        ...(seq ? { sequence: screen.id, frame: Number(seq[1]) } : {}), theme: frame.theme,
        status: set === 'shipped' ? 'shipped' : 'in testing', ...(set === 'in-testing' ? { label: 'In Testing' } : {}),
        plan: screen.plan, source: screen.source,
        pixels: { png: [W * 3, H * 3], '2x': [W * 2, H * 2], '1x': [W, H] },
        files: { png: `${set}/${frame.name}.png`, '2x': `${set}/${frame.name}@2x.webp`, '1x': `${set}/${frame.name}@1x.webp` },
        repoFiles: { '2x': `marketing/screenshots/screens/${set === 'shipped' ? '' : 'in-testing/'}app-${frame.name}-2x.webp`, '1x': `marketing/screenshots/screens/${set === 'shipped' ? '' : 'in-testing/'}app-${frame.name}-1x.webp` },
        bytes: { '2x': s2, '1x': s1 },
      });
      console.log(`${set}/${frame.name}  2x ${(s2 / 1024).toFixed(0)} KB  1x ${(s1 / 1024).toFixed(0)} KB`);
    }
  }
  if (set === 'in-testing') { writeFileSync(join(repoDir, 'README.md'), IN_TESTING_README); if (siteDir) writeFileSync(join(siteDir, 'README.md'), IN_TESTING_README); }
}
const doc = {
  what: 'Screens of the MAGE ID app, shot by scripts/marketing-screens from the real web build of the app with one made-up job. Nothing is drawn by hand except the phone status bar.',
  job: 'Example Builders, 14 Alder Street (made up: no real people, addresses, companies or phone numbers).',
  viewport: { css: [W, H], scale: 3 },
  rule: 'Images whose status is "in testing" show features that are switched off today. Show them only under an "In Testing" label.',
  screens: manifest,
};
writeFileSync(join(REPO_DIR, 'app-screens.json'), JSON.stringify(doc, null, 2) + '\n');
if (SITE) writeFileSync(join(SITE, 'manifest.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(`${manifest.length} images`);

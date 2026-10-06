// scripts/fixtures/scan-room/make-fixtures.ts — writes the three hand-built
// CapturedRoom JSON files from builder.ts.
//   bun run scripts/fixtures/scan-room/make-fixtures.ts
// scripts/validate-scan-room.ts fails when a file on disk no longer equals
// what the builder writes, so the files cannot drift from their description.
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { FIXTURE_FILES, buildCapturedRoom } from './builder';

for (const [name, spec] of Object.entries(FIXTURE_FILES)) {
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), name), JSON.stringify(buildCapturedRoom(spec()), null, 1) + '\n');
  console.log('wrote', name);
}

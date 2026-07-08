// validate-safety-cert.ts — unit tests for utils/safety/certStatus.
// certStatus REUSES utils/crew/certExpiry (built for the Worker Profile feature);
// these tests lock in the classification AND the 'none'→'valid' collapse.
// Run via: bun run scripts/validate-safety-cert.ts
import { certStatus } from '../utils/safety/certStatus';
import { certExpiryStatus } from '../utils/crew/certExpiry';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T){ const ok = JSON.stringify(got)===JSON.stringify(want); if(ok){pass++;console.log('  ✓',name);}else{fail++;console.log('  ✗',name,'\n   got:',got,'\n   want:',want);} }

console.log('\nsafety cert-status validation:');

const REF = '2026-07-08';
expect('no expiry → valid',            certStatus(undefined, REF), 'valid');
expect('null expiry → valid',          certStatus(null, REF), 'valid');
expect('empty string expiry → valid',  certStatus('', REF), 'valid');
expect('expired yesterday → expired',  certStatus('2026-07-07', REF), 'expired');
expect('expires today → expiring',     certStatus('2026-07-08', REF), 'expiring');
expect('expires in 1 day → expiring',  certStatus('2026-07-09', REF), 'expiring');
expect('expires in 30 days → expiring',certStatus('2026-08-07', REF), 'expiring');
expect('expires in 31 days → valid',   certStatus('2026-08-08', REF), 'valid');
expect('far future → valid',           certStatus('2027-01-01', REF), 'valid');
expect('ISO timestamp input works',    certStatus('2026-07-08T15:00:00.000Z', REF), 'expiring');

// Reuse contract: certStatus mirrors certExpiryStatus, collapsing ONLY 'none'→'valid'.
expect('reuses certExpiry: none→valid', certStatus(undefined, REF), certExpiryStatus(undefined, REF) === 'none' ? 'valid' : certExpiryStatus(undefined, REF));
expect('reuses certExpiry: expiring',   certStatus('2026-07-20', REF), certExpiryStatus('2026-07-20', REF));
expect('reuses certExpiry: expired',    certStatus('2026-06-01', REF), certExpiryStatus('2026-06-01', REF));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

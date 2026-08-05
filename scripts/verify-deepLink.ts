import { resolveDeepLinkPath } from '@/utils/deepLinkScheme';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}: got '${got}' want '${want}'`); }
  else console.log(`ok   ${name}`);
}

eq('public.prequal', resolveDeepLinkPath('mageid://prequal-form'), '/prequal-form');
eq('public.reset', resolveDeepLinkPath('mageid://reset-password?token=x'), '/reset-password?token=x');
eq('inapp.qbo', resolveDeepLinkPath('mageid://qbo-setup'), '/qbo-setup');
eq('inapp.crew.query', resolveDeepLinkPath('mageid://claim-crew?token=abc'), '/claim-crew?token=abc');
eq('inapp.clientview', resolveDeepLinkPath('mageid://client-view'), '/client-view');
eq('inapp.nested', resolveDeepLinkPath('mageid://integrations/qbo/callback'), '/integrations/qbo/callback');
eq('empty', resolveDeepLinkPath('mageid://'), '/');
eq('malformed', resolveDeepLinkPath('mageid://!!bad path!!'), '/');
// A #-fragment recovery link: split('?') leaves the '#' in the route segment,
// which fails IN_APP_ROUTE and is not in PUBLIC_PATHS → resolves to '/'.
// The actual token is redeemed by MagicLinkHandler (a Linking listener).
eq('reset.hashfragment', resolveDeepLinkPath('mageid://reset-password#access_token=x'), '/');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
if (failures) process.exit(1);

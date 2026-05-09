// English — the canonical dictionary. Every key in this file is the
// source of truth; other locales are translations. When you add a key
// here, also add it to es.ts (and any other locale file).
//
// Conventions:
//   - Keys are dot-separated by feature: 'login.title', 'time.clockIn'.
//   - Values are sentence-case unless they're shouty CTAs ("SIGN IN").
//   - Interpolations use {curly} placeholders matching the args
//     passed to t(key, vars).

const en: Record<string, string> = {
  // ── Common ──
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.done': 'Done',
  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.delete': 'Delete',
  'common.confirm': 'Confirm',
  'common.search': 'Search',
  'common.loading': 'Loading…',
  'common.retry': 'Try again',

  // ── Login ──
  'login.title': 'Sign in to MAGE ID',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.signInBtn': 'Sign in',
  'login.magicLinkBtn': 'Email me a sign-in link',
  'login.createAccount': 'Create an account',
  'login.forgotPassword': 'Forgot password?',

  // ── Time tracking ──
  'time.title': 'Time Tracking',
  'time.onSite': 'On Site',
  'time.hoursToday': '{hours} hrs today',
  'time.clockIn': 'Clock in',
  'time.clockOut': 'Clock out',
  'time.startBreak': 'Start break',
  'time.resume': 'Resume',
  'time.exportCsv': 'Export CSV',
  'time.exportWh347': 'WH-347',
  'time.geofence.onSite': 'On site',
  'time.geofence.checking': 'Checking your location…',
  'time.geofence.unavailable': 'GPS unavailable',
  'time.addCrew': 'Add crew member',
  'time.noCrewYet': 'No crew yet',
  'time.allClockedIn': 'All crew members are currently clocked in',

  // ── Settings ──
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.languageSub': 'The language for menus, buttons, and labels in this app. Homeowner portal language is set per project.',
  'settings.security': 'Account security',
  'settings.securitySub': 'Password, two-factor authentication, biometric unlock',
  'settings.notifications': 'Notifications',
  'settings.signOut': 'Sign out',

  // ── Approvals ──
  'approvals.title': 'Approvals',
  'approvals.empty': 'Nothing waiting on you',
  'approvals.emptyMsg': "All change orders are signed, RFIs are answered, and bid packages are awarded.",
  'approvals.approve': 'Approve',
  'approvals.reject': 'Reject',
};

export default en;

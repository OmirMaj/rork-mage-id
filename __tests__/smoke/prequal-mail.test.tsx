/**
 * Q5 review r1 — the prequal invite / renewal / decision-note mail open.
 *
 * On react-native-web Linking.openURL resolves whenever window.open does not
 * throw (node_modules/react-native-web/dist/exports/Linking/index.js), so the
 * web app ALWAYS lands in the "opened" branch, even with no mail client. That
 * branch must therefore hand over the link and must not claim the mail app
 * opened. On the phone a resolved open did open the mail app.
 */
import { Linking, Platform } from 'react-native';

const mockShowAlert = jest.fn();
const mockCopy = jest.fn(async (_t: string) => true);
jest.mock('@/utils/alert', () => ({ showAlert: (...a: unknown[]) => mockShowAlert(...a) }));
jest.mock('@/utils/clipboard', () => ({ copyToClipboard: (t: string) => mockCopy(t) }));

// eslint-disable-next-line import/first
import { composeMailOrOfferLink } from '@/utils/prequalMail';

type Btn = { text: string; style?: string; onPress?: () => void };
const LINK = 'https://app.mageid.app/prequal-form?token=abc';
const args = {
  mailto: 'mailto:sub@example.com?subject=x&body=y',
  link: LINK,
  ready: { title: 'Invite ready to send', nativeBody: 'Your mail app opened with the link.', webBody: 'Your mail app should open with the link. If no mail app opened, copy the link.' },
  failed: { title: 'Invite saved — no email went out', body: 'No mail app opened.' },
};

const realOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

let openSpy: jest.SpyInstance;
beforeEach(() => {
  mockShowAlert.mockReset();
  mockCopy.mockClear();
  openSpy = jest.spyOn(Linking, 'openURL');
});
afterEach(() => {
  openSpy.mockRestore();
  setOS(realOS);
});

function lastAlert() {
  const c = mockShowAlert.mock.calls[mockShowAlert.mock.calls.length - 1];
  return { title: c[0] as string, body: c[1] as string, buttons: (c[2] ?? []) as Btn[] };
}

describe('composeMailOrOfferLink', () => {
  it('web: a resolved open says the mail app SHOULD open and still offers Copy link', async () => {
    setOS('web');
    openSpy.mockResolvedValue(true);
    await composeMailOrOfferLink(args);
    expect(openSpy).toHaveBeenCalledWith(args.mailto);
    const a = lastAlert();
    expect(a.title).toBe('Invite ready to send');
    expect(a.body).toBe(args.ready.webBody);
    expect(a.body).not.toMatch(/mail app opened with/);
    const copy = a.buttons.find(b => b.text === 'Copy link');
    expect(copy).toBeTruthy();
    copy!.onPress!();
    expect(mockCopy).toHaveBeenCalledWith(LINK);
  });

  it('iOS: a resolved open says it opened, with the link one tap away', async () => {
    setOS('ios');
    openSpy.mockResolvedValue(true);
    await composeMailOrOfferLink(args);
    const a = lastAlert();
    expect(a.body).toBe(args.ready.nativeBody);
    expect(a.buttons.map(b => b.text)).toEqual(['Done', 'Copy link']);
  });

  it('a rejected open says nothing went out and offers the link', async () => {
    setOS('ios');
    openSpy.mockRejectedValue(new Error('no handler'));
    await composeMailOrOfferLink(args);
    expect(mockShowAlert).toHaveBeenCalledTimes(1);
    const a = lastAlert();
    expect(a.title).toBe('Invite saved — no email went out');
    expect(a.buttons.map(b => b.text)).toEqual(['Close', 'Copy link']);
    a.buttons[1].onPress!();
    expect(mockCopy).toHaveBeenCalledWith(LINK);
  });
});

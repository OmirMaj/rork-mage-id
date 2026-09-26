/**
 * Real-DOM proof for the wave-6d lane-R1 registers (jsdom + react-dom +
 * react-native-web — the stack app.mageid.app runs).
 *
 *   1. Contacts: every row is an <a href="/contacts?contactId=…"> (Cmd-click /
 *      right-click → a new tab); a plain click opens the
 *      record beside the list (split.open) instead of reloading the page.
 *   2. The guard: with a record part reporting unsaved edits
 *      (useRegisterRecordDirty), a row click asks "Discard changes?" and opens
 *      nothing until he says Discard.
 *   3. Bulk Delete (contacts) confirms with the count, then deletes EACH
 *      selected contact (one per render: the context's delete rebuilds the
 *      list from the array it closed over).
 *   4. Crew: bulk Delete is disabled and says why; Mark inactive writes each
 *      selected member's status.
 *   5. Export CSV names the file by the LOCAL day; 'n' outside a field opens New.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-r1-registers.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text } from 'react-native';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
const mockSetOptions = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  // The registers mount outside a navigator here: no URL params, no header.
  return {
    ...actual,
    useRouter: () => mockRouter,
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ setOptions: mockSetOptions }),
    Stack: { ...actual.Stack, Screen: () => null },
  };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('@/utils/platformFile', () => ({ ...jest.requireActual('@/utils/platformFile'), deliverTextFile: jest.fn(() => Promise.resolve()) }));

import { ThemeProvider } from '@/contexts/ThemeContext';
import type { SplitRecord } from '@/components/desktop/SplitView';
import { ContactsRegister } from '@/components/registers/ContactsRegister';
import { CrewRegister, CREW_BULK_DELETE_REASON } from '@/components/registers/CrewRegister';
import { useRegisterRecordDirty } from '@/components/registers/RegisterRecordHost';
import { showAlert } from '@/utils/alert';
import { deliverTextFile } from '@/utils/platformFile';
import type { Contact, ContactRole, CrewMember } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const roots: { root: Root; el: HTMLElement }[] = [];
async function mount(node: React.ReactElement): Promise<{ el: HTMLElement; root: Root }> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(<ThemeProvider>{node}</ThemeProvider>); });
  return { el, root };
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
});

const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const alertMock = showAlert as jest.Mock;
type Btn = { text: string; style?: string; onPress?: () => void };
const lastAlert = () => alertMock.mock.calls[alertMock.mock.calls.length - 1] as [string, string | undefined, Btn[] | undefined];
async function click(target: Element): Promise<void> {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}
async function bulkButton(el: HTMLElement, table: string, label: string): Promise<void> {
  const bar = byId(el, `${table}-bulkbar`);
  expect(bar).not.toBeNull();
  const btn = [...bar!.querySelectorAll('[role="button"]')].find((b) => b.textContent === label);
  expect(btn).toBeTruthy();
  await click(btn!);
}
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ROLES: { value: ContactRole; label: string }[] = [
  { value: 'Client', label: 'Client' }, { value: 'Architect', label: 'Architect' }, { value: 'Inspector', label: 'Inspector' },
];
const contact = (id: string, first: string, last: string, role: ContactRole, extra: Partial<Contact> = {}): Contact => ({
  id, firstName: first, lastName: last, companyName: '', role, email: `${first.toLowerCase()}@x.test`, phone: '', address: '', notes: '',
  linkedProjectIds: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
});
const CONTACTS = [contact('con-1', 'Ava', 'Linden', 'Client'), contact('con-2', 'Noor', 'Haddad', 'Architect'), contact('con-3', 'Sam', 'Ortiz', 'Inspector')];

function makeSplit(openId: string | null = null): SplitRecord {
  return { openId, open: jest.fn(), close: jest.fn(), inPlace: true };
}

function DirtyPart() {
  useRegisterRecordDirty(() => true);
  return <Text testID="dirty-part">editing</Text>;
}

beforeEach(() => {
  alertMock.mockClear();
  (deliverTextFile as jest.Mock).mockClear();
});

describe('Contacts register (real DOM, 1512)', () => {
  it('each row is a link to /contacts?contactId=…', async () => {
    const { el } = await mount(
      <ContactsRegister contacts={CONTACTS} split={makeSplit()} detail={null} roles={ROLES} onNew={jest.fn()} deleteContact={jest.fn()} />,
    );
    expect(byId(el, 'contacts-register')).not.toBeNull();
    const a = el.querySelector('a[href*="contactId=con-2"]');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('/contacts?contactId=con-2');
    expect(byId(el, 'contacts-register-table-row-con-2')).not.toBeNull();
    // The 36 px row height is proven in __tests__/smoke/w6d-r1-desktop.test.tsx
    // (flattened minHeight): react-native-web compiles it to a class, and
    // jsdom computes no layout.
  });

  it('a plain click opens the record beside the list (no page load)', async () => {
    const split = makeSplit();
    const { el } = await mount(
      <ContactsRegister contacts={CONTACTS} split={split} detail={null} roles={ROLES} onNew={jest.fn()} deleteContact={jest.fn()} />,
    );
    await click(byId(el, 'contacts-register-table-row-con-2')!);
    expect(split.open).toHaveBeenCalledWith('con-2');
    expect(alertMock.mock.calls.filter((c) => c[0] === 'Discard changes?')).toHaveLength(0);
  });

  it('with unsaved edits in the open record, a row click asks "Discard changes?" first', async () => {
    const split = makeSplit('con-1');
    const { el } = await mount(
      <ContactsRegister contacts={CONTACTS} split={split} detail={<DirtyPart />} roles={ROLES} onNew={jest.fn()} deleteContact={jest.fn()} />,
    );
    expect(byId(el, 'dirty-part')).not.toBeNull();
    await click(byId(el, 'contacts-register-table-row-con-2')!);
    expect(split.open).not.toHaveBeenCalled();
    const [title, , buttons] = lastAlert();
    expect(title).toBe('Discard changes?');
    expect(buttons!.map((b) => b.text)).toEqual(['Keep editing', 'Discard']);
    await act(async () => { buttons![1].onPress?.(); });
    expect(split.open).toHaveBeenCalledWith('con-2');
  });

  it('bulk Delete confirms with the count, then deletes each selected contact', async () => {
    const deleteContact = jest.fn();
    const split = makeSplit('con-1');
    const { el } = await mount(
      <ContactsRegister contacts={CONTACTS} split={split} detail={<Text>record</Text>} roles={ROLES} onNew={jest.fn()} deleteContact={deleteContact} />,
    );
    await click(byId(el, 'contacts-register-table-row-con-1-check')!);
    await click(byId(el, 'contacts-register-table-row-con-3-check')!);
    await bulkButton(el, 'contacts-register-table', 'Delete');
    const [title, , buttons] = lastAlert();
    expect(title).toBe('Delete 2 contacts?');
    expect(deleteContact).not.toHaveBeenCalled();
    await act(async () => { buttons!.find((b) => b.style === 'destructive')!.onPress?.(); });
    await act(async () => { await Promise.resolve(); });
    expect(deleteContact.mock.calls.map((c) => c[0]).sort()).toEqual(['con-1', 'con-3']);
    // The open record was one of them: it closes.
    expect(split.close).toHaveBeenCalled();
  });

  it('Export CSV names the file by the local day', async () => {
    const { el } = await mount(
      <ContactsRegister contacts={CONTACTS} split={makeSplit()} detail={null} roles={ROLES} onNew={jest.fn()} deleteContact={jest.fn()} />,
    );
    await click(byId(el, 'contacts-register-csv')!);
    const call = (deliverTextFile as jest.Mock).mock.calls[0];
    expect(call[0]).toBe(`contacts-${localDay(new Date())}.csv`);
    expect(String(call[1]).split('\r\n')[0]).toContain('Name,First name,Last name,Company,Role');
  });

  it("'n' outside a field opens New", async () => {
    const onNew = jest.fn();
    await mount(<ContactsRegister contacts={CONTACTS} split={makeSplit()} detail={null} roles={ROLES} onNew={onNew} deleteContact={jest.fn()} />);
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true })); });
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});

const member = (id: string, name: string, extra: Partial<CrewMember> = {}): CrewMember => ({
  id, companyUserId: 'u1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  fullName: name, trades: [], status: 'active', idVerified: false, isPublic: false, projectIds: [], ...extra,
});
const CREW = [member('m1', 'Maria Gonzalez'), member('m2', 'Deon Parks'), member('m3', 'Lena Brandt', { status: 'inactive' })];

describe('Crew register (real DOM, 1512)', () => {
  function crew(props: Partial<React.ComponentProps<typeof CrewRegister>> = {}) {
    return (
      <CrewRegister
        members={CREW}
        certifications={[]}
        today="2026-09-25"
        loading={false}
        split={makeSplit()}
        detail={null}
        onNew={jest.fn()}
        updateCrewMember={jest.fn()}
        onOpenCertifications={jest.fn()}
        {...props}
      />
    );
  }

  it('rows link to /crew?crewId=…', async () => {
    const { el } = await mount(crew());
    expect(el.querySelector('a[href="/crew?crewId=m2"]')).not.toBeNull();
  });

  it('bulk Delete is disabled and says why; nothing is written', async () => {
    const updateCrewMember = jest.fn();
    const { el } = await mount(crew({ updateCrewMember }));
    await click(byId(el, 'crew-register-table-row-m1-check')!);
    await bulkButton(el, 'crew-register-table', 'Delete');
    const [title, message] = lastAlert();
    expect(title).toBe('Delete');
    expect(message).toBe(CREW_BULK_DELETE_REASON);
    expect(updateCrewMember).not.toHaveBeenCalled();
  });

  it('bulk Mark inactive writes each selected member', async () => {
    const updateCrewMember = jest.fn();
    const { el } = await mount(crew({ updateCrewMember }));
    await click(byId(el, 'crew-register-table-row-m1-check')!);
    await click(byId(el, 'crew-register-table-row-m2-check')!);
    await bulkButton(el, 'crew-register-table', 'Mark inactive');
    await act(async () => { await Promise.resolve(); });
    expect(updateCrewMember.mock.calls.map((c) => c[0]).sort()).toEqual(['m1', 'm2']);
    expect(updateCrewMember.mock.calls.every((c) => c[1].status === 'inactive')).toBe(true);
  });

  it('while the roster read is loading the empty table says Loading…, never "No crew yet"', async () => {
    const { el } = await mount(crew({ members: [], loading: true }));
    expect(el.textContent).toContain('Loading…');
    expect(el.textContent).not.toMatch(/No crew yet/);
  });

  it('Export CSV names the file crew-YYYY-MM-DD.csv (local day)', async () => {
    const { el } = await mount(crew());
    await click(byId(el, 'crew-register-csv')!);
    expect((deliverTextFile as jest.Mock).mock.calls[0][0]).toBe(`crew-${localDay(new Date())}.csv`);
  });
});

// hooks/useWhosOnCopy.ts — the ONLY place the "who is on this project" strings
// live (whoson spec 1.5). Every string goes through t('office.whoson.*',
// english, vars) / tn(...) so the i18n registry stays in one file (surface
// 'office.whoson'). components/whoson/* import this; they add no t() keys.
//
// Copy per docs/VOICE.md: sentence case, no exclamation marks, "project",
// "team member", "role". The words are chosen to say only what the app knows:
//   - "Has it open" = the project is on that person's screen. It is never
//     called proof that anyone is doing anything.
//   - "Last seen online here" = the last time a device reached the server with
//     the project open. A foreman with no signal all afternoon sends nothing.
//   - When the app does not know, it says nothing. There is no string for
//     "not here".
// scripts/validate-whoson.ts bans the words that would claim more.
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import { calendarDayOf, formatCalendarDay } from '@/utils/calendarDate';
import { formatTimeL } from '@/i18n/format';
import type { ActivityLine, MembershipLine } from '@/utils/whoson/people';

export interface WhosOnCopy {
  // ── the stack ──
  stackEmpty: string;
  stackInvite: string;
  stackOpen: (count: number) => string;
  stackOwnerOpen: string;
  stackChoose: string;
  stackA11y: (count: number) => string;
  stackA11yOpen: (count: number) => string;
  stackA11yMember: string;
  stackA11yEmpty: string;
  // ── a roster row ──
  /** `{name} · {company}`, one of them, or '' when the account typed neither. */
  nameCompany: (name: string | null, company: string | null) => string;
  membership: (line: MembershipLine) => string;
  activity: (line: ActivityLine) => string;
  rowOpen: string;
  // ── the team member's view of the owner ──
  /** '' when the owner's profile has neither a name nor a company. */
  ownerLine: (name: string | null, company: string | null) => string;
  // ── the question ──
  choiceTitle: string;
  choiceBody: string;
  choiceYes: string;
  choiceNo: string;
  // ── the switch ──
  shareLabel: string;
  shareHelper: string;
  shareOfflineWeb: string;
  shareFailed: string;
  // ── the Team block ──
  emptyBody: string;
  footMeaning: string;
  footGaps: string;
  footWho: string;
}

export function useWhosOnCopy(): WhosOnCopy {
  const { t, tn, lang } = useT();
  return useMemo<WhosOnCopy>(() => {
    const day = (iso: string) => formatCalendarDay(calendarDayOf(iso), undefined, lang);
    const time = (iso: string) => formatTimeL(iso, lang);
    const rowOpen = t('office.whoson.row.open', 'Has it open now');
    return {
      stackEmpty: t('office.whoson.stack.empty', 'No team members yet'),
      stackInvite: t('office.whoson.stack.invite', 'Invite'),
      stackOpen: (count: number) => tn('office.whoson.stack.open', count, { one: '1 has it open', other: '{count} have it open' }),
      stackOwnerOpen: t('office.whoson.stack.ownerOpen', 'The project owner has it open'),
      stackChoose: t('office.whoson.stack.choose', 'Choose what\'s shown'),
      stackA11y: (count: number) => t('office.whoson.stack.a11y', 'Team on this project: {count}.', { count }),
      stackA11yOpen: (count: number) => tn('office.whoson.stack.a11yOpen', count, { one: '1 has it open now.', other: '{count} have it open now.' }),
      stackA11yMember: t('office.whoson.stack.a11yMember', 'Team on this project.'),
      stackA11yEmpty: t('office.whoson.stack.a11yEmpty', 'No team members yet. Open the Team section.'),

      nameCompany: (name: string | null, company: string | null) => {
        if (name && company) return t('office.whoson.row.nameCompany', '{name} · {company}', { name, company });
        return name ?? company ?? '';
      },
      membership: (line: MembershipLine) => (line.key === 'joinedFromInvite'
        ? t('office.whoson.row.joinedFromInvite', 'Joined from your invite · {date}', { date: day(line.at) })
        : t('office.whoson.row.joined', 'Joined {date}', { date: day(line.at) })),
      activity: (line: ActivityLine) => {
        switch (line.key) {
          case 'open':
            return rowOpen;
          case 'seenMin':
            return tn('office.whoson.row.seenMin', line.count, { one: 'Last seen online here 1 min ago', other: 'Last seen online here {count} min ago' });
          case 'seenHr':
            return tn('office.whoson.row.seenHr', line.count, { one: 'Last seen online here 1 hr ago', other: 'Last seen online here {count} hr ago' });
          case 'seenDate':
            return t('office.whoson.row.seenDate', 'Last seen online here {date}', { date: day(line.at) });
          case 'seenAt':
          default:
            return t('office.whoson.row.seenAt', 'Last seen online here {date}, {time}', { date: day(line.at), time: time(line.at) });
        }
      },
      rowOpen,

      ownerLine: (name: string | null, company: string | null) => {
        if (name && company) return t('office.whoson.owner.lineCompany', 'Project owner: {name}, {company}', { name, company });
        const one = name ?? company;
        return one ? t('office.whoson.owner.line', 'Project owner: {name}', { name: one }) : '';
      },

      choiceTitle: t('office.whoson.choice.title', 'Show when you have a project open?'),
      choiceBody: t('office.whoson.choice.body', 'On a project someone shared with you, the project owner sees when you have it open and when you were last seen online there. On a project you own, your team members see when you have it open. Nothing is shown until you choose, and you can change it in Settings.'),
      choiceYes: t('office.whoson.choice.yes', 'Show it'),
      choiceNo: t('office.whoson.choice.no', 'Don\'t show it'),

      shareLabel: t('office.whoson.share.label', 'Show when I have a project open'),
      shareHelper: t('office.whoson.share.helper', 'The project owner sees when you have their project open and when you were last seen online there. Your team members see when you have your project open. Turn it off and they stop seeing both, and your last seen times are deleted.'),
      shareOfflineWeb: t('office.whoson.share.offlineWeb', 'Needs a connection.'),
      shareFailed: t('office.whoson.share.failed', 'Couldn\'t save that. Try again.'),

      emptyBody: t('office.whoson.empty.body', 'Team members show up here after they accept your invite to this project, not when they only download MAGE ID.'),
      footMeaning: t('office.whoson.foot.meaning', '"Has it open" means the project is on that person\'s screen right now. It doesn\'t show what they are doing.'),
      footGaps: t('office.whoson.foot.gaps', 'Work done without a signal, or on an older app version, doesn\'t show here. A team member can also choose not to show it.'),
      footWho: t('office.whoson.foot.who', 'Clients and subs who use a link instead of an account aren\'t listed here. Names and companies are what each person typed on their own profile; the email is the one you invited.'),
    };
  }, [t, tn, lang]);
}

export default useWhosOnCopy;

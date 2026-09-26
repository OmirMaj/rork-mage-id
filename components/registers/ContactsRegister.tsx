// components/registers/ContactsRegister.tsx — every contact in one sortable
// table, the open one beside it (wave 6d, lane R1). DESKTOP WEB ONLY:
// app/contacts.tsx renders this only when useIsDesktopWeb() is true; the
// phone keeps its search box and card list, untouched.
//
// On his 1512 px MacBook the phone search box measured 1,736 px wide over a
// column of 88 px cards. Here the search is the table's own (480 max), a row
// is 36 px, and a click opens the contact beside the list (?contactId=).
//
// Writes go through the screen's context actions only: the add/edit sheet
// (the screen's own Modal, framed on desktop) and bulk Delete (deleteContact
// per id, one per render — see useOneAtATime).
//
// No loaded signal exists for contacts (contract D9, named exception 2), so
// the empty state reuses the phone's copy and can show before the first load,
// exactly as the phone does today.

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Plus, User } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { DataTable, type DataTableColumn } from '@/components/desktop/DataTable';
import type { SplitRecord } from '@/components/desktop/SplitView';
import FilterChipRow from '@/components/FilterChipRow';
import EmptyState from '@/components/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { LogCard } from '@/components/logs/LogCard';
import { RegisterShell, exportRegisterCsv, useOneAtATime } from '@/components/registers/RegisterShell';
import { rowsToCsv } from '@/utils/dataTable';
import { showAlert } from '@/utils/alert';
import { CONTACT_CSV_COLUMNS } from '@/utils/registers/registerCsv';
import {
  contactDisplayName, contactMatchesRole, contactRoleCounts, contactSearchText,
} from '@/utils/registers/contactRows';
import type { Contact, ContactRole } from '@/types';

export interface ContactsRegisterProps {
  contacts: readonly Contact[];
  /** The screen's useSplitRecord({ param: 'contactId' }). */
  split: SplitRecord;
  /** The open contact's body (the phone detail sheet's own content), or the missing-record state. */
  detail: React.ReactNode | null;
  /** The screen's CONTACT_ROLES (value + chip label), in its order. */
  roles: readonly { value: ContactRole; label: string }[];
  /** Opens the screen's add sheet. */
  onNew: () => void;
  deleteContact: (id: string) => void;
}

type RoleFilter = ContactRole | 'all';

export function ContactsRegister({ contacts, split, detail, roles, onNew, deleteContact }: ContactsRegisterProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [role, setRole] = useState<RoleFilter>('all');
  const roleCounts = useMemo(() => contactRoleCounts(contacts, roles.map((r) => r.value)), [contacts, roles]);
  // A chip whose last contact was deleted falls back to All.
  const filter: RoleFilter = role !== 'all' && !roleCounts.some((r) => r.role === role) ? 'all' : role;
  // A copy: the table never sorts the context's own array.
  const rows = useMemo(() => contacts.filter((c) => contactMatchesRole(c, filter)), [contacts, filter]);
  const roleLabel = useCallback((r: ContactRole) => roles.find((x) => x.value === r)?.label ?? r, [roles]);

  const columns: DataTableColumn<Contact>[] = useMemo(() => [
    {
      key: 'name', label: 'Name', flex: 1.6, minWidth: 160,
      sortValue: (c) => `${c.lastName} ${c.firstName}`.trim() || c.companyName,
      value: (c) => contactDisplayName(c) || null,
    },
    { key: 'company', label: 'Company', flex: 1.2, minWidth: 120, sortValue: (c) => c.companyName || null, value: (c) => c.companyName || null },
    {
      key: 'role', label: 'Role', width: 120, sortValue: (c) => c.role,
      render: (c) => <Badge tone="neutral">{roleLabel(c.role)}</Badge>,
    },
    { key: 'email', label: 'Email', flex: 1.4, hideBelow: 800, sortValue: (c) => c.email || null, value: (c) => c.email || null },
    { key: 'phone', label: 'Phone', width: 140, hideBelow: 900, sortValue: (c) => c.phone || null, value: (c) => c.phone || null },
    {
      key: 'projects', label: 'Projects', width: 80, numeric: true, hideBelow: 1000,
      sortValue: (c) => c.linkedProjectIds.length,
      render: (c) => <Text style={styles.num}>{String(c.linkedProjectIds.length)}</Text>,
    },
  ], [roleLabel, styles.num]);

  const csv = useCallback(() => rowsToCsv(CONTACT_CSV_COLUMNS, rows), [rows]);
  const exportSelected = useCallback((ids: string[]) => {
    exportRegisterCsv('contacts', rowsToCsv(CONTACT_CSV_COLUMNS, rows.filter((c) => ids.includes(c.id))));
  }, [rows]);

  const deleteEach = useOneAtATime(deleteContact);
  const deleteSelected = useCallback((ids: string[]) => {
    const n = ids.length;
    if (n === 0) return;
    showAlert(
      `Delete ${n} contact${n === 1 ? '' : 's'}?`,
      `${n === 1 ? 'It comes' : 'They come'} off your contact list. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${n}`,
          style: 'destructive',
          onPress: () => {
            if (split.openId && ids.includes(split.openId)) split.close();
            deleteEach(ids);
          },
        },
      ],
    );
  }, [deleteEach, split]);

  const filtered = filter !== 'all';

  return (
    <RegisterShell
      registerId="contacts"
      title="Contacts"
      testID="contacts-register"
      csvStem="contacts"
      csv={csv}
      onNew={onNew}
      actions={[{ key: 'new', label: 'New contact', primary: true, icon: Plus, onPress: onNew, testID: 'contacts-register-new' }]}
      record={{ split, param: 'contactId', pathname: '/contacts', detail, noun: 'contact' }}
      renderTable={({ activeKey, onRowOpen, getRowHref }) => (
        <DataTable<Contact>
          tableId="reg-contacts"
          testID="contacts-register-table"
          density="compact"
          rows={rows}
          columns={columns}
          rowKey={(c) => c.id}
          activeKey={activeKey}
          onRowOpen={(c) => onRowOpen(c.id)}
          getRowHref={(c) => getRowHref(c.id)}
          defaultSort={{ key: 'name', dir: 'asc' }}
          searchText={contactSearchText}
          searchPlaceholder="Search contacts"
          selectable
          filterChips={(
            <FilterChipRow<RoleFilter>
              noPadding
              testID="contacts-register-chip"
              value={filter}
              onChange={setRole}
              chips={[
                { value: 'all', label: 'All', count: contacts.length },
                ...roleCounts.map((r) => ({ value: r.role, label: roleLabel(r.role), count: r.count })),
              ]}
            />
          )}
          bulkActions={[
            { key: 'csv', label: 'Export CSV', run: exportSelected },
            { key: 'delete', label: 'Delete', destructive: true, run: deleteSelected },
          ]}
          emptyState={(
            <EmptyState
              icon={<User size={28} color={t.accent} strokeWidth={1.75} />}
              title={filtered ? 'No contacts match' : 'No contacts yet'}
              message={filtered
                ? 'Try a different search term or clear the role filter to see everyone.'
                : 'Add your owners, architects, engineers, inspectors, and lenders here. Every RFI, daily report, and invoice can pull from this list automatically.'}
              actionLabel={filtered ? undefined : 'Add first contact'}
              onAction={filtered ? undefined : onNew}
            />
          )}
          renderCard={(c) => <LogCard title={contactDisplayName(c) || '—'} meta={roleLabel(c.role)} />}
        />
      )}
    />
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  num: { ...Type.bodyCompact, color: t.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
});

export default ContactsRegister;

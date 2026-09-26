// components/registers/RegisterRecordHost.tsx — how a record pane beside a
// register tells the register it holds unsaved edits (wave 6d, lane R1).
//
// The logs' LogRecordHost holds ONE probe (one editor per record). A register's
// record can hold several editable parts at once — the COI Vault shows one
// COICard per certificate, each with its own unsaved coverage rows — so this
// host keeps a SET of probes: the record is dirty when any of them says so.
// Opening another row, j/k, Esc and "Back to list" then ask "Discard changes?"
// first (RegisterShell's guard).
//
// PHONE IDENTICAL: the context is null everywhere except inside RegisterShell's
// record pane, and RegisterShell mounts only on desktop web. With no host,
// useRegisterRecordDirty registers nothing and renders nothing.

import { createContext, useContext, useEffect, useRef } from 'react';

export interface RegisterRecordHostValue {
  /** Register a "has unsaved edits" probe; the returned function removes it. */
  addDirtyProbe(fn: () => boolean): () => void;
}

/** null outside a register's record pane — always null on a phone. */
export const RegisterRecordContext = createContext<RegisterRecordHostValue | null>(null);

/**
 * Tell the register whether this part of the record holds unsaved edits. The
 * getter is read through a ref, so a fresh closure each render never
 * re-registers. A no-op without a host.
 */
export function useRegisterRecordDirty(getter: () => boolean): void {
  const host = useContext(RegisterRecordContext);
  const ref = useRef(getter);
  ref.current = getter;
  useEffect(() => {
    if (!host) return undefined;
    return host.addDirtyProbe(() => ref.current());
  }, [host]);
}

/** A set of probes and the one question the shell asks of them. */
export function createDirtyProbeSet(): { host: RegisterRecordHostValue; anyDirty(): boolean } {
  const probes = new Set<() => boolean>();
  return {
    host: {
      addDirtyProbe(fn) {
        probes.add(fn);
        return () => { probes.delete(fn); };
      },
    },
    anyDirty() {
      for (const p of probes) {
        let dirty = false;
        try { dirty = !!p(); } catch { dirty = false; }
        if (dirty) return true;
      }
      return false;
    },
  };
}

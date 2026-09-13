import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ShieldAlert, Plus, X, Trash2, AlertTriangle, ChevronLeft, Check, Mic,
  Camera, Images,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useTierAccess } from '@/hooks/useTierAccess';
// Project-scoped gate: an invited collaborator may do the work they were
// invited to do, even though their own tier is free. See
// utils/collaboratorAccess.
import { useProjectAccess } from '@/hooks/useProjectAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import type {
  SafetyIncident, SafetyIncidentType, SafetyIncidentSeverity, SafetyIncidentStatus,
  SafetyTreatment, IncidentCorrectiveAction, IncidentPerson, OshaIllnessType,
} from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { isOshaRecordable } from '@/utils/safety/osha';
import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '@/lib/supabase';
import { PhotoThumbGrid, burstSummary, captureBurst, pickPhotoBatch } from '@/components/PhotoCapture';
import { queuePhotoUpload, cancelPhotoUpload } from '@/utils/photoUploadQueue';
import {
  buildPhotoStoragePath, contentTypeForExt, isDeviceLocalUri, looksLikeStoragePath, photoExtFromUri,
} from '@/utils/photoUploadCore';
import { resolvePhotoUrls } from '@/utils/storage';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAlert } from '@/utils/alert';

/** Photos one incident report can carry. Eight is a scene, a hazard, the
 *  equipment, the corrective action and a couple of angles — past that it is a
 *  photo album, not a record an OSHA inspector will read. */
const MAX_INCIDENT_PHOTOS = 8;

const TYPE_OPTIONS: { value: SafetyIncidentType; label: string }[] = [
  { value: 'injury', label: 'Injury' },
  { value: 'near_miss', label: 'Near miss' },
  { value: 'property', label: 'Property' },
  { value: 'environmental', label: 'Environ.' },
];
const SEVERITY_OPTIONS: { value: SafetyIncidentSeverity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];
const TREATMENT_OPTIONS: { value: SafetyTreatment; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'first_aid', label: 'First aid' },
  { value: 'medical_beyond_first_aid', label: 'Medical' },
];
// OSHA 300 column M — injury vs illness category. Recorded explicitly; the
// coarse incident `type` cannot distinguish (e.g. skin vs respiratory).
const ILLNESS_OPTIONS: { value: OshaIllnessType; label: string }[] = [
  { value: 'injury', label: 'Injury' },
  { value: 'skin', label: 'Skin' },
  { value: 'respiratory', label: 'Respiratory' },
  { value: 'poisoning', label: 'Poisoning' },
  { value: 'hearing', label: 'Hearing' },
  { value: 'other_illness', label: 'Other illness' },
];

// AI returns free-form JSON — never trust its enum strings blindly. These
// guards are typed against the option lists (which are themselves typed to
// the SafetyIncidentType / SafetyIncidentSeverity unions), so a bad value
// from the model is dropped rather than poisoning state with an off-enum
// string that breaks the segmented pickers and downstream OSHA logic.
const isValidType = (v: unknown): v is SafetyIncidentType =>
  TYPE_OPTIONS.some(o => o.value === v);
const isValidSeverity = (v: unknown): v is SafetyIncidentSeverity =>
  SEVERITY_OPTIONS.some(o => o.value === v);

function getStatusConfig(t: ThemeColors, status: SafetyIncidentStatus): { label: string; color: string; bg: string } {
  switch (status) {
    case 'open': return { label: 'Open', color: t.danger, bg: t.danger + '18' };
    case 'investigating': return { label: 'Investigating', color: t.accent, bg: t.accent + '18' };
    case 'closed': return { label: 'Closed', color: t.success, bg: t.successSoft };
  }
}

function nextStatus(s: SafetyIncidentStatus): SafetyIncidentStatus {
  if (s === 'open') return 'investigating';
  if (s === 'investigating') return 'closed';
  return 'open';
}

export default function SafetyIncidentsScreen() {
  const router = useRouter();
  // Read the project from params here (not just in Inner) so the gate can
  // ask 'were they invited to THIS project?' before paywalling.
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useProjectAccess(gateProjectId);
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyIncidentsInner />;
}

function SafetyIncidentsInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { tier } = useTierAccess();
  const { user } = useAuth();
  const author = ((user?.name && user.name.trim()) || user?.email || '').trim();
  const { projectId, prefillDescription, prefillTreatment, prefillType, prefillLocation } = useLocalSearchParams<{
    projectId: string;
    prefillDescription?: string;
    prefillTreatment?: string;
    prefillType?: string;
    prefillLocation?: string;
  }>();
  const { getProject } = useProjects();
  const { getIncidentsForProject, addIncident, updateIncident, deleteIncident } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getIncidentsForProject(projectId ?? ''), [projectId, getIncidentsForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingIncident, setEditingIncident] = useState<SafetyIncident | null>(null);
  const [type, setType] = useState<SafetyIncidentType>('injury');
  const [severity, setSeverity] = useState<SafetyIncidentSeverity>('low');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [treatment, setTreatment] = useState<SafetyTreatment>('none');
  const [daysAway, setDaysAway] = useState('');
  const [daysRestricted, setDaysRestricted] = useState('');
  const [oshaIllnessType, setOshaIllnessType] = useState<OshaIllnessType>('injury');
  const [restrictedDuty, setRestrictedDuty] = useState(false);
  const [lostConsciousness, setLostConsciousness] = useState(false);
  const [fatality, setFatality] = useState(false);
  const [correctiveActions, setCorrectiveActions] = useState<IncidentCorrectiveAction[]>([]);
  const [peopleInvolved, setPeopleInvolved] = useState<IncidentPerson[]>([]);
  // INCIDENT-PHOTO (audit 2026-09-07 "worth doing" #11). photoUrls had this
  // useState, a `photo_urls` column, a field on SafetyIncident and a sync path
  // in SafetyContext — and NO WRITER anywhere in the app. The one record OSHA
  // reads back to you was the only safety surface with no way to attach an
  // image, while app/safety-hazards.tsx has had one since it shipped.
  //
  // What goes IN this array is the DURABLE value — the `project-photos` bucket
  // path once the bytes are staged for upload, and only a device-local URI
  // when there is no cloud to stage into (signed-out / unconfigured, which is
  // also exactly when SafetyContext writes nothing to the server). A `file://`
  // in a synced column means nothing on the inspector's laptop, the office
  // desktop, or this phone after a reinstall.
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  // Durable value → something this device can actually render right now: the
  // local original while the bytes are still queued, a signed URL once they
  // have landed. Session-only; never persisted, never sent.
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SafetyIncidentStatus>('open');

  // AI draft-from-notes.
  const [draftNotes, setDraftNotes] = useState('');
  const [drafting, setDrafting] = useState(false);

  // Prefill from MAGE Copilot (voice incident capture): open the form with the
  // spoken description + the OSHA treatment level already set for the GC to finish.
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (prefillApplied.current) return;
    if (!prefillDescription && !prefillTreatment) return;
    prefillApplied.current = true;
    if (prefillDescription) setDescription(prefillDescription);
    if (prefillLocation) setLocation(prefillLocation);
    if (prefillType === 'injury' || prefillType === 'near_miss' || prefillType === 'property' || prefillType === 'environmental') setType(prefillType);
    if (prefillTreatment === 'none' || prefillTreatment === 'first_aid' || prefillTreatment === 'medical_beyond_first_aid') setTreatment(prefillTreatment);
    setShowForm(true);
  }, [prefillDescription, prefillTreatment, prefillType, prefillLocation]);

  const resetForm = useCallback(() => {
    setEditingIncident(null);
    setType('injury'); setSeverity('low');
    setOccurredAt(new Date().toISOString().slice(0, 10));
    setDescription(''); setLocation('');
    setTreatment('none'); setDaysAway(''); setDaysRestricted(''); setOshaIllnessType('injury');
    setRestrictedDuty(false); setLostConsciousness(false); setFatality(false);
    setCorrectiveActions([]); setPeopleInvolved([]); setPhotoUrls([]); setPhotoPreviews({});
    setStatus('open'); setDraftNotes(''); setDrafting(false);
  }, []);

  // ── Corrective-action editor ─────────────────────────────────────────
  const addCorrectiveAction = useCallback(() => {
    setCorrectiveActions(prev => [...prev, { action: '', owner: '', done: false }]);
  }, []);
  const updateCorrectiveAction = useCallback((idx: number, field: 'action' | 'owner', value: string) => {
    setCorrectiveActions(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  }, []);
  const toggleCorrectiveDone = useCallback((idx: number) => {
    setCorrectiveActions(prev => prev.map((a, i) => i === idx ? { ...a, done: !a.done } : a));
  }, []);
  const removeCorrectiveAction = useCallback((idx: number) => {
    setCorrectiveActions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // ── People-involved editor ───────────────────────────────────────────
  const addPerson = useCallback(() => {
    setPeopleInvolved(prev => [...prev, { name: '', role: '' }]);
  }, []);
  const updatePerson = useCallback((idx: number, field: 'name' | 'role', value: string) => {
    setPeopleInvolved(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }, []);
  const removePerson = useCallback((idx: number) => {
    setPeopleInvolved(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Incident photos ──────────────────────────────────────────────────
  //
  // The bytes never block the form. queuePhotoUpload copies the file into
  // documentDirectory (which the OS does not reclaim) and uploads whenever the
  // network next allows, so a photo taken in a trench with no signal is safe
  // the moment the shutter closes — the same contract the project gallery and
  // punch list already run on.

  /**
   * Hand a freshly-captured file to the upload queue and return the value the
   * incident record should hold.
   *
   * Falls back to the local URI only when there is nothing to stage INTO — no
   * session, or Supabase not configured. In that state SafetyContext's
   * `canSync` is false too, so the incident is local-only anyway and a local
   * URI is the honest, and the only useful, thing to store.
   */
  const stageIncidentPhoto = useCallback((localUri: string): string => {
    const userId = user?.id;
    if (!userId || !projectId || !isSupabaseConfigured || !isDeviceLocalUri(localUri)) return localUri;
    // Namespaced so a permit scan, a punch photo and an incident photo for the
    // same project can never collide on one object key.
    const recordId = `incident-${generateUUID()}`;
    const ext = photoExtFromUri(localUri);
    const storagePath = buildPhotoStoragePath(userId, projectId, recordId, ext);
    void queuePhotoUpload({
      photoId: recordId, userId, projectId, localUri, storagePath,
      contentType: contentTypeForExt(ext),
    });
    // Remember which queue task this path belongs to, so removing the tile can
    // un-queue it. Scoped to THIS editing session on purpose — see
    // removeIncidentPhoto for why a saved photo's path must never be in here.
    stagedThisSessionRef.current.set(storagePath, recordId);
    return storagePath;
  }, [user?.id, projectId]);

  // How many photos are attached RIGHT NOW. `photoUrls` is a render-old value
  // inside attachIncidentPhoto: handleIncidentLibrary loops over the picked
  // assets, and on web captureBurst does the same (one multi-select dialog IS
  // the burst there) — several calls with no render in between, so the state
  // the callback closes over never moves and cannot be the thing the cap is
  // measured against. The ref moves synchronously, which is what makes it
  // possible to decide BEFORE any bytes are staged.
  const photoCountRef = useRef(0);
  useEffect(() => { photoCountRef.current = photoUrls.length; }, [photoUrls]);

  // storagePath → queue photoId, for photos staged during THIS edit only.
  // A ref, not state: nothing renders from it, and it must be readable
  // synchronously by a remove that happens between renders.
  const stagedThisSessionRef = useRef<Map<string, string>>(new Map());

  const attachIncidentPhoto = useCallback((localUri: string) => {
    // The cap is enforced here, before staging, and NOT inside the setState
    // updater. Staging is what hands the bytes to the upload queue, so a ninth
    // photo the updater silently dropped was still copied into
    // documentDirectory and uploaded to `project-photos` — an object no
    // incident row will ever reference and nothing ever deletes. Refusing early
    // costs nothing: captureBurst and pickPhotoBatch are told how many slots
    // are left before they open, so this only fires when something got past
    // them.
    if (photoCountRef.current >= MAX_INCIDENT_PHOTOS) return;
    photoCountRef.current += 1;
    // Staged OUTSIDE the state updater on purpose. A setState updater must be
    // pure — React is free to call it twice (it does, under StrictMode), and
    // staging inside one would queue the same photo for upload twice under two
    // different object keys.
    const durable = stageIncidentPhoto(localUri);
    setPhotoPreviews(m => ({ ...m, [durable]: localUri }));
    setPhotoUrls(prev => [...prev, durable]);
  }, [stageIncidentPhoto]);

  // Taking a photo off the report un-queues the upload it started. Without
  // this, attach-then-remove-before-save left the bytes in the queue, the flush
  // uploaded them anyway, and one unreferenced object sat in the contractor's
  // own folder of `project-photos` forever — nothing deletes it because nothing
  // knows it exists. An incident report, where the reporter is deciding what
  // belongs in an OSHA record, is exactly where people attach and then think
  // better of it.
  //
  // ONLY photos staged during THIS edit are cancellable, and that restriction
  // is the whole safety argument. Opening a SAVED incident puts that incident's
  // own storage paths into `photoUrls`; a user who removes a tile and then
  // backs out without saving must not have touched anything the saved record
  // still points at. Those paths were never put in the session map, so they are
  // not found and nothing happens to them.
  //
  // Second layer, deliberately: cancelPhotoUpload only drops a PENDING task and
  // unlinks the local copy. It never deletes from the bucket. So even a path
  // that somehow matched could not destroy an image that had already landed.
  // The cancel happens OUTSIDE the setState updater, for the same reason
  // attachIncidentPhoto stages outside one: React may call an updater twice
  // (it does under StrictMode), so a side effect inside would run twice.
  // Reading `photoUrls[idx]` directly is correct here in a way it is NOT in
  // attachIncidentPhoto — a remove is one tile tap per render, and `idx` came
  // from the list this render drew, so the render-old array is the array the
  // index refers to.
  const removeIncidentPhoto = useCallback((idx: number) => {
    const path = photoUrls[idx];
    const photoId = path ? stagedThisSessionRef.current.get(path) : undefined;
    if (path && photoId) {
      stagedThisSessionRef.current.delete(path);
      // Fire-and-forget: the tile comes off the report either way, and a failed
      // cancel is a leaked object, never a lost edit.
      void cancelPhotoUpload(photoId).catch(() => {/* the object stays; nothing the user can act on */});
    }
    setPhotoUrls(prev => prev.filter((_, i) => i !== idx));
  }, [photoUrls]);

  const handleIncidentCamera = useCallback(async () => {
    const remaining = MAX_INCIDENT_PHOTOS - photoUrls.length;
    if (remaining <= 0) {
      showAlert('Photo limit', `An incident report holds ${MAX_INCIDENT_PHOTOS} photos. Remove one to add another.`);
      return;
    }
    // Burst: the camera re-opens after each shot. An incident scene is
    // photographed from several angles in one pass, in the few minutes before
    // it gets cleaned up.
    const outcome = await captureBurst({ remaining, onCaptured: ({ uri }) => attachIncidentPhoto(uri) });
    const note = burstSummary(outcome.captured, outcome.stoppedBy, `${MAX_INCIDENT_PHOTOS}-photo`);
    if (note) showAlert(outcome.captured > 0 ? 'Photos attached' : 'Camera', note);
  }, [photoUrls.length, attachIncidentPhoto]);

  const handleIncidentLibrary = useCallback(async () => {
    const remaining = MAX_INCIDENT_PHOTOS - photoUrls.length;
    if (remaining <= 0) {
      showAlert('Photo limit', `An incident report holds ${MAX_INCIDENT_PHOTOS} photos. Remove one to add another.`);
      return;
    }
    const picked = await pickPhotoBatch({ remaining });
    for (const a of picked) attachIncidentPhoto(a.uri);
  }, [photoUrls.length, attachIncidentPhoto]);

  // Sign the bucket paths on an incident opened for edit. `project-photos` is
  // private, so a stored path is not renderable on its own; a path we cannot
  // sign (offline, expired) simply stays out of the map and its tile renders
  // as an empty frame rather than a broken one.
  useEffect(() => {
    const unresolved = photoUrls.filter(v => looksLikeStoragePath(v) && !photoPreviews[v]);
    if (unresolved.length === 0) return;
    let cancelled = false;
    void resolvePhotoUrls(unresolved).then(map => {
      if (cancelled || map.size === 0) return;
      setPhotoPreviews(prev => {
        const next = { ...prev };
        for (const [path, url] of map) next[path] = url;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [photoUrls, photoPreviews]);

  /** What each attached photo renders as, in order. */
  const incidentPhotoPreviews = useMemo(
    () => photoUrls.map(v => photoPreviews[v] ?? (looksLikeStoragePath(v) ? '' : v)),
    [photoUrls, photoPreviews],
  );

  const openEdit = useCallback((inc: SafetyIncident) => {
    setEditingIncident(inc);
    setType(inc.type); setSeverity(inc.severity); setOccurredAt(inc.occurredAt);
    setDescription(inc.description); setLocation(inc.location);
    setTreatment(inc.treatment); setDaysAway(String(inc.daysAway || ''));
    setDaysRestricted(String(inc.daysRestricted || '')); setOshaIllnessType(inc.oshaIllnessType ?? 'injury');
    setRestrictedDuty(inc.restrictedDuty); setLostConsciousness(inc.lostConsciousness); setFatality(inc.fatality);
    setCorrectiveActions(inc.correctiveActions); setPeopleInvolved(inc.peopleInvolved);
    setPhotoUrls(inc.photoUrls); setPhotoPreviews({});
    setStatus(inc.status); setDraftNotes(''); setDrafting(false);
    setShowForm(true);
  }, []);

  const handleDraftAI = useCallback(async () => {
    if (!draftNotes.trim()) { showAlert('Add notes', 'Type or dictate what happened first.'); return; }
    const check = await checkAILimit(tier, 'smart');
    if (!check.allowed) { showAlert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
    setDrafting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-draft-incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ voiceTranscript: draftNotes, notes: draftNotes }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { showAlert('AI unavailable', json.error ?? 'Fill the incident manually.'); return; }
      // Only apply AI enums when they match the union — otherwise keep the
      // current/default so a hallucinated value can't corrupt the pickers.
      if (isValidType(json.data.type)) setType(json.data.type);
      if (isValidSeverity(json.data.severity)) setSeverity(json.data.severity);
      setDescription(json.data.description ?? ''); setLocation(json.data.location ?? '');
      setCorrectiveActions((json.data.correctiveActions ?? []).map((a: { action: string; owner: string }) => ({ action: a.action, owner: a.owner, done: false })));
      await recordAIUsage('smart');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showAlert('AI unavailable', 'Network issue — fill the incident manually.');
    } finally {
      setDrafting(false);
    }
  }, [draftNotes, tier]);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) { showAlert('Missing description', 'Describe what happened.'); return; }
    const now = new Date().toISOString();
    const recordable = isOshaRecordable({
      type, treatment,
      daysAway: Number(daysAway) || 0,
      restrictedDuty, lostConsciousness, fatality,
    });
    if (editingIncident) {
      updateIncident(editingIncident.id, {
        type, severity, occurredAt, description: desc, location: location.trim(),
        peopleInvolved, photoUrls, correctiveActions, treatment,
        daysAway: Number(daysAway) || 0, daysRestricted: Number(daysRestricted) || 0,
        restrictedDuty, lostConsciousness, fatality, oshaIllnessType,
        oshaRecordable: recordable, status,
      });
    } else {
      const incident: SafetyIncident = {
        id: generateUUID(), projectId: projectId ?? '', type, severity, occurredAt,
        description: desc, location: location.trim(), peopleInvolved, photoUrls,
        correctiveActions, treatment, daysAway: Number(daysAway) || 0,
        daysRestricted: Number(daysRestricted) || 0, oshaIllnessType,
        restrictedDuty, lostConsciousness, fatality, oshaRecordable: recordable,
        status: 'open', reportedBy: author, createdBy: author, createdAt: now, updatedAt: now,
      };
      addIncident(incident);
    }
    setShowForm(false); resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [type, severity, occurredAt, description, location, peopleInvolved, photoUrls, correctiveActions, treatment, daysAway, daysRestricted, oshaIllnessType, restrictedDuty, lostConsciousness, fatality, status, editingIncident, projectId, addIncident, updateIncident, resetForm, author]);

  const handleAdvanceStatus = useCallback((inc: SafetyIncident) => {
    updateIncident(inc.id, { status: nextStatus(inc.status) });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [updateIncident]);

  const handleDelete = useCallback((id: string) => {
    showAlert('Delete incident', 'Delete this incident report?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteIncident(id) },
    ]);
  }, [deleteIncident]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Incidents' }} />
        <EmptyState
          icon={<ShieldAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="Open a project first"
          message="Incidents are tied to a project so each report carries its people, corrective actions, and OSHA classification. To log one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Open Incidents and hit + to report one, or draft it with AI.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `Incidents — ${project.name}` }} />
      <ScrollView {...fabScroll} contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        {items.map(item => {
          const sc = getStatusConfig(themeColors, item.status);
          const doneCount = item.correctiveActions.filter(a => a.done).length;
          return (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.85} onPress={() => openEdit(item)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.description}</Text>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <Text style={styles.cardMeta}>
                {TYPE_OPTIONS.find(o => o.value === item.type)?.label ?? item.type} · {item.severity}
              </Text>

              <View style={styles.badgeRow}>
                {item.oshaRecordable ? (
                  <View style={styles.oshaBadge}>
                    <AlertTriangle size={11} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.oshaBadgeText}>OSHA Recordable</Text>
                  </View>
                ) : null}
                <TouchableOpacity style={[styles.statusChip, { backgroundColor: sc.bg }]} onPress={() => handleAdvanceStatus(item)}>
                  <Text style={[styles.statusChipText, { color: sc.color }]}>{sc.label}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.cardSummaryRow}>
                {item.correctiveActions.length > 0 ? (
                  <Text style={styles.cardSummary}>
                    {doneCount}/{item.correctiveActions.length} action{item.correctiveActions.length === 1 ? '' : 's'}
                  </Text>
                ) : null}
                {/* An OSHA record either has the scene attached or it doesn't,
                    and that is worth knowing from the list. */}
                {item.photoUrls.length > 0 ? (
                  <View style={styles.cardPhotoTag}>
                    <Camera size={11} color={themeColors.textSecondary} strokeWidth={1.75} />
                    <Text style={styles.cardSummary}>
                      {item.photoUrls.length} photo{item.photoUrls.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}

        {items.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<ShieldAlert size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title="No incidents logged"
              message="Report injuries, near misses, and property damage the moment they happen. AI can draft the report from your notes, and OSHA-recordable status is classified automatically."
              actionLabel="Report incident"
              onAction={() => { resetForm(); setShowForm(true); }}
            />
          </View>
        )}

        {/* Report by voice — MAGE Copilot: speak what happened, answer the one
            OSHA-recordability question, land in this form pre-filled. */}
        <TouchableOpacity
          style={styles.addItemBtn}
          onPress={() => router.push({ pathname: '/copilot', params: { capabilityId: 'safety_incident', projectId: projectId ?? '' } } as never)}
          activeOpacity={0.7}
          testID="add-incident-voice"
        >
          <Mic size={16} color={themeColors.accent} strokeWidth={2} />
          <Text style={styles.addItemBtnText}>Report by voice</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-incident">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Report Incident</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Incident form — slide-up section modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Back" style={{ marginRight: 8 }}>
                    <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <Text style={[styles.formTitle, { flex: 1 }]}>{editingIncident ? 'Edit Incident' : 'Report Incident'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {/* AI draft-from-notes */}
                {!editingIncident ? (
                  <>
                    <Text style={styles.fieldLabel}>Draft with AI</Text>
                    <TextInput
                      style={[styles.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' as const }]}
                      value={draftNotes}
                      onChangeText={setDraftNotes}
                      placeholder="Dictate or type what happened — AI will fill in the fields..."
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                    />
                    <TouchableOpacity style={styles.aiBtn} onPress={handleDraftAI} disabled={drafting} activeOpacity={0.85} testID="incident-draft">
                      <MageAIMark size={16} color="#FFFFFF" accentColor="#FFFFFF" />
                      <Text style={styles.aiBtnText}>{drafting ? 'Drafting…' : 'Draft with AI'}</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                <Text style={styles.fieldLabel}>Type</Text>
                <View style={styles.segRow}>
                  {TYPE_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, type === o.value ? styles.segBtnActive : null]}
                      onPress={() => setType(o.value)}
                    >
                      <Text style={[styles.segText, type === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Severity</Text>
                <View style={styles.segRow}>
                  {SEVERITY_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, severity === o.value ? styles.segBtnActive : null]}
                      onPress={() => setSeverity(o.value)}
                    >
                      <Text style={[styles.segText, severity === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Description *</Text>
                <TextInput
                  style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What happened?"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  testID="incident-description-input"
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Occurred</Text>
                    <TextInput style={styles.input} value={occurredAt} onChangeText={setOccurredAt} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Location</Text>
                    <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. 3rd floor east" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                {/* Photos — the scene as it was, before it gets cleaned up. */}
                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>Photos</Text>
                  <Text style={styles.photoCount}>{photoUrls.length} of {MAX_INCIDENT_PHOTOS}</Text>
                </View>
                <View style={styles.photoBtnRow}>
                  <TouchableOpacity
                    style={styles.photoBtn}
                    onPress={handleIncidentCamera}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Take incident photos"
                    testID="incident-photo-camera"
                  >
                    <Camera size={15} color={themeColors.accentLabel} strokeWidth={1.75} />
                    <Text style={styles.photoBtnText}>Take photos</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoBtn}
                    onPress={handleIncidentLibrary}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Attach photos from library"
                    testID="incident-photo-library"
                  >
                    <Images size={15} color={themeColors.accentLabel} strokeWidth={1.75} />
                    <Text style={styles.photoBtnText}>From library</Text>
                  </TouchableOpacity>
                </View>
                <PhotoThumbGrid
                  uris={incidentPhotoPreviews}
                  onRemove={removeIncidentPhoto}
                  testIDPrefix="incident-photo"
                />

                {/* OSHA inputs */}
                <Text style={styles.sectionLabel}>OSHA classification</Text>
                <Text style={styles.fieldLabel}>Treatment</Text>
                <View style={styles.segRow}>
                  {TREATMENT_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, treatment === o.value ? styles.segBtnActive : null]}
                      onPress={() => setTreatment(o.value)}
                    >
                      <Text style={[styles.segText, treatment === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Days away from work</Text>
                    <TextInput style={styles.input} value={daysAway} onChangeText={setDaysAway} placeholder="0" placeholderTextColor={themeColors.textMuted} keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Days restricted / transfer</Text>
                    <TextInput style={styles.input} value={daysRestricted} onChangeText={setDaysRestricted} placeholder="0" placeholderTextColor={themeColors.textMuted} keyboardType="number-pad" />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Injury / illness type</Text>
                <View style={styles.segRow}>
                  {ILLNESS_OPTIONS.map(o => (
                    <TouchableOpacity
                      key={o.value}
                      style={[styles.segBtn, oshaIllnessType === o.value ? styles.segBtnActive : null]}
                      onPress={() => setOshaIllnessType(o.value)}
                    >
                      <Text style={[styles.segText, oshaIllnessType === o.value ? styles.segTextActive : null]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={styles.toggleRow} onPress={() => setRestrictedDuty(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.toggleLabel}>Restricted duty / job transfer</Text>
                  <View style={[styles.toggleBox, restrictedDuty ? styles.toggleBoxOn : null]}>
                    {restrictedDuty ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toggleRow} onPress={() => setLostConsciousness(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.toggleLabel}>Loss of consciousness</Text>
                  <View style={[styles.toggleBox, lostConsciousness ? styles.toggleBoxOn : null]}>
                    {lostConsciousness ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.toggleRow} onPress={() => setFatality(v => !v)} activeOpacity={0.7}>
                  <Text style={styles.toggleLabel}>Fatality</Text>
                  <View style={[styles.toggleBox, fatality ? styles.toggleBoxOn : null]}>
                    {fatality ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>

                {/* Corrective actions */}
                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>Corrective actions</Text>
                  <TouchableOpacity onPress={addCorrectiveAction} style={styles.addStepBtn} accessibilityRole="button" accessibilityLabel="Add corrective action">
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addStepText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {correctiveActions.map((a, idx) => (
                  <View key={idx} style={styles.editRow}>
                    <View style={styles.editRowHeader}>
                      <TouchableOpacity style={[styles.doneToggle, a.done ? styles.doneToggleOn : null]} onPress={() => toggleCorrectiveDone(idx)}>
                        <Text style={[styles.doneToggleText, { color: a.done ? themeColors.success : themeColors.textSecondary }]}>{a.done ? 'Done' : 'Open'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => removeCorrectiveAction(idx)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove action">
                        <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                    <TextInput style={styles.input} value={a.action} onChangeText={v => updateCorrectiveAction(idx, 'action', v)} placeholder="Action" placeholderTextColor={themeColors.textMuted} />
                    <TextInput style={styles.input} value={a.owner} onChangeText={v => updateCorrectiveAction(idx, 'owner', v)} placeholder="Owner" placeholderTextColor={themeColors.textMuted} />
                  </View>
                ))}

                {/* People involved */}
                <View style={styles.stepsHeader}>
                  <Text style={styles.fieldLabel}>People involved</Text>
                  <TouchableOpacity onPress={addPerson} style={styles.addStepBtn} accessibilityRole="button" accessibilityLabel="Add person">
                    <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.addStepText}>Add</Text>
                  </TouchableOpacity>
                </View>
                {peopleInvolved.map((p, idx) => (
                  <View key={idx} style={styles.editRow}>
                    <View style={styles.editRowHeader}>
                      <Text style={styles.stepNum}>Person {idx + 1}</Text>
                      <TouchableOpacity onPress={() => removePerson(idx)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove person">
                        <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                    <TextInput style={styles.input} value={p.name} onChangeText={v => updatePerson(idx, 'name', v)} placeholder="Name" placeholderTextColor={themeColors.textMuted} />
                    <TextInput style={styles.input} value={p.role} onChangeText={v => updatePerson(idx, 'role', v)} placeholder="Role" placeholderTextColor={themeColors.textMuted} />
                  </View>
                ))}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-incident">
                    <Text style={styles.saveBtnText}>{editingIncident ? 'Update' : 'Report'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  // Record lists (certs / incidents / inspections / forms) — desktop gets the
  // viewport rather than a 760px column stranded in the middle.
  contentDesktop: { width: '100%', maxWidth: 1200, alignSelf: 'center' as const },
  card: { marginHorizontal: 20, marginTop: 12, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text, lineHeight: 21 },
  cardMeta: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary },
  cardSummary: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  cardSummaryRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, flexWrap: 'wrap' as const },
  cardPhotoTag: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  oshaBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '18' },
  oshaBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  deleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.danger + '18', alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  photoCount: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  photoBtnRow: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  // accentSoft fill with the accentLabel foreground: the brand orange behind
  // white text is 2.87:1 and fails AA, so a tinted button carries the coloured
  // LABEL instead (5.86:1). Same pairing as the other secondary actions here.
  photoBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.accentSoft,
  },
  photoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accentLabel },
  sectionLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text, marginTop: 12, marginBottom: 2 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  aiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill },
  aiBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  segRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segBtn: { flexGrow: 1, minWidth: 70, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  segBtnActive: { backgroundColor: themeColors.accent + '18', borderColor: themeColors.accent },
  segText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  segTextActive: { color: themeColors.accent, fontWeight: '700' as const },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, marginTop: 8 },
  toggleLabel: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text },
  toggleBox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  toggleBoxOn: { backgroundColor: themeColors.accent, borderColor: themeColors.accent },
  stepsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  addStepBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12' },
  addStepText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  editRow: { backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md, padding: 12, gap: 8, marginTop: 8, borderWidth: 0.5, borderColor: themeColors.line },
  editRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepNum: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  doneToggle: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  doneToggleOn: { backgroundColor: themeColors.successSoft },
  doneToggleText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
});

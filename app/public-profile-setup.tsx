import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {View, Text, StyleSheet, ScrollView, TextInput, Switch, TouchableOpacity, Platform, Linking, ActivityIndicator} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import {
  ChevronLeft, Globe, Copy, Send, Eye, Quote, ChevronRight,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  buildPublicProfileSnapshot, buildPublicProfileUrl, slugify, choosePortfolioPhotos,
  publicLocationFor, publicProfileIdFor, PORTFOLIO_URL_WARN_LENGTH, sha256Hex,
  ownsForPortfolio, makeSerialQueue,
} from '@/utils/publicProfileSnapshot';
import {
  planPortfolioPhotos, publishPortfolioAssets, removePortfolioCopies,
  writePublicProfileFlag, readPublicProfileFlag, readPublicProfileStatus,
  type PublishAssetsResult,
} from '@/utils/portfolioPublish';
import { isSampleProjectName } from '@/utils/projectCap';
import type { Project, PublicProfileSettings } from '@/types';
import { shareText } from '@/utils/shareText';
import { formatMoney } from '@/utils/formatters';
import { copyToClipboard } from '@/utils/clipboard';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const PUBLIC_BASE = 'https://mageid.app/builders';

// The truth about the switch (audit wave 5, #47 / #75). Links made since this
// update carry the page's id and the page checks it before it renders. Links
// made before carry no id, so nothing can reach them.
export const PUBLISH_SWITCH_COPY =
  "Anyone with the link can view it. Turning this off takes the page down; links shared before this update can't be recalled.";

/** Why a job can't be published from this account (see ownsForPortfolio). */
export const OWNER_ONLY_REASON = "Project pages are published by the job's owner — ask them to publish it.";
const SAMPLE_REASON = 'This is a sample job, so it has no public page. Publish one of your own jobs.';
const NOT_ON_SERVER_REASON =
  "This job hasn't synced yet — publish once it has. Until then the page would read \"taken down\".";

/** An alert with a Cancel and one go-ahead button, as a promise. Native only:
 *  on web an await before the copy / share / open loses the click's user
 *  activation, so web shows these warnings inline instead. */
function confirmAsk(title: string, message: string, okText: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
    showAlert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => done(false) },
      { text: okText, onPress: () => done(true) },
    ], { onDismiss: () => done(false) });
  });
}

/**
 * Preview on every platform (#177). It used to be a web-only window.open, so
 * the button did nothing on iPhone. Native gets the in-app Safari sheet, then
 * the system browser. A failure says what to do instead.
 *
 * The web branch runs synchronously inside the tap (no await before
 * window.open), or Safari's popup blocker eats it. It opens without the
 * 'noopener' feature because that makes window.open return null on every
 * browser, so a blocked tab couldn't be told apart from an opened one. The
 * opener is cut right after instead.
 */
function openPreview(url: string): void {
  if (Platform.OS === 'web') {
    const w = (globalThis as unknown as { window?: { open?: (u: string, t: string) => { opener: unknown } | null } }).window;
    const tab = w?.open ? w.open(url, '_blank') : null;
    if (!tab) {
      showAlert('Could not open preview', 'Your browser blocked the new tab. Copy the link and open it in a new tab.');
      return;
    }
    try { tab.opener = null; } catch { /* cross-origin already */ }
    return;
  }
  void Haptics.selectionAsync();
  void (async () => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      try {
        await Linking.openURL(url);
      } catch {
        showAlert('Could not open preview', 'Copy the link and open it in Safari.');
      }
    }
  })();
}

type PrepareOutcome = { ok: true; res: PublishAssetsResult } | { ok: false; reason: string | null };

export default function PublicProfileSetupScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getProject, updateProject, settings, getPhotosForProject, projects } = useProjects();
  const { user } = useAuth();

  const project = useMemo(() => id ? getProject(id) : undefined, [id, getProject]);
  const photos = useMemo(() => id ? getPhotosForProject(id) : [], [id, getPhotosForProject]);

  const [profile, setProfile] = useState<PublicProfileSettings>(() => {
    return project?.publicProfile ?? {
      enabled: false,
      slug: slugify(project?.name),
      publicHeadline: '',
      publicBody: '',
    };
  });

  const ownerId = user?.id;
  const isOwner = ownsForPortfolio(project, ownerId);
  // Why this job can't be published from here at all, or null.
  const publishBlocked: string | null = !project
    ? null
    : !ownerId
      ? 'Sign in to publish this page.'
      : !isOwner
        ? OWNER_ONLY_REASON
        : isSampleProjectName(project.name)
          ? SAMPLE_REASON
          : null;

  // ── Preparing the link (off the tap) ────────────────────────────────────
  // Publishing needs the network: the flag upsert, then up to 18 photo copies
  // and the logo upload. On web, running that inside the Copy / Share /
  // Preview tap spent the click's user activation, so Safari blocked the
  // new tab and the clipboard / Web Share refused. It now runs when the page
  // is on and whenever the photos or the logo change. The buttons then use
  // the prepared link synchronously, and say "Preparing the link…" meanwhile.
  const [prepared, setPrepared] = useState<{ key: string; res: PublishAssetsResult } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<{ key: string; reason: string } | null>(null);
  // Every server-side step (flag writes, copies, the take-down's removal) runs
  // through this one queue, in order, so a take-down can't delete copies a
  // republish just made, and an "on" upsert can't land after an "off" one.
  const serialRef = useRef(makeSerialQueue());
  // Bumped by every prepare and every switch flip; a job that finds it moved
  // on stops (its result would describe a page state that is gone).
  const genRef = useRef(0);
  const inFlightKeyRef = useRef<string | null>(null);

  // The project can arrive after mount — picked from the list below, or loaded
  // after a cold start — and the initializer above only ever saw the first one.
  useEffect(() => {
    if (!project) return;
    setProfile(project.publicProfile ?? {
      enabled: false, slug: slugify(project.name), publicHeadline: '', publicBody: '',
    });
    genRef.current++;
    inFlightKeyRef.current = null;
    setPrepared(null);
    setPrepareError(null);
    setPreparing(false);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Finished jobs first: a portfolio page is for work that is done, but a job
  // still in progress is not hidden — he may want the page ready for handover.
  // Jobs shared with him sort last: their owner publishes them.
  const pickable = useMemo(() => {
    const rank = (st: string) => (st === 'completed' || st === 'closed' ? 0 : 1);
    const mine = (p: Project) => (ownsForPortfolio(p, ownerId) ? 0 : 1);
    return [...projects].sort((a, b) => mine(a) - mine(b) || rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  }, [projects, ownerId]);

  const persist = useCallback((updates: Partial<PublicProfileSettings>) => {
    if (!id || !project) return;
    const next: PublicProfileSettings = { ...profile, ...updates };
    setProfile(next);
    updateProject(id, { publicProfile: next });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [id, project, profile, updateProject]);

  // ── The page's on/off flag lives on the server (public_profiles) ─────────
  // project.publicProfile is device-local, so a second phone (or a refetch)
  // can disagree with it. On open, the server's answer wins, unless he has
  // already touched the switch here. A page that is off also has its public
  // photo copies removed (retried here if the unpublish happened offline).
  // Nothing is prepared (which would turn the flag back ON) until this read
  // has answered, so a page taken down from another phone stays down. When
  // the read fails (offline), preparing waits for his Try again.
  const touchedRef = useRef(false);
  const [serverCheck, setServerCheck] = useState<'pending' | 'done' | 'unknown'>('pending');
  useEffect(() => {
    touchedRef.current = false;
    setServerCheck('pending');
    if (!ownerId || !project || !isOwner) return;
    let cancelled = false;
    void (async () => {
      const state = await readPublicProfileFlag(ownerId, project.id);
      if (cancelled) return;
      const server = state === 'on' ? true : state === 'off' ? false : null;
      if (!touchedRef.current) {
        const localOn = !!project.publicProfile?.enabled;
        if (server !== null && server !== localOn) {
          const next: PublicProfileSettings = {
            ...(project.publicProfile ?? { slug: slugify(project.name), publicHeadline: '', publicBody: '' }),
            enabled: server,
          };
          setProfile(next);
          updateProject(project.id, { publicProfile: next });
        }
        if ((server ?? localOn) === false) void serialRef.current(() => removePortfolioCopies(ownerId, project.id));
      }
      setServerCheck(state === 'unknown' ? 'unknown' : 'done');
    })();
    return () => { cancelled = true; };
  }, [ownerId, project?.id, isOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePublish = useCallback(async (val: boolean) => {
    if (!project) return;
    if (publishBlocked || !ownerId) {
      showAlert("Can't publish this job", publishBlocked ?? 'Sign in to publish this page.');
      return;
    }
    touchedRef.current = true;
    // Whatever was being prepared describes the other state of the switch.
    genRef.current++;
    inFlightKeyRef.current = null;
    setPrepared(null);
    setPrepareError(null);
    setPreparing(false);
    persist({ enabled: val, publishedAt: val ? new Date().toISOString() : profile.publishedAt });
    // ON: the prepare effect below writes the flag, then copies the photos.
    if (val) return;
    // OFF: the flag write, then the copies' removal, behind anything already
    // queued (a copy in flight finishes first and is then removed).
    const outcome = await serialRef.current(async () => {
      const o = await writePublicProfileFlag(ownerId, project.id, val);
      await removePortfolioCopies(ownerId, project.id);
      return o;
    });
    if (outcome === 'queued') {
      showAlert('Taking the page down', "You're offline. The page comes down as soon as this phone reconnects.");
    } else if (outcome === 'failed') {
      showAlert('The page is still up', "MAGE ID couldn't take the page down. Turn Publish on and off again to retry.");
    }
  }, [project, ownerId, publishBlocked, persist, profile.publishedAt]);

  // ── What the link carries ────────────────────────────────────────────────
  const chosen = useMemo(() => choosePortfolioPhotos(profile, photos), [profile, photos]);
  const plan = useMemo(
    () => (ownerId && project ? planPortfolioPhotos(ownerId, project.id, chosen) : { urls: {}, notUploaded: chosen }),
    [ownerId, project, chosen],
  );
  const logoUri = settings?.branding?.logoUri;
  const logoKey = useMemo(() => (logoUri ? sha256Hex(logoUri).slice(0, 16) : ''), [logoUri]);
  // What the prepared link depends on: the job, the logo, and the photos that
  // can be copied. A photo finishing its upload changes it, so it re-prepares.
  const prepareKey = useMemo(() => {
    if (!project || !ownerId) return '';
    return [ownerId, project.id, logoKey, ...Object.keys(plan.urls)].join('|');
  }, [project, ownerId, logoKey, plan.urls]);
  const where = useMemo(() => (project ? publicLocationFor(project, profile) : { shown: '' }), [project, profile]);

  const prepare = useCallback(async () => {
    if (!project || !ownerId || publishBlocked || !profile.enabled || !prepareKey) return;
    const gen = ++genRef.current;
    const key = prepareKey;
    const projectId = project.id;
    const photosNow = chosen;
    const logoNow = logoUri;
    const pid = publicProfileIdFor(ownerId, projectId);
    inFlightKeyRef.current = key;
    setPreparing(true);
    setPrepareError(null);
    const stale = () => gen !== genRef.current;
    const outcome = await serialRef.current(async (): Promise<PrepareOutcome> => {
      if (stale()) return { ok: false, reason: null };
      const flag = await writePublicProfileFlag(ownerId, projectId, true);
      if (flag !== 'synced') {
        return {
          ok: false,
          reason: flag === 'queued'
            ? "You're offline. Publishing uploads the photos and turns the page on, so the link is ready once you have signal."
            : "MAGE ID couldn't turn the page on. Tap Try again in a moment.",
        };
      }
      if (stale()) return { ok: false, reason: null };
      const live = await readPublicProfileStatus(pid);
      if (live === null) return { ok: false, reason: "MAGE ID couldn't check the page is live. Tap Try again." };
      if (!live) return { ok: false, reason: NOT_ON_SERVER_REASON };
      if (stale()) return { ok: false, reason: null };
      const res = await publishPortfolioAssets({ ownerId, projectId, photos: photosNow, logoUri: logoNow });
      return { ok: true, res };
    }).catch((): PrepareOutcome => ({ ok: false, reason: "MAGE ID couldn't prepare the link. Tap Try again." }));
    if (stale()) return;
    inFlightKeyRef.current = null;
    setPreparing(false);
    if (outcome.ok) setPrepared({ key, res: outcome.res });
    else if (outcome.reason) setPrepareError({ key, reason: outcome.reason });
  }, [project, ownerId, publishBlocked, profile.enabled, prepareKey, chosen, logoUri]);

  // Prepare whenever the page is on and the link is missing or out of date.
  // A failure for this exact key waits for Try again (no retry loop).
  useEffect(() => {
    if (!profile.enabled || publishBlocked || !prepareKey) return;
    if (serverCheck !== 'done' && !touchedRef.current) return;
    if (prepared?.key === prepareKey || prepareError?.key === prepareKey) return;
    if (inFlightKeyRef.current === prepareKey) return;
    void prepare();
  }, [profile.enabled, publishBlocked, prepareKey, serverCheck, prepared?.key, prepareError?.key, prepare]);

  const buildLink = useCallback((photoUrls: Record<string, string>, logoUrl?: string): string => {
    if (!project) return '';
    const snap = buildPublicProfileSnapshot({
      project: { ...project, publicProfile: profile },
      settings,
      photos,
      // The page's quote form routes the lead by this account id first; the
      // company-name slug alone collides between two same-named companies
      // and breaks the moment he renames his company.
      ownerId,
      pid: ownerId ? publicProfileIdFor(ownerId, project.id) : undefined,
      publicPhotoUrls: photoUrls,
      publicLogoUrl: logoUrl,
    });
    return buildPublicProfileUrl(PUBLIC_BASE, slugify(settings?.branding?.companyName), snap.project.slug, snap);
  }, [project, profile, settings, photos, ownerId]);

  const snapshot = useMemo(() => {
    if (!project) return null;
    return buildPublicProfileSnapshot({ project: { ...project, publicProfile: profile }, settings, photos });
  }, [project, profile, settings, photos]);

  // The link is built from what actually landed in the last preparation for
  // THIS key; headline, story and stat edits rebuild it without the network.
  const ready = prepared && prepared.key === prepareKey ? prepared.res : null;
  const failedIds = useMemo(() => new Set(ready?.failedPhotoIds ?? []), [ready]);
  const publicUrl = useMemo(() => (ready ? buildLink(ready.photoUrls, ready.logoUrl) : ''), [ready, buildLink]);
  const errorNow = prepareError && prepareError.key === prepareKey
    ? prepareError.reason
    : serverCheck === 'unknown' && !touchedRef.current && !ready && !preparing
      ? "MAGE ID couldn't check whether this page is up. Tap Try again."
      : null;
  const tooLong = publicUrl.length > PORTFOLIO_URL_WARN_LENGTH;

  // Why Copy / Share / Preview can't run right now, or null.
  const outBlocked: string | null = publishBlocked
    ?? (!profile.enabled
      ? 'Turn on Publish to get a link.'
      : errorNow
        ? errorNow
        : !ready || preparing
          ? 'Preparing the link…'
          : !publicUrl
            ? 'The link could not be built.'
            : null);

  /** Starts the copy / share / open with no await before it (see handleOut). */
  const runOut = useCallback((kind: 'copy' | 'share' | 'preview', url: string) => {
    if (!project) return;
    if (kind === 'copy') {
      void copyToClipboard(url).then(ok => {
        if (Platform.OS !== 'web' && ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAlert(
          ok ? 'Copied' : 'Copy failed',
          ok ? 'The public profile link has been copied.' : 'Could not copy the link.',
        );
      });
    } else if (kind === 'share') {
      void shareText({
        message: `Check out our recent project: ${project.name}\n\n${url}`,
        url,
      }).then(outcome => {
        if (outcome === 'shared' || outcome === 'copied') persist({ publishedAt: new Date().toISOString() });
        if (outcome === 'copied') showAlert('Link copied', 'Sharing is not available here, so the link was copied instead.');
        if (outcome === 'failed') showAlert('Share failed', 'Could not share or copy the link.');
      });
    } else {
      openPreview(url);
    }
  }, [project, persist]);

  /**
   * Copy / Share / Preview use the link prepared above. On WEB nothing is
   * awaited before runOut: the browser only lets a page open a tab, write the
   * clipboard or open the share sheet during the click that asked for it.
   * The warnings a native confirm would give (photos left out, a very long
   * link) are shown inline above the buttons there instead.
   */
  const handleOut = useCallback((kind: 'copy' | 'share' | 'preview') => {
    if (outBlocked || !publicUrl) return;
    const url = publicUrl;
    if (Platform.OS === 'web') {
      runOut(kind, url);
      return;
    }
    void (async () => {
      if (kind !== 'preview') {
        const n = plan.notUploaded.length;
        if (n > 0) {
          const go = await confirmAsk(
            n === 1 ? '1 photo not uploaded yet' : n + ' photos not uploaded yet',
            n === 1
              ? "This photo hasn't finished uploading from the phone that took it, so it can't go on the public page. Wait for the upload and share again, or share without it."
              : 'These ' + n + " photos haven't finished uploading from the phone that took them, so they can't go on the public page. Wait for the upload and share again, or share without them.",
            'Share without them',
          );
          if (!go) return;
        }
        const left = failedIds.size;
        if (left > 0) {
          const go = await confirmAsk(
            left === 1 ? '1 photo left out' : left + ' photos left out',
            left === 1
              ? "One photo couldn't be copied to the public page, so the link leaves it out. Continue without it, or turn Publish off and on with better signal."
              : left + " photos couldn't be copied to the public page, so the link leaves them out. Continue without them, or turn Publish off and on with better signal.",
            'Continue',
          );
          if (!go) return;
        }
        if (tooLong) {
          const go = await confirmAsk(
            'This link is very long',
            `It is ${Math.round(url.length / 1000)} KB. Some texts, email apps and website link fields cut long links off, and a cut link opens as "Project not found". Shorten the story or testimonial to make it shorter.`,
            'Use it anyway',
          );
          if (!go) return;
        }
      }
      runOut(kind, url);
    })();
  }, [outBlocked, publicUrl, plan.notUploaded.length, failedIds, tooLong, runOut]);

  const handleCopy = useCallback(() => { handleOut('copy'); }, [handleOut]);
  const handleShare = useCallback(() => { handleOut('share'); }, [handleOut]);
  const handlePreview = useCallback(() => { handleOut('preview'); }, [handleOut]);
  const handleRetry = useCallback(() => {
    setPrepareError(null);
    void prepare();
  }, [prepare]);

  if (!project) {
    // Opened with no project — Settings' row used to land every tap here on a
    // bare "Project not found." This page publishes ONE job, so ask which.
    // An id that does not resolve (a deleted job) says so above the list.
    return (
      <>
        <Stack.Screen options={{ title: 'Project page' }} />
        <ScrollView
          {...fabScroll}
          style={styles.container}
          contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        >
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Globe size={20} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.heroEyebrow}>Free portfolio page</Text>
            <Text style={styles.heroTitle}>Which job do you want to show off?</Text>
            <Text style={styles.heroBody}>
              {id
                ? 'That project is no longer on this account. Pick another one below.'
                : 'A public page for one project — photos, scope and your company name — that you can link from your website or send to a prospect.'}
            </Text>
          </View>
          <View style={styles.section}>
            {pickable.length === 0 ? (
              <Text style={styles.muted}>No projects yet. Create one, add photos as the job goes, and publish its page when it is done.</Text>
            ) : (
              <View style={styles.togglesCard}>
                {pickable.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.pickRow}
                    onPress={() => router.setParams({ id: p.id })}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    testID={`public-profile-pick-${p.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.toggleLabel}>{p.name}</Text>
                      <Text style={styles.toggleDesc}>
                        {!ownsForPortfolio(p, ownerId)
                          ? 'Shared with you · owner publishes'
                          : p.publicProfile?.enabled ? 'Published' : p.status === 'completed' || p.status === 'closed' ? 'Finished · not published' : 'In progress · not published'}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Public Profile',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        {...fabScroll}
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Globe size={20} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroEyebrow}>Free portfolio page</Text>
          <Text style={styles.heroTitle}>{project.name}</Text>
          <Text style={styles.heroBody}>
            Showcase this project on a public page at{' '}
            <Text style={{ color: themeColors.accent, fontWeight: '700' }}>
              mageid.app/builders/…/{profile.slug || slugify(project.name)}
            </Text>{' '}
            — perfect to link from your website, Google Business profile, or send to prospective clients.
          </Text>
        </View>

        {/* Toggle */}
        <View style={styles.section}>
          <View style={styles.togglesCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLeft}>
                <MageAIMark size={18} color={themeColors.accent} />
                <View style={styles.toggleLabels}>
                  <Text style={styles.toggleLabel}>Publish project page</Text>
                  <Text style={styles.toggleDesc} testID="public-profile-publish-copy">{PUBLISH_SWITCH_COPY}</Text>
                </View>
              </View>
              <Switch
                value={profile.enabled}
                onValueChange={val => { void togglePublish(val); }}
                disabled={!!publishBlocked}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor="#FFF"
              />
            </View>
          </View>
          {publishBlocked ? (
            <Text style={styles.blockedReason} testID="public-profile-publish-blocked">{publishBlocked}</Text>
          ) : null}
        </View>

        {/* Share link: always shown, blocked with the reason while the page is off */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Share link</Text>
          {profile.enabled && publicUrl ? (
            <View style={styles.linkBox}>
              <Globe size={14} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.linkText} numberOfLines={1}>{publicUrl}</Text>
            </View>
          ) : null}
          <View style={styles.shareRow}>
            <TouchableOpacity
              style={[styles.shareBtn, !!outBlocked && styles.shareBtnDisabled]}
              onPress={handleCopy}
              disabled={!!outBlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!outBlocked }}
              testID="public-profile-copy"
            >
              <Copy size={16} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.shareBtnText}>Copy</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareBtn, styles.shareBtnPrimary, !!outBlocked && styles.shareBtnDisabled]}
              onPress={handleShare}
              disabled={!!outBlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!outBlocked }}
              testID="public-profile-share"
            >
              <Send size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={[styles.shareBtnText, { color: '#FFF' }]}>Share</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.shareBtn, !!outBlocked && styles.shareBtnDisabled]}
              onPress={handlePreview}
              disabled={!!outBlocked}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!outBlocked }}
              testID="public-profile-preview"
            >
              <Eye size={16} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.shareBtnText}>Preview</Text>
            </TouchableOpacity>
          </View>
          {outBlocked ? (
            <View style={styles.blockedRow}>
              {preparing && !publishBlocked ? <ActivityIndicator size="small" color={themeColors.textMuted} /> : null}
              <Text style={[styles.blockedReason, { flex: 1 }]} testID="public-profile-share-blocked">{outBlocked}</Text>
              {errorNow && !publishBlocked ? (
                <TouchableOpacity onPress={handleRetry} accessibilityRole="button" testID="public-profile-retry">
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : tooLong ? (
            <Text style={styles.blockedReason} testID="public-profile-link-long">
              {`This link is ${Math.round(publicUrl.length / 1000)} KB. Some texts, email apps and website link fields cut long links off, and a cut link opens as "Project not found". Shorten the story or testimonial to make it shorter.`}
            </Text>
          ) : (
            <Text style={styles.shareNote}>
              {"Links you shared before this update keep their old address and photos, and can't be taken down. Send this link instead."}
            </Text>
          )}
        </View>

        {profile.enabled && !publishBlocked && (
          <>

            {/* Headline + body */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Public copy</Text>
              <Text style={styles.label}>Headline</Text>
              <TextInput
                style={styles.input}
                value={profile.publicHeadline ?? ''}
                onChangeText={v => persist({ publicHeadline: v })}
                placeholder="e.g. Brownstone gut renovation, Park Slope"
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={[styles.label, { marginTop: 12 }]}>Story (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={profile.publicBody ?? ''}
                onChangeText={v => persist({ publicBody: v })}
                placeholder="A few sentences about scope, design challenges, or what made this project special."
                placeholderTextColor={themeColors.textMuted}
                multiline
              />
            </View>

            {/* Slug */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>URL slug</Text>
              <Text style={styles.sectionSubtitle}>Lowercase, hyphens only — keeps the link friendly.</Text>
              <TextInput
                style={styles.input}
                value={profile.slug ?? ''}
                onChangeText={v => persist({ slug: slugify(v) })}
                placeholder={slugify(project.name)}
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="none"
              />
            </View>

            {/* Testimonial */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Client testimonial (optional)</Text>
              <Text style={styles.sectionSubtitle}>Shows up as a pull-quote on the public page if you fill both.</Text>
              <View style={styles.quoteRow}>
                <Quote size={14} color={themeColors.accent} strokeWidth={1.75} />
                <TextInput
                  style={[styles.input, styles.inputMulti, { flex: 1 }]}
                  value={profile.testimonialQuote ?? ''}
                  onChangeText={v => persist({ testimonialQuote: v })}
                  placeholder='"They were on time, clean, and called the shots before we even knew to ask."'
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />
              </View>
              <TextInput
                style={[styles.input, { marginTop: 8 }]}
                value={profile.testimonialAuthor ?? ''}
                onChangeText={v => persist({ testimonialAuthor: v })}
                placeholder="— Sarah Patel, Owner"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>

            {/* Location: the client's street address stays off by default (#78) */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Location shown publicly</Text>
              <Text style={[styles.statValue, !where.shown && { color: themeColors.textMuted }]} testID="public-profile-location-preview">
                {where.shown || 'Nothing'}
              </Text>
              <Text style={styles.sectionSubtitle}>
                {(profile.hideStats ?? []).includes('address')
                  ? 'The page shows no location.'
                  : profile.showAddress
                    ? 'The full street address prints on the page, exactly as above.'
                    : where.shown
                      ? "Only the city and state print. Your client's street address stays off the page unless you turn it on below."
                      : "This job has no city and state on file, so the page shows no location. Your client's street address stays off unless you turn it on below."}
              </Text>
              <View style={styles.statRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.statLabel}>Show location</Text>
                </View>
                <Switch
                  value={!(profile.hideStats ?? []).includes('address')}
                  onValueChange={val => {
                    const set = new Set(profile.hideStats ?? []);
                    if (val) set.delete('address'); else set.add('address');
                    persist({ hideStats: Array.from(set) });
                  }}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  thumbColor="#FFF"
                  testID="public-profile-show-location"
                />
              </View>
              {!(profile.hideStats ?? []).includes('address') ? (
                <View style={styles.statRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.statLabel}>Show street address</Text>
                    <Text style={styles.toggleDesc} numberOfLines={2}>{project.location?.trim() ? project.location.trim() : 'No address on this job'}</Text>
                  </View>
                  <Switch
                    value={profile.showAddress === true}
                    onValueChange={val => persist({ showAddress: val })}
                    disabled={!project.location?.trim()}
                    trackColor={{ false: themeColors.line, true: themeColors.accent }}
                    thumbColor="#FFF"
                    testID="public-profile-show-street-address"
                  />
                </View>
              ) : null}
            </View>

            {/* Stats preview */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Stats shown publicly</Text>
              {[
                { key: 'value' as const, label: 'Contract value', value: snapshot?.project.contractValue ? formatMoney(snapshot.project.contractValue) : '—' },
                { key: 'duration' as const, label: 'Duration', value: snapshot?.project.durationDays ? `${snapshot.project.durationDays} days` : '—' },
                { key: 'sqft' as const, label: 'Square footage', value: project.squareFootage ? project.squareFootage.toLocaleString() + ' sf' : '—' },
              ].map(stat => {
                const isHidden = (profile.hideStats ?? []).includes(stat.key);
                return (
                  <View key={stat.key} style={styles.statRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.statLabel}>{stat.label}</Text>
                      <Text style={[styles.statValue, isHidden && { color: themeColors.textMuted, textDecorationLine: 'line-through' }]}>{stat.value}</Text>
                    </View>
                    <Switch
                      value={!isHidden}
                      onValueChange={val => {
                        const set = new Set(profile.hideStats ?? []);
                        if (val) set.delete(stat.key); else set.add(stat.key);
                        persist({ hideStats: Array.from(set) });
                      }}
                      trackColor={{ false: themeColors.line, true: themeColors.accent }}
                      thumbColor="#FFF"
                    />
                  </View>
                );
              })}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.sectionSubtitle}>
                {photos.length > 0
                  ? `Showing the ${chosen.length} most recent photos by default. Publishing copies them to a public page, so they keep loading after today.`
                  : 'Add photos to this project to populate the public page.'}
              </Text>
              {plan.notUploaded.length > 0 ? (
                <Text style={styles.blockedReason} testID="public-profile-photos-not-uploaded">
                  {plan.notUploaded.length === 1
                    ? "1 photo hasn't uploaded yet and is left out of the link until it does."
                    : plan.notUploaded.length + " photos haven't uploaded yet and are left out of the link until they do."}
                </Text>
              ) : null}
              {failedIds.size > 0 ? (
                <Text style={styles.blockedReason} testID="public-profile-photos-failed">
                  {failedIds.size === 1
                    ? "1 photo couldn't be copied to the public page and was left out. Turn Publish off and on with better signal to retry."
                    : failedIds.size + " photos couldn't be copied to the public page and were left out. Turn Publish off and on with better signal to retry."}
                </Text>
              ) : null}
              {ready?.logoFailed ? (
                <Text style={styles.blockedReason}>{"Your logo couldn't be published, so the page shows your company's initial."}</Text>
              ) : null}
              <Text style={styles.muted}>
                Tip: take strong before/after shots — the public page renders them as a gallery.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: t.textMuted, fontSize: Type.footnote.fontSize, lineHeight: 18, fontStyle: 'italic' },

  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroEyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 1.5, color: t.accent, textTransform: 'uppercase', marginBottom: 4 },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  section: { marginHorizontal: 16, marginBottom: 22 },
  sectionTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  sectionSubtitle: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginBottom: 10, lineHeight: 18 },

  togglesCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, overflow: 'hidden',
  },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 13 },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  toggleLabels: { flex: 1 },
  toggleLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600', color: t.text },
  toggleDesc: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },

  label: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  input: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' as const },

  linkBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: t.line, marginBottom: 10,
  },
  linkText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text },
  shareRow: { flexDirection: 'row', gap: 8 },
  shareBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  shareBtnPrimary: { backgroundColor: t.accentFill, borderColor: t.accent },
  shareBtnDisabled: { opacity: 0.45 },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  retryText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent, marginTop: 8 },
  blockedReason: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 8, lineHeight: 17 },
  shareNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 8, lineHeight: 17 },
  shareBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },

  quoteRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },

  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  statLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  statValue: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text },
});

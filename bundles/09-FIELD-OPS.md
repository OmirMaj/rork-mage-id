# Field Operations — Daily Reports, Punch, RFIs, Submittals, Warranties


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Field-operations screens — daily reports, punch lists, RFIs, submittals,
warranties, permits, and time tracking. All persist under the `tertiary_*`
AsyncStorage key family and sync through the offline queue.

- Voice-parsed daily field updates via `utils/voiceDFRParser.ts` and
  `components/QuickFieldUpdate.tsx` / `VoiceFieldButton.tsx`.


## Files in this bundle

- `app/daily-report.tsx`
- `app/punch-list.tsx`
- `app/rfi.tsx`
- `app/submittal.tsx`
- `app/warranties.tsx`
- `app/permits.tsx`
- `app/time-tracking.tsx`
- `components/AIDailyReportGen.tsx`
- `components/QuickFieldUpdate.tsx`
- `components/QuickUpdateClarifier.tsx`
- `components/VoiceFieldButton.tsx`
- `utils/voiceDFRParser.ts`
- `utils/closeoutPacketGenerator.ts`


---

### `app/daily-report.tsx`

```tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, Trash2, X, Send, Cloud, Wind, Thermometer, Camera, Users,
  HardHat, Package, AlertTriangle, Image as ImageIcon, BookUser, User,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ContactPickerModal from '@/components/ContactPickerModal';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { sendEmail, buildDailyReportEmailHtml } from '@/utils/emailService';
import VoiceRecorder from '@/components/VoiceRecorder';
import { parseDFRFromTranscript } from '@/utils/voiceDFRParser';
import AIDailyReportGen from '@/components/AIDailyReportGen';
import type { ManpowerEntry, DFRPhoto, DailyFieldReport, DFRWeather, IncidentReport, IncidentSeverity } from '@/types';
import type { DailyReportGenResult } from '@/utils/aiService';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DailyReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, reportId } = useLocalSearchParams<{ projectId: string; reportId?: string }>();
  const {
    getProject, getDailyReportsForProject, addDailyReport, updateDailyReport, contacts, settings, addProjectPhoto,
  } = useProjects();
  const { isProOrAbove } = useSubscription();
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingReports = useMemo(() => getDailyReportsForProject(projectId ?? ''), [projectId, getDailyReportsForProject]);
  const existingReport = useMemo(() => reportId ? existingReports.find(r => r.id === reportId) : null, [reportId, existingReports]);

  const [weather, setWeather] = useState<DFRWeather>(
    existingReport?.weather ?? { temperature: '', conditions: '', wind: '', isManual: true }
  );
  const [manpower, setManpower] = useState<ManpowerEntry[]>(existingReport?.manpower ?? []);
  const [workPerformed, setWorkPerformed] = useState(existingReport?.workPerformed ?? '');
  const [materialsDelivered, setMaterialsDelivered] = useState<string[]>(
    existingReport?.materialsDelivered ?? []
  );
  const [newMaterial, setNewMaterial] = useState('');
  const [issuesAndDelays, setIssuesAndDelays] = useState(existingReport?.issuesAndDelays ?? '');
  const [photos, setPhotos] = useState<DFRPhoto[]>(existingReport?.photos ?? []);
  const [incident, setIncident] = useState<IncidentReport>(existingReport?.incident ?? {
    hasIncident: false,
    severity: undefined,
    description: '',
    peopleInvolved: '',
    injuriesReported: false,
    medicalTreatment: false,
    oshaRecordable: false,
    correctiveAction: '',
    reportedBy: '',
  });
  const [showManpowerModal, setShowManpowerModal] = useState(false);
  const [mpTrade, setMpTrade] = useState('');
  const [mpCompany, setMpCompany] = useState('');
  const [mpHeadcount, setMpHeadcount] = useState('');
  const [mpHours, setMpHours] = useState('8');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);

  const todayStr = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

  const fetchWeather = useCallback(async () => {
    if (!project?.location) return;
    setWeatherLoading(true);
    try {
      const location = encodeURIComponent(project.location);
      const response = await fetch(
        `https://wttr.in/${location}?format=j1`
      );
      if (response.ok) {
        const data = await response.json();
        const current = data?.current_condition?.[0];
        if (current) {
          setWeather({
            temperature: `${current.temp_F}°F / ${current.temp_C}°C`,
            conditions: current.weatherDesc?.[0]?.value ?? 'Unknown',
            wind: `${current.windspeedMiles} mph ${current.winddir16Point}`,
            isManual: false,
          });
          console.log('[DFR] Weather fetched successfully');
        }
      }
    } catch (err) {
      console.log('[DFR] Weather fetch failed:', err);
      Alert.alert('Weather Unavailable', 'Could not fetch weather data. Please enter manually.');
    } finally {
      setWeatherLoading(false);
    }
  }, [project?.location]);

  useEffect(() => {
    if (!existingReport && project?.location) {
      void fetchWeather();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddManpower = useCallback(() => {
    const trade = mpTrade.trim();
    if (!trade) {
      Alert.alert('Missing Trade', 'Please enter a trade name.');
      return;
    }
    const entry: ManpowerEntry = {
      id: createId('mp'),
      trade,
      company: mpCompany.trim(),
      headcount: parseInt(mpHeadcount) || 1,
      hoursWorked: parseFloat(mpHours) || 8,
    };
    setManpower(prev => [...prev, entry]);
    setMpTrade('');
    setMpCompany('');
    setMpHeadcount('');
    setMpHours('8');
    setShowManpowerModal(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [mpTrade, mpCompany, mpHeadcount, mpHours]);

  const handleRemoveManpower = useCallback((id: string) => {
    setManpower(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleAddMaterial = useCallback(() => {
    const mat = newMaterial.trim();
    if (!mat) return;
    setMaterialsDelivered(prev => [...prev, mat]);
    setNewMaterial('');
  }, [newMaterial]);

  const handleRemoveMaterial = useCallback((idx: number) => {
    setMaterialsDelivered(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePickPhoto = useCallback(async () => {
    if (photos.length >= 10) {
      Alert.alert('Limit Reached', 'Maximum 10 photos per report.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets[0]) {
        const photo: DFRPhoto = {
          id: createId('photo'),
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
        };
        setPhotos(prev => [...prev, photo]);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.log('[DFR] Photo pick error:', err);
    }
  }, [photos.length]);

  const handleTakePhoto = useCallback(async () => {
    if (photos.length >= 10) {
      Alert.alert('Limit Reached', 'Maximum 10 photos per report.');
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        const photo: DFRPhoto = {
          id: createId('photo'),
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
        };
        setPhotos(prev => [...prev, photo]);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.log('[DFR] Camera error:', err);
    }
  }, [photos.length]);

  const handleRemovePhoto = useCallback((id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }, []);

  const totalManpower = useMemo(() => {
    return manpower.reduce((sum, m) => sum + m.headcount, 0);
  }, [manpower]);

  const totalManHours = useMemo(() => {
    return manpower.reduce((sum, m) => sum + (m.headcount * m.hoursWorked), 0);
  }, [manpower]);

  const handleSave = useCallback((status: 'draft' | 'sent', recipientName?: string, recipientEmail?: string) => {
    if (!projectId) return;

    const now = new Date().toISOString();
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    const incidentPayload: IncidentReport | undefined = incident.hasIncident
      ? {
          ...incident,
          description: (incident.description ?? '').trim(),
          peopleInvolved: (incident.peopleInvolved ?? '').trim(),
          correctiveAction: (incident.correctiveAction ?? '').trim(),
          reportedBy: (incident.reportedBy ?? '').trim(),
          reportedAt: incident.reportedAt ?? now,
        }
      : undefined;

    if (existingReport) {
      updateDailyReport(existingReport.id, {
        weather,
        manpower,
        workPerformed: workPerformed.trim(),
        materialsDelivered,
        issuesAndDelays: issuesAndDelays.trim(),
        photos,
        status,
        incident: incidentPayload,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Updated', `Daily report has been ${status === 'sent' ? `sent${recipientInfo}` : 'saved to project'}.`);
    } else {
      const report: DailyFieldReport = {
        id: createId('dfr'),
        projectId,
        date: now,
        weather,
        manpower,
        workPerformed: workPerformed.trim(),
        materialsDelivered,
        issuesAndDelays: issuesAndDelays.trim(),
        photos,
        status,
        incident: incidentPayload,
        createdAt: now,
        updatedAt: now,
      };
      addDailyReport(report);
      // Sync DFR photos into project photo gallery
      for (const p of photos) {
        addProjectPhoto({
          id: p.id,
          projectId,
          uri: p.uri,
          timestamp: p.timestamp,
          tag: 'Daily Report',
          createdAt: p.timestamp,
        });
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        status === 'sent' ? 'Sent' : 'Saved to Project',
        status === 'sent'
          ? `Daily report has been sent${recipientInfo} and saved to the project.`
          : 'Daily report has been saved to the project. You can view it in the project\'s Daily Reports section.',
      );
    }
    router.back();
  }, [projectId, weather, manpower, workPerformed, materialsDelivered, issuesAndDelays, photos, incident, existingReport, addDailyReport, updateDailyReport, addProjectPhoto, router]);

  const handleSendPress = useCallback(() => {
    setShowSendRecipient(true);
  }, []);

  const handleConfirmSend = useCallback(async () => {
    if (!sendRecipientEmail.trim()) {
      Alert.alert('Email Required', 'Please enter a recipient email address.');
      return;
    }
    setShowSendRecipient(false);

    if (sendRecipientEmail.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const weatherForEmail = {
        condition: typeof weather.conditions === 'string' ? weather.conditions : 'N/A',
        tempHigh: parseInt(String(weather.temperature)) || 0,
        tempLow: parseInt(String(weather.temperature)) || 0,
      };
      const html = buildDailyReportEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        date: new Date().toISOString(),
        weather: weatherForEmail,
        totalManpower,
        totalManHours,
        workPerformed: workPerformed.trim(),
        issuesAndDelays: issuesAndDelays.trim(),
        contactName: branding.contactName,
        contactEmail: branding.email,
      });

      const result = await sendEmail({
        to: sendRecipientEmail.trim(),
        subject: `${branding.companyName || 'MAGE ID'} - Daily Report - ${project?.name ?? 'Project'} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        html,
        replyTo: branding.email || undefined,
      });

      if (!result.success) {
        if (result.error === 'cancelled') {
          return;
        }
        console.warn('[DailyReport] Email send failed:', result.error);
        Alert.alert('Email Notice', `Report saved but email could not be sent: ${result.error}`);
        return;
      } else {
        console.log('[DailyReport] Email sent successfully');
      }
    }

    handleSave('sent', sendRecipientName, sendRecipientEmail);
  }, [handleSave, sendRecipientName, sendRecipientEmail, settings, project, weather, totalManpower, totalManHours, workPerformed, issuesAndDelays]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Daily Report' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLocked = existingReport?.status === 'sent';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: existingReport ? 'Edit Report' : 'New Daily Report',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <VoiceRecorder
              onTranscriptReady={async (transcript) => {
                setVoiceLoading(true);
                try {
                  const parsed = await parseDFRFromTranscript(transcript, projectId ?? '');
                  if (parsed.weather && !weather.temperature) setWeather(parsed.weather);
                  if (parsed.manpower && manpower.length === 0) setManpower(parsed.manpower);
                  if (parsed.workPerformed && !workPerformed) setWorkPerformed(parsed.workPerformed);
                  if (parsed.materialsDelivered && materialsDelivered.length === 0) setMaterialsDelivered(parsed.materialsDelivered);
                  if (parsed.issuesAndDelays && !issuesAndDelays) setIssuesAndDelays(parsed.issuesAndDelays);
                  setShowVoiceBanner(true);
                  console.log('[DFR] Voice auto-fill complete');
                } catch (err) {
                  console.log('[DFR] Voice parse error:', err);
                  Alert.alert('Error', 'Could not parse voice input. Please try again.');
                } finally {
                  setVoiceLoading(false);
                }
              }}
              isLoading={voiceLoading}
              isLocked={!isProOrAbove}
              onLockedPress={() => router.push('/paywall' as any)}
            />
          </View>

          {showVoiceBanner && (
            <TouchableOpacity
              style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.infoLight, borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              onPress={() => setShowVoiceBanner(false)}
              activeOpacity={0.7}
            >
              <Text style={{ flex: 1, fontSize: 13, color: Colors.info }}>Report auto-filled from voice. Please review before saving.</Text>
              <X size={14} color={Colors.info} />
            </TouchableOpacity>
          )}

          {!existingReport && project.schedule && project.schedule.tasks.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
              <AIDailyReportGen
                projectName={project.name}
                tasks={project.schedule.tasks}
                weatherStr={weather.conditions || 'Clear'}
                onGenerated={(result: DailyReportGenResult) => {
                  if (result.workCompleted.length > 0 || result.workInProgress.length > 0) {
                    const workText = [
                      ...result.workCompleted.map(w => `[Completed] ${w}`),
                      ...result.workInProgress.map(w => `[In Progress] ${w}`),
                    ].join('\n');
                    setWorkPerformed(workText);
                  }
                  if (result.issuesAndDelays.length > 0) {
                    setIssuesAndDelays(result.issuesAndDelays.join('\n'));
                  }
                  if (result.crewsOnSite.length > 0 && manpower.length === 0) {
                    const entries: ManpowerEntry[] = result.crewsOnSite.map((c, idx) => ({
                      id: createId('mp'),
                      trade: c.trade,
                      company: '',
                      headcount: c.count,
                      hoursWorked: 8,
                    }));
                    setManpower(entries);
                  }
                  setShowVoiceBanner(true);
                }}
              />
            </View>
          )}

          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Daily Field Report</Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            <Text style={styles.heroDate}>{todayStr}</Text>
            {existingReport && (
              <View style={[styles.statusBadge, { backgroundColor: existingReport.status === 'sent' ? Colors.successLight : Colors.fillTertiary }]}>
                <Text style={[styles.statusText, { color: existingReport.status === 'sent' ? Colors.success : Colors.textSecondary }]}>
                  {existingReport.status === 'sent' ? 'Sent' : 'Saved'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Cloud size={18} color={Colors.info} />
              <Text style={styles.sectionTitle}>Weather</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={fetchWeather}
                  activeOpacity={0.7}
                  disabled={weatherLoading}
                >
                  <Text style={styles.refreshBtnText}>
                    {weatherLoading ? 'Loading...' : 'Auto-fetch'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.weatherGrid}>
              <View style={styles.weatherItem}>
                <Thermometer size={14} color={Colors.accent} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.temperature}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, temperature: v, isManual: true }))}
                    placeholder="72°F"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.temperature || 'N/A'}</Text>
                )}
              </View>
              <View style={styles.weatherItem}>
                <Cloud size={14} color={Colors.info} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.conditions}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, conditions: v, isManual: true }))}
                    placeholder="Sunny, Cloudy..."
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.conditions || 'N/A'}</Text>
                )}
              </View>
              <View style={styles.weatherItem}>
                <Wind size={14} color={Colors.textSecondary} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.wind}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, wind: v, isManual: true }))}
                    placeholder="5 mph NW"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.wind || 'N/A'}</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Users size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Manpower ({totalManpower} workers · {totalManHours}h)</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => setShowManpowerModal(true)}
                  activeOpacity={0.7}
                  testID="add-manpower-btn"
                >
                  <Plus size={14} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {manpower.length === 0 && (
              <Text style={styles.emptyText}>No manpower entries yet.</Text>
            )}
            {manpower.map((entry) => (
              <View key={entry.id} style={styles.mpRow}>
                <View style={styles.mpInfo}>
                  <Text style={styles.mpTrade}>{entry.trade}</Text>
                  <Text style={styles.mpMeta}>
                    {entry.company ? `${entry.company} · ` : ''}{entry.headcount} workers · {entry.hoursWorked}h each
                  </Text>
                </View>
                {!isLocked && (
                  <TouchableOpacity onPress={() => handleRemoveManpower(entry.id)} activeOpacity={0.7}>
                    <Trash2 size={14} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={Colors.accent} />
              <Text style={styles.sectionTitle}>Work Performed</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={workPerformed}
                onChangeText={setWorkPerformed}
                placeholder="Describe work completed today..."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
                testID="work-performed-input"
              />
            ) : (
              <Text style={styles.readOnlyText}>{workPerformed || 'No notes.'}</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Package size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Materials Delivered</Text>
            </View>
            {!isLocked && (
              <View style={styles.addMaterialRow}>
                <TextInput
                  style={styles.materialInput}
                  value={newMaterial}
                  onChangeText={setNewMaterial}
                  placeholder="Material received..."
                  placeholderTextColor={Colors.textMuted}
                  onSubmitEditing={handleAddMaterial}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addMaterialBtn} onPress={handleAddMaterial} activeOpacity={0.7}>
                  <Plus size={16} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            )}
            {materialsDelivered.length === 0 && (
              <Text style={styles.emptyText}>No materials delivered today.</Text>
            )}
            {materialsDelivered.map((mat, idx) => (
              <View key={idx} style={styles.materialRow}>
                <View style={styles.materialDot} />
                <Text style={styles.materialText}>{mat}</Text>
                {!isLocked && (
                  <TouchableOpacity onPress={() => handleRemoveMaterial(idx)} activeOpacity={0.7}>
                    <X size={14} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <AlertTriangle size={18} color={Colors.error} />
              <Text style={styles.sectionTitle}>Issues & Delays</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={issuesAndDelays}
                onChangeText={setIssuesAndDelays}
                placeholder="Note any problems or delays..."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.readOnlyText}>{issuesAndDelays || 'No issues reported.'}</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={Colors.error} />
              <Text style={styles.sectionTitle}>Safety & Incident</Text>
            </View>
            {!isLocked ? (
              <>
                <TouchableOpacity
                  style={[styles.incidentToggle, incident.hasIncident && styles.incidentToggleActive]}
                  onPress={() => setIncident(p => ({ ...p, hasIncident: !p.hasIncident }))}
                  activeOpacity={0.85}
                >
                  <View style={[styles.incidentToggleDot, incident.hasIncident && styles.incidentToggleDotActive]} />
                  <Text style={[styles.incidentToggleText, incident.hasIncident && { color: Colors.error }]}>
                    {incident.hasIncident ? 'Incident occurred today' : 'No incidents today'}
                  </Text>
                </TouchableOpacity>

                {incident.hasIncident && (
                  <View style={styles.incidentBlock}>
                    <Text style={styles.incidentLabel}>Severity</Text>
                    <View style={styles.severityRow}>
                      {(['near_miss','minor','moderate','major','critical'] as IncidentSeverity[]).map(sev => {
                        const active = incident.severity === sev;
                        const labels: Record<IncidentSeverity, string> = {
                          near_miss: 'Near Miss', minor: 'Minor', moderate: 'Moderate', major: 'Major', critical: 'Critical',
                        };
                        return (
                          <TouchableOpacity
                            key={sev}
                            style={[styles.severityChip, active && styles.severityChipActive]}
                            onPress={() => setIncident(p => ({ ...p, severity: sev }))}
                          >
                            <Text style={[styles.severityChipText, active && styles.severityChipTextActive]}>{labels[sev]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.incidentLabel}>What happened?</Text>
                    <TextInput
                      style={styles.textArea}
                      value={incident.description ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, description: val }))}
                      placeholder="Describe the incident..."
                      placeholderTextColor={Colors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>People involved</Text>
                    <TextInput
                      style={styles.textInput}
                      value={incident.peopleInvolved ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, peopleInvolved: val }))}
                      placeholder="Names or roles"
                      placeholderTextColor={Colors.textMuted}
                    />

                    <View style={styles.checkboxRow}>
                      <TouchableOpacity style={styles.checkboxItem} onPress={() => setIncident(p => ({ ...p, injuriesReported: !p.injuriesReported }))}>
                        <View style={[styles.checkbox, incident.injuriesReported && styles.checkboxActive]} />
                        <Text style={styles.checkboxLabel}>Injuries</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.checkboxItem} onPress={() => setIncident(p => ({ ...p, medicalTreatment: !p.medicalTreatment }))}>
                        <View style={[styles.checkbox, incident.medicalTreatment && styles.checkboxActive]} />
                        <Text style={styles.checkboxLabel}>Medical treatment</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.checkboxItem} onPress={() => setIncident(p => ({ ...p, oshaRecordable: !p.oshaRecordable }))}>
                        <View style={[styles.checkbox, incident.oshaRecordable && styles.checkboxActive]} />
                        <Text style={styles.checkboxLabel}>OSHA recordable</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.incidentLabel}>Corrective action</Text>
                    <TextInput
                      style={styles.textArea}
                      value={incident.correctiveAction ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, correctiveAction: val }))}
                      placeholder="Immediate fixes, training, policy changes..."
                      placeholderTextColor={Colors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>Reported by</Text>
                    <TextInput
                      style={styles.textInput}
                      value={incident.reportedBy ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, reportedBy: val }))}
                      placeholder="Your name / role"
                      placeholderTextColor={Colors.textMuted}
                    />
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.readOnlyText}>
                {incident.hasIncident
                  ? `${incident.severity?.replace('_', ' ').toUpperCase()} — ${incident.description || 'No description.'}`
                  : 'No incidents reported.'}
              </Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ImageIcon size={18} color={Colors.accent} />
              <Text style={styles.sectionTitle}>Photos ({photos.length}/10)</Text>
            </View>
            {!isLocked && (
              <View style={styles.photoActions}>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.7}>
                    <Camera size={16} color={Colors.primary} />
                    <Text style={styles.photoBtnText}>Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto} activeOpacity={0.7}>
                  <ImageIcon size={16} color={Colors.primary} />
                  <Text style={styles.photoBtnText}>From Library</Text>
                </TouchableOpacity>
              </View>
            )}
            {photos.length === 0 && (
              <Text style={styles.emptyText}>No photos attached.</Text>
            )}
            {photos.length > 0 && (
              <View style={styles.photoGrid}>
                {photos.map((photo) => (
                  <View key={photo.id} style={styles.photoCard}>
                    <View style={styles.photoPlaceholder}>
                      <Camera size={20} color={Colors.textMuted} />
                      <Text style={styles.photoTimestamp}>
                        {new Date(photo.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                    {!isLocked && (
                      <TouchableOpacity
                        style={styles.photoRemoveBtn}
                        onPress={() => handleRemovePhoto(photo.id)}
                        activeOpacity={0.7}
                      >
                        <X size={12} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        {!isLocked && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={styles.saveProjectBtn}
              onPress={() => handleSave('draft')}
              activeOpacity={0.7}
              testID="save-to-project-btn"
            >
              <Text style={styles.saveProjectBtnText}>Save to Project</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={handleSendPress}
              activeOpacity={0.7}
              testID="send-report-btn"
            >
              <Send size={16} color={Colors.textOnPrimary} />
              <Text style={styles.sendBtnText}>Send & Save</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={showSendRecipient} transparent animationType="slide" onRequestClose={() => setShowSendRecipient(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Send Report To</Text>
                <TouchableOpacity onPress={() => setShowSendRecipient(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn}>
                    <X size={12} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Recipient Name</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientName}
                    onChangeText={setSendRecipientName}
                    placeholder="Enter name or pick from contacts"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {contacts.length > 0 && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={Colors.primary} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sendBtn} onPress={handleConfirmSend} activeOpacity={0.7}>
                  <Send size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.sendBtnText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => { setShowContactPicker(false); setTimeout(() => setShowSendRecipient(true), 350); }}
        contacts={contacts}
        title="Select Recipient"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      <Modal visible={showManpowerModal} transparent animationType="slide" onRequestClose={() => setShowManpowerModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Manpower</Text>
                <TouchableOpacity onPress={() => setShowManpowerModal(false)}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Trade</Text>
              <TextInput
                style={styles.modalInput}
                value={mpTrade}
                onChangeText={setMpTrade}
                placeholder="e.g. Electrician, Plumber..."
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.modalFieldLabel}>Company / Sub</Text>
              <TextInput
                style={styles.modalInput}
                value={mpCompany}
                onChangeText={setMpCompany}
                placeholder="Company name (optional)"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Headcount</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHeadcount}
                    onChangeText={setMpHeadcount}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Hours Worked</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHours}
                    onChangeText={setMpHours}
                    placeholder="8"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddManpower} activeOpacity={0.85}>
                <Text style={styles.modalAddBtnText}>Add Entry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '600' as const },
  heroCard: { backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 16, borderRadius: 16, padding: 20, gap: 4 },
  heroLabel: { fontSize: 13, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: 20, fontWeight: '700' as const, color: Colors.textOnPrimary },
  heroDate: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700' as const },
  sectionCard: { marginHorizontal: 20, marginTop: 14, backgroundColor: Colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  refreshBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: Colors.infoLight },
  refreshBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  weatherGrid: { gap: 10 },
  weatherItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weatherInput: { flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 14, color: Colors.text },
  weatherValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  addSmallBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' as const },
  mpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight, gap: 10 },
  mpInfo: { flex: 1, gap: 2 },
  mpTrade: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  mpMeta: { fontSize: 12, color: Colors.textSecondary },
  textArea: { minHeight: 80, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, paddingTop: 12, fontSize: 14, color: Colors.text },
  textInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 14, color: Colors.text },
  readOnlyText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  incidentToggle: { flexDirection: 'row', alignItems: 'center' as const, gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder },
  incidentToggleActive: { backgroundColor: Colors.errorLight, borderColor: Colors.error + '40' },
  incidentToggleDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: Colors.border },
  incidentToggleDotActive: { backgroundColor: Colors.error, borderColor: Colors.error },
  incidentToggleText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  incidentBlock: { marginTop: 10, gap: 6 },
  incidentLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 8 },
  severityRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  severityChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  severityChipActive: { backgroundColor: Colors.error },
  severityChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  severityChipTextActive: { color: '#FFF' },
  checkboxRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 8 },
  checkboxItem: { flexDirection: 'row', alignItems: 'center' as const, gap: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: Colors.border },
  checkboxActive: { backgroundColor: Colors.error, borderColor: Colors.error },
  checkboxLabel: { fontSize: 13, color: Colors.text, fontWeight: '500' as const },
  addMaterialRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  materialInput: { flex: 1, minHeight: 40, borderRadius: 10, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 14, color: Colors.text },
  addMaterialBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  materialDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  materialText: { flex: 1, fontSize: 14, color: Colors.text },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '20' },
  photoBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  photoCard: { width: 80, height: 80, borderRadius: 10, backgroundColor: Colors.surfaceAlt, overflow: 'hidden' as const, position: 'relative' as const },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoTimestamp: { fontSize: 9, color: Colors.textMuted },
  photoRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary + '15', borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: 14, fontWeight: '700' as const, color: Colors.textOnPrimary },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary + '10', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: Colors.primary + '25' },
  selectedRecipientName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  selectedRecipientEmail: { fontSize: 12, color: Colors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.primary + '10' },
  pickContactText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  modalFieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 15, color: Colors.text },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalAddBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalAddBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

```


---

### `app/punch-list.tsx`

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, X, CheckCircle, Clock, Eye, MessageSquare,
  Trash2, Link2, ChevronDown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { PunchItem, PunchItemStatus, PunchItemPriority } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STATUS_CONFIG: Record<PunchItemStatus, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: Colors.error, bg: Colors.errorLight },
  in_progress: { label: 'In Progress', color: Colors.info, bg: Colors.infoLight },
  ready_for_review: { label: 'Review', color: Colors.warning, bg: Colors.warningLight },
  closed: { label: 'Closed', color: Colors.success, bg: Colors.successLight },
};

const PRIORITY_CONFIG: Record<PunchItemPriority, { label: string; color: string }> = {
  low: { label: 'Low', color: Colors.textMuted },
  medium: { label: 'Medium', color: Colors.warning },
  high: { label: 'High', color: Colors.error },
};

export default function PunchListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, getPunchItemsForProject, addPunchItem, updatePunchItem, deletePunchItem, updateProject, subcontractors } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const items = useMemo(() => getPunchItemsForProject(projectId ?? ''), [projectId, getPunchItemsForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PunchItem | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [assignedSub, setAssignedSub] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<PunchItemPriority>('medium');
  const [linkedTaskId, setLinkedTaskId] = useState<string>('');
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PunchItemStatus | 'all'>('all');

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const resetForm = useCallback(() => {
    setDescription(''); setLocation(''); setAssignedSub('');
    setDueDate(''); setPriority('medium'); setEditingItem(null);
    setLinkedTaskId('');
  }, []);

  const closedCount = items.filter(i => i.status === 'closed').length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0;
  const allClosed = totalCount > 0 && closedCount === totalCount;

  const filteredItems = useMemo(() => {
    if (filterStatus === 'all') return items;
    return items.filter(i => i.status === filterStatus);
  }, [items, filterStatus]);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) {
      Alert.alert('Missing Description', 'Please describe the punch item.');
      return;
    }
    const linkedTaskName = linkedTask?.title;
    if (editingItem) {
      updatePunchItem(editingItem.id, {
        description: desc, location: location.trim(), assignedSub: assignedSub.trim(),
        dueDate, priority,
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskName: linkedTaskName || undefined,
      });
    } else {
      const item: PunchItem = {
        id: createId('punch'), projectId: projectId ?? '', description: desc,
        location: location.trim(), assignedSub: assignedSub.trim(), dueDate,
        priority, status: 'open',
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskName: linkedTaskName || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addPunchItem(item);
    }
    setShowForm(false);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [description, location, assignedSub, dueDate, priority, linkedTaskId, linkedTask, editingItem, projectId, addPunchItem, updatePunchItem, resetForm]);

  const handleStatusChange = useCallback((item: PunchItem, newStatus: PunchItemStatus) => {
    const updates: Partial<PunchItem> = { status: newStatus };
    if (newStatus === 'closed') updates.closedAt = new Date().toISOString();
    updatePunchItem(item.id, updates);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [updatePunchItem]);

  const handleReject = useCallback((itemId: string) => {
    const note = rejectionNote.trim();
    updatePunchItem(itemId, { status: 'open', rejectionNote: note || 'Rejected — needs rework' });
    setShowRejectModal(null);
    setRejectionNote('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rejectionNote, updatePunchItem]);

  const handleCloseProject = useCallback(() => {
    if (!allClosed) {
      Alert.alert('Cannot Close', 'All punch items must be resolved before closing the project.');
      return;
    }
    Alert.alert('Close Project', 'Mark this project as closed? This will archive it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close Project',
        onPress: () => {
          updateProject(projectId ?? '', { status: 'closed', closedAt: new Date().toISOString() });
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Project Closed', 'This project has been archived.');
          router.back();
        },
      },
    ]);
  }, [allClosed, projectId, updateProject, router]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Punch List' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Punch List — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Completion</Text>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressSub}>{closedCount} of {totalCount} items closed</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(['all', 'open', 'in_progress', 'ready_for_review', 'closed'] as const).map(s => {
            const count = s === 'all' ? items.length : items.filter(i => i.status === s).length;
            const config = s === 'all' ? { label: 'All', color: Colors.text, bg: Colors.fillTertiary } : STATUS_CONFIG[s];
            return (
              <TouchableOpacity
                key={s}
                style={[styles.filterChip, filterStatus === s && { backgroundColor: config.color }]}
                onPress={() => setFilterStatus(s)}
              >
                <Text style={[styles.filterChipText, filterStatus === s && { color: '#fff' }]}>
                  {s === 'all' ? 'All' : config.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {filteredItems.map(item => {
          const sc = STATUS_CONFIG[item.status];
          const pc = PRIORITY_CONFIG[item.priority];
          return (
            <View key={item.id} style={styles.punchCard}>
              <View style={styles.punchCardTop}>
                <View style={[styles.priorityDot, { backgroundColor: pc.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.punchDesc}>{item.description}</Text>
                  {item.location ? <Text style={styles.punchLocation}>{item.location}</Text> : null}
                </View>
                <View style={[styles.punchBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.punchBadgeText, { color: sc.color }]}>{sc.label}</Text>
                </View>
              </View>

              <View style={styles.punchMeta}>
                {item.assignedSub ? <Text style={styles.punchMetaText}>Sub: {item.assignedSub}</Text> : null}
                {item.dueDate ? <Text style={styles.punchMetaText}>Due: {item.dueDate}</Text> : null}
                <Text style={[styles.punchMetaText, { color: pc.color }]}>{pc.label} Priority</Text>
              </View>

              {item.linkedTaskName ? (
                <View style={styles.linkedTaskBadge}>
                  <Link2 size={11} color={Colors.primary} />
                  <Text style={styles.linkedTaskBadgeText} numberOfLines={1}>Task: {item.linkedTaskName}</Text>
                </View>
              ) : null}

              {item.rejectionNote ? (
                <View style={styles.rejectionBox}>
                  <MessageSquare size={12} color={Colors.error} />
                  <Text style={styles.rejectionText}>{item.rejectionNote}</Text>
                </View>
              ) : null}

              <View style={styles.punchActions}>
                {item.status === 'open' && (
                  <TouchableOpacity style={styles.punchActionBtn} onPress={() => handleStatusChange(item, 'in_progress')}>
                    <Clock size={14} color={Colors.info} />
                    <Text style={[styles.punchActionText, { color: Colors.info }]}>Start</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'in_progress' && (
                  <TouchableOpacity style={styles.punchActionBtn} onPress={() => handleStatusChange(item, 'ready_for_review')}>
                    <Eye size={14} color={Colors.warning} />
                    <Text style={[styles.punchActionText, { color: Colors.warning }]}>Submit for Review</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'ready_for_review' && (
                  <>
                    <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: Colors.successLight }]} onPress={() => handleStatusChange(item, 'closed')}>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={[styles.punchActionText, { color: Colors.success }]}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: Colors.errorLight }]} onPress={() => { setShowRejectModal(item.id); setRejectionNote(''); }}>
                      <X size={14} color={Colors.error} />
                      <Text style={[styles.punchActionText, { color: Colors.error }]}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.punchDeleteBtn} onPress={() => {
                  Alert.alert('Delete', 'Delete this punch item?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deletePunchItem(item.id) },
                  ]);
                }}>
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {filteredItems.length === 0 && (
          <View style={styles.emptyState}>
            <CheckCircle size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>{filterStatus !== 'all' ? 'No items with this status' : 'No Punch Items'}</Text>
            <Text style={styles.emptyDesc}>Tap + to add items that need to be resolved.</Text>
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-punch-item">
          <Plus size={16} color={Colors.primary} />
          <Text style={styles.addItemBtnText}>Add Punch Item</Text>
        </TouchableOpacity>

        {allClosed && totalCount > 0 && (
          <TouchableOpacity style={styles.closeProjectBtn} onPress={handleCloseProject} activeOpacity={0.85}>
            <CheckCircle size={18} color="#fff" />
            <Text style={styles.closeProjectBtnText}>Close Project</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editingItem ? 'Edit Item' : 'New Punch Item'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Description *</Text>
                <TextInput style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]} value={description} onChangeText={setDescription} placeholder="What needs to be done..." placeholderTextColor={Colors.textMuted} multiline testID="punch-desc-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Location/Area</Text>
                    <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. Kitchen, Room 3B" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Due Date</Text>
                    <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Assigned Sub</Text>
                {subcontractors.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {subcontractors.map(s => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.subChip, assignedSub === s.companyName && styles.subChipActive]}
                        onPress={() => setAssignedSub(s.companyName)}
                      >
                        <Text style={[styles.subChipText, assignedSub === s.companyName && styles.subChipTextActive]}>{s.companyName}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <TextInput style={styles.input} value={assignedSub} onChangeText={setAssignedSub} placeholder="Sub name" placeholderTextColor={Colors.textMuted} />
                )}

                <Text style={styles.fieldLabel}>Priority</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['low', 'medium', 'high'] as PunchItemPriority[]).map(p => {
                    const pc = PRIORITY_CONFIG[p];
                    return (
                      <TouchableOpacity
                        key={p}
                        style={[styles.priorityBtn, priority === p && { backgroundColor: pc.color }]}
                        onPress={() => setPriority(p)}
                      >
                        <Text style={[styles.priorityBtnText, priority === p && { color: '#fff' }]}>{pc.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {scheduleTasks.length > 0 ? (
                  <>
                    <Text style={styles.fieldLabel}>Link to Schedule Task (optional)</Text>
                    <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
                      <Link2 size={14} color={Colors.primary} />
                      <Text style={[styles.pickerBtnText, !linkedTask && { color: Colors.textMuted }]} numberOfLines={1}>
                        {linkedTask ? linkedTask.title : 'No task linked'}
                      </Text>
                      {linkedTask ? (
                        <TouchableOpacity onPress={() => setLinkedTaskId('')} hitSlop={8}>
                          <X size={14} color={Colors.textMuted} />
                        </TouchableOpacity>
                      ) : (
                        <ChevronDown size={14} color={Colors.textMuted} />
                      )}
                    </TouchableOpacity>
                  </>
                ) : null}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-punch-item">
                    <Text style={styles.saveBtnText}>{editingItem ? 'Update' : 'Add Item'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <View style={styles.rejectOverlay}>
          <View style={[styles.rejectCard, { maxHeight: '70%' as const }]}>
            <View style={styles.formHeader}>
              <Text style={styles.rejectTitle}>Link to Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {scheduleTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.subChip, { marginVertical: 4, alignSelf: 'stretch' as const }, linkedTaskId === t.id && styles.subChipActive]}
                  onPress={() => { setLinkedTaskId(t.id); setShowTaskPicker(false); }}
                >
                  <Text style={[styles.subChipText, linkedTaskId === t.id && styles.subChipTextActive]} numberOfLines={1}>
                    {t.title} {t.phase ? `— ${t.phase}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              {scheduleTasks.length === 0 ? (
                <Text style={[styles.rejectDesc, { textAlign: 'center' as const, padding: 20 }]}>No tasks in the schedule yet.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showRejectModal !== null} transparent animationType="fade" onRequestClose={() => setShowRejectModal(null)}>
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject Item</Text>
            <Text style={styles.rejectDesc}>Provide a reason for rejection:</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
              value={rejectionNote}
              onChangeText={setRejectionNote}
              placeholder="Reason for rejection..."
              placeholderTextColor={Colors.textMuted}
              multiline
            />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowRejectModal(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: Colors.error }]} onPress={() => showRejectModal && handleReject(showRejectModal)} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, textAlign: 'center' as const, marginTop: 60 },
  progressSection: { marginHorizontal: 20, marginTop: 16, marginBottom: 16 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  progressPercent: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  progressTrack: { height: 8, backgroundColor: Colors.fillTertiary, borderRadius: 4, overflow: 'hidden' as const },
  progressFill: { height: 8, backgroundColor: Colors.primary, borderRadius: 4 },
  progressSub: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  filterRow: { paddingHorizontal: 20, gap: 6, marginBottom: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  filterChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  punchCard: { marginHorizontal: 20, marginBottom: 10, backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder, gap: 10 },
  punchCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  punchDesc: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, lineHeight: 21 },
  punchLocation: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  punchBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  punchBadgeText: { fontSize: 11, fontWeight: '700' as const },
  punchMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingLeft: 18 },
  punchMetaText: { fontSize: 12, color: Colors.textMuted },
  rejectionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: Colors.errorLight, borderRadius: 8, padding: 10, marginLeft: 18 },
  rejectionText: { flex: 1, fontSize: 12, color: Colors.error, lineHeight: 17 },
  punchActions: { flexDirection: 'row', gap: 8, paddingLeft: 18, flexWrap: 'wrap' },
  punchActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  punchActionText: { fontSize: 12, fontWeight: '600' as const },
  punchDeleteBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '20' },
  addItemBtnText: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary },
  closeProjectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 16, borderRadius: 14, backgroundColor: Colors.success },
  closeProjectBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  formCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  subChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  subChipActive: { backgroundColor: Colors.primary },
  subChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  subChipTextActive: { color: '#fff' },
  priorityBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' },
  priorityBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#fff' },
  rejectOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  rejectCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 22, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  rejectTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.error },
  rejectDesc: { fontSize: 14, color: Colors.textSecondary },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt },
  pickerBtnText: { flex: 1, fontSize: 14, color: Colors.text },
  linkedTaskBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: Colors.primary + '12', alignSelf: 'flex-start', marginLeft: 18 },
  linkedTaskBadgeText: { fontSize: 11, fontWeight: '600' as const, color: Colors.primary, flex: 1 },
  pickerOption: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, backgroundColor: Colors.surfaceAlt, marginBottom: 8 },
  pickerOptionActive: { backgroundColor: Colors.primary + '15', borderWidth: 1, borderColor: Colors.primary },
  pickerOptionText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  pickerOptionMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});

```


---

### `app/rfi.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, ChevronDown, Link2, X, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { RFIStatus, RFIPriority } from '@/types';

const PRIORITY_OPTIONS: RFIPriority[] = ['low', 'normal', 'urgent'];
const STATUS_OPTIONS: RFIStatus[] = ['open', 'answered', 'closed', 'void'];

export default function RFIScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, rfiId } = useLocalSearchParams<{ projectId: string; rfiId?: string }>();
  const { getProject, getRFIsForProject, addRFI, updateRFI } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingRFIs = useMemo(() => getRFIsForProject(projectId ?? ''), [projectId, getRFIsForProject]);
  const existingRFI = useMemo(() => rfiId ? existingRFIs.find(r => r.id === rfiId) : null, [rfiId, existingRFIs]);

  const [subject, setSubject] = useState(existingRFI?.subject ?? '');
  const [question, setQuestion] = useState(existingRFI?.question ?? '');
  const [assignedTo, setAssignedTo] = useState(existingRFI?.assignedTo ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingRFI?.submittedBy ?? '');
  const [dateRequired, setDateRequired] = useState(existingRFI?.dateRequired ?? '');
  const [priority, setPriority] = useState<RFIPriority>(existingRFI?.priority ?? 'normal');
  const [status, setStatus] = useState<RFIStatus>(existingRFI?.status ?? 'open');
  const [linkedDrawing, setLinkedDrawing] = useState(existingRFI?.linkedDrawing ?? '');
  const [response, setResponse] = useState(existingRFI?.response ?? '');
  const [linkedTaskId, setLinkedTaskId] = useState(existingRFI?.linkedTaskId ?? '');
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const handleSave = useCallback(() => {
    if (!subject.trim()) {
      Alert.alert('Missing Subject', 'Please enter a subject for this RFI.');
      return;
    }
    if (!question.trim()) {
      Alert.alert('Missing Question', 'Please enter the RFI question.');
      return;
    }

    const now = new Date().toISOString();

    if (existingRFI) {
      updateRFI(existingRFI.id, {
        subject: subject.trim(),
        question: question.trim(),
        assignedTo: assignedTo.trim(),
        submittedBy: submittedBy.trim(),
        dateRequired,
        priority,
        status,
        linkedDrawing: linkedDrawing.trim(),
        linkedTaskId: linkedTaskId || undefined,
        response: response.trim() || undefined,
        dateResponded: response.trim() && !existingRFI.dateResponded ? now : existingRFI.dateResponded,
      });
    } else {
      addRFI({
        projectId: projectId ?? '',
        subject: subject.trim(),
        question: question.trim(),
        submittedBy: submittedBy.trim(),
        assignedTo: assignedTo.trim(),
        dateSubmitted: now,
        dateRequired: dateRequired || new Date(Date.now() + 14 * 86400000).toISOString(),
        status: 'open',
        priority,
        linkedDrawing: linkedDrawing.trim() || undefined,
        linkedTaskId: linkedTaskId || undefined,
        attachments: [],
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [subject, question, assignedTo, submittedBy, dateRequired, priority, status, linkedDrawing, response, existingRFI, projectId, addRFI, updateRFI, router]);

  const priorityColor = priority === 'urgent' ? Colors.error : priority === 'normal' ? Colors.primary : Colors.textSecondary;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: existingRFI ? `RFI #${existingRFI.number}` : 'New RFI' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {project && (
          <Text style={styles.projectLabel}>{project.name}</Text>
        )}

        <Text style={styles.fieldLabel}>Subject *</Text>
        <TextInput
          style={styles.input}
          value={subject}
          onChangeText={setSubject}
          placeholder="Brief description of the question"
          placeholderTextColor={Colors.textMuted}
          testID="rfi-subject"
        />

        <Text style={styles.fieldLabel}>Question *</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={question}
          onChangeText={setQuestion}
          placeholder="Full RFI question body..."
          placeholderTextColor={Colors.textMuted}
          multiline
          textAlignVertical="top"
          testID="rfi-question"
        />

        <View style={styles.row}>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>Submitted By</Text>
            <TextInput
              style={styles.input}
              value={submittedBy}
              onChangeText={setSubmittedBy}
              placeholder="Name or company"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
          <View style={styles.halfField}>
            <Text style={styles.fieldLabel}>Assigned To</Text>
            <TextInput
              style={styles.input}
              value={assignedTo}
              onChangeText={setAssignedTo}
              placeholder="Architect, engineer..."
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Response Required By</Text>
        <TextInput
          style={styles.input}
          value={dateRequired}
          onChangeText={setDateRequired}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Priority</Text>
        <TouchableOpacity
          style={styles.pickerBtn}
          onPress={() => setShowPriorityPicker(!showPriorityPicker)}
          activeOpacity={0.7}
        >
          <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
          <Text style={styles.pickerBtnText}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {showPriorityPicker && (
          <View style={styles.pickerOptions}>
            {PRIORITY_OPTIONS.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.pickerOption, priority === p && styles.pickerOptionActive]}
                onPress={() => { setPriority(p); setShowPriorityPicker(false); }}
              >
                <Text style={[styles.pickerOptionText, priority === p && styles.pickerOptionTextActive]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {existingRFI && (
          <>
            <Text style={styles.fieldLabel}>Status</Text>
            <TouchableOpacity
              style={styles.pickerBtn}
              onPress={() => setShowStatusPicker(!showStatusPicker)}
              activeOpacity={0.7}
            >
              <Text style={styles.pickerBtnText}>{status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}</Text>
              <ChevronDown size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            {showStatusPicker && (
              <View style={styles.pickerOptions}>
                {STATUS_OPTIONS.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.pickerOption, status === s && styles.pickerOptionActive]}
                    onPress={() => { setStatus(s); setShowStatusPicker(false); }}
                  >
                    <Text style={[styles.pickerOptionText, status === s && styles.pickerOptionTextActive]}>
                      {s.charAt(0).toUpperCase() + s.replace('_', ' ').slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <Text style={styles.fieldLabel}>Linked Drawing</Text>
        <TextInput
          style={styles.input}
          value={linkedDrawing}
          onChangeText={setLinkedDrawing}
          placeholder="e.g. A-101"
          placeholderTextColor={Colors.textMuted}
        />

        {(existingRFI && (status === 'answered' || status === 'closed')) && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Response</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={response}
              onChangeText={setResponse}
              placeholder="Official response..."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
          </>
        )}

        {scheduleTasks.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Linked Schedule Task</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
              <Link2 size={15} color={Colors.info} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')} style={styles.unlinkBtn}>
                  <X size={14} color={Colors.error} />
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="rfi-save">
          <Save size={18} color="#fff" />
          <Text style={styles.saveBtnText}>{existingRFI ? 'Update RFI' : 'Create RFI'}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Task Picker Modal */}
      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTaskPicker(false)}>
          <Pressable style={styles.taskPickerCard} onPress={() => undefined}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>Link Schedule Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity
                style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]}
                onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}
              >
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity
                  key={task.id}
                  style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]}
                  onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}
                >
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={Colors.primary} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskOptionText, linkedTaskId === task.id && styles.taskOptionTextActive]} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.taskOptionMeta}>{task.phase} · {task.durationDays}d · {task.progress}% done</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 16,
  },
  projectLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  multilineInput: {
    minHeight: 100,
    paddingTop: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  pickerBtnText: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  priorityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pickerOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  pickerOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  pickerOptionActive: {
    backgroundColor: Colors.primary,
  },
  pickerOptionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  pickerOptionTextActive: {
    color: '#fff',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  linkedTaskBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: Colors.primary + '10', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, marginTop: 6,
  },
  linkedTaskPhase: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  linkedTaskName: { flex: 1, fontSize: 13, color: Colors.text },
  unlinkBtn: { padding: 2 },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center', alignItems: 'center', padding: 24 },
  taskPickerCard: { backgroundColor: Colors.card ?? Colors.surface, borderRadius: 16, width: '100%', overflow: 'hidden' },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  taskPickerTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder + '80' },
  taskOptionActive: { backgroundColor: Colors.primary + '10' },
  taskOptionText: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: Colors.primary },
  taskOptionMeta: { fontSize: 11, color: Colors.textSecondary ?? Colors.textMuted, marginTop: 1 },
});

```


---

### `app/submittal.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Save, Plus, Link2, X, CheckCircle2, ChevronDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { SubmittalStatus } from '@/types';

const STATUS_COLORS: Record<SubmittalStatus, string> = {
  pending: Colors.warning,
  in_review: Colors.info,
  approved: Colors.success,
  approved_as_noted: Colors.primaryLight,
  revise_resubmit: Colors.error,
  rejected: Colors.error,
};

const STATUS_LABELS: Record<SubmittalStatus, string> = {
  pending: 'Pending',
  in_review: 'In Review',
  approved: 'Approved',
  approved_as_noted: 'Approved as Noted',
  revise_resubmit: 'Revise & Resubmit',
  rejected: 'Rejected',
};

export default function SubmittalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, submittalId } = useLocalSearchParams<{ projectId: string; submittalId?: string }>();
  const { getProject, getSubmittalsForProject, addSubmittal, updateSubmittal, addReviewCycle } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingSubmittals = useMemo(() => getSubmittalsForProject(projectId ?? ''), [projectId, getSubmittalsForProject]);
  const existingSubmittal = useMemo(() => submittalId ? existingSubmittals.find(s => s.id === submittalId) : null, [submittalId, existingSubmittals]);

  const [title, setTitle] = useState(existingSubmittal?.title ?? '');
  const [specSection, setSpecSection] = useState(existingSubmittal?.specSection ?? '');
  const [submittedBy, setSubmittedBy] = useState(existingSubmittal?.submittedBy ?? '');
  const [requiredDate, setRequiredDate] = useState(existingSubmittal?.requiredDate ?? '');

  const [linkedTaskId, setLinkedTaskId] = useState('');
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [newReviewer, setNewReviewer] = useState('');
  const [newCycleStatus, setNewCycleStatus] = useState<SubmittalStatus>('pending');
  const [newCycleComments, setNewCycleComments] = useState('');
  const [showAddCycle, setShowAddCycle] = useState(false);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Missing Title', 'Please enter a title.');
      return;
    }

    if (existingSubmittal) {
      updateSubmittal(existingSubmittal.id, {
        title: title.trim(),
        specSection: specSection.trim(),
        submittedBy: submittedBy.trim(),
        requiredDate,
      });
    } else {
      addSubmittal({
        projectId: projectId ?? '',
        title: title.trim(),
        specSection: specSection.trim(),
        submittedBy: submittedBy.trim(),
        submittedDate: new Date().toISOString(),
        requiredDate: requiredDate || new Date(Date.now() + 21 * 86400000).toISOString(),
        reviewCycles: [],
        currentStatus: 'pending',
        attachments: [],
      });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }, [title, specSection, submittedBy, requiredDate, existingSubmittal, projectId, addSubmittal, updateSubmittal, router]);

  const handleAddCycle = useCallback(() => {
    if (!existingSubmittal) return;
    if (!newReviewer.trim()) {
      Alert.alert('Missing Reviewer', 'Please enter a reviewer name.');
      return;
    }

    addReviewCycle(existingSubmittal.id, {
      sentDate: new Date().toISOString(),
      reviewer: newReviewer.trim(),
      status: newCycleStatus,
      comments: newCycleComments.trim() || undefined,
    });

    setNewReviewer('');
    setNewCycleComments('');
    setShowAddCycle(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [existingSubmittal, newReviewer, newCycleStatus, newCycleComments, addReviewCycle]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Stack.Screen options={{ title: existingSubmittal ? `Submittal #${existingSubmittal.number}` : 'New Submittal' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {project && <Text style={styles.projectLabel}>{project.name}</Text>}

        <Text style={styles.fieldLabel}>Title *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Submittal title"
          placeholderTextColor={Colors.textMuted}
          testID="submittal-title"
        />

        <Text style={styles.fieldLabel}>Spec Section</Text>
        <TextInput
          style={styles.input}
          value={specSection}
          onChangeText={setSpecSection}
          placeholder="e.g. 03300 - Cast-in-Place Concrete"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Submitted By</Text>
        <TextInput
          style={styles.input}
          value={submittedBy}
          onChangeText={setSubmittedBy}
          placeholder="Subcontractor name"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.fieldLabel}>Required Date</Text>
        <TextInput
          style={styles.input}
          value={requiredDate}
          onChangeText={setRequiredDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={Colors.textMuted}
        />

        {existingSubmittal && existingSubmittal.reviewCycles.length > 0 && (
          <View style={styles.timelineSection}>
            <Text style={styles.sectionTitle}>Review Cycles</Text>
            {existingSubmittal.reviewCycles.map((cycle, idx) => (
              <View key={idx} style={styles.timelineItem}>
                <View style={styles.timelineLine}>
                  <View style={[styles.timelineDot, { backgroundColor: STATUS_COLORS[cycle.status] }]} />
                  {idx < existingSubmittal.reviewCycles.length - 1 && <View style={styles.timelineConnector} />}
                </View>
                <View style={styles.timelineContent}>
                  <View style={styles.timelineHeader}>
                    <Text style={styles.cycleNumber}>Cycle {cycle.cycleNumber}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[cycle.status] + '20' }]}>
                      <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[cycle.status] }]}>
                        {STATUS_LABELS[cycle.status]}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cycleDetail}>Reviewer: {cycle.reviewer}</Text>
                  <Text style={styles.cycleDetail}>Sent: {new Date(cycle.sentDate).toLocaleDateString()}</Text>
                  {cycle.returnDate && <Text style={styles.cycleDetail}>Returned: {new Date(cycle.returnDate).toLocaleDateString()}</Text>}
                  {cycle.comments && <Text style={styles.cycleComments}>{cycle.comments}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {existingSubmittal && (
          <>
            {!showAddCycle ? (
              <TouchableOpacity style={styles.addCycleBtn} onPress={() => setShowAddCycle(true)} activeOpacity={0.7}>
                <Plus size={16} color={Colors.primary} />
                <Text style={styles.addCycleBtnText}>Add Review Cycle</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.addCycleForm}>
                <Text style={styles.sectionTitle}>New Review Cycle</Text>
                <TextInput
                  style={styles.input}
                  value={newReviewer}
                  onChangeText={setNewReviewer}
                  placeholder="Reviewer name"
                  placeholderTextColor={Colors.textMuted}
                />
                <View style={styles.statusPicker}>
                  {(Object.keys(STATUS_LABELS) as SubmittalStatus[]).map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.statusChip, newCycleStatus === s && { backgroundColor: STATUS_COLORS[s] }]}
                      onPress={() => setNewCycleStatus(s)}
                    >
                      <Text style={[styles.statusChipText, newCycleStatus === s && { color: '#fff' }]}>
                        {STATUS_LABELS[s]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 60 }]}
                  value={newCycleComments}
                  onChangeText={setNewCycleComments}
                  placeholder="Comments (optional)"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                />
                <TouchableOpacity style={styles.addCycleSubmit} onPress={handleAddCycle} activeOpacity={0.85}>
                  <Text style={styles.addCycleSubmitText}>Add Cycle</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {scheduleTasks.length > 0 && (
          <>
            <Text style={styles.fieldLabel}>Linked Schedule Task</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
              <Link2 size={15} color={Colors.info} />
              <Text style={styles.pickerBtnText} numberOfLines={1}>
                {linkedTask ? linkedTask.title : 'None — tap to link a task'}
              </Text>
              <ChevronDown size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            {linkedTask && (
              <View style={styles.linkedTaskBadge}>
                <Text style={styles.linkedTaskPhase}>{linkedTask.phase}</Text>
                <Text style={styles.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                <TouchableOpacity onPress={() => setLinkedTaskId('')}><X size={14} color={Colors.error} /></TouchableOpacity>
              </View>
            )}
          </>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="submittal-save">
          <Save size={18} color="#fff" />
          <Text style={styles.saveBtnText}>{existingSubmittal ? 'Update Submittal' : 'Create Submittal'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowTaskPicker(false)}>
          <Pressable style={styles.taskPickerCard} onPress={() => undefined}>
            <View style={styles.taskPickerHeader}>
              <Text style={styles.taskPickerTitle}>Link Schedule Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity style={[styles.taskOption, !linkedTaskId && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(''); setShowTaskPicker(false); }}>
                <Text style={[styles.taskOptionText, !linkedTaskId && styles.taskOptionTextActive]}>None</Text>
              </TouchableOpacity>
              {scheduleTasks.map(task => (
                <TouchableOpacity key={task.id} style={[styles.taskOption, linkedTaskId === task.id && styles.taskOptionActive]} onPress={() => { setLinkedTaskId(task.id); setShowTaskPicker(false); }}>
                  {linkedTaskId === task.id && <CheckCircle2 size={14} color={Colors.primary} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskOptionText, linkedTaskId === task.id && styles.taskOptionTextActive]} numberOfLines={1}>{task.title}</Text>
                    <Text style={styles.taskOptionMeta}>{task.phase} · {task.durationDays}d</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 16,
  },
  projectLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  timelineSection: {
    marginTop: 24,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  timelineLine: {
    width: 24,
    alignItems: 'center',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  timelineConnector: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: 12,
    paddingBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cycleNumber: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  cycleDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  cycleComments: {
    fontSize: 13,
    color: Colors.text,
    marginTop: 6,
    fontStyle: 'italic',
  },
  addCycleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    marginTop: 12,
  },
  addCycleBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  addCycleForm: {
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  statusPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  addCycleSubmit: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addCycleSubmitText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
  },
  pickerBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  pickerBtnText: { flex: 1, fontSize: 15, color: Colors.text },
  linkedTaskBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, backgroundColor: Colors.primary + '10', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  linkedTaskPhase: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  linkedTaskName: { flex: 1, fontSize: 13, color: Colors.text },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center' as const, alignItems: 'center' as const, padding: 24 },
  taskPickerCard: { backgroundColor: Colors.surface, borderRadius: 16, width: '100%', overflow: 'hidden' as const },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder },
  taskPickerTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder + '80' },
  taskOptionActive: { backgroundColor: Colors.primary + '10' },
  taskOptionText: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: Colors.primary },
  taskOptionMeta: { fontSize: 11, color: Colors.textSecondary ?? Colors.textMuted, marginTop: 1 },
});

```


---

### `app/warranties.tsx`

```tsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Modal, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Shield, Plus, X, Trash2, AlertTriangle, CheckCircle2, Clock,
  ChevronRight, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Warranty, WarrantyCategory } from '@/types';

const CATEGORIES: { key: WarrantyCategory; label: string }[] = [
  { key: 'general', label: 'General' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'foundation', label: 'Foundation' },
  { key: 'windows', label: 'Windows' },
  { key: 'appliances', label: 'Appliances' },
  { key: 'finishes', label: 'Finishes' },
  { key: 'structural', label: 'Structural' },
  { key: 'other', label: 'Other' },
];

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_META: Record<Warranty['status'], { label: string; color: string; bg: string; Icon: any }> = {
  active: { label: 'Active', color: '#34C759', bg: '#E8F5E9', Icon: CheckCircle2 },
  expiring_soon: { label: 'Expiring Soon', color: '#FF9500', bg: '#FFF3E0', Icon: AlertTriangle },
  expired: { label: 'Expired', color: Colors.error, bg: '#FFF0EF', Icon: Clock },
  claimed: { label: 'Claimed', color: Colors.info, bg: '#E3F2FD', Icon: Shield },
  void: { label: 'Void', color: Colors.textMuted, bg: Colors.fillTertiary, Icon: X },
};

export default function WarrantiesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, getProject, warranties, addWarranty, updateWarranty, deleteWarranty,
    getWarrantiesForProject,
  } = useProjects();

  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);

  const list: Warranty[] = useMemo(() => {
    if (project) return getWarrantiesForProject(project.id);
    return [...warranties].sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [project, warranties, getWarrantiesForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formProjectId, setFormProjectId] = useState<string>(project?.id ?? projects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<WarrantyCategory>('general');
  const [provider, setProvider] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [durationMonths, setDurationMonths] = useState('12');
  const [coverage, setCoverage] = useState('');

  const resetForm = useCallback(() => {
    setEditingId(null);
    setFormProjectId(project?.id ?? projects[0]?.id ?? '');
    setTitle('');
    setCategory('general');
    setProvider('');
    setDescription('');
    setStartDate(new Date().toISOString().slice(0, 10));
    setDurationMonths('12');
    setCoverage('');
  }, [project, projects]);

  const openNew = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const openEdit = useCallback((w: Warranty) => {
    setEditingId(w.id);
    setFormProjectId(w.projectId);
    setTitle(w.title);
    setCategory(w.category);
    setProvider(w.provider);
    setDescription(w.description ?? '');
    setStartDate(w.startDate.slice(0, 10));
    setDurationMonths(String(w.durationMonths));
    setCoverage(w.coverageDetails ?? '');
    setShowForm(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!title.trim()) { Alert.alert('Missing Title', 'Please enter a warranty title.'); return; }
    if (!formProjectId) { Alert.alert('Missing Project', 'Please select a project.'); return; }
    const months = parseInt(durationMonths, 10);
    if (!Number.isFinite(months) || months <= 0) { Alert.alert('Invalid Duration', 'Enter months as a positive integer.'); return; }
    const proj = projects.find(p => p.id === formProjectId);
    const startISO = new Date(startDate).toISOString();
    const endISO = addMonths(startISO, months);
    const payload = {
      projectId: formProjectId,
      projectName: proj?.name ?? 'Project',
      title: title.trim(),
      category,
      description: description.trim() || undefined,
      provider: provider.trim() || 'Unknown',
      startDate: startISO,
      durationMonths: months,
      endDate: endISO,
      coverageDetails: coverage.trim() || undefined,
      reminderDays: 30,
    };
    if (editingId) {
      updateWarranty(editingId, payload);
    } else {
      addWarranty(payload);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowForm(false);
    resetForm();
  }, [title, formProjectId, durationMonths, projects, startDate, category, description, provider, coverage, editingId, updateWarranty, addWarranty, resetForm]);

  const handleDelete = useCallback((w: Warranty) => {
    Alert.alert('Delete Warranty', `Remove "${w.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteWarranty(w.id) },
    ]);
  }, [deleteWarranty]);

  const title_label = project ? `${project.name} · Warranties` : 'Warranties';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: title_label,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Shield size={24} color={Colors.primary} />
          <Text style={styles.heroTitle}>Warranty Tracker</Text>
          <Text style={styles.heroSub}>Track active, expiring, and claimed warranties across projects.</Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{list.filter(w => w.status === 'active').length}</Text>
            <Text style={styles.metricLabel}>Active</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: '#FFF3E0' }]}>
            <Text style={[styles.metricValue, { color: '#FF9500' }]}>{list.filter(w => w.status === 'expiring_soon').length}</Text>
            <Text style={styles.metricLabel}>Expiring</Text>
          </View>
          <View style={[styles.metricCard, { backgroundColor: '#FFF0EF' }]}>
            <Text style={[styles.metricValue, { color: Colors.error }]}>{list.filter(w => w.status === 'expired').length}</Text>
            <Text style={styles.metricLabel}>Expired</Text>
          </View>
        </View>

        {list.length === 0 ? (
          <View style={styles.emptyState}>
            <Shield size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No warranties yet</Text>
            <Text style={styles.emptyDesc}>Track equipment, roofing, HVAC, and finish warranties to protect your clients and your liability.</Text>
          </View>
        ) : (
          list.map(w => {
            const meta = STATUS_META[w.status];
            const StatusIcon = meta.Icon;
            const daysLeft = daysBetween(w.endDate, new Date().toISOString());
            return (
              <TouchableOpacity key={w.id} style={styles.card} onPress={() => openEdit(w)} activeOpacity={0.85}>
                <View style={styles.cardHeader}>
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <StatusIcon size={12} color={meta.color} />
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <Text style={styles.categoryText}>{CATEGORIES.find(c => c.key === w.category)?.label ?? w.category}</Text>
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{w.title}</Text>
                {!project ? <Text style={styles.cardProject}>{w.projectName}</Text> : null}
                <Text style={styles.cardProvider}>Provider: {w.provider}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.dateText}>{formatDate(w.startDate)} → {formatDate(w.endDate)}</Text>
                  <Text style={[styles.daysText, { color: daysLeft < 0 ? Colors.error : daysLeft <= 30 ? '#FF9500' : Colors.textSecondary }]}>
                    {daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`}
                  </Text>
                </View>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(w)}>
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity style={styles.addBtn} onPress={openNew} activeOpacity={0.85}>
          <Plus size={18} color={Colors.primary} />
          <Text style={styles.addBtnText}>Add Warranty</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{editingId ? 'Edit Warranty' : 'New Warranty'}</Text>
                  <TouchableOpacity onPress={() => setShowForm(false)}>
                    <X size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {!project && (
                  <>
                    <Text style={styles.fieldLabel}>Project</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                      {projects.map(p => (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.chip, formProjectId === p.id && styles.chipActive]}
                          onPress={() => setFormProjectId(p.id)}
                        >
                          <Text style={[styles.chipText, formProjectId === p.id && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Roof - 10-Year Manufacturer" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.fieldLabel}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity
                      key={c.key}
                      style={[styles.chip, category === c.key && styles.chipActive]}
                      onPress={() => setCategory(c.key)}
                    >
                      <Text style={[styles.chipText, category === c.key && styles.chipTextActive]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.fieldLabel}>Provider / Manufacturer</Text>
                <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="e.g. GAF, Carrier, Kohler" placeholderTextColor={Colors.textMuted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Start Date</Text>
                    <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Duration (months)</Text>
                    <TextInput style={styles.input} value={durationMonths} onChangeText={setDurationMonths} keyboardType="number-pad" placeholder="12" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Coverage Details</Text>
                <TextInput style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]} value={coverage} onChangeText={setCoverage} placeholder="What's covered (parts, labor, etc.)" placeholderTextColor={Colors.textMuted} multiline />

                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput style={[styles.input, { minHeight: 60, paddingTop: 12, textAlignVertical: 'top' as const }]} value={description} onChangeText={setDescription} placeholder="Optional notes" placeholderTextColor={Colors.textMuted} multiline />

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                    <Text style={styles.saveBtnText}>{editingId ? 'Update' : 'Add Warranty'}</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { marginHorizontal: 20, marginTop: 16, marginBottom: 12, padding: 16, backgroundColor: Colors.primary + '10', borderRadius: 16, borderWidth: 1, borderColor: Colors.primary + '25', gap: 4 },
  heroTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginTop: 4 },
  heroSub: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  metricsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  metricCard: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: '#E8F5E9', alignItems: 'center' as const, gap: 2 },
  metricValue: { fontSize: 22, fontWeight: '800' as const, color: '#34C759' },
  metricLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' as const },
  emptyState: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },
  card: { marginHorizontal: 20, marginBottom: 10, padding: 16, borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4, position: 'relative' as const },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginBottom: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  categoryText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  cardTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  cardProject: { fontSize: 12, color: Colors.primary, fontWeight: '600' as const },
  cardProvider: { fontSize: 13, color: Colors.textSecondary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  dateText: { fontSize: 12, color: Colors.textMuted },
  daysText: { fontSize: 12, fontWeight: '700' as const },
  deleteBtn: { position: 'absolute' as const, top: 10, right: 10, width: 26, height: 26, borderRadius: 6, backgroundColor: Colors.errorLight, alignItems: 'center' as const, justifyContent: 'center' as const },
  addBtn: { flexDirection: 'row', alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 12, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary + '12', borderWidth: 1, borderColor: Colors.primary + '25' },
  addBtnText: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' as const },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 4, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' as const, marginBottom: 8 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 10, marginBottom: 4 },
  input: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 15, color: Colors.text },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: '#FFF' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  cancelBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center' as const, justifyContent: 'center' as const },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: '#FFF' },
});

```


---

### `app/permits.tsx`

```tsx
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ClipboardCheck, Calendar, AlertTriangle, Check, XCircle,
  Clock, Search, Eye, ChevronRight, Plus,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_PERMITS, PERMIT_TYPE_INFO, PERMIT_STATUS_INFO } from '@/mocks/permits';
import type { Permit } from '@/types';
import { formatMoney } from '@/utils/formatters';

function PermitCard({ permit, onPress }: { permit: Permit; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const typeInfo = PERMIT_TYPE_INFO[permit.type] ?? PERMIT_TYPE_INFO.other;
  const statusInfo = PERMIT_STATUS_INFO[permit.status] ?? PERMIT_STATUS_INFO.applied;

  const isInspectionUpcoming = permit.inspectionDate &&
    (permit.status === 'inspection_scheduled') &&
    new Date(permit.inspectionDate).getTime() > Date.now();

  const daysUntilInspection = isInspectionUpcoming
    ? Math.ceil((new Date(permit.inspectionDate!).getTime() - Date.now()) / 86400000)
    : 0;

  return (
    <Animated.View style={[styles.permitCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.permitCardInner}
      >
        <View style={styles.permitHeader}>
          <View style={[styles.permitTypeDot, { backgroundColor: typeInfo.color }]} />
          <Text style={styles.permitType}>{typeInfo.label} Permit</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>

        {permit.permitNumber && (
          <Text style={styles.permitNumber}>#{permit.permitNumber}</Text>
        )}

        <Text style={styles.permitProject}>{permit.projectName}</Text>
        <Text style={styles.permitJurisdiction}>{permit.jurisdiction}</Text>

        {isInspectionUpcoming && (
          <View style={styles.inspectionAlert}>
            <Calendar size={13} color="#6A1B9A" />
            <Text style={styles.inspectionAlertText}>
              Inspection in {daysUntilInspection} day{daysUntilInspection !== 1 ? 's' : ''} — {new Date(permit.inspectionDate!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}

        {permit.status === 'inspection_failed' && permit.inspectionNotes && (
          <View style={styles.failedAlert}>
            <AlertTriangle size={13} color="#C62828" />
            <Text style={styles.failedAlertText} numberOfLines={2}>{permit.inspectionNotes}</Text>
          </View>
        )}

        <View style={styles.permitFooter}>
          <Text style={styles.permitFee}>{formatMoney(permit.fee)}</Text>
          <Text style={styles.permitDate}>
            Applied {new Date(permit.appliedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function PermitsScreen() {
  const insets = useSafeAreaInsets();
  const [permits] = useState<Permit[]>(MOCK_PERMITS);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'inspections', label: 'Inspections' },
    { id: 'pending', label: 'Pending' },
  ];

  const filtered = useMemo(() => {
    if (selectedFilter === 'all') return permits;
    if (selectedFilter === 'active') return permits.filter(p => ['approved', 'inspection_scheduled', 'inspection_passed'].includes(p.status));
    if (selectedFilter === 'inspections') return permits.filter(p => p.status.startsWith('inspection'));
    if (selectedFilter === 'pending') return permits.filter(p => ['applied', 'under_review'].includes(p.status));
    return permits;
  }, [permits, selectedFilter]);

  const stats = useMemo(() => {
    const totalFees = permits.reduce((s, p) => s + p.fee, 0);
    const upcomingInspections = permits.filter(p =>
      p.status === 'inspection_scheduled' && p.inspectionDate && new Date(p.inspectionDate).getTime() > Date.now()
    ).length;
    const pending = permits.filter(p => ['applied', 'under_review'].includes(p.status)).length;
    const passed = permits.filter(p => ['approved', 'inspection_passed'].includes(p.status)).length;
    return { totalFees, upcomingInspections, pending, passed };
  }, [permits]);

  const handlePermitPress = useCallback((permit: Permit) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const statusInfo = PERMIT_STATUS_INFO[permit.status];
    const details = [
      `Type: ${PERMIT_TYPE_INFO[permit.type]?.label ?? permit.type}`,
      `Status: ${statusInfo.label}`,
      `Jurisdiction: ${permit.jurisdiction}`,
      `Fee: ${formatMoney(permit.fee)}`,
      permit.permitNumber ? `Permit #: ${permit.permitNumber}` : null,
      permit.inspectionDate ? `Inspection: ${new Date(permit.inspectionDate).toLocaleDateString()}` : null,
      permit.inspectionNotes ? `Notes: ${permit.inspectionNotes}` : null,
    ].filter(Boolean).join('\n');

    Alert.alert(permit.projectName, details);
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Permits', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: Colors.primary + '14' }]}>
              <ClipboardCheck size={16} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{permits.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#F3E5F5' }]}>
              <Calendar size={16} color="#6A1B9A" />
            </View>
            <Text style={[styles.statValue, { color: '#6A1B9A' }]}>{stats.upcomingInspections}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#FFF3E0' }]}>
              <Clock size={16} color="#E65100" />
            </View>
            <Text style={[styles.statValue, { color: '#E65100' }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#E8F5E9' }]}>
              <Check size={16} color="#2E7D32" />
            </View>
            <Text style={[styles.statValue, { color: '#2E7D32' }]}>{stats.passed}</Text>
            <Text style={styles.statLabel}>Passed</Text>
          </View>
        </View>

        <View style={styles.feeCard}>
          <Text style={styles.feeLabel}>Total Permit Fees</Text>
          <Text style={styles.feeValue}>{formatMoney(stats.totalFees)}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, selectedFilter === f.id && styles.filterChipActive]}
              onPress={() => {
                setSelectedFilter(f.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, selectedFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <ClipboardCheck size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No permits found</Text>
            </View>
          ) : (
            filtered.map(permit => (
              <PermitCard key={permit.id} permit={permit} onPress={() => handlePermitPress(permit)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  statIconWrap: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary },
  feeCard: {
    marginHorizontal: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  feeLabel: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' as const },
  feeValue: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  permitCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  permitCardInner: { padding: 14, gap: 4 },
  permitHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  permitTypeDot: { width: 8, height: 8, borderRadius: 4 },
  permitType: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontWeight: '600' as const },
  permitNumber: { fontSize: 13, fontWeight: '500' as const, color: Colors.textMuted },
  permitProject: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  permitJurisdiction: { fontSize: 13, color: Colors.textSecondary },
  inspectionAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  inspectionAlertText: { fontSize: 12, fontWeight: '500' as const, color: '#6A1B9A' },
  failedAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  failedAlertText: { fontSize: 12, color: '#C62828', flex: 1 },
  permitFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  permitFee: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  permitDate: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
});

```


---

### `app/time-tracking.tsx`

```tsx
import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert, Modal,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Clock, Play, Pause, Square, Users, ChevronDown,
  MapPin, Coffee, X, TrendingUp, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_TIME_ENTRIES, CREW_MEMBERS } from '@/mocks/timeTracking';
import type { TimeEntry } from '@/types';
import { formatMoney } from '@/utils/formatters';

function getElapsedHours(clockIn: string): string {
  const diff = Date.now() - new Date(clockIn).getTime();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function LiveTimeCard({ entry, onAction }: { entry: TimeEntry; onAction: (entry: TimeEntry, action: string) => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusColor = entry.status === 'clocked_in' ? '#2E7D32' : entry.status === 'break' ? '#E65100' : Colors.textMuted;
  const statusBg = entry.status === 'clocked_in' ? '#E8F5E9' : entry.status === 'break' ? '#FFF3E0' : '#F5F5F5';
  const statusLabel = entry.status === 'clocked_in' ? 'Working' : entry.status === 'break' ? 'On Break' : 'Clocked Out';

  return (
    <Animated.View style={[styles.liveCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.liveCardInner}
      >
        <View style={styles.liveCardHeader}>
          <View style={styles.liveCardNameRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.liveCardName}>{entry.workerName}</Text>
          </View>
          <View style={[styles.liveStatusBadge, { backgroundColor: statusBg }]}>
            <Text style={[styles.liveStatusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.liveCardMeta}>
          <Text style={styles.liveCardTrade}>{entry.trade}</Text>
          <Text style={styles.liveCardDot}>·</Text>
          <Text style={styles.liveCardProject} numberOfLines={1}>{entry.projectName}</Text>
        </View>

        {entry.status !== 'clocked_out' && (
          <View style={styles.liveCardTimer}>
            <Clock size={14} color={Colors.primary} />
            <Text style={styles.liveCardTimerText}>{getElapsedHours(entry.clockIn)}</Text>
            {entry.notes ? (
              <>
                <Text style={styles.liveCardDot}>·</Text>
                <Text style={styles.liveCardNote} numberOfLines={1}>{entry.notes}</Text>
              </>
            ) : null}
          </View>
        )}

        {entry.status !== 'clocked_out' && (
          <View style={styles.liveCardActions}>
            {entry.status === 'clocked_in' ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#FFF3E0' }]}
                  onPress={() => onAction(entry, 'break')}
                  activeOpacity={0.7}
                >
                  <Coffee size={14} color="#E65100" />
                  <Text style={[styles.actionBtnText, { color: '#E65100' }]}>Break</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: '#FFEBEE' }]}
                  onPress={() => onAction(entry, 'clock_out')}
                  activeOpacity={0.7}
                >
                  <Square size={14} color="#C62828" />
                  <Text style={[styles.actionBtnText, { color: '#C62828' }]}>Clock Out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#E8F5E9' }]}
                onPress={() => onAction(entry, 'resume')}
                activeOpacity={0.7}
              >
                <Play size={14} color="#2E7D32" />
                <Text style={[styles.actionBtnText, { color: '#2E7D32' }]}>Resume</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function TimeTrackingScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('time_tracking')) {
    return (
      <Paywall
        visible={true}
        feature="Crew Time Tracking"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <TimeTrackingScreenInner />;
}

function TimeTrackingScreenInner() {
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<TimeEntry[]>(MOCK_TIME_ENTRIES);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'live' | 'history'>('live');

  const liveEntries = useMemo(() => entries.filter(e => e.status !== 'clocked_out'), [entries]);
  const historyEntries = useMemo(() =>
    entries.filter(e => e.status === 'clocked_out').sort((a, b) => b.date.localeCompare(a.date)),
    [entries]
  );

  const todayStats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = entries.filter(e => e.date === today);
    const totalWorkers = new Set(todayEntries.map(e => e.workerId)).size;
    const totalHours = todayEntries.reduce((s, e) => s + e.totalHours, 0);
    const totalOT = todayEntries.reduce((s, e) => s + e.overtimeHours, 0);
    return { totalWorkers, totalHours, totalOT, liveCount: liveEntries.length };
  }, [entries, liveEntries]);

  const handleAction = useCallback((entry: TimeEntry, action: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (action === 'break') {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'break' as const } : e));
    } else if (action === 'resume') {
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'clocked_in' as const } : e));
    } else if (action === 'clock_out') {
      const now = new Date();
      const clockInTime = new Date(entry.clockIn);
      const totalMs = now.getTime() - clockInTime.getTime();
      const totalHrs = Math.round((totalMs / 3600000 - entry.breakMinutes / 60) * 10) / 10;
      const ot = Math.max(totalHrs - 8, 0);

      setEntries(prev => prev.map(e => e.id === entry.id ? {
        ...e,
        status: 'clocked_out' as const,
        clockOut: now.toISOString(),
        totalHours: Math.max(totalHrs, 0),
        overtimeHours: ot,
      } : e));

      Alert.alert('Clocked Out', `${entry.workerName} clocked out. Total: ${Math.max(totalHrs, 0).toFixed(1)}h`);
    }
  }, []);

  const handleClockIn = useCallback((memberId: string) => {
    const member = CREW_MEMBERS.find(m => m.id === memberId);
    if (!member) return;

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const now = new Date();
    const newEntry: TimeEntry = {
      id: `te-${Date.now()}`,
      projectId: 'p-1',
      projectName: 'Kitchen Renovation - Smith',
      workerId: member.id,
      workerName: member.name,
      trade: member.trade,
      clockIn: now.toISOString(),
      breakMinutes: 0,
      totalHours: 0,
      overtimeHours: 0,
      status: 'clocked_in',
      date: now.toISOString().split('T')[0],
    };

    setEntries(prev => [newEntry, ...prev]);
    setShowClockInModal(false);
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Time Tracking', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: Colors.primary + '14' }]}>
              <Users size={16} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{todayStats.liveCount}</Text>
            <Text style={styles.statLabel}>On Site</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: Colors.info + '14' }]}>
              <Clock size={16} color={Colors.info} />
            </View>
            <Text style={styles.statValue}>{todayStats.totalHours.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Hours Today</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: todayStats.totalOT > 0 ? '#FFF3E0' : Colors.success + '14' }]}>
              {todayStats.totalOT > 0 ? <AlertTriangle size={16} color="#E65100" /> : <TrendingUp size={16} color={Colors.success} />}
            </View>
            <Text style={[styles.statValue, todayStats.totalOT > 0 && { color: '#E65100' }]}>{todayStats.totalOT.toFixed(1)}</Text>
            <Text style={styles.statLabel}>OT Hours</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.clockInButton}
          onPress={() => setShowClockInModal(true)}
          activeOpacity={0.85}
        >
          <Play size={18} color="#fff" />
          <Text style={styles.clockInButtonText}>Clock In Crew Member</Text>
        </TouchableOpacity>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'live' && styles.tabActive]}
            onPress={() => setSelectedTab('live')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, selectedTab === 'live' && styles.tabTextActive]}>
              Live ({liveEntries.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'history' && styles.tabActive]}
            onPress={() => setSelectedTab('history')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, selectedTab === 'history' && styles.tabTextActive]}>
              History ({historyEntries.length})
            </Text>
          </TouchableOpacity>
        </View>

        {selectedTab === 'live' ? (
          liveEntries.length === 0 ? (
            <View style={styles.emptyState}>
              <Clock size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No active time cards</Text>
              <Text style={styles.emptyDesc}>Clock in a crew member to start tracking</Text>
            </View>
          ) : (
            <View style={styles.listSection}>
              {liveEntries.map(entry => (
                <LiveTimeCard key={entry.id} entry={entry} onAction={handleAction} />
              ))}
            </View>
          )
        ) : (
          <View style={styles.listSection}>
            {historyEntries.map(entry => (
              <View key={entry.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyName}>{entry.workerName}</Text>
                  <Text style={styles.historyHours}>{entry.totalHours.toFixed(1)}h</Text>
                </View>
                <View style={styles.historyMeta}>
                  <Text style={styles.historyTrade}>{entry.trade}</Text>
                  <Text style={styles.historyDot}>·</Text>
                  <Text style={styles.historyProject} numberOfLines={1}>{entry.projectName}</Text>
                </View>
                <View style={styles.historyFooter}>
                  <Text style={styles.historyDate}>
                    {new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                  {entry.overtimeHours > 0 && (
                    <View style={styles.otBadge}>
                      <Text style={styles.otBadgeText}>+{entry.overtimeHours.toFixed(1)}h OT</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={showClockInModal} transparent animationType="slide" onRequestClose={() => setShowClockInModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Clock In</Text>
              <TouchableOpacity onPress={() => setShowClockInModal(false)} style={styles.closeBtn}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select a crew member to clock in</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {CREW_MEMBERS.filter(m => !liveEntries.some(e => e.workerId === m.id)).map(member => (
                <TouchableOpacity
                  key={member.id}
                  style={styles.memberRow}
                  onPress={() => handleClockIn(member.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberTrade}>{member.trade} · ${member.rate}/hr</Text>
                  </View>
                  <Play size={16} color={Colors.primary} />
                </TouchableOpacity>
              ))}
              {CREW_MEMBERS.filter(m => !liveEntries.some(e => e.workerId === m.id)).length === 0 && (
                <Text style={styles.allClockedIn}>All crew members are currently clocked in</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statIconWrap: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 20, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  clockInButton: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  clockInButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: { backgroundColor: Colors.surface },
  tabText: { fontSize: 14, fontWeight: '600' as const, color: Colors.textMuted },
  tabTextActive: { color: Colors.text },
  listSection: { paddingHorizontal: 16 },
  liveCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  liveCardInner: { padding: 14, gap: 8 },
  liveCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  liveCardName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  liveStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  liveStatusText: { fontSize: 12, fontWeight: '600' as const },
  liveCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCardTrade: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  liveCardDot: { color: Colors.textMuted, fontSize: 10 },
  liveCardProject: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  liveCardTimer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCardTimerText: { fontSize: 14, fontWeight: '700' as const, color: Colors.primary },
  liveCardNote: { fontSize: 12, color: Colors.textMuted, flex: 1 },
  liveCardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBtnText: { fontSize: 13, fontWeight: '600' as const },
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  historyHours: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  historyMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyTrade: { fontSize: 13, color: Colors.textSecondary },
  historyDot: { color: Colors.textMuted, fontSize: 10 },
  historyProject: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  historyFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  historyDate: { fontSize: 12, color: Colors.textMuted },
  otBadge: { backgroundColor: '#FFF3E0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  otBadgeText: { fontSize: 11, fontWeight: '600' as const, color: '#E65100' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  modalSubtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 16 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: 16, fontWeight: '700' as const, color: Colors.primary },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  memberTrade: { fontSize: 13, color: Colors.textSecondary },
  allClockedIn: { textAlign: 'center' as const, color: Colors.textMuted, paddingVertical: 20, fontSize: 14 },
});

```


---

### `components/AIDailyReportGen.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { generateDailyReport, type DailyReportGenResult } from '@/utils/aiService';
import type { ScheduleTask } from '@/types';

interface Props {
  projectName: string;
  tasks: ScheduleTask[];
  weatherStr: string;
  onGenerated: (result: DailyReportGenResult) => void;
}

export default React.memo(function AIDailyReportGen({ projectName, tasks, weatherStr, onGenerated }: Props) {
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const result = await generateDailyReport(projectName, tasks, weatherStr);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGenerated(result);
    } catch (err) {
      console.error('[AI DFR] Generation failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, projectName, tasks, weatherStr, onGenerated]);

  return (
    <TouchableOpacity style={styles.btn} onPress={handleGenerate} disabled={isLoading}>
      {isLoading ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <Sparkles size={16} color="#FFFFFF" />
      )}
      <Text style={styles.btnText}>
        {isLoading ? 'Generating...' : 'Auto-Generate from Schedule'}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    marginVertical: 8,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
});

```


---

### `components/QuickFieldUpdate.tsx`

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Zap,
  Send,
  Check,
  AlertCircle,
  ChevronDown,
  HardHat,
  Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  parseVoiceCommand,
  type ParsedVoiceCommand,
} from '@/utils/voiceCommandParser';
import type { Project, ScheduleTask } from '@/types';
import QuickUpdateClarifier, {
  type ClarifierAction,
  type ClarifierResult,
} from '@/components/QuickUpdateClarifier';

/**
 * Home-screen quick field update widget.
 *
 * Field workers type natural language like "drywall done floor 3" or
 * "framing 80 percent" and we parse it with `parseVoiceCommand` (text
 * path — the parser doesn't care if input came from voice or keyboard)
 * then apply the resulting action to the currently-selected project's
 * schedule. The UX goal is: under 3 taps from home screen to a task
 * update persisted to Supabase via ProjectContext's offline queue.
 *
 * UX layers (in order of preference):
 *   1. Autocomplete as you type — suggest real task titles from the
 *      selected project so the input is always bound to an actual task.
 *   2. Fast parser path — if the text is unambiguous, apply immediately.
 *   3. Clarifier sheet — if the parser can't resolve task/action/value,
 *      open a bottom sheet seeded with whatever we DID extract and let
 *      the user fill the rest. This is the "ask a question or two"
 *      fallback so no input ever hits a dead-end error.
 */

// Shape returned from the parser step below — either "apply it" or
// "open the clarifier with this seed." Keeps the happy path branchless.
type ClarifierSeed = {
  action?: ClarifierAction;
  value?: number;
  text?: string;
  query?: string;
  candidateTaskIds?: string[];
};

type ParseOutcome =
  | { kind: 'applied'; message: string }
  | {
      kind: 'needs_clarification';
      reason: 'no_task_match' | 'unknown_action' | 'low_confidence';
      seed: ClarifierSeed;
    };

// Map the parser's action vocabulary to the clarifier's. Only the five
// action types the clarifier supports come through; everything else
// becomes `update_progress` as the pragmatic default.
function toClarifierAction(a: string | undefined): ClarifierAction {
  if (a === 'update_progress' || a === 'mark_complete' || a === 'start_task' || a === 'add_note' || a === 'log_issue') {
    return a;
  }
  return 'update_progress';
}

// Cheap fuzzy score. We're not trying to be clever — whole-word match
// beats substring beats "shares a meaningful token". The parser already
// does heavy lifting; this only runs when the parser missed.
function rankTasksForQuery(tasks: ScheduleTask[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  const scored: { id: string; score: number }[] = tasks.map((t) => {
    const title = t.title.toLowerCase();
    let score = 0;
    if (title === q) score += 100;
    if (title.includes(q)) score += 40;
    for (const tok of tokens) {
      if (title.includes(tok)) score += 15;
      if ((t.phase ?? '').toLowerCase().includes(tok)) score += 5;
      if ((t.crew ?? '').toLowerCase().includes(tok)) score += 3;
    }
    return { id: t.id, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.id);
}

export default function QuickFieldUpdate() {
  const { projects, updateProject } = useProjects();
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const [showPicker, setShowPicker] = useState(false);
  const [manualProjectId, setManualProjectId] = useState<string | null>(null);

  // Clarifier state — populated right before we open it.
  const [clarifierOpen, setClarifierOpen] = useState(false);
  const [clarifierSeed, setClarifierSeed] = useState<ClarifierSeed>({});

  const projectsWithSchedule = useMemo(() => {
    return projects
      .filter((p) => p.schedule && p.schedule.tasks.length > 0)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [projects]);

  const selectedProject: Project | null = useMemo(() => {
    if (manualProjectId) {
      return projectsWithSchedule.find((p) => p.id === manualProjectId) ?? null;
    }
    return projectsWithSchedule[0] ?? null;
  }, [manualProjectId, projectsWithSchedule]);

  // Inline autocomplete suggestions — show real task titles so taps bind
  // the user to an exact task rather than relying on fuzzy matching.
  const suggestions = useMemo(() => {
    if (!selectedProject?.schedule) return [] as ScheduleTask[];
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const allTasks = selectedProject.schedule.tasks;
    // Only show suggestions where any significant part of the input
    // overlaps a title. Tiny words like "do" or "at" shouldn't fire it.
    const ranked = rankTasksForQuery(allTasks, q);
    return ranked
      .map((id) => allTasks.find((t) => t.id === id))
      .filter((t): t is ScheduleTask => Boolean(t))
      .slice(0, 4);
  }, [selectedProject, text]);

  /**
   * Core mutator — applies a concrete (task, action, value) tuple to the
   * project's schedule via ProjectContext. Shared by both the fast parser
   * path and the clarifier submission path so the write behavior stays
   * identical. Returns a short confirmation message for the feedback row.
   */
  const applyUpdate = useCallback(
    (
      project: Project,
      task: ScheduleTask,
      action: ClarifierAction,
      value?: number,
      noteText?: string,
    ): string => {
      const schedule = project.schedule!;
      const tasks = schedule.tasks;
      const patch: Partial<ScheduleTask> = {};

      switch (action) {
        case 'update_progress': {
          const v = Math.max(0, Math.min(100, value ?? 0));
          patch.progress = v;
          patch.status = v >= 100 ? 'done' : v > 0 ? 'in_progress' : task.status;
          break;
        }
        case 'mark_complete': {
          patch.progress = 100;
          patch.status = 'done';
          patch.actualEndDate = new Date().toISOString();
          break;
        }
        case 'start_task': {
          patch.status = 'in_progress';
          patch.actualStartDate = task.actualStartDate ?? new Date().toISOString();
          break;
        }
        case 'add_note': {
          const stamp = new Date().toLocaleDateString();
          const combined = task.notes
            ? `${task.notes}\n[${stamp}] ${noteText ?? ''}`
            : `[${stamp}] ${noteText ?? ''}`;
          patch.notes = combined;
          break;
        }
        case 'log_issue': {
          const stamp = new Date().toLocaleDateString();
          const body = `⚠️ ${noteText ?? 'Issue logged'}`;
          const combined = task.notes
            ? `${task.notes}\n[${stamp}] ${body}`
            : `[${stamp}] ${body}`;
          patch.notes = combined;
          patch.status = 'on_hold';
          break;
        }
      }

      const updatedTasks = tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t));
      updateProject(project.id, {
        schedule: { ...schedule, tasks: updatedTasks, updatedAt: new Date().toISOString() },
      });

      switch (action) {
        case 'update_progress':
          return `${task.title} → ${patch.progress}%`;
        case 'mark_complete':
          return `${task.title} marked complete`;
        case 'start_task':
          return `${task.title} → in progress`;
        case 'add_note':
          return `Note added to ${task.title}`;
        case 'log_issue':
          return `Issue logged on ${task.title}`;
      }
    },
    [updateProject],
  );

  /**
   * Decides between applying immediately vs opening the clarifier. The
   * parser result comes in with wildly varying confidence; this function
   * is the gatekeeper that says "we're sure enough, just do it" vs
   * "seed the clarifier."
   */
  const evaluateParse = useCallback(
    (parsed: ParsedVoiceCommand, project: Project): ParseOutcome => {
      const schedule = project.schedule;
      if (!schedule) return { kind: 'applied', message: 'No schedule on this project.' };
      const tasks = schedule.tasks;

      // Fuzzy-find a task by the parser's reported taskName.
      const findTask = (name?: string): ScheduleTask | null => {
        if (!name) return null;
        const lower = name.toLowerCase();
        return (
          tasks.find((t) => t.title.toLowerCase() === lower) ??
          tasks.find((t) => t.title.toLowerCase().includes(lower)) ??
          tasks.find((t) => lower.includes(t.title.toLowerCase())) ??
          null
        );
      };

      // Unknown action AND no taskName — send to clarifier blank.
      if (parsed.action === 'unknown') {
        return {
          kind: 'needs_clarification',
          reason: 'unknown_action',
          seed: {
            action: undefined,
            value: parsed.value,
            text: parsed.text,
            query: parsed.taskName ?? text.trim(),
            candidateTaskIds: rankTasksForQuery(tasks, parsed.taskName ?? text.trim()),
          },
        };
      }

      // Known action — try to bind to a task.
      const clarifierAction = toClarifierAction(parsed.action);
      const task = findTask(parsed.taskName);
      if (!task) {
        return {
          kind: 'needs_clarification',
          reason: 'no_task_match',
          seed: {
            action: clarifierAction,
            value: parsed.value,
            text: parsed.text,
            query: parsed.taskName ?? '',
            candidateTaskIds: rankTasksForQuery(tasks, parsed.taskName ?? text.trim()),
          },
        };
      }

      // Below a 50% confidence cut, even a bound task is worth confirming.
      // We seed the clarifier with the candidate so the user just taps Apply.
      if ((parsed.confidence ?? 0) < 50) {
        return {
          kind: 'needs_clarification',
          reason: 'low_confidence',
          seed: {
            action: clarifierAction,
            value: parsed.value,
            text: parsed.text,
            query: parsed.taskName,
            candidateTaskIds: [task.id, ...rankTasksForQuery(tasks, parsed.taskName ?? '').filter((id) => id !== task.id)],
          },
        };
      }

      // Update_progress with no numeric value is not actionable.
      if (clarifierAction === 'update_progress' && parsed.value == null) {
        return {
          kind: 'needs_clarification',
          reason: 'low_confidence',
          seed: {
            action: 'update_progress',
            text: parsed.text,
            query: parsed.taskName,
            candidateTaskIds: [task.id],
          },
        };
      }

      // Add_note / log_issue with no body — same deal.
      if ((clarifierAction === 'add_note' || clarifierAction === 'log_issue') && !parsed.text?.trim()) {
        return {
          kind: 'needs_clarification',
          reason: 'low_confidence',
          seed: {
            action: clarifierAction,
            text: '',
            query: parsed.taskName,
            candidateTaskIds: [task.id],
          },
        };
      }

      // All green — apply immediately.
      const message = applyUpdate(project, task, clarifierAction, parsed.value, parsed.text);
      return { kind: 'applied', message };
    },
    [applyUpdate, text],
  );

  const openClarifier = useCallback((seed: ClarifierSeed) => {
    setClarifierSeed(seed);
    setClarifierOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    const input = text.trim();
    if (!input) return;
    if (!selectedProject || !selectedProject.schedule) {
      setFeedback({ kind: 'error', message: 'Pick a project with a schedule first.' });
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setParsing(true);
    setFeedback(null);
    try {
      const taskContext = selectedProject.schedule.tasks.map((t) => ({
        title: t.title,
        phase: t.phase,
        progress: t.progress,
        status: t.status,
        crew: t.crew,
      }));
      const parsed = await parseVoiceCommand(input, taskContext, selectedProject.name);
      const outcome = evaluateParse(parsed, selectedProject);
      if (outcome.kind === 'applied') {
        setFeedback({ kind: 'success', message: outcome.message });
        setText('');
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        // Non-fatal — send to clarifier instead of erroring out.
        openClarifier(outcome.seed);
        if (Platform.OS !== 'web') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }
    } catch (err) {
      console.log('[QuickFieldUpdate] parse failed', err);
      // Even on hard failure, give them the clarifier — better than a dead end.
      const tasks = selectedProject.schedule.tasks;
      openClarifier({
        action: undefined,
        query: input,
        candidateTaskIds: rankTasksForQuery(tasks, input),
      });
    } finally {
      setParsing(false);
    }
  }, [text, selectedProject, evaluateParse, openClarifier]);

  const handleClarifierSubmit = useCallback(
    (result: ClarifierResult) => {
      if (!selectedProject) return;
      const msg = applyUpdate(
        selectedProject,
        result.task,
        result.action,
        result.value,
        result.text,
      );
      setFeedback({ kind: 'success', message: msg });
      setText('');
      setClarifierOpen(false);
    },
    [selectedProject, applyUpdate],
  );

  // Tap an autocomplete suggestion → replace input with the exact task
  // title, preserving any verb/value tokens we can salvage from the
  // current input. Cheapest implementation: prepend the title and drop
  // any substring of the old input that overlaps the title. If nothing
  // salvageable remains, leave a trailing space so the user can type
  // "80%" or "done" right away.
  const handleSuggestionTap = useCallback(
    (task: ScheduleTask) => {
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      const title = task.title;
      const lowerTitle = title.toLowerCase();
      const tokens = text
        .trim()
        .split(/\s+/)
        .filter((tok) => {
          const lt = tok.toLowerCase();
          if (!lt) return false;
          // Keep verbs and numeric tokens; drop words that already appear in the title.
          return !lowerTitle.includes(lt);
        });
      const tail = tokens.join(' ').trim();
      setText(tail ? `${title} ${tail}` : `${title} `);
      if (feedback) setFeedback(null);
    },
    [text, feedback],
  );

  if (projectsWithSchedule.length === 0) {
    return null; // Nothing to update against.
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <View style={styles.titleIconWrap}>
          <Zap size={14} color={Colors.primary} />
        </View>
        <Text style={styles.title}>Quick Field Update</Text>
      </View>

      <TouchableOpacity
        style={styles.projectChip}
        onPress={() => {
          if (projectsWithSchedule.length > 1) setShowPicker(true);
        }}
        activeOpacity={projectsWithSchedule.length > 1 ? 0.7 : 1}
        testID="qfu-project-chip"
      >
        <HardHat size={12} color={Colors.textSecondary} />
        <Text style={styles.projectChipText} numberOfLines={1}>
          {selectedProject?.name ?? '—'}
        </Text>
        {projectsWithSchedule.length > 1 && (
          <ChevronDown size={12} color={Colors.textMuted} />
        )}
      </TouchableOpacity>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (feedback) setFeedback(null);
          }}
          placeholder='e.g. "drywall done floor 3" or "framing 80%"'
          placeholderTextColor={Colors.textMuted}
          editable={!parsing}
          returnKeyType="send"
          onSubmitEditing={handleSubmit}
          testID="qfu-text-input"
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!text.trim() || parsing) && styles.sendBtnDisabled,
          ]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={!text.trim() || parsing}
          testID="qfu-send-btn"
        >
          {parsing ? (
            <ActivityIndicator size="small" color={Colors.textOnPrimary} />
          ) : (
            <Send size={14} color={Colors.textOnPrimary} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>

      {/* Inline autocomplete suggestions — bind the user to a real task. */}
      {suggestions.length > 0 && !parsing && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestRow}
          keyboardShouldPersistTaps="handled"
          testID="qfu-suggestions"
        >
          {suggestions.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.suggestChip}
              onPress={() => handleSuggestionTap(t)}
              activeOpacity={0.75}
              testID={`qfu-suggestion-${t.id}`}
            >
              <Sparkles size={10} color={Colors.primary} />
              <Text style={styles.suggestLabel} numberOfLines={1}>
                {t.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {feedback && (
        <View
          style={[
            styles.feedback,
            feedback.kind === 'success'
              ? styles.feedbackSuccess
              : styles.feedbackError,
          ]}
        >
          {feedback.kind === 'success' ? (
            <Check size={12} color={Colors.success} />
          ) : (
            <AlertCircle size={12} color={Colors.warning} />
          )}
          <Text
            style={[
              styles.feedbackText,
              {
                color:
                  feedback.kind === 'success' ? Colors.success : Colors.warning,
              },
            ]}
          >
            {feedback.message}
          </Text>
        </View>
      )}

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setShowPicker(false)}>
          <Pressable style={styles.pickerCard} onPress={() => undefined}>
            <Text style={styles.pickerTitle}>Target Project</Text>
            {projectsWithSchedule.map((p) => {
              const isSelected = p.id === (selectedProject?.id ?? '');
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.pickerRow, isSelected && styles.pickerRowActive]}
                  onPress={() => {
                    setManualProjectId(p.id);
                    setShowPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.pickerRowText,
                      isSelected && styles.pickerRowTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                  <Text style={styles.pickerRowMeta}>
                    {p.schedule?.tasks.length ?? 0} tasks
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {selectedProject?.schedule && (
        <QuickUpdateClarifier
          visible={clarifierOpen}
          tasks={selectedProject.schedule.tasks}
          projectName={selectedProject.name}
          candidateTaskIds={clarifierSeed.candidateTaskIds}
          initialAction={clarifierSeed.action}
          initialValue={clarifierSeed.value}
          initialText={clarifierSeed.text}
          initialQuery={clarifierSeed.query}
          onClose={() => setClarifierOpen(false)}
          onSubmit={handleClarifierSubmit}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.1,
  },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  projectChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    maxWidth: 220,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.text,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.textMuted + '60',
  },
  suggestRow: {
    gap: 6,
    paddingVertical: 2,
    paddingRight: 4,
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    maxWidth: 220,
  },
  suggestLabel: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600' as const,
    flexShrink: 1,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  feedbackSuccess: {
    backgroundColor: Colors.success + '15',
  },
  feedbackError: {
    backgroundColor: Colors.warning + '15',
  },
  feedbackText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    gap: 12,
  },
  pickerRowActive: {
    backgroundColor: Colors.primary + '15',
  },
  pickerRowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  pickerRowTextActive: {
    color: Colors.primary,
    fontWeight: '700' as const,
  },
  pickerRowMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});

```


---

### `components/QuickUpdateClarifier.tsx`

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  X,
  Percent,
  CheckCircle2,
  Play,
  StickyNote,
  AlertTriangle,
  Search,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';

/**
 * Clarifier opened from Quick Field Update when the parser couldn't
 * confidently resolve "which task?" + "what action?" + "what value?".
 * This is the recovery path — the fast text path stays primary, and this
 * sheet catches everything else so the user never hits a dead end.
 *
 * Seeded from whatever the parser DID extract so the user doesn't start
 * from zero: e.g. typing "80%" with no task name pre-selects Update% and
 * the value 80, leaving them to just pick the task. Typing "done floor 3"
 * pre-selects Mark Complete and filters the task list to matches of
 * "floor 3".
 */

export type ClarifierAction =
  | 'update_progress'
  | 'mark_complete'
  | 'start_task'
  | 'add_note'
  | 'log_issue';

export interface ClarifierResult {
  task: ScheduleTask;
  action: ClarifierAction;
  value?: number; // progress %
  text?: string;  // note / issue body
}

interface Props {
  visible: boolean;
  tasks: ScheduleTask[];
  projectName: string;
  /** Tasks pre-ranked as likely matches (fuzzy). Shown first. */
  candidateTaskIds?: string[];
  /** Seed from parser — best guesses we already have. */
  initialAction?: ClarifierAction;
  initialValue?: number;
  initialText?: string;
  initialQuery?: string;
  onClose: () => void;
  onSubmit: (result: ClarifierResult) => void;
}

const ACTION_CHIPS: { key: ClarifierAction; label: string; Icon: typeof Percent; color: string }[] = [
  { key: 'update_progress', label: 'Update %',     Icon: Percent,      color: Colors.primary },
  { key: 'mark_complete',   label: 'Mark complete',Icon: CheckCircle2, color: Colors.success },
  { key: 'start_task',      label: 'Start',        Icon: Play,         color: Colors.info },
  { key: 'add_note',        label: 'Note',         Icon: StickyNote,   color: Colors.textSecondary },
  { key: 'log_issue',       label: 'Issue',        Icon: AlertTriangle,color: Colors.warning },
];

export default function QuickUpdateClarifier({
  visible,
  tasks,
  projectName,
  candidateTaskIds,
  initialAction,
  initialValue,
  initialText,
  initialQuery,
  onClose,
  onSubmit,
}: Props) {
  const [action, setAction] = useState<ClarifierAction>(initialAction ?? 'update_progress');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [valueStr, setValueStr] = useState<string>(
    initialValue != null ? String(initialValue) : '',
  );
  const [noteText, setNoteText] = useState<string>(initialText ?? '');
  const [query, setQuery] = useState<string>(initialQuery ?? '');

  // Re-seed every time the sheet opens so a second invocation doesn't carry
  // stale selection from the previous attempt.
  useEffect(() => {
    if (!visible) return;
    setAction(initialAction ?? 'update_progress');
    setValueStr(initialValue != null ? String(initialValue) : '');
    setNoteText(initialText ?? '');
    setQuery(initialQuery ?? '');
    setSelectedTaskId(candidateTaskIds?.[0] ?? null);
  }, [visible, initialAction, initialValue, initialText, initialQuery, candidateTaskIds]);

  const rankedTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    // If the caller gave us candidates, float them to the top preserving order.
    const candidateSet = new Set(candidateTaskIds ?? []);
    const filtered = q
      ? tasks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.phase ?? '').toLowerCase().includes(q) ||
            (t.crew ?? '').toLowerCase().includes(q),
        )
      : tasks;
    return [...filtered].sort((a, b) => {
      const aIdx = candidateTaskIds?.indexOf(a.id) ?? -1;
      const bIdx = candidateTaskIds?.indexOf(b.id) ?? -1;
      const aCand = candidateSet.has(a.id);
      const bCand = candidateSet.has(b.id);
      if (aCand && bCand) return aIdx - bIdx;
      if (aCand) return -1;
      if (bCand) return 1;
      return a.startDay - b.startDay;
    });
  }, [tasks, query, candidateTaskIds]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const needsValue = action === 'update_progress';
  const needsText = action === 'add_note' || action === 'log_issue';

  const canSubmit = useMemo(() => {
    if (!selectedTask) return false;
    if (needsValue) {
      const n = Number(valueStr);
      if (!Number.isFinite(n) || n < 0 || n > 100) return false;
    }
    if (needsText && !noteText.trim()) return false;
    return true;
  }, [selectedTask, needsValue, valueStr, needsText, noteText]);

  const handleSubmit = () => {
    if (!selectedTask || !canSubmit) return;
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onSubmit({
      task: selectedTask,
      action,
      value: needsValue ? Math.max(0, Math.min(100, Number(valueStr))) : undefined,
      text: needsText ? noteText.trim() : undefined,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} testID="quick-update-clarifier">
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Clarify update</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {projectName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              testID="clarifier-close"
            >
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Action chips */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Action</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionChipsRow}
          >
            {ACTION_CHIPS.map(({ key, label, Icon, color }) => {
              const active = action === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.actionChip,
                    active && { backgroundColor: color + '15', borderColor: color },
                  ]}
                  onPress={() => setAction(key)}
                  activeOpacity={0.8}
                  testID={`clarifier-action-${key}`}
                >
                  <Icon size={14} color={active ? color : Colors.textSecondary} />
                  <Text
                    style={[
                      styles.actionChipLabel,
                      active && { color, fontWeight: '700' as const },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Value inputs (conditional) */}
          {needsValue && (
            <View style={styles.valueRow}>
              <Text style={styles.valueLabel}>Progress</Text>
              <View style={styles.valueInputWrap}>
                <TextInput
                  style={styles.valueInput}
                  value={valueStr}
                  onChangeText={(v) => setValueStr(v.replace(/[^0-9]/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={3}
                  testID="clarifier-progress-input"
                />
                <Text style={styles.valueSuffix}>%</Text>
              </View>
            </View>
          )}

          {needsText && (
            <View style={styles.noteWrap}>
              <Text style={styles.valueLabel}>
                {action === 'log_issue' ? 'Issue details' : 'Note'}
              </Text>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder={
                  action === 'log_issue'
                    ? 'Short description of the issue'
                    : 'What do you want to note?'
                }
                placeholderTextColor={Colors.textMuted}
                multiline
                testID="clarifier-note-input"
              />
            </View>
          )}

          {/* Task picker */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Task</Text>
            {selectedTask && (
              <Text style={styles.sectionHint} numberOfLines={1}>
                Selected: {selectedTask.title}
              </Text>
            )}
          </View>
          <View style={styles.searchRow}>
            <Search size={14} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Filter tasks"
              placeholderTextColor={Colors.textMuted}
              testID="clarifier-task-filter"
            />
          </View>
          <ScrollView
            style={styles.taskList}
            contentContainerStyle={{ paddingVertical: 4 }}
            keyboardShouldPersistTaps="handled"
          >
            {rankedTasks.length === 0 ? (
              <Text style={styles.emptyTasks}>No tasks match that filter.</Text>
            ) : (
              rankedTasks.map((t) => {
                const active = t.id === selectedTaskId;
                const isCandidate = (candidateTaskIds ?? []).includes(t.id);
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.taskRow, active && styles.taskRowActive]}
                    onPress={() => setSelectedTaskId(t.id)}
                    activeOpacity={0.75}
                    testID={`clarifier-task-${t.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.taskTitleRow}>
                        <Text
                          style={[styles.taskTitle, active && styles.taskTitleActive]}
                          numberOfLines={1}
                        >
                          {t.title}
                        </Text>
                        {isCandidate && !active && (
                          <View style={styles.didYouMeanBadge}>
                            <Text style={styles.didYouMeanText}>match</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.taskMeta} numberOfLines={1}>
                        {t.phase} · {t.crew || 'Unassigned'} · {t.progress}%
                      </Text>
                    </View>
                    {active && (
                      <View style={styles.tick}>
                        <CheckCircle2 size={16} color={Colors.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.applyBtn, !canSubmit && styles.applyBtnDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            activeOpacity={0.85}
            testID="clarifier-apply"
          >
            <Text style={styles.applyBtnLabel}>Apply update</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 24,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  sectionHint: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600' as const,
    marginLeft: 8,
    maxWidth: 180,
  },
  actionChipsRow: {
    gap: 8,
    paddingVertical: 4,
    paddingRight: 4,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionChipLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  valueLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  valueInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 10,
    minWidth: 80,
  },
  valueInput: {
    flex: 1,
    minHeight: 40,
    fontSize: 16,
    color: Colors.text,
    fontWeight: '700' as const,
  },
  valueSuffix: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    marginLeft: 2,
  },
  noteWrap: {
    marginTop: 8,
    gap: 6,
  },
  noteInput: {
    minHeight: 60,
    maxHeight: 120,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: Colors.text,
    textAlignVertical: 'top',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    fontSize: 13,
    color: Colors.text,
  },
  taskList: {
    maxHeight: 240,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: 6,
  },
  taskRowActive: {
    backgroundColor: Colors.primary + '12',
    borderWidth: 1,
    borderColor: Colors.primary + '55',
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  taskTitleActive: {
    color: Colors.primary,
  },
  taskMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  didYouMeanBadge: {
    backgroundColor: Colors.accent + '25',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  didYouMeanText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.accent,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tick: {
    marginLeft: 8,
  },
  emptyTasks: {
    fontSize: 12,
    color: Colors.textMuted,
    paddingVertical: 14,
    textAlign: 'center',
  },
  applyBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnDisabled: {
    backgroundColor: Colors.textMuted + '60',
  },
  applyBtnLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});

```


---

### `components/VoiceFieldButton.tsx`

```tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Animated,
} from 'react-native';
import { Mic } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { VoiceUpdateFunctions } from '@/utils/voiceCommandExecutor';
import VoiceCommandModal from './VoiceCommandModal';

interface VoiceFieldButtonProps {
  tasks: ScheduleTask[];
  projectName: string;
  projectId: string;
  updateFunctions: VoiceUpdateFunctions;
  activeTodayTask?: ScheduleTask | null;
  bottomOffset?: number;
}

export default function VoiceFieldButton({
  tasks, projectName, projectId, updateFunctions, activeTodayTask, bottomOffset = 16,
}: VoiceFieldButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.7, duration: 1500, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.3, duration: 1500, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, [scaleAnim, glowAnim]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsModalOpen(true);
  }, []);

  if (Platform.OS === 'web') return null;

  return (
    <>
      <Animated.View
        style={[
          styles.container,
          { bottom: bottomOffset, transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Animated.View style={[styles.glow, { opacity: glowAnim }]} />
        <TouchableOpacity
          style={styles.button}
          onPress={handlePress}
          activeOpacity={0.8}
          testID="voice-field-btn"
        >
          <Mic size={24} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      <VoiceCommandModal
        visible={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tasks={tasks}
        projectName={projectName}
        projectId={projectId}
        updateFunctions={updateFunctions}
        activeTodayTask={activeTodayTask}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.primary,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});

```


---

### `utils/voiceDFRParser.ts`

```ts
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { DailyFieldReport } from '@/types';

const DFRSchema = z.object({
  weather: z.object({
    temperature: z.string().optional(),
    conditions: z.string().optional(),
    wind: z.string().optional(),
  }).optional(),
  manpower: z.array(z.object({
    trade: z.string(),
    company: z.string().optional(),
    headcount: z.number().optional(),
    hoursWorked: z.number().optional(),
  })).optional(),
  workPerformed: z.string().optional(),
  materialsDelivered: z.array(z.string()).optional(),
  issuesAndDelays: z.string().optional(),
});

export async function parseDFRFromTranscript(
  transcript: string,
  _projectId: string,
): Promise<Partial<DailyFieldReport>> {
  console.log('[VoiceDFR] Parsing transcript into DFR fields');

  try {
    const aiResult = await mageAI({
      prompt: `You are a construction daily field report parser. Extract structured data from this voice transcript of a field worker describing their day on a construction site. Extract: weather conditions, manpower headcount by trade, work performed description, materials delivered, and any issues or delays mentioned. Be thorough but only extract what was actually said.\n\nTranscript:\n${transcript}`,
      schema: DFRSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceDFR] AI failed:', aiResult.error);
      throw new Error(aiResult.error || 'AI unavailable');
    }

    const result = aiResult.data;
    console.log('[VoiceDFR] Parsed DFR fields successfully');

    const partial: Partial<DailyFieldReport> = {};

    if (result.weather) {
      partial.weather = {
        temperature: result.weather.temperature ?? '',
        conditions: result.weather.conditions ?? '',
        wind: result.weather.wind ?? '',
        isManual: false,
      };
    }

    if (result.manpower && result.manpower.length > 0) {
      partial.manpower = result.manpower.map((m: any, i: number) => ({
        id: `mp-voice-${Date.now()}-${i}`,
        trade: m.trade ?? '',
        company: m.company ?? '',
        headcount: m.headcount ?? 1,
        hoursWorked: m.hoursWorked ?? 8,
      }));
    }

    if (result.workPerformed) {
      partial.workPerformed = result.workPerformed;
    }

    if (result.materialsDelivered && result.materialsDelivered.length > 0) {
      partial.materialsDelivered = result.materialsDelivered;
    }

    if (result.issuesAndDelays) {
      partial.issuesAndDelays = result.issuesAndDelays;
    }

    return partial;
  } catch (err) {
    console.log('[VoiceDFR] Parse failed:', err);
    throw err;
  }
}

```


---

### `utils/closeoutPacketGenerator.ts`

```ts
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type {
  Project, CompanyBranding, ChangeOrder, Invoice, DailyFieldReport, PunchItem, Warranty,
} from '@/types';

function escapeHtml(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null) return '';
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

interface CloseoutPacketData {
  project: Project;
  branding: CompanyBranding;
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  dailyReports: DailyFieldReport[];
  punchItems: PunchItem[];
  warranties: Warranty[];
  photoCount?: number;
}

function buildCloseoutHtml(data: CloseoutPacketData): string {
  const { project, branding, changeOrders, invoices, dailyReports, punchItems, warranties } = data;

  const approvedCOs = changeOrders.filter(co => co.status === 'approved');
  const totalCOValue = approvedCOs.reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalDue ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.amountPaid ?? 0), 0);
  const totalRetentionHeld = invoices.reduce((s, i) => s + (i.retentionAmount ?? 0), 0);
  const totalRetentionReleased = invoices.reduce((s, i) => s + (i.retentionReleased ?? 0), 0);
  const retentionPending = Math.max(0, totalRetentionHeld - totalRetentionReleased);

  const openPunch = punchItems.filter(p => p.status !== 'closed');
  const closedPunch = punchItems.filter(p => p.status === 'closed');
  const punchCompletion = punchItems.length > 0 ? Math.round((closedPunch.length / punchItems.length) * 100) : 100;

  const activeWarranties = warranties.filter(w => w.status === 'active' || w.status === 'expiring_soon');

  const baseEstimate = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  const finalContractValue = baseEstimate + totalCOValue;

  const company = branding.companyName || 'Contractor';
  const logoHtml = branding.logoUri ? `<img src="${escapeHtml(branding.logoUri)}" style="max-height: 60px; margin-bottom: 8px;" />` : '';

  const coveragePageHtml = `
    <section class="cover">
      ${logoHtml}
      <h1>Project Closeout Packet</h1>
      <h2>${escapeHtml(project.name)}</h2>
      <p class="sub">${escapeHtml(project.location)}</p>
      <div class="cover-meta">
        <div><span class="label">Prepared By</span><span class="value">${escapeHtml(company)}</span></div>
        <div><span class="label">License #</span><span class="value">${escapeHtml(branding.licenseNumber) || '—'}</span></div>
        <div><span class="label">Generated</span><span class="value">${formatDate(new Date().toISOString())}</span></div>
        ${project.closedAt ? `<div><span class="label">Closed</span><span class="value">${formatDate(project.closedAt)}</span></div>` : ''}
        <div><span class="label">Status</span><span class="value status-${project.status}">${escapeHtml(project.status.replace(/_/g, ' '))}</span></div>
      </div>
    </section>
  `;

  const financialsHtml = `
    <section>
      <h3>Financial Summary</h3>
      <table class="summary">
        <tr><td>Original Contract</td><td class="num">${formatMoney(baseEstimate)}</td></tr>
        <tr><td>Approved Change Orders (${approvedCOs.length})</td><td class="num">${totalCOValue >= 0 ? '+' : ''}${formatMoney(totalCOValue)}</td></tr>
        <tr class="total"><td>Final Contract Value</td><td class="num">${formatMoney(finalContractValue)}</td></tr>
        <tr><td>Total Invoiced (${invoices.length})</td><td class="num">${formatMoney(totalInvoiced)}</td></tr>
        <tr><td>Total Paid</td><td class="num">${formatMoney(totalPaid)}</td></tr>
        ${totalRetentionHeld > 0 ? `
          <tr><td>Retention Held</td><td class="num warn">${formatMoney(totalRetentionHeld)}</td></tr>
          <tr><td>Retention Released</td><td class="num ok">${formatMoney(totalRetentionReleased)}</td></tr>
          <tr><td>Retention Pending Release</td><td class="num ${retentionPending > 0 ? 'warn' : 'ok'}">${formatMoney(retentionPending)}</td></tr>
        ` : ''}
      </table>
    </section>
  `;

  const coSectionHtml = approvedCOs.length > 0 ? `
    <section>
      <h3>Approved Change Orders</h3>
      <table class="list">
        <thead><tr><th>CO #</th><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${approvedCOs.map(co => `
            <tr>
              <td>${escapeHtml(co.number)}</td>
              <td>${formatDate(co.date || co.createdAt)}</td>
              <td>${escapeHtml(co.reason || co.description || '—')}</td>
              <td class="num">${formatMoney(co.changeAmount ?? 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const invoicesSectionHtml = invoices.length > 0 ? `
    <section>
      <h3>Invoice Register</h3>
      <table class="list">
        <thead><tr><th>#</th><th>Issued</th><th>Type</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Retention</th></tr></thead>
        <tbody>
          ${invoices.map(inv => `
            <tr>
              <td>${inv.number}</td>
              <td>${formatDate(inv.issueDate)}</td>
              <td>${escapeHtml(inv.type)}${inv.progressPercent ? ` (${inv.progressPercent}%)` : ''}</td>
              <td><span class="pill pill-${inv.status}">${escapeHtml(inv.status.replace(/_/g, ' '))}</span></td>
              <td class="num">${formatMoney(inv.totalDue)}</td>
              <td class="num">${formatMoney(inv.amountPaid ?? 0)}</td>
              <td class="num">${inv.retentionAmount ? formatMoney(inv.retentionAmount) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const punchSectionHtml = punchItems.length > 0 ? `
    <section>
      <h3>Punch List — ${punchCompletion}% Complete</h3>
      <p class="note">${closedPunch.length} of ${punchItems.length} items verified closed.</p>
      ${openPunch.length > 0 ? `
        <h4>Outstanding Items (${openPunch.length})</h4>
        <table class="list">
          <thead><tr><th>Item</th><th>Location</th><th>Assigned To</th><th>Status</th></tr></thead>
          <tbody>
            ${openPunch.map(p => `
              <tr>
                <td>${escapeHtml(p.description)}</td>
                <td>${escapeHtml(p.location || '—')}</td>
                <td>${escapeHtml(p.assignedSub || '—')}</td>
                <td>${escapeHtml(String(p.status).replace(/_/g, ' '))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="ok-note">All punch items verified closed.</p>'}
    </section>
  ` : '';

  const warrantySectionHtml = activeWarranties.length > 0 ? `
    <section>
      <h3>Active Warranties</h3>
      <table class="list">
        <thead><tr><th>Item</th><th>Provider</th><th>Start</th><th>End</th><th>Coverage</th></tr></thead>
        <tbody>
          ${activeWarranties.map(w => `
            <tr>
              <td>${escapeHtml(w.title)}</td>
              <td>${escapeHtml(w.provider)}</td>
              <td>${formatDate(w.startDate)}</td>
              <td>${formatDate(w.endDate)}</td>
              <td>${escapeHtml(w.coverageDetails || '—')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : '';

  const dfrCount = dailyReports.length;
  const projectInfoHtml = `
    <section>
      <h3>Project Information</h3>
      <table class="info">
        <tr><td>Project Name</td><td>${escapeHtml(project.name)}</td></tr>
        <tr><td>Type</td><td>${escapeHtml(project.type)}</td></tr>
        <tr><td>Location</td><td>${escapeHtml(project.location)}</td></tr>
        <tr><td>Square Footage</td><td>${project.squareFootage ? project.squareFootage.toLocaleString() + ' sq ft' : '—'}</td></tr>
        <tr><td>Quality</td><td>${escapeHtml(project.quality)}</td></tr>
        <tr><td>Started</td><td>${formatDate(project.createdAt)}</td></tr>
        ${project.closedAt ? `<tr><td>Closed</td><td>${formatDate(project.closedAt)}</td></tr>` : ''}
        <tr><td>Daily Reports on File</td><td>${dfrCount}</td></tr>
        ${data.photoCount != null ? `<tr><td>Photos Captured</td><td>${data.photoCount}</td></tr>` : ''}
      </table>
    </section>
  `;

  const signoffHtml = `
    <section class="signoff">
      <h3>Acceptance & Sign-Off</h3>
      <div class="sign-grid">
        <div class="sign-box">
          <div class="sign-line"></div>
          <div class="sign-label">Owner / Client — Date</div>
        </div>
        <div class="sign-box">
          <div class="sign-line"></div>
          <div class="sign-label">${escapeHtml(company)} — Date</div>
        </div>
      </div>
      <p class="note">By signing above, parties acknowledge the project has reached substantial completion and all closeout deliverables (warranties, O&M manuals, as-built documentation, punch list clearance) have been furnished.</p>
    </section>
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Closeout Packet — ${escapeHtml(project.name)}</title>
  <style>
    @page { size: letter; margin: 0.75in; }
    body { font-family: -apple-system, 'SF Pro Text', Arial, sans-serif; color: #1C1C1E; font-size: 12px; line-height: 1.5; }
    .cover { text-align: center; padding: 60px 0 40px 0; border-bottom: 2px solid #1C1C1E; margin-bottom: 32px; }
    .cover h1 { font-size: 22px; letter-spacing: -0.5px; margin: 0 0 4px 0; color: #6C6C70; font-weight: 600; text-transform: uppercase; }
    .cover h2 { font-size: 34px; margin: 0 0 8px 0; letter-spacing: -1px; }
    .cover .sub { color: #6C6C70; margin: 0 0 28px 0; font-size: 14px; }
    .cover-meta { display: flex; justify-content: center; flex-wrap: wrap; gap: 22px 32px; }
    .cover-meta > div { text-align: left; min-width: 140px; }
    .cover-meta .label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #8E8E93; font-weight: 600; }
    .cover-meta .value { font-size: 13px; font-weight: 600; color: #1C1C1E; }
    section { margin-bottom: 28px; page-break-inside: avoid; }
    section h3 { font-size: 16px; margin: 0 0 12px 0; color: #1C1C1E; border-bottom: 1px solid #D1D1D6; padding-bottom: 6px; }
    section h4 { font-size: 13px; margin: 14px 0 8px 0; color: #3A3A3C; }
    .note { color: #6C6C70; font-size: 11px; margin: 4px 0 10px 0; }
    .ok-note { color: #30A14E; font-size: 13px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table th, table td { padding: 7px 8px; text-align: left; font-size: 11px; border-bottom: 1px solid #E5E5EA; }
    table th { background: #F2F2F7; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: #6C6C70; }
    table .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    table.summary tr.total td { font-weight: 800; font-size: 13px; border-top: 2px solid #1C1C1E; padding-top: 10px; }
    table.info td:first-child { width: 40%; color: #6C6C70; font-weight: 500; }
    .num.warn { color: #C77700; }
    .num.ok { color: #2E7D32; }
    .pill { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; background: #F2F2F7; color: #3A3A3C; }
    .pill-paid { background: #E6F4EA; color: #2E7D32; }
    .pill-sent { background: #E3F2FD; color: #1565C0; }
    .pill-overdue { background: #FDE7E9; color: #C62828; }
    .status-closed { color: #2E7D32; }
    .status-completed { color: #2E7D32; }
    .signoff { margin-top: 36px; border-top: 2px solid #1C1C1E; padding-top: 24px; }
    .sign-grid { display: flex; gap: 32px; margin: 28px 0 12px 0; }
    .sign-box { flex: 1; }
    .sign-line { border-bottom: 1px solid #1C1C1E; height: 40px; margin-bottom: 6px; }
    .sign-label { font-size: 10px; color: #6C6C70; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .footer { text-align: center; color: #8E8E93; font-size: 10px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #E5E5EA; }
  </style>
</head>
<body>
  ${coveragePageHtml}
  ${projectInfoHtml}
  ${financialsHtml}
  ${coSectionHtml}
  ${invoicesSectionHtml}
  ${punchSectionHtml}
  ${warrantySectionHtml}
  ${signoffHtml}
  <div class="footer">Generated by MAGE ID · ${escapeHtml(company)} · ${formatDate(new Date().toISOString())}</div>
</body>
</html>`;
}

export async function generateCloseoutPacketUri(data: CloseoutPacketData): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildCloseoutHtml(data);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    console.log('[Closeout] Packet PDF URI:', uri);
    return uri;
  } catch (error) {
    console.error('[Closeout] Error generating packet:', error);
    return null;
  }
}

export async function generateAndShareCloseoutPacket(data: CloseoutPacketData): Promise<boolean> {
  const html = buildCloseoutHtml(data);

  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return true;
  }

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Closeout Packet — ${data.project.name}`,
        UTI: 'com.adobe.pdf',
      });
    }
    return true;
  } catch (error) {
    console.error('[Closeout] Error sharing packet:', error);
    return false;
  }
}

```

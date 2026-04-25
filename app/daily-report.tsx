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
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
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
        // Library photos may have been taken anywhere / any time \u2014 we don't
        // pretend the *current* GPS reading represents where the picture was
        // taken. Geo-stamp only on camera capture, where "now" is correct.
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
        // Fire the GPS stamp in parallel \u2014 it has its own 3s timeout, so it
        // never blocks the photo from showing up in the report.
        const stamp = await stampPhotoLocation();
        const photo: DFRPhoto = {
          id: createId('photo'),
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
          ...(stamp ? {
            latitude: stamp.latitude,
            longitude: stamp.longitude,
            locationAccuracyMeters: stamp.accuracyMeters,
            locationLabel: stamp.label,
          } : null),
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

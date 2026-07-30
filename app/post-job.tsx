import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';

import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useHire, HIRE_ENABLED } from '@/contexts/HireContext';
import { TRADE_CATEGORIES } from '@/constants/trades';
import { US_STATES } from '@/constants/regions';
import type { JobListing, TradeCategory, JobType, ExperienceLevel } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const JOB_TYPES: { id: JobType; label: string }[] = [
  { id: 'full_time', label: 'Full-Time' }, { id: 'part_time', label: 'Part-Time' },
  { id: 'contract', label: 'Contract' }, { id: 'per_diem', label: 'Per Diem' },
];

const EXP_LEVELS: { id: ExperienceLevel; label: string }[] = [
  { id: 'entry', label: 'Entry' }, { id: 'mid', label: 'Mid' },
  { id: 'senior', label: 'Senior' }, { id: 'expert', label: 'Expert' },
];

export default function PostJobScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { addJob } = useHire();
  const [title, setTitle] = useState('');
  const [trade, setTrade] = useState<TradeCategory>('general_laborer');
  const [city, setCity] = useState('');
  const [state, setState] = useState('NY');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [payType, setPayType] = useState<'hourly' | 'salary'>('hourly');
  const [jobType, setJobType] = useState<JobType>('full_time');
  const [expLevel, setExpLevel] = useState<ExperienceLevel>('mid');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [licenses, setLicenses] = useState('');

  const handleSubmit = useCallback(() => {
    if (!title.trim() || !city.trim() || !payMin || !payMax || !startDate) {
      showAlert('Missing Fields', 'Please fill in all required fields.');
      return;
    }

    const job: JobListing = {
      id: generateUUID(),
      companyId: 'you',
      companyName: 'Your Company',
      title: title.trim(),
      tradeCategory: trade,
      city: city.trim(),
      state,
      payMin: parseFloat(payMin) || 0,
      payMax: parseFloat(payMax) || 0,
      payType,
      jobType,
      requiredLicenses: licenses.split(',').map(l => l.trim()).filter(Boolean),
      experienceLevel: expLevel,
      description: description.trim(),
      startDate,
      postedDate: new Date().toISOString(),
      status: 'open',
      applicantCount: 0,
    };

    addJob(job);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Job Saved', 'Your job listing has been saved to this device.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }, [title, trade, city, state, payMin, payMax, payType, jobType, expLevel, description, startDate, licenses, addJob, router]);

  if (!HIRE_ENABLED) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{
          title: 'Post a Job',
          headerStyle: { backgroundColor: themeColors.bg },
          headerTintColor: themeColors.accent,
          headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
        }} />
        <View style={styles.unavailable}>
          <Text style={styles.unavailableTitle}>Direct Hire is coming soon</Text>
          <Text style={styles.unavailableBody}>The in-app hiring marketplace isn&apos;t available yet. We&apos;ll let you know when you can post jobs and connect with workers.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Post a Job',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Job Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="e.g. Journeyman Electrician" placeholderTextColor={themeColors.textMuted} />

          <Text style={styles.label}>Trade / Skill Category *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollRow}>
            {TRADE_CATEGORIES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, trade === t.id && styles.chipActive]} onPress={() => setTrade(t.id)}>
                <Text style={[styles.chipText, trade === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>City *</Text>
              <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={themeColors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>State *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stateScroll}>
                {US_STATES.slice(0, 15).map(s => (
                  <TouchableOpacity key={s.code} style={[styles.stateChip, state === s.code && styles.stateChipActive]} onPress={() => setState(s.code)}>
                    <Text style={[styles.stateChipText, state === s.code && styles.stateChipTextActive]}>{s.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <Text style={styles.label}>Pay Type</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity style={[styles.chip, payType === 'hourly' && styles.chipActive]} onPress={() => setPayType('hourly')}>
              <Text style={[styles.chipText, payType === 'hourly' && styles.chipTextActive]}>Hourly</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.chip, payType === 'salary' && styles.chipActive]} onPress={() => setPayType('salary')}>
              <Text style={[styles.chipText, payType === 'salary' && styles.chipTextActive]}>Salary</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>{payType === 'hourly' ? 'Min $/hr *' : 'Min $/yr *'}</Text>
              <TextInput style={styles.input} value={payMin} onChangeText={setPayMin} placeholder={payType === 'hourly' ? '35' : '60000'} keyboardType="numeric" placeholderTextColor={themeColors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>{payType === 'hourly' ? 'Max $/hr *' : 'Max $/yr *'}</Text>
              <TextInput style={styles.input} value={payMax} onChangeText={setPayMax} placeholder={payType === 'hourly' ? '55' : '90000'} keyboardType="numeric" placeholderTextColor={themeColors.textMuted} />
            </View>
          </View>

          <Text style={styles.label}>Job Type *</Text>
          <View style={styles.chipRow}>
            {JOB_TYPES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, jobType === t.id && styles.chipActive]} onPress={() => setJobType(t.id)}>
                <Text style={[styles.chipText, jobType === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Experience Level *</Text>
          <View style={styles.chipRow}>
            {EXP_LEVELS.map(e => (
              <TouchableOpacity key={e.id} style={[styles.chip, expLevel === e.id && styles.chipActive]} onPress={() => setExpLevel(e.id)}>
                <Text style={[styles.chipText, expLevel === e.id && styles.chipTextActive]}>{e.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Start Date (YYYY-MM-DD) *</Text>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-05-01" placeholderTextColor={themeColors.textMuted} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Describe the role..." placeholderTextColor={themeColors.textMuted} multiline numberOfLines={4} />

          <Text style={styles.label}>Required Licenses (comma separated)</Text>
          <TextInput style={styles.input} value={licenses} onChangeText={setLicenses} placeholder="OSHA 30, SST Card, CDL" placeholderTextColor={themeColors.textMuted} />

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} testID="submit-job">
            <Text style={styles.submitBtnText}>Publish Job</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  unavailable: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 32, gap: 8 },
  unavailableTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  unavailableBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  label: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: t.surface, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: t.text, borderWidth: 0.5, borderColor: t.line },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  scrollRow: { maxHeight: 36 },
  stateScroll: { maxHeight: 36 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, marginRight: 4, borderWidth: 0.5, borderColor: t.line },
  stateChipActive: { backgroundColor: t.accent, borderColor: t.accent },
  stateChipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  stateChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, borderWidth: 0.5, borderColor: t.line },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  submitBtn: { backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
});

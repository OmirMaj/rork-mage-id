import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Modal, TextInput,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import {
  FileText, Plus, Trash2, Eye, Check, Upload, X, ChevronDown, File,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { getTemplates, saveTemplate, deleteTemplate, createTemplate, BUILT_IN_TEMPLATES } from '@/utils/templateManager';
import type { CustomTemplate } from '@/types';

type TemplateType = CustomTemplate['type'];
const TEMPLATE_TYPES: { value: TemplateType; label: string }[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'schedule', label: 'Schedule PDF' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'daily_report', label: 'Daily Report' },
];

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadType, setUploadType] = useState<TemplateType>('proposal');
  const [uploadFileUri, setUploadFileUri] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState('');
  const [showTypePicker, setShowTypePicker] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await getTemplates();
      setTemplates(stored);
    } catch (err) {
      console.log('[Templates] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/html'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setUploadFileUri(asset.uri);
        setUploadFileName(asset.name);
        if (!uploadName) {
          setUploadName(asset.name.replace(/\.(pdf|html|htm)$/i, ''));
        }
        console.log('[Templates] File picked:', asset.name, asset.mimeType);
      }
    } catch (err) {
      console.log('[Templates] File pick error:', err);
      Alert.alert('Error', 'Failed to pick file.');
    }
  }, [uploadName]);

  const handleUpload = useCallback(async () => {
    if (!uploadName.trim()) {
      Alert.alert('Required', 'Please enter a template name.');
      return;
    }
    if (!uploadFileUri) {
      Alert.alert('Required', 'Please select a file.');
      return;
    }

    const isHtml = uploadFileName.toLowerCase().endsWith('.html') || uploadFileName.toLowerCase().endsWith('.htm');
    const mode = isHtml ? 'dynamic' : 'static';

    const template = createTemplate(uploadName.trim(), uploadType, mode as CustomTemplate['mode'], uploadFileUri);
    await saveTemplate(template);
    setTemplates(prev => [...prev, template]);

    setShowUploadModal(false);
    setUploadName('');
    setUploadFileUri(null);
    setUploadFileName('');

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Template Saved', `"${template.name}" has been added to your templates.`);
  }, [uploadName, uploadType, uploadFileUri, uploadFileName]);

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert('Delete Template', `Are you sure you want to delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteTemplate(id);
          setTemplates(prev => prev.filter(t => t.id !== id));
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }, []);

  const proposalTemplates = templates.filter(t => t.type === 'proposal');
  const scheduleTemplates = templates.filter(t => t.type === 'schedule');
  const otherTemplates = templates.filter(t => t.type !== 'proposal' && t.type !== 'schedule');

  const builtInProposal = BUILT_IN_TEMPLATES.filter(t => t.type === 'proposal');
  const builtInSchedule = BUILT_IN_TEMPLATES.filter(t => t.type === 'schedule');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'My Templates',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        <View style={styles.introCard}>
          <FileText size={20} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Custom Templates</Text>
            <Text style={styles.introText}>Upload your own PDF or HTML templates for proposals, schedules, invoices, and daily reports.</Text>
          </View>
        </View>

        <Text style={styles.sectionHeader}>PROPOSAL TEMPLATES</Text>
        <View style={styles.group}>
          {builtInProposal.map(t => (
            <TemplateRow key={t.id} template={t} isBuiltIn onPress={() => {}} />
          ))}
          {proposalTemplates.map(t => (
            <TemplateRow key={t.id} template={t} onPress={() => {}} onDelete={() => handleDelete(t.id, t.name)} />
          ))}
          <TouchableOpacity style={styles.addRow} onPress={() => { setUploadType('proposal'); setShowUploadModal(true); }} activeOpacity={0.7}>
            <Plus size={16} color={Colors.primary} />
            <Text style={styles.addRowText}>Upload Proposal Template</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>SCHEDULE PDF TEMPLATES</Text>
        <View style={styles.group}>
          {builtInSchedule.map(t => (
            <TemplateRow key={t.id} template={t} isBuiltIn onPress={() => {}} />
          ))}
          {scheduleTemplates.map(t => (
            <TemplateRow key={t.id} template={t} onPress={() => {}} onDelete={() => handleDelete(t.id, t.name)} />
          ))}
          <TouchableOpacity style={styles.addRow} onPress={() => { setUploadType('schedule'); setShowUploadModal(true); }} activeOpacity={0.7}>
            <Plus size={16} color={Colors.primary} />
            <Text style={styles.addRowText}>Upload Schedule Template</Text>
          </TouchableOpacity>
        </View>

        {otherTemplates.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>OTHER TEMPLATES</Text>
            <View style={styles.group}>
              {otherTemplates.map(t => (
                <TemplateRow key={t.id} template={t} onPress={() => {}} onDelete={() => handleDelete(t.id, t.name)} />
              ))}
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.uploadFab}
          onPress={() => setShowUploadModal(true)}
          activeOpacity={0.85}
        >
          <Upload size={18} color="#FFF" />
          <Text style={styles.uploadFabText}>Upload Template</Text>
        </TouchableOpacity>

        <View style={styles.helpCard}>
          <Text style={styles.helpTitle}>Template Types</Text>
          <Text style={styles.helpText}>
            <Text style={{ fontWeight: '700' as const }}>PDF files:</Text> Used as static cover pages or attachments alongside generated content.{'\n\n'}
            <Text style={{ fontWeight: '700' as const }}>HTML files:</Text> Dynamic templates with {'{{placeholders}}'} that get replaced with real project data. Use double brackets like {'{{project_name}}'}, {'{{total_cost}}'}, etc.
          </Text>
        </View>
      </ScrollView>

      <Modal visible={showUploadModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Upload Template</Text>
              <TouchableOpacity onPress={() => setShowUploadModal(false)}><X size={22} color={Colors.text} /></TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.fieldLabel}>Template Name *</Text>
              <TextInput
                style={styles.modalInput}
                value={uploadName}
                onChangeText={setUploadName}
                placeholder="My Company Proposal"
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Template Type *</Text>
              <TouchableOpacity style={styles.typePicker} onPress={() => setShowTypePicker(!showTypePicker)} activeOpacity={0.7}>
                <Text style={styles.typePickerText}>{TEMPLATE_TYPES.find(t => t.value === uploadType)?.label}</Text>
                <ChevronDown size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              {showTypePicker && (
                <View style={styles.typeDropdown}>
                  {TEMPLATE_TYPES.map(t => (
                    <TouchableOpacity
                      key={t.value}
                      style={styles.typeOption}
                      onPress={() => { setUploadType(t.value); setShowTypePicker(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.typeOptionText}>{t.label}</Text>
                      {uploadType === t.value && <Check size={16} color={Colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>File *</Text>
              <TouchableOpacity style={styles.filePickBtn} onPress={handlePickFile} activeOpacity={0.7}>
                {uploadFileUri ? (
                  <View style={styles.filePickedRow}>
                    <File size={16} color={Colors.primary} />
                    <Text style={styles.filePickedText} numberOfLines={1}>{uploadFileName}</Text>
                    <TouchableOpacity onPress={() => { setUploadFileUri(null); setUploadFileName(''); }}>
                      <X size={14} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.filePickPrompt}>
                    <Upload size={18} color={Colors.textMuted} />
                    <Text style={styles.filePickPromptText}>Select PDF or HTML file</Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={styles.uploadBtn} onPress={handleUpload} activeOpacity={0.85}>
                <Text style={styles.uploadBtnText}>Save Template</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TemplateRow({ template, isBuiltIn, onPress, onDelete }: {
  template: CustomTemplate; isBuiltIn?: boolean; onPress: () => void; onDelete?: () => void;
}) {
  const date = template.lastUsedAt
    ? `Last used: ${new Date(template.lastUsedAt).toLocaleDateString()}`
    : template.createdAt
    ? new Date(template.createdAt).toLocaleDateString()
    : '';

  return (
    <View style={styles.templateRow}>
      <View style={[styles.templateIcon, { backgroundColor: isBuiltIn ? Colors.primary + '12' : Colors.accent + '12' }]}>
        <FileText size={16} color={isBuiltIn ? Colors.primary : Colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.templateName}>{template.name}</Text>
        <Text style={styles.templateMeta}>
          {isBuiltIn ? 'Built-in' : template.mode === 'dynamic' ? 'HTML Template' : 'PDF'} · {date}
        </Text>
      </View>
      {!isBuiltIn && onDelete && (
        <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} activeOpacity={0.7}>
          <Trash2 size={16} color={Colors.error} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  introCard: { flexDirection: 'row', gap: 12, margin: 16, padding: 16, backgroundColor: Colors.primary + '08', borderRadius: 14, borderWidth: 1, borderColor: Colors.primary + '18' },
  introTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.primary, marginBottom: 4 },
  introText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  sectionHeader: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.6, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 },
  group: { backgroundColor: Colors.surface, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' as const },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  templateIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  templateName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  templateMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  deleteBtn: { padding: 6 },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  addRowText: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary },
  uploadFab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginTop: 24, backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12 },
  uploadFabText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  helpCard: { margin: 16, padding: 16, backgroundColor: Colors.surface, borderRadius: 12 },
  helpTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  helpText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  modalBody: { padding: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6 },
  modalInput: { backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text },
  typePicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  typePickerText: { fontSize: 15, color: Colors.text },
  typeDropdown: { backgroundColor: Colors.background, borderRadius: 10, marginTop: 4 },
  typeOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  typeOptionText: { fontSize: 15, color: Colors.text },
  filePickBtn: { backgroundColor: Colors.background, borderRadius: 10, padding: 16 },
  filePickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filePickedText: { flex: 1, fontSize: 14, color: Colors.primary, fontWeight: '500' as const },
  filePickPrompt: { alignItems: 'center', gap: 8 },
  filePickPromptText: { fontSize: 14, color: Colors.textMuted },
  uploadBtn: { marginTop: 24, backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  uploadBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
});


import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, Platform, KeyboardAvoidingView, Pressable, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  X, FileText, Send, Mail, ChevronDown, ChevronUp, User, BookUser,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import ContactPickerModal from '@/components/ContactPickerModal';
import type { Contact, PDFNamingSettings } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

export type PDFDocumentType = 'estimate' | 'invoice' | 'change_order' | 'schedule' | 'daily_report' | 'status_report' | 'closeout';

interface PDFSection {
  id: string;
  label: string;
  enabled: boolean;
}

interface PDFPreSendSheetProps {
  visible: boolean;
  onClose: () => void;
  onSend: (options: PDFSendOptions) => void;
  documentType: PDFDocumentType;
  projectName: string;
  documentNumber?: number;
  defaultRecipient?: string;
  sections?: PDFSection[];
  contacts?: Contact[];
  pdfNaming?: PDFNamingSettings;
  onPdfNumberUsed?: () => void;
  /** When false/absent the Bulk Savings Breakdown toggle is hidden so the
   *  contractor is never offered a fabricated section. Only pass true when
   *  computeBulkSavings().hasRealData && .bulkSavings > 0. */
  hasBulkSavings?: boolean;
}

export interface PDFSendOptions {
  fileName: string;
  recipient: string;
  message: string;
  sections: PDFSection[];
  method: 'share' | 'email';
}

function getDocTypeString(type: PDFDocumentType): string {
  switch (type) {
    case 'estimate': return 'Estimate';
    case 'invoice': return 'Invoice';
    case 'change_order': return 'Change Order';
    case 'schedule': return 'Schedule';
    case 'daily_report': return 'Daily Report';
    case 'status_report': return 'Status Report';
    case 'closeout': return 'Closeout';
    default: return 'Document';
  }
}

function getDefaultFileName(type: PDFDocumentType, projectName: string, docNumber?: number, pdfNaming?: PDFNamingSettings): string {
  if (pdfNaming?.enabled) {
    const sep = pdfNaming.separator;
    const parts: string[] = [];
    if (pdfNaming.prefix.trim()) parts.push(pdfNaming.prefix.trim());
    if (pdfNaming.includeProjectName) parts.push(projectName);
    if (pdfNaming.includeDocType) parts.push(getDocTypeString(type));
    if (pdfNaming.includeDate) {
      const now = new Date();
      parts.push(now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }
    const numStr = String(pdfNaming.nextNumber).padStart(3, '0');
    return parts.join(sep) + sep + numStr;
  }

  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  switch (type) {
    case 'estimate':
      return `${projectName} - Estimate - ${monthYear}`;
    case 'invoice':
      return `${projectName} - Invoice #${docNumber ?? 1} - ${monthYear}`;
    case 'change_order':
      return `${projectName} - CO #${docNumber ?? 1} - ${monthYear}`;
    case 'schedule':
      return `${projectName} - Schedule - ${monthYear}`;
    case 'daily_report':
      return `${projectName} - Daily Report - ${dateStr}`;
    case 'status_report':
      return `${projectName} - Status Report - ${dateStr}`;
    case 'closeout':
      return `${projectName} - Closeout - ${monthYear}`;
    default:
      return `${projectName} - Document - ${monthYear}`;
  }
}

function getDefaultSections(type: PDFDocumentType, hasBulkSavings = false): PDFSection[] {
  switch (type) {
    case 'estimate': {
      const sections: PDFSection[] = [
        { id: 'line_items', label: 'Line Items', enabled: true },
        { id: 'cost_summary', label: 'Cost Summary', enabled: true },
      ];
      // Only show the Bulk Savings Breakdown toggle when there is real
      // buyout-measured data — never offer a fabricated section.
      if (hasBulkSavings) {
        sections.push({ id: 'bulk_savings', label: 'Bulk Savings Breakdown', enabled: true });
      }
      sections.push(
        { id: 'schedule_summary', label: 'Schedule Summary', enabled: false },
        { id: 'branding', label: 'Company Branding', enabled: true },
      );
      return sections;
    }
    case 'invoice':
      return [
        { id: 'line_items', label: 'Line Items', enabled: true },
        { id: 'payment_terms', label: 'Payment Terms', enabled: true },
        { id: 'tax_breakdown', label: 'Tax Breakdown', enabled: true },
        { id: 'branding', label: 'Company Branding', enabled: true },
      ];
    case 'change_order':
      return [
        { id: 'original_scope', label: 'Original Scope', enabled: true },
        { id: 'changes', label: 'Changes & Line Items', enabled: true },
        { id: 'new_total', label: 'New Contract Total', enabled: true },
        { id: 'approval_status', label: 'Approval Status', enabled: true },
      ];
    case 'daily_report':
      return [
        { id: 'weather', label: 'Weather Conditions', enabled: true },
        { id: 'manpower', label: 'Manpower Log', enabled: true },
        { id: 'work_performed', label: 'Work Performed', enabled: true },
        { id: 'issues', label: 'Issues & Delays', enabled: true },
        { id: 'photos', label: 'Photos', enabled: true },
      ];
    default:
      return [
        { id: 'full_content', label: 'Full Content', enabled: true },
        { id: 'branding', label: 'Company Branding', enabled: true },
      ];
  }
}

function getDocTypeLabel(type: PDFDocumentType): string {
  switch (type) {
    case 'estimate': return 'Estimate';
    case 'invoice': return 'Invoice';
    case 'change_order': return 'Change Order';
    case 'schedule': return 'Schedule';
    case 'daily_report': return 'Daily Report';
    case 'status_report': return 'Status Report';
    case 'closeout': return 'Closeout Package';
    default: return 'Document';
  }
}

export default function PDFPreSendSheet({
  visible,
  onClose,
  onSend,
  documentType,
  projectName,
  documentNumber,
  defaultRecipient = '',
  sections: propSections,
  contacts,
  pdfNaming,
  onPdfNumberUsed,
  hasBulkSavings = false,
}: PDFPreSendSheetProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [fileName, setFileName] = useState('');
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [sections, setSections] = useState<PDFSection[]>([]);
  const [showSections, setShowSections] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setFileName(getDefaultFileName(documentType, projectName, documentNumber, pdfNaming));
      setRecipient(defaultRecipient);
      setRecipientName('');
      setMessage('');
      setSections(propSections ?? getDefaultSections(documentType, hasBulkSavings));
      setShowSections(false);
      setShowContactPicker(false);
    }
  }, [visible, documentType, projectName, documentNumber, defaultRecipient, propSections, pdfNaming, hasBulkSavings]);

  const toggleSection = useCallback((id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleSend = useCallback((method: 'share' | 'email') => {
    if (!fileName.trim()) {
      showAlert('Missing Name', 'Please enter a file name.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSend({
      fileName: fileName.trim(),
      recipient: recipient.trim(),
      message: message.trim(),
      sections,
      method,
    });
    if (pdfNaming?.enabled && onPdfNumberUsed) {
      onPdfNumberUsed();
    }
  }, [fileName, recipient, message, sections, onSend, pdfNaming, onPdfNumberUsed]);

  const docLabel = useMemo(() => getDocTypeLabel(documentType), [documentType]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <Pressable style={styles.overlayTouch} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <View>
                <Text style={styles.headerTitle}>Send {docLabel}</Text>
                <Text style={styles.headerSubtitle}>{projectName}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
            </View>

            <ScrollView
              style={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>FILE NAME</Text>
              <View style={styles.fileNameRow}>
                <FileText size={16} color={themeColors.accent} strokeWidth={1.75} />
                <TextInput
                  style={styles.fileNameInput}
                  value={fileName}
                  onChangeText={setFileName}
                  placeholder="Document name"
                  placeholderTextColor={themeColors.textMuted}
                  testID="pdf-filename-input"
                />
                <Text style={styles.pdfExt}>.pdf</Text>
              </View>

              <Text style={styles.fieldLabel}>INCLUDE IN PDF</Text>
              <TouchableOpacity
                style={styles.sectionsToggle}
                onPress={() => setShowSections(!showSections)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionsToggleText}>
                  {sections.filter(s => s.enabled).length} of {sections.length} sections selected
                </Text>
                {showSections
                  ? <ChevronUp size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                  : <ChevronDown size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                }
              </TouchableOpacity>
              {showSections && (
                <View style={styles.sectionsList}>
                  {sections.map(section => (
                    <View key={section.id} style={styles.sectionRow}>
                      <Text style={styles.sectionLabel}>{section.label}</Text>
                      <Switch
                        value={section.enabled}
                        onValueChange={() => toggleSection(section.id)}
                        trackColor={{ false: themeColors.surfaceAlt, true: themeColors.accent + '50' }}
                        thumbColor={section.enabled ? themeColors.accent : themeColors.textMuted}
                      />
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>RECIPIENT</Text>
              {recipientName ? (
                <View style={styles.selectedRecipient}>
                  <User size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <View style={styles.selectedRecipientInfo}>
                    <Text style={styles.selectedRecipientName}>{recipientName}</Text>
                    <Text style={styles.selectedRecipientEmail}>{recipient}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setRecipient(''); setRecipientName(''); }}
                    style={styles.clearRecipientBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.recipientRow}>
                  <User size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  <TextInput
                    style={styles.recipientInput}
                    value={recipient}
                    onChangeText={setRecipient}
                    placeholder="client@email.com"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    testID="pdf-recipient-input"
                  />
                </View>
              )}
              {(contacts && contacts.length > 0) ? (
                <TouchableOpacity
                  style={styles.pickContactBtn}
                  onPress={() => setShowContactPicker(true)}
                  activeOpacity={0.7}
                  testID="pdf-pick-contact-btn"
                >
                  <BookUser size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.pickContactText}>Pick from Contacts</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.fieldLabel}>MESSAGE (OPTIONAL)</Text>
              <TextInput
                style={styles.messageInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Add a note to the recipient..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                testID="pdf-message-input"
              />

              <View style={{ height: 20 }} />
            </ScrollView>

            <View style={styles.footer}>
              {recipient.trim() ? (
                <TouchableOpacity
                  style={styles.emailBtn}
                  onPress={() => handleSend('email')}
                  activeOpacity={0.85}
                  testID="pdf-send-email-btn"
                >
                  <Mail size={16} color={'#FFFFFF'} strokeWidth={1.75} />
                  <Text style={styles.emailBtnText}>Send via Email</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.shareBtn, !recipient.trim() && styles.shareBtnFull]}
                onPress={() => handleSend('share')}
                activeOpacity={0.85}
                testID="pdf-share-btn"
              >
                <Send size={16} color={recipient.trim() ? themeColors.accent : '#FFFFFF'} strokeWidth={1.75} />
                <Text style={[styles.shareBtnText, !recipient.trim() && styles.shareBtnTextFull]}>
                  {recipient.trim() ? 'Share Sheet' : 'Generate & Share'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {contacts && contacts.length > 0 && (
        <ContactPickerModal
          visible={showContactPicker}
          onClose={() => setShowContactPicker(false)}
          contacts={contacts}
          title="Select Recipient"
          onSelect={(contact) => {
            const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
            setRecipient(contact.email);
            setRecipientName(name);
            setShowContactPicker(false);
          }}
        />
      )}
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  overlayTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.surfaceAlt,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  headerTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  headerSubtitle: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 16,
  },
  fieldLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 14,
  },
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: t.line,
  },
  fileNameInput: {
    flex: 1,
    height: 48,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    fontWeight: '500' as const,
  },
  pdfExt: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    fontWeight: '600' as const,
  },
  sectionsToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  sectionsToggleText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    fontWeight: '500' as const,
  },
  sectionsList: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    marginTop: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: t.line,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  sectionLabel: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    fontWeight: '500' as const,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: t.line,
  },
  recipientInput: {
    flex: 1,
    height: 48,
    fontSize: Type.subhead.fontSize,
    color: t.text,
  },
  selectedRecipient: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.accent + '10',
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: t.accent + '25',
  },
  selectedRecipientInfo: {
    flex: 1,
    gap: 1,
  },
  selectedRecipientName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  selectedRecipientEmail: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
  },
  clearRecipientBtn: {
    width: 24,
    height: 24,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '10',
  },
  pickContactText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  messageInput: {
    minHeight: 80,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingTop: 12,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    borderWidth: 1,
    borderColor: t.line,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 22,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: t.line,
  },
  emailBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
  },
  emailBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: t.accent + '12',
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
  },
  shareBtnFull: {
    flex: 1,
    backgroundColor: t.accentFill,
  },
  shareBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },
  shareBtnTextFull: {
    color: '#FFFFFF',
  },
});

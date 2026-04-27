import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Trash2, X, FileText, Send, Search, Percent, BookUser, User,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import ContactPickerModal from '@/components/ContactPickerModal';
import { getLivePrices, getRegionMultiplier, CATEGORY_META, type MaterialItem } from '@/constants/materials';
import { sendEmail, buildChangeOrderEmailHtml } from '@/utils/emailService';
import AIChangeOrderImpact from '@/components/AIChangeOrderImpact';
import { nailIt } from '@/components/animations/NailItToast';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import type { ChangeOrderLineItem, ChangeOrder } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChangeOrderScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('change_orders_invoicing')) {
    return (
      <Paywall
        visible={true}
        feature="Change Orders"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <ChangeOrderInner />;
}

function ChangeOrderInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, coId } = useLocalSearchParams<{ projectId: string; coId?: string }>();
  const {
    getProject, getChangeOrdersForProject, addChangeOrder, updateChangeOrder, contacts,
  } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingCOs = useMemo(() => getChangeOrdersForProject(projectId ?? ''), [projectId, getChangeOrdersForProject]);
  const existingCO = useMemo(() => coId ? existingCOs.find(c => c.id === coId) : null, [coId, existingCOs]);

  const originalContractValue = useMemo(() => {
    if (!project) return 0;
    const linked = project.linkedEstimate;
    const legacy = project.estimate;
    let base = linked?.grandTotal ?? legacy?.grandTotal ?? 0;
    const approvedCOs = existingCOs.filter(c => c.status === 'approved' && c.id !== coId);
    approvedCOs.forEach(c => { base += c.changeAmount; });
    return base;
  }, [project, existingCOs, coId]);

  const nextCoNumber = useMemo(() => {
    if (existingCO) return existingCO.number;
    return existingCOs.length + 1;
  }, [existingCOs, existingCO]);

  const [description, setDescription] = useState(existingCO?.description ?? '');
  const [reason, setReason] = useState(existingCO?.reason ?? '');
  const [scheduleImpactDays, setScheduleImpactDays] = useState<string>(
    existingCO?.scheduleImpactDays ? String(existingCO.scheduleImpactDays) : ''
  );
  const [lineItems, setLineItems] = useState<ChangeOrderLineItem[]>(
    existingCO?.lineItems ?? []
  );
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [showEstimateItems, setShowEstimateItems] = useState(false);
  const [showMaterialSearch, setShowMaterialSearch] = useState(false);
  const [materialQuery, setMaterialQuery] = useState('');
  const [selectedPriceType, setSelectedPriceType] = useState<'retail' | 'bulk'>('bulk');
  const [itemMarkup, setItemMarkup] = useState('0');
  const [overridePrice, setOverridePrice] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);

  const { settings } = useProjects();
  const locationMultiplier = useMemo(() => getRegionMultiplier(settings.location), [settings.location]);
  const allMaterials = useMemo(() => getLivePrices(Date.now() / 10000, locationMultiplier), [locationMultiplier]);

  const filteredMaterials = useMemo(() => {
    if (!materialQuery.trim()) return allMaterials.slice(0, 30);
    const q = materialQuery.toLowerCase();
    return allMaterials.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.supplier.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [allMaterials, materialQuery]);

  const changeAmount = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + item.total, 0);
  }, [lineItems]);

  const newContractTotal = useMemo(() => {
    return originalContractValue + changeAmount;
  }, [originalContractValue, changeAmount]);

  const estimateItems = useMemo(() => {
    if (!project) return [];
    const linked = project.linkedEstimate;
    if (linked && linked.items.length > 0) {
      return linked.items.map(item => ({
        name: item.name,
        unit: item.unit,
        unitPrice: item.usesBulk ? item.bulkPrice : item.unitPrice,
        category: item.category,
      }));
    }
    const legacy = project.estimate;
    if (legacy) {
      return legacy.materials.map(item => ({
        name: item.name,
        unit: item.unit,
        unitPrice: item.unitPrice,
        category: item.category,
      }));
    }
    return [];
  }, [project]);

  const handleAddNewItem = useCallback(() => {
    const name = newItemName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter an item name.');
      return;
    }
    const qty = parseFloat(newItemQty) || 0;
    const price = parseFloat(newItemPrice) || 0;
    const markup = parseFloat(itemMarkup) || 0;
    const finalPrice = price * (1 + markup / 100);
    const item: ChangeOrderLineItem = {
      id: createId('coli'),
      name,
      description: newItemDesc.trim() + (overridePrice && overrideReason.trim() ? ` (${overrideReason.trim()})` : ''),
      quantity: qty,
      unit: newItemUnit.trim() || 'ea',
      unitPrice: finalPrice,
      total: qty * finalPrice,
      isNew: true,
    };
    setLineItems(prev => [...prev, item]);
    setNewItemName('');
    setNewItemQty('');
    setNewItemUnit('');
    setNewItemPrice('');
    setNewItemDesc('');
    setItemMarkup('0');
    setOverridePrice(false);
    setOverrideReason('');
    setShowAddItem(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [newItemName, newItemQty, newItemUnit, newItemPrice, newItemDesc, itemMarkup, overridePrice, overrideReason]);

  const handleAddFromMaterials = useCallback((material: MaterialItem) => {
    const price = selectedPriceType === 'bulk' ? material.baseBulkPrice : material.baseRetailPrice;
    const markup = parseFloat(itemMarkup) || 0;
    const finalPrice = price * (1 + markup / 100);
    const originalEstPrice = estimateItems.find(e => e.name === material.name)?.unitPrice;
    const desc = originalEstPrice ? `Original estimate: ${originalEstPrice.toFixed(2)}/${material.unit}` : '';
    const item: ChangeOrderLineItem = {
      id: createId('coli'),
      name: material.name,
      description: desc,
      quantity: 1,
      unit: material.unit,
      unitPrice: finalPrice,
      total: finalPrice,
      isNew: true,
    };
    setLineItems(prev => [...prev, item]);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [selectedPriceType, itemMarkup, estimateItems]);

  const handleAddFromEstimate = useCallback((item: { name: string; unit: string; unitPrice: number }) => {
    const newItem: ChangeOrderLineItem = {
      id: createId('coli'),
      name: item.name,
      description: '',
      quantity: 1,
      unit: item.unit,
      unitPrice: item.unitPrice,
      total: item.unitPrice,
      isNew: false,
    };
    setLineItems(prev => [...prev, newItem]);
    setShowEstimateItems(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleRemoveItem = useCallback((id: string) => {
    setLineItems(prev => prev.filter(item => item.id !== id));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleUpdateItemQty = useCallback((id: string, qtyStr: string) => {
    const qty = parseFloat(qtyStr) || 0;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, quantity: qty, total: qty * item.unitPrice } : item
    ));
  }, []);

  const handleUpdateItemPrice = useCallback((id: string, priceStr: string) => {
    const price = parseFloat(priceStr) || 0;
    setLineItems(prev => prev.map(item =>
      item.id === id ? { ...item, unitPrice: price, total: item.quantity * price } : item
    ));
  }, []);

  const handleSave = useCallback((status: 'draft' | 'submitted', recipientName?: string, recipientEmail?: string) => {
    if (!projectId) return;
    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please enter a description for this change order.');
      return;
    }
    if (lineItems.length === 0) {
      Alert.alert('No Items', 'Please add at least one line item.');
      return;
    }

    const now = new Date().toISOString();
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    const parsedImpactDays = parseInt(scheduleImpactDays, 10);
    const impactDays = Number.isFinite(parsedImpactDays) && parsedImpactDays > 0 ? parsedImpactDays : undefined;

    if (existingCO) {
      updateChangeOrder(existingCO.id, {
        description: description.trim(),
        reason: reason.trim(),
        lineItems,
        originalContractValue,
        changeAmount,
        newContractTotal,
        status,
        scheduleImpactDays: impactDays,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Updated', `Change Order #${existingCO.number} has been ${status === 'submitted' ? `submitted for approval${recipientInfo}` : 'saved to project'}.`);
    } else {
      const co: ChangeOrder = {
        id: createId('co'),
        number: nextCoNumber,
        projectId,
        date: now,
        description: description.trim(),
        reason: reason.trim(),
        lineItems,
        originalContractValue,
        changeAmount,
        newContractTotal,
        status,
        createdAt: now,
        updatedAt: now,
        scheduleImpactDays: impactDays,
      };
      addChangeOrder(co);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt(status === 'submitted' ? `CO #${nextCoNumber} submitted${recipientInfo}` : `CO #${nextCoNumber} saved`);
    }

    router.back();
  }, [projectId, description, reason, scheduleImpactDays, lineItems, originalContractValue, changeAmount, newContractTotal, existingCO, nextCoNumber, addChangeOrder, updateChangeOrder, router]);

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
      const html = buildChangeOrderEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        coNumber: existingCO?.number ?? nextCoNumber,
        description: description.trim(),
        changeAmount,
        newContractTotal,
        contactName: branding.contactName,
        contactEmail: branding.email,
      });

      const result = await sendEmail({
        to: sendRecipientEmail.trim(),
        subject: `${branding.companyName || 'MAGE ID'} - Change Order #${existingCO?.number ?? nextCoNumber} - ${project?.name ?? 'Project'}`,
        html,
        replyTo: branding.email || undefined,
      });

      if (!result.success) {
        if (result.error === 'cancelled') {
          return;
        }
        console.warn('[ChangeOrder] Email send failed:', result.error);
        Alert.alert('Email Notice', `Change order saved but email could not be sent: ${result.error}`);
        return;
      } else {
        console.log('[ChangeOrder] Email sent successfully');
      }
    }

    handleSave('submitted', sendRecipientName, sendRecipientEmail);
  }, [handleSave, sendRecipientName, sendRecipientEmail, settings, project, existingCO, nextCoNumber, description, changeAmount, newContractTotal]);

  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Change Order' }} />
        <Text style={styles.notFoundText}>Project not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isLocked = existingCO?.status === 'approved' || existingCO?.status === 'rejected' || existingCO?.status === 'void';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: existingCO ? `CO #${existingCO.number}` : `New Change Order`,
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
          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Change Order #{nextCoNumber}</Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            {existingCO && (
              <View style={[styles.statusBadge, statusColors[existingCO.status]]}>
                <Text style={[styles.statusText, { color: statusTextColors[existingCO.status] }]}>
                  {existingCO.status.charAt(0).toUpperCase() + existingCO.status.slice(1)}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.totalsCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Original Contract</Text>
              <Text style={styles.totalValue}>${originalContractValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: changeAmount >= 0 ? Colors.accent : Colors.success }]}>
                This CO Amount
              </Text>
              <Text style={[styles.totalValueBold, { color: changeAmount >= 0 ? Colors.accent : Colors.success }]}>
                {changeAmount >= 0 ? '+' : ''}{formatCurrency(changeAmount)}
              </Text>
            </View>
            <View style={styles.dividerThick} />
            <View style={styles.totalRow}>
              <Text style={styles.grandLabel}>New Contract Total</Text>
              <TapeRollNumber
                value={newContractTotal}
                formatter={formatCurrency}
                duration={550}
                style={styles.grandValue}
              />
            </View>
          </View>

          {!isLocked && (
            <>
              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={styles.textArea}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Describe the change..."
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  testID="co-description-input"
                />
              </View>

              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Reason</Text>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Why is this change needed?"
                  placeholderTextColor={Colors.textMuted}
                  testID="co-reason-input"
                />
              </View>

              <View style={styles.fieldSection}>
                <Text style={styles.fieldLabel}>Schedule Impact (days)</Text>
                <TextInput
                  style={styles.input}
                  value={scheduleImpactDays}
                  onChangeText={setScheduleImpactDays}
                  placeholder="Additional days added to project (0 if none)"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  testID="co-schedule-impact-input"
                />
                <Text style={styles.helperText}>When approved, these days extend the project schedule automatically.</Text>
              </View>

              <View style={{ paddingHorizontal: 16 }}>
                <AIChangeOrderImpact
                  changeDescription={description}
                  lineItems={lineItems.map(i => ({ name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, total: i.total }))}
                  schedule={project?.schedule ?? null}
                />
              </View>
            </>
          )}

          {isLocked && (
            <View style={styles.fieldSection}>
              <View style={styles.lockedCard}>
                <Text style={styles.lockedTitle}>{existingCO?.description}</Text>
                {existingCO?.reason ? <Text style={styles.lockedSub}>Reason: {existingCO.reason}</Text> : null}
                {existingCO?.scheduleImpactDays ? (
                  <Text style={styles.lockedSub}>
                    Schedule Impact: +{existingCO.scheduleImpactDays} day{existingCO.scheduleImpactDays === 1 ? '' : 's'}
                    {existingCO.scheduleImpactApplied ? ' (applied to schedule)' : ''}
                  </Text>
                ) : null}
              </View>
            </View>
          )}

          <View style={styles.fieldSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.fieldLabel}>Line Items</Text>
              {!isLocked && (
                <View style={styles.addBtnRow}>
                  <TouchableOpacity
                    style={styles.addSearchBtn}
                    onPress={() => { setMaterialQuery(''); setShowMaterialSearch(true); }}
                    activeOpacity={0.7}
                    testID="search-materials-btn"
                  >
                    <Search size={14} color={Colors.success} />
                    <Text style={styles.addSearchBtnText}>Materials</Text>
                  </TouchableOpacity>
                  {estimateItems.length > 0 && (
                    <TouchableOpacity
                      style={styles.addFromBtn}
                      onPress={() => setShowEstimateItems(true)}
                      activeOpacity={0.7}
                    >
                      <FileText size={14} color={Colors.info} />
                      <Text style={styles.addFromBtnText}>Estimate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.addNewBtn}
                    onPress={() => setShowAddItem(true)}
                    activeOpacity={0.7}
                    testID="add-co-item-btn"
                  >
                    <Plus size={14} color={Colors.primary} />
                    <Text style={styles.addNewBtnText}>Custom</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {lineItems.length === 0 && (
              <View style={styles.emptyItems}>
                <Text style={styles.emptyItemsText}>No line items yet. Add items to define this change order.</Text>
              </View>
            )}

            {lineItems.map((item) => (
              <View key={item.id} style={styles.lineItemCard}>
                <View style={styles.lineItemHeader}>
                  <View style={styles.lineItemNameRow}>
                    {item.isNew && <View style={styles.newBadge}><Text style={styles.newBadgeText}>NEW</Text></View>}
                    <Text style={styles.lineItemName} numberOfLines={1}>{item.name}</Text>
                  </View>
                  {!isLocked && (
                    <TouchableOpacity onPress={() => handleRemoveItem(item.id)} activeOpacity={0.7}>
                      <Trash2 size={16} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
                {!isLocked ? (
                  <View style={styles.lineItemFields}>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Qty</Text>
                      <TextInput
                        style={styles.lineItemInput}
                        value={item.quantity.toString()}
                        onChangeText={(v) => handleUpdateItemQty(item.id, v)}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Unit</Text>
                      <Text style={styles.lineItemUnitText}>{item.unit}</Text>
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Price</Text>
                      <TextInput
                        style={styles.lineItemInput}
                        value={item.unitPrice.toString()}
                        onChangeText={(v) => handleUpdateItemPrice(item.id, v)}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.lineItemFieldSmall}>
                      <Text style={styles.lineItemFieldLabel}>Total</Text>
                      <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.lineItemFields}>
                    <Text style={styles.lockedFieldText}>{item.quantity} {item.unit} × {formatCurrency(item.unitPrice)}</Text>
                    <Text style={styles.lineItemTotal}>{formatCurrency(item.total)}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        {!isLocked && (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
            <TouchableOpacity
              style={styles.saveProjectBtn}
              onPress={() => handleSave('draft')}
              activeOpacity={0.7}
              testID="save-co-draft"
            >
              <Text style={styles.saveProjectBtnText}>Save to Project</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={handleSendPress}
              activeOpacity={0.7}
              testID="send-co-btn"
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
                <Text style={styles.modalTitle}>Send for Approval To</Text>
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
                  <Text style={styles.modalFieldLabel}>Approver Name</Text>
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
        title="Select Approver"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      <Modal visible={showAddItem} transparent animationType="slide" onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add New Item</Text>
                <TouchableOpacity onPress={() => setShowAddItem(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Item Name</Text>
              <TextInput style={styles.modalInput} value={newItemName} onChangeText={setNewItemName} placeholder="Item name" placeholderTextColor={Colors.textMuted} />
              <Text style={styles.modalFieldLabel}>Description</Text>
              <TextInput style={styles.modalInput} value={newItemDesc} onChangeText={setNewItemDesc} placeholder="Optional description" placeholderTextColor={Colors.textMuted} />
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Quantity</Text>
                  <TextInput style={styles.modalInput} value={newItemQty} onChangeText={setNewItemQty} placeholder="0" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Unit</Text>
                  <TextInput style={styles.modalInput} value={newItemUnit} onChangeText={setNewItemUnit} placeholder="ea, sq ft..." placeholderTextColor={Colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Unit Price</Text>
                  <TextInput style={styles.modalInput} value={newItemPrice} onChangeText={setNewItemPrice} placeholder="0.00" placeholderTextColor={Colors.textMuted} keyboardType="numeric" />
                </View>
              </View>
              <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddNewItem} activeOpacity={0.85}>
                <Text style={styles.modalAddBtnText}>Add Item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEstimateItems} transparent animationType="slide" onRequestClose={() => setShowEstimateItems(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '70%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add from Estimate</Text>
              <TouchableOpacity onPress={() => setShowEstimateItems(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {estimateItems.map((item, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.estimateItemRow}
                  onPress={() => handleAddFromEstimate(item)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.estimateItemName}>{item.name}</Text>
                    <Text style={styles.estimateItemMeta}>{item.category} · {formatCurrency(item.unitPrice)}/{item.unit}</Text>
                  </View>
                  <Plus size={18} color={Colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showMaterialSearch} transparent animationType="slide" onRequestClose={() => setShowMaterialSearch(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Search Materials</Text>
              <TouchableOpacity onPress={() => setShowMaterialSearch(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>

            <View style={styles.matSearchBar}>
              <Search size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.matSearchInput}
                value={materialQuery}
                onChangeText={setMaterialQuery}
                placeholder="Search lumber, concrete, HVAC..."
                placeholderTextColor={Colors.textMuted}
                autoFocus
                testID="co-material-search"
              />
              {materialQuery.length > 0 && (
                <TouchableOpacity onPress={() => setMaterialQuery('')}>
                  <X size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.priceTypeRow}>
              <TouchableOpacity
                style={[styles.priceTypeChip, selectedPriceType === 'retail' && styles.priceTypeChipActive]}
                onPress={() => setSelectedPriceType('retail')}
              >
                <Text style={[styles.priceTypeText, selectedPriceType === 'retail' && styles.priceTypeTextActive]}>Retail</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.priceTypeChip, selectedPriceType === 'bulk' && styles.priceTypeChipActive]}
                onPress={() => setSelectedPriceType('bulk')}
              >
                <Text style={[styles.priceTypeText, selectedPriceType === 'bulk' && styles.priceTypeTextActive]}>Bulk</Text>
              </TouchableOpacity>
              <View style={styles.matMarkupRow}>
                <Percent size={12} color={Colors.accent} />
                <TextInput
                  style={styles.matMarkupInput}
                  value={itemMarkup}
                  onChangeText={setItemMarkup}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.matMarkupLabel}>markup</Text>
              </View>
            </View>

            <Text style={styles.matResultCount}>{filteredMaterials.length} results</Text>

            <FlatList
              data={filteredMaterials}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: material }) => {
                const price = selectedPriceType === 'bulk' ? material.baseBulkPrice : material.baseRetailPrice;
                const markup = parseFloat(itemMarkup) || 0;
                const finalPrice = price * (1 + markup / 100);
                const catLabel = CATEGORY_META[material.category]?.label ?? material.category;
                const origEst = estimateItems.find(e => e.name === material.name);
                return (
                  <TouchableOpacity
                    style={styles.matResultRow}
                    onPress={() => handleAddFromMaterials(material)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.matResultName} numberOfLines={1}>{material.name}</Text>
                      <View style={styles.matResultMeta}>
                        <Text style={styles.matResultCat}>{catLabel}</Text>
                        <Text style={styles.matResultSupplier}>{material.supplier}</Text>
                      </View>
                      {origEst && (
                        <Text style={styles.matOriginalPrice}>Original estimate: {formatCurrency(origEst.unitPrice)}/{origEst.unit}</Text>
                      )}
                    </View>
                    <View style={styles.matResultPrices}>
                      <Text style={styles.matResultRetail}>${material.baseRetailPrice.toFixed(2)}</Text>
                      <Text style={styles.matResultBulk}>${material.baseBulkPrice.toFixed(2)}</Text>
                      {markup > 0 && <Text style={styles.matResultFinal}>${finalPrice.toFixed(2)}</Text>}
                    </View>
                    <Plus size={18} color={Colors.primary} />
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const statusColors: Record<string, { backgroundColor: string }> = {
  draft: { backgroundColor: Colors.fillTertiary },
  submitted: { backgroundColor: Colors.infoLight },
  under_review: { backgroundColor: Colors.warningLight },
  sent: { backgroundColor: Colors.infoLight },
  approved: { backgroundColor: Colors.successLight },
  rejected: { backgroundColor: Colors.errorLight },
  revised: { backgroundColor: Colors.warningLight },
  void: { backgroundColor: Colors.fillTertiary },
};

const statusTextColors: Record<string, string> = {
  draft: Colors.textSecondary,
  submitted: Colors.info,
  under_review: Colors.warning,
  sent: Colors.info,
  approved: Colors.success,
  rejected: Colors.error,
  revised: Colors.warning,
  void: Colors.textMuted,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 18, color: Colors.textSecondary, marginBottom: 16 },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  backBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '600' as const },
  heroCard: { backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 16, borderRadius: 16, padding: 20, gap: 4 },
  heroLabel: { fontSize: 13, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: 20, fontWeight: '700' as const, color: Colors.textOnPrimary },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: '700' as const },
  totalsCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: Colors.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: Colors.cardBorder },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  totalLabel: { fontSize: 15, color: Colors.textSecondary, fontWeight: '500' as const },
  totalValue: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  totalValueBold: { fontSize: 17, fontWeight: '700' as const },
  divider: { height: 1, backgroundColor: Colors.borderLight, marginVertical: 4 },
  dividerThick: { height: 2, backgroundColor: Colors.primary + '30', borderRadius: 1, marginVertical: 6 },
  grandLabel: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  grandValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  fieldSection: { marginHorizontal: 20, marginTop: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  helperText: { fontSize: 11, color: Colors.textMuted, marginTop: 6, fontStyle: 'italic' as const },
  input: { minHeight: 48, borderRadius: 14, backgroundColor: Colors.card, paddingHorizontal: 14, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  textArea: { minHeight: 90, borderRadius: 14, backgroundColor: Colors.card, paddingHorizontal: 14, paddingTop: 12, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addBtnRow: { flexDirection: 'row', gap: 8 },
  addFromBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.infoLight },
  addFromBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.info },
  addNewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primary + '15' },
  addNewBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  emptyItems: { backgroundColor: Colors.card, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder },
  emptyItemsText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const },
  lineItemCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.cardBorder },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  lineItemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  newBadge: { backgroundColor: Colors.accent + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  newBadgeText: { fontSize: 9, fontWeight: '700' as const, color: Colors.accent },
  lineItemName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, flex: 1 },
  lineItemFields: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineItemFieldSmall: { flex: 1, gap: 2 },
  lineItemFieldLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  lineItemInput: { minHeight: 36, borderRadius: 8, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 8, fontSize: 14, color: Colors.text },
  lineItemUnitText: { fontSize: 14, color: Colors.textSecondary, paddingVertical: 8 },
  lineItemTotal: { fontSize: 15, fontWeight: '700' as const, color: Colors.primary },
  lockedCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder, gap: 4 },
  lockedTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  lockedSub: { fontSize: 13, color: Colors.textSecondary },
  lockedFieldText: { flex: 1, fontSize: 14, color: Colors.textSecondary },
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
  estimateItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 12 },
  estimateItemName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  estimateItemMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addSearchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.successLight },
  addSearchBtnText: { fontSize: 12, fontWeight: '600' as const, color: Colors.success },
  matSearchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 44, borderWidth: 1, borderColor: Colors.cardBorder },
  matSearchInput: { flex: 1, fontSize: 15, color: Colors.text },
  priceTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  priceTypeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.fillTertiary },
  priceTypeChipActive: { backgroundColor: Colors.primary },
  priceTypeText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  priceTypeTextActive: { color: Colors.textOnPrimary },
  matMarkupRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' as const, backgroundColor: Colors.fillTertiary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  matMarkupInput: { width: 36, fontSize: 14, fontWeight: '600' as const, color: Colors.text, textAlign: 'center' as const },
  matMarkupLabel: { fontSize: 11, color: Colors.textMuted },
  matResultCount: { fontSize: 11, color: Colors.textMuted, marginTop: 6, marginBottom: 4 },
  matResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 10 },
  matResultName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  matResultMeta: { flexDirection: 'row', gap: 8, marginTop: 2 },
  matResultCat: { fontSize: 11, color: Colors.info, fontWeight: '500' as const },
  matResultSupplier: { fontSize: 11, color: Colors.textMuted },
  matOriginalPrice: { fontSize: 10, color: Colors.warning, fontWeight: '500' as const, marginTop: 2 },
  matResultPrices: { alignItems: 'flex-end', gap: 1 },
  matResultRetail: { fontSize: 11, color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  matResultBulk: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  matResultFinal: { fontSize: 10, color: Colors.accent, fontWeight: '600' as const },
});

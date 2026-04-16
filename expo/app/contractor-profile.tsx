import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Modal, Image, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera, X, Plus, Trash2, ChevronDown, Check, MapPin, Briefcase,
  Award, Building2, Globe, Phone, Mail, Eye, Shield, User,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProfile } from '@/contexts/ProfileContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { TRADE_CATEGORIES, getTradeLabel } from '@/constants/trades';
import { US_STATES } from '@/constants/states';
import { PROFILE_SKILLS, EMPLOYEE_RANGES, REVENUE_RANGES, BUSINESS_CERTIFICATIONS } from '@/constants/profileSkills';
import { generateUUID } from '@/utils/generateId';
import type { ContractorProfile, ProfileLicense, ProfileExperience, ProfileAvailability } from '@/types';

const AVAILABILITY_OPTIONS: { value: ProfileAvailability; label: string; color: string }[] = [
  { value: 'available', label: 'Available for work', color: '#34C759' },
  { value: 'busy', label: 'Busy', color: '#FF9500' },
  { value: 'not_taking_work', label: 'Not taking work', color: '#FF3B30' },
];

const VISIBILITY_OPTIONS = [
  { value: 'public' as const, label: 'Public' },
  { value: 'connections_only' as const, label: 'Connections Only' },
  { value: 'hidden' as const, label: 'Hidden' },
];

export default function ContractorProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { myProfile, saveProfile, createProfile, isSaving } = useProfile();
  const { user } = useAuth();
  const { settings } = useProjects();

  const initial = useMemo(() => {
    if (myProfile) return myProfile;
    return createProfile({
      name: user?.name ?? settings.branding?.contactName ?? '',
      companyName: settings.branding?.companyName ?? '',
      contactEmail: user?.email ?? settings.branding?.email ?? '',
      phone: settings.branding?.phone ?? '',
      city: '',
      state: '',
    });
  }, [myProfile, createProfile, user, settings]);

  const [name, setName] = useState(initial.name);
  const [headline, setHeadline] = useState(initial.headline);
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [city, setCity] = useState(initial.city);
  const [state, setState] = useState(initial.state);
  const [availability, setAvailability] = useState<ProfileAvailability>(initial.availability);
  const [photoUri, setPhotoUri] = useState<string | undefined>(initial.profilePhotoUri);
  const [bio, setBio] = useState(initial.bio);
  const [skills, setSkills] = useState<string[]>(initial.skills);
  const [tradeCategory, setTradeCategory] = useState(initial.tradeCategory);
  const [yearsExp, setYearsExp] = useState(initial.yearsExperience.toString());
  const [hourlyRate, setHourlyRate] = useState(initial.hourlyRate > 0 ? initial.hourlyRate.toString() : '');
  const [licenses, setLicenses] = useState<ProfileLicense[]>(initial.licenses);
  const [experience, setExperience] = useState<ProfileExperience[]>(initial.experience);
  const [yearFounded, setYearFounded] = useState(initial.yearFounded?.toString() ?? '');
  const [employeeRange, setEmployeeRange] = useState(initial.employeeRange ?? '');
  const [revenueRange, setRevenueRange] = useState(initial.revenueRange ?? '');
  const [bondCapacity, setBondCapacity] = useState(initial.bondCapacity?.toString() ?? '');
  const [insuranceCoverage, setInsuranceCoverage] = useState(initial.insuranceCoverage ?? '');
  const [serviceArea, setServiceArea] = useState(initial.serviceArea ?? '');
  const [website, setWebsite] = useState(initial.website ?? '');
  const [businessCerts, setBusinessCerts] = useState<string[]>(initial.businessCertifications);
  const [contactEmail, setContactEmail] = useState(initial.contactEmail);
  const [phone, setPhone] = useState(initial.phone);
  const [contactVisibility, setContactVisibility] = useState(initial.contactVisibility);

  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [showTradePicker, setShowTradePicker] = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);

  const handlePickPhoto = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.base64) {
          const mimeType = asset.mimeType ?? 'image/jpeg';
          setPhotoUri(`data:${mimeType};base64,${asset.base64}`);
        } else if (asset.uri) {
          setPhotoUri(asset.uri);
        }
      }
    } catch (e) {
      console.log('[ContractorProfile] Photo pick error:', e);
      Alert.alert('Error', 'Failed to pick image.');
    }
  }, []);

  const toggleSkill = useCallback((skill: string) => {
    setSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const toggleCert = useCallback((cert: string) => {
    setBusinessCerts(prev => prev.includes(cert) ? prev.filter(c => c !== cert) : [...prev, cert]);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const addLicense = useCallback(() => {
    setLicenses(prev => [...prev, { id: generateUUID(), name: '' }]);
  }, []);

  const updateLicense = useCallback((id: string, changes: Partial<ProfileLicense>) => {
    setLicenses(prev => prev.map(l => l.id === id ? { ...l, ...changes } : l));
  }, []);

  const removeLicense = useCallback((id: string) => {
    setLicenses(prev => prev.filter(l => l.id !== id));
  }, []);

  const addExperience = useCallback(() => {
    setExperience(prev => [...prev, {
      id: generateUUID(), companyName: '', title: '', startDate: '',
      isCurrent: false, city: '', state: '', description: '',
    }]);
  }, []);

  const updateExperience = useCallback((id: string, changes: Partial<ProfileExperience>) => {
    setExperience(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e));
  }, []);

  const removeExperience = useCallback((id: string) => {
    setExperience(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name.');
      return;
    }
    if (!tradeCategory) {
      Alert.alert('Required', 'Please select a primary trade.');
      return;
    }

    const profile: ContractorProfile = {
      ...initial,
      name: name.trim(),
      headline: headline.trim(),
      companyName: companyName.trim(),
      city: city.trim(),
      state,
      availability,
      profilePhotoUri: photoUri,
      bio: bio.trim(),
      skills,
      tradeCategory,
      yearsExperience: parseInt(yearsExp, 10) || 0,
      hourlyRate: parseFloat(hourlyRate) || 0,
      licenses: licenses.filter(l => l.name.trim()),
      experience: experience.filter(e => e.companyName.trim()),
      portfolio: initial.portfolio,
      yearFounded: parseInt(yearFounded, 10) || undefined,
      employeeRange: employeeRange || undefined,
      revenueRange: revenueRange || undefined,
      bondCapacity: parseFloat(bondCapacity) || undefined,
      insuranceCoverage: insuranceCoverage.trim() || undefined,
      serviceArea: serviceArea.trim() || undefined,
      website: website.trim() || undefined,
      businessCertifications: businessCerts,
      contactEmail: contactEmail.trim(),
      phone: phone.trim(),
      contactVisibility,
      updatedAt: new Date().toISOString(),
    };

    saveProfile(profile);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Profile Saved', 'Your professional profile has been updated.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }, [initial, name, headline, companyName, city, state, availability, photoUri, bio, skills, tradeCategory, yearsExp, hourlyRate, licenses, experience, yearFounded, employeeRange, revenueRange, bondCapacity, insuranceCoverage, serviceArea, website, businessCerts, contactEmail, phone, contactVisibility, saveProfile, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: myProfile ? 'Edit Profile' : 'Create Profile',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <View style={styles.photoSection}>
            <TouchableOpacity onPress={handlePickPhoto} style={styles.photoWrapper} activeOpacity={0.8}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photo} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Camera size={28} color={Colors.textMuted} />
                </View>
              )}
              <View style={styles.photoBadge}>
                <Camera size={12} color="#FFF" />
              </View>
            </TouchableOpacity>
            <Text style={styles.photoHint}>Tap to add profile photo</Text>
          </View>

          <Text style={styles.sectionHeader}>BASIC INFO</Text>
          <View style={styles.group}>
            <InputRow label="Full Name *" value={name} onChangeText={setName} placeholder="John Smith" />
            <View style={styles.sep} />
            <InputRow label="Headline" value={headline} onChangeText={setHeadline} placeholder="Licensed GC | 15 Years Commercial" maxLength={120} />
            <View style={styles.sep} />
            <InputRow label="Company" value={companyName} onChangeText={setCompanyName} placeholder="Smith Building Co." />
            <View style={styles.sep} />
            <TouchableOpacity style={styles.row} onPress={() => setShowTradePicker(true)} activeOpacity={0.7}>
              <Text style={styles.rowLabel}>Primary Trade *</Text>
              <View style={styles.rowRight}>
                <Text style={styles.rowValue}>{getTradeLabel(tradeCategory)}</Text>
                <ChevronDown size={14} color={Colors.textMuted} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
            <View style={styles.twoCol}>
              <View style={styles.halfCol}>
                <Text style={styles.fieldLabel}>City</Text>
                <TextInput style={styles.fieldInput} value={city} onChangeText={setCity} placeholder="Brooklyn" placeholderTextColor={Colors.textMuted} />
              </View>
              <View style={styles.halfCol}>
                <Text style={styles.fieldLabel}>State</Text>
                <TouchableOpacity style={styles.fieldPicker} onPress={() => setShowStatePicker(true)}>
                  <Text style={[styles.fieldPickerText, !state && { color: Colors.textMuted }]}>{state || 'Select'}</Text>
                  <ChevronDown size={12} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.sep} />
            <View style={styles.twoCol}>
              <View style={styles.halfCol}>
                <Text style={styles.fieldLabel}>Years Exp.</Text>
                <TextInput style={styles.fieldInput} value={yearsExp} onChangeText={setYearsExp} keyboardType="number-pad" placeholder="15" placeholderTextColor={Colors.textMuted} />
              </View>
              <View style={styles.halfCol}>
                <Text style={styles.fieldLabel}>Hourly Rate</Text>
                <TextInput style={styles.fieldInput} value={hourlyRate} onChangeText={setHourlyRate} keyboardType="decimal-pad" placeholder="$85" placeholderTextColor={Colors.textMuted} />
              </View>
            </View>
          </View>

          <Text style={styles.sectionHeader}>AVAILABILITY</Text>
          <View style={styles.group}>
            {AVAILABILITY_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.row, availability === opt.value && { backgroundColor: opt.color + '08' }]}
                onPress={() => { setAvailability(opt.value); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
                activeOpacity={0.7}
              >
                <View style={[styles.availDot, { backgroundColor: opt.color }]} />
                <Text style={[styles.rowLabel, { flex: 1 }]}>{opt.label}</Text>
                {availability === opt.value && <Check size={18} color={opt.color} />}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionHeader}>ABOUT</Text>
          <View style={styles.group}>
            <TextInput
              style={styles.bioInput}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell others about yourself, your experience, and what makes you stand out..."
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={1000}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{bio.length}/1000</Text>
          </View>

          <Text style={styles.sectionHeader}>SKILLS & TRADES</Text>
          <View style={styles.group}>
            <View style={styles.skillsGrid}>
              {skills.map(s => (
                <TouchableOpacity key={s} style={styles.skillTag} onPress={() => toggleSkill(s)} activeOpacity={0.7}>
                  <Text style={styles.skillTagText}>{s}</Text>
                  <X size={12} color={Colors.primary} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.addSkillBtn} onPress={() => setShowSkillPicker(true)} activeOpacity={0.7}>
                <Plus size={14} color={Colors.primary} />
                <Text style={styles.addSkillText}>Add Skill</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionHeader}>LICENSES & CERTIFICATIONS</Text>
          <View style={styles.group}>
            {licenses.map((lic) => (
              <View key={lic.id} style={styles.licenseCard}>
                <View style={styles.licenseHeader}>
                  <Award size={16} color={Colors.primary} />
                  <TextInput
                    style={[styles.licenseInput, { flex: 1 }]}
                    value={lic.name}
                    onChangeText={(v) => updateLicense(lic.id, { name: v })}
                    placeholder="License / Certification name"
                    placeholderTextColor={Colors.textMuted}
                  />
                  <TouchableOpacity onPress={() => removeLicense(lic.id)}>
                    <Trash2 size={16} color={Colors.error} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.licenseInput}
                  value={lic.number ?? ''}
                  onChangeText={(v) => updateLicense(lic.id, { number: v })}
                  placeholder="License/Cert number (optional)"
                  placeholderTextColor={Colors.textMuted}
                />
                <TextInput
                  style={styles.licenseInput}
                  value={lic.issuingAuthority ?? ''}
                  onChangeText={(v) => updateLicense(lic.id, { issuingAuthority: v })}
                  placeholder="Issuing authority (optional)"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            ))}
            <TouchableOpacity style={styles.addBtn} onPress={addLicense} activeOpacity={0.7}>
              <Plus size={16} color={Colors.primary} />
              <Text style={styles.addBtnText}>Add License / Certification</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionHeader}>EXPERIENCE</Text>
          <View style={styles.group}>
            {experience.map((exp) => (
              <View key={exp.id} style={styles.expCard}>
                <View style={styles.expHeader}>
                  <Briefcase size={16} color={Colors.accent} />
                  <Text style={styles.expHeaderLabel}>Experience Entry</Text>
                  <TouchableOpacity onPress={() => removeExperience(exp.id)}>
                    <Trash2 size={16} color={Colors.error} />
                  </TouchableOpacity>
                </View>
                <TextInput style={styles.licenseInput} value={exp.companyName} onChangeText={(v) => updateExperience(exp.id, { companyName: v })} placeholder="Company name" placeholderTextColor={Colors.textMuted} />
                <TextInput style={styles.licenseInput} value={exp.title} onChangeText={(v) => updateExperience(exp.id, { title: v })} placeholder="Title / Role" placeholderTextColor={Colors.textMuted} />
                <View style={styles.twoCol}>
                  <TextInput style={[styles.licenseInput, { flex: 1 }]} value={exp.startDate} onChangeText={(v) => updateExperience(exp.id, { startDate: v })} placeholder="Start (e.g. 2018)" placeholderTextColor={Colors.textMuted} />
                  <TextInput style={[styles.licenseInput, { flex: 1 }]} value={exp.endDate ?? ''} onChangeText={(v) => updateExperience(exp.id, { endDate: v })} placeholder="End or Present" placeholderTextColor={Colors.textMuted} />
                </View>
                <TextInput style={[styles.licenseInput, { minHeight: 50 }]} value={exp.description} onChangeText={(v) => updateExperience(exp.id, { description: v })} placeholder="Description" placeholderTextColor={Colors.textMuted} multiline maxLength={500} textAlignVertical="top" />
              </View>
            ))}
            <TouchableOpacity style={styles.addBtn} onPress={addExperience} activeOpacity={0.7}>
              <Plus size={16} color={Colors.primary} />
              <Text style={styles.addBtnText}>Add Experience</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionHeader}>COMPANY DETAILS</Text>
          <View style={styles.group}>
            <InputRow label="Year Founded" value={yearFounded} onChangeText={setYearFounded} keyboardType="number-pad" placeholder="2018" />
            <View style={styles.sep} />
            <PickerRow label="Employees" value={employeeRange} options={EMPLOYEE_RANGES} onSelect={setEmployeeRange} />
            <View style={styles.sep} />
            <PickerRow label="Annual Revenue" value={revenueRange} options={REVENUE_RANGES} onSelect={setRevenueRange} />
            <View style={styles.sep} />
            <InputRow label="Bond Capacity" value={bondCapacity} onChangeText={setBondCapacity} keyboardType="decimal-pad" placeholder="$2,000,000" />
            <View style={styles.sep} />
            <InputRow label="Insurance" value={insuranceCoverage} onChangeText={setInsuranceCoverage} placeholder="$5M General Liability" />
            <View style={styles.sep} />
            <InputRow label="Service Area" value={serviceArea} onChangeText={setServiceArea} placeholder="NYC Metro, Long Island" />
            <View style={styles.sep} />
            <InputRow label="Website" value={website} onChangeText={setWebsite} placeholder="smithbuilding.com" autoCapitalize="none" />
          </View>

          <Text style={styles.sectionHeader}>BUSINESS CERTIFICATIONS</Text>
          <View style={styles.group}>
            <View style={styles.skillsGrid}>
              {BUSINESS_CERTIFICATIONS.map(cert => (
                <TouchableOpacity
                  key={cert}
                  style={[styles.certTag, businessCerts.includes(cert) && styles.certTagActive]}
                  onPress={() => toggleCert(cert)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.certTagText, businessCerts.includes(cert) && styles.certTagTextActive]}>{cert}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={styles.sectionHeader}>CONTACT</Text>
          <View style={styles.group}>
            <InputRow icon={Mail} label="Email" value={contactEmail} onChangeText={setContactEmail} placeholder="john@company.com" keyboardType="email-address" autoCapitalize="none" />
            <View style={styles.sep} />
            <InputRow icon={Phone} label="Phone" value={phone} onChangeText={setPhone} placeholder="(718) 555-0123" keyboardType="phone-pad" />
            <View style={styles.sep} />
            <View style={styles.row}>
              <Eye size={16} color={Colors.textSecondary} />
              <Text style={[styles.rowLabel, { flex: 1, marginLeft: 8 }]}>Visibility</Text>
              <View style={styles.visibilityRow}>
                {VISIBILITY_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.visChip, contactVisibility === opt.value && styles.visChipActive]}
                    onPress={() => { setContactVisibility(opt.value); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.visChipText, contactVisibility === opt.value && styles.visChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} disabled={isSaving} testID="save-profile">
            {isSaving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.saveBtnText}>Save Profile</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <PickerModal
        visible={showSkillPicker}
        title="Select Skills"
        options={PROFILE_SKILLS}
        selected={skills}
        onToggle={toggleSkill}
        onClose={() => setShowSkillPicker(false)}
        multi
      />
      <PickerModal
        visible={showTradePicker}
        title="Select Trade"
        options={TRADE_CATEGORIES.map(t => t.label)}
        selected={[getTradeLabel(tradeCategory)]}
        onToggle={(label) => {
          const found = TRADE_CATEGORIES.find(t => t.label === label);
          if (found) setTradeCategory(found.id);
          setShowTradePicker(false);
        }}
        onClose={() => setShowTradePicker(false)}
      />
      <PickerModal
        visible={showStatePicker}
        title="Select State"
        options={US_STATES.map(s => s.abbr)}
        selected={state ? [state] : []}
        onToggle={(abbr) => { setState(abbr); setShowStatePicker(false); }}
        onClose={() => setShowStatePicker(false)}
      />
    </View>
  );
}

function InputRow({ label, value, onChangeText, placeholder, icon: Icon, keyboardType, autoCapitalize, maxLength }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  icon?: React.ElementType; keyboardType?: TextInput['props']['keyboardType']; autoCapitalize?: TextInput['props']['autoCapitalize']; maxLength?: number;
}) {
  return (
    <View style={styles.row}>
      {Icon && <Icon size={16} color={Colors.textSecondary} />}
      <Text style={[styles.rowLabel, Icon ? { marginLeft: 8 } : undefined]}>{label}</Text>
      <TextInput
        style={styles.inlineInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        textAlign="right"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
      />
    </View>
  );
}

function PickerRow({ label, value, options, onSelect }: {
  label: string; value: string; options: string[]; onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={styles.row} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={styles.rowLabel}>{label}</Text>
        <View style={styles.rowRight}>
          <Text style={[styles.rowValue, !value && { color: Colors.textMuted }]}>{value || 'Select'}</Text>
          <ChevronDown size={14} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
      <PickerModal
        visible={open}
        title={`Select ${label}`}
        options={options}
        selected={value ? [value] : []}
        onToggle={(v) => { onSelect(v); setOpen(false); }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function PickerModal({ visible, title, options, selected, onToggle, onClose, multi }: {
  visible: boolean; title: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; onClose: () => void; multi?: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose}><X size={22} color={Colors.text} /></TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {options.map(opt => (
              <TouchableOpacity key={opt} style={styles.modalOption} onPress={() => onToggle(opt)} activeOpacity={0.7}>
                <Text style={styles.modalOptionText}>{opt}</Text>
                {selected.includes(opt) && <Check size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
          {multi && (
            <TouchableOpacity style={styles.modalDone} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.modalDoneText}>Done ({selected.length} selected)</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  photoSection: { alignItems: 'center', paddingVertical: 24, backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  photoWrapper: { width: 100, height: 100, borderRadius: 50, overflow: 'hidden', position: 'relative' as const },
  photo: { width: 100, height: 100, borderRadius: 50 },
  photoPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  photoBadge: { position: 'absolute' as const, bottom: 2, right: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  photoHint: { fontSize: 12, color: Colors.textMuted, marginTop: 8 },
  sectionHeader: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.6, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  group: { backgroundColor: Colors.surface, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden' as const },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  rowLabel: { fontSize: 15, color: Colors.text, fontWeight: '500' as const },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' as const },
  rowValue: { fontSize: 15, color: Colors.textSecondary },
  inlineInput: { flex: 1, fontSize: 15, color: Colors.text, marginLeft: 12, textAlign: 'right' as const },
  sep: { height: 0.5, backgroundColor: Colors.borderLight, marginLeft: 16 },
  twoCol: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  halfCol: { flex: 1 },
  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 4 },
  fieldInput: { backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: Colors.text },
  fieldPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  fieldPickerText: { fontSize: 15, color: Colors.text },
  availDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  bioInput: { padding: 16, fontSize: 15, color: Colors.text, lineHeight: 22, minHeight: 120 },
  charCount: { fontSize: 11, color: Colors.textMuted, textAlign: 'right' as const, paddingHorizontal: 16, paddingBottom: 8 },
  skillsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  skillTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '12', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  skillTagText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  addSkillBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.primary + '40', borderStyle: 'dashed' as const, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  addSkillText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  certTag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.borderLight },
  certTagActive: { backgroundColor: Colors.primary + '12', borderColor: Colors.primary },
  certTagText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  certTagTextActive: { color: Colors.primary },
  licenseCard: { padding: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, gap: 8 },
  licenseHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  licenseInput: { backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: Colors.text },
  expCard: { padding: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, gap: 8 },
  expHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expHeaderLabel: { flex: 1, fontSize: 14, fontWeight: '600' as const, color: Colors.accent },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  addBtnText: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary },
  visibilityRow: { flexDirection: 'row', gap: 4, marginLeft: 'auto' as const },
  visChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: Colors.background },
  visChipActive: { backgroundColor: Colors.primary },
  visChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  visChipTextActive: { color: '#FFF' },
  saveBtn: { marginHorizontal: 16, marginTop: 24, backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: '#FFF', fontSize: 17, fontWeight: '700' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  modalScroll: { maxHeight: 400 },
  modalOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  modalOptionText: { fontSize: 16, color: Colors.text },
  modalDone: { backgroundColor: Colors.primary, margin: 16, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalDoneText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
});


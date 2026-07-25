import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  TextInput, Animated, Platform, FlatList, Modal, KeyboardAvoidingView, Pressable,
} from 'react-native';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Search, X, Plus, Minus, Trash2, ChevronDown, ChevronUp,
  Layers, Droplets, Hammer, Trees, Home, PaintBucket,
  ArrowRight, Percent, ShoppingCart, CheckCircle, Info, RefreshCw,
  Truck, Package, Wrench, Wind, Shield, Grid,
  TrendingUp, AlertTriangle, Clock3, Database, MapPin,
  Mail, MessageSquare, FolderOpen, FileText, Send,
  HardHat, Boxes, ClipboardList, Ruler, Calculator, Gauge, GitCompare,
  ChevronRight,
 Wifi, PlusCircle, History, Star, FileUp, ScanSearch, Mic } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import * as Linking from 'expo-linking';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { CATEGORY_META, getLivePrices, getRegionMultiplier, EXPANDED_MATERIALS, REGIONAL_FACTORS, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { useMaterialCart, type MaterialCartItem } from '@/contexts/MaterialCartContext';
import MaterialAIEstimateModal from '@/components/MaterialAIEstimateModal';
import { generateUUID } from '@/utils/generateId';
import { findMaterials, type AIMaterialResult } from '@/utils/materialFinder';
import {
  saveToLocalDatabase, getCustomMaterials, searchCustomMaterials,
  getPopularCustomMaterials, aiResultToSavedMaterial, addRecentMaterial,
  getRecentMaterials, type SavedMaterial, type RecentMaterial,
} from '@/utils/materialDatabase';
import { generateAndSharePDF, generateEstimatePDFUri } from '@/utils/pdfGenerator';
import * as Sharing from 'expo-sharing';
import PDFPreSendSheet from '@/components/PDFPreSendSheet';
import type { PDFSendOptions } from '@/components/PDFPreSendSheet';
import { sendEmail, buildEstimateEmailHtml } from '@/utils/emailService';
import { useTierAccess } from '@/hooks/useTierAccess';
import type { LinkedEstimate, LinkedEstimateItem, Project } from '@/types';
import { LABOR_RATES, LABOR_CATEGORIES, type LaborRate } from '@/constants/laborRates';
import { ASSEMBLIES, ASSEMBLY_CATEGORIES, type AssemblyItem } from '@/constants/assemblies';
import { useCustomAssemblies } from '@/hooks/useCustomAssemblies';
import { useRateOverrides } from '@/hooks/useRateOverrides';
import type { RateOverride } from '@/utils/rateOverrides';
import { AssemblyEditorModal } from '@/components/AssemblyEditorModal';
import { RateOverrideModal } from '@/components/RateOverrideModal';
import { ESTIMATE_TEMPLATES, TEMPLATE_CATEGORIES, type EstimateTemplate } from '@/constants/estimateTemplates';
import SquareFootEstimator from '@/components/SquareFootEstimator';
import ProductivityCalculator from '@/components/ProductivityCalculator';
import CostBreakdownReport from '@/components/CostBreakdownReport';
import EstimateComparison from '@/components/EstimateComparison';
import AIEstimateValidator from '@/components/AIEstimateValidator';
import AICopilot from '@/components/AICopilot';
import AIQuickEstimate from '@/components/AIQuickEstimate';
import { CATEGORY_COST_FACTORS } from '@/constants/materials';
import { formatMoney, parseLenientNumber } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { buildCostDatabase } from '@/utils/costDatabase';
import { computeCalibration } from '@/utils/estimateCalibration';

// CartItem stays as a local-superset of MaterialCartItem so the AIQuickEstimate
// component (which carries an optional priceSource) keeps compiling. The
// materials cart in context uses MaterialCartItem (without priceSource); the
// extra optional field is structurally compatible going either direction.
interface CartItem {
  material: MaterialItem;
  quantity: number;
  markup: number;
  usesBulk: boolean;
  priceSource?: 'live' | 'base';
}

interface LaborCartItem {
  labor: LaborRate;
  hours: number;
  adjustedRate: number;
}

interface AssemblyCartItem {
  assembly: AssemblyItem;
  quantity: number;
  materialsCost: number;
  laborCost: number;
  totalCost: number;
}

type EstimateTab = 'materials' | 'labor' | 'assemblies' | 'templates';

const CATEGORY_CHIPS = [
  { id: 'all', label: 'All', icon: Layers },
  { id: 'lumber', label: 'Lumber', icon: Package },
  { id: 'concrete', label: 'Concrete', icon: Home },
  { id: 'roofing', label: 'Roofing', icon: Home },
  { id: 'insulation', label: 'Insulation', icon: Shield },
  { id: 'siding', label: 'Siding', icon: Grid },
  { id: 'windows', label: 'Windows', icon: Grid },
  { id: 'flooring', label: 'Flooring', icon: Layers },
  { id: 'plumbing', label: 'Plumbing', icon: Droplets },
  { id: 'electrical', label: 'Electrical', icon: MageAIMark },
  { id: 'hvac', label: 'HVAC', icon: Wind },
  { id: 'drywall', label: 'Drywall', icon: Hammer },
  { id: 'paint', label: 'Paint', icon: PaintBucket },
  { id: 'decking', label: 'Decking', icon: Trees },
  { id: 'fencing', label: 'Fencing', icon: Shield },
  { id: 'steel', label: 'Steel', icon: Wrench },
  { id: 'hardware', label: 'Hardware', icon: Wrench },
  { id: 'landscape', label: 'Landscape', icon: Trees },
];

const MARKUP_PRESETS = [
  { label: '0%', value: 0 },
  { label: '10%', value: 10 },
  { label: '15%', value: 15 },
  { label: '20%', value: 20 },
  { label: '25%', value: 25 },
];

interface OpportunityInsight {
  id: string;
  title: string;
  detail: string;
  delta: number;
  tone: 'positive' | 'warning' | 'neutral';
  icon: typeof TrendingUp;
}

function getCategoryColor(category: string): string {
  return CATEGORY_META[category]?.color ?? Colors.primary;
}

export default function EstimateScreen() {
  const styles = useThemedStyles(makeStyles);
  const dStyles = useThemedStyles(makeDStyles);
  const aiStyles = useThemedStyles(makeAiStyles);
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const { projects, updateProject, settings, updateSettings, contacts, commitments } = useProjects();
  const { isFree, canAccess } = useTierAccess();
  // Shared materials cart (used by the Materials browser too). All cart
  // mutations now flow through the context — local setCart() calls were
  // removed in favor of these helpers.
  const {
    cart,
    globalMarkup,
    addToCart: ctxAddToCart,
    addManyToCart: ctxAddManyToCart,
    removeFromCart: ctxRemoveFromCart,
    updateQuantity: ctxUpdateQuantity,
    updateMarkup: ctxUpdateMarkup,
    clearCart: ctxClearCart,
    setGlobalMarkup: ctxSetGlobalMarkup,
    replaceCart: ctxReplaceCart,
  } = useMaterialCart();

  const locationMultiplier = useMemo(() => getRegionMultiplier(settings.location), [settings.location]);
  const regionLabel = useMemo(() => {
    // Pick the region whose multiplier matches. Ties (both ~1.00) are rare and
    // fall through to "National Avg" which is fine.
    const match = REGIONAL_FACTORS.find(r => Math.abs(r.multiplier - locationMultiplier) < 0.001);
    return match?.label ?? 'National Avg';
  }, [locationMultiplier]);

  const { receipts } = useMaterialReceipts();

  const quickEstimateGrounding = useMemo<{ facts: string[]; rateCount: number }>(() => {
    try {
      const db = buildCostDatabase(projects, commitments, receipts);
      const facts = db.entries.slice(0, 6).map(
        e => `${e.trade} runs $${e.suggestedRate.toFixed(2)}/${e.unit} on your jobs (${e.confidence} confidence, ${e.jobCount} job${e.jobCount === 1 ? '' : 's'})`,
      );
      const cal = computeCalibration({ projects, commitments });
      if (cal.hasData && cal.categories[0] && cal.categories[0].direction !== 'aligned') {
        facts.push(cal.categories[0].detail);
      }
      return { facts, rateCount: db.entries.length };
    } catch {
      return { facts: [], rateCount: 0 };
    }
  }, [projects, commitments, receipts]);

  // Stable seed — previously Date.now()/10000 which caused prices to drift by a cent
  // on every refresh (app resume, 5min interval, location change). Pricing is now
  // deterministic per-location so estimates don't mysteriously change after you leave.
  const PRICE_SEED = 1;
  const [materials, setMaterials] = useState<MaterialItem[]>(() => getLivePrices(PRICE_SEED, locationMultiplier));
  const [_lastUpdated, setLastUpdated] = useState(new Date());
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  // cart + globalMarkup come from MaterialCartContext (above). The input
  // string for the custom-markup textbox stays local — context only stores
  // the numeric value.
  const [globalMarkupInput, setGlobalMarkupInput] = useState('15');
  const [showAIModal, setShowAIModal] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [cartAnim] = useState(new Animated.Value(1));
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const openItemPopupRef = useRef<(material: MaterialItem) => void>(() => {});

  const [selectedMaterial, setSelectedMaterial] = useState<MaterialItem | null>(null);
  const [itemQty, setItemQty] = useState('1');
  const [showItemPopup, setShowItemPopup] = useState(false);

  const [showAddToProject, setShowAddToProject] = useState(false);
  // iOS cannot present a Modal while another is still dismissing — UIKit
  // silently drops the present call. The cart is a fullScreen+slide modal
  // whose dismiss animation routinely exceeds the old fixed ~350ms timeout
  // every cart-footer button used, so they appeared to do nothing. We
  // record which modal to open next and let the cart modal's onDismiss
  // (fires AFTER the dismiss transition completes on iOS) open it
  // deterministically. One mechanism fixes all four cart-exit buttons:
  // Add to Project, Compare, Ask AI, and PDF/Email/Text.
  type PendingCartModal = 'addToProject' | 'comparison' | 'ai' | 'pdf';
  const [pendingCartModal, setPendingCartModal] = useState<PendingCartModal | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Inherit the project when the Estimator is opened from a project (e.g. a
  // project-detail Estimate tile) so it's project-aware immediately — this is
  // what surfaces the "Build by voice" hero and scopes "save to project".
  const { projectId: navProjectId } = useLocalSearchParams<{ projectId?: string }>();
  useEffect(() => {
    if (navProjectId && !selectedProjectId) setSelectedProjectId(navProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navProjectId]);
  const [showConfirmLink, setShowConfirmLink] = useState(false);
  const [estimateName, setEstimateName] = useState('');
  const [pendingLinkProject, setPendingLinkProject] = useState<Project | null>(null);
  const [showPDFPreSend, setShowPDFPreSend] = useState(false);
  const [activeTab, setActiveTab] = useState<EstimateTab>('materials');
  const [laborCart, setLaborCart] = useState<LaborCartItem[]>([]);
  const [assemblyCart, setAssemblyCart] = useState<AssemblyCartItem[]>([]);
  const [laborQuery, _setLaborQuery] = useState('');
  const [laborCategory, setLaborCategory] = useState('all');
  const [assemblyQuery, _setAssemblyQuery] = useState('');
  const [assemblyCategory, setAssemblyCategory] = useState('all');
  const [templateCategory, setTemplateCategory] = useState('all');
  const [showLaborPopup, setShowLaborPopup] = useState(false);
  const [selectedLabor, setSelectedLabor] = useState<LaborRate | null>(null);
  const [laborHoursInput, setLaborHoursInput] = useState('8');
  const [laborRateInput, setLaborRateInput] = useState('');
  const [showAssemblyPopup, setShowAssemblyPopup] = useState(false);
  const [selectedAssembly, setSelectedAssembly] = useState<AssemblyItem | null>(null);
  const [assemblyQtyInput, setAssemblyQtyInput] = useState('1');
  // Custom assemblies — GC-authored presets merged into the SAME picker
  const { customAssemblies, addCustomAssembly, updateCustomAssembly, deleteCustomAssembly } = useCustomAssemblies();
  const { overrides, laborRate, materialPrice, addOverride, updateOverride, deleteOverride } = useRateOverrides();
  const [costBookOpen, setCostBookOpen] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorInitial, setEditorInitial] = useState<AssemblyItem | null>(null);
  const [showSqftEstimator, setShowSqftEstimator] = useState(false);
  const [showProductivityCalc, setShowProductivityCalc] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showAIQuickEstimate, setShowAIQuickEstimate] = useState(false);
  const [expandedCostBreakdown, setExpandedCostBreakdown] = useState<string | null>(null);

  const [aiSearchResults, setAiSearchResults] = useState<AIMaterialResult[]>([]);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const [aiSearchError, setAiSearchError] = useState<string | null>(null);
  const [showAiResults, setShowAiResults] = useState(false);
  const [recentMaterials, setRecentMaterials] = useState<RecentMaterial[]>([]);
  const [popularMaterials, setPopularMaterials] = useState<SavedMaterial[]>([]);
  const [customMaterialCount, setCustomMaterialCount] = useState(0);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUnit, setCustomUnit] = useState('each');
  const [customPrice, setCustomPrice] = useState('');
  const [customCategory, setCustomCategory] = useState('hardware');
  const [customNotes, setCustomNotes] = useState('');

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  // Keep the local markup-input string in sync with the context value. The
  // context can be mutated from elsewhere (e.g. the AI suggestions modal
  // applying a per-item markup pulled from globalMarkup baseline), so we
  // reflect those changes back into the textbox.
  useEffect(() => {
    setGlobalMarkupInput(String(globalMarkup));
  }, [globalMarkup]);

  useEffect(() => {
    getRecentMaterials().then(setRecentMaterials).catch(() => {});
    getPopularCustomMaterials(10).then(setPopularMaterials).catch(() => {});
    getCustomMaterials().then(m => setCustomMaterialCount(m.length)).catch(() => {});
  }, []);

  const totalMaterialCount = useMemo(() => materials.length + customMaterialCount, [materials.length, customMaterialCount]);

  const handleAiSearch = useCallback(async () => {
    if (!query.trim()) return;
    setIsAiSearching(true);
    setAiSearchError(null);
    setShowAiResults(true);
    console.log('[Estimate] AI search triggered for:', query);
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const result = await findMaterials(query, activeCategory !== 'all' ? activeCategory : undefined, settings.location);
      setAiSearchResults(result.materials);
      console.log('[Estimate] AI search returned', result.materials.length, 'results');
    } catch (err) {
      console.error('[Estimate] AI search error:', err);
      setAiSearchError('AI search unavailable right now. Try again in a moment.');
    } finally {
      setIsAiSearching(false);
    }
  }, [query, activeCategory, settings.location]);

  const handleAddAiMaterial = useCallback((aiMat: AIMaterialResult) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const materialItem: MaterialItem = {
      id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: aiMat.name,
      category: aiMat.category.toLowerCase().replace(/[^a-z]/g, ''),
      unit: aiMat.unit,
      baseRetailPrice: aiMat.unitPrice,
      baseBulkPrice: aiMat.unitPrice * 0.85,
      bulkMinQty: 10,
      supplier: aiMat.brand || aiMat.priceSource || 'AI Found',
      pricingModel: 'market',
      sourceLabel: 'AI Live Price',
      region: 'National Avg',
      specTier: 'base',
    };
    ctxAddToCart(materialItem, 1);
    const savedMat = aiResultToSavedMaterial(aiMat);
    saveToLocalDatabase(savedMat).then(() => {
      getCustomMaterials().then(m => setCustomMaterialCount(m.length)).catch(() => {});
      getPopularCustomMaterials(10).then(setPopularMaterials).catch(() => {});
    }).catch(() => {});
    addRecentMaterial({
      id: materialItem.id,
      name: materialItem.name,
      category: materialItem.category,
      unit: materialItem.unit,
      unitPrice: materialItem.baseRetailPrice,
      timestamp: new Date().toISOString(),
      source: 'ai',
    }).then(() => getRecentMaterials().then(setRecentMaterials)).catch(() => {});
    Animated.sequence([
      Animated.spring(cartAnim, { toValue: 1.3, useNativeDriver: true, speed: 30, bounciness: 10 }),
      Animated.spring(cartAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
    ]).start();
  }, [cartAnim, ctxAddToCart]);

  const handleAddCustomMaterial = useCallback(() => {
    const price = parseLenientNumber(customPrice);
    if (!customName.trim() || price === null || price <= 0) {
      Alert.alert('Invalid Input', 'Please enter a valid name and price.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const materialItem: MaterialItem = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: customName.trim(),
      category: customCategory,
      unit: customUnit,
      baseRetailPrice: price,
      baseBulkPrice: price * 0.9,
      bulkMinQty: 10,
      supplier: 'Custom',
      pricingModel: 'market',
      sourceLabel: 'Custom Entry',
    };
    ctxAddToCart(materialItem, 1);
    saveToLocalDatabase({
      id: materialItem.id,
      name: materialItem.name,
      description: customNotes,
      unit: customUnit,
      unitPrice: price,
      category: customCategory,
      commonUses: [],
      alternateNames: [],
      priceSource: 'Custom',
      priceDate: new Date().toISOString(),
      isCustom: true,
      searchCount: 1,
    }).then(() => {
      getCustomMaterials().then(m => setCustomMaterialCount(m.length)).catch(() => {});
    }).catch(() => {});
    addRecentMaterial({
      id: materialItem.id,
      name: materialItem.name,
      category: materialItem.category,
      unit: materialItem.unit,
      unitPrice: price,
      timestamp: new Date().toISOString(),
      source: 'custom',
    }).then(() => getRecentMaterials().then(setRecentMaterials)).catch(() => {});
    setShowCustomForm(false);
    setCustomName('');
    setCustomPrice('');
    setCustomNotes('');
    Animated.sequence([
      Animated.spring(cartAnim, { toValue: 1.3, useNativeDriver: true, speed: 30, bounciness: 10 }),
      Animated.spring(cartAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
    ]).start();
  }, [customName, customPrice, customUnit, customCategory, customNotes, cartAnim, ctxAddToCart]);

  const handleAddRecentToCart = useCallback((recent: RecentMaterial) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const existing = materials.find(m => m.name === recent.name);
    if (existing) {
      openItemPopupRef.current(existing);
      return;
    }
    const materialItem: MaterialItem = {
      id: recent.id,
      name: recent.name,
      category: recent.category,
      unit: recent.unit,
      baseRetailPrice: recent.unitPrice,
      baseBulkPrice: recent.unitPrice * 0.85,
      bulkMinQty: 10,
      supplier: recent.source === 'ai' ? 'AI Found' : recent.source === 'custom' ? 'Custom' : 'Built-in',
    };
    openItemPopupRef.current(materialItem);
  }, [materials]);

  const refreshPrices = useCallback(() => {
    // Uses the stable PRICE_SEED so prices only change when the location changes.
    const newPrices = getLivePrices(PRICE_SEED, locationMultiplier);
    setMaterials(newPrices);
    setLastUpdated(new Date());
    // Re-price existing cart items against the new location multiplier. We
    // do this through replaceCart (context's bulk-set) rather than per-item
    // updates so it's a single atomic write.
    const repriced: MaterialCartItem[] = cart.map(cartItem => {
      const updated = newPrices.find(m => m.id === cartItem.material.id);
      if (updated) return { ...cartItem, material: updated };
      return cartItem;
    });
    ctxReplaceCart(repriced);
  }, [locationMultiplier, cart, ctxReplaceCart]);

  // Only re-price when location changes. Removed the 5-minute interval and the
  // AppState resume refresh — those were causing estimates to drift by a cent
  // every time the user left and came back.
  //
  // refreshPrices calls ctxReplaceCart, which mutates `cart`; `cart` is one of
  // refreshPrices's deps, so refreshPrices gets a fresh identity after every
  // run. Listing it in this effect's deps therefore created an infinite update
  // loop (React's "Maximum update depth exceeded"). Fix: fire strictly on
  // locationMultiplier and reach the latest refreshPrices through a ref, so the
  // effect's own identity never churns when the cart changes.
  const refreshPricesRef = useRef(refreshPrices);
  useEffect(() => { refreshPricesRef.current = refreshPrices; }, [refreshPrices]);
  useEffect(() => {
    refreshPricesRef.current();
  }, [locationMultiplier]);

  const filteredMaterials = useMemo(() => {
    let results = materials;
    if (activeCategory !== 'all') {
      results = results.filter(m => m.category === activeCategory);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.supplier.toLowerCase().includes(q) ||
        (CATEGORY_META[m.category]?.label ?? '').toLowerCase().includes(q)
      );
    }
    return results;
  }, [query, activeCategory, materials]);

  const cartTotal = useMemo(() => cart.reduce((sum, item) => {
    const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
    return sum + base * (1 + item.markup / 100) * item.quantity;
  }, 0), [cart]);

  const regionalVisibleCount = useMemo(() => {
    return filteredMaterials.filter(item => item.pricingModel === 'regional_adjusted').length;
  }, [filteredMaterials]);

  const cartBaseTotal = useMemo(() => cart.reduce((sum, item) => {
    const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
    return sum + base * item.quantity;
  }, 0), [cart]);

  const markupTotal = cartTotal - cartBaseTotal;

  const laborTotal = useMemo(() => laborCart.reduce((sum, item) => sum + item.adjustedRate * item.hours, 0), [laborCart]);
  const laborHoursTotal = useMemo(() => laborCart.reduce((sum, item) => sum + item.hours, 0), [laborCart]);
  const assemblyTotal = useMemo(() => assemblyCart.reduce((sum, item) => sum + item.totalCost, 0), [assemblyCart]);
  const grandTotal = cartTotal + laborTotal + assemblyTotal;
  const totalItemCount = cart.length + laborCart.length + assemblyCart.length;

  const filteredLabor = useMemo(() => {
    let results = LABOR_RATES;
    if (laborCategory !== 'all') results = results.filter(l => l.category === laborCategory);
    if (laborQuery.trim()) {
      const q = laborQuery.toLowerCase();
      results = results.filter(l => l.trade.toLowerCase().includes(q) || l.category.toLowerCase().includes(q));
    }
    return results;
  }, [laborQuery, laborCategory]);

  // Merge system presets + GC-authored custom assemblies into a single source.
  // Custom items carry __custom:true so renderAssemblyCard can show affordances.
  // Both are valid AssemblyItem so openAssemblyPopup / calculateAssemblyCost /
  // handleAddAssembly / assemblyCart consume them identically — untouched.
  const allAssemblies = useMemo(
    () => [
      ...ASSEMBLIES,
      ...customAssemblies.map(a => ({ ...a, __custom: true as const })),
    ],
    [customAssemblies],
  );

  const filteredAssemblies = useMemo(() => {
    let results = allAssemblies;
    if (assemblyCategory !== 'all') results = results.filter(a => a.category === assemblyCategory);
    if (assemblyQuery.trim()) {
      const q = assemblyQuery.toLowerCase();
      results = results.filter(a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
    }
    return results;
  }, [assemblyQuery, assemblyCategory, allAssemblies]);

  const filteredTemplates = useMemo(() => {
    if (templateCategory === 'all') return ESTIMATE_TEMPLATES;
    return ESTIMATE_TEMPLATES.filter(t => t.category === templateCategory);
  }, [templateCategory]);

  const openLaborPopup = useCallback((labor: LaborRate) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const existing = laborCart.find(i => i.labor.id === labor.id);
    setSelectedLabor(labor);
    setLaborHoursInput(existing ? String(existing.hours) : '8');
    setLaborRateInput(String(labor.hourlyRate));
    setShowLaborPopup(true);
  }, [laborCart]);

  const handleAddLabor = useCallback(() => {
    if (!selectedLabor) return;
    const hours = parseLenientNumber(laborHoursInput);
    const rate = parseLenientNumber(laborRateInput);
    if (hours === null || hours <= 0 || rate === null || rate <= 0) {
      Alert.alert('Invalid Input', 'Please enter valid hours and rate.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLaborCart(prev => {
      const existing = prev.find(i => i.labor.id === selectedLabor.id);
      if (existing) return prev.map(i => i.labor.id === selectedLabor.id ? { ...i, hours, adjustedRate: rate } : i);
      return [...prev, { labor: selectedLabor, hours, adjustedRate: rate }];
    });
    setShowLaborPopup(false);
    setSelectedLabor(null);
  }, [selectedLabor, laborHoursInput, laborRateInput]);

  const removeLaborItem = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLaborCart(prev => prev.filter(i => i.labor.id !== id));
  }, []);

  const openAssemblyPopup = useCallback((assembly: AssemblyItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAssembly(assembly);
    setAssemblyQtyInput('1');
    setShowAssemblyPopup(true);
  }, []);

  const calculateAssemblyCost = useCallback((assembly: AssemblyItem, qty: number): { materialsCost: number; laborCost: number; totalCost: number } => {
    let materialsCost = 0;
    for (const mat of assembly.materialsPerUnit) {
      const price = materialPrice(mat.materialId) ?? (materials.find(m => m.id === mat.materialId)?.baseBulkPrice ?? 15);
      materialsCost += price * mat.quantityPerUnit * (1 + mat.wasteFactor) * qty;
    }
    let laborCost = 0;
    for (const lab of assembly.laborPerUnit) {
      const labRate = laborRate(lab.trade) ?? (LABOR_RATES.find(r => r.trade === lab.trade)?.hourlyRate ?? 25);
      laborCost += labRate * lab.hoursPerUnit * qty;
    }
    return { materialsCost, laborCost, totalCost: materialsCost + laborCost };
  }, [materials, laborRate, materialPrice]);

  const handleAddAssembly = useCallback(() => {
    if (!selectedAssembly) return;
    const qty = parseLenientNumber(assemblyQtyInput);
    if (qty === null || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const costs = calculateAssemblyCost(selectedAssembly, qty);
    setAssemblyCart(prev => {
      const existing = prev.find(i => i.assembly.id === selectedAssembly.id);
      if (existing) return prev.map(i => i.assembly.id === selectedAssembly.id ? { ...i, quantity: qty, ...costs } : i);
      return [...prev, { assembly: selectedAssembly, quantity: qty, ...costs }];
    });
    setShowAssemblyPopup(false);
    setSelectedAssembly(null);
  }, [selectedAssembly, assemblyQtyInput, calculateAssemblyCost]);

  const removeAssemblyItem = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAssemblyCart(prev => prev.filter(i => i.assembly.id !== id));
  }, []);

  const handleApplyAIEstimate = useCallback((
    aiMaterials: CartItem[],
    aiLabor: LaborCartItem[],
    aiAssemblies: AssemblyCartItem[],
  ) => {
    console.log('[Estimate] Applying AI estimate:', aiMaterials.length, 'materials,', aiLabor.length, 'labor,', aiAssemblies.length, 'assemblies');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Materials go through the shared cart context so the Materials browser
    // sees the same state. addManyToCart dedups by material id and bumps qty.
    ctxAddManyToCart(aiMaterials.map(m => ({ material: m.material, quantity: m.quantity })));
    setLaborCart(prev => {
      const map = new Map<string, LaborCartItem>();
      for (const item of prev) map.set(item.labor.id, item);
      for (const item of aiLabor) {
        const existing = map.get(item.labor.id);
        if (existing) {
          map.set(item.labor.id, { ...existing, hours: existing.hours + item.hours });
        } else {
          map.set(item.labor.id, item);
        }
      }
      return Array.from(map.values());
    });
    setAssemblyCart(prev => {
      const map = new Map<string, AssemblyCartItem>();
      for (const item of prev) map.set(item.assembly.id, item);
      for (const item of aiAssemblies) {
        const existing = map.get(item.assembly.id);
        if (existing) {
          const newQty = existing.quantity + item.quantity;
          map.set(item.assembly.id, { ...existing, quantity: newQty, materialsCost: existing.materialsCost + item.materialsCost, laborCost: existing.laborCost + item.laborCost, totalCost: existing.totalCost + item.totalCost });
        } else {
          map.set(item.assembly.id, item);
        }
      }
      return Array.from(map.values());
    });
    Animated.sequence([
      Animated.spring(cartAnim, { toValue: 1.4, useNativeDriver: true, speed: 30, bounciness: 12 }),
      Animated.spring(cartAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
    ]).start();
  }, [cartAnim, ctxAddManyToCart]);

  const handleLoadTemplate = useCallback((template: EstimateTemplate) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newAssemblies: AssemblyCartItem[] = [];
    for (const ta of template.assemblies) {
      const assembly = ASSEMBLIES.find(a => a.id === ta.assemblyId);
      if (!assembly) continue;
      const costs = calculateAssemblyCost(assembly, ta.defaultQuantity);
      newAssemblies.push({ assembly, quantity: ta.defaultQuantity, ...costs });
    }
    Alert.alert(
      `Load ${template.name}?`,
      `This will add ${newAssemblies.length} assemblies to your estimate. ${template.priceRange}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load',
          onPress: () => {
            setAssemblyCart(prev => [...prev, ...newAssemblies]);
            setActiveTab('assemblies');
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  }, [calculateAssemblyCost]);

  const listBottomPadding = useMemo(() => {
    const floatingCartHeight = cart.length > 0 && !showCart ? 108 : 24;
    return insets.bottom + floatingCartHeight;
  }, [cart.length, insets.bottom, showCart]);

  const opportunities = useMemo<OpportunityInsight[]>(() => {
    if (materials.length === 0) return [];
    const scoped = filteredMaterials.slice(0, 80);
    const cheapestByCategory = new Map<string, MaterialItem>();
    for (const material of scoped) {
      const existing = cheapestByCategory.get(material.category);
      if (!existing || material.baseBulkPrice < existing.baseBulkPrice) {
        cheapestByCategory.set(material.category, material);
      }
    }
    let switchSavings = 0;
    const supplierSpend = new Map<string, number>();
    for (const item of cart) {
      const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const cost = base * item.quantity;
      supplierSpend.set(item.material.supplier, (supplierSpend.get(item.material.supplier) ?? 0) + cost);
      const categoryFloor = cheapestByCategory.get(item.material.category);
      if (categoryFloor) {
        const altCost = categoryFloor.baseBulkPrice * item.quantity;
        switchSavings += Math.max(0, cost - altCost);
      }
    }
    const supplierSorted = [...supplierSpend.entries()].sort((a, b) => b[1] - a[1]);
    const topSupplier = supplierSorted[0];
    const concentration = topSupplier && cartBaseTotal > 0 ? (topSupplier[1] / cartBaseTotal) * 100 : 0;
    const quantityGap = cart.reduce((sum, item) => {
      if (item.quantity >= item.material.bulkMinQty) return sum;
      const remaining = item.material.bulkMinQty - item.quantity;
      const unitGap = item.material.baseRetailPrice - item.material.baseBulkPrice;
      return sum + remaining * Math.max(0, unitGap);
    }, 0);
    return [
      {
        id: 'switch', title: 'Alt Supplier Delta',
        detail: switchSavings > 0 ? `Swap to lowest category supplier to unlock ~${switchSavings.toFixed(0)} in savings.` : 'Current cart is close to the lowest category pricing baseline.',
        delta: switchSavings, tone: switchSavings > 80 ? 'positive' : 'neutral', icon: TrendingUp,
      },
      {
        id: 'bulk-gap', title: 'Bulk Trigger Gap',
        detail: quantityGap > 0 ? `You are near bulk thresholds. Closing gaps can recover ~${quantityGap.toFixed(0)}.` : 'All bulk-eligible lines are already optimized.',
        delta: quantityGap, tone: quantityGap > 0 ? 'positive' : 'neutral', icon: MageAIMark,
      },
      {
        id: 'concentration', title: 'Supplier Concentration Risk',
        detail: concentration > 65 && topSupplier ? `${topSupplier[0]} holds ${concentration.toFixed(0)}% of spend. Add fallback quotes.` : 'Spend is distributed enough to reduce single-vendor pricing shocks.',
        delta: concentration, tone: concentration > 65 ? 'warning' : 'neutral', icon: AlertTriangle,
      },
    ];
  }, [materials.length, filteredMaterials, cart, cartBaseTotal]);

  const openItemPopup = useCallback((material: MaterialItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const existing = cart.find(i => i.material.id === material.id);
    setSelectedMaterial(material);
    setItemQty(existing ? String(existing.quantity) : '1');
    setShowItemPopup(true);
  }, [cart]);
  openItemPopupRef.current = openItemPopup;

  const handleAddFromPopup = useCallback(() => {
    if (!selectedMaterial) return;
    const qty = parseLenientNumber(itemQty);
    if (qty === null || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Popup is set-absolute (typed-in quantity). If already in cart, set the
    // quantity exactly; otherwise add fresh.
    const existing = cart.find(i => i.material.id === selectedMaterial.id);
    if (existing) {
      ctxUpdateQuantity(selectedMaterial.id, qty);
    } else {
      ctxAddToCart(selectedMaterial, qty);
    }
    Animated.sequence([
      Animated.spring(cartAnim, { toValue: 1.3, useNativeDriver: true, speed: 30, bounciness: 10 }),
      Animated.spring(cartAnim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }),
    ]).start();
    addRecentMaterial({
      id: selectedMaterial.id,
      name: selectedMaterial.name,
      category: selectedMaterial.category,
      unit: selectedMaterial.unit,
      unitPrice: selectedMaterial.baseRetailPrice,
      timestamp: new Date().toISOString(),
      source: 'builtin',
    }).then(() => getRecentMaterials().then(setRecentMaterials)).catch(() => {});
    setShowItemPopup(false);
    setSelectedMaterial(null);
  }, [selectedMaterial, itemQty, cart, cartAnim, ctxAddToCart, ctxUpdateQuantity]);

  const popupLineTotal = useMemo(() => {
    if (!selectedMaterial) return 0;
    const qty = parseInt(itemQty, 10) || 0;
    const usesBulk = qty >= selectedMaterial.bulkMinQty;
    const base = usesBulk ? selectedMaterial.baseBulkPrice : selectedMaterial.baseRetailPrice;
    return base * (1 + globalMarkup / 100) * qty;
  }, [selectedMaterial, itemQty, globalMarkup]);

  // Delta-style qty update used by the +/- buttons inside the cart row.
  // The context's updateQuantity is absolute; we combine it with a lookup
  // so the +/- behavior stays. Zero/negative results auto-remove the row.
  const updateQuantity = useCallback((id: string, delta: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    const existing = cart.find(i => i.material.id === id);
    if (!existing) return;
    const newQty = Math.max(0, existing.quantity + delta);
    if (newQty <= 0) {
      ctxRemoveFromCart(id);
    } else {
      ctxUpdateQuantity(id, newQty);
    }
  }, [cart, ctxRemoveFromCart, ctxUpdateQuantity]);

  const updateItemMarkup = useCallback((id: string, markup: number) => {
    ctxUpdateMarkup(id, markup);
  }, [ctxUpdateMarkup]);

  const removeFromCart = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ctxRemoveFromCart(id);
  }, [ctxRemoveFromCart]);

  const buildLinkedEstimate = useCallback((): LinkedEstimate => {
    const materialItems: LinkedEstimateItem[] = cart.map(item => {
      const usesBulk = item.quantity >= item.material.bulkMinQty;
      const base = usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const lineTotal = base * (1 + item.markup / 100) * item.quantity;
      return {
        materialId: item.material.id,
        name: item.material.name,
        category: CATEGORY_META[item.material.category]?.label ?? item.material.category,
        unit: item.material.unit,
        quantity: item.quantity,
        unitPrice: base,
        bulkPrice: item.material.baseBulkPrice,
        markup: item.markup,
        usesBulk,
        lineTotal,
        supplier: item.material.supplier,
      };
    });
    // Fold labor into the same LinkedEstimateItem shape. Labor carries no
    // markup — the adjusted hourly rate is the all-in cost — so unitPrice and
    // bulkPrice both hold the rate, markup=0, usesBulk=false, and the line
    // total is rate × hours. Without this, an estimate with $X of labor was
    // silently dropped when linked to a project or emailed as a PDF.
    const laborItems: LinkedEstimateItem[] = laborCart.map(item => {
      const lineTotal = item.adjustedRate * item.hours;
      return {
        materialId: item.labor.id,
        name: item.labor.trade,
        category: 'Labor',
        unit: 'hrs',
        quantity: item.hours,
        unitPrice: item.adjustedRate,
        bulkPrice: item.adjustedRate,
        markup: 0,
        usesBulk: false,
        lineTotal,
        supplier: item.labor.category,
      };
    });
    // Fold assemblies in the same way. An assembly's totalCost already bakes in
    // its material + labor costs at the chosen quantity, so it becomes a single
    // qty=1 line priced at that total.
    const assemblyItems: LinkedEstimateItem[] = assemblyCart.map(item => ({
      materialId: item.assembly.id,
      name: item.assembly.name,
      category: 'Assemblies',
      unit: item.assembly.unit,
      quantity: 1,
      unitPrice: item.totalCost,
      bulkPrice: item.totalCost,
      markup: 0,
      usesBulk: false,
      lineTotal: item.totalCost,
      supplier: `${item.quantity} ${item.assembly.unit}`,
    }));
    const items: LinkedEstimateItem[] = [...materialItems, ...laborItems, ...assemblyItems];
    // grandTotal must equal what the estimator footer shows: materials + labor
    // + assemblies. Labor and assemblies are all-in costs (no markup), so they
    // fold into baseTotal; markupTotal stays materials-only. That keeps
    // baseTotal + markupTotal === grandTotal.
    return {
      id: generateUUID(),
      items,
      globalMarkup,
      baseTotal: cartBaseTotal + laborTotal + assemblyTotal,
      markupTotal,
      grandTotal: cartTotal + laborTotal + assemblyTotal,
      createdAt: new Date().toISOString(),
    };
  }, [cart, laborCart, assemblyCart, globalMarkup, cartBaseTotal, markupTotal, cartTotal, laborTotal, assemblyTotal]);

  const handleSelectProject = useCallback(() => {
    if (!selectedProjectId) {
      Alert.alert('Select a project', 'Please choose a project to attach this estimate to.');
      return;
    }
    const proj = projects.find(p => p.id === selectedProjectId);
    if (!proj) return;
    setPendingLinkProject(proj);
    const defaultName = `${proj.name} - Estimate - ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
    setEstimateName(defaultName);
    setShowAddToProject(false);
    setTimeout(() => {
      setShowConfirmLink(true);
    }, 350);
  }, [selectedProjectId, projects]);

  const handleConfirmLink = useCallback((mode: 'replace' | 'merge') => {
    if (!pendingLinkProject) return;
    const linkedEst = buildLinkedEstimate();
    console.log('[Estimate] Linking estimate to project:', pendingLinkProject.id, 'mode:', mode, 'items:', linkedEst.items.length);

    if (mode === 'merge' && pendingLinkProject.linkedEstimate) {
      const existing = pendingLinkProject.linkedEstimate;
      const mergedItems = [...existing.items, ...linkedEst.items];
      const mergedBase = existing.baseTotal + linkedEst.baseTotal;
      const mergedMarkup = existing.markupTotal + linkedEst.markupTotal;
      const mergedGrand = existing.grandTotal + linkedEst.grandTotal;
      const mergedEstimate = { ...linkedEst, items: mergedItems, baseTotal: mergedBase, markupTotal: mergedMarkup, grandTotal: mergedGrand };
      updateProject(pendingLinkProject.id, { ...commitEstimatePatch(pendingLinkProject, mergedEstimate, { reason: 'pre_overwrite' }), status: 'estimated' });
    } else {
      updateProject(pendingLinkProject.id, { ...commitEstimatePatch(pendingLinkProject, linkedEst, { reason: 'pre_overwrite' }), status: 'estimated' });
    }

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowConfirmLink(false);
    setShowCart(false);
    setPendingLinkProject(null);
    const projId = pendingLinkProject.id;
    const projName = pendingLinkProject.name;
    Alert.alert('Estimate Linked', `Your estimate has been ${mode === 'merge' ? 'merged into' : 'linked to'} "${projName}".`, [
      { text: 'View Project', onPress: () => router.push({ pathname: '/project-detail', params: { id: projId } }) },
      { text: 'OK' },
    ]);
  }, [pendingLinkProject, buildLinkedEstimate, updateProject, router]);

  const handleOpenPDFPreSend = useCallback(() => {
    if (cart.length === 0) return;
    if (Platform.OS === 'ios') {
      setPendingCartModal('pdf');
      setShowCart(false);
    } else {
      setShowCart(false);
      setShowPDFPreSend(true);
    }
  }, [cart.length]);

  const handlePDFSend = useCallback(async (options: PDFSendOptions) => {
    if (cart.length === 0) return;
    setShowPDFPreSend(false);

    if (options.method === 'email' && options.recipient.trim()) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const emailHtml = buildEstimateEmailHtml({
        companyName: branding.companyName,
        recipientName: '',
        projectName: options.fileName || 'Estimate',
        grandTotal: cartTotal,
        itemCount: cart.length,
        message: options.message,
        contactName: branding.contactName,
        contactEmail: branding.email,
        contactPhone: branding.phone,
        growthBadge: isFree,
      });

      const tempProject: Project = {
        id: 'temp-email',
        name: options.fileName || 'Estimate',
        type: 'renovation',
        location: settings.location,
        squareFootage: 0,
        quality: 'standard',
        description: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        estimate: null,
        linkedEstimate: buildLinkedEstimate(),
        status: 'estimated',
      };
      const pdfUri = await generateEstimatePDFUri(tempProject, branding);

      const result = await sendEmail({
        to: options.recipient.trim(),
        subject: `Estimate: ${(() => { const v = grandTotal ?? 0; if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`; if (v >= 1_000) return `$${Math.round(v / 1_000)}K`; return `$${v.toLocaleString('en-US')}`; })()} · ${options.fileName || 'Project'}`,
        html: emailHtml,
        replyTo: branding.email || undefined,
        attachments: pdfUri ? [pdfUri] : undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: options.recipient.trim(), eventKey: 'estimate', enabled: true },
      });

      if (result.success) {
        Alert.alert('Email Sent', `Estimate emailed to ${options.recipient}`);
      } else if (result.error === 'cancelled') {
        return;
      } else {
        console.warn('[Estimate] Email send failed:', result.error);
        Alert.alert(
          'Email Issue',
          'Could not send via email. Would you like to share the PDF using another app instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Share PDF',
              onPress: async () => {
                try {
                  const uri = pdfUri ?? await generateEstimatePDFUri(tempProject, branding);
                  if (uri && await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(uri, {
                      mimeType: 'application/pdf',
                      dialogTitle: options.fileName || 'Estimate',
                      UTI: 'com.adobe.pdf',
                    });
                  }
                } catch (shareErr) {
                  console.error('[Estimate] Share fallback failed:', shareErr);
                }
              },
            },
          ]
        );
      }
      return;
    }

    const tempProject: Project = {
      id: 'temp',
      name: options.fileName || 'Estimate',
      type: 'renovation',
      location: settings.location,
      squareFootage: 0,
      quality: 'standard',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      estimate: null,
      linkedEstimate: buildLinkedEstimate(),
      status: 'estimated',
    };
    try {
      await generateAndSharePDF(tempProject, settings.branding ?? {
        companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
      }, 'share');
    } catch (e) {
      console.error('[Estimate] PDF share error:', e);
      Alert.alert('Error', 'Failed to generate PDF. Please try again.');
    }
  }, [cart, settings, buildLinkedEstimate, cartTotal, isFree]);

  const handleShareEmail = useCallback(() => {
    let text = '';
    if (settings.branding?.companyName) {
      text += `${settings.branding.companyName}\n`;
      if (settings.branding.tagline) text += `${settings.branding.tagline}\n`;
      text += '\n';
    }
    text += 'MAGE ID Estimate\n\n';
    cart.forEach(item => {
      const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const lineTotal = base * (1 + item.markup / 100) * item.quantity;
      text += `${item.material.name}\n`;
      text += `  Qty: ${item.quantity} | $${base.toFixed(2)}/${item.material.unit} | Markup: ${item.markup}% | Total: $${lineTotal.toFixed(2)}\n`;
    });
    text += `\nBase Cost: $${cartBaseTotal.toFixed(2)}\n`;
    text += `Markup: +$${markupTotal.toFixed(2)}\n`;
    text += `TOTAL: $${cartTotal.toFixed(2)}\n`;
    if (settings.branding?.contactName || settings.branding?.phone) {
      text += `\nContact: ${settings.branding?.contactName ?? ''} ${settings.branding?.phone ?? ''}\n`;
    }
    const subject = settings.branding?.companyName ? `${settings.branding.companyName} - Estimate` : 'MAGE ID Estimate';
    const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open email', 'Please check your email app is configured.');
    });
  }, [cart, cartBaseTotal, cartTotal, markupTotal, settings]);

  const handleShareText = useCallback(() => {
    let body = 'MAGE ID Estimate\n';
    body += `Total: $${cartTotal.toFixed(2)} (${cart.length} items)\n`;
    if (settings.branding?.companyName) body += `From: ${settings.branding.companyName}\n`;
    const url = Platform.OS === 'ios'
      ? `sms:&body=${encodeURIComponent(body)}`
      : `sms:?body=${encodeURIComponent(body)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Unable to open messages', 'Please check your messaging app.');
    });
  }, [cart, cartTotal, settings]);

  const applyGlobalMarkup = useCallback((val: number) => {
    // Context cascades to all cart items in a single write.
    ctxSetGlobalMarkup(val);
    setGlobalMarkupInput(String(val));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [ctxSetGlobalMarkup]);

  const cartItemInList = useCallback((id: string) => cart.find(i => i.material.id === id), [cart]);

  const renderMaterialCard = useCallback(({ item }: { item: MaterialItem }) => {
    const inCart = cartItemInList(item.id);
    const savings = item.baseRetailPrice > 0
      ? ((item.baseRetailPrice - item.baseBulkPrice) / item.baseRetailPrice * 100).toFixed(0)
      : '0';
    const catColor = getCategoryColor(item.category);
    const catLabel = CATEGORY_META[item.category]?.label ?? item.category;

    return (
      <View style={styles.materialCardWrapper}>
        <TouchableOpacity
          style={styles.materialCard}
          testID={`material-${item.id}`}
          onPress={() => openItemPopup(item)}
          activeOpacity={0.7}
        >
          <View style={styles.materialMain}>
            <View style={styles.materialInfo}>
              <Text style={styles.materialName} numberOfLines={2}>{item.name}</Text>
              <View style={styles.materialMeta}>
                <View style={[styles.categoryBadge, { backgroundColor: catColor + '22' }]}>
                  <Text style={[styles.categoryBadgeText, { color: catColor }]}>{catLabel}</Text>
                </View>
                {item.pricingModel === 'regional_adjusted' && (
                  <View style={styles.rsMeansBadge}>
                    <Database size={10} color={Colors.info} strokeWidth={1.75} />
                    <Text style={styles.rsMeansBadgeText}>Regional</Text>
                  </View>
                )}
                <View style={styles.supplierRow}>
                  <Truck size={10} color={Colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.supplierText}>{item.supplier}</Text>
                </View>
              </View>
            </View>

            <View style={[styles.addButton, inCart && styles.addButtonActive]}>
              {inCart
                ? <CheckCircle size={20} color={Colors.textOnPrimary} strokeWidth={1.75} />
                : <Plus size={20} color={Colors.textOnPrimary} strokeWidth={1.75} />
              }
            </View>
          </View>

          <View style={styles.priceRow}>
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Retail</Text>
              <Text style={styles.retailPrice}>${item.baseRetailPrice.toFixed(2)}</Text>
              <Text style={styles.priceUnit}>/{item.unit}</Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={styles.priceBlock}>
              <Text style={[styles.priceLabel, { color: Colors.success }]}>Bulk</Text>
              <Text style={styles.bulkPrice}>${item.baseBulkPrice.toFixed(2)}</Text>
              <Text style={styles.priceUnit}>/{item.unit}</Text>
            </View>
            <View style={styles.bulkSavingsBadge}>
              <Text style={styles.bulkSavingsText}>Save {savings}%</Text>
              <Text style={styles.bulkMinText}>min {item.bulkMinQty}</Text>
            </View>
          </View>

          <View style={styles.materialFooterRow}>
            <View style={styles.materialSignalGroup}>
              {item.region && (
                <View style={styles.materialSignalChip}>
                  <MapPin size={10} color={Colors.info} strokeWidth={1.75} />
                  <Text style={styles.materialSignalText}>{item.region}</Text>
                </View>
              )}
              {item.crew && item.specTier === 'assembly' && (
                <View style={styles.materialSignalChip}>
                  <Hammer size={10} color={Colors.warning} strokeWidth={1.75} />
                  <Text style={styles.materialSignalText}>{item.crew}</Text>
                </View>
              )}
              {typeof item.wasteFactor === 'number' && (
                <View style={styles.materialSignalChip}>
                  <Percent size={10} color={Colors.accent} strokeWidth={1.75} />
                  <Text style={styles.materialSignalText}>Waste {(item.wasteFactor * 100).toFixed(0)}%</Text>
                </View>
              )}
            </View>
            {inCart && (
              <View style={styles.inCartRow}>
                <CheckCircle size={13} color={Colors.success} strokeWidth={1.75} />
                <Text style={styles.inCartText}>In estimate · qty {inCart.quantity}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [cartItemInList, openItemPopup]);

  const renderCartItem = useCallback((item: CartItem) => {
    const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
    const lineTotal = base * (1 + item.markup / 100) * item.quantity;
    const isExpanded = expandedItem === item.material.id;
    const isCostExpanded = expandedCostBreakdown === item.material.id;

    const factors = CATEGORY_COST_FACTORS[item.material.category];
    const matCostPerUnit = base;
    const labCostPerUnit = item.material.laborCostPerUnit ?? (factors ? base * factors.laborFactor : 0);
    const eqCostPerUnit = item.material.equipmentCostPerUnit ?? (factors ? base * factors.equipmentFactor : 0);
    const installTrade = item.material.installTrade ?? factors?.installTrade ?? '';
    const installHrs = item.material.installHoursPerUnit ?? factors?.installHoursPerUnit ?? 0;

    return (
      <View key={item.material.id} style={styles.cartItem}>
        <TouchableOpacity
          style={styles.cartItemHeader}
          onPress={() => setExpandedItem(isExpanded ? null : item.material.id)}
          activeOpacity={0.7}
        >
          <View style={styles.cartItemLeft}>
            <Text style={styles.cartItemName} numberOfLines={1}>{item.material.name}</Text>
            <Text style={styles.cartItemSub}>
              ${base.toFixed(2)}/{item.material.unit} {item.usesBulk ? '· bulk rate' : '· retail rate'}
            </Text>
          </View>
          <View style={styles.cartItemRight}>
            <Text style={styles.cartItemTotal}>{formatMoney(lineTotal, 2)}</Text>
            {isExpanded ? <ChevronUp size={16} color={Colors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={16} color={Colors.textMuted} strokeWidth={1.75} />}
          </View>
        </TouchableOpacity>

        {(labCostPerUnit > 0 || eqCostPerUnit > 0) && (
          <TouchableOpacity
            style={styles.costBreakdownToggle}
            onPress={() => setExpandedCostBreakdown(isCostExpanded ? null : item.material.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.costBreakdownToggleText}>
              Mat: ${(matCostPerUnit * item.quantity).toFixed(0)} · Lab: ${(labCostPerUnit * item.quantity).toFixed(0)} · Eq: ${(eqCostPerUnit * item.quantity).toFixed(0)}
            </Text>
            {isCostExpanded ? <ChevronUp size={12} color={Colors.textMuted} strokeWidth={1.75} /> : <ChevronDown size={12} color={Colors.textMuted} strokeWidth={1.75} />}
          </TouchableOpacity>
        )}

        {isCostExpanded && (
          <View style={styles.costBreakdownPanel}>
            <View style={styles.costBreakdownRow}>
              <View style={[styles.costBreakdownDot, { backgroundColor: Colors.primary }]} />
              <Text style={styles.costBreakdownLabel}>Material</Text>
              <Text style={styles.costBreakdownRate}>${matCostPerUnit.toFixed(2)}/{item.material.unit}</Text>
              <Text style={styles.costBreakdownValue}>${(matCostPerUnit * item.quantity).toFixed(2)}</Text>
            </View>
            <View style={styles.costBreakdownRow}>
              <View style={[styles.costBreakdownDot, { backgroundColor: Colors.accent }]} />
              <Text style={styles.costBreakdownLabel}>Labor{installTrade ? ` (${installTrade})` : ''}</Text>
              <Text style={styles.costBreakdownRate}>${labCostPerUnit.toFixed(2)}/{item.material.unit}{installHrs > 0 ? ` · ${installHrs}hr` : ''}</Text>
              <Text style={styles.costBreakdownValue}>${(labCostPerUnit * item.quantity).toFixed(2)}</Text>
            </View>
            <View style={styles.costBreakdownRow}>
              <View style={[styles.costBreakdownDot, { backgroundColor: Colors.info }]} />
              <Text style={styles.costBreakdownLabel}>Equipment</Text>
              <Text style={styles.costBreakdownRate}>${eqCostPerUnit.toFixed(2)}/{item.material.unit}</Text>
              <Text style={styles.costBreakdownValue}>${(eqCostPerUnit * item.quantity).toFixed(2)}</Text>
            </View>
            <View style={styles.costBreakdownDivider} />
            <View style={styles.costBreakdownRow}>
              <View style={[styles.costBreakdownDot, { backgroundColor: 'transparent' }]} />
              <Text style={[styles.costBreakdownLabel, { fontWeight: '700' as const, color: Colors.text }]}>All-In Total</Text>
              <Text style={styles.costBreakdownRate} />
              <Text style={[styles.costBreakdownValue, { fontWeight: '700' as const, color: Colors.primary }]}>
                ${((matCostPerUnit + labCostPerUnit + eqCostPerUnit) * item.quantity).toFixed(2)}
              </Text>
            </View>
          </View>
        )}

        {isExpanded && (
          <View style={styles.cartItemExpanded}>
            <View style={styles.cartQtyRow}>
              <Text style={styles.cartExpandLabel}>Quantity</Text>
              <View style={styles.qtyControl}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQuantity(item.material.id, -1)} accessibilityRole="button" accessibilityLabel="Remove">
                  <Minus size={14} color={Colors.primary} strokeWidth={1.75} />
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQuantity(item.material.id, 1)} accessibilityRole="button" accessibilityLabel="Add">
                  <Plus size={14} color={Colors.primary} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.cartQtyRow}>
              <Text style={styles.cartExpandLabel}>Markup %</Text>
              <View style={styles.markupMiniRow}>
                {[0, 10, 15, 20, 25].map(v => (
                  <TouchableOpacity
                    key={v}
                    style={[styles.markupMiniChip, item.markup === v && styles.markupMiniChipActive]}
                    onPress={() => updateItemMarkup(item.material.id, v)}
                  >
                    <Text style={[styles.markupMiniText, item.markup === v && styles.markupMiniTextActive]}>
                      {v}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {item.quantity >= item.material.bulkMinQty && (
              <View style={styles.bulkActiveBanner}>
                <CheckCircle size={13} color={Colors.success} strokeWidth={1.75} />
                <Text style={styles.bulkActiveTxt}>Bulk discount applied — min {item.material.bulkMinQty} {item.material.unit}</Text>
              </View>
            )}

            <TouchableOpacity style={styles.removeBtn} onPress={() => removeFromCart(item.material.id)}>
              <Trash2 size={14} color={Colors.error} strokeWidth={1.75} />
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [expandedItem, expandedCostBreakdown, updateQuantity, updateItemMarkup, removeFromCart]);

  const listHeaderComponent = useMemo(() => (
    <View>
      {/* Build-by-voice — the flagship phone-create path, shown when a project is
          selected (voice-build prices from that project's cost history). Leads
          the hero stack so it reads as the fastest way to make an estimate. */}
      {!!selectedProjectId && (
        <TouchableOpacity
          style={styles.wizardCta}
          onPress={() => router.push({ pathname: '/copilot', params: { capabilityId: 'estimate', projectId: selectedProjectId } } as never)}
          activeOpacity={0.85}
          testID="estimate-voice-cta"
        >
          <View style={styles.wizardCtaIcon}>
            <Mic size={18} color={Colors.surface} strokeWidth={2} />
          </View>
          <View style={styles.wizardCtaText}>
            <Text style={styles.wizardCtaTitle}>Build by voice</Text>
            <Text style={styles.wizardCtaSubtitle}>Say the scope — MAGE prices it from your past jobs</Text>
          </View>
          <ChevronRight size={18} color={Colors.surface} strokeWidth={1.75} />
        </TouchableOpacity>
      )}
      {/* Edit-by-voice — only once the selected project HAS an estimate. Say a
          change ("drop the tile to $10/sf, bump markup to 20%") → see the new
          total → apply undo-safely. */}
      {!!selectedProjectId && !!projects.find(p => p.id === selectedProjectId)?.linkedEstimate && (
        <TouchableOpacity
          style={styles.wizardCta}
          onPress={() => router.push({ pathname: '/copilot', params: { capabilityId: 'estimateEdit', projectId: selectedProjectId } } as never)}
          activeOpacity={0.85}
          testID="estimate-edit-voice-cta"
        >
          <View style={styles.wizardCtaIcon}>
            <Mic size={18} color={Colors.surface} strokeWidth={2} />
          </View>
          <View style={styles.wizardCtaText}>
            <Text style={styles.wizardCtaTitle}>Edit by voice</Text>
            <Text style={styles.wizardCtaSubtitle}>Say a change — MAGE shows the new total before it sticks</Text>
          </View>
          <ChevronRight size={18} color={Colors.surface} strokeWidth={1.75} />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.wizardCta}
        onPress={() => router.push({ pathname: '/estimate-wizard', params: selectedProjectId ? { projectId: selectedProjectId } : {} } as any)}
        activeOpacity={0.85}
        testID="wizard-cta"
      >
        <View style={styles.wizardCtaIcon}>
          <MageAIMark size={18} color={Colors.surface} />
        </View>
        <View style={styles.wizardCtaText}>
          <Text style={styles.wizardCtaTitle}>Quick Estimate Wizard</Text>
          <Text style={styles.wizardCtaSubtitle}>Answer 8 questions, get an AI-generated estimate</Text>
        </View>
        <ChevronRight size={18} color={Colors.surface} strokeWidth={1.75} />
      </TouchableOpacity>
      {/* Takeoff AI — second hero CTA. Pre-fix this lived as a tiny
          "Takeoff" pill in the header action row, easy to miss. AI takeoff
          is one of the flagship Pro features (it's why Procore added their
          BIMscale acquisition); it deserves the same visual weight as the
          Quick Estimate Wizard. Same shape, accent color shifts to teal so
          the two CTAs are visually distinguishable at a glance. */}
      <TouchableOpacity
        style={styles.takeoffCta}
        onPress={() => router.push('/takeoff' as never)}
        activeOpacity={0.85}
        testID="takeoff-cta"
      >
        <View style={styles.takeoffCtaIcon}>
          <Ruler size={18} color={Colors.surface} strokeWidth={1.75} />
        </View>
        <View style={styles.takeoffCtaText}>
          <Text style={styles.takeoffCtaTitle}>AI Quantity Takeoff</Text>
          <Text style={styles.takeoffCtaSubtitle}>Upload plan sheets — AI counts walls, doors, fixtures, finishes</Text>
        </View>
        <ChevronRight size={18} color={Colors.surface} strokeWidth={1.75} />
      </TouchableOpacity>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.headerTitle}>Estimator</Text>
            <View style={styles.liveRow}>
              <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.liveLabel}>{totalMaterialCount.toLocaleString()} materials · live</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.aiEstimateBtn}
              onPress={() => router.push('/drawing-analyzer' as never)}
              activeOpacity={0.8}
              testID="drawing-analyzer-btn"
            >
              <FileUp size={13} color={Colors.textOnPrimary} strokeWidth={1.75} />
              <Text style={styles.aiEstimateBtnText}>Plans</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.aiEstimateBtn}
              onPress={() => router.push('/takeoff' as never)}
              activeOpacity={0.8}
              testID="takeoff-btn"
            >
              <Ruler size={13} color={Colors.textOnPrimary} strokeWidth={1.75} />
              <Text style={styles.aiEstimateBtnText}>Takeoff</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.aiEstimateBtn}
              onPress={() => {
                if (canAccess('cost_xray')) {
                  router.push({ pathname: '/cost-xray', params: { projectId: selectedProjectId ?? '' } } as never);
                } else {
                  router.push('/paywall' as never);
                }
              }}
              activeOpacity={0.8}
              testID="cost-xray-btn"
            >
              <ScanSearch size={13} color={Colors.textOnPrimary} strokeWidth={1.75} />
              <Text style={styles.aiEstimateBtnText}>Hidden costs</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.aiEstimateBtn}
              onPress={() => setShowAIQuickEstimate(true)}
              activeOpacity={0.8}
              testID="ai-quick-estimate-btn"
            >
              <MageAIMark size={13} color={Colors.textOnPrimary} />
              <Text style={styles.aiEstimateBtnText}>AI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={() => setShowSqftEstimator(true)}
              activeOpacity={0.7}
              testID="quick-estimate-btn"
            >
              <Calculator size={15} color={Colors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={() => setShowProductivityCalc(true)}
              activeOpacity={0.7}
              testID="productivity-btn"
            >
              <Gauge size={15} color={Colors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={refreshPrices}
              activeOpacity={0.7}
              testID="refresh-btn" accessibilityRole="button" accessibilityLabel="Refresh"><RefreshCw size={15} color={Colors.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
            <TouchableOpacity
              style={styles.cartButton}
              onPress={() => setShowCart(true)}
              activeOpacity={0.8}
              testID="cart-btn"
            >
              <Animated.View style={{ transform: [{ scale: cartAnim }] }}>
                <ShoppingCart size={20} color={Colors.surface} strokeWidth={1.75} />
              </Animated.View>
              {totalItemCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{totalItemCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.tabRow}>
          {[
            { id: 'materials' as EstimateTab, label: 'Materials', icon: Package, count: cart.length },
            { id: 'labor' as EstimateTab, label: 'Labor', icon: HardHat, count: laborCart.length },
            { id: 'assemblies' as EstimateTab, label: 'Assemblies', icon: Boxes, count: assemblyCart.length },
            { id: 'templates' as EstimateTab, label: 'Templates', icon: ClipboardList, count: 0 },
          ].map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tabItem, isActive && styles.tabItemActive]}
                onPress={() => { setActiveTab(tab.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
                activeOpacity={0.7}
              >
                <TabIcon size={14} color={isActive ? Colors.primary : Colors.textMuted} />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
                {tab.count > 0 && (
                  <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                    <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>{tab.count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {activeTab === 'materials' && <View style={[styles.searchBar, isSearchFocused && styles.searchBarFocused]}>
          <Search size={18} color={isSearchFocused ? Colors.primary : Colors.textMuted} strokeWidth={1.75} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search lumber, insulation, HVAC..."
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            selectionColor={Colors.primary}
            underlineColorAndroid="transparent"
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            returnKeyType="search"
            testID="search-input"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close">
              <X size={16} color={Colors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
        </View>}

        {activeTab === 'materials' && <View style={styles.markupRow}>
          <Percent size={14} color={Colors.accent} strokeWidth={1.75} />
          <Text style={styles.markupLabel}>Markup:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.markupPresets}>
            {MARKUP_PRESETS.map(p => (
              <TouchableOpacity
                key={p.value}
                style={[styles.markupChip, globalMarkup === p.value && styles.markupChipActive]}
                onPress={() => applyGlobalMarkup(p.value)}
              >
                <Text style={[styles.markupChipText, globalMarkup === p.value && styles.markupChipTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.markupCustom}>
              <TextInput
                style={styles.markupCustomInput}
                value={globalMarkupInput}
                onChangeText={v => {
                  setGlobalMarkupInput(v);
                  const n = parseFloat(v);
                  if (!isNaN(n) && n >= 0 && n <= 200) {
                    // setGlobalMarkup cascades to all cart items in one write.
                    ctxSetGlobalMarkup(n);
                  }
                }}
                keyboardType="numeric"
                placeholder="Custom"
                placeholderTextColor={Colors.textMuted}
                testID="markup-input"
              />
              <Text style={styles.markupCustomSuffix}>%</Text>
            </View>
          </ScrollView>
        </View>}
      </View>

      {activeTab === 'materials' && <View style={styles.categoriesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContent}>
          {CATEGORY_CHIPS.map(cat => {
            const IconComp = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => {
                  setActiveCategory(cat.id);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.7}
                testID={`cat-${cat.id}`}
              >
                <IconComp size={13} color={isActive ? Colors.textOnPrimary : Colors.textSecondary} />
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>}

      {activeTab === 'materials' && <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>
          {filteredMaterials.length} result{filteredMaterials.length !== 1 ? 's' : ''}
          {query ? ` for "${query}"` : ''}
        </Text>
        <Text style={styles.resultsMicroCopy}>{regionalVisibleCount.toLocaleString()} regional</Text>
      </View>}

      {activeTab === 'materials' && !query && recentMaterials.length > 0 && (
        <View style={aiStyles.recentSection}>
          <View style={aiStyles.recentHeader}>
            <History size={14} color={Colors.textSecondary} strokeWidth={1.75} />
            <Text style={aiStyles.recentTitle}>Recently Used</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={aiStyles.recentChipsRow}>
            {recentMaterials.slice(0, 10).map((item, idx) => (
              <TouchableOpacity
                key={`${item.id}-${idx}`}
                style={aiStyles.recentChip}
                onPress={() => handleAddRecentToCart(item)}
                activeOpacity={0.7}
              >
                <Text style={aiStyles.recentChipName} numberOfLines={1}>{item.name}</Text>
                <Text style={aiStyles.recentChipPrice}>${item.unitPrice.toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {activeTab === 'materials' && !query && popularMaterials.length > 0 && (
        <View style={aiStyles.recentSection}>
          <View style={aiStyles.recentHeader}>
            <Star size={14} color={Colors.accent} strokeWidth={1.75} />
            <Text style={aiStyles.recentTitle}>Frequently Used</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={aiStyles.recentChipsRow}>
            {popularMaterials.slice(0, 10).map((item, idx) => (
              <TouchableOpacity
                key={`${item.id}-${idx}`}
                style={[aiStyles.recentChip, { borderColor: Colors.accent + '30' }]}
                onPress={() => {
                  const found = materials.find(m => m.name.toLowerCase().includes(item.name.toLowerCase().slice(0, 20)));
                  if (found) openItemPopup(found);
                }}
                activeOpacity={0.7}
              >
                <Text style={aiStyles.recentChipName} numberOfLines={1}>{item.name}</Text>
                <Text style={aiStyles.recentChipPrice}>${item.unitPrice.toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {activeTab === 'materials' && query.trim().length > 0 && filteredMaterials.length < 3 && !showAiResults && (
        <View style={aiStyles.aiSearchPrompt}>
          <View style={aiStyles.aiSearchPromptIcon}>
            <MageAIMark size={20} color={Colors.primary} />
          </View>
          <View style={aiStyles.aiSearchPromptContent}>
            <Text style={aiStyles.aiSearchPromptTitle}>Can't find what you need?</Text>
            <Text style={aiStyles.aiSearchPromptDesc}>AI will search suppliers for real-time pricing</Text>
          </View>
          <TouchableOpacity style={aiStyles.aiSearchBtn} onPress={handleAiSearch} activeOpacity={0.8}>
            <Wifi size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
            <Text style={aiStyles.aiSearchBtnText}>Search Live</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'materials' && showAiResults && (
        <View style={aiStyles.aiResultsContainer}>
          <View style={aiStyles.aiResultsHeader}>
            <View style={aiStyles.aiResultsTitleRow}>
              <MageAIMark size={14} color={Colors.primary} />
              <Text style={aiStyles.aiResultsTitle}>Live Search: "{query}"</Text>
            </View>
            <TouchableOpacity onPress={() => { setShowAiResults(false); setAiSearchResults([]); }} accessibilityRole="button" accessibilityLabel="Close">
              <X size={16} color={Colors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
          {isAiSearching && (
            <View style={aiStyles.aiLoadingRow}>
              <Animated.View style={[styles.liveDot, { backgroundColor: Colors.primary, transform: [{ scale: pulseAnim }] }]} />
              <Text style={aiStyles.aiLoadingText}>Searching suppliers...</Text>
            </View>
          )}
          {aiSearchError && (
            <View style={aiStyles.aiErrorRow}>
              <AlertTriangle size={14} color={Colors.error} strokeWidth={1.75} />
              <Text style={aiStyles.aiErrorText}>{aiSearchError}</Text>
            </View>
          )}
          {aiSearchResults.map((aiMat, idx) => {
            const confColor = aiMat.priceConfidence === 'high' ? Colors.success : aiMat.priceConfidence === 'medium' ? Colors.warning : Colors.textMuted;
            return (
              <View key={`ai-${idx}`} style={aiStyles.aiResultCard}>
                <View style={aiStyles.aiResultMain}>
                  <View style={{ flex: 1 }}>
                    <Text style={aiStyles.aiResultName}>{aiMat.name}</Text>
                    <View style={aiStyles.aiResultMeta}>
                      <Text style={aiStyles.aiResultPrice}>${aiMat.unitPrice.toFixed(2)}/{aiMat.unit}</Text>
                      {aiMat.brand && <Text style={aiStyles.aiResultBrand}>{aiMat.brand}</Text>}
                    </View>
                    <View style={aiStyles.aiResultTags}>
                      <View style={[aiStyles.aiSourceTag, { backgroundColor: '#FF6A1A18' }]}>
                        <MageAIMark size={9} color="#FF6A1A" />
                        <Text style={[aiStyles.aiSourceTagText, { color: '#FF6A1A' }]}>AI Found</Text>
                      </View>
                      <View style={[aiStyles.aiConfBadge, { backgroundColor: confColor + '18' }]}>
                        <View style={[aiStyles.aiConfDot, { backgroundColor: confColor }]} />
                        <Text style={[aiStyles.aiConfText, { color: confColor }]}>{aiMat.priceConfidence}</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity style={aiStyles.aiAddBtn} onPress={() => handleAddAiMaterial(aiMat)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Add">
                    <Plus size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                {aiMat.description && <Text style={aiStyles.aiResultDesc} numberOfLines={2}>{aiMat.description}</Text>}
              </View>
            );
          })}
          {aiSearchResults.length > 0 && aiSearchResults[0].relatedItems.length > 0 && (
            <View style={aiStyles.aiRelatedRow}>
              <MageAIMark size={12} color={Colors.info} />
              <Text style={aiStyles.aiRelatedText}>Related: {aiSearchResults[0].relatedItems.slice(0, 4).join(', ')}</Text>
            </View>
          )}
        </View>
      )}

      {activeTab === 'materials' && (
        <TouchableOpacity style={aiStyles.customEntryBtn} onPress={() => setShowCustomForm(true)} activeOpacity={0.7}>
          <PlusCircle size={14} color={Colors.primary} strokeWidth={1.75} />
          <Text style={aiStyles.customEntryBtnText}>Add Custom Material</Text>
          <ChevronRight size={14} color={Colors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      )}

      {activeTab === 'materials' && cart.length > 0 && (
        <View style={styles.opportunityPanel} testID="opportunity-panel">
          <View style={styles.opportunityHeader}>
            <View style={styles.opportunityTitleWrap}>
              <Clock3 size={14} color={Colors.info} strokeWidth={1.75} />
              <Text style={styles.opportunityTitle}>Blindspot Radar</Text>
            </View>
            <Text style={styles.opportunitySubtitle}>Live basket</Text>
          </View>
          <View style={styles.opportunityGrid}>
            {opportunities.map(item => {
              const IconComp = item.icon;
              const toneColor = item.tone === 'positive' ? Colors.success : item.tone === 'warning' ? Colors.warning : Colors.info;
              const toneBg = item.tone === 'positive' ? Colors.successLight : item.tone === 'warning' ? Colors.warningLight : Colors.infoLight;
              return (
                <View key={item.id} style={[styles.opportunityCard, { backgroundColor: toneBg }]}>
                  <View style={styles.opportunityCardTop}>
                    <IconComp size={14} color={toneColor} />
                    <Text style={[styles.opportunityCardTitle, { color: toneColor }]}>{item.title}</Text>
                  </View>
                  <Text style={styles.opportunityCardDetail}>{item.detail}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  ), [materials.length, totalMaterialCount, pulseAnim, refreshPrices, cart.length, totalItemCount, cartAnim, isSearchFocused, query, globalMarkup, globalMarkupInput, applyGlobalMarkup, activeCategory, activeTab, filteredMaterials.length, regionalVisibleCount, opportunities, laborCart.length, assemblyCart.length, recentMaterials, popularMaterials, showAiResults, isAiSearching, aiSearchError, aiSearchResults, handleAiSearch, handleAddAiMaterial, handleAddRecentToCart, router, ctxSetGlobalMarkup, materials, openItemPopup, selectedProjectId]);

  const renderLaborCard = useCallback(({ item }: { item: LaborRate }) => {
    const inCart = laborCart.find(i => i.labor.id === item.id);
    return (
      <View style={styles.materialCardWrapper}>
        <TouchableOpacity style={styles.materialCard} onPress={() => openLaborPopup(item)} activeOpacity={0.7}>
          <View style={styles.materialMain}>
            <View style={styles.materialInfo}>
              <Text style={styles.materialName}>{item.trade}</Text>
              <View style={styles.materialMeta}>
                <View style={[styles.categoryBadge, { backgroundColor: Colors.accent + '22' }]}>
                  <Text style={[styles.categoryBadgeText, { color: Colors.accent }]}>{item.category}</Text>
                </View>
                <View style={styles.supplierRow}>
                  <Ruler size={10} color={Colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.supplierText}>${item.rateRange.low}-${item.rateRange.high}/hr</Text>
                </View>
              </View>
            </View>
            <View style={[styles.addButton, inCart && styles.addButtonActive]}>
              {inCart ? <CheckCircle size={20} color={Colors.textOnPrimary} strokeWidth={1.75} /> : <Plus size={20} color={Colors.textOnPrimary} strokeWidth={1.75} />}
            </View>
          </View>
          <View style={styles.priceRow}>
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Median</Text>
              <Text style={styles.bulkPrice}>${item.hourlyRate.toFixed(2)}</Text>
              <Text style={styles.priceUnit}>/hr</Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Source</Text>
              <View style={styles.rsMeansBadge}>
                <Database size={10} color={Colors.info} strokeWidth={1.75} />
                <Text style={styles.rsMeansBadgeText}>BLS Data</Text>
              </View>
            </View>
          </View>
          <View style={styles.materialFooterRow}>
            <View style={styles.materialSignalGroup}>
              <View style={styles.materialSignalChip}>
                <HardHat size={10} color={Colors.accent} strokeWidth={1.75} />
                <Text style={styles.materialSignalText}>{item.crew}</Text>
              </View>
              <View style={styles.materialSignalChip}>
                <Clock3 size={10} color={Colors.info} strokeWidth={1.75} />
                <Text style={styles.materialSignalText}>{item.dailyOutput}</Text>
              </View>
              {item.wageType !== 'open_shop' && (
                <View style={[styles.materialSignalChip, { backgroundColor: Colors.warningLight }]}>
                  <Text style={[styles.materialSignalText, { color: Colors.warning }]}>{item.wageType === 'union' ? 'Union' : 'Blended'}</Text>
                </View>
              )}
            </View>
            {inCart && (
              <View style={styles.inCartRow}>
                <CheckCircle size={13} color={Colors.success} strokeWidth={1.75} />
                <Text style={styles.inCartText}>{inCart.hours} hrs · ${(inCart.adjustedRate * inCart.hours).toFixed(2)}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [laborCart, openLaborPopup]);

  const renderAssemblyCard = useCallback(({ item }: { item: AssemblyItem }) => {
    const inCart = assemblyCart.find(i => i.assembly.id === item.id);
    const sampleCost = calculateAssemblyCost(item, 1);
    const isCustom = (item as AssemblyItem & { __custom?: boolean }).__custom === true;
    return (
      <View style={styles.materialCardWrapper}>
        <TouchableOpacity style={styles.materialCard} onPress={() => openAssemblyPopup(item)} activeOpacity={0.7}>
          <View style={styles.materialMain}>
            <View style={styles.materialInfo}>
              <Text style={styles.materialName}>{item.name}</Text>
              <Text style={styles.supplierText} numberOfLines={2}>{item.description}</Text>
            </View>
            <View style={[styles.addButton, inCart && styles.addButtonActive]}>
              {inCart ? <CheckCircle size={20} color={Colors.textOnPrimary} strokeWidth={1.75} /> : <Plus size={20} color={Colors.textOnPrimary} strokeWidth={1.75} />}
            </View>
          </View>
          <View style={styles.priceRow}>
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Per Unit</Text>
              <Text style={styles.bulkPrice}>${sampleCost.totalCost.toFixed(2)}</Text>
              <Text style={styles.priceUnit}>/{item.unit.replace('per ', '')}</Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.priceLabel, { fontSize: 9 }]}>Mat: ${sampleCost.materialsCost.toFixed(2)}</Text>
              <Text style={[styles.priceLabel, { fontSize: 9, color: Colors.accent }]}>Lab: ${sampleCost.laborCost.toFixed(2)}</Text>
            </View>
          </View>
          <View style={styles.materialFooterRow}>
            <View style={styles.materialSignalGroup}>
              {isCustom && (
                <View style={[styles.categoryBadge, { backgroundColor: Colors.success + '20' }]}>
                  <Text style={[styles.categoryBadgeText, { color: Colors.success }]}>Custom</Text>
                </View>
              )}
              <View style={[styles.categoryBadge, { backgroundColor: Colors.primary + '15' }]}>
                <Text style={[styles.categoryBadgeText, { color: Colors.primary }]}>{item.category}</Text>
              </View>
              <View style={styles.materialSignalChip}>
                <Text style={styles.materialSignalText}>{item.unit}</Text>
              </View>
              {item.laborPerUnit.map((l, i) => (
                <View key={`${l.trade}-${i}`} style={styles.materialSignalChip}>
                  <HardHat size={10} color={Colors.accent} strokeWidth={1.75} />
                  <Text style={styles.materialSignalText}>{l.trade}</Text>
                </View>
              ))}
            </View>
            {inCart && (
              <View style={styles.inCartRow}>
                <CheckCircle size={13} color={Colors.success} strokeWidth={1.75} />
                <Text style={styles.inCartText}>qty {inCart.quantity}</Text>
              </View>
            )}
          </View>
          {/* Edit / Delete affordances — custom items only */}
          {isCustom && (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.cardBorder }}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: Colors.primary + '12' }}
                onPress={() => {
                  // Strip __custom before passing to editor
                  const { __custom: _c, ...clean } = item as AssemblyItem & { __custom?: boolean };
                  setEditorInitial(clean as AssemblyItem);
                  setEditorVisible(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.primary }}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: Colors.error + '12' }}
                onPress={() => {
                  Alert.alert(
                    'Delete assembly?',
                    `Remove "${item.name}" from your custom assemblies?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => void deleteCustomAssembly(item.id) },
                    ],
                  );
                }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.error }}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  }, [assemblyCart, openAssemblyPopup, calculateAssemblyCost, deleteCustomAssembly]);

  const renderTemplateCard = useCallback(({ item }: { item: EstimateTemplate }) => {
    return (
      <View style={styles.materialCardWrapper}>
        <TouchableOpacity style={styles.materialCard} onPress={() => handleLoadTemplate(item)} activeOpacity={0.7}>
          <View style={styles.materialMain}>
            <View style={styles.materialInfo}>
              <Text style={styles.materialName}>{item.name}</Text>
              <Text style={styles.supplierText} numberOfLines={2}>{item.description}</Text>
            </View>
            <View style={styles.addButton}>
              <Plus size={20} color={Colors.textOnPrimary} strokeWidth={1.75} />
            </View>
          </View>
          <View style={styles.priceRow}>
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Range</Text>
              <Text style={styles.bulkPrice}>{item.priceRange}</Text>
            </View>
            <View style={styles.priceDivider} />
            <View style={styles.priceBlock}>
              <Text style={styles.priceLabel}>Assemblies</Text>
              <Text style={styles.retailPrice}>{item.assemblies.length}</Text>
            </View>
          </View>
          <View style={styles.materialFooterRow}>
            <View style={styles.materialSignalGroup}>
              <View style={[styles.categoryBadge, { backgroundColor: Colors.info + '15' }]}>
                <Text style={[styles.categoryBadgeText, { color: Colors.info }]}>{item.category}</Text>
              </View>
              {item.defaultSqft > 0 && (
                <View style={styles.materialSignalChip}>
                  <Ruler size={10} color={Colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.materialSignalText}>{item.defaultSqft} SF</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [handleLoadTemplate]);

  const laborListHeader = useMemo(() => (
    <View>
      {listHeaderComponent}
      <View style={styles.categoriesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContent}>
          {LABOR_CATEGORIES.map(cat => {
            const isActive = laborCategory === cat.id;
            return (
              <TouchableOpacity key={cat.id} style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => { setLaborCategory(cat.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }} activeOpacity={0.7}>
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>{filteredLabor.length} trade{filteredLabor.length !== 1 ? 's' : ''}</Text>
        <Text style={styles.resultsMicroCopy}>BLS national median rates</Text>
      </View>
      {/* "Cost book / My rates" — opens RateOverrideModal */}
      <TouchableOpacity
        style={aiStyles.customEntryBtn}
        onPress={() => setCostBookOpen(true)}
        activeOpacity={0.7}
      >
        <PlusCircle size={14} color={Colors.primary} strokeWidth={1.75} />
        <Text style={aiStyles.customEntryBtnText}>Cost book / My rates</Text>
        <ChevronRight size={14} color={Colors.textMuted} strokeWidth={1.75} />
      </TouchableOpacity>
    </View>
  ), [listHeaderComponent, laborCategory, filteredLabor.length, setCostBookOpen]);

  const assemblyListHeader = useMemo(() => (
    <View>
      {listHeaderComponent}
      <View style={styles.categoriesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContent}>
          {ASSEMBLY_CATEGORIES.map(cat => {
            const isActive = assemblyCategory === cat.id;
            return (
              <TouchableOpacity key={cat.id} style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => { setAssemblyCategory(cat.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }} activeOpacity={0.7}>
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>{filteredAssemblies.length} assembl{filteredAssemblies.length !== 1 ? 'ies' : 'y'}</Text>
        <Text style={styles.resultsMicroCopy}>Materials + Labor bundled</Text>
      </View>
      {/* "+ New assembly" — opens AssemblyEditorModal in create mode */}
      <TouchableOpacity
        style={aiStyles.customEntryBtn}
        onPress={() => { setEditorInitial(null); setEditorVisible(true); }}
        activeOpacity={0.7}
      >
        <PlusCircle size={14} color={Colors.primary} strokeWidth={1.75} />
        <Text style={aiStyles.customEntryBtnText}>New assembly</Text>
        <ChevronRight size={14} color={Colors.textMuted} strokeWidth={1.75} />
      </TouchableOpacity>
    </View>
  ), [listHeaderComponent, assemblyCategory, filteredAssemblies.length]);

  const templateListHeader = useMemo(() => (
    <View>
      {listHeaderComponent}
      <View style={styles.categoriesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesContent}>
          {TEMPLATE_CATEGORIES.map(cat => {
            const isActive = templateCategory === cat.id;
            return (
              <TouchableOpacity key={cat.id} style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                onPress={() => { setTemplateCategory(cat.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }} activeOpacity={0.7}>
                <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>{filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}</Text>
        <Text style={styles.resultsMicroCopy}>Quick-start your estimate</Text>
      </View>
    </View>
  ), [listHeaderComponent, templateCategory, filteredTemplates.length]);

  if (layout.isDesktop) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={dStyles.desktopHeader}>
          <View>
            <Text style={[styles.headerTitle, { fontSize: 24 }]}>Estimator</Text>
            <View style={styles.liveRow}>
              <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.liveLabel}>{totalMaterialCount.toLocaleString()} materials</Text>
            </View>
          </View>
          {/* Tabs widened — bigger font + padding so the four labels
              (Materials / Labor / Assemblies / Templates) stop squishing
              into the header. flex:1 lets them claim the slack between
              title and action buttons. */}
          <View style={[styles.tabRow, dStyles.desktopTabRow]}>
            {[
              { id: 'materials' as EstimateTab, label: 'Materials', icon: Package, count: cart.length },
              { id: 'labor' as EstimateTab, label: 'Labor', icon: HardHat, count: laborCart.length },
              { id: 'assemblies' as EstimateTab, label: 'Assemblies', icon: Boxes, count: assemblyCart.length },
              { id: 'templates' as EstimateTab, label: 'Templates', icon: ClipboardList, count: 0 },
            ].map(tab => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <TouchableOpacity
                  key={tab.id}
                  style={[styles.tabItem, dStyles.desktopTabItem, isActive && styles.tabItemActive]}
                  onPress={() => { setActiveTab(tab.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
                  activeOpacity={0.7}
                >
                  <TabIcon size={15} color={isActive ? Colors.primary : Colors.textMuted} />
                  <Text style={[styles.tabLabel, dStyles.desktopTabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
                  {tab.count > 0 && (
                    <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                      <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>{tab.count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.headerActions}>
            {/* Quick Estimate Wizard — paired with AI Takeoff as the two
                primary entry points on desktop. Both use the same shape
                so they read as a pair, distinct from the secondary
                icon-only buttons (Calculator / Gauge / Refresh / Cart). */}
            {!!selectedProjectId && (
              <TouchableOpacity
                style={dStyles.desktopWizardBtn}
                onPress={() => router.push({ pathname: '/copilot', params: { capabilityId: 'estimate', projectId: selectedProjectId } } as never)}
                activeOpacity={0.85}
                testID="desktop-estimate-voice-cta"
              >
                <Mic size={14} color={Colors.surface} strokeWidth={2} />
                <Text style={dStyles.desktopHeroBtnText}>Voice</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={dStyles.desktopWizardBtn}
              onPress={() => router.push({ pathname: '/estimate-wizard', params: selectedProjectId ? { projectId: selectedProjectId } : {} } as any)}
              activeOpacity={0.85}
              testID="desktop-wizard-cta"
            >
              <MageAIMark size={14} color={Colors.surface} />
              <Text style={dStyles.desktopHeroBtnText}>Wizard</Text>
            </TouchableOpacity>
            {/* AI Takeoff — purple hero button, replaces the spot the
                green cart used to occupy. Pre-fix the only entry point
                on desktop was a tiny pill in the mobile-only header
                that wasn't rendered here at all, so the takeoff feature
                was effectively invisible on web. */}
            <TouchableOpacity
              style={dStyles.desktopTakeoffBtn}
              onPress={() => router.push('/takeoff' as never)}
              activeOpacity={0.85}
              testID="desktop-takeoff-cta"
            >
              <Ruler size={14} color={Colors.surface} strokeWidth={1.75} />
              <Text style={dStyles.desktopHeroBtnText}>AI Takeoff</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshIconBtn} onPress={() => setShowSqftEstimator(true)} activeOpacity={0.7}>
              <Calculator size={15} color={Colors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshIconBtn} onPress={() => setShowProductivityCalc(true)} activeOpacity={0.7}>
              <Gauge size={15} color={Colors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshIconBtn} onPress={refreshPrices} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Refresh"><RefreshCw size={15} color={Colors.textSecondary} strokeWidth={1.75} /></TouchableOpacity>
            {/* Cart demoted to the same icon-only treatment as the
                other utility buttons. Cost Summary on the right column
                already shows totals in real time, so the dedicated cart
                button was duplicating that info on desktop. The badge
                still surfaces total item count for quick at-a-glance. */}
            <TouchableOpacity
              style={[styles.refreshIconBtn, totalItemCount > 0 && dStyles.cartIconBtnActive]}
              onPress={() => setShowCart(true)}
              activeOpacity={0.7}
              testID="desktop-cart-btn"
            >
              <ShoppingCart size={15} color={totalItemCount > 0 ? Colors.primary : Colors.textSecondary} strokeWidth={1.75} />
              {totalItemCount > 0 && (
                <View style={dStyles.cartIconBadge}>
                  <Text style={dStyles.cartIconBadgeText}>{totalItemCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={dStyles.desktopBody}>
          <View style={dStyles.catalogPanel}>
            {activeTab === 'materials' && (
              <>
                <View style={[styles.searchBar, { marginHorizontal: 12, marginTop: 12 }]}>
                  <Search size={18} color={Colors.textMuted} strokeWidth={1.75} />
                  <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search materials..."
                    placeholderTextColor={Colors.textMuted}
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  {query.length > 0 && (
                    <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Close">
                      <X size={16} color={Colors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}
                </View>
                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                  <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {CATEGORY_CHIPS.map(cat => {
                        const IconComp = cat.icon;
                        const isActive = activeCategory === cat.id;
                        return (
                          <TouchableOpacity
                            key={cat.id}
                            style={[styles.categoryChip, isActive && styles.categoryChipActive, { paddingHorizontal: 8, paddingVertical: 5 }]}
                            onPress={() => setActiveCategory(cat.id)}
                            activeOpacity={0.7}
                          >
                            <IconComp size={11} color={isActive ? Colors.textOnPrimary : Colors.textSecondary} />
                            <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive, { fontSize: 10 }]}>{cat.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <Text style={[styles.resultsCount, { paddingHorizontal: 12 }]}>{filteredMaterials.length} results</Text>
                  {filteredMaterials.slice(0, 50).map(item => {
                    const inCart = cartItemInList(item.id);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={dStyles.catalogItem}
                        onPress={() => openItemPopup(item)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={dStyles.catalogItemName} numberOfLines={1}>{item.name}</Text>
                          <Text style={dStyles.catalogItemPrice}>${item.baseBulkPrice.toFixed(2)}/{item.unit}</Text>
                        </View>
                        {inCart ? (
                          <View style={[styles.addButton, styles.addButtonActive, { width: 26, height: 26, borderRadius: 13 }]}>
                            <CheckCircle size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                          </View>
                        ) : (
                          <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                            <Plus size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}
            {activeTab === 'labor' && (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {filteredLabor.map(item => {
                  const inCart = laborCart.find(i => i.labor.id === item.id);
                  return (
                    <TouchableOpacity key={item.id} style={dStyles.catalogItem} onPress={() => openLaborPopup(item)} activeOpacity={0.7}>
                      <View style={{ flex: 1 }}>
                        <Text style={dStyles.catalogItemName} numberOfLines={1}>{item.trade}</Text>
                        <Text style={dStyles.catalogItemPrice}>${item.hourlyRate.toFixed(2)}/hr</Text>
                      </View>
                      {inCart ? (
                        <View style={[styles.addButton, styles.addButtonActive, { width: 26, height: 26, borderRadius: 13 }]}>
                          <CheckCircle size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                        </View>
                      ) : (
                        <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                          <Plus size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            {activeTab === 'assemblies' && (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {/* "+ New assembly" at the top of the desktop panel */}
                <TouchableOpacity
                  style={[dStyles.catalogItem, { borderBottomWidth: 1, borderBottomColor: Colors.cardBorder }]}
                  onPress={() => { setEditorInitial(null); setEditorVisible(true); }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[dStyles.catalogItemName, { color: Colors.primary }]}>+ New assembly</Text>
                    <Text style={dStyles.catalogItemPrice}>Create a custom assembly</Text>
                  </View>
                  <PlusCircle size={14} color={Colors.primary} strokeWidth={1.75} />
                </TouchableOpacity>
                {filteredAssemblies.map(item => {
                  const isCustom = (item as AssemblyItem & { __custom?: boolean }).__custom === true;
                  return (
                    <View key={item.id}>
                      <TouchableOpacity style={dStyles.catalogItem} onPress={() => openAssemblyPopup(item)} activeOpacity={0.7}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            {isCustom && (
                              <View style={[styles.categoryBadge, { backgroundColor: Colors.success + '20' }]}>
                                <Text style={[styles.categoryBadgeText, { color: Colors.success }]}>Custom</Text>
                              </View>
                            )}
                            <Text style={dStyles.catalogItemName} numberOfLines={1}>{item.name}</Text>
                          </View>
                          <Text style={dStyles.catalogItemPrice}>{item.unit}</Text>
                        </View>
                        <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                          <Plus size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                        </View>
                      </TouchableOpacity>
                      {isCustom && (
                        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingBottom: 6 }}>
                          <TouchableOpacity
                            onPress={() => {
                              const { __custom: _c, ...clean } = item as AssemblyItem & { __custom?: boolean };
                              setEditorInitial(clean as AssemblyItem);
                              setEditorVisible(true);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.primary }}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => Alert.alert(
                              'Delete assembly?',
                              `Remove "${item.name}" from your custom assemblies?`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Delete', style: 'destructive', onPress: () => void deleteCustomAssembly(item.id) },
                              ],
                            )}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.error }}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            {activeTab === 'templates' && (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {filteredTemplates.map(item => (
                  <TouchableOpacity key={item.id} style={dStyles.catalogItem} onPress={() => handleLoadTemplate(item)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={dStyles.catalogItemName} numberOfLines={1}>{item.name}</Text>
                      <Text style={dStyles.catalogItemPrice}>{item.priceRange}</Text>
                    </View>
                    <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                      <Plus size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={dStyles.workspacePanel}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              {totalItemCount === 0 ? (
                <View style={[styles.emptyState, { paddingVertical: 80 }]}>
                  <ShoppingCart size={40} color={Colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.emptyTitle}>No items in this estimate yet</Text>
                  <Text style={styles.emptyDesc}>
                    Tap a material, trade, or assembly in the catalog on the left to add it here. Or hit Voice Estimate at the top to dictate the scope and let AI build the line items.
                  </Text>
                </View>
              ) : (
                <>
                  {cart.length > 0 && (
                    <View style={dStyles.wsSection}>
                      <Text style={dStyles.wsSectionTitle}>Materials ({cart.length})</Text>
                      <View style={dStyles.wsTable}>
                        <View style={dStyles.wsTableHeader}>
                          <Text style={[dStyles.wsHeaderCell, { flex: 3 }]}>Item</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Qty</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Unit $</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Markup</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                          <View style={{ width: 32 }} />
                        </View>
                        {cart.map((item, idx) => {
                          const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
                          const lineTotal = base * (1 + item.markup / 100) * item.quantity;
                          return (
                            <View key={item.material.id} style={[dStyles.wsTableRow, idx % 2 === 0 && dStyles.wsTableRowAlt]}>
                              <Text style={[dStyles.wsCell, { flex: 3, fontWeight: '500' as const }]} numberOfLines={1}>{item.material.name}</Text>
                              <Text style={[dStyles.wsCell, { flex: 1 }]}>{item.quantity}</Text>
                              <Text style={[dStyles.wsCell, { flex: 1 }]}>${base.toFixed(2)}</Text>
                              <Text style={[dStyles.wsCell, { flex: 1 }]}>{item.markup}%</Text>
                              <Text style={[dStyles.wsCell, { flex: 1, textAlign: 'right' as const, fontWeight: '700' as const }]}>${lineTotal.toFixed(2)}</Text>
                              <TouchableOpacity style={{ width: 32, alignItems: 'center' as const }} onPress={() => removeFromCart(item.material.id)} accessibilityRole="button" accessibilityLabel="Delete">
                                <Trash2 size={14} color={Colors.error} strokeWidth={1.75} />
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  )}
                  {laborCart.length > 0 && (
                    <View style={dStyles.wsSection}>
                      <Text style={dStyles.wsSectionTitle}>Labor ({laborCart.length})</Text>
                      <View style={dStyles.wsTable}>
                        <View style={dStyles.wsTableHeader}>
                          <Text style={[dStyles.wsHeaderCell, { flex: 3 }]}>Trade</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Hours</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Rate</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                          <View style={{ width: 32 }} />
                        </View>
                        {laborCart.map((item, idx) => (
                          <View key={item.labor.id} style={[dStyles.wsTableRow, idx % 2 === 0 && dStyles.wsTableRowAlt]}>
                            <Text style={[dStyles.wsCell, { flex: 3, fontWeight: '500' as const }]}>{item.labor.trade}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1 }]}>{item.hours}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1 }]}>${item.adjustedRate.toFixed(2)}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1, textAlign: 'right' as const, fontWeight: '700' as const }]}>${(item.adjustedRate * item.hours).toFixed(2)}</Text>
                            <TouchableOpacity style={{ width: 32, alignItems: 'center' as const }} onPress={() => removeLaborItem(item.labor.id)} accessibilityRole="button" accessibilityLabel="Delete">
                              <Trash2 size={14} color={Colors.error} strokeWidth={1.75} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  {assemblyCart.length > 0 && (
                    <View style={dStyles.wsSection}>
                      <Text style={dStyles.wsSectionTitle}>Assemblies ({assemblyCart.length})</Text>
                      <View style={dStyles.wsTable}>
                        <View style={dStyles.wsTableHeader}>
                          <Text style={[dStyles.wsHeaderCell, { flex: 3 }]}>Assembly</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Qty</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Mat</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1 }]}>Lab</Text>
                          <Text style={[dStyles.wsHeaderCell, { flex: 1, textAlign: 'right' as const }]}>Total</Text>
                          <View style={{ width: 32 }} />
                        </View>
                        {assemblyCart.map((item, idx) => (
                          <View key={item.assembly.id} style={[dStyles.wsTableRow, idx % 2 === 0 && dStyles.wsTableRowAlt]}>
                            <Text style={[dStyles.wsCell, { flex: 3, fontWeight: '500' as const }]} numberOfLines={1}>{item.assembly.name}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1 }]}>{item.quantity}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1 }]}>${item.materialsCost.toFixed(0)}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1 }]}>${item.laborCost.toFixed(0)}</Text>
                            <Text style={[dStyles.wsCell, { flex: 1, textAlign: 'right' as const, fontWeight: '700' as const }]}>${item.totalCost.toFixed(2)}</Text>
                            <TouchableOpacity style={{ width: 32, alignItems: 'center' as const }} onPress={() => removeAssemblyItem(item.assembly.id)} accessibilityRole="button" accessibilityLabel="Delete">
                              <Trash2 size={14} color={Colors.error} strokeWidth={1.75} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  <View style={dStyles.wsGrandTotal}>
                    <Text style={dStyles.wsGrandTotalLabel}>Grand Total</Text>
                    <Text style={dStyles.wsGrandTotalValue}>{formatMoney(grandTotal, 2)}</Text>
                  </View>
                </>
              )}
            </ScrollView>
          </View>

          <View style={dStyles.summaryPanel}>
            <Text style={dStyles.summaryTitle}>Cost Summary</Text>
            <View style={dStyles.summaryRow}>
              <Text style={dStyles.summaryLabel}>Materials</Text>
              <Text style={dStyles.summaryValue}>{formatMoney(cartTotal, 2)}</Text>
            </View>
            <View style={dStyles.summaryRow}>
              <Text style={dStyles.summaryLabel}>Labor</Text>
              <Text style={dStyles.summaryValue}>{formatMoney(laborTotal, 2)}</Text>
            </View>
            <View style={dStyles.summaryRow}>
              <Text style={dStyles.summaryLabel}>Assemblies</Text>
              <Text style={dStyles.summaryValue}>{formatMoney(assemblyTotal, 2)}</Text>
            </View>
            {markupTotal > 0 && (
              <View style={dStyles.summaryRow}>
                <Text style={[dStyles.summaryLabel, { color: Colors.accent }]}>Markup</Text>
                <Text style={[dStyles.summaryValue, { color: Colors.accent }]}>+{formatMoney(markupTotal, 2)}</Text>
              </View>
            )}
            <View style={dStyles.summaryDivider} />
            <View style={dStyles.summaryRow}>
              <Text style={[dStyles.summaryLabel, { fontWeight: '700' as const, color: Colors.text }]}>Total</Text>
              <Text style={dStyles.summaryGrand}>{formatMoney(grandTotal, 2)}</Text>
            </View>

            {grandTotal > 0 && (
              <View style={dStyles.summaryMetrics}>
                <Text style={dStyles.summaryMetricTitle}>Key Metrics</Text>
                <View style={dStyles.summaryMetricRow}>
                  <Text style={dStyles.summaryMetricLabel}>Mat:Lab ratio</Text>
                  <Text style={dStyles.summaryMetricValue}>
                    {laborTotal > 0 ? (cartTotal / laborTotal).toFixed(1) : 'N/A'}:1
                  </Text>
                </View>
                <View style={dStyles.summaryMetricRow}>
                  <Text style={dStyles.summaryMetricLabel}>Items</Text>
                  <Text style={dStyles.summaryMetricValue}>{totalItemCount}</Text>
                </View>
                <View style={dStyles.summaryMetricRow}>
                  <Text style={dStyles.summaryMetricLabel}>Location</Text>
                  <Text style={dStyles.summaryMetricValue}>{settings.location || 'US Avg'}</Text>
                </View>
              </View>
            )}

            <View style={dStyles.summaryActions}>
              <TouchableOpacity style={dStyles.summaryActionBtn} onPress={() => {
                setSelectedProjectId(projects[0]?.id ?? null);
                setShowAddToProject(true);
              }} activeOpacity={0.85}>
                <FolderOpen size={14} color={Colors.textOnPrimary} strokeWidth={1.75} />
                <Text style={dStyles.summaryActionText}>Save to Project</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[dStyles.summaryActionBtn, { backgroundColor: Colors.primary + '12' }]} onPress={handleOpenPDFPreSend} activeOpacity={0.85}>
                <FileText size={14} color={Colors.primary} strokeWidth={1.75} />
                <Text style={[dStyles.summaryActionText, { color: Colors.primary }]}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[dStyles.summaryActionBtn, { backgroundColor: Colors.info + '12' }]} onPress={() => setShowComparison(true)} activeOpacity={0.85}>
                <GitCompare size={14} color={Colors.info} strokeWidth={1.75} />
                <Text style={[dStyles.summaryActionText, { color: Colors.info }]}>Compare</Text>
              </TouchableOpacity>
            </View>

            {grandTotal > 0 && (
              <AIEstimateValidator
                projectType={projects[0]?.type ?? 'renovation'}
                squareFootage={projects[0]?.squareFootage ?? 0}
                totalCost={grandTotal}
                materialCost={cartTotal}
                laborCost={laborTotal}
                itemCount={totalItemCount}
                hasContingency={false}
                location={settings.location}
              />
            )}
          </View>
        </View>

        <Modal visible={showItemPopup} transparent animationType="fade" onRequestClose={() => setShowItemPopup(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.popupOverlay} onPress={() => setShowItemPopup(false)}>
            <Pressable style={styles.popupCard} onPress={() => undefined}>
              {selectedMaterial && (
                <>
                  <View style={styles.popupHeader}>
                    <Text style={styles.popupTitle} numberOfLines={2}>{selectedMaterial.name}</Text>
                    <TouchableOpacity onPress={() => setShowItemPopup(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                      <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.popupFieldLabel}>Quantity</Text>
                  <View style={styles.popupQtyRow}>
                    <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setItemQty(String(Math.max(1, (parseInt(itemQty, 10) || 1) - 1)))} accessibilityRole="button" accessibilityLabel="Remove">
                      <Minus size={18} color={Colors.primary} strokeWidth={1.75} />
                    </TouchableOpacity>
                    <TextInput style={styles.popupQtyInput} value={itemQty} onChangeText={setItemQty} keyboardType="number-pad" textAlign="center" />
                    <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setItemQty(String((parseInt(itemQty, 10) || 0) + 1))} accessibilityRole="button" accessibilityLabel="Add">
                      <Plus size={18} color={Colors.primary} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.popupTotalRow}>
                    <Text style={styles.popupTotalLabel}>Line Total</Text>
                    <Text style={styles.popupTotalValue}>{formatMoney(popupLineTotal, 2)}</Text>
                  </View>
                  <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddFromPopup} activeOpacity={0.85}>
                    <ShoppingCart size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
                    <Text style={styles.popupAddBtnText}>{cart.find(i => i.material.id === selectedMaterial.id) ? 'Update' : 'Add to Estimate'}</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
          </KeyboardAvoidingView>
        </Modal>
        <Modal visible={showLaborPopup} transparent animationType="fade" onRequestClose={() => setShowLaborPopup(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.popupOverlay} onPress={() => setShowLaborPopup(false)}>
            <Pressable style={styles.popupCard} onPress={() => undefined}>
              {selectedLabor && (
                <>
                  <View style={styles.popupHeader}>
                    <Text style={styles.popupTitle}>{selectedLabor.trade}</Text>
                    <TouchableOpacity onPress={() => setShowLaborPopup(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                      <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.popupFieldLabel}>Rate ($/hr)</Text>
                  <TextInput style={styles.popupQtyInput} value={laborRateInput} onChangeText={setLaborRateInput} keyboardType="decimal-pad" textAlign="center" />
                  <Text style={styles.popupFieldLabel}>Hours</Text>
                  <TextInput style={styles.popupQtyInput} value={laborHoursInput} onChangeText={setLaborHoursInput} keyboardType="decimal-pad" textAlign="center" />
                  <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddLabor} activeOpacity={0.85}>
                    <Text style={styles.popupAddBtnText}>{laborCart.find(i => i.labor.id === selectedLabor.id) ? 'Update' : 'Add Labor'}</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
          </KeyboardAvoidingView>
        </Modal>
        <Modal visible={showAssemblyPopup} transparent animationType="fade" onRequestClose={() => setShowAssemblyPopup(false)}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.popupOverlay} onPress={() => setShowAssemblyPopup(false)}>
            <Pressable style={styles.popupCard} onPress={() => undefined}>
              {selectedAssembly && (
                <>
                  <View style={styles.popupHeader}>
                    <Text style={styles.popupTitle} numberOfLines={2}>{selectedAssembly.name}</Text>
                    <TouchableOpacity onPress={() => setShowAssemblyPopup(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                      <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.popupFieldLabel}>Quantity</Text>
                  <TextInput style={styles.popupQtyInput} value={assemblyQtyInput} onChangeText={setAssemblyQtyInput} keyboardType="decimal-pad" textAlign="center" />
                  <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddAssembly} activeOpacity={0.85}>
                    <Text style={styles.popupAddBtnText}>{assemblyCart.find(i => i.assembly.id === selectedAssembly.id) ? 'Update' : 'Add Assembly'}</Text>
                  </TouchableOpacity>
                </>
              )}
            </Pressable>
          </Pressable>
          </KeyboardAvoidingView>
        </Modal>
        <Modal visible={showAddToProject} transparent animationType="fade" onRequestClose={() => setShowAddToProject(false)}>
          <Pressable style={styles.popupOverlay} onPress={() => setShowAddToProject(false)}>
            <Pressable style={styles.addToProjectCard} onPress={() => undefined}>
              <View style={styles.addToProjectHeader}>
                <Text style={styles.addToProjectTitle}>Link to Project</Text>
                <TouchableOpacity onPress={() => setShowAddToProject(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={Colors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              {projects.length > 0 && (
                <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                  {projects.map(project => (
                    <TouchableOpacity
                      key={project.id}
                      style={[styles.projectOption, selectedProjectId === project.id && styles.projectOptionSelected]}
                      onPress={() => setSelectedProjectId(project.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.projectOptionLeft}>
                        <Text style={styles.projectOptionName}>{project.name}</Text>
                      </View>
                      {selectedProjectId === project.id && <CheckCircle size={20} color={Colors.primary} strokeWidth={1.75} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity style={styles.addToProjectConfirmBtn} onPress={handleSelectProject} activeOpacity={0.85}>
                <Send size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
                <Text style={styles.addToProjectConfirmText}>Select Project</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
        <Modal visible={showConfirmLink} transparent animationType="fade" onRequestClose={() => setShowConfirmLink(false)}>
          <Pressable style={styles.popupOverlay} onPress={() => setShowConfirmLink(false)}>
            <Pressable style={styles.addToProjectCard} onPress={() => undefined}>
              <View style={styles.addToProjectHeader}>
                <Text style={styles.addToProjectTitle}>Confirm</Text>
                <TouchableOpacity onPress={() => setShowConfirmLink(false)} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
              </View>
              {pendingLinkProject && (
                <TouchableOpacity style={styles.addToProjectConfirmBtn} onPress={() => handleConfirmLink('replace')} activeOpacity={0.85}>
                  <CheckCircle size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
                  <Text style={styles.addToProjectConfirmText}>Confirm & Link</Text>
                </TouchableOpacity>
              )}
            </Pressable>
          </Pressable>
        </Modal>
        <SquareFootEstimator visible={showSqftEstimator} onClose={() => setShowSqftEstimator(false)} locationFactor={locationMultiplier} />
        <ProductivityCalculator visible={showProductivityCalc} onClose={() => setShowProductivityCalc(false)} />
        <EstimateComparison visible={showComparison} onClose={() => setShowComparison(false)} currentCart={cart} currentLaborCart={laborCart} currentAssemblyCart={assemblyCart} currentMaterialsTotal={cartTotal} currentLaborTotal={laborTotal} currentAssemblyTotal={assemblyTotal} currentGrandTotal={grandTotal} />
        <PDFPreSendSheet visible={showPDFPreSend} onClose={() => setShowPDFPreSend(false)} onSend={handlePDFSend} documentType="estimate" projectName={pendingLinkProject?.name ?? 'Estimate'} contacts={contacts} pdfNaming={settings.pdfNaming} onPdfNumberUsed={() => { if (settings.pdfNaming?.enabled) { updateSettings({ pdfNaming: { ...settings.pdfNaming, nextNumber: settings.pdfNaming.nextNumber + 1 } }); } }} />
        <AssemblyEditorModal
          visible={editorVisible}
          initial={editorInitial}
          onClose={() => setEditorVisible(false)}
          onSave={(a) => {
            if (editorInitial) { void updateCustomAssembly(a); } else { void addCustomAssembly(a); }
            setEditorVisible(false);
          }}
        />
        <RateOverrideModal
          visible={costBookOpen}
          overrides={overrides}
          materials={materials}
          onClose={() => setCostBookOpen(false)}
          onAdd={(o: RateOverride) => addOverride(o)}
          onUpdate={(o: RateOverride) => updateOverride(o)}
          onDelete={(id: string) => deleteOverride(id)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {activeTab === 'materials' && <FlatList
        data={filteredMaterials}
        keyExtractor={item => item.id}
        renderItem={renderMaterialCard}
        ListHeaderComponent={listHeaderComponent}
        contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Search size={40} color={Colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No materials found</Text>
            <Text style={styles.emptyDesc}>Try a different search term or category</Text>
          </View>
        }
      />}

      {activeTab === 'labor' && <FlatList
        data={filteredLabor}
        keyExtractor={item => item.id}
        renderItem={renderLaborCard}
        ListHeaderComponent={laborListHeader}
        contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <HardHat size={40} color={Colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No trades found</Text>
          </View>
        }
      />}

      {activeTab === 'assemblies' && (
        <View style={{ flex: 1 }}>
          {assemblyListHeader}
          <FlatList
            data={filteredAssemblies}
            keyExtractor={item => item.id}
            renderItem={renderAssemblyCard}
            contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Boxes size={40} color={Colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.emptyTitle}>No assemblies found</Text>
              </View>
            }
          />
        </View>
      )}

      {activeTab === 'templates' && <FlatList
        data={filteredTemplates}
        keyExtractor={item => item.id}
        renderItem={renderTemplateCard}
        ListHeaderComponent={templateListHeader}
        contentContainerStyle={[styles.listContent, { paddingBottom: listBottomPadding }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <ClipboardList size={40} color={Colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No templates found</Text>
          </View>
        }
      />}

      {totalItemCount > 0 && !showCart && (
        <TouchableOpacity
          style={[styles.floatingCart, { bottom: 16 }]}
          onPress={() => setShowCart(true)}
          activeOpacity={0.9}
          testID="floating-cart"
        >
          <View style={styles.floatingCartLeft}>
            <ShoppingCart size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
            <Text style={styles.floatingCartItems}>{totalItemCount} items</Text>
          </View>
          <Text style={styles.floatingCartTotal}>{formatMoney(grandTotal, 2)}</Text>
          <ArrowRight size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
        </TouchableOpacity>
      )}

      {/* Item Popup Modal */}
      <Modal
        visible={showItemPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowItemPopup(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.popupOverlay} onPress={() => setShowItemPopup(false)}>
          <Pressable style={styles.popupCard} onPress={() => undefined}>
            {/* Wrap body in a ScrollView so tall content (price breakdown + quantity +
                totals + Add button) is fully reachable on small screens / with the
                keyboard raised. Previously the card just clipped to maxHeight 80% and
                the primary CTA sat below the viewport with no way to scroll to it. */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 14, paddingBottom: 4 }}
            >
            {selectedMaterial && (
              <>
                <View style={styles.popupHeader}>
                  <Text style={styles.popupTitle} numberOfLines={2}>{selectedMaterial.name}</Text>
                  <TouchableOpacity onPress={() => setShowItemPopup(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                <View style={styles.popupMeta}>
                  <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(selectedMaterial.category) + '22' }]}>
                    <Text style={[styles.categoryBadgeText, { color: getCategoryColor(selectedMaterial.category) }]}>
                      {CATEGORY_META[selectedMaterial.category]?.label ?? selectedMaterial.category}
                    </Text>
                  </View>
                  <View style={styles.supplierRow}>
                    <Truck size={10} color={Colors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.supplierText}>{selectedMaterial.supplier}</Text>
                  </View>
                </View>

                <View style={styles.popupPriceRow}>
                  <View style={styles.popupPriceBlock}>
                    <Text style={styles.popupPriceLabel}>Retail</Text>
                    <Text style={styles.popupRetail}>${selectedMaterial.baseRetailPrice.toFixed(2)}</Text>
                    <Text style={styles.popupPriceUnit}>/{selectedMaterial.unit}</Text>
                  </View>
                  <View style={styles.popupPriceBlock}>
                    <Text style={[styles.popupPriceLabel, { color: Colors.success }]}>Bulk</Text>
                    <Text style={styles.popupBulk}>${selectedMaterial.baseBulkPrice.toFixed(2)}</Text>
                    <Text style={styles.popupPriceUnit}>/{selectedMaterial.unit}</Text>
                  </View>
                </View>

                <Text style={styles.popupFieldLabel}>Quantity</Text>
                <View style={styles.popupQtyRow}>
                  <TouchableOpacity
                    style={styles.popupQtyBtn}
                    onPress={() => {
                      const q = Math.max(1, (parseInt(itemQty, 10) || 1) - 1);
                      setItemQty(String(q));
                    }} accessibilityRole="button" accessibilityLabel="Remove">
                    <Minus size={18} color={Colors.primary} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.popupQtyInput}
                    value={itemQty}
                    onChangeText={setItemQty}
                    keyboardType="number-pad"
                    textAlign="center"
                    testID="popup-qty-input"
                  />
                  <TouchableOpacity
                    style={styles.popupQtyBtn}
                    onPress={() => {
                      const q = (parseInt(itemQty, 10) || 0) + 1;
                      setItemQty(String(q));
                    }} accessibilityRole="button" accessibilityLabel="Add">
                    <Plus size={18} color={Colors.primary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {(parseInt(itemQty, 10) || 0) >= selectedMaterial.bulkMinQty && (
                  <View style={styles.popupBulkBanner}>
                    <CheckCircle size={14} color={Colors.success} strokeWidth={1.75} />
                    <Text style={styles.popupBulkText}>Bulk pricing applied!</Text>
                  </View>
                )}

                {/* Transparent pricing breakdown — shows exactly how we got from
                    the MSRP to the current retail price, and what bulk buys you.
                    Users kept asking "why is this $615 and not $500?" — this is
                    the answer spelled out. */}
                {(() => {
                  const mult = locationMultiplier || 1;
                  const msrp = selectedMaterial.baseRetailPrice / mult;
                  const regionDelta = selectedMaterial.baseRetailPrice - msrp;
                  const bulkSavings = selectedMaterial.baseRetailPrice - selectedMaterial.baseBulkPrice;
                  const bulkPct = selectedMaterial.baseRetailPrice > 0
                    ? (bulkSavings / selectedMaterial.baseRetailPrice) * 100
                    : 0;
                  return (
                    <View style={styles.popupBreakdown}>
                      <Text style={styles.popupBreakdownTitle}>Price Breakdown</Text>
                      <View style={styles.popupBreakdownRow}>
                        <Text style={styles.popupBreakdownLabel}>MSRP base</Text>
                        <Text style={styles.popupBreakdownValue}>${msrp.toFixed(2)}</Text>
                      </View>
                      <View style={styles.popupBreakdownRow}>
                        <Text style={styles.popupBreakdownLabel}>
                          {regionLabel} ×{mult.toFixed(2)}
                        </Text>
                        <Text style={[
                          styles.popupBreakdownValue,
                          { color: regionDelta >= 0 ? Colors.warning : Colors.success },
                        ]}>
                          {regionDelta >= 0 ? '+' : '−'}${Math.abs(regionDelta).toFixed(2)}
                        </Text>
                      </View>
                      <View style={[styles.popupBreakdownRow, styles.popupBreakdownDivider]}>
                        <Text style={styles.popupBreakdownLabelBold}>Retail / {selectedMaterial.unit}</Text>
                        <Text style={styles.popupBreakdownValueBold}>
                          ${selectedMaterial.baseRetailPrice.toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.popupBreakdownRow}>
                        <Text style={[styles.popupBreakdownLabel, { color: Colors.success }]}>
                          Bulk @ {selectedMaterial.bulkMinQty}+ ({bulkPct.toFixed(0)}% off)
                        </Text>
                        <Text style={[styles.popupBreakdownValue, { color: Colors.success }]}>
                          ${selectedMaterial.baseBulkPrice.toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.popupBreakdownRow}>
                        <Text style={styles.popupBreakdownLabel}>You save / unit</Text>
                        <Text style={[styles.popupBreakdownValue, { color: Colors.success }]}>
                          ${bulkSavings.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                <View style={styles.popupTotalRow}>
                  <Text style={styles.popupTotalLabel}>Line Total</Text>
                  <Text style={styles.popupTotalValue}>{formatMoney(popupLineTotal, 2)}</Text>
                </View>

                <View style={styles.popupRunningRow}>
                  <Text style={styles.popupRunningLabel}>Cart total after adding</Text>
                  <Text style={styles.popupRunningValue}>
                    ${(cartTotal - (cart.find(i => i.material.id === selectedMaterial.id)
                      ? (() => {
                          const existing = cart.find(i => i.material.id === selectedMaterial.id)!;
                          const base = existing.usesBulk ? existing.material.baseBulkPrice : existing.material.baseRetailPrice;
                          return base * (1 + existing.markup / 100) * existing.quantity;
                        })()
                      : 0) + popupLineTotal).toFixed(2)}
                  </Text>
                </View>

                <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddFromPopup} activeOpacity={0.85} testID="popup-add-btn">
                  <ShoppingCart size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
                  <Text style={styles.popupAddBtnText}>
                    {cart.find(i => i.material.id === selectedMaterial.id) ? 'Update in Estimate' : 'Add to Estimate'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
            </ScrollView>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Cart Modal */}
      <Modal
        visible={showCart}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
        onRequestClose={() => setShowCart(false)}
        onDismiss={() => {
          // iOS-only: fires after the dismiss transition fully completes.
          // This is the deterministic hook for "open the next modal once
          // this one is truly gone" — replaces the fragile setTimeout
          // every cart-footer button used.
          if (!pendingCartModal) return;
          const target = pendingCartModal;
          setPendingCartModal(null);
          if (target === 'addToProject') setShowAddToProject(true);
          else if (target === 'comparison') setShowComparison(true);
          else if (target === 'ai') setShowAIModal(true);
          else if (target === 'pdf') setShowPDFPreSend(true);
        }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalContainer, { paddingTop: insets.top + 8 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Estimate</Text>
              <TouchableOpacity onPress={() => setShowCart(false)} style={styles.modalClose} testID="close-cart" accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={Colors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            {totalItemCount === 0 ? (
              <View style={styles.cartEmpty}>
                <ShoppingCart size={48} color={Colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.cartEmptyTitle}>No items yet</Text>
                <Text style={styles.cartEmptyDesc}>Search and add materials, labor, or assemblies to start your estimate</Text>
                <TouchableOpacity style={styles.cartEmptyBtn} onPress={() => setShowCart(false)}>
                  <Text style={styles.cartEmptyBtnText}>Browse Items</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <ScrollView style={styles.cartScroll} showsVerticalScrollIndicator={false}>
                  {/* Summary Cards */}
                  <View style={styles.summaryCardsRow}>
                    <View style={[styles.summaryMiniCard, { borderLeftColor: Colors.primary }]}>
                      <Text style={styles.summaryMiniLabel}>Materials</Text>
                      <Text style={styles.summaryMiniValue}>{formatMoney(cartTotal)}</Text>
                      <Text style={styles.summaryMiniSub}>{cart.length} items</Text>
                    </View>
                    <View style={[styles.summaryMiniCard, { borderLeftColor: Colors.accent }]}>
                      <Text style={styles.summaryMiniLabel}>Labor</Text>
                      <Text style={styles.summaryMiniValue}>{formatMoney(laborTotal)}</Text>
                      <Text style={styles.summaryMiniSub}>{laborHoursTotal.toFixed(0)} hrs</Text>
                    </View>
                    <View style={[styles.summaryMiniCard, { borderLeftColor: Colors.info }]}>
                      <Text style={styles.summaryMiniLabel}>Assemblies</Text>
                      <Text style={styles.summaryMiniValue}>{formatMoney(assemblyTotal)}</Text>
                      <Text style={styles.summaryMiniSub}>{assemblyCart.length} items</Text>
                    </View>
                  </View>

                  {/* Ask AI — tune the materials cart for a project description.
                      Only relevant when there are materials in the cart; we hide
                      the button otherwise to avoid teasing a feature that has
                      nothing to operate on. */}
                  {cart.length > 0 && (
                    <TouchableOpacity
                      style={styles.askAIBtn}
                      onPress={() => {
                        if (Platform.OS === 'ios') {
                          setPendingCartModal('ai');
                          setShowCart(false);
                        } else {
                          setShowCart(false);
                          setShowAIModal(true);
                        }
                      }}
                      activeOpacity={0.85}
                      testID="ask-ai-btn"
                    >
                      <View style={styles.askAIBtnIcon}>
                        <MageAIMark size={16} color={Colors.surface} />
                      </View>
                      <View style={styles.askAIBtnText}>
                        <Text style={styles.askAIBtnTitle}>Ask AI</Text>
                        <Text style={styles.askAIBtnSub}>Tune quantities and markup for your project</Text>
                      </View>
                      <ChevronRight size={16} color={Colors.surface} strokeWidth={1.75} />
                    </TouchableOpacity>
                  )}

                  {cart.length > 0 && (
                    <>
                      <Text style={styles.cartSectionTitle}>Materials ({cart.length})</Text>
                      <View style={styles.cartList}>
                        {cart.map(item => renderCartItem(item))}
                      </View>
                    </>
                  )}

                  {laborCart.length > 0 && (
                    <>
                      <Text style={styles.cartSectionTitle}>Labor ({laborCart.length})</Text>
                      <View style={styles.cartList}>
                        {laborCart.map(item => (
                          <View key={item.labor.id} style={styles.cartItem}>
                            <View style={styles.cartItemHeader}>
                              <View style={styles.cartItemLeft}>
                                <Text style={styles.cartItemName}>{item.labor.trade}</Text>
                                <Text style={styles.cartItemSub}>${item.adjustedRate.toFixed(2)}/hr · {item.hours} hrs</Text>
                              </View>
                              <View style={styles.cartItemRight}>
                                <Text style={styles.cartItemTotal}>{formatMoney(item.adjustedRate * item.hours, 2)}</Text>
                                <TouchableOpacity onPress={() => removeLaborItem(item.labor.id)} accessibilityRole="button" accessibilityLabel="Delete">
                                  <Trash2 size={14} color={Colors.error} strokeWidth={1.75} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  {assemblyCart.length > 0 && (
                    <>
                      <Text style={styles.cartSectionTitle}>Assemblies ({assemblyCart.length})</Text>
                      <View style={styles.cartList}>
                        {assemblyCart.map(item => (
                          <View key={item.assembly.id} style={styles.cartItem}>
                            <View style={styles.cartItemHeader}>
                              <View style={styles.cartItemLeft}>
                                <Text style={styles.cartItemName}>{item.assembly.name}</Text>
                                <Text style={styles.cartItemSub}>{item.quantity} {item.assembly.unit} · Mat: ${item.materialsCost.toFixed(0)} · Lab: ${item.laborCost.toFixed(0)}</Text>
                              </View>
                              <View style={styles.cartItemRight}>
                                <Text style={styles.cartItemTotal}>{formatMoney(item.totalCost, 2)}</Text>
                                <TouchableOpacity onPress={() => removeAssemblyItem(item.assembly.id)} accessibilityRole="button" accessibilityLabel="Delete">
                                  <Trash2 size={14} color={Colors.error} strokeWidth={1.75} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  <CostBreakdownReport
                    cart={cart}
                    laborCart={laborCart}
                    assemblyCart={assemblyCart}
                    globalMarkup={globalMarkup}
                    locationFactor={locationMultiplier}
                    locationName={settings.location}
                  />

                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>Estimate Summary</Text>
                    {cart.length > 0 && <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Materials (base)</Text>
                      <Text style={styles.summaryValue}>{formatMoney(cartBaseTotal, 2)}</Text>
                    </View>}
                    {markupTotal > 0 && <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: Colors.accent }]}>Materials markup</Text>
                      <Text style={[styles.summaryValue, { color: Colors.accent }]}>+{formatMoney(markupTotal, 2)}</Text>
                    </View>}
                    {laborTotal > 0 && <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Labor ({laborHoursTotal.toFixed(0)} hrs)</Text>
                      <Text style={styles.summaryValue}>{formatMoney(laborTotal, 2)}</Text>
                    </View>}
                    {assemblyTotal > 0 && <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Assemblies</Text>
                      <Text style={styles.summaryValue}>{formatMoney(assemblyTotal, 2)}</Text>
                    </View>}
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryTotal}>Grand Total</Text>
                      <Text style={styles.summaryTotalValue}>{formatMoney(grandTotal, 2)}</Text>
                    </View>
                    {cart.some(i => i.usesBulk) && (
                      <View style={styles.bulkNote}>
                        <CheckCircle size={13} color={Colors.success} strokeWidth={1.75} />
                        <Text style={styles.bulkNoteText}>
                          Bulk pricing on {cart.filter(i => i.usesBulk).length} item(s)
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={{ height: insets.bottom + 180 }} />
                </ScrollView>

                <View style={[styles.cartFooter, { paddingBottom: insets.bottom + 12 }]}>
                  <View style={styles.cartFooterSummary}>
                    <Text style={styles.cartFooterLabel}>Grand total</Text>
                    <Text style={styles.cartFooterValue}>{formatMoney(grandTotal, 2)}</Text>
                  </View>

                  <View style={styles.cartFooterBtnRow}>
                    <TouchableOpacity
                      style={[styles.addToProjectBtn, { flex: 1 }]}
                      onPress={() => {
                        setSelectedProjectId(projects[0]?.id ?? null);
                        if (Platform.OS === 'ios') {
                          setPendingCartModal('addToProject');
                          setShowCart(false);
                        } else {
                          setShowCart(false);
                          setShowAddToProject(true);
                        }
                      }}
                      activeOpacity={0.85}
                      testID="add-to-project-btn"
                    >
                      <FolderOpen size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
                      <Text style={styles.addToProjectBtnText}>Add to Project</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.compareBtn}
                      onPress={() => {
                        if (Platform.OS === 'ios') {
                          setPendingCartModal('comparison');
                          setShowCart(false);
                        } else {
                          setShowCart(false);
                          setShowComparison(true);
                        }
                      }}
                      activeOpacity={0.85}
                      testID="compare-btn"
                    >
                      <GitCompare size={16} color={Colors.primary} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.cartShareRow}>
                    <TouchableOpacity style={styles.cartShareBtn} onPress={handleOpenPDFPreSend} activeOpacity={0.7} testID="cart-share-pdf">
                      <FileText size={16} color={Colors.primary} strokeWidth={1.75} />
                      <Text style={styles.cartShareBtnText}>PDF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cartShareBtn} onPress={handleShareEmail} activeOpacity={0.7} testID="cart-share-email">
                      <Mail size={16} color={Colors.primary} strokeWidth={1.75} />
                      <Text style={styles.cartShareBtnText}>Email</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cartShareBtn} onPress={handleShareText} activeOpacity={0.7} testID="cart-share-text">
                      <MessageSquare size={16} color={Colors.primary} strokeWidth={1.75} />
                      <Text style={styles.cartShareBtnText}>Text</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.clearBtn}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        ctxClearCart();
                        setLaborCart([]);
                        setAssemblyCart([]);
                      }} accessibilityRole="button" accessibilityLabel="Delete">
                      <Trash2 size={16} color={Colors.error} strokeWidth={1.75} />
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add to Project Modal */}
      <Modal
        visible={showAddToProject}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddToProject(false)}
      >
        <Pressable style={styles.popupOverlay} onPress={() => setShowAddToProject(false)}>
          <Pressable style={styles.addToProjectCard} onPress={() => undefined}>
            <View style={styles.addToProjectHeader}>
              <Text style={styles.addToProjectTitle}>Link to Project</Text>
              <TouchableOpacity onPress={() => setShowAddToProject(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.addToProjectDesc}>
              Select a project to attach this {totalItemCount}-item estimate ({formatMoney(grandTotal, 2)}) to.
              {laborCart.length > 0 || assemblyCart.length > 0
                ? ` Includes ${cart.length} material${cart.length === 1 ? '' : 's'}${laborCart.length > 0 ? `, ${laborCart.length} labor line${laborCart.length === 1 ? '' : 's'}` : ''}${assemblyCart.length > 0 ? `, ${assemblyCart.length} assembly${assemblyCart.length === 1 ? '' : 's'}` : ''}.`
                : ''}
            </Text>

            {projects.length === 0 ? (
              <View style={styles.addToProjectEmpty}>
                <FolderOpen size={32} color={Colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.addToProjectEmptyText}>No projects yet. Create one from the Projects tab first.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
                {projects.map(project => (
                  <TouchableOpacity
                    key={project.id}
                    style={[
                      styles.projectOption,
                      selectedProjectId === project.id && styles.projectOptionSelected,
                    ]}
                    onPress={() => setSelectedProjectId(project.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.projectOptionLeft}>
                      <Text style={styles.projectOptionName}>{project.name}</Text>
                      <Text style={styles.projectOptionMeta}>
                        {project.location} · {project.linkedEstimate ? 'Has estimate' : 'No estimate'}
                      </Text>
                    </View>
                    {selectedProjectId === project.id && (
                      <CheckCircle size={20} color={Colors.primary} strokeWidth={1.75} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {projects.length > 0 && (
              <TouchableOpacity
                style={styles.addToProjectConfirmBtn}
                onPress={handleSelectProject}
                activeOpacity={0.85}
                testID="confirm-link-btn"
              >
                <Send size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
                <Text style={styles.addToProjectConfirmText}>Select Project</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <PDFPreSendSheet
        visible={showPDFPreSend}
        onClose={() => setShowPDFPreSend(false)}
        onSend={handlePDFSend}
        documentType="estimate"
        projectName={pendingLinkProject?.name ?? 'Estimate'}
        contacts={contacts}
        pdfNaming={settings.pdfNaming}
        onPdfNumberUsed={() => {
          if (settings.pdfNaming?.enabled) {
            updateSettings({ pdfNaming: { ...settings.pdfNaming, nextNumber: settings.pdfNaming.nextNumber + 1 } });
          }
        }}
      />

      {/* Confirm Link Modal */}
      <Modal
        visible={showConfirmLink}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmLink(false)}
      >
        <Pressable style={styles.popupOverlay} onPress={() => setShowConfirmLink(false)}>
          <Pressable style={styles.addToProjectCard} onPress={() => undefined}>
            <View style={styles.addToProjectHeader}>
              <Text style={styles.addToProjectTitle}>Confirm Estimate Link</Text>
              <TouchableOpacity onPress={() => setShowConfirmLink(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            {pendingLinkProject && (
              <View style={styles.confirmLinkBody}>
                <Text style={styles.confirmFieldLabel}>Estimate Name</Text>
                <TextInput
                  style={styles.confirmInput}
                  value={estimateName}
                  onChangeText={setEstimateName}
                  placeholder="Estimate name"
                  placeholderTextColor={Colors.textMuted}
                  testID="estimate-name-input"
                />

                <View style={styles.confirmSummaryCard}>
                  <View style={styles.confirmSummaryRow}>
                    <Text style={styles.confirmSummaryLabel}>Items</Text>
                    <Text style={styles.confirmSummaryValue}>{totalItemCount}</Text>
                  </View>
                  {cart.length > 0 && (laborTotal > 0 || assemblyTotal > 0) && (
                    <View style={styles.confirmSummaryRow}>
                      <Text style={styles.confirmSummaryLabel}>Materials</Text>
                      <Text style={styles.confirmSummaryValue}>{formatMoney(cartTotal, 2)}</Text>
                    </View>
                  )}
                  {laborTotal > 0 && (
                    <View style={styles.confirmSummaryRow}>
                      <Text style={styles.confirmSummaryLabel}>Labor ({laborHoursTotal.toFixed(0)} hrs)</Text>
                      <Text style={styles.confirmSummaryValue}>{formatMoney(laborTotal, 2)}</Text>
                    </View>
                  )}
                  {assemblyTotal > 0 && (
                    <View style={styles.confirmSummaryRow}>
                      <Text style={styles.confirmSummaryLabel}>Assemblies</Text>
                      <Text style={styles.confirmSummaryValue}>{formatMoney(assemblyTotal, 2)}</Text>
                    </View>
                  )}
                  <View style={styles.confirmSummaryRow}>
                    <Text style={styles.confirmSummaryLabel}>Estimate Value</Text>
                    <Text style={styles.confirmSummaryValueBold}>{formatMoney(grandTotal, 2)}</Text>
                  </View>
                  <View style={styles.confirmDivider} />
                  <View style={styles.confirmSummaryRow}>
                    <Text style={styles.confirmSummaryLabel}>Project</Text>
                    <Text style={styles.confirmSummaryValue}>{pendingLinkProject.name}</Text>
                  </View>
                </View>

                {pendingLinkProject.linkedEstimate ? (
                  <View style={styles.existingEstimateWarning}>
                    <AlertTriangle size={16} color={Colors.warning} strokeWidth={1.75} />
                    <Text style={styles.existingEstimateText}>
                      This project already has an estimate (${pendingLinkProject.linkedEstimate.grandTotal.toFixed(2)}).
                    </Text>
                  </View>
                ) : null}

                {pendingLinkProject.linkedEstimate ? (
                  <View style={styles.confirmBtnGroup}>
                    <TouchableOpacity
                      style={styles.confirmMergeBtn}
                      onPress={() => handleConfirmLink('merge')}
                      activeOpacity={0.85}
                    >
                      <Layers size={16} color={Colors.info} strokeWidth={1.75} />
                      <Text style={styles.confirmMergeBtnText}>Merge Items</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmReplaceBtn}
                      onPress={() => handleConfirmLink('replace')}
                      activeOpacity={0.85}
                    >
                      <RefreshCw size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
                      <Text style={styles.confirmReplaceBtnText}>Replace</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addToProjectConfirmBtn}
                    onPress={() => handleConfirmLink('replace')}
                    activeOpacity={0.85}
                  >
                    <CheckCircle size={16} color={Colors.textOnPrimary} strokeWidth={1.75} />
                    <Text style={styles.addToProjectConfirmText}>Confirm & Link</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Labor Popup Modal */}
      <Modal visible={showLaborPopup} transparent animationType="fade" onRequestClose={() => setShowLaborPopup(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.popupOverlay} onPress={() => setShowLaborPopup(false)}>
          <Pressable style={styles.popupCard} onPress={() => undefined}>
            {selectedLabor && (
              <>
                <View style={styles.popupHeader}>
                  <Text style={styles.popupTitle}>{selectedLabor.trade}</Text>
                  <TouchableOpacity onPress={() => setShowLaborPopup(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <View style={styles.popupPriceRow}>
                  <View style={styles.popupPriceBlock}>
                    <Text style={styles.popupPriceLabel}>Median</Text>
                    <Text style={styles.popupBulk}>${selectedLabor.hourlyRate.toFixed(2)}</Text>
                    <Text style={styles.popupPriceUnit}>/hr</Text>
                  </View>
                  <View style={styles.popupPriceBlock}>
                    <Text style={styles.popupPriceLabel}>Range</Text>
                    <Text style={styles.popupRetail}>${selectedLabor.rateRange.low}-${selectedLabor.rateRange.high}</Text>
                    <Text style={styles.popupPriceUnit}>/hr</Text>
                  </View>
                </View>
                <Text style={styles.popupFieldLabel}>Hourly Rate ($)</Text>
                <TextInput style={styles.popupQtyInput} value={laborRateInput} onChangeText={setLaborRateInput} keyboardType="decimal-pad" textAlign="center" />
                <Text style={styles.popupFieldLabel}>Hours</Text>
                <View style={styles.popupQtyRow}>
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setLaborHoursInput(String(Math.max(1, (parseFloat(laborHoursInput) || 1) - 1)))} accessibilityRole="button" accessibilityLabel="Remove">
                    <Minus size={18} color={Colors.primary} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <TextInput style={styles.popupQtyInput} value={laborHoursInput} onChangeText={setLaborHoursInput} keyboardType="decimal-pad" textAlign="center" />
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setLaborHoursInput(String((parseFloat(laborHoursInput) || 0) + 1))} accessibilityRole="button" accessibilityLabel="Add">
                    <Plus size={18} color={Colors.primary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <View style={styles.popupTotalRow}>
                  <Text style={styles.popupTotalLabel}>Line Total</Text>
                  <Text style={styles.popupTotalValue}>${((parseFloat(laborRateInput) || 0) * (parseFloat(laborHoursInput) || 0)).toFixed(2)}</Text>
                </View>
                <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddLabor} activeOpacity={0.85}>
                  <HardHat size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
                  <Text style={styles.popupAddBtnText}>
                    {laborCart.find(i => i.labor.id === selectedLabor.id) ? 'Update Labor' : 'Add Labor'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Assembly Popup Modal */}
      <Modal visible={showAssemblyPopup} transparent animationType="fade" onRequestClose={() => setShowAssemblyPopup(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.popupOverlay} onPress={() => setShowAssemblyPopup(false)}>
          <Pressable style={styles.popupCard} onPress={() => undefined}>
            {selectedAssembly && (
              <>
                <View style={styles.popupHeader}>
                  <Text style={styles.popupTitle} numberOfLines={2}>{selectedAssembly.name}</Text>
                  <TouchableOpacity onPress={() => setShowAssemblyPopup(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.supplierText, { marginBottom: 8 }]}>{selectedAssembly.description}</Text>
                <View style={styles.popupMeta}>
                  <View style={[styles.categoryBadge, { backgroundColor: Colors.primary + '15' }]}>
                    <Text style={[styles.categoryBadgeText, { color: Colors.primary }]}>{selectedAssembly.category}</Text>
                  </View>
                  <Text style={styles.supplierText}>{selectedAssembly.unit}</Text>
                </View>
                <View style={{ gap: 4, marginVertical: 8 }}>
                  <Text style={[styles.popupFieldLabel, { marginTop: 0 }]}>Materials per unit:</Text>
                  {selectedAssembly.materialsPerUnit.map((m, i) => (
                    <Text key={`${m.materialId}-${i}`} style={styles.supplierText}>
                      · {m.name} ({m.quantityPerUnit} {m.unit})
                    </Text>
                  ))}
                  <Text style={[styles.popupFieldLabel, { marginTop: 4 }]}>Labor per unit:</Text>
                  {selectedAssembly.laborPerUnit.map((l, i) => (
                    <Text key={`${l.trade}-${i}`} style={styles.supplierText}>
                      · {l.trade} ({l.hoursPerUnit} hrs)
                    </Text>
                  ))}
                </View>
                <Text style={styles.popupFieldLabel}>Quantity ({selectedAssembly.unit.replace('per ', '')})</Text>
                <View style={styles.popupQtyRow}>
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setAssemblyQtyInput(String(Math.max(1, (parseFloat(assemblyQtyInput) || 1) - 1)))} accessibilityRole="button" accessibilityLabel="Remove">
                    <Minus size={18} color={Colors.primary} strokeWidth={1.75} />
                  </TouchableOpacity>
                  <TextInput style={styles.popupQtyInput} value={assemblyQtyInput} onChangeText={setAssemblyQtyInput} keyboardType="decimal-pad" textAlign="center" />
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setAssemblyQtyInput(String((parseFloat(assemblyQtyInput) || 0) + 1))} accessibilityRole="button" accessibilityLabel="Add">
                    <Plus size={18} color={Colors.primary} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
                {(() => {
                  const qty = parseFloat(assemblyQtyInput) || 0;
                  const costs = calculateAssemblyCost(selectedAssembly, qty);
                  return (
                    <>
                      <View style={styles.popupRunningRow}>
                        <Text style={styles.popupRunningLabel}>Materials</Text>
                        <Text style={styles.popupRunningValue}>${costs.materialsCost.toFixed(2)}</Text>
                      </View>
                      <View style={styles.popupRunningRow}>
                        <Text style={styles.popupRunningLabel}>Labor</Text>
                        <Text style={styles.popupRunningValue}>${costs.laborCost.toFixed(2)}</Text>
                      </View>
                      <View style={styles.popupTotalRow}>
                        <Text style={styles.popupTotalLabel}>Total</Text>
                        <Text style={styles.popupTotalValue}>${costs.totalCost.toFixed(2)}</Text>
                      </View>
                    </>
                  );
                })()}
                {selectedAssembly.notes ? (
                  <View style={styles.popupBulkBanner}>
                    <Info size={14} color={Colors.info} strokeWidth={1.75} />
                    <Text style={[styles.popupBulkText, { color: Colors.info }]}>{selectedAssembly.notes}</Text>
                  </View>
                ) : null}
                <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddAssembly} activeOpacity={0.85}>
                  <Boxes size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
                  <Text style={styles.popupAddBtnText}>
                    {assemblyCart.find(i => i.assembly.id === selectedAssembly.id) ? 'Update Assembly' : 'Add Assembly'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <SquareFootEstimator
        visible={showSqftEstimator}
        onClose={() => setShowSqftEstimator(false)}
        locationFactor={locationMultiplier}
      />

      <ProductivityCalculator
        visible={showProductivityCalc}
        onClose={() => setShowProductivityCalc(false)}
      />

      <EstimateComparison
        visible={showComparison}
        onClose={() => setShowComparison(false)}
        currentCart={cart}
        currentLaborCart={laborCart}
        currentAssemblyCart={assemblyCart}
        currentMaterialsTotal={cartTotal}
        currentLaborTotal={laborTotal}
        currentAssemblyTotal={assemblyTotal}
        currentGrandTotal={grandTotal}
      />

      <Modal visible={showCustomForm} transparent animationType="fade" onRequestClose={() => setShowCustomForm(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.popupOverlay} onPress={() => setShowCustomForm(false)}>
          <Pressable style={styles.popupCard} onPress={() => undefined}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>Add Custom Material</Text>
              <TouchableOpacity onPress={() => setShowCustomForm(false)} style={styles.popupCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={Colors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.popupFieldLabel}>Material Name</Text>
            <TextInput
              style={[styles.popupQtyInput, { textAlign: 'left' as const, paddingHorizontal: 14, fontSize: Type.subhead.fontSize }]}
              value={customName}
              onChangeText={setCustomName}
              placeholder="e.g., PEX Manifold 8-Port"
              placeholderTextColor={Colors.textMuted}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.popupFieldLabel}>Price ($)</Text>
                <TextInput
                  style={styles.popupQtyInput}
                  value={customPrice}
                  onChangeText={setCustomPrice}
                  keyboardType="decimal-pad"
                  textAlign="center"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.popupFieldLabel}>Unit</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {['each', 'LF', 'SF', 'roll', 'bag', 'gallon', 'box'].map(u => (
                    <TouchableOpacity
                      key={u}
                      style={[aiStyles.unitChip, customUnit === u && aiStyles.unitChipActive]}
                      onPress={() => setCustomUnit(u)}
                    >
                      <Text style={[aiStyles.unitChipText, customUnit === u && aiStyles.unitChipTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <Text style={styles.popupFieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingVertical: 4 }}>
              {CATEGORY_CHIPS.filter(c => c.id !== 'all').map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.categoryChip, customCategory === cat.id && styles.categoryChipActive, { paddingHorizontal: 9, paddingVertical: 5 }]}
                  onPress={() => setCustomCategory(cat.id)}
                >
                  <Text style={[styles.categoryChipText, customCategory === cat.id && styles.categoryChipTextActive, { fontSize: Type.caption2.fontSize }]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.popupFieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.popupQtyInput, { textAlign: 'left' as const, paddingHorizontal: 14, fontSize: Type.bodyCompact.fontSize, height: 40 }]}
              value={customNotes}
              onChangeText={setCustomNotes}
              placeholder="Any notes about this material"
              placeholderTextColor={Colors.textMuted}
            />
            <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddCustomMaterial} activeOpacity={0.85}>
              <PlusCircle size={18} color={Colors.textOnPrimary} strokeWidth={1.75} />
              <Text style={styles.popupAddBtnText}>Add to Estimate</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <AIQuickEstimate
        visible={showAIQuickEstimate}
        onClose={() => setShowAIQuickEstimate(false)}
        onApplyEstimate={handleApplyAIEstimate}
        existingMaterials={materials}
        globalMarkup={globalMarkup}
        location={settings.location}
        calculateAssemblyCost={calculateAssemblyCost}
        groundingFacts={quickEstimateGrounding.facts}
        learnedRateCount={quickEstimateGrounding.rateCount}
      />

      {/* Cart-level AI suggestions modal — opens from the "Ask AI" button at
          the top of the cart view. Reads the shared cart, returns per-item
          quantity + markup suggestions plus a labor estimate range. */}
      <MaterialAIEstimateModal
        visible={showAIModal}
        onClose={() => setShowAIModal(false)}
      />

      {/* Assembly editor — create/edit GC-authored custom assemblies */}
      <AssemblyEditorModal
        visible={editorVisible}
        initial={editorInitial}
        onClose={() => setEditorVisible(false)}
        onSave={(a) => {
          if (editorInitial) { void updateCustomAssembly(a); } else { void addCustomAssembly(a); }
          setEditorVisible(false);
        }}
      />
      <RateOverrideModal
        visible={costBookOpen}
        overrides={overrides}
        materials={materials}
        onClose={() => setCostBookOpen(false)}
        onAdd={o => addOverride(o)}
        onUpdate={o => updateOverride(o)}
        onDelete={id => deleteOverride(id)}
      />
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  wizardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: '#FF6A1A',
    shadowColor: '#FF6A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  wizardCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardCtaText: {
    flex: 1,
  },
  wizardCtaTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700',
    color: themeColors.surface,
    letterSpacing: 0.2,
  },
  wizardCtaSubtitle: {
    fontSize: Type.caption2.fontSize,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 1,
  },
  // Takeoff CTA — same shape as wizardCta but teal so the two heroes
  // read distinctly stacked. Slightly tighter top margin so they sit
  // close together as a paired action (wizard → estimate from
  // questions; takeoff → estimate from plans).
  takeoffCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: '#FF6A1A',
    shadowColor: '#FF6A1A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  takeoffCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeoffCtaText: {
    flex: 1,
  },
  takeoffCtaTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700',
    color: themeColors.surface,
    letterSpacing: 0.2,
  },
  takeoffCtaSubtitle: {
    fontSize: Type.caption2.fontSize,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 1,
  },
  header: {
    backgroundColor: themeColors.surface,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.card,
    padding: 3,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
  },
  tabItemActive: {
    backgroundColor: themeColors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textMuted,
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  tabBadge: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center' as const,
  },
  tabBadgeActive: {
    backgroundColor: Colors.primary + '15',
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
  },
  tabBadgeTextActive: {
    color: Colors.primary,
  },
  summaryCardsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 8,
  },
  // Ask AI CTA — pops out of the cart top using the violet treatment that
  // mirrors the Quick Estimate Wizard hero so users recognize it as an
  // AI-powered action. Uses #5E5CE6 (the consistent in-app AI accent).
  askAIBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: '#FF6A1A',
  },
  askAIBtnIcon: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  askAIBtnText: { flex: 1 },
  askAIBtnTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.surface,
  },
  askAIBtnSub: {
    fontSize: Type.caption1.fontSize,
    color: 'rgba(255,255,255,0.82)',
    marginTop: 1,
  },
  summaryMiniCard: {
    flex: 1,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    padding: 12,
    borderLeftWidth: 3,
    gap: 2,
  },
  summaryMiniLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: themeColors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  summaryMiniValue: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
  },
  summaryMiniSub: {
    fontSize: 10,
    color: themeColors.textMuted,
  },
  cartSectionTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700' as const,
    color: themeColors.text,
    letterSpacing: -0.5,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.success,
  },
  liveLabel: {
    fontSize: Type.caption2.fontSize,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiEstimateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: Colors.primary,
  },
  aiEstimateBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  refreshIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartButton: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute' as const,
    top: -3,
    right: -3,
    width: 16,
    height: 16,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: themeColors.surface,
  },
  cartBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.lg,
    paddingHorizontal: 12,
    gap: 8,
    height: 46,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  searchBarFocused: {
    backgroundColor: themeColors.surface,
    borderColor: Colors.primary + '26',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
  },
  markupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  markupLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
    marginRight: 2,
  },
  markupPresets: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  markupChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: Colors.fillTertiary,
  },
  markupChipActive: {
    backgroundColor: Colors.primary,
  },
  markupChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  markupChipTextActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  markupCustom: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 2,
  },
  markupCustomInput: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: themeColors.text,
    width: 42,
  },
  markupCustomSuffix: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
  },
  categoriesWrapper: {
    backgroundColor: themeColors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  categoriesContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.fillTertiary,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  categoryChipTextActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  materialCardWrapper: {
    paddingHorizontal: 16,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: themeColors.bg,
    gap: 10,
  },
  resultsCount: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
    letterSpacing: 0.2,
  },
  resultsMicroCopy: {
    fontSize: Type.caption2.fontSize,
    color: Colors.info,
    fontWeight: '600' as const,
  },
  listContent: {
    paddingTop: 0,
    gap: 10,
  },
  opportunityPanel: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: themeColors.line,
    gap: 10,
  },
  opportunityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  opportunityTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  opportunityTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  opportunitySubtitle: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  opportunityGrid: {
    gap: 8,
  },
  opportunityCard: {
    borderRadius: Tokens.radius.md,
    padding: 10,
    gap: 6,
  },
  opportunityCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  opportunityCardTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
  },
  opportunityCardDetail: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 17,
  },
  materialCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    gap: 10,
  },
  materialMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  materialInfo: {
    flex: 1,
    gap: 5,
  },
  materialName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '500' as const,
    color: themeColors.text,
    lineHeight: 20,
  },
  materialMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  categoryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
  rsMeansBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.infoLight,
  },
  rsMeansBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.info,
  },
  supplierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  supplierText: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonActive: {
    backgroundColor: Colors.success,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.md,
    padding: 10,
    gap: 8,
  },
  priceBlock: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: themeColors.textMuted,
    marginRight: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  retailPrice: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  bulkPrice: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
    letterSpacing: -0.3,
  },
  priceUnit: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  priceDivider: {
    width: 0.5,
    height: 24,
    backgroundColor: themeColors.line,
  },
  bulkSavingsBadge: {
    alignItems: 'flex-end',
  },
  bulkSavingsText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  bulkMinText: {
    fontSize: 10,
    color: themeColors.textMuted,
  },
  materialFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  materialSignalGroup: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  materialSignalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillSecondary,
  },
  materialSignalText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  inCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inCartText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  emptyDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textMuted,
    textAlign: 'center' as const,
  },
  floatingCart: {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  floatingCartLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  floatingCartItems: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: Colors.textOnPrimary,
  },
  floatingCartTotal: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.9)',
    marginRight: 4,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  modalTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
  },
  modalClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartScroll: {
    flex: 1,
  },
  markupBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.info + '10',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
    borderRadius: Tokens.radius.md,
    padding: 12,
  },
  markupBannerText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: Colors.info,
    lineHeight: 18,
  },
  cartList: {
    padding: 16,
    gap: 8,
  },
  cartItem: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: themeColors.line,
    overflow: 'hidden' as const,
  },
  cartItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  cartItemLeft: {
    flex: 1,
    gap: 3,
  },
  cartItemName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  cartItemSub: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
  },
  cartItemRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  cartItemTotal: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  cartItemExpanded: {
    borderTopWidth: 1,
    borderTopColor: themeColors.line,
    padding: 14,
    backgroundColor: themeColors.surfaceAlt,
    gap: 12,
  },
  cartQtyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartExpandLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  qtyBtn: {
    padding: 4,
  },
  qtyValue: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    minWidth: 24,
    textAlign: 'center' as const,
  },
  markupMiniRow: {
    flexDirection: 'row',
    gap: 5,
  },
  markupMiniChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
    backgroundColor: themeColors.surface,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  markupMiniChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  markupMiniText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  markupMiniTextActive: {
    color: Colors.textOnPrimary,
  },
  bulkActiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: Tokens.radius.sm,
    padding: 8,
  },
  bulkActiveTxt: {
    fontSize: Type.caption1.fontSize,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-end' as const,
  },
  removeBtnText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.error,
    fontWeight: '600' as const,
  },
  summaryCard: {
    margin: 16,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.panel,
    padding: 18,
    borderWidth: 1,
    borderColor: themeColors.line,
    gap: 10,
  },
  summaryTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    marginBottom: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: Type.subhead.fontSize,
    color: themeColors.textSecondary,
  },
  summaryValue: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: themeColors.line,
  },
  summaryTotal: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  summaryTotalValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  bulkNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bulkNoteText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.success,
  },
  cartFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: themeColors.line,
    backgroundColor: themeColors.surface,
    alignItems: 'center',
    gap: 8,
  },
  cartFooterSummary: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartFooterLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  cartFooterValue: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: -0.3,
  },
  addToProjectBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  addToProjectBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  cartShareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  cartShareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '10',
    borderRadius: Tokens.radius.card,
    paddingVertical: 10,
  },
  cartShareBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  clearBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.errorLight,
    borderRadius: Tokens.radius.card,
  },
  cartFooterBtnRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 8,
  },
  compareBtn: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary + '12',
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  costBreakdownToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: themeColors.line,
    backgroundColor: Colors.fillSecondary,
  },
  costBreakdownToggleText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
    letterSpacing: 0.1,
  },
  costBreakdownPanel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: themeColors.surfaceAlt,
    borderTopWidth: 0.5,
    borderTopColor: themeColors.line,
    gap: 6,
  },
  costBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  costBreakdownDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  costBreakdownLabel: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  costBreakdownRate: {
    fontSize: 10,
    color: themeColors.textMuted,
    width: 100,
    textAlign: 'right' as const,
  },
  costBreakdownValue: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    width: 70,
    textAlign: 'right' as const,
  },
  costBreakdownDivider: {
    height: 0.5,
    backgroundColor: themeColors.line,
    marginVertical: 2,
  },
  cartEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  cartEmptyTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  cartEmptyDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textMuted,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  cartEmptyBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: Tokens.radius.card,
  },
  cartEmptyBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  popupOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 20,
  },
  popupCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius["2xl"],
    padding: 20,
    gap: 14,
    maxHeight: '80%',
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  popupTitle: {
    flex: 1,
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    lineHeight: 24,
  },
  popupCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  popupPriceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  popupPriceBlock: {
    flex: 1,
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.card,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  popupPriceLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: themeColors.textMuted,
    textTransform: 'uppercase' as const,
    marginRight: 4,
  },
  popupRetail: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  popupBulk: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  popupPriceUnit: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
  },
  popupFieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    marginTop: 2,
  },
  popupQtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  popupQtyBtn: {
    width: 44,
    height: 44,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupQtyInput: {
    flex: 1,
    height: 48,
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.card,
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  popupBulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: Tokens.radius.md,
    padding: 10,
  },
  popupBulkText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupBreakdown: {
    backgroundColor: themeColors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    padding: 12,
    gap: 6,
  },
  popupBreakdownTitle: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  popupBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  popupBreakdownLabel: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
  },
  popupBreakdownLabelBold: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  popupBreakdownValue: {
    fontSize: Type.footnote.fontSize,
    fontVariant: ['tabular-nums'] as any,
    color: themeColors.text,
  },
  popupBreakdownValueBold: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums'] as any,
    color: themeColors.text,
  },
  popupBreakdownDivider: {
    borderTopWidth: 1,
    borderTopColor: themeColors.line,
    paddingTop: 6,
    marginTop: 2,
  },
  popupTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.card,
    padding: 14,
  },
  popupTotalLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  popupTotalValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  popupRunningRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  popupRunningLabel: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
  },
  popupRunningValue: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  popupAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    marginTop: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  popupAddBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  addToProjectCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius["2xl"],
    padding: 20,
    gap: 14,
    maxHeight: '70%',
  },
  addToProjectHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addToProjectTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  addToProjectDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 20,
  },
  addToProjectEmpty: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 10,
  },
  addToProjectEmptyText: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textMuted,
    textAlign: 'center' as const,
  },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.bg,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 12,
    marginTop: 6,
  },
  projectOptionSelected: {
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  projectOptionLeft: {
    flex: 1,
    gap: 2,
  },
  projectOptionName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  projectOptionMeta: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
  },
  addToProjectConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    marginTop: 4,
  },
  addToProjectConfirmText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  confirmLinkBody: {
    gap: 12,
  },
  confirmFieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  confirmInput: {
    minHeight: 48,
    borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  confirmSummaryCard: {
    backgroundColor: themeColors.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    gap: 8,
  },
  confirmSummaryRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  confirmSummaryLabel: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textSecondary,
  },
  confirmSummaryValue: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  confirmSummaryValueBold: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  confirmDivider: {
    height: 1,
    backgroundColor: themeColors.line,
  },
  existingEstimateWarning: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.warningLight,
    borderRadius: Tokens.radius.md,
    padding: 12,
  },
  existingEstimateText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: Colors.warning,
    fontWeight: '500' as const,
  },
  confirmBtnGroup: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  confirmMergeBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.infoLight,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.info + '30',
  },
  confirmMergeBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.info,
  },
  confirmReplaceBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
  },
  confirmReplaceBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});

const makeDStyles = (themeColors: ThemeColors) => StyleSheet.create({
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: themeColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  },
  catalogPanel: {
    width: 280,
    backgroundColor: themeColors.surface,
    borderRightWidth: 1,
    borderRightColor: themeColors.line,
  },
  catalogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
    gap: 8,
  },
  catalogItemName: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: themeColors.text,
  },
  catalogItemPrice: {
    fontSize: Type.caption2.fontSize,
    color: Colors.success,
    fontWeight: '600' as const,
  },
  workspacePanel: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  wsSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  wsSectionTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    marginBottom: 8,
  },
  wsTable: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    overflow: 'hidden' as const,
  },
  wsTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.fillSecondary,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  wsHeaderCell: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  wsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  wsTableRowAlt: {
    backgroundColor: Colors.fillSecondary,
  },
  wsCell: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.text,
  },
  wsGrandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.primary + '0A',
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  wsGrandTotalLabel: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  wsGrandTotalValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  summaryPanel: {
    width: 300,
    backgroundColor: themeColors.surface,
    borderLeftWidth: 1,
    borderLeftColor: themeColors.line,
    padding: 20,
    gap: 10,
  },
  summaryTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textSecondary,
  },
  summaryValue: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: themeColors.line,
    marginVertical: 4,
  },
  summaryGrand: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  summaryMetrics: {
    marginTop: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.card,
    padding: 14,
    gap: 8,
  },
  summaryMetricTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  summaryMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryMetricLabel: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
  },
  summaryMetricValue: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  summaryActions: {
    marginTop: 16,
    gap: 8,
  },
  summaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.card,
    paddingVertical: 12,
  },
  summaryActionText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  // Desktop tab row — claim the slack between title block and action
  // buttons so labels stop pinching when the four tab names compete
  // with the action bar for horizontal space.
  desktopTabRow: {
    flex: 1,
    minWidth: 360,
    maxWidth: 560,
    marginHorizontal: 8,
  },
  desktopTabItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 6,
  },
  desktopTabLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
  },
  // Hero buttons in the desktop header — Wizard (purple) and AI Takeoff
  // (purple, slightly different shade for differentiation). Same shape
  // so they read as paired primary CTAs; the icon-only utility buttons
  // sitting next to them stay visually quieter.
  desktopWizardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Tokens.radius.md,
    backgroundColor: '#FF6A1A',
    shadowColor: '#FF6A1A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  desktopTakeoffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Tokens.radius.md,
    backgroundColor: '#FF6A1A',
    shadowColor: '#FF6A1A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  desktopHeroBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: themeColors.surface,
    letterSpacing: 0.2,
  },
  // Demoted cart icon — when items are in cart, tint primary so it
  // still draws the eye without re-introducing a giant green button.
  cartIconBtnActive: {
    backgroundColor: Colors.primary + '14',
  },
  cartIconBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cartIconBadgeText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: themeColors.surface,
    lineHeight: 11,
  },
});

const makeAiStyles = (themeColors: ThemeColors) => StyleSheet.create({
  recentSection: {
    backgroundColor: themeColors.surface,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  recentTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  recentChipsRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  recentChip: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: themeColors.line,
    maxWidth: 180,
  },
  recentChipName: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    marginBottom: 2,
  },
  recentChipPrice: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    color: Colors.success,
  },
  aiSearchPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '18',
    gap: 12,
  },
  aiSearchPromptIcon: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiSearchPromptContent: {
    flex: 1,
    gap: 2,
  },
  aiSearchPromptTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  aiSearchPromptDesc: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
  },
  aiSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiSearchBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  aiResultsContainer: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
    overflow: 'hidden' as const,
  },
  aiResultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: Colors.primary + '08',
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.primary + '18',
  },
  aiResultsTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiResultsTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  aiLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    justifyContent: 'center',
  },
  aiLoadingText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.primary,
    fontWeight: '500' as const,
  },
  aiErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    backgroundColor: Colors.errorLight,
  },
  aiErrorText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.error,
    flex: 1,
  },
  aiResultCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.line,
    gap: 6,
  },
  aiResultMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  aiResultName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    lineHeight: 19,
  },
  aiResultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  aiResultPrice: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  aiResultBrand: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    fontWeight: '500' as const,
  },
  aiResultTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  aiSourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
  },
  aiSourceTagText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  aiConfBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
  },
  aiConfDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  aiConfText: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
  aiAddBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiResultDesc: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 17,
  },
  aiRelatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    backgroundColor: Colors.infoLight,
  },
  aiRelatedText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.info,
    fontWeight: '500' as const,
    flex: 1,
  },
  customEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: themeColors.line,
    borderStyle: 'dashed' as const,
  },
  customEntryBtnText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  unitChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.fillTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  unitChipActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary,
  },
  unitChipText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  unitChipTextActive: {
    color: Colors.primary,
  },
});

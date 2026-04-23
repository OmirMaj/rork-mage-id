# Estimates, Estimate Wizard & Materials


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Estimating — the core value prop of the app.

- `app/(tabs)/estimate/index.tsx` — the estimate builder. Includes a material
  picker modal (recently fixed: a ScrollView was added so tall popups reach
  their Add-to-Estimate CTA on short phones).
- `app/estimate-wizard.tsx` — a modal-presented wizard for new projects.
- `utils/estimator.ts` — estimating math; plugs into assemblies, labor rates,
  productivity rates.
- `components/AIQuickEstimate.tsx`, `AIEstimateValidator.tsx`,
  `SquareFootEstimator.tsx`, `EstimateComparison.tsx`,
  `CostBreakdownReport.tsx`, `ProductivityCalculator.tsx` — estimating UI
  helpers and AI assists.
- `app/(tabs)/materials/` — material catalogue by category.


## Files in this bundle

- `app/(tabs)/estimate/index.tsx`
- `app/estimate-wizard.tsx`
- `app/(tabs)/materials/index.tsx`
- `app/(tabs)/materials/[category].tsx`
- `utils/estimator.ts`
- `utils/materialDatabase.ts`
- `utils/materialFinder.ts`
- `components/AIQuickEstimate.tsx`
- `components/AIEstimateValidator.tsx`
- `components/SquareFootEstimator.tsx`
- `components/EstimateComparison.tsx`
- `components/CostBreakdownReport.tsx`
- `components/ProductivityCalculator.tsx`


---

### `app/(tabs)/estimate/index.tsx`

```tsx
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
  Layers, Droplets, Zap, Hammer, Trees, Home, PaintBucket,
  ArrowRight, Percent, ShoppingCart, CheckCircle, Info, RefreshCw,
  Truck, Package, Wrench, Wind, Shield, Grid,
  TrendingUp, AlertTriangle, Lightbulb, Clock3, Database, MapPin,
  Mail, MessageSquare, FolderOpen, FileText, Send,
  HardHat, Boxes, ClipboardList, Ruler, Calculator, Gauge, GitCompare,
  ChevronRight,
} from 'lucide-react-native';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';
import { CATEGORY_META, getLivePrices, getRegionMultiplier, EXPANDED_MATERIALS, REGIONAL_FACTORS, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { generateUUID } from '@/utils/generateId';
import { findMaterials, type AIMaterialResult } from '@/utils/materialFinder';
import {
  saveToLocalDatabase, getCustomMaterials, searchCustomMaterials,
  getPopularCustomMaterials, aiResultToSavedMaterial, addRecentMaterial,
  getRecentMaterials, type SavedMaterial, type RecentMaterial,
} from '@/utils/materialDatabase';
import { Sparkles, Wifi, PlusCircle, History, Star } from 'lucide-react-native';
import { generateAndSharePDF, generateEstimatePDFUri } from '@/utils/pdfGenerator';
import * as Sharing from 'expo-sharing';
import PDFPreSendSheet from '@/components/PDFPreSendSheet';
import type { PDFSendOptions } from '@/components/PDFPreSendSheet';
import { sendEmail, buildEstimateEmailHtml } from '@/utils/emailService';
import type { LinkedEstimate, LinkedEstimateItem, Project } from '@/types';
import { LABOR_RATES, LABOR_CATEGORIES, type LaborRate } from '@/constants/laborRates';
import { ASSEMBLIES, ASSEMBLY_CATEGORIES, type AssemblyItem } from '@/constants/assemblies';
import { ESTIMATE_TEMPLATES, TEMPLATE_CATEGORIES, type EstimateTemplate } from '@/constants/estimateTemplates';
import SquareFootEstimator from '@/components/SquareFootEstimator';
import ProductivityCalculator from '@/components/ProductivityCalculator';
import CostBreakdownReport from '@/components/CostBreakdownReport';
import EstimateComparison from '@/components/EstimateComparison';
import AIEstimateValidator from '@/components/AIEstimateValidator';
import AICopilot from '@/components/AICopilot';
import AIQuickEstimate from '@/components/AIQuickEstimate';
import { CATEGORY_COST_FACTORS } from '@/constants/materials';
import { formatMoney } from '@/utils/formatters';

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
  { id: 'electrical', label: 'Electrical', icon: Zap },
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
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const router = useRouter();
  const { projects, updateProject, settings, updateSettings, contacts } = useProjects();

  const locationMultiplier = useMemo(() => getRegionMultiplier(settings.location), [settings.location]);
  const regionLabel = useMemo(() => {
    // Pick the region whose multiplier matches. Ties (both ~1.00) are rare and
    // fall through to "National Avg" which is fine.
    const match = REGIONAL_FACTORS.find(r => Math.abs(r.multiplier - locationMultiplier) < 0.001);
    return match?.label ?? 'National Avg';
  }, [locationMultiplier]);
  // Stable seed — previously Date.now()/10000 which caused prices to drift by a cent
  // on every refresh (app resume, 5min interval, location change). Pricing is now
  // deterministic per-location so estimates don't mysteriously change after you leave.
  const PRICE_SEED = 1;
  const [materials, setMaterials] = useState<MaterialItem[]>(() => getLivePrices(PRICE_SEED, locationMultiplier));
  const [_lastUpdated, setLastUpdated] = useState(new Date());
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [globalMarkup, setGlobalMarkup] = useState(15);
  const [globalMarkupInput, setGlobalMarkupInput] = useState('15');
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
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
    setCart(prev => [...prev, {
      material: materialItem,
      quantity: 1,
      markup: globalMarkup,
      usesBulk: false,
    }]);
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
  }, [globalMarkup, cartAnim]);

  const handleAddCustomMaterial = useCallback(() => {
    const price = parseFloat(customPrice);
    if (!customName.trim() || isNaN(price) || price <= 0) {
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
    setCart(prev => [...prev, {
      material: materialItem,
      quantity: 1,
      markup: globalMarkup,
      usesBulk: false,
    }]);
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
  }, [customName, customPrice, customUnit, customCategory, customNotes, globalMarkup, cartAnim]);

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
    setCart(prev => prev.map(cartItem => {
      const updated = newPrices.find(m => m.id === cartItem.material.id);
      if (updated) return { ...cartItem, material: updated };
      return cartItem;
    }));
  }, [locationMultiplier]);

  // Only re-price when location changes. Removed the 5-minute interval and the
  // AppState resume refresh — those were causing estimates to drift by a cent
  // every time the user left and came back.
  useEffect(() => {
    refreshPrices();
  }, [locationMultiplier, refreshPrices]);

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

  const filteredAssemblies = useMemo(() => {
    let results = ASSEMBLIES;
    if (assemblyCategory !== 'all') results = results.filter(a => a.category === assemblyCategory);
    if (assemblyQuery.trim()) {
      const q = assemblyQuery.toLowerCase();
      results = results.filter(a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
    }
    return results;
  }, [assemblyQuery, assemblyCategory]);

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
    const hours = parseFloat(laborHoursInput);
    const rate = parseFloat(laborRateInput);
    if (isNaN(hours) || hours <= 0 || isNaN(rate) || rate <= 0) {
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
      const found = materials.find(m => m.id === mat.materialId);
      const price = found ? found.baseBulkPrice : 15;
      materialsCost += price * mat.quantityPerUnit * (1 + mat.wasteFactor) * qty;
    }
    let laborCost = 0;
    for (const lab of assembly.laborPerUnit) {
      const rate = LABOR_RATES.find(r => r.trade === lab.trade);
      laborCost += (rate?.hourlyRate ?? 25) * lab.hoursPerUnit * qty;
    }
    return { materialsCost, laborCost, totalCost: materialsCost + laborCost };
  }, [materials]);

  const handleAddAssembly = useCallback(() => {
    if (!selectedAssembly) return;
    const qty = parseFloat(assemblyQtyInput);
    if (isNaN(qty) || qty <= 0) {
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
    setCart(prev => {
      const map = new Map<string, CartItem>();
      for (const item of prev) map.set(item.material.id, item);
      for (const item of aiMaterials) {
        const existing = map.get(item.material.id);
        if (existing) {
          const newQty = existing.quantity + item.quantity;
          map.set(item.material.id, { ...existing, quantity: newQty, usesBulk: newQty >= existing.material.bulkMinQty });
        } else {
          map.set(item.material.id, item);
        }
      }
      return Array.from(map.values());
    });
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
  }, [cartAnim]);

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
        delta: quantityGap, tone: quantityGap > 0 ? 'positive' : 'neutral', icon: Lightbulb,
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
    const qty = parseInt(itemQty, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid quantity.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCart(prev => {
      const existing = prev.find(i => i.material.id === selectedMaterial.id);
      if (existing) {
        return prev.map(i =>
          i.material.id === selectedMaterial.id
            ? { ...i, quantity: qty, usesBulk: qty >= i.material.bulkMinQty }
            : i
        );
      }
      return [...prev, {
        material: selectedMaterial,
        quantity: qty,
        markup: globalMarkup,
        usesBulk: qty >= selectedMaterial.bulkMinQty,
      }];
    });
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
  }, [selectedMaterial, itemQty, globalMarkup, cartAnim]);

  const popupLineTotal = useMemo(() => {
    if (!selectedMaterial) return 0;
    const qty = parseInt(itemQty, 10) || 0;
    const usesBulk = qty >= selectedMaterial.bulkMinQty;
    const base = usesBulk ? selectedMaterial.baseBulkPrice : selectedMaterial.baseRetailPrice;
    return base * (1 + globalMarkup / 100) * qty;
  }, [selectedMaterial, itemQty, globalMarkup]);

  const updateQuantity = useCallback((id: string, delta: number) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setCart(prev =>
      prev
        .map(i => {
          if (i.material.id !== id) return i;
          const newQty = Math.max(0, i.quantity + delta);
          return { ...i, quantity: newQty, usesBulk: newQty >= i.material.bulkMinQty };
        })
        .filter(i => i.quantity > 0)
    );
  }, []);

  const updateItemMarkup = useCallback((id: string, markup: number) => {
    setCart(prev => prev.map(i => i.material.id === id ? { ...i, markup } : i));
  }, []);

  const removeFromCart = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCart(prev => prev.filter(i => i.material.id !== id));
  }, []);

  const buildLinkedEstimate = useCallback((): LinkedEstimate => {
    const items: LinkedEstimateItem[] = cart.map(item => {
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
    return {
      id: generateUUID(),
      items,
      globalMarkup,
      baseTotal: cartBaseTotal,
      markupTotal,
      grandTotal: cartTotal,
      createdAt: new Date().toISOString(),
    };
  }, [cart, globalMarkup, cartBaseTotal, markupTotal, cartTotal]);

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
      updateProject(pendingLinkProject.id, {
        linkedEstimate: {
          ...linkedEst,
          items: mergedItems,
          baseTotal: mergedBase,
          markupTotal: mergedMarkup,
          grandTotal: mergedGrand,
        },
        status: 'estimated',
      });
    } else {
      updateProject(pendingLinkProject.id, {
        linkedEstimate: linkedEst,
        status: 'estimated',
      });
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
    setShowCart(false);
    setTimeout(() => setShowPDFPreSend(true), 350);
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
        subject: `${branding.companyName || 'MAGE ID'} - Estimate - ${options.fileName || 'Project'}`,
        html: emailHtml,
        replyTo: branding.email || undefined,
        attachments: pdfUri ? [pdfUri] : undefined,
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
  }, [cart, settings, buildLinkedEstimate, cartTotal]);

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
    setGlobalMarkup(val);
    setGlobalMarkupInput(String(val));
    setCart(prev => prev.map(i => ({ ...i, markup: val })));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

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
                    <Database size={10} color={Colors.info} />
                    <Text style={styles.rsMeansBadgeText}>Regional</Text>
                  </View>
                )}
                <View style={styles.supplierRow}>
                  <Truck size={10} color={Colors.textMuted} />
                  <Text style={styles.supplierText}>{item.supplier}</Text>
                </View>
              </View>
            </View>

            <View style={[styles.addButton, inCart && styles.addButtonActive]}>
              {inCart
                ? <CheckCircle size={20} color={Colors.textOnPrimary} />
                : <Plus size={20} color={Colors.textOnPrimary} />
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
                  <MapPin size={10} color={Colors.info} />
                  <Text style={styles.materialSignalText}>{item.region}</Text>
                </View>
              )}
              {item.crew && item.specTier === 'assembly' && (
                <View style={styles.materialSignalChip}>
                  <Hammer size={10} color={Colors.warning} />
                  <Text style={styles.materialSignalText}>{item.crew}</Text>
                </View>
              )}
              {typeof item.wasteFactor === 'number' && (
                <View style={styles.materialSignalChip}>
                  <Percent size={10} color={Colors.accent} />
                  <Text style={styles.materialSignalText}>Waste {(item.wasteFactor * 100).toFixed(0)}%</Text>
                </View>
              )}
            </View>
            {inCart && (
              <View style={styles.inCartRow}>
                <CheckCircle size={13} color={Colors.success} />
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
            {isExpanded ? <ChevronUp size={16} color={Colors.textMuted} /> : <ChevronDown size={16} color={Colors.textMuted} />}
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
            {isCostExpanded ? <ChevronUp size={12} color={Colors.textMuted} /> : <ChevronDown size={12} color={Colors.textMuted} />}
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
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQuantity(item.material.id, -1)}>
                  <Minus size={14} color={Colors.primary} />
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => updateQuantity(item.material.id, 1)}>
                  <Plus size={14} color={Colors.primary} />
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
                <CheckCircle size={13} color={Colors.success} />
                <Text style={styles.bulkActiveTxt}>Bulk discount applied — min {item.material.bulkMinQty} {item.material.unit}</Text>
              </View>
            )}

            <TouchableOpacity style={styles.removeBtn} onPress={() => removeFromCart(item.material.id)}>
              <Trash2 size={14} color={Colors.error} />
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }, [expandedItem, expandedCostBreakdown, updateQuantity, updateItemMarkup, removeFromCart]);

  const listHeaderComponent = useMemo(() => (
    <View>
      <TouchableOpacity
        style={styles.wizardCta}
        onPress={() => router.push('/estimate-wizard' as any)}
        activeOpacity={0.85}
        testID="wizard-cta"
      >
        <View style={styles.wizardCtaIcon}>
          <Sparkles size={18} color="#FFFFFF" />
        </View>
        <View style={styles.wizardCtaText}>
          <Text style={styles.wizardCtaTitle}>Quick Estimate Wizard</Text>
          <Text style={styles.wizardCtaSubtitle}>Answer 8 questions, get an AI-generated estimate</Text>
        </View>
        <ChevronRight size={18} color="#FFFFFF" />
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
              onPress={() => setShowAIQuickEstimate(true)}
              activeOpacity={0.8}
              testID="ai-quick-estimate-btn"
            >
              <Sparkles size={13} color={Colors.textOnPrimary} />
              <Text style={styles.aiEstimateBtnText}>AI</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={() => setShowSqftEstimator(true)}
              activeOpacity={0.7}
              testID="quick-estimate-btn"
            >
              <Calculator size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={() => setShowProductivityCalc(true)}
              activeOpacity={0.7}
              testID="productivity-btn"
            >
              <Gauge size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshIconBtn}
              onPress={refreshPrices}
              activeOpacity={0.7}
              testID="refresh-btn"
            >
              <RefreshCw size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cartButton}
              onPress={() => setShowCart(true)}
              activeOpacity={0.8}
              testID="cart-btn"
            >
              <Animated.View style={{ transform: [{ scale: cartAnim }] }}>
                <ShoppingCart size={20} color={Colors.surface} />
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
          <Search size={18} color={isSearchFocused ? Colors.primary : Colors.textMuted} />
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
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>}

        {activeTab === 'materials' && <View style={styles.markupRow}>
          <Percent size={14} color={Colors.accent} />
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
                    setGlobalMarkup(n);
                    setCart(prev => prev.map(i => ({ ...i, markup: n })));
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
            <History size={14} color={Colors.textSecondary} />
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
            <Star size={14} color={Colors.accent} />
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
            <Sparkles size={20} color={Colors.primary} />
          </View>
          <View style={aiStyles.aiSearchPromptContent}>
            <Text style={aiStyles.aiSearchPromptTitle}>Can't find what you need?</Text>
            <Text style={aiStyles.aiSearchPromptDesc}>AI will search suppliers for real-time pricing</Text>
          </View>
          <TouchableOpacity style={aiStyles.aiSearchBtn} onPress={handleAiSearch} activeOpacity={0.8}>
            <Wifi size={14} color={Colors.textOnPrimary} />
            <Text style={aiStyles.aiSearchBtnText}>Search Live</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'materials' && showAiResults && (
        <View style={aiStyles.aiResultsContainer}>
          <View style={aiStyles.aiResultsHeader}>
            <View style={aiStyles.aiResultsTitleRow}>
              <Sparkles size={14} color={Colors.primary} />
              <Text style={aiStyles.aiResultsTitle}>Live Search: "{query}"</Text>
            </View>
            <TouchableOpacity onPress={() => { setShowAiResults(false); setAiSearchResults([]); }}>
              <X size={16} color={Colors.textMuted} />
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
              <AlertTriangle size={14} color={Colors.error} />
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
                      <View style={[aiStyles.aiSourceTag, { backgroundColor: '#9333EA18' }]}>
                        <Sparkles size={9} color="#9333EA" />
                        <Text style={[aiStyles.aiSourceTagText, { color: '#9333EA' }]}>AI Found</Text>
                      </View>
                      <View style={[aiStyles.aiConfBadge, { backgroundColor: confColor + '18' }]}>
                        <View style={[aiStyles.aiConfDot, { backgroundColor: confColor }]} />
                        <Text style={[aiStyles.aiConfText, { color: confColor }]}>{aiMat.priceConfidence}</Text>
                      </View>
                    </View>
                  </View>
                  <TouchableOpacity style={aiStyles.aiAddBtn} onPress={() => handleAddAiMaterial(aiMat)} activeOpacity={0.7}>
                    <Plus size={18} color={Colors.textOnPrimary} />
                  </TouchableOpacity>
                </View>
                {aiMat.description && <Text style={aiStyles.aiResultDesc} numberOfLines={2}>{aiMat.description}</Text>}
              </View>
            );
          })}
          {aiSearchResults.length > 0 && aiSearchResults[0].relatedItems.length > 0 && (
            <View style={aiStyles.aiRelatedRow}>
              <Lightbulb size={12} color={Colors.info} />
              <Text style={aiStyles.aiRelatedText}>Related: {aiSearchResults[0].relatedItems.slice(0, 4).join(', ')}</Text>
            </View>
          )}
        </View>
      )}

      {activeTab === 'materials' && (
        <TouchableOpacity style={aiStyles.customEntryBtn} onPress={() => setShowCustomForm(true)} activeOpacity={0.7}>
          <PlusCircle size={14} color={Colors.primary} />
          <Text style={aiStyles.customEntryBtnText}>Add Custom Material</Text>
          <ChevronRight size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      )}

      {activeTab === 'materials' && cart.length > 0 && (
        <View style={styles.opportunityPanel} testID="opportunity-panel">
          <View style={styles.opportunityHeader}>
            <View style={styles.opportunityTitleWrap}>
              <Clock3 size={14} color={Colors.info} />
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
  ), [materials.length, totalMaterialCount, pulseAnim, refreshPrices, cart.length, totalItemCount, cartAnim, isSearchFocused, query, globalMarkup, globalMarkupInput, applyGlobalMarkup, activeCategory, activeTab, filteredMaterials.length, regionalVisibleCount, opportunities, laborCart.length, assemblyCart.length, recentMaterials, popularMaterials, showAiResults, isAiSearching, aiSearchError, aiSearchResults, handleAiSearch, handleAddAiMaterial, handleAddRecentToCart, router]);

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
                  <Ruler size={10} color={Colors.textMuted} />
                  <Text style={styles.supplierText}>${item.rateRange.low}-${item.rateRange.high}/hr</Text>
                </View>
              </View>
            </View>
            <View style={[styles.addButton, inCart && styles.addButtonActive]}>
              {inCart ? <CheckCircle size={20} color={Colors.textOnPrimary} /> : <Plus size={20} color={Colors.textOnPrimary} />}
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
                <Database size={10} color={Colors.info} />
                <Text style={styles.rsMeansBadgeText}>BLS Data</Text>
              </View>
            </View>
          </View>
          <View style={styles.materialFooterRow}>
            <View style={styles.materialSignalGroup}>
              <View style={styles.materialSignalChip}>
                <HardHat size={10} color={Colors.accent} />
                <Text style={styles.materialSignalText}>{item.crew}</Text>
              </View>
              <View style={styles.materialSignalChip}>
                <Clock3 size={10} color={Colors.info} />
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
                <CheckCircle size={13} color={Colors.success} />
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
    return (
      <View style={styles.materialCardWrapper}>
        <TouchableOpacity style={styles.materialCard} onPress={() => openAssemblyPopup(item)} activeOpacity={0.7}>
          <View style={styles.materialMain}>
            <View style={styles.materialInfo}>
              <Text style={styles.materialName}>{item.name}</Text>
              <Text style={styles.supplierText} numberOfLines={2}>{item.description}</Text>
            </View>
            <View style={[styles.addButton, inCart && styles.addButtonActive]}>
              {inCart ? <CheckCircle size={20} color={Colors.textOnPrimary} /> : <Plus size={20} color={Colors.textOnPrimary} />}
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
              <View style={[styles.categoryBadge, { backgroundColor: Colors.primary + '15' }]}>
                <Text style={[styles.categoryBadgeText, { color: Colors.primary }]}>{item.category}</Text>
              </View>
              <View style={styles.materialSignalChip}>
                <Text style={styles.materialSignalText}>{item.unit}</Text>
              </View>
              {item.laborPerUnit.map((l, i) => (
                <View key={`${l.trade}-${i}`} style={styles.materialSignalChip}>
                  <HardHat size={10} color={Colors.accent} />
                  <Text style={styles.materialSignalText}>{l.trade}</Text>
                </View>
              ))}
            </View>
            {inCart && (
              <View style={styles.inCartRow}>
                <CheckCircle size={13} color={Colors.success} />
                <Text style={styles.inCartText}>qty {inCart.quantity}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [assemblyCart, openAssemblyPopup, calculateAssemblyCost]);

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
              <Plus size={20} color={Colors.textOnPrimary} />
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
                  <Ruler size={10} color={Colors.textMuted} />
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
    </View>
  ), [listHeaderComponent, laborCategory, filteredLabor.length]);

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
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.refreshIconBtn} onPress={() => setShowSqftEstimator(true)} activeOpacity={0.7}>
              <Calculator size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshIconBtn} onPress={() => setShowProductivityCalc(true)} activeOpacity={0.7}>
              <Gauge size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.refreshIconBtn} onPress={refreshPrices} activeOpacity={0.7}>
              <RefreshCw size={15} color={Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.cartButton} onPress={() => setShowCart(true)} activeOpacity={0.8}>
              <ShoppingCart size={20} color={Colors.surface} />
              {totalItemCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{totalItemCount}</Text>
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
                  <Search size={18} color={Colors.textMuted} />
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
                    <TouchableOpacity onPress={() => setQuery('')}>
                      <X size={16} color={Colors.textMuted} />
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
                            <CheckCircle size={14} color={Colors.textOnPrimary} />
                          </View>
                        ) : (
                          <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                            <Plus size={14} color={Colors.textOnPrimary} />
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
                          <CheckCircle size={14} color={Colors.textOnPrimary} />
                        </View>
                      ) : (
                        <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                          <Plus size={14} color={Colors.textOnPrimary} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            {activeTab === 'assemblies' && (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {filteredAssemblies.map(item => (
                  <TouchableOpacity key={item.id} style={dStyles.catalogItem} onPress={() => openAssemblyPopup(item)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={dStyles.catalogItemName} numberOfLines={1}>{item.name}</Text>
                      <Text style={dStyles.catalogItemPrice}>{item.unit}</Text>
                    </View>
                    <View style={[styles.addButton, { width: 26, height: 26, borderRadius: 13 }]}>
                      <Plus size={14} color={Colors.textOnPrimary} />
                    </View>
                  </TouchableOpacity>
                ))}
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
                      <Plus size={14} color={Colors.textOnPrimary} />
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
                  <ShoppingCart size={40} color={Colors.textMuted} />
                  <Text style={styles.emptyTitle}>No items yet</Text>
                  <Text style={styles.emptyDesc}>Add items from the catalog on the left</Text>
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
                              <TouchableOpacity style={{ width: 32, alignItems: 'center' as const }} onPress={() => removeFromCart(item.material.id)}>
                                <Trash2 size={14} color={Colors.error} />
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
                            <TouchableOpacity style={{ width: 32, alignItems: 'center' as const }} onPress={() => removeLaborItem(item.labor.id)}>
                              <Trash2 size={14} color={Colors.error} />
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
                            <TouchableOpacity style={{ width: 32, alignItems: 'center' as const }} onPress={() => removeAssemblyItem(item.assembly.id)}>
                              <Trash2 size={14} color={Colors.error} />
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
                <FolderOpen size={14} color={Colors.textOnPrimary} />
                <Text style={dStyles.summaryActionText}>Save to Project</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[dStyles.summaryActionBtn, { backgroundColor: Colors.primary + '12' }]} onPress={handleOpenPDFPreSend} activeOpacity={0.85}>
                <FileText size={14} color={Colors.primary} />
                <Text style={[dStyles.summaryActionText, { color: Colors.primary }]}>Export PDF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[dStyles.summaryActionBtn, { backgroundColor: Colors.info + '12' }]} onPress={() => setShowComparison(true)} activeOpacity={0.85}>
                <GitCompare size={14} color={Colors.info} />
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
                    <TouchableOpacity onPress={() => setShowItemPopup(false)} style={styles.popupCloseBtn}>
                      <X size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.popupFieldLabel}>Quantity</Text>
                  <View style={styles.popupQtyRow}>
                    <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setItemQty(String(Math.max(1, (parseInt(itemQty, 10) || 1) - 1)))}>
                      <Minus size={18} color={Colors.primary} />
                    </TouchableOpacity>
                    <TextInput style={styles.popupQtyInput} value={itemQty} onChangeText={setItemQty} keyboardType="number-pad" textAlign="center" />
                    <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setItemQty(String((parseInt(itemQty, 10) || 0) + 1))}>
                      <Plus size={18} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.popupTotalRow}>
                    <Text style={styles.popupTotalLabel}>Line Total</Text>
                    <Text style={styles.popupTotalValue}>{formatMoney(popupLineTotal, 2)}</Text>
                  </View>
                  <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddFromPopup} activeOpacity={0.85}>
                    <ShoppingCart size={18} color={Colors.textOnPrimary} />
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
                    <TouchableOpacity onPress={() => setShowLaborPopup(false)} style={styles.popupCloseBtn}>
                      <X size={18} color={Colors.textMuted} />
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
                    <TouchableOpacity onPress={() => setShowAssemblyPopup(false)} style={styles.popupCloseBtn}>
                      <X size={18} color={Colors.textMuted} />
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
                <TouchableOpacity onPress={() => setShowAddToProject(false)}>
                  <X size={20} color={Colors.textMuted} />
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
                      {selectedProjectId === project.id && <CheckCircle size={20} color={Colors.primary} />}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity style={styles.addToProjectConfirmBtn} onPress={handleSelectProject} activeOpacity={0.85}>
                <Send size={16} color={Colors.textOnPrimary} />
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
                <TouchableOpacity onPress={() => setShowConfirmLink(false)}><X size={20} color={Colors.textMuted} /></TouchableOpacity>
              </View>
              {pendingLinkProject && (
                <TouchableOpacity style={styles.addToProjectConfirmBtn} onPress={() => handleConfirmLink('replace')} activeOpacity={0.85}>
                  <CheckCircle size={16} color={Colors.textOnPrimary} />
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
            <Search size={40} color={Colors.textMuted} />
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
            <HardHat size={40} color={Colors.textMuted} />
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
                <Boxes size={40} color={Colors.textMuted} />
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
            <ClipboardList size={40} color={Colors.textMuted} />
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
            <ShoppingCart size={18} color={Colors.textOnPrimary} />
            <Text style={styles.floatingCartItems}>{totalItemCount} items</Text>
          </View>
          <Text style={styles.floatingCartTotal}>{formatMoney(grandTotal, 2)}</Text>
          <ArrowRight size={18} color={Colors.textOnPrimary} />
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
                  <TouchableOpacity onPress={() => setShowItemPopup(false)} style={styles.popupCloseBtn}>
                    <X size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <View style={styles.popupMeta}>
                  <View style={[styles.categoryBadge, { backgroundColor: getCategoryColor(selectedMaterial.category) + '22' }]}>
                    <Text style={[styles.categoryBadgeText, { color: getCategoryColor(selectedMaterial.category) }]}>
                      {CATEGORY_META[selectedMaterial.category]?.label ?? selectedMaterial.category}
                    </Text>
                  </View>
                  <View style={styles.supplierRow}>
                    <Truck size={10} color={Colors.textMuted} />
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
                    }}
                  >
                    <Minus size={18} color={Colors.primary} />
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
                    }}
                  >
                    <Plus size={18} color={Colors.primary} />
                  </TouchableOpacity>
                </View>

                {(parseInt(itemQty, 10) || 0) >= selectedMaterial.bulkMinQty && (
                  <View style={styles.popupBulkBanner}>
                    <CheckCircle size={14} color={Colors.success} />
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
                  <ShoppingCart size={18} color={Colors.textOnPrimary} />
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
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.modalContainer, { paddingTop: insets.top + 8 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Estimate</Text>
              <TouchableOpacity onPress={() => setShowCart(false)} style={styles.modalClose} testID="close-cart">
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {totalItemCount === 0 ? (
              <View style={styles.cartEmpty}>
                <ShoppingCart size={48} color={Colors.textMuted} />
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
                                <TouchableOpacity onPress={() => removeLaborItem(item.labor.id)}>
                                  <Trash2 size={14} color={Colors.error} />
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
                                <TouchableOpacity onPress={() => removeAssemblyItem(item.assembly.id)}>
                                  <Trash2 size={14} color={Colors.error} />
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
                        <CheckCircle size={13} color={Colors.success} />
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
                        setShowCart(false);
                        setTimeout(() => {
                          setShowAddToProject(true);
                        }, 350);
                      }}
                      activeOpacity={0.85}
                      testID="add-to-project-btn"
                    >
                      <FolderOpen size={16} color={Colors.textOnPrimary} />
                      <Text style={styles.addToProjectBtnText}>Add to Project</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.compareBtn}
                      onPress={() => {
                        setShowCart(false);
                        setTimeout(() => setShowComparison(true), 350);
                      }}
                      activeOpacity={0.85}
                      testID="compare-btn"
                    >
                      <GitCompare size={16} color={Colors.primary} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.cartShareRow}>
                    <TouchableOpacity style={styles.cartShareBtn} onPress={handleOpenPDFPreSend} activeOpacity={0.7} testID="cart-share-pdf">
                      <FileText size={16} color={Colors.primary} />
                      <Text style={styles.cartShareBtnText}>PDF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cartShareBtn} onPress={handleShareEmail} activeOpacity={0.7} testID="cart-share-email">
                      <Mail size={16} color={Colors.primary} />
                      <Text style={styles.cartShareBtnText}>Email</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.cartShareBtn} onPress={handleShareText} activeOpacity={0.7} testID="cart-share-text">
                      <MessageSquare size={16} color={Colors.primary} />
                      <Text style={styles.cartShareBtnText}>Text</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.clearBtn}
                      onPress={() => {
                        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setCart([]);
                        setLaborCart([]);
                        setAssemblyCart([]);
                      }}
                    >
                      <Trash2 size={16} color={Colors.error} />
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
              <TouchableOpacity onPress={() => setShowAddToProject(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.addToProjectDesc}>
              Select a project to attach this {cart.length}-item estimate ({formatMoney(cartTotal, 2)}) to.
            </Text>

            {projects.length === 0 ? (
              <View style={styles.addToProjectEmpty}>
                <FolderOpen size={32} color={Colors.textMuted} />
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
                      <CheckCircle size={20} color={Colors.primary} />
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
                <Send size={16} color={Colors.textOnPrimary} />
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
              <TouchableOpacity onPress={() => setShowConfirmLink(false)}>
                <X size={20} color={Colors.textMuted} />
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
                    <Text style={styles.confirmSummaryValue}>{cart.length}</Text>
                  </View>
                  <View style={styles.confirmSummaryRow}>
                    <Text style={styles.confirmSummaryLabel}>Estimate Value</Text>
                    <Text style={styles.confirmSummaryValueBold}>${cartTotal.toFixed(2)}</Text>
                  </View>
                  <View style={styles.confirmDivider} />
                  <View style={styles.confirmSummaryRow}>
                    <Text style={styles.confirmSummaryLabel}>Project</Text>
                    <Text style={styles.confirmSummaryValue}>{pendingLinkProject.name}</Text>
                  </View>
                </View>

                {pendingLinkProject.linkedEstimate ? (
                  <View style={styles.existingEstimateWarning}>
                    <AlertTriangle size={16} color={Colors.warning} />
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
                      <Layers size={16} color={Colors.info} />
                      <Text style={styles.confirmMergeBtnText}>Merge Items</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.confirmReplaceBtn}
                      onPress={() => handleConfirmLink('replace')}
                      activeOpacity={0.85}
                    >
                      <RefreshCw size={16} color={Colors.textOnPrimary} />
                      <Text style={styles.confirmReplaceBtnText}>Replace</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addToProjectConfirmBtn}
                    onPress={() => handleConfirmLink('replace')}
                    activeOpacity={0.85}
                  >
                    <CheckCircle size={16} color={Colors.textOnPrimary} />
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
                  <TouchableOpacity onPress={() => setShowLaborPopup(false)} style={styles.popupCloseBtn}>
                    <X size={18} color={Colors.textMuted} />
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
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setLaborHoursInput(String(Math.max(1, (parseFloat(laborHoursInput) || 1) - 1)))}>
                    <Minus size={18} color={Colors.primary} />
                  </TouchableOpacity>
                  <TextInput style={styles.popupQtyInput} value={laborHoursInput} onChangeText={setLaborHoursInput} keyboardType="decimal-pad" textAlign="center" />
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setLaborHoursInput(String((parseFloat(laborHoursInput) || 0) + 1))}>
                    <Plus size={18} color={Colors.primary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.popupTotalRow}>
                  <Text style={styles.popupTotalLabel}>Line Total</Text>
                  <Text style={styles.popupTotalValue}>${((parseFloat(laborRateInput) || 0) * (parseFloat(laborHoursInput) || 0)).toFixed(2)}</Text>
                </View>
                <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddLabor} activeOpacity={0.85}>
                  <HardHat size={18} color={Colors.textOnPrimary} />
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
                  <TouchableOpacity onPress={() => setShowAssemblyPopup(false)} style={styles.popupCloseBtn}>
                    <X size={18} color={Colors.textMuted} />
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
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setAssemblyQtyInput(String(Math.max(1, (parseFloat(assemblyQtyInput) || 1) - 1)))}>
                    <Minus size={18} color={Colors.primary} />
                  </TouchableOpacity>
                  <TextInput style={styles.popupQtyInput} value={assemblyQtyInput} onChangeText={setAssemblyQtyInput} keyboardType="decimal-pad" textAlign="center" />
                  <TouchableOpacity style={styles.popupQtyBtn} onPress={() => setAssemblyQtyInput(String((parseFloat(assemblyQtyInput) || 0) + 1))}>
                    <Plus size={18} color={Colors.primary} />
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
                    <Info size={14} color={Colors.info} />
                    <Text style={[styles.popupBulkText, { color: Colors.info }]}>{selectedAssembly.notes}</Text>
                  </View>
                ) : null}
                <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddAssembly} activeOpacity={0.85}>
                  <Boxes size={18} color={Colors.textOnPrimary} />
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
              <TouchableOpacity onPress={() => setShowCustomForm(false)} style={styles.popupCloseBtn}>
                <X size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.popupFieldLabel}>Material Name</Text>
            <TextInput
              style={[styles.popupQtyInput, { textAlign: 'left' as const, paddingHorizontal: 14, fontSize: 15 }]}
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
                  <Text style={[styles.categoryChipText, customCategory === cat.id && styles.categoryChipTextActive, { fontSize: 11 }]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.popupFieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.popupQtyInput, { textAlign: 'left' as const, paddingHorizontal: 14, fontSize: 14, height: 40 }]}
              value={customNotes}
              onChangeText={setCustomNotes}
              placeholder="Any notes about this material"
              placeholderTextColor={Colors.textMuted}
            />
            <TouchableOpacity style={styles.popupAddBtn} onPress={handleAddCustomMaterial} activeOpacity={0.85}>
              <PlusCircle size={18} color={Colors.textOnPrimary} />
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    borderRadius: 14,
    backgroundColor: '#5E5CE6',
    shadowColor: '#5E5CE6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  wizardCtaIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardCtaText: {
    flex: 1,
  },
  wizardCtaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  wizardCtaSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 1,
  },
  header: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 12,
    padding: 3,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabItemActive: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textMuted,
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  tabBadge: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
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
    color: Colors.textMuted,
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
  summaryMiniCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderLeftWidth: 3,
    gap: 2,
  },
  summaryMiniLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  summaryMiniValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  summaryMiniSub: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  cartSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
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
    color: Colors.text,
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
    fontSize: 11,
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
    fontSize: 12,
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
    borderRadius: 18,
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
    borderRadius: 8,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.surface,
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
    borderRadius: 14,
    paddingHorizontal: 12,
    gap: 8,
    height: 46,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  searchBarFocused: {
    backgroundColor: Colors.surface,
    borderColor: Colors.primary + '26',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
  },
  markupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  markupLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
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
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
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
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.text,
    width: 42,
  },
  markupCustomSuffix: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  categoriesWrapper: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
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
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.background,
    gap: 10,
  },
  resultsCount: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.2,
  },
  resultsMicroCopy: {
    fontSize: 11,
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
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  opportunitySubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  opportunityGrid: {
    gap: 8,
  },
  opportunityCard: {
    borderRadius: 10,
    padding: 10,
    gap: 6,
  },
  opportunityCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  opportunityCardTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  opportunityCardDetail: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  materialCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
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
    borderRadius: 999,
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
    fontSize: 11,
    color: Colors.textMuted,
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
    backgroundColor: Colors.background,
    borderRadius: 10,
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
    color: Colors.textMuted,
    marginRight: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  retailPrice: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  bulkPrice: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.success,
    letterSpacing: -0.3,
  },
  priceUnit: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  priceDivider: {
    width: 0.5,
    height: 24,
    backgroundColor: Colors.border,
  },
  bulkSavingsBadge: {
    alignItems: 'flex-end',
  },
  bulkSavingsText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  bulkMinText: {
    fontSize: 10,
    color: Colors.textMuted,
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
    borderRadius: 999,
    backgroundColor: Colors.fillSecondary,
  },
  materialSignalText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  inCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  inCartText: {
    fontSize: 12,
    color: Colors.success,
    fontWeight: '500' as const,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  emptyDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
  floatingCart: {
    position: 'absolute' as const,
    left: 16,
    right: 16,
    backgroundColor: Colors.primary,
    borderRadius: 18,
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
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textOnPrimary,
  },
  floatingCartTotal: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.9)',
    marginRight: 4,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    color: Colors.text,
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
    borderRadius: 10,
    padding: 12,
  },
  markupBannerText: {
    flex: 1,
    fontSize: 13,
    color: Colors.info,
    lineHeight: 18,
  },
  cartList: {
    padding: 16,
    gap: 8,
  },
  cartItem: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  cartItemSub: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  cartItemRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  cartItemTotal: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  cartItemExpanded: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    padding: 14,
    backgroundColor: Colors.surfaceAlt,
    gap: 12,
  },
  cartQtyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartExpandLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  qtyBtn: {
    padding: 4,
  },
  qtyValue: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
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
    borderRadius: 6,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  markupMiniChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  markupMiniText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  markupMiniTextActive: {
    color: Colors.textOnPrimary,
  },
  bulkActiveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: 8,
    padding: 8,
  },
  bulkActiveTxt: {
    fontSize: 12,
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
    fontSize: 13,
    color: Colors.error,
    fontWeight: '600' as const,
  },
  summaryCard: {
    margin: 16,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  summaryTotal: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  summaryTotalValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  bulkNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bulkNoteText: {
    fontSize: 12,
    color: Colors.success,
  },
  cartFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surface,
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
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  cartFooterValue: {
    fontSize: 20,
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
    borderRadius: 14,
    paddingVertical: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  addToProjectBtnText: {
    fontSize: 16,
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
    borderRadius: 12,
    paddingVertical: 10,
  },
  cartShareBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  clearBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
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
    borderRadius: 14,
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
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.fillSecondary,
  },
  costBreakdownToggleText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.1,
  },
  costBreakdownPanel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.surfaceAlt,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
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
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  costBreakdownRate: {
    fontSize: 10,
    color: Colors.textMuted,
    width: 100,
    textAlign: 'right' as const,
  },
  costBreakdownValue: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    width: 70,
    textAlign: 'right' as const,
  },
  costBreakdownDivider: {
    height: 0.5,
    backgroundColor: Colors.borderLight,
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
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  cartEmptyDesc: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  cartEmptyBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  cartEmptyBtnText: {
    fontSize: 15,
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
    backgroundColor: Colors.surface,
    borderRadius: 24,
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
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
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
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  popupPriceLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    marginRight: 4,
  },
  popupRetail: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textDecorationLine: 'line-through' as const,
  },
  popupBulk: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  popupPriceUnit: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  popupFieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
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
    borderRadius: 12,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  popupQtyInput: {
    flex: 1,
    height: 48,
    backgroundColor: Colors.background,
    borderRadius: 12,
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  popupBulkBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: 10,
    padding: 10,
  },
  popupBulkText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  popupBreakdown: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 12,
    gap: 6,
  },
  popupBreakdownTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
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
    fontSize: 13,
    color: Colors.textSecondary,
  },
  popupBreakdownLabelBold: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  popupBreakdownValue: {
    fontSize: 13,
    fontVariant: ['tabular-nums'] as any,
    color: Colors.text,
  },
  popupBreakdownValueBold: {
    fontSize: 14,
    fontWeight: '800' as const,
    fontVariant: ['tabular-nums'] as any,
    color: Colors.text,
  },
  popupBreakdownDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingTop: 6,
    marginTop: 2,
  },
  popupTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.primary + '08',
    borderRadius: 12,
    padding: 14,
  },
  popupTotalLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  popupTotalValue: {
    fontSize: 22,
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
    fontSize: 12,
    color: Colors.textMuted,
  },
  popupRunningValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  popupAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  popupAddBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  addToProjectCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
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
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  addToProjectDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  addToProjectEmpty: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 10,
  },
  addToProjectEmptyText: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
  projectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 14,
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
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  projectOptionMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  addToProjectConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
  },
  addToProjectConfirmText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  confirmLinkBody: {
    gap: 12,
  },
  confirmFieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  confirmInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  confirmSummaryCard: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  confirmSummaryRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  confirmSummaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  confirmSummaryValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  confirmSummaryValueBold: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  confirmDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },
  existingEstimateWarning: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.warningLight,
    borderRadius: 10,
    padding: 12,
  },
  existingEstimateText: {
    flex: 1,
    fontSize: 13,
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
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.info + '30',
  },
  confirmMergeBtnText: {
    fontSize: 14,
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
    borderRadius: 14,
    paddingVertical: 14,
  },
  confirmReplaceBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});

const dStyles = StyleSheet.create({
  desktopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  desktopBody: {
    flex: 1,
    flexDirection: 'row',
  },
  catalogPanel: {
    width: 280,
    backgroundColor: Colors.surface,
    borderRightWidth: 1,
    borderRightColor: Colors.borderLight,
  },
  catalogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    gap: 8,
  },
  catalogItemName: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  catalogItemPrice: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: '600' as const,
  },
  workspacePanel: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  wsSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  wsSectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  wsTable: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  wsTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.fillSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  wsHeaderCell: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  wsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  wsTableRowAlt: {
    backgroundColor: Colors.fillSecondary,
  },
  wsCell: {
    fontSize: 13,
    color: Colors.text,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  wsGrandTotalLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  wsGrandTotalValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  summaryPanel: {
    width: 300,
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.borderLight,
    padding: 20,
    gap: 10,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 4,
  },
  summaryGrand: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  summaryMetrics: {
    marginTop: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  summaryMetricTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textMuted,
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
    fontSize: 13,
    color: Colors.textSecondary,
  },
  summaryMetricValue: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
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
    borderRadius: 12,
    paddingVertical: 12,
  },
  summaryActionText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});

const aiStyles = StyleSheet.create({
  recentSection: {
    backgroundColor: Colors.surface,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  recentTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  recentChipsRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  recentChip: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    maxWidth: 180,
  },
  recentChipName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 2,
  },
  recentChipPrice: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.success,
  },
  aiSearchPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: Colors.primary + '08',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '18',
    gap: 12,
  },
  aiSearchPromptIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiSearchPromptContent: {
    flex: 1,
    gap: 2,
  },
  aiSearchPromptTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  aiSearchPromptDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  aiSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiSearchBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  aiResultsContainer: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    fontSize: 13,
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
    fontSize: 13,
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
    fontSize: 13,
    color: Colors.error,
    flex: 1,
  },
  aiResultCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    gap: 6,
  },
  aiResultMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  aiResultName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    lineHeight: 19,
  },
  aiResultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 3,
  },
  aiResultPrice: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  aiResultBrand: {
    fontSize: 11,
    color: Colors.textMuted,
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
    borderRadius: 6,
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
    borderRadius: 6,
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
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiResultDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
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
    fontSize: 12,
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
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderStyle: 'dashed' as const,
  },
  customEntryBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  unitChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  unitChipActive: {
    backgroundColor: Colors.primary + '15',
    borderColor: Colors.primary,
  },
  unitChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  unitChipTextActive: {
    color: Colors.primary,
  },
});

```


---

### `app/estimate-wizard.tsx`

```tsx
// Quick Estimate Wizard — 8 preset questions that feed mageAISmart for a
// fast, itemized construction estimate. Designed for the "I need a number
// now" moment where the full estimator is overkill.
//
// Flow:
//   Step 1 of 8 → project type
//   Step 2 of 8 → size
//   Step 3 of 8 → location
//   Step 4 of 8 → quality tier
//   Step 5 of 8 → scope summary
//   Step 6 of 8 → timeline
//   Step 7 of 8 → special requirements
//   Step 8 of 8 → budget target
//   → MAGE AI generates an itemized breakdown (materials, labor, permits,
//     contingency, subtotal, total)
//
// Result can be copied to clipboard or optionally dropped into a new
// project's estimate via the Projects context (left as a follow-up so the
// existing estimator isn't touched by this first pass).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Share,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Sparkles, Building2, Home, Wrench,
  DollarSign, CheckCircle2, Share2, RotateCcw,
} from 'lucide-react-native';
import { z } from 'zod';
import { Colors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';

interface WizardAnswers {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
}

const PROJECT_TYPES = [
  'New Build',
  'Full Remodel',
  'Kitchen Remodel',
  'Bathroom Remodel',
  'Addition',
  'Basement Finish',
  'ADU / Backyard Build',
  'Commercial TI',
  'Roof Replacement',
  'Deck / Outdoor',
];

const QUALITY_LABELS: Record<WizardAnswers['quality'], string> = {
  budget: 'Budget',
  standard: 'Standard',
  high_end: 'High-End',
};

const estimateSchema = z.object({
  summary: z.string().catch('').default(''),
  lineItems: z.array(z.object({
    category: z.string().catch('').default('Other'),
    description: z.string().catch('').default(''),
    quantity: z.number().catch(1).default(1),
    unit: z.string().catch('ea').default('ea'),
    unitCost: z.number().catch(0).default(0),
    total: z.number().catch(0).default(0),
  })).default([]),
  subtotal: z.number().catch(0).default(0),
  contingency: z.number().catch(0).default(0),
  permits: z.number().catch(0).default(0),
  total: z.number().catch(0).default(0),
  notes: z.array(z.string()).default([]),
});

type EstimateResult = z.infer<typeof estimateSchema>;

const INITIAL: WizardAnswers = {
  projectType: '',
  sizeSqft: '',
  location: '',
  quality: 'standard',
  scope: '',
  timelineWeeks: '',
  specialRequirements: '',
  targetBudget: '',
};

export default function EstimateWizardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<WizardAnswers>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EstimateResult | null>(null);

  const TOTAL_STEPS = 8;

  const set = useCallback(<K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return answers.projectType.length > 0;
      case 1: return answers.sizeSqft.trim().length > 0 && !isNaN(Number(answers.sizeSqft));
      case 2: return answers.location.trim().length > 0;
      case 3: return true;
      case 4: return answers.scope.trim().length > 10;
      case 5: return answers.timelineWeeks.trim().length > 0 && !isNaN(Number(answers.timelineWeeks));
      case 6: return true; // special requirements optional
      case 7: return true; // target budget optional
      default: return false;
    }
  }, [step, answers]);

  const next = useCallback(() => {
    if (!canAdvance) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  }, [canAdvance]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const generate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setResult(null);

    const prompt = `You are a construction cost estimator producing a quick first-pass budget for a US contractor. Use the following inputs and return a JSON object with an itemized line-by-line estimate.

Inputs:
- Project type: ${answers.projectType}
- Size: ${answers.sizeSqft} sqft
- Location: ${answers.location}
- Quality tier: ${QUALITY_LABELS[answers.quality]}
- Scope: ${answers.scope}
- Timeline: ${answers.timelineWeeks} weeks
- Special requirements: ${answers.specialRequirements || 'None'}
- Target budget: ${answers.targetBudget || 'Not specified'}

Return JSON with:
- summary: one paragraph plain-English overview of the estimate
- lineItems: array of { category, description, quantity, unit, unitCost, total } (total = quantity * unitCost)
- subtotal: sum of all lineItems totals
- contingency: ~10% of subtotal
- permits: rough permit/fees estimate for the location
- total: subtotal + contingency + permits
- notes: array of caveats (e.g. "assumes standard finishes", "excludes landscaping")

Use current regional pricing where possible. Round reasonably. Keep it under 15 line items.`;

    const cacheKey = `wizard::${answers.projectType}::${answers.sizeSqft}::${answers.location}::${answers.quality}::${answers.scope.slice(0, 80)}`;

    try {
      const res = await mageAISmart(prompt, estimateSchema, cacheKey);
      if (!res.success || !res.data) {
        Alert.alert('Estimate failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
      } else {
        setResult(res.data as EstimateResult);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      Alert.alert('Estimate failed', err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }, [answers, loading]);

  const share = useCallback(async () => {
    if (!result) return;
    const lines = [
      `MAGE ID Quick Estimate — ${answers.projectType}`,
      `${answers.sizeSqft} sqft, ${answers.location}`,
      '',
      result.summary,
      '',
      ...result.lineItems.map(
        (li) => `${li.category} · ${li.description}: ${li.quantity} ${li.unit} × $${li.unitCost.toFixed(2)} = $${li.total.toFixed(2)}`,
      ),
      '',
      `Subtotal: $${result.subtotal.toFixed(2)}`,
      `Contingency: $${result.contingency.toFixed(2)}`,
      `Permits: $${result.permits.toFixed(2)}`,
      `Total: $${result.total.toFixed(2)}`,
      '',
      ...(result.notes.length ? ['Notes:', ...result.notes.map((n) => `- ${n}`)] : []),
    ].join('\n');
    try {
      await Share.share({ message: lines, title: 'MAGE ID Quick Estimate' });
    } catch (err) {
      Alert.alert('Share failed', err instanceof Error ? err.message : 'Could not open share sheet.');
    }
  }, [result, answers]);

  const reset = useCallback(() => {
    setAnswers(INITIAL);
    setResult(null);
    setStep(0);
  }, []);

  const progressWidth = `${((step + 1) / TOTAL_STEPS) * 100}%` as const;

  if (result) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Quick Estimate' }} />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}>
          <View style={styles.resultHero}>
            <CheckCircle2 size={28} color={Colors.success} />
            <Text style={styles.resultHeroTitle}>Estimate Ready</Text>
            <Text style={styles.resultTotal}>${result.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            <Text style={styles.resultSubtitle}>{answers.projectType} · {answers.sizeSqft} sqft · {answers.location}</Text>
          </View>

          {result.summary ? <Text style={styles.resultBody}>{result.summary}</Text> : null}

          <Text style={styles.sectionTitle}>Line Items</Text>
          {result.lineItems.map((li, i) => (
            <View key={i} style={styles.lineItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineCategory}>{li.category}</Text>
                <Text style={styles.lineDesc}>{li.description}</Text>
                <Text style={styles.lineMeta}>{li.quantity} {li.unit} × ${li.unitCost.toFixed(2)}</Text>
              </View>
              <Text style={styles.lineTotal}>${li.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
          ))}

          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>${result.subtotal.toLocaleString()}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Contingency</Text><Text style={styles.totalValue}>${result.contingency.toLocaleString()}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Permits</Text><Text style={styles.totalValue}>${result.permits.toLocaleString()}</Text></View>
            <View style={[styles.totalRow, styles.totalRowGrand]}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={styles.grandValue}>${result.total.toLocaleString()}</Text>
            </View>
          </View>

          {result.notes.length > 0 && (
            <View style={styles.notesBlock}>
              <Text style={styles.sectionTitle}>Notes</Text>
              {result.notes.map((n, i) => (
                <Text key={i} style={styles.noteRow}>• {n}</Text>
              ))}
            </View>
          )}

          <Text style={styles.disclaimer}>
            AI-generated starting point. Review with actual supplier and sub quotes before committing.
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset} activeOpacity={0.8} testID="wizard-reset">
              <RotateCcw size={16} color={Colors.text} />
              <Text style={styles.secondaryText}>New Estimate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={share} activeOpacity={0.85} testID="wizard-share">
              <Share2 size={16} color="#FFF" />
              <Text style={styles.primaryText}>Share</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Quick Estimate' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressLabel}>Step {step + 1} of {TOTAL_STEPS}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 && (
            <StepCard
              icon={<Building2 size={28} color={Colors.primary} />}
              title="What kind of project?"
              subtitle="Pick the closest match — we'll refine in the next steps."
            >
              <View style={styles.chipWrap}>
                {PROJECT_TYPES.map((t) => {
                  const active = answers.projectType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() => set('projectType', t)}
                      style={[styles.chip, active && styles.chipActive]}
                      activeOpacity={0.8}
                      testID={`wizard-type-${t}`}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </StepCard>
          )}

          {step === 1 && (
            <StepCard
              icon={<Home size={28} color={Colors.primary} />}
              title="How big is the project?"
              subtitle="Approximate square footage of the work area."
            >
              <TextInput
                value={answers.sizeSqft}
                onChangeText={(v) => set('sizeSqft', v.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 1500"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                testID="wizard-size"
              />
              <Text style={styles.hint}>Square feet</Text>
            </StepCard>
          )}

          {step === 2 && (
            <StepCard
              icon={<Building2 size={28} color={Colors.primary} />}
              title="Where's the job?"
              subtitle="City and state — we use this for regional pricing."
            >
              <TextInput
                value={answers.location}
                onChangeText={(v) => set('location', v)}
                placeholder="e.g. Austin, TX"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                testID="wizard-location"
              />
            </StepCard>
          )}

          {step === 3 && (
            <StepCard
              icon={<Sparkles size={28} color={Colors.primary} />}
              title="What quality tier?"
              subtitle="Drives material selection and labor assumptions."
            >
              <View style={styles.chipWrap}>
                {(['budget', 'standard', 'high_end'] as const).map((q) => {
                  const active = answers.quality === q;
                  return (
                    <TouchableOpacity
                      key={q}
                      onPress={() => set('quality', q)}
                      style={[styles.chip, active && styles.chipActive]}
                      activeOpacity={0.8}
                      testID={`wizard-quality-${q}`}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{QUALITY_LABELS[q]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </StepCard>
          )}

          {step === 4 && (
            <StepCard
              icon={<Wrench size={28} color={Colors.primary} />}
              title="What's the scope?"
              subtitle="A few sentences on what you're actually building."
            >
              <TextInput
                value={answers.scope}
                onChangeText={(v) => set('scope', v)}
                placeholder="e.g. Gut kitchen, new cabinets and quartz counters, move the sink wall, add island with seating, replace floors."
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                style={styles.textArea}
                testID="wizard-scope"
              />
            </StepCard>
          )}

          {step === 5 && (
            <StepCard
              icon={<Building2 size={28} color={Colors.primary} />}
              title="What's the timeline?"
              subtitle="Expected duration in weeks."
            >
              <TextInput
                value={answers.timelineWeeks}
                onChangeText={(v) => set('timelineWeeks', v.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 8"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                testID="wizard-timeline"
              />
              <Text style={styles.hint}>Weeks</Text>
            </StepCard>
          )}

          {step === 6 && (
            <StepCard
              icon={<Sparkles size={28} color={Colors.primary} />}
              title="Any special requirements?"
              subtitle="Permits, LEED, historical, ADA, unusual access — optional."
            >
              <TextInput
                value={answers.specialRequirements}
                onChangeText={(v) => set('specialRequirements', v)}
                placeholder="e.g. Historic district review, second-floor access, ADA compliant bathroom."
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={styles.textArea}
                testID="wizard-special"
              />
            </StepCard>
          )}

          {step === 7 && (
            <StepCard
              icon={<DollarSign size={28} color={Colors.primary} />}
              title="Target budget?"
              subtitle="Optional. We'll flag if the estimate runs over."
            >
              <TextInput
                value={answers.targetBudget}
                onChangeText={(v) => set('targetBudget', v.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 75000"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                testID="wizard-budget"
              />
              <Text style={styles.hint}>Dollars (optional)</Text>
            </StepCard>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            onPress={step === 0 ? () => router.back() : back}
            style={[styles.secondaryBtn, styles.footerBtn]}
            activeOpacity={0.8}
            testID="wizard-back"
          >
            <ChevronLeft size={18} color={Colors.text} />
            <Text style={styles.secondaryText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
          </TouchableOpacity>
          {step < TOTAL_STEPS - 1 ? (
            <TouchableOpacity
              onPress={next}
              disabled={!canAdvance}
              style={[styles.primaryBtn, styles.footerBtn, !canAdvance && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              testID="wizard-next"
            >
              <Text style={styles.primaryText}>Next</Text>
              <ChevronRight size={18} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={generate}
              disabled={loading}
              style={[styles.primaryBtn, styles.footerBtn, loading && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              testID="wizard-generate"
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Sparkles size={18} color="#FFF" />
                  <Text style={styles.primaryText}>Generate Estimate</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function StepCard({ icon, title, subtitle, children }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={styles.stepIconWrap}>{icon}</View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepSubtitle}>{subtitle}</Text>
      <View style={{ marginTop: 16 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  progressWrap: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
  },
  progressTrack: {
    height: 4, backgroundColor: Colors.cardBorder, borderRadius: 2, overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: Colors.primary },
  progressLabel: {
    fontSize: 12, color: Colors.textMuted, marginTop: 6, textAlign: 'center' as const,
  },
  stepIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 12,
  },
  stepTitle: { fontSize: 24, fontWeight: '700' as const, color: Colors.text, marginBottom: 6 },
  stepSubtitle: { fontSize: 15, color: Colors.textMuted, lineHeight: 21 },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  chipTextActive: { color: '#FFF' },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: Colors.text,
  },
  textArea: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 12, padding: 12, minHeight: 120,
    fontSize: 15, color: Colors.text,
  },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  footer: {
    flexDirection: 'row' as const, gap: 12,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.background,
  },
  footerBtn: { flex: 1 },
  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },
  secondaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  secondaryText: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  // Result view
  resultHero: {
    alignItems: 'center' as const, marginBottom: 24, gap: 4,
  },
  resultHeroTitle: {
    fontSize: 14, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 8,
  },
  resultTotal: {
    fontSize: 44, fontWeight: '800' as const, color: Colors.text, marginTop: 4,
  },
  resultSubtitle: { fontSize: 13, color: Colors.textMuted },
  resultBody: { fontSize: 14, color: Colors.text, lineHeight: 21, marginBottom: 20 },
  sectionTitle: {
    fontSize: 14, fontWeight: '700' as const, color: Colors.text,
    letterSpacing: 0.3, marginTop: 16, marginBottom: 10,
  },
  lineItem: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, gap: 12,
  },
  lineCategory: { fontSize: 11, color: Colors.primary, fontWeight: '700' as const, letterSpacing: 0.5 },
  lineDesc: { fontSize: 14, color: Colors.text, marginTop: 2 },
  lineMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  lineTotal: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  totalsBlock: { marginTop: 16 },
  totalRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    paddingVertical: 6,
  },
  totalLabel: { fontSize: 14, color: Colors.textMuted },
  totalValue: { fontSize: 14, color: Colors.text, fontWeight: '600' as const },
  totalRowGrand: {
    borderTopWidth: 1, borderTopColor: Colors.cardBorder,
    paddingTop: 10, marginTop: 6,
  },
  grandLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  grandValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  notesBlock: { marginTop: 8 },
  noteRow: { fontSize: 13, color: Colors.textMuted, lineHeight: 20, marginBottom: 4 },
  disclaimer: {
    fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' as const,
    textAlign: 'center' as const, marginTop: 16, paddingHorizontal: 12,
  },
  actionRow: {
    flexDirection: 'row' as const, gap: 12, marginTop: 20,
  },
});

```


---

### `app/(tabs)/materials/index.tsx`

```tsx
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Animated, RefreshControl, AppState, Alert, Platform, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, TrendingDown, Search, X, RefreshCw, Clock, Wifi, Bell, Pause, Play, Trash2, MapPin, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { CATEGORY_META, getLivePrices, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import { REGIONS, CITY_ADJUSTMENTS, getRegionForState } from '@/constants/regions';
import type { PricingRegion } from '@/types';

const ALL_CATEGORIES = Object.keys(CATEGORY_META);

interface CategorySummary {
  name: string;
  label: string;
  emoji: string;
  color: string;
  itemCount: number;
  priceRange: { min: number; max: number };
  avgDiscount: number;
}

export default function MaterialsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { priceAlerts, updatePriceAlert, deletePriceAlert } = useProjects();
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState<MaterialItem[]>(() => getLivePrices(Date.now() / 10000));
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<PricingRegion>('mid_atlantic');
  const [selectedCity, setSelectedCity] = useState<string>('New York City');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const appState = useRef(AppState.currentState);

  const regionInfo = useMemo(() => REGIONS.find(r => r.id === selectedRegion), [selectedRegion]);
  const locationMultiplier = useMemo(() => {
    const cityAdj = CITY_ADJUSTMENTS[selectedCity];
    if (cityAdj) return cityAdj;
    return regionInfo?.costIndex ?? 1.0;
  }, [selectedCity, regionInfo]);

  const refreshPrices = useCallback((showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    const seed = Date.now() / 10000;
    const newPrices = getLivePrices(seed);
    setMaterials(newPrices);
    setLastUpdated(new Date());
    if (showRefreshing) setTimeout(() => setRefreshing(false), 600);

    priceAlerts.forEach(alert => {
      if (alert.isPaused || alert.isTriggered) return;
      const mat = newPrices.find(m => m.id === alert.materialId);
      if (!mat) return;
      const triggered = alert.direction === 'below'
        ? mat.baseRetailPrice <= alert.targetPrice
        : mat.baseRetailPrice >= alert.targetPrice;
      if (triggered) {
        updatePriceAlert(alert.id, { isTriggered: true, currentPrice: mat.baseRetailPrice });
        Alert.alert('Price Alert', `${alert.materialName} is now $${mat.baseRetailPrice.toFixed(2)} — ${alert.direction === 'below' ? 'below' : 'above'} your $${alert.targetPrice.toFixed(2)} target.`);
      } else {
        updatePriceAlert(alert.id, { currentPrice: mat.baseRetailPrice });
      }
    });
  }, [priceAlerts, updatePriceAlert]);

  useEffect(() => {
    const interval = setInterval(() => refreshPrices(false), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshPrices]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') refreshPrices(false);
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [refreshPrices]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  const categories: CategorySummary[] = useMemo(() => {
    const grouped: Record<string, MaterialItem[]> = {};
    materials.forEach(m => {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    });

    return ALL_CATEGORIES
      .filter(cat => grouped[cat])
      .map(cat => {
        const items = grouped[cat];
        const meta = CATEGORY_META[cat] ?? { color: Colors.primary, emoji: '📦', label: cat };
        const prices = items.map(i => i.baseBulkPrice);
        const discounts = items.map(i => {
          if (i.baseRetailPrice <= 0) return 0;
          return ((i.baseRetailPrice - i.baseBulkPrice) / i.baseRetailPrice) * 100;
        });
        return {
          name: cat,
          label: meta.label,
          emoji: meta.emoji,
          color: meta.color,
          itemCount: items.length,
          priceRange: { min: Math.min(...prices), max: Math.max(...prices) },
          avgDiscount: Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length),
        };
      });
  }, [materials]);

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase();
    return categories.filter(cat =>
      cat.label.toLowerCase().includes(q) ||
      cat.name.toLowerCase().includes(q)
    );
  }, [categories, searchQuery]);

  const totalCount = categories.reduce((s, c) => s + c.itemCount, 0);
  const triggeredAlerts = priceAlerts.filter(a => a.isTriggered && !a.isPaused);

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const handleCategoryPress = useCallback((categoryName: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(`/(tabs)/materials/${categoryName}`);
  }, [router]);

  const renderCategory = useCallback(({ item }: { item: CategorySummary }) => {
    const alertCount = priceAlerts.filter(a =>
      materials.some(m => m.id === a.materialId && m.category === item.name)
    ).length;

    return (
      <TouchableOpacity
        style={styles.categoryCard}
        onPress={() => handleCategoryPress(item.name)}
        activeOpacity={0.65}
        testID={`cat-${item.name}`}
      >
        <View style={styles.categoryCardInner}>
          <View style={[styles.categoryEmoji, { backgroundColor: item.color + '15' }]}>
            <Text style={styles.emojiText}>{item.emoji}</Text>
          </View>
          <View style={styles.categoryInfo}>
            <View style={styles.categoryTitleRow}>
              <Text style={styles.categoryName}>{item.label}</Text>
              {alertCount > 0 && (
                <View style={styles.categoryAlertDot}>
                  <Bell size={9} color={Colors.accent} />
                </View>
              )}
            </View>
            <Text style={styles.categoryCount}>{item.itemCount} items</Text>
            <View style={styles.categoryStats}>
              <Text style={styles.priceRangeText}>
                ${(item.priceRange.min * locationMultiplier).toFixed(2)} – ${(item.priceRange.max * locationMultiplier).toFixed(2)}
              </Text>
              {item.avgDiscount > 0 && (
                <View style={styles.discountChip}>
                  <Text style={styles.discountChipText}>avg -{item.avgDiscount}%</Text>
                </View>
              )}
            </View>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} strokeWidth={2} />
        </View>
      </TouchableOpacity>
    );
  }, [handleCategoryPress, priceAlerts, materials, locationMultiplier]);

  const keyExtractor = useCallback((item: CategorySummary) => item.name, []);

  const ListHeader = useMemo(() => (
    <View>
      <View style={[styles.headerArea, { paddingTop: insets.top + 4 }]}>
        <View>
          <Text style={styles.largeTitle}>Materials</Text>
          <View style={styles.liveRow}>
            <Animated.View style={[styles.liveDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.liveLabel}>LIVE PRICING</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {priceAlerts.length > 0 && (
            <TouchableOpacity
              style={[styles.refreshBtn, showAlerts && { backgroundColor: Colors.accent + '20' }]}
              onPress={() => setShowAlerts(!showAlerts)}
              activeOpacity={0.7}
            >
              <Bell size={15} color={showAlerts ? Colors.accent : Colors.primary} />
              {triggeredAlerts.length > 0 && (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>{triggeredAlerts.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => refreshPrices(true)}
            activeOpacity={0.7}
            testID="refresh-prices"
          >
            <RefreshCw size={15} color={Colors.primary} />
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={styles.locationBanner}
        onPress={() => setShowLocationPicker(!showLocationPicker)}
        activeOpacity={0.7}
      >
        <MapPin size={14} color={Colors.primary} />
        <Text style={styles.locationText}>
          Pricing for <Text style={styles.locationBold}>{selectedCity}</Text>
          {' '}({regionInfo?.label ?? 'US Average'})
        </Text>
        <View style={styles.locationMultiplier}>
          <Text style={styles.multiplierText}>{locationMultiplier > 1 ? '+' : ''}{((locationMultiplier - 1) * 100).toFixed(0)}%</Text>
        </View>
        <ChevronDown size={14} color={Colors.textSecondary} />
      </TouchableOpacity>

      {showLocationPicker && (
        <View style={styles.locationPicker}>
          <Text style={styles.pickerLabel}>REGION</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {REGIONS.map(region => (
              <TouchableOpacity
                key={region.id}
                style={[styles.pickerChip, selectedRegion === region.id && styles.pickerChipActive]}
                onPress={() => {
                  setSelectedRegion(region.id);
                  setSelectedCity(region.label);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.pickerChipText, selectedRegion === region.id && styles.pickerChipTextActive]}>
                  {region.label}
                </Text>
                <Text style={[styles.pickerChipSub, selectedRegion === region.id && styles.pickerChipTextActive]}>
                  {region.costIndex > 1 ? '+' : ''}{((region.costIndex - 1) * 100).toFixed(0)}%
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={[styles.pickerLabel, { marginTop: 8 }]}>METRO AREA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
            {Object.entries(CITY_ADJUSTMENTS).map(([city, adj]) => (
              <TouchableOpacity
                key={city}
                style={[styles.pickerChip, selectedCity === city && styles.pickerChipActive]}
                onPress={() => {
                  setSelectedCity(city);
                  const stateMap: Record<string, string> = {
                    'New York City': 'NY', 'San Francisco': 'CA', 'Los Angeles': 'CA',
                    'Chicago': 'IL', 'Boston': 'MA', 'Seattle': 'WA', 'Miami': 'FL',
                    'Houston': 'TX', 'Dallas': 'TX', 'Atlanta': 'GA', 'Denver': 'CO',
                    'Phoenix': 'AZ', 'Philadelphia': 'PA', 'Washington DC': 'DC',
                    'Detroit': 'MI', 'Minneapolis': 'MN', 'Portland': 'OR',
                    'Las Vegas': 'NV', 'Nashville': 'TN', 'Charlotte': 'NC',
                  };
                  const st = stateMap[city];
                  if (st) {
                    const r = getRegionForState(st);
                    if (r) setSelectedRegion(r.id);
                  }
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.pickerChipText, selectedCity === city && styles.pickerChipTextActive]}>{city}</Text>
                <Text style={[styles.pickerChipSub, selectedCity === city && styles.pickerChipTextActive]}>
                  {adj > 1 ? '+' : ''}{((adj - 1) * 100).toFixed(0)}%
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.updatedRow}>
        <Clock size={11} color={Colors.textMuted} />
        <Text style={styles.updatedText}>Prices updated {formatTime(lastUpdated)} · {selectedCity} rates · Pull to refresh</Text>
        <Wifi size={11} color={Colors.success} />
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={15} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search categories..."
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            selectionColor={Colors.primary}
            underlineColorAndroid="transparent"
            testID="materials-search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={styles.clearBtn}>
                <X size={10} color="#fff" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showAlerts && priceAlerts.length > 0 && (
        <View style={styles.alertsSection}>
          <Text style={styles.alertsSectionTitle}>PRICE ALERTS ({priceAlerts.length})</Text>
          {priceAlerts.map(alert => {
            const progress = alert.direction === 'below'
              ? Math.max(0, Math.min(1, (alert.currentPrice - alert.targetPrice) / Math.max(alert.currentPrice, 1)))
              : Math.max(0, Math.min(1, (alert.targetPrice - alert.currentPrice) / Math.max(alert.targetPrice, 1)));
            return (
              <View key={alert.id} style={styles.alertCard}>
                <View style={styles.alertCardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertMatName} numberOfLines={1}>{alert.materialName}</Text>
                    <Text style={styles.alertDetail}>
                      {alert.direction === 'below' ? '↓ Below' : '↑ Above'} ${alert.targetPrice.toFixed(2)} · Now ${alert.currentPrice.toFixed(2)}
                    </Text>
                  </View>
                  {alert.isTriggered && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: Colors.successLight }]}>
                      <Text style={[styles.alertStatusText, { color: Colors.success }]}>Triggered</Text>
                    </View>
                  )}
                  {alert.isPaused && (
                    <View style={[styles.alertStatusBadge, { backgroundColor: Colors.warningLight }]}>
                      <Text style={[styles.alertStatusText, { color: Colors.warning }]}>Paused</Text>
                    </View>
                  )}
                </View>
                <View style={styles.alertProgressTrack}>
                  <View style={[styles.alertProgressFill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: alert.isTriggered ? Colors.success : Colors.primary }]} />
                </View>
                <View style={styles.alertActions}>
                  <TouchableOpacity
                    style={styles.alertActionBtn}
                    onPress={() => {
                      updatePriceAlert(alert.id, { isPaused: !alert.isPaused });
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    {alert.isPaused ? <Play size={12} color={Colors.primary} /> : <Pause size={12} color={Colors.warning} />}
                    <Text style={[styles.alertActionText, { color: alert.isPaused ? Colors.primary : Colors.warning }]}>
                      {alert.isPaused ? 'Resume' : 'Pause'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.alertActionBtn}
                    onPress={() => {
                      deletePriceAlert(alert.id);
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                  >
                    <Trash2 size={12} color={Colors.error} />
                    <Text style={[styles.alertActionText, { color: Colors.error }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.savingsBanner}>
        <TrendingDown size={14} color={Colors.success} />
        <Text style={styles.savingsText}>Bulk pricing saves up to 25% — tap a category to browse</Text>
      </View>

      {filteredCategories.length === 0 ? (
        <View style={styles.emptyState}>
          <Search size={40} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No categories found</Text>
          <Text style={styles.emptyDesc}>Try a different search term</Text>
        </View>
      ) : (
        <Text style={styles.sectionHeader}>
          {totalCount} MATERIALS · {filteredCategories.length} CATEGORIES
        </Text>
      )}
    </View>
  ), [insets.top, pulseAnim, searchQuery, lastUpdated, showAlerts, priceAlerts, triggeredAlerts.length, filteredCategories.length, totalCount, refreshPrices, updatePriceAlert, deletePriceAlert, selectedRegion, selectedCity, regionInfo, locationMultiplier, showLocationPicker]);

  return (
    <View style={styles.container}>
      <FlatList
        data={filteredCategories}
        renderItem={renderCategory}
        keyExtractor={keyExtractor}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={
          <View style={{ paddingBottom: insets.bottom + 110 }}>
            <View style={styles.sourceNote}>
              <Text style={styles.sourceText}>
                📊 Prices sourced from major retailers, distributors, and regional wholesalers across the US. Updated in real-time with market variance.
              </Text>
            </View>
          </View>
        }
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => refreshPrices(true)} tintColor={Colors.primary} />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  listContainer: {},
  headerArea: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.success },
  liveLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.success, letterSpacing: 0.8 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.primary + '12', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  refreshBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  alertBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  alertBadgeText: { fontSize: 9, fontWeight: '700' as const, color: '#fff' },
  updatedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, marginBottom: 12 },
  updatedText: { flex: 1, fontSize: 11, color: Colors.textMuted },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 40 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  clearBtn: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  alertsSection: { marginHorizontal: 16, marginBottom: 16, gap: 8 },
  alertsSectionTitle: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 4 },
  alertCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 8 },
  alertCardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertMatName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  alertDetail: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  alertStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  alertStatusText: { fontSize: 10, fontWeight: '700' as const },
  alertProgressTrack: { height: 4, backgroundColor: Colors.fillTertiary, borderRadius: 2, overflow: 'hidden' as const },
  alertProgressFill: { height: 4, borderRadius: 2 },
  alertActions: { flexDirection: 'row', gap: 12 },
  alertActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  alertActionText: { fontSize: 12, fontWeight: '600' as const },
  savingsBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: Colors.success + '12', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 8, marginBottom: 20 },
  savingsText: { flex: 1, fontSize: 13, color: Colors.success, fontWeight: '500' as const, lineHeight: 17 },
  sectionHeader: { fontSize: 11, fontWeight: '600' as const, color: Colors.textSecondary, letterSpacing: 0.5, paddingHorizontal: 20, marginBottom: 8 },
  categoryCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  categoryCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  categoryEmoji: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 20 },
  categoryInfo: { flex: 1, gap: 2 },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  categoryName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  categoryAlertDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.accent + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryCount: { fontSize: 12, color: Colors.textMuted },
  categoryStats: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  priceRangeText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  discountChip: {
    backgroundColor: Colors.success + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountChipText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted },
  sourceNote: { marginHorizontal: 16, marginTop: 16, padding: 12, backgroundColor: Colors.fillTertiary, borderRadius: 10 },
  sourceText: { fontSize: 11, color: Colors.textMuted, lineHeight: 16 },
  locationBanner: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.primary + '08', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderWidth: 1, borderColor: Colors.primary + '20' },
  locationText: { flex: 1, fontSize: 13, color: Colors.text },
  locationBold: { fontWeight: '700' as const, color: Colors.primary },
  locationMultiplier: { backgroundColor: Colors.primary + '18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  multiplierText: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  locationPicker: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  pickerLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  pickerScroll: { flexDirection: 'row', marginBottom: 4 },
  pickerChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.background, marginRight: 6, alignItems: 'center' },
  pickerChipActive: { backgroundColor: Colors.primary },
  pickerChipText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  pickerChipSub: { fontSize: 10, color: Colors.textMuted, marginTop: 1 },
  pickerChipTextActive: { color: '#FFF' },
});

```


---

### `app/(tabs)/materials/[category].tsx`

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  Modal, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Tag, Truck, Search, X, Bell } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { CATEGORY_META, getLivePrices, type MaterialItem } from '@/constants/materials';
import { useProjects } from '@/contexts/ProjectContext';
import type { PriceAlert, AlertDirection } from '@/types';

const PAGE_SIZE = 30;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function CategoryDetailScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { priceAlerts, addPriceAlert } = useProjects();

  const [searchQuery, setSearchQuery] = useState('');
  const [alertModal, setAlertModal] = useState<MaterialItem | null>(null);
  const [alertPrice, setAlertPrice] = useState('');
  const [alertDirection, setAlertDirection] = useState<AlertDirection>('below');

  const allMaterials = useMemo(() => {
    const prices = getLivePrices(Date.now() / 10000);
    return prices.filter(m => m.category === category);
  }, [category]);

  const filteredMaterials = useMemo(() => {
    if (!searchQuery.trim()) return allMaterials;
    const q = searchQuery.toLowerCase();
    return allMaterials.filter(item =>
      item.name.toLowerCase().includes(q) ||
      item.supplier.toLowerCase().includes(q) ||
      (item.sku && item.sku.toLowerCase().includes(q))
    );
  }, [allMaterials, searchQuery]);

  const meta = CATEGORY_META[category ?? ''] ?? { color: Colors.primary, emoji: '📦', label: category ?? 'Materials' };

  const calcDiscount = (retail: number, bulk: number) => {
    if (retail <= 0) return 0;
    return Math.round(((retail - bulk) / retail) * 100);
  };

  const handleCreateAlert = useCallback(() => {
    if (!alertModal) return;
    const price = parseFloat(alertPrice);
    if (isNaN(price) || price <= 0) {
      Alert.alert('Invalid Price', 'Please enter a valid target price.');
      return;
    }
    const alert: PriceAlert = {
      id: createId('alert'),
      materialId: alertModal.id,
      materialName: alertModal.name,
      targetPrice: price,
      direction: alertDirection,
      currentPrice: alertModal.baseRetailPrice,
      isTriggered: false,
      isPaused: false,
      createdAt: new Date().toISOString(),
    };
    addPriceAlert(alert);
    setAlertModal(null);
    setAlertPrice('');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Alert Set', `You'll be notified when ${alertModal.name} goes ${alertDirection} $${price.toFixed(2)}.`);
  }, [alertModal, alertPrice, alertDirection, addPriceAlert]);

  const renderItem = useCallback(({ item }: { item: MaterialItem }) => {
    const discount = calcDiscount(item.baseRetailPrice, item.baseBulkPrice);
    const hasAlert = priceAlerts.some(a => a.materialId === item.id);

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemTop}>
          <View style={styles.itemLeft}>
            <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
            <View style={styles.itemMeta}>
              <Truck size={10} color={Colors.textMuted} />
              <Text style={styles.itemSupplier} numberOfLines={1}>{item.supplier}</Text>
              <Text style={styles.itemDot}>·</Text>
              <Text style={styles.itemUnit}>per {item.unit}</Text>
            </View>
            {item.sku && (
              <View style={styles.skuRow}>
                <Tag size={9} color={Colors.textMuted} />
                <Text style={styles.skuText}>SKU {item.sku}</Text>
              </View>
            )}
            {item.region && item.region !== 'National Avg' && (
              <View style={styles.regionBadge}>
                <Text style={styles.regionText}>{item.region}</Text>
              </View>
            )}
          </View>
          <View style={styles.itemRight}>
            <Text style={styles.retailPrice}>${item.baseRetailPrice.toFixed(2)}</Text>
            <View style={styles.bulkRow}>
              <Text style={styles.bulkPrice}>${item.baseBulkPrice.toFixed(2)}</Text>
              {discount > 0 && (
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>-{discount}%</Text>
                </View>
              )}
            </View>
            <Text style={styles.bulkMinLabel}>min {item.bulkMinQty} bulk</Text>
          </View>
        </View>
        <View style={styles.itemActions}>
          <TouchableOpacity
            style={[styles.alertBtn, hasAlert && styles.alertBtnActive]}
            onPress={() => {
              setAlertModal(item);
              setAlertPrice('');
              setAlertDirection('below');
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
            }}
            activeOpacity={0.7}
          >
            <Bell size={13} color={hasAlert ? Colors.accent : Colors.textMuted} />
            <Text style={[styles.alertBtnText, hasAlert && { color: Colors.accent }]}>
              {hasAlert ? 'Alert Set' : 'Set Alert'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [priceAlerts]);

  const keyExtractor = useCallback((item: MaterialItem) => item.id, []);

  const categoryAlerts = useMemo(() => {
    return priceAlerts.filter(a => {
      return allMaterials.some(m => m.id === a.materialId);
    });
  }, [priceAlerts, allMaterials]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          testID="back-btn"
        >
          <ArrowLeft size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={[styles.headerEmoji, { backgroundColor: meta.color + '15' }]}>
          <Text style={styles.headerEmojiText}>{meta.emoji}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{meta.label}</Text>
          <Text style={styles.headerCount}>{filteredMaterials.length} of {allMaterials.length} items</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Search size={15} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={`Search ${meta.label.toLowerCase()}...`}
            placeholderTextColor={Colors.textMuted}
            autoCorrect={false}
            selectionColor={Colors.primary}
            underlineColorAndroid="transparent"
            testID="category-search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={styles.clearBtn}>
                <X size={10} color="#fff" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {categoryAlerts.length > 0 && (
        <View style={styles.alertsBar}>
          <Bell size={12} color={Colors.accent} />
          <Text style={styles.alertsBarText}>{categoryAlerts.length} active alert{categoryAlerts.length > 1 ? 's' : ''} in this category</Text>
        </View>
      )}

      <FlatList
        data={filteredMaterials}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={PAGE_SIZE}
        maxToRenderPerBatch={15}
        windowSize={5}
        removeClippedSubviews={true}
        updateCellsBatchingPeriod={50}
        getItemLayout={undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Search size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No results</Text>
            <Text style={styles.emptyDesc}>Try a different search term</Text>
          </View>
        }
      />

      <Modal
        visible={alertModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Set Price Alert</Text>
              <TouchableOpacity onPress={() => setAlertModal(null)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            {alertModal && (
              <>
                <Text style={styles.modalMatName}>{alertModal.name}</Text>
                <Text style={styles.modalCurrentPrice}>Current: ${alertModal.baseRetailPrice.toFixed(2)} / {alertModal.unit}</Text>

                <Text style={styles.modalFieldLabel}>Alert Direction</Text>
                <View style={styles.directionRow}>
                  <TouchableOpacity
                    style={[styles.directionBtn, alertDirection === 'below' && styles.directionBtnActive]}
                    onPress={() => setAlertDirection('below')}
                  >
                    <Text style={[styles.directionBtnText, alertDirection === 'below' && styles.directionBtnTextActive]}>Price drops below</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.directionBtn, alertDirection === 'above' && styles.directionBtnActive]}
                    onPress={() => setAlertDirection('above')}
                  >
                    <Text style={[styles.directionBtnText, alertDirection === 'above' && styles.directionBtnTextActive]}>Price rises above</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalFieldLabel}>Target Price ($)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={alertPrice}
                  onChangeText={setAlertPrice}
                  placeholder={alertDirection === 'below' ? (alertModal.baseRetailPrice * 0.9).toFixed(2) : (alertModal.baseRetailPrice * 1.1).toFixed(2)}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="decimal-pad"
                  testID="alert-price-input"
                />

                <TouchableOpacity style={styles.modalSaveBtn} onPress={handleCreateAlert} activeOpacity={0.85}>
                  <Bell size={16} color="#fff" />
                  <Text style={styles.modalSaveBtnText}>Set Alert</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmoji: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEmojiText: { fontSize: 20 },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  headerCount: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.surface },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  clearBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.accent + '12',
    borderRadius: 8,
  },
  alertsBarText: { fontSize: 12, fontWeight: '500' as const, color: Colors.accent },
  listContent: { paddingTop: 8, paddingHorizontal: 16, gap: 8 },
  itemCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  itemTop: { flexDirection: 'row', gap: 12 },
  itemLeft: { flex: 1, gap: 4 },
  itemName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, lineHeight: 19 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemSupplier: { fontSize: 11, color: Colors.textMuted, flex: 1 },
  itemDot: { fontSize: 11, color: Colors.textMuted },
  itemUnit: { fontSize: 11, color: Colors.textMuted },
  skuRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  skuText: { fontSize: 10, color: Colors.textMuted },
  regionBadge: {
    alignSelf: 'flex-start' as const,
    backgroundColor: Colors.info + '12',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 2,
  },
  regionText: { fontSize: 10, fontWeight: '600' as const, color: Colors.info },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 80 },
  retailPrice: { fontSize: 12, color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  bulkPrice: { fontSize: 17, fontWeight: '700' as const, color: Colors.success, letterSpacing: -0.3 },
  saveBadge: { backgroundColor: Colors.success + '18', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  saveBadgeText: { fontSize: 10, fontWeight: '700' as const, color: Colors.success },
  bulkMinLabel: { fontSize: 10, color: Colors.textMuted },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  alertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  alertBtnActive: { backgroundColor: Colors.accent + '15' },
  alertBtnText: { fontSize: 12, fontWeight: '500' as const, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: Colors.surface, borderRadius: 24, padding: 22, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  modalMatName: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  modalCurrentPrice: { fontSize: 14, color: Colors.textSecondary },
  modalFieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  directionRow: { flexDirection: 'row', gap: 8 },
  directionBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.fillTertiary, alignItems: 'center' },
  directionBtnActive: { backgroundColor: Colors.primary },
  directionBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  directionBtnTextActive: { color: '#fff' },
  modalInput: { height: 48, borderRadius: 14, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: 16, color: Colors.text },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14 },
  modalSaveBtnText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
});

```


---

### `utils/estimator.ts`

```ts
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { ProjectType, QualityTier, EstimateBreakdown } from '@/types';

const materialLineItemSchema = z.object({
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  bulkPrice: z.number(),
  bulkThreshold: z.number(),
  totalPrice: z.number(),
  savings: z.number(),
});

const laborLineItemSchema = z.object({
  role: z.string(),
  hourlyRate: z.number(),
  hours: z.number(),
  totalCost: z.number(),
});

const estimateSchema = z.object({
  materials: z.array(materialLineItemSchema),
  labor: z.array(laborLineItemSchema),
  permits: z.number(),
  overhead: z.number(),
  contingency: z.number(),
  materialTotal: z.number(),
  laborTotal: z.number(),
  bulkSavingsTotal: z.number(),
  subtotal: z.number(),
  tax: z.number(),
  grandTotal: z.number(),
  pricePerSqFt: z.number(),
  estimatedDuration: z.string(),
  notes: z.array(z.string()),
});

export async function generateEstimate(params: {
  projectType: ProjectType;
  location: string;
  squareFootage: number;
  quality: QualityTier;
  description: string;
  taxRate: number;
  contingencyRate: number;
}): Promise<EstimateBreakdown> {
  console.log('[Estimator] Generating estimate with params:', params);

  const prompt = `You are a professional construction cost estimator with access to current 2024-2025 market pricing data. Generate a detailed, realistic construction cost estimate.

Project Details:
- Type: ${params.projectType.replace('_', ' ')}
- Location: ${params.location || 'United States average'}
- Square Footage: ${params.squareFootage} sq ft
- Quality Tier: ${params.quality}
- Description: ${params.description || 'Standard project'}
- Tax Rate: ${params.taxRate}%
- Contingency Rate: ${params.contingencyRate}%

Requirements:
1. Use REAL current market prices for ${params.location || 'US average'}. Research current Home Depot, Lowe's, and wholesale supplier pricing.
2. Include bulk buy discounts - if quantity exceeds bulk threshold, use the lower bulk price. Bulk prices should be 10-25% less than retail.
3. Include at least 8-15 material line items with realistic quantities for this project size.
4. Include 3-6 labor roles with realistic hourly rates for the area.
5. Calculate permits based on local requirements.
6. Add overhead (typically 10-15% of subtotal).
7. Calculate contingency at ${params.contingencyRate}%.
8. Apply tax at ${params.taxRate}% on materials only.
9. Ensure all math is correct - totalPrice should be quantity * (bulkPrice if quantity >= bulkThreshold, else unitPrice).
10. savings = (unitPrice - bulkPrice) * quantity if bulk applies, else 0.
11. Provide practical notes about the estimate including potential cost-saving tips and important considerations.
12. estimatedDuration should be a human-readable string like "4-6 weeks".
13. pricePerSqFt = grandTotal / squareFootage.

Be thorough, realistic, and use current market data. This needs to be a professional-grade estimate.`;

  try {
    const aiResult = await mageAI({
      prompt,
      schema: estimateSchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.error('[Estimator] AI failed:', aiResult.error);
      throw new Error(aiResult.error || 'Failed to generate estimate. Please try again.');
    }

    console.log('[Estimator] Estimate generated successfully');
    return aiResult.data as EstimateBreakdown;
  } catch (error) {
    console.error('[Estimator] Error generating estimate:', error);
    throw new Error('Failed to generate estimate. Please try again.');
  }
}

const materialCategorySchema = z.object({
  categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    items: z.array(z.object({
      name: z.string(),
      unit: z.string(),
      retailPrice: z.number(),
      bulkPrice: z.number(),
      bulkMinQty: z.number(),
      supplier: z.string(),
      lastUpdated: z.string(),
    })),
  })),
});

export async function fetchMaterialPrices(location: string, category?: string): Promise<{
  categories: Array<{
    id: string;
    name: string;
    items: Array<{
      name: string;
      unit: string;
      retailPrice: number;
      bulkPrice: number;
      bulkMinQty: number;
      supplier: string;
      lastUpdated: string;
    }>;
  }>;
}> {
  console.log('[Estimator] Fetching material prices for:', location, category);

  const prompt = `You are a construction materials pricing database with access to current 2024-2025 wholesale and retail prices. 
  
Generate current material prices for the ${location || 'United States'} market.
${category ? `Focus on the "${category}" category.` : 'Include all major categories.'}

For each category, provide 4-6 common materials with:
- Current retail prices (Home Depot/Lowe's level)
- Bulk/wholesale prices (contractor supply pricing)
- Minimum quantity for bulk pricing
- Primary supplier name
- Last updated date (use recent dates in 2025)

Categories to include: ${category || 'Lumber & Framing, Concrete & Masonry, Roofing, Flooring, Plumbing, Electrical, Paint & Finishes, Hardware & Fasteners'}

Use realistic, current market prices. Lumber prices should reflect current market conditions.`;

  try {
    const aiResult = await mageAI({
      prompt,
      schema: materialCategorySchema,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.error('[Estimator] AI failed:', aiResult.error);
      throw new Error(aiResult.error || 'Failed to fetch material prices.');
    }

    console.log('[Estimator] Material prices fetched');
    return aiResult.data as { categories: Array<{ id: string; name: string; items: Array<{ name: string; unit: string; retailPrice: number; bulkPrice: number; bulkMinQty: number; supplier: string; lastUpdated: string; }> }> };
  } catch (error) {
    console.error('[Estimator] Error fetching materials:', error);
    throw new Error('Failed to fetch material prices.');
  }
}

```


---

### `utils/materialDatabase.ts`

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AIMaterialResult } from './materialFinder';

const CUSTOM_MATERIALS_KEY = 'mage_custom_materials';
const RECENT_MATERIALS_KEY = 'mage_recent_materials';

export interface SavedMaterial {
  id: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: number;
  category: string;
  brand?: string;
  size?: string;
  specifications?: string;
  commonUses: string[];
  alternateNames: string[];
  priceSource: string;
  priceDate: string;
  laborHoursPerUnit?: number;
  laborCrew?: string;
  laborCrewSize?: number;
  isCustom: boolean;
  searchCount: number;
}

export interface RecentMaterial {
  id: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  timestamp: string;
  source: 'builtin' | 'ai' | 'custom';
}

export async function saveToLocalDatabase(material: SavedMaterial): Promise<boolean> {
  try {
    const existing = await getCustomMaterials();
    const isDuplicate = existing.some(
      m => m.name.toLowerCase().trim() === material.name.toLowerCase().trim(),
    );
    if (!isDuplicate) {
      existing.push({ ...material, id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, searchCount: 1 });
      await AsyncStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(existing));
      console.log('[MaterialDB] Saved new material:', material.name);
    } else {
      const idx = existing.findIndex(m => m.name.toLowerCase().trim() === material.name.toLowerCase().trim());
      if (idx >= 0) {
        existing[idx].searchCount += 1;
        existing[idx].unitPrice = material.unitPrice;
        existing[idx].priceDate = material.priceDate;
        await AsyncStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(existing));
      }
      console.log('[MaterialDB] Material already exists, updated count:', material.name);
    }
    return !isDuplicate;
  } catch (err) {
    console.error('[MaterialDB] Save error:', err);
    return false;
  }
}

export async function getCustomMaterials(): Promise<SavedMaterial[]> {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_MATERIALS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('[MaterialDB] Get custom materials error:', err);
    return [];
  }
}

export async function searchCustomMaterials(query: string): Promise<SavedMaterial[]> {
  const materials = await getCustomMaterials();
  const q = query.toLowerCase();
  return materials.filter(
    m =>
      m.name.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.alternateNames?.some(alt => alt.toLowerCase().includes(q)) ||
      m.category?.toLowerCase().includes(q),
  );
}

export async function getPopularCustomMaterials(limit: number = 20): Promise<SavedMaterial[]> {
  const materials = await getCustomMaterials();
  return materials
    .sort((a, b) => b.searchCount - a.searchCount)
    .slice(0, limit);
}

export function aiResultToSavedMaterial(result: AIMaterialResult): SavedMaterial {
  return {
    id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: result.name,
    description: result.description,
    unit: result.unit,
    unitPrice: result.unitPrice,
    category: result.category.toLowerCase(),
    brand: result.brand,
    size: result.size,
    specifications: result.specifications,
    commonUses: result.commonUses,
    alternateNames: result.alternateNames,
    priceSource: result.priceSource,
    priceDate: new Date().toISOString(),
    laborHoursPerUnit: result.laborToInstall?.hoursPerUnit,
    laborCrew: result.laborToInstall?.crew,
    laborCrewSize: result.laborToInstall?.crewSize,
    isCustom: false,
    searchCount: 1,
  };
}

export async function addRecentMaterial(material: RecentMaterial): Promise<void> {
  try {
    const recents = await getRecentMaterials();
    const filtered = recents.filter(m => m.id !== material.id);
    filtered.unshift({ ...material, timestamp: new Date().toISOString() });
    const trimmed = filtered.slice(0, 20);
    await AsyncStorage.setItem(RECENT_MATERIALS_KEY, JSON.stringify(trimmed));
    console.log('[MaterialDB] Added recent material:', material.name);
  } catch (err) {
    console.error('[MaterialDB] Add recent error:', err);
  }
}

export async function getRecentMaterials(): Promise<RecentMaterial[]> {
  try {
    const data = await AsyncStorage.getItem(RECENT_MATERIALS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error('[MaterialDB] Get recents error:', err);
    return [];
  }
}

export async function getCustomMaterialCount(): Promise<number> {
  const materials = await getCustomMaterials();
  return materials.length;
}

export async function deleteCustomMaterial(id: string): Promise<void> {
  try {
    const materials = await getCustomMaterials();
    const filtered = materials.filter(m => m.id !== id);
    await AsyncStorage.setItem(CUSTOM_MATERIALS_KEY, JSON.stringify(filtered));
    console.log('[MaterialDB] Deleted material:', id);
  } catch (err) {
    console.error('[MaterialDB] Delete error:', err);
  }
}

```


---

### `utils/materialFinder.ts`

```ts
import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';

const materialSearchSchema = z.object({
  materials: z.array(z.object({
    name: z.string(),
    description: z.string(),
    unit: z.string(),
    unitPrice: z.number(),
    category: z.string(),
    brand: z.string().optional(),
    size: z.string().optional(),
    specifications: z.string().optional(),
    commonUses: z.array(z.string()),
    alternateNames: z.array(z.string()),
    relatedItems: z.array(z.string()),
    priceSource: z.string(),
    priceConfidence: z.enum(['high', 'medium', 'low']),
    laborToInstall: z.object({
      hoursPerUnit: z.number(),
      crew: z.string(),
      crewSize: z.number(),
    }).optional(),
  })),
  searchTips: z.string().optional(),
});

export type AIMaterialResult = z.infer<typeof materialSearchSchema>['materials'][number];
export type AIMaterialSearchResponse = z.infer<typeof materialSearchSchema>;

export async function findMaterials(
  searchQuery: string,
  category?: string,
  zipCode?: string,
): Promise<AIMaterialSearchResponse> {
  console.log('[MaterialFinder] Searching for:', searchQuery, 'category:', category, 'zip:', zipCode);

  const aiResult = await mageAI({
    prompt: `You are a construction materials pricing expert with access to current US construction supply pricing. Find materials matching this search query and provide accurate current pricing.

SEARCH: "${searchQuery}"
${category ? `CATEGORY: ${category}` : ''}
${zipCode ? `LOCATION: ${zipCode} (adjust pricing for regional cost differences)` : ''}

Return 3-8 matching materials with:
1. Accurate current retail pricing (use 2025-2026 US pricing from major suppliers like Home Depot, Lowe's, or specialty distributors)
2. The correct unit of measure for how this material is typically purchased
3. Common construction uses
4. Alternate names contractors might search for
5. Related items they might also need
6. If applicable, estimated labor hours to install per unit

Be SPECIFIC with product names (e.g., "2" Schedule 40 PVC 90° Elbow" not just "PVC fitting"). Include brand names where relevant. Prices should be realistic retail pricing — not wholesale, not inflated.

If the search is vague, return the most common variants. For example, if someone searches "copper pipe", return 1/2", 3/4", and 1" in Type M and Type L.`,
    schema: materialSearchSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Material search unavailable');
  }

  const result = aiResult.data;
  console.log('[MaterialFinder] Found', result.materials.length, 'materials');
  return result;
}

const priceComparisonSchema = z.object({
  homeDepotPrice: z.number().optional(),
  lowesPrice: z.number().optional(),
  industryAverage: z.number(),
  rsmeansPrice: z.number().optional(),
  rsmeansYear: z.string().optional(),
  priceTrend: z.enum(['rising', 'falling', 'stable']),
  trendPercentage: z.number(),
  bulkPricing: z.array(z.object({
    minQuantity: z.number(),
    pricePerUnit: z.number(),
    savings: z.string(),
  })).optional(),
  purchasedTogether: z.array(z.string()),
  priceNote: z.string().optional(),
});

export type PriceComparisonResult = z.infer<typeof priceComparisonSchema>;

export async function getPriceComparison(
  materialName: string,
  currentPrice: number,
  unit: string,
): Promise<PriceComparisonResult> {
  console.log('[MaterialFinder] Getting price comparison for:', materialName);

  const aiResult = await mageAI({
    prompt: `You are a construction materials pricing expert. Provide price comparison data for this material.

MATERIAL: "${materialName}"
CURRENT PRICE: $${currentPrice}/${unit}

Provide:
1. Estimated Home Depot price
2. Estimated Lowe's price
3. Industry average price
4. RSMeans reference price (if applicable, with year)
5. Price trend (rising/falling/stable) with percentage change over last 6 months
6. Bulk pricing tiers if applicable
7. Related items commonly purchased together (3-5 items)
8. Any price notes (e.g., "Lumber prices volatile due to tariffs")

Use realistic 2025-2026 US pricing.`,
    schema: priceComparisonSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] Price comparison AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Price comparison unavailable');
  }

  const result = aiResult.data;
  console.log('[MaterialFinder] Price comparison complete');
  return result;
}

const phaseSuggestionsSchema = z.object({
  phase: z.string(),
  suggestedMaterials: z.array(z.object({
    name: z.string(),
    unit: z.string(),
    unitPrice: z.number(),
    suggestedQuantity: z.number(),
    reason: z.string(),
  })),
  estimatedPhaseCost: z.number(),
  tips: z.array(z.string()),
});

export type PhaseSuggestionsResult = z.infer<typeof phaseSuggestionsSchema>;

export async function suggestMaterialsForPhase(
  phase: string,
  projectType: string,
  squareFootage: number,
): Promise<PhaseSuggestionsResult> {
  console.log('[MaterialFinder] Suggesting materials for phase:', phase, 'type:', projectType, 'sqft:', squareFootage);

  const aiResult = await mageAI({
    prompt: `You are a construction estimating expert. Suggest the essential materials needed for the "${phase}" phase of a ${projectType} project that is ${squareFootage} SF. 

Include:
1. Every material commonly needed for this phase
2. Realistic quantities based on the square footage
3. Current 2025-2026 pricing
4. Why each material is needed

Order by importance (most essential first). Include both structural materials and fasteners/connectors/adhesives that are often forgotten. Return 8-15 materials.`,
    schema: phaseSuggestionsSchema,
    tier: 'fast',
  });

  if (!aiResult.success) {
    console.log('[MaterialFinder] Phase suggestions AI failed:', aiResult.error);
    throw new Error(aiResult.error || 'Phase suggestions unavailable');
  }

  const result = aiResult.data;
  console.log('[MaterialFinder] Phase suggestions complete:', result.suggestedMaterials.length, 'items');
  return result;
}

```


---

### `components/AIQuickEstimate.tsx`

```tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ScrollView, ActivityIndicator, Animated, Platform, Alert, KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, X, ChevronRight, Wand2, AlertTriangle, Lightbulb,
  TrendingDown, Clock, MapPin, Ruler, Package, HardHat, Boxes,
  CheckCircle, DollarSign, Shield, ChevronDown, ChevronUp, Zap,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PROJECT_TYPES, type ProjectType, type QualityTier } from '@/types';
import { generateQuickEstimate, type AIQuickEstimateResult } from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { MaterialItem } from '@/constants/materials';
import { LABOR_RATES, type LaborRate } from '@/constants/laborRates';
import { ASSEMBLIES, type AssemblyItem } from '@/constants/assemblies';

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

interface Props {
  visible: boolean;
  onClose: () => void;
  onApplyEstimate: (
    materials: CartItem[],
    labor: LaborCartItem[],
    assemblies: AssemblyCartItem[],
  ) => void;
  existingMaterials: MaterialItem[];
  globalMarkup: number;
  location: string;
  calculateAssemblyCost: (assembly: AssemblyItem, qty: number) => { materialsCost: number; laborCost: number; totalCost: number };
}

const QUALITY_TIERS: { id: QualityTier; label: string; desc: string }[] = [
  { id: 'economy', label: 'Economy', desc: 'Budget-friendly materials' },
  { id: 'standard', label: 'Standard', desc: 'Mid-range, reliable' },
  { id: 'premium', label: 'Premium', desc: 'High-end finishes' },
  { id: 'luxury', label: 'Luxury', desc: 'Top-tier everything' },
];

const QUICK_PROMPTS = [
  { label: 'Kitchen Remodel', prompt: 'Complete kitchen remodel with new cabinets, countertops, flooring, lighting, backsplash, and appliance prep', sqft: 150, type: 'remodel' as ProjectType },
  { label: 'Bathroom Remodel', prompt: 'Full bathroom remodel including new tile, vanity, toilet, shower/tub, plumbing fixtures, and lighting', sqft: 60, type: 'remodel' as ProjectType },
  { label: 'Basement Finish', prompt: 'Finish unfinished basement with framing, insulation, drywall, flooring, electrical, bathroom, and paint', sqft: 800, type: 'renovation' as ProjectType },
  { label: 'Deck Build', prompt: 'Build a new composite deck with railing, stairs, and post footings', sqft: 300, type: 'addition' as ProjectType },
  { label: 'Roof Replacement', prompt: 'Full roof tear-off and replacement with architectural shingles, underlayment, flashing, and ridge vents', sqft: 2000, type: 'roofing' as ProjectType },
  { label: 'Room Addition', prompt: 'Single room addition including foundation, framing, roofing, insulation, drywall, electrical, HVAC, and finishes', sqft: 200, type: 'addition' as ProjectType },
  { label: 'Whole House Paint', prompt: 'Interior paint for entire home — walls, ceilings, trim, 2 coats with primer', sqft: 2000, type: 'painting' as ProjectType },
  { label: 'Fence Install', prompt: 'Install 6ft wood privacy fence around backyard with one gate, posts, and staining', sqft: 0, type: 'landscape' as ProjectType },
];

export default React.memo(function AIQuickEstimate({
  visible, onClose, onApplyEstimate, existingMaterials, globalMarkup, location, calculateAssemblyCost,
}: Props) {
  const [step, setStep] = useState<'input' | 'loading' | 'result'>('input');
  const [description, setDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  const [sqft, setSqft] = useState('');
  const [quality, setQuality] = useState<QualityTier>('standard');
  const [result, setResult] = useState<AIQuickEstimateResult | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>('materials');
  const [error, setError] = useState<string | null>(null);

  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (step === 'loading') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
      Animated.timing(progressAnim, { toValue: 1, duration: 25000, useNativeDriver: false }).start();
    } else {
      pulseAnim.setValue(0.4);
      progressAnim.setValue(0);
    }
  }, [step, pulseAnim, progressAnim]);

  useEffect(() => {
    if (step === 'result') {
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [step, fadeAnim]);

  const handleReset = useCallback(() => {
    setStep('input');
    setResult(null);
    setError(null);
    setExpandedSection('materials');
    setDescription('');
    setSqft('');
    setProjectType('renovation');
    setQuality('standard');
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const handleQuickPrompt = useCallback((prompt: typeof QUICK_PROMPTS[0]) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDescription(prompt.prompt);
    setSqft(prompt.sqft > 0 ? String(prompt.sqft) : '');
    setProjectType(prompt.type);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) {
      Alert.alert('Describe Your Project', 'Tell us what you\'re building so AI can generate an accurate estimate.');
      return;
    }

    const limit = await checkAILimit('free', 'smart');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Rate limit reached.');
      return;
    }

    setStep('loading');
    setError(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const data = await generateQuickEstimate(
        description,
        projectType,
        parseInt(sqft, 10) || 0,
        quality,
        location,
      );
      await recordAIUsage('smart');
      setResult(data);
      setStep('result');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[AI Quick Estimate] Success:', data.materials.length, 'materials');
    } catch (err) {
      console.error('[AI Quick Estimate] Error:', err);
      setError('Failed to generate estimate. Please try again.');
      setStep('input');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [description, projectType, sqft, quality, location]);

  const matchMaterial = useCallback((aiMat: { name: string; category: string; unit: string; unitPrice: number; supplier: string }) => {
    const nameLower = aiMat.name.toLowerCase();
    const catLower = aiMat.category.toLowerCase().replace(/[^a-z]/g, '');

    const exact = existingMaterials.find(m =>
      m.name.toLowerCase().includes(nameLower.split(' ').slice(0, 3).join(' ')) ||
      nameLower.includes(m.name.toLowerCase().split(' ').slice(0, 3).join(' '))
    );
    if (exact) return exact;

    const catMatch = existingMaterials.find(m =>
      m.category === catLower && m.name.toLowerCase().includes(nameLower.split(' ')[0])
    );
    if (catMatch) return catMatch;

    return null;
  }, [existingMaterials]);

  const handleApply = useCallback(() => {
    if (!result) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const materialItems: CartItem[] = result.materials.map(aiMat => {
      const matched = matchMaterial(aiMat);
      const material: MaterialItem = matched ?? {
        id: `aiqe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: aiMat.name,
        category: aiMat.category.toLowerCase().replace(/[^a-z]/g, '') || 'hardware',
        unit: aiMat.unit,
        baseRetailPrice: aiMat.unitPrice,
        baseBulkPrice: aiMat.unitPrice * 0.85,
        bulkMinQty: 10,
        supplier: aiMat.supplier || 'AI Estimated',
        pricingModel: 'market',
        sourceLabel: matched ? 'Matched' : 'AI Generated',
      };

      return {
        material,
        quantity: Math.max(1, Math.round(aiMat.quantity)),
        markup: globalMarkup,
        usesBulk: aiMat.quantity >= material.bulkMinQty,
      };
    });

    const laborItems: LaborCartItem[] = result.labor.map(aiLab => {
      const matched = LABOR_RATES.find(r =>
        r.trade.toLowerCase().includes(aiLab.trade.toLowerCase().split(' ')[0]) ||
        aiLab.trade.toLowerCase().includes(r.trade.toLowerCase().split(' ')[0])
      );

      return {
        labor: matched ?? {
          id: `aiqe-lab-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          trade: aiLab.trade,
          category: 'general',
          hourlyRate: aiLab.hourlyRate,
          rateRange: { low: aiLab.hourlyRate * 0.8, high: aiLab.hourlyRate * 1.3 },
          unit: 'per hour',
          dailyOutput: 'AI estimated',
          crew: aiLab.crew || '1 Worker',
          wageType: 'open_shop' as const,
        },
        hours: Math.max(1, Math.round(aiLab.hours)),
        adjustedRate: matched?.hourlyRate ?? aiLab.hourlyRate,
      };
    });

    const assemblyItems: AssemblyCartItem[] = result.assemblies
      .map(aiAsm => {
        const matched = ASSEMBLIES.find(a =>
          a.name.toLowerCase().includes(aiAsm.name.toLowerCase().split('(')[0].trim().split(' ').slice(0, 3).join(' ')) ||
          aiAsm.name.toLowerCase().includes(a.name.toLowerCase().split('(')[0].trim().split(' ').slice(0, 3).join(' '))
        );
        if (!matched) return null;
        const costs = calculateAssemblyCost(matched, Math.max(1, Math.round(aiAsm.quantity)));
        return {
          assembly: matched,
          quantity: Math.max(1, Math.round(aiAsm.quantity)),
          ...costs,
        };
      })
      .filter((item): item is AssemblyCartItem => item !== null);

    onApplyEstimate(materialItems, laborItems, assemblyItems);
    handleClose();

    Alert.alert(
      'Estimate Generated',
      `Added ${materialItems.length} materials, ${laborItems.length} labor items, and ${assemblyItems.length} assemblies to your estimate.`,
    );
  }, [result, matchMaterial, globalMarkup, calculateAssemblyCost, onApplyEstimate, handleClose]);

  const estimatedTotals = useMemo(() => {
    if (!result) return { materials: 0, labor: 0, assemblies: 0, additional: 0, grand: 0 };
    const materials = (result.materials ?? []).reduce((s, m) => s + (m.unitPrice ?? 0) * (m.quantity ?? 0), 0);
    const labor = (result.labor ?? []).reduce((s, l) => s + (l.hourlyRate ?? 0) * (l.hours ?? 0), 0);
    const assemblies = (result.assemblies ?? []).length;
    const add = result.additionalCosts ?? { permits: 0, dumpsterRental: 0, equipmentRental: 0, cleanup: 0, contingencyPercent: 10, overheadPercent: 12 };
    const additional = (add.permits ?? 0) + (add.dumpsterRental ?? 0) + (add.equipmentRental ?? 0) + (add.cleanup ?? 0);
    const subtotal = materials + labor + additional;
    const contingency = subtotal * ((add.contingencyPercent ?? 0) / 100);
    const overhead = subtotal * ((add.overheadPercent ?? 0) / 100);
    const grand = subtotal + contingency + overhead;
    return { materials, labor, assemblies, additional, grand };
  }, [result]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '92%'],
  });

  const renderInput = () => (
    <ScrollView style={s.scrollBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={s.heroSection}>
        <View style={s.heroIconWrap}>
          <Wand2 size={28} color={Colors.primary} />
        </View>
        <Text style={s.heroTitle}>AI Quick Estimate</Text>
        <Text style={s.heroDesc}>
          Describe your project and MAGE AI will generate a complete itemized estimate with materials, labor, and assemblies.
        </Text>
      </View>

      <View style={s.quickPromptsSection}>
        <Text style={s.sectionLabel}>Quick Start</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickPromptsRow}>
          {QUICK_PROMPTS.map((p, i) => (
            <TouchableOpacity
              key={i}
              style={[s.quickChip, description === p.prompt && s.quickChipActive]}
              onPress={() => handleQuickPrompt(p)}
              activeOpacity={0.7}
            >
              <Text style={[s.quickChipText, description === p.prompt && s.quickChipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.inputSection}>
        <Text style={s.sectionLabel}>Project Description</Text>
        <TextInput
          style={s.descInput}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g., 2,500 sqft kitchen remodel with mid-range finishes, new cabinets, countertops, flooring, lighting..."
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          testID="ai-estimate-desc"
        />
      </View>

      <View style={s.detailsRow}>
        <View style={s.detailField}>
          <Text style={s.detailLabel}>
            <Ruler size={12} color={Colors.textSecondary} /> Sq Ft
          </Text>
          <TextInput
            style={s.detailInput}
            value={sqft}
            onChangeText={setSqft}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
          />
        </View>
        <View style={s.detailField}>
          <Text style={s.detailLabel}>
            <MapPin size={12} color={Colors.textSecondary} /> Location
          </Text>
          <View style={s.locationBadge}>
            <Text style={s.locationText} numberOfLines={1}>{location || 'US Avg'}</Text>
          </View>
        </View>
      </View>

      <View style={s.inputSection}>
        <Text style={s.sectionLabel}>Project Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.typeRow}>
          {PROJECT_TYPES.slice(0, 8).map(pt => (
            <TouchableOpacity
              key={pt.id}
              style={[s.typeChip, projectType === pt.id && s.typeChipActive]}
              onPress={() => { setProjectType(pt.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              activeOpacity={0.7}
            >
              <Text style={[s.typeChipText, projectType === pt.id && s.typeChipTextActive]}>{pt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.inputSection}>
        <Text style={s.sectionLabel}>Quality Tier</Text>
        <View style={s.qualityRow}>
          {QUALITY_TIERS.map(q => (
            <TouchableOpacity
              key={q.id}
              style={[s.qualityChip, quality === q.id && s.qualityChipActive]}
              onPress={() => { setQuality(q.id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
              activeOpacity={0.7}
            >
              <Text style={[s.qualityChipLabel, quality === q.id && s.qualityChipLabelActive]}>{q.label}</Text>
              <Text style={[s.qualityChipDesc, quality === q.id && s.qualityChipDescActive]}>{q.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {error && (
        <View style={s.errorBanner}>
          <AlertTriangle size={16} color={Colors.error} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.generateBtn, !description.trim() && s.generateBtnDisabled]}
        onPress={handleGenerate}
        disabled={!description.trim()}
        activeOpacity={0.8}
        testID="ai-generate-btn"
      >
        <Sparkles size={20} color="#FFF" />
        <Text style={s.generateBtnText}>Generate Estimate with AI</Text>
      </TouchableOpacity>

      <View style={s.disclaimer}>
        <Text style={s.disclaimerText}>
          Uses 1 advanced AI credit. Estimate is based on current market data and should be reviewed before sending to clients.
        </Text>
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderLoading = () => (
    <View style={s.loadingContainer}>
      <Animated.View style={[s.loadingIcon, { opacity: pulseAnim }]}>
        <Wand2 size={48} color={Colors.primary} />
      </Animated.View>
      <Text style={s.loadingTitle}>Building Your Estimate</Text>
      <Text style={s.loadingDesc}>
        Analyzing project scope, calculating materials, matching labor rates, and optimizing costs...
      </Text>
      <View style={s.progressBar}>
        <Animated.View style={[s.progressFill, { width: progressWidth }]} />
      </View>
      <View style={s.loadingSteps}>
        {[
          'Analyzing project requirements...',
          'Calculating material quantities...',
          'Matching labor rates for your area...',
          'Identifying cost-saving opportunities...',
          'Finalizing estimate...',
        ].map((step2, i) => (
          <View key={i} style={s.loadingStepRow}>
            <Sparkles size={12} color={Colors.primary + '60'} />
            <Text style={s.loadingStepText}>{step2}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  const renderResult = () => {
    if (!result) return null;

    const confidenceColor = result.confidenceScore >= 75 ? Colors.success :
      result.confidenceScore >= 50 ? Colors.warning : Colors.error;

    return (
      <Animated.View style={[s.resultContainer, { opacity: fadeAnim }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={s.resultHeader}>
            <View style={s.resultBadge}>
              <Sparkles size={14} color={Colors.primary} />
              <Text style={s.resultBadgeText}>AI Generated</Text>
            </View>
            <View style={[s.confidenceBadge, { backgroundColor: confidenceColor + '15' }]}>
              <Text style={[s.confidenceText, { color: confidenceColor }]}>{result.confidenceScore}% confidence</Text>
            </View>
          </View>

          <View style={s.totalCard}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Estimated Total</Text>
              <Text style={s.totalValue}>${estimatedTotals.grand.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={s.totalDivider} />
            <View style={s.totalBreakdownGrid}>
              <View style={s.totalBreakdownItem}>
                <Package size={14} color={Colors.primary} />
                <Text style={s.totalBreakdownLabel}>Materials</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.materials.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <HardHat size={14} color={Colors.accent} />
                <Text style={s.totalBreakdownLabel}>Labor</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.labor.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <Shield size={14} color={Colors.info} />
                <Text style={s.totalBreakdownLabel}>Other</Text>
                <Text style={s.totalBreakdownValue}>${estimatedTotals.additional.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.totalBreakdownItem}>
                <Clock size={14} color={Colors.textSecondary} />
                <Text style={s.totalBreakdownLabel}>Duration</Text>
                <Text style={s.totalBreakdownValue}>{result.estimatedDuration}</Text>
              </View>
            </View>
            {result.costPerSqFt > 0 && (
              <View style={s.costPerSqftRow}>
                <DollarSign size={12} color={Colors.textSecondary} />
                <Text style={s.costPerSqftText}>${result.costPerSqFt.toFixed(0)}/sq ft</Text>
              </View>
            )}
          </View>

          {result.projectSummary ? (
            <View style={s.summaryCard}>
              <Text style={s.summaryLabel}>Scope Summary</Text>
              <Text style={s.summaryText}>{result.projectSummary}</Text>
            </View>
          ) : null}

          {renderCollapsible('materials', `Materials (${(result.materials ?? []).length})`, Package, Colors.primary, () => (
            <View style={s.itemsList}>
              {(result.materials ?? []).map((m, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName} numberOfLines={1}>{m.name}</Text>
                    <Text style={s.itemMeta}>{m.quantity} {m.unit} · {m.supplier}</Text>
                  </View>
                  <Text style={s.itemPrice}>${((m.unitPrice ?? 0) * (m.quantity ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          ))}

          {renderCollapsible('labor', `Labor (${(result.labor ?? []).length})`, HardHat, Colors.accent, () => (
            <View style={s.itemsList}>
              {(result.labor ?? []).map((l, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName}>{l.trade}</Text>
                    <Text style={s.itemMeta}>{l.hours} hrs @ ${l.hourlyRate}/hr · {l.crew}</Text>
                  </View>
                  <Text style={s.itemPrice}>${((l.hourlyRate ?? 0) * (l.hours ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              ))}
            </View>
          ))}

          {(result.assemblies ?? []).length > 0 && renderCollapsible('assemblies', `Assemblies (${(result.assemblies ?? []).length})`, Boxes, Colors.info, () => (
            <View style={s.itemsList}>
              {(result.assemblies ?? []).map((a, i) => (
                <View key={i} style={s.itemRow}>
                  <View style={s.itemLeft}>
                    <Text style={s.itemName}>{a.name}</Text>
                    <Text style={s.itemMeta}>{a.quantity} {a.unit}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}

          {renderCollapsible('additional', 'Additional Costs', DollarSign, Colors.textSecondary, () => (
            <View style={s.itemsList}>
              {(result.additionalCosts?.permits ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Permits</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.permits ?? 0).toLocaleString()}</Text>
                </View>
              )}
              {(result.additionalCosts?.dumpsterRental ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Dumpster Rental</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.dumpsterRental ?? 0).toLocaleString()}</Text>
                </View>
              )}
              {(result.additionalCosts?.equipmentRental ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Equipment Rental</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.equipmentRental ?? 0).toLocaleString()}</Text>
                </View>
              )}
              {(result.additionalCosts?.cleanup ?? 0) > 0 && (
                <View style={s.itemRow}>
                  <Text style={s.itemName}>Cleanup</Text>
                  <Text style={s.itemPrice}>${(result.additionalCosts?.cleanup ?? 0).toLocaleString()}</Text>
                </View>
              )}
              <View style={s.itemRow}>
                <Text style={s.itemName}>Contingency ({result.additionalCosts?.contingencyPercent ?? 0}%)</Text>
                <Text style={s.itemPrice}>${((estimatedTotals.materials + estimatedTotals.labor + estimatedTotals.additional) * (result.additionalCosts?.contingencyPercent ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
              <View style={s.itemRow}>
                <Text style={s.itemName}>Overhead ({result.additionalCosts?.overheadPercent ?? 0}%)</Text>
                <Text style={s.itemPrice}>${((estimatedTotals.materials + estimatedTotals.labor + estimatedTotals.additional) * (result.additionalCosts?.overheadPercent ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
              </View>
            </View>
          ))}

          {(result.warnings ?? []).length > 0 && (
            <View style={s.warningsCard}>
              <View style={s.warningsHeader}>
                <AlertTriangle size={14} color={Colors.warning} />
                <Text style={s.warningsTitle}>Watch Out</Text>
              </View>
              {(result.warnings ?? []).map((w, i) => (
                <Text key={i} style={s.warningItem}>• {w}</Text>
              ))}
            </View>
          )}

          {(result.savingsTips ?? []).length > 0 && (
            <View style={s.tipsCard}>
              <View style={s.tipsHeader}>
                <TrendingDown size={14} color={Colors.success} />
                <Text style={s.tipsTitle}>Savings Tips</Text>
              </View>
              {(result.savingsTips ?? []).map((t, i) => (
                <Text key={i} style={s.tipItem}>• {t}</Text>
              ))}
            </View>
          )}

          <TouchableOpacity style={s.applyBtn} onPress={handleApply} activeOpacity={0.8} testID="ai-apply-btn">
            <Zap size={20} color="#FFF" />
            <Text style={s.applyBtnText}>Add All to Estimate</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.regenerateBtn} onPress={handleReset} activeOpacity={0.7}>
            <Sparkles size={14} color={Colors.primary} />
            <Text style={s.regenerateBtnText}>Start Over</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    );
  };

  const renderCollapsible = (
    id: string,
    title: string,
    Icon: typeof Package,
    color: string,
    content: () => React.ReactNode,
  ) => {
    const isOpen = expandedSection === id;
    return (
      <View style={s.collapsibleCard}>
        <TouchableOpacity
          style={s.collapsibleHeader}
          onPress={() => { setExpandedSection(isOpen ? null : id); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
          activeOpacity={0.7}
        >
          <View style={s.collapsibleLeft}>
            <View style={[s.collapsibleIcon, { backgroundColor: color + '15' }]}>
              <Icon size={16} color={color} />
            </View>
            <Text style={s.collapsibleTitle}>{title}</Text>
          </View>
          {isOpen ? <ChevronUp size={18} color={Colors.textMuted} /> : <ChevronDown size={18} color={Colors.textMuted} />}
        </TouchableOpacity>
        {isOpen && content()}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.modalHeader}>
          <View style={s.modalHandle} />
          <View style={s.modalTitleRow}>
            <View style={s.modalTitleLeft}>
              <Sparkles size={20} color={Colors.primary} />
              <Text style={s.modalTitle}>AI Estimator</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={s.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {step === 'input' && renderInput()}
        {step === 'loading' && renderLoading()}
        {step === 'result' && renderResult()}
      </KeyboardAvoidingView>
    </Modal>
  );
});

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.fillSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    flex: 1,
    paddingHorizontal: 20,
  },
  heroSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 20,
    gap: 8,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  heroDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  quickPromptsSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  quickPromptsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 20,
  },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  quickChipTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  inputSection: {
    marginBottom: 16,
  },
  descInput: {
    minHeight: 100,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    lineHeight: 22,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  detailField: {
    flex: 1,
    gap: 6,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  detailInput: {
    height: 44,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationBadge: {
    height: 44,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 20,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  typeChipTextActive: {
    color: Colors.textOnPrimary,
    fontWeight: '600' as const,
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 8,
  },
  qualityChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 2,
  },
  qualityChipActive: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary,
  },
  qualityChipLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  qualityChipLabelActive: {
    color: Colors.primary,
  },
  qualityChipDesc: {
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center' as const,
  },
  qualityChipDescActive: {
    color: Colors.primary,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
    fontWeight: '500' as const,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    marginTop: 8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  disclaimer: {
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  disclaimerText: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  loadingIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  loadingSteps: {
    gap: 8,
    marginTop: 16,
    width: '100%',
  },
  loadingStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingStepText: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  resultContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
  },
  resultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  resultBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  resultSummary: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  summaryText: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  totalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.primary + '20',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  totalValue: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  totalDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: 12,
  },
  totalBreakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  totalBreakdownItem: {
    flex: 1,
    minWidth: '40%' as unknown as number,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
  },
  totalBreakdownLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  totalBreakdownValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    marginLeft: 'auto' as const,
  },
  costPerSqftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 12,
  },
  costPerSqftText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  collapsibleCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  collapsibleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collapsibleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  itemsList: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 6,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: Colors.background,
    borderRadius: 10,
  },
  itemLeft: {
    flex: 1,
    marginRight: 10,
  },
  itemName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  itemMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  warningsCard: {
    backgroundColor: Colors.warningLight,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  warningsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  warningsTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.warning,
  },
  warningItem: {
    fontSize: 13,
    color: '#7A5400',
    lineHeight: 18,
  },
  tipsCard: {
    backgroundColor: Colors.successLight,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 6,
  },
  tipsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  tipsTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  tipItem: {
    fontSize: 13,
    color: '#1B5E20',
    lineHeight: 18,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 18,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 4,
  },
  applyBtnText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  regenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
  },
  regenerateBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
});

```


---

### `components/AIEstimateValidator.tsx`

```tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, XCircle, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { validateEstimate, type EstimateValidationResult } from '@/utils/aiService';

interface Props {
  projectType: string;
  squareFootage: number;
  totalCost: number;
  materialCost: number;
  laborCost: number;
  itemCount: number;
  hasContingency: boolean;
  location: string;
}

const ISSUE_ICONS = {
  warning: { Icon: AlertTriangle, color: '#FF9500', bg: '#FFF3E0' },
  error: { Icon: XCircle, color: '#FF3B30', bg: '#FFF0EF' },
  suggestion: { Icon: Lightbulb, color: '#007AFF', bg: '#EBF3FF' },
  ok: { Icon: CheckCircle2, color: '#34C759', bg: '#E8F5E9' },
} as const;

export default React.memo(function AIEstimateValidator(props: Props) {
  const [result, setResult] = useState<EstimateValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleValidate = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await validateEstimate(
        props.projectType,
        props.squareFootage,
        props.totalCost,
        props.materialCost,
        props.laborCost,
        props.itemCount,
        props.hasContingency,
        props.location,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
      setIsExpanded(true);
    } catch (err) {
      console.error('[AI Estimate] Validation failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, props]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleValidate} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Search size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>
          {isLoading ? 'Validating...' : 'AI Validate Estimate'}
        </Text>
        <Sparkles size={14} color={Colors.primary} />
      </TouchableOpacity>
    );
  }

  const scoreColor = result.overallScore >= 7 ? Colors.success :
    result.overallScore >= 5 ? Colors.warning : Colors.error;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setIsExpanded(!isExpanded)}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>AI Estimate Review</Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: `${scoreColor}15` }]}>
          <Text style={[styles.scoreText, { color: scoreColor }]}>{result.overallScore}/10</Text>
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <>
          {(result.issues ?? []).map((issue, idx) => {
            const config = ISSUE_ICONS[issue.type];
            return (
              <View key={idx} style={[styles.issueRow, { backgroundColor: config.bg }]}>
                <config.Icon size={16} color={config.color} />
                <View style={styles.issueContent}>
                  <Text style={[styles.issueTitle, { color: config.color }]}>{issue.title}</Text>
                  <Text style={styles.issueDetail}>{issue.detail}</Text>
                  {issue.potentialImpact ? (
                    <Text style={styles.issueImpact}>Impact: {issue.potentialImpact}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {(result.missingItems ?? []).length > 0 && (
            <View style={styles.missingSection}>
              <Text style={styles.missingTitle}>Potentially Missing Items:</Text>
              {(result.missingItems ?? []).map((item, idx) => (
                <Text key={idx} style={styles.missingItem}>• {item}</Text>
              ))}
            </View>
          )}

          <Text style={styles.summary}>{result.summary}</Text>

          <TouchableOpacity style={styles.revalidateBtn} onPress={handleValidate} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
            <Text style={styles.revalidateText}>{isLoading ? 'Re-validating...' : 'Re-validate'}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${Colors.primary}20`,
    marginVertical: 8,
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scoreText: {
    fontSize: 14,
    fontWeight: '800' as const,
  },
  issueRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 10,
  },
  issueContent: {
    flex: 1,
    gap: 2,
  },
  issueTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  issueDetail: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  issueImpact: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  missingSection: {
    padding: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    gap: 4,
  },
  missingTitle: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  missingItem: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  summary: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19,
    fontStyle: 'italic' as const,
  },
  revalidateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  revalidateText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
});

```


---

### `components/SquareFootEstimator.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, ChevronRight, Building2, Home, Hammer, Trees, Calculator, TrendingUp, TrendingDown, Minus as MinusIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { SQUARE_FOOT_MODELS, QUALITY_TIERS, SF_CATEGORIES, type SquareFootModel, type QualityTier } from '@/constants/squareFootCosts';

interface SquareFootEstimatorProps {
  visible: boolean;
  onClose: () => void;
  locationFactor?: number;
}

const CATEGORY_ICONS: Record<string, typeof Home> = {
  residential: Home,
  renovation: Hammer,
  commercial: Building2,
  exterior: Trees,
};

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

const SquareFootEstimator = React.memo(function SquareFootEstimator({ visible, onClose, locationFactor = 1 }: SquareFootEstimatorProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedModel, setSelectedModel] = useState<SquareFootModel | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<QualityTier>('standard');
  const [sqftInput, setSqftInput] = useState('');

  const resetState = useCallback(() => {
    setStep(1);
    setSelectedCategory('all');
    setSelectedModel(null);
    setSelectedQuality('standard');
    setSqftInput('');
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    setTimeout(resetState, 300);
  }, [onClose, resetState]);

  const filteredModels = useMemo(() => {
    if (selectedCategory === 'all') return SQUARE_FOOT_MODELS;
    return SQUARE_FOOT_MODELS.filter(m => m.category === selectedCategory);
  }, [selectedCategory]);

  const handleSelectModel = useCallback((model: SquareFootModel) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedModel(model);
    setSqftInput(String(Math.round((model.typicalSizeRange.min + model.typicalSizeRange.max) / 2)));
    setStep(2);
  }, []);

  const handleSelectQuality = useCallback((tier: QualityTier) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedQuality(tier);
  }, []);

  const sqft = useMemo(() => parseInt(sqftInput, 10) || 0, [sqftInput]);

  const costResult = useMemo(() => {
    if (!selectedModel || sqft <= 0) return null;
    const tierData = selectedModel.costPerSF[selectedQuality];
    return {
      low: Math.round(tierData.low * sqft * locationFactor),
      mid: Math.round(tierData.mid * sqft * locationFactor),
      high: Math.round(tierData.high * sqft * locationFactor),
      perSfLow: Number((tierData.low * locationFactor).toFixed(0)),
      perSfMid: Number((tierData.mid * locationFactor).toFixed(0)),
      perSfHigh: Number((tierData.high * locationFactor).toFixed(0)),
    };
  }, [selectedModel, sqft, selectedQuality, locationFactor]);

  const renderStep1 = () => (
    <>
      <Text style={s.stepTitle}>Select Building Type</Text>
      <View style={s.categoryRow}>
        {SF_CATEGORIES.map(cat => {
          const isActive = selectedCategory === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[s.catChip, isActive && s.catChipActive]}
              onPress={() => setSelectedCategory(cat.id)}
              activeOpacity={0.7}
            >
              <Text style={[s.catChipText, isActive && s.catChipTextActive]}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <ScrollView style={s.modelList} showsVerticalScrollIndicator={false}>
        {filteredModels.map(model => {
          const CatIcon = CATEGORY_ICONS[model.category] ?? Building2;
          const midRange = model.costPerSF.standard;
          return (
            <TouchableOpacity
              key={model.id}
              style={s.modelCard}
              onPress={() => handleSelectModel(model)}
              activeOpacity={0.7}
            >
              <View style={s.modelCardTop}>
                <View style={[s.modelIconWrap, { backgroundColor: Colors.primary + '12' }]}>
                  <CatIcon size={18} color={Colors.primary} />
                </View>
                <View style={s.modelCardInfo}>
                  <Text style={s.modelName}>{model.buildingType}</Text>
                  <Text style={s.modelDesc} numberOfLines={1}>{model.description}</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </View>
              <View style={s.modelCardBottom}>
                <Text style={s.modelRange}>${midRange.low}-${midRange.high}/SF</Text>
                <Text style={s.modelSize}>{model.typicalSizeRange.min.toLocaleString()}-{model.typicalSizeRange.max.toLocaleString()} SF</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={{ height: 20 }} />
      </ScrollView>
    </>
  );

  const renderStep2 = () => {
    if (!selectedModel) return null;
    return (
      <>
        <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
          <Text style={s.backBtnText}>← Change type</Text>
        </TouchableOpacity>
        <Text style={s.stepTitle}>{selectedModel.buildingType}</Text>
        <Text style={s.stepSubtitle}>Select quality level & enter size</Text>

        <View style={s.qualityGrid}>
          {QUALITY_TIERS.map(tier => {
            const isActive = selectedQuality === tier.id;
            const tierCost = selectedModel.costPerSF[tier.id];
            return (
              <TouchableOpacity
                key={tier.id}
                style={[s.qualityCard, isActive && s.qualityCardActive]}
                onPress={() => handleSelectQuality(tier.id)}
                activeOpacity={0.7}
              >
                <Text style={[s.qualityLabel, isActive && s.qualityLabelActive]}>{tier.label}</Text>
                <Text style={[s.qualityRange, isActive && s.qualityRangeActive]}>
                  ${tierCost.low}-${tierCost.high}
                </Text>
                <Text style={[s.qualityUnit, isActive && s.qualityUnitActive]}>per SF</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={s.fieldLabel}>Square Footage</Text>
        <View style={s.sqftRow}>
          <TouchableOpacity style={s.sqftBtn} onPress={() => setSqftInput(String(Math.max(0, sqft - 100)))}>
            <MinusIcon size={18} color={Colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={s.sqftInput}
            value={sqftInput}
            onChangeText={setSqftInput}
            keyboardType="number-pad"
            textAlign="center"
            placeholder="Enter SF"
            placeholderTextColor={Colors.textMuted}
          />
          <TouchableOpacity style={s.sqftBtn} onPress={() => setSqftInput(String(sqft + 100))}>
            <Text style={s.sqftBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={s.presetRow}>
          {[selectedModel.typicalSizeRange.min, Math.round((selectedModel.typicalSizeRange.min + selectedModel.typicalSizeRange.max) / 2), selectedModel.typicalSizeRange.max].map(val => (
            <TouchableOpacity key={val} style={s.presetChip} onPress={() => setSqftInput(String(val))}>
              <Text style={s.presetText}>{val.toLocaleString()} SF</Text>
            </TouchableOpacity>
          ))}
        </View>

        {costResult && (
          <View style={s.resultCard}>
            <View style={s.resultHeader}>
              <Calculator size={16} color={Colors.primary} />
              <Text style={s.resultTitle}>Estimated Cost Range</Text>
            </View>
            {locationFactor !== 1 && (
              <View style={s.locationBadge}>
                <Text style={s.locationText}>Location factor: {locationFactor.toFixed(2)}x</Text>
              </View>
            )}
            <View style={s.resultRow}>
              <View style={s.resultCol}>
                <TrendingDown size={14} color={Colors.success} />
                <Text style={s.resultLabel}>Low</Text>
                <Text style={s.resultValueLow}>{formatCurrency(costResult.low)}</Text>
                <Text style={s.resultPerSf}>${costResult.perSfLow}/SF</Text>
              </View>
              <View style={[s.resultCol, s.resultColMid]}>
                <Calculator size={14} color={Colors.primary} />
                <Text style={s.resultLabel}>Mid</Text>
                <Text style={s.resultValueMid}>{formatCurrency(costResult.mid)}</Text>
                <Text style={s.resultPerSf}>${costResult.perSfMid}/SF</Text>
              </View>
              <View style={s.resultCol}>
                <TrendingUp size={14} color={Colors.error} />
                <Text style={s.resultLabel}>High</Text>
                <Text style={s.resultValueHigh}>{formatCurrency(costResult.high)}</Text>
                <Text style={s.resultPerSf}>${costResult.perSfHigh}/SF</Text>
              </View>
            </View>
            {selectedModel.notes ? (
              <Text style={s.resultNotes}>{selectedModel.notes}</Text>
            ) : null}
          </View>
        )}
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={handleClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Quick Estimate</Text>
            <Text style={s.headerSub}>Square foot cost calculator</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>
        <View style={s.body}>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
        </View>
      </View>
    </Modal>
  );
});

export default SquareFootEstimator;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  stepTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, marginBottom: 4 },
  stepSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  categoryRow: { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: Colors.fillTertiary,
  },
  catChipActive: { backgroundColor: Colors.primary },
  catChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  catChipTextActive: { color: Colors.textOnPrimary },
  modelList: { flex: 1 },
  modelCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 10,
  },
  modelCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modelIconWrap: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  modelCardInfo: { flex: 1, gap: 2 },
  modelName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  modelDesc: { fontSize: 12, color: Colors.textMuted },
  modelCardBottom: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 6, borderTopWidth: 0.5, borderTopColor: Colors.borderLight,
  },
  modelRange: { fontSize: 14, fontWeight: '700' as const, color: Colors.success },
  modelSize: { fontSize: 11, color: Colors.textMuted },
  backBtn: { marginBottom: 8 },
  backBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
  qualityGrid: { flexDirection: 'row', gap: 8, marginBottom: 16, marginTop: 4 },
  qualityCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: Colors.cardBorder,
  },
  qualityCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  qualityLabel: { fontSize: 12, fontWeight: '700' as const, color: Colors.textSecondary },
  qualityLabelActive: { color: Colors.primary },
  qualityRange: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  qualityRangeActive: { color: Colors.primary },
  qualityUnit: { fontSize: 10, color: Colors.textMuted },
  qualityUnitActive: { color: Colors.primary },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6 },
  sqftRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  sqftBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  sqftBtnText: { fontSize: 22, color: Colors.primary, fontWeight: '600' as const },
  sqftInput: {
    flex: 1, height: 48, backgroundColor: Colors.surface, borderRadius: 12,
    fontSize: 20, fontWeight: '700' as const, color: Colors.text,
    borderWidth: 1, borderColor: Colors.border,
  },
  presetRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  presetChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: Colors.fillTertiary,
  },
  presetText: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary },
  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  locationBadge: {
    backgroundColor: Colors.infoLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  locationText: { fontSize: 11, fontWeight: '600' as const, color: Colors.info },
  resultRow: { flexDirection: 'row', gap: 8 },
  resultCol: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 12, padding: 12,
    alignItems: 'center', gap: 4,
  },
  resultColMid: { backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '25' },
  resultLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const },
  resultValueLow: { fontSize: 16, fontWeight: '800' as const, color: Colors.success },
  resultValueMid: { fontSize: 16, fontWeight: '800' as const, color: Colors.primary },
  resultValueHigh: { fontSize: 16, fontWeight: '800' as const, color: Colors.error },
  resultPerSf: { fontSize: 10, color: Colors.textMuted },
  resultNotes: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, fontStyle: 'italic' as const },
});

```


---

### `components/EstimateComparison.tsx`

```tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { X, GitCompare, TrendingUp, TrendingDown, Minus, Save, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { MaterialItem } from '@/constants/materials';
import type { LaborRate } from '@/constants/laborRates';
import type { AssemblyItem } from '@/constants/assemblies';

interface CartItem {
  material: MaterialItem;
  quantity: number;
  markup: number;
  usesBulk: boolean;
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

interface SavedEstimateVersion {
  id: string;
  name: string;
  savedAt: string;
  materialsTotal: number;
  laborTotal: number;
  assemblyTotal: number;
  grandTotal: number;
  materialCount: number;
  laborCount: number;
  assemblyCount: number;
  items: Array<{ id: string; name: string; category: string; total: number; quantity: number }>;
}

interface EstimateComparisonProps {
  visible: boolean;
  onClose: () => void;
  currentCart: CartItem[];
  currentLaborCart: LaborCartItem[];
  currentAssemblyCart: AssemblyCartItem[];
  currentMaterialsTotal: number;
  currentLaborTotal: number;
  currentAssemblyTotal: number;
  currentGrandTotal: number;
}

const STORAGE_KEY = 'mageid_estimate_versions';

function formatDelta(current: number, saved: number): { text: string; color: string; icon: typeof TrendingUp } {
  const delta = current - saved;
  const pct = saved > 0 ? ((delta / saved) * 100).toFixed(1) : '0.0';
  if (delta > 0) return { text: `+$${delta.toFixed(0)} (+${pct}%)`, color: Colors.error, icon: TrendingUp };
  if (delta < 0) return { text: `-$${Math.abs(delta).toFixed(0)} (${pct}%)`, color: Colors.success, icon: TrendingDown };
  return { text: '$0 (0%)', color: Colors.textMuted, icon: Minus };
}

const EstimateComparison = React.memo(function EstimateComparison({
  visible, onClose,
  currentCart, currentLaborCart, currentAssemblyCart,
  currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal,
}: EstimateComparisonProps) {
  const [savedVersions, setSavedVersions] = useState<SavedEstimateVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<SavedEstimateVersion | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      loadVersions();
    }
  }, [visible]);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSavedVersions(JSON.parse(stored));
      }
    } catch (err) {
      console.error('[EstimateComparison] Failed to load versions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSaveCurrentVersion = useCallback(async () => {
    if (currentGrandTotal <= 0) {
      Alert.alert('Nothing to Save', 'Add items to your estimate first.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const items = currentCart.map(i => ({
      id: i.material.id,
      name: i.material.name,
      category: i.material.category,
      total: (i.usesBulk ? i.material.baseBulkPrice : i.material.baseRetailPrice) * (1 + i.markup / 100) * i.quantity,
      quantity: i.quantity,
    }));

    const version: SavedEstimateVersion = {
      id: `v-${Date.now()}`,
      name: `V${savedVersions.length + 1} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      savedAt: new Date().toISOString(),
      materialsTotal: currentMaterialsTotal,
      laborTotal: currentLaborTotal,
      assemblyTotal: currentAssemblyTotal,
      grandTotal: currentGrandTotal,
      materialCount: currentCart.length,
      laborCount: currentLaborCart.length,
      assemblyCount: currentAssemblyCart.length,
      items,
    };

    const updated = [version, ...savedVersions].slice(0, 10);
    setSavedVersions(updated);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('[EstimateComparison] Failed to save version:', err);
    }
    Alert.alert('Saved', `Estimate saved as "${version.name}"`);
  }, [currentCart, currentLaborCart, currentAssemblyCart, currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal, savedVersions]);

  const handleDeleteVersion = useCallback(async (id: string) => {
    const updated = savedVersions.filter(v => v.id !== id);
    setSavedVersions(updated);
    if (selectedVersion?.id === id) setSelectedVersion(null);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('[EstimateComparison] Failed to delete version:', err);
    }
  }, [savedVersions, selectedVersion]);

  const comparison = useMemo(() => {
    if (!selectedVersion) return null;
    const matDelta = formatDelta(currentMaterialsTotal, selectedVersion.materialsTotal);
    const labDelta = formatDelta(currentLaborTotal, selectedVersion.laborTotal);
    const asmDelta = formatDelta(currentAssemblyTotal, selectedVersion.assemblyTotal);
    const totalDelta = formatDelta(currentGrandTotal, selectedVersion.grandTotal);

    const currentItemMap = new Map(currentCart.map(i => {
      const total = (i.usesBulk ? i.material.baseBulkPrice : i.material.baseRetailPrice) * (1 + i.markup / 100) * i.quantity;
      return [i.material.id, { name: i.material.name, total, quantity: i.quantity }];
    }));
    const savedItemMap = new Map(selectedVersion.items.map(i => [i.id, i]));

    const changedItems: Array<{ name: string; currentTotal: number; savedTotal: number; type: 'changed' | 'new' | 'removed' }> = [];

    for (const [id, curr] of currentItemMap) {
      const saved = savedItemMap.get(id);
      if (!saved) {
        changedItems.push({ name: curr.name, currentTotal: curr.total, savedTotal: 0, type: 'new' });
      } else if (Math.abs(curr.total - saved.total) > 0.50) {
        changedItems.push({ name: curr.name, currentTotal: curr.total, savedTotal: saved.total, type: 'changed' });
      }
    }
    for (const [id, saved] of savedItemMap) {
      if (!currentItemMap.has(id)) {
        changedItems.push({ name: saved.name, currentTotal: 0, savedTotal: saved.total, type: 'removed' });
      }
    }

    return { matDelta, labDelta, asmDelta, totalDelta, changedItems };
  }, [selectedVersion, currentMaterialsTotal, currentLaborTotal, currentAssemblyTotal, currentGrandTotal, currentCart]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Compare Estimates</Text>
            <Text style={s.headerSub}>Track changes across versions</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
          <TouchableOpacity style={s.saveBtn} onPress={handleSaveCurrentVersion} activeOpacity={0.85}>
            <Save size={16} color={Colors.textOnPrimary} />
            <Text style={s.saveBtnText}>Save Current as Version</Text>
          </TouchableOpacity>

          {savedVersions.length === 0 && !loading && (
            <View style={s.emptyState}>
              <GitCompare size={40} color={Colors.textMuted} />
              <Text style={s.emptyTitle}>No saved versions yet</Text>
              <Text style={s.emptyDesc}>Save your current estimate to start tracking changes over time.</Text>
            </View>
          )}

          {savedVersions.length > 0 && (
            <>
              <Text style={s.sectionTitle}>Saved Versions</Text>
              {savedVersions.map(version => {
                const isSelected = selectedVersion?.id === version.id;
                return (
                  <TouchableOpacity
                    key={version.id}
                    style={[s.versionCard, isSelected && s.versionCardSelected]}
                    onPress={() => {
                      setSelectedVersion(isSelected ? null : version);
                      if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={s.versionTop}>
                      <View style={s.versionInfo}>
                        <Text style={[s.versionName, isSelected && s.versionNameSelected]}>{version.name}</Text>
                        <View style={s.versionMeta}>
                          <Clock size={10} color={Colors.textMuted} />
                          <Text style={s.versionDate}>
                            {new Date(version.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      </View>
                      <View style={s.versionRight}>
                        <Text style={[s.versionTotal, isSelected && s.versionTotalSelected]}>${version.grandTotal.toFixed(0)}</Text>
                        <Text style={s.versionCount}>{version.materialCount + version.laborCount + version.assemblyCount} items</Text>
                      </View>
                    </View>
                    {isSelected && (
                      <TouchableOpacity
                        style={s.deleteBtn}
                        onPress={() => handleDeleteVersion(version.id)}
                      >
                        <X size={12} color={Colors.error} />
                        <Text style={s.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {comparison && selectedVersion && (
            <View style={s.comparisonSection}>
              <Text style={s.sectionTitle}>Comparison</Text>
              <View style={s.compTable}>
                <View style={s.compHeader}>
                  <Text style={[s.compHeaderCell, { flex: 2 }]} />
                  <Text style={s.compHeaderCell}>Current</Text>
                  <Text style={s.compHeaderCell}>{selectedVersion.name}</Text>
                  <Text style={s.compHeaderCell}>Delta</Text>
                </View>

                {[
                  { label: 'Materials', current: currentMaterialsTotal, saved: selectedVersion.materialsTotal, delta: comparison.matDelta },
                  { label: 'Labor', current: currentLaborTotal, saved: selectedVersion.laborTotal, delta: comparison.labDelta },
                  { label: 'Assemblies', current: currentAssemblyTotal, saved: selectedVersion.assemblyTotal, delta: comparison.asmDelta },
                ].map(row => (
                  <View key={row.label} style={s.compRow}>
                    <Text style={[s.compCell, { flex: 2, fontWeight: '600' as const }]}>{row.label}</Text>
                    <Text style={s.compCell}>${row.current.toFixed(0)}</Text>
                    <Text style={[s.compCell, { color: Colors.textMuted }]}>${row.saved.toFixed(0)}</Text>
                    <Text style={[s.compCell, { color: row.delta.color, fontWeight: '600' as const, fontSize: 11 }]}>{row.delta.text}</Text>
                  </View>
                ))}

                <View style={s.compDivider} />
                <View style={s.compRow}>
                  <Text style={[s.compCell, { flex: 2, fontWeight: '700' as const, fontSize: 14 }]}>Grand Total</Text>
                  <Text style={[s.compCell, { fontWeight: '700' as const, color: Colors.primary }]}>${currentGrandTotal.toFixed(0)}</Text>
                  <Text style={[s.compCell, { color: Colors.textMuted }]}>${selectedVersion.grandTotal.toFixed(0)}</Text>
                  <Text style={[s.compCell, { color: comparison.totalDelta.color, fontWeight: '700' as const, fontSize: 12 }]}>{comparison.totalDelta.text}</Text>
                </View>
              </View>

              {comparison.changedItems.length > 0 && (
                <View style={s.changesSection}>
                  <Text style={s.changesSectionTitle}>Line Item Changes</Text>
                  {comparison.changedItems.slice(0, 15).map((item, idx) => {
                    const bgColor = item.type === 'new' ? Colors.successLight : item.type === 'removed' ? Colors.errorLight : Colors.warningLight;
                    const textColor = item.type === 'new' ? Colors.success : item.type === 'removed' ? Colors.error : Colors.warning;
                    const label = item.type === 'new' ? 'NEW' : item.type === 'removed' ? 'REMOVED' : 'CHANGED';
                    return (
                      <View key={`${item.name}-${idx}`} style={[s.changeRow, { backgroundColor: bgColor }]}>
                        <View style={s.changeInfo}>
                          <Text style={s.changeName} numberOfLines={1}>{item.name}</Text>
                          <View style={s.changeBadge}>
                            <Text style={[s.changeBadgeText, { color: textColor }]}>{label}</Text>
                          </View>
                        </View>
                        <View style={s.changeAmounts}>
                          {item.type !== 'new' && <Text style={s.changeOld}>${item.savedTotal.toFixed(0)}</Text>}
                          {item.type !== 'removed' && <Text style={[s.changeNew, { color: textColor }]}>${item.currentTotal.toFixed(0)}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
});

export default EstimateComparison;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginBottom: 16,
  },
  saveBtnText: { fontSize: 15, fontWeight: '700' as const, color: Colors.textOnPrimary },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  sectionTitle: {
    fontSize: 15, fontWeight: '700' as const, color: Colors.text, marginBottom: 8, marginTop: 4,
  },
  versionCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: Colors.cardBorder, gap: 8,
  },
  versionCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primary + '06' },
  versionTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  versionInfo: { flex: 1, gap: 3 },
  versionName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  versionNameSelected: { color: Colors.primary },
  versionMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  versionDate: { fontSize: 11, color: Colors.textMuted },
  versionRight: { alignItems: 'flex-end', gap: 2 },
  versionTotal: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  versionTotalSelected: { color: Colors.primary },
  versionCount: { fontSize: 10, color: Colors.textMuted },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' as const,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.errorLight,
  },
  deleteBtnText: { fontSize: 11, fontWeight: '600' as const, color: Colors.error },
  comparisonSection: { marginTop: 8, gap: 8 },
  compTable: {
    backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  compHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: Colors.fillSecondary, gap: 4,
  },
  compHeaderCell: {
    flex: 1, fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.3, textAlign: 'right' as const,
  },
  compRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight, alignItems: 'center', gap: 4,
  },
  compCell: { flex: 1, fontSize: 12, color: Colors.textSecondary, textAlign: 'right' as const },
  compDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 12 },
  changesSection: { marginTop: 12, gap: 6 },
  changesSectionTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text, marginBottom: 2 },
  changeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, padding: 10, gap: 8,
  },
  changeInfo: { flex: 1, gap: 4 },
  changeName: { fontSize: 12, fontWeight: '500' as const, color: Colors.text },
  changeBadge: { alignSelf: 'flex-start' as const },
  changeBadgeText: { fontSize: 9, fontWeight: '700' as const, letterSpacing: 0.5 },
  changeAmounts: { alignItems: 'flex-end', gap: 2 },
  changeOld: { fontSize: 11, color: Colors.textMuted, textDecorationLine: 'line-through' as const },
  changeNew: { fontSize: 13, fontWeight: '700' as const },
});

```


---

### `components/CostBreakdownReport.tsx`

```tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Package, Percent, MapPin, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { CATEGORY_META, CATEGORY_COST_FACTORS } from '@/constants/materials';
import type { MaterialItem } from '@/constants/materials';
import type { LaborRate } from '@/constants/laborRates';
import type { AssemblyItem } from '@/constants/assemblies';

interface CartItem {
  material: MaterialItem;
  quantity: number;
  markup: number;
  usesBulk: boolean;
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

interface CostBreakdownReportProps {
  cart: CartItem[];
  laborCart: LaborCartItem[];
  assemblyCart: AssemblyCartItem[];
  globalMarkup: number;
  locationFactor: number;
  locationName?: string;
}

interface CategoryBreakdown {
  category: string;
  label: string;
  color: string;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  total: number;
}

const CostBreakdownReport = React.memo(function CostBreakdownReport({
  cart, laborCart, assemblyCart, globalMarkup, locationFactor, locationName: _locationName,
}: CostBreakdownReportProps) {
  const breakdown = useMemo(() => {
    const categoryMap = new Map<string, CategoryBreakdown>();

    for (const item of cart) {
      const base = item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
      const totalMaterial = base * item.quantity;
      const factors = CATEGORY_COST_FACTORS[item.material.category];
      const laborCost = factors ? totalMaterial * factors.laborFactor : 0;
      const equipmentCost = factors ? totalMaterial * factors.equipmentFactor : 0;

      const cat = item.material.category;
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.materialCost += totalMaterial;
        existing.laborCost += laborCost;
        existing.equipmentCost += equipmentCost;
        existing.total += totalMaterial + laborCost + equipmentCost;
      } else {
        const meta = CATEGORY_META[cat];
        categoryMap.set(cat, {
          category: cat,
          label: meta?.label ?? cat,
          color: meta?.color ?? Colors.primary,
          materialCost: totalMaterial,
          laborCost,
          equipmentCost,
          total: totalMaterial + laborCost + equipmentCost,
        });
      }
    }

    return Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);
  }, [cart]);

  const totals = useMemo(() => {
    let materialTotal = 0;
    let laborTotal = 0;
    let equipmentTotal = 0;

    for (const b of breakdown) {
      materialTotal += b.materialCost;
      laborTotal += b.laborCost;
      equipmentTotal += b.equipmentCost;
    }

    const directLaborTotal = laborCart.reduce((sum, i) => sum + i.adjustedRate * i.hours, 0);
    const assemblyMaterialTotal = assemblyCart.reduce((sum, i) => sum + i.materialsCost, 0);
    const assemblyLaborTotal = assemblyCart.reduce((sum, i) => sum + i.laborCost, 0);
    const laborHours = laborCart.reduce((sum, i) => sum + i.hours, 0);

    const combinedMaterial = materialTotal + assemblyMaterialTotal;
    const combinedLabor = laborTotal + directLaborTotal + assemblyLaborTotal;
    const combinedEquipment = equipmentTotal;
    const subtotal = combinedMaterial + combinedLabor + combinedEquipment;
    const markupAmount = (materialTotal * globalMarkup / 100);
    const grandTotal = subtotal + markupAmount;

    const matPct = grandTotal > 0 ? (combinedMaterial / grandTotal) * 100 : 0;
    const labPct = grandTotal > 0 ? (combinedLabor / grandTotal) * 100 : 0;
    const eqPct = grandTotal > 0 ? (combinedEquipment / grandTotal) * 100 : 0;
    const mkPct = grandTotal > 0 ? (markupAmount / grandTotal) * 100 : 0;

    return {
      materialTotal: combinedMaterial,
      laborTotal: combinedLabor,
      equipmentTotal: combinedEquipment,
      markupAmount,
      grandTotal,
      laborHours,
      matPct, labPct, eqPct, mkPct,
      matLaborRatio: combinedLabor > 0 ? (combinedMaterial / combinedLabor).toFixed(1) : 'N/A',
    };
  }, [breakdown, laborCart, assemblyCart, globalMarkup]);

  if (cart.length === 0 && laborCart.length === 0 && assemblyCart.length === 0) return null;

  return (
    <View style={s.container}>
      <Text style={s.sectionTitle}>Cost Report</Text>

      <View style={s.barContainer}>
        <View style={s.barTrack}>
          {totals.matPct > 0 && <View style={[s.barSegment, { width: `${totals.matPct}%`, backgroundColor: Colors.primary }]} />}
          {totals.labPct > 0 && <View style={[s.barSegment, { width: `${totals.labPct}%`, backgroundColor: Colors.accent }]} />}
          {totals.eqPct > 0 && <View style={[s.barSegment, { width: `${totals.eqPct}%`, backgroundColor: Colors.info }]} />}
          {totals.mkPct > 0 && <View style={[s.barSegment, { width: `${totals.mkPct}%`, backgroundColor: '#9CA3AF' }]} />}
        </View>
        <View style={s.legendRow}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: Colors.primary }]} />
            <Text style={s.legendText}>Material {totals.matPct.toFixed(0)}%</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: Colors.accent }]} />
            <Text style={s.legendText}>Labor {totals.labPct.toFixed(0)}%</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: Colors.info }]} />
            <Text style={s.legendText}>Equip {totals.eqPct.toFixed(0)}%</Text>
          </View>
          {totals.mkPct > 0 && (
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: '#9CA3AF' }]} />
              <Text style={s.legendText}>Markup {totals.mkPct.toFixed(0)}%</Text>
            </View>
          )}
        </View>
      </View>

      {breakdown.length > 0 && (
        <View style={s.divisionTable}>
          <View style={s.tableHeader}>
            <Text style={[s.tableHeaderCell, { flex: 2 }]}>Division</Text>
            <Text style={s.tableHeaderCell}>Material</Text>
            <Text style={s.tableHeaderCell}>Labor</Text>
            <Text style={s.tableHeaderCell}>Total</Text>
          </View>
          {breakdown.slice(0, 6).map(b => (
            <View key={b.category} style={s.tableRow}>
              <View style={[s.tableCell, { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                <View style={[s.tableDot, { backgroundColor: b.color }]} />
                <Text style={s.tableCellText} numberOfLines={1}>{b.label}</Text>
              </View>
              <Text style={[s.tableCellText, { flex: 1, textAlign: 'right' as const }]}>${b.materialCost.toFixed(0)}</Text>
              <Text style={[s.tableCellText, { flex: 1, textAlign: 'right' as const }]}>${b.laborCost.toFixed(0)}</Text>
              <Text style={[s.tableCellBold, { flex: 1, textAlign: 'right' as const }]}>${b.total.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.metricsGrid}>
        <View style={s.metricCard}>
          <Package size={14} color={Colors.primary} />
          <Text style={s.metricLabel}>Mat:Labor</Text>
          <Text style={s.metricValue}>{totals.matLaborRatio}:1</Text>
        </View>
        <View style={s.metricCard}>
          <Percent size={14} color={Colors.accent} />
          <Text style={s.metricLabel}>Markup</Text>
          <Text style={s.metricValue}>${totals.markupAmount.toFixed(0)}</Text>
        </View>
        <View style={s.metricCard}>
          <Clock size={14} color={Colors.info} />
          <Text style={s.metricLabel}>Labor Hrs</Text>
          <Text style={s.metricValue}>{totals.laborHours.toFixed(0)}</Text>
        </View>
        {locationFactor !== 1 && (
          <View style={s.metricCard}>
            <MapPin size={14} color={Colors.warning} />
            <Text style={s.metricLabel}>Location</Text>
            <Text style={s.metricValue}>{locationFactor.toFixed(2)}x</Text>
          </View>
        )}
      </View>
    </View>
  );
});

export default CostBreakdownReport;

const s = StyleSheet.create({
  container: { gap: 12 },
  sectionTitle: {
    fontSize: 16, fontWeight: '700' as const, color: Colors.text,
    paddingHorizontal: 16, paddingTop: 8,
  },
  barContainer: {
    marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  barTrack: {
    flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden' as const,
    backgroundColor: Colors.fillTertiary,
  },
  barSegment: { height: '100%' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: '600' as const, color: Colors.textSecondary },
  divisionTable: {
    marginHorizontal: 16, backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const,
  },
  tableHeader: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: Colors.fillSecondary, gap: 4,
  },
  tableHeaderCell: {
    flex: 1, fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 0.5, borderTopColor: Colors.borderLight, alignItems: 'center', gap: 4,
  },
  tableCell: { flex: 1 },
  tableDot: { width: 6, height: 6, borderRadius: 3 },
  tableCellText: { fontSize: 12, color: Colors.textSecondary },
  tableCellBold: { fontSize: 12, fontWeight: '700' as const, color: Colors.text },
  metricsGrid: {
    flexDirection: 'row', flexWrap: 'wrap' as const, paddingHorizontal: 16, gap: 8,
  },
  metricCard: {
    flex: 1, minWidth: 70, backgroundColor: Colors.surface, borderRadius: 10, padding: 10,
    alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  metricLabel: { fontSize: 10, fontWeight: '600' as const, color: Colors.textMuted },
  metricValue: { fontSize: 14, fontWeight: '800' as const, color: Colors.text },
});

```


---

### `components/ProductivityCalculator.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { X, Search, Clock, Users, DollarSign, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PRODUCTIVITY_RATES, PRODUCTIVITY_CATEGORIES, type ProductivityRate } from '@/constants/productivityRates';

interface ProductivityCalculatorProps {
  visible: boolean;
  onClose: () => void;
  onAddToEstimate?: (item: { name: string; materialCost: number; laborCost: number; equipmentCost: number; totalCost: number }) => void;
}

const ProductivityCalculator = React.memo(function ProductivityCalculator({ visible, onClose, onAddToEstimate }: ProductivityCalculatorProps) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedRate, setSelectedRate] = useState<ProductivityRate | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredRates = useMemo(() => {
    let results = PRODUCTIVITY_RATES;
    if (selectedCategory !== 'all') results = results.filter(r => r.category === selectedCategory);
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(r => r.task.toLowerCase().includes(q) || r.crew.toLowerCase().includes(q));
    }
    return results;
  }, [query, selectedCategory]);

  const handleSelect = useCallback((rate: ProductivityRate) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedRate(rate);
    setQuantityInput('100');
  }, []);

  const qty = useMemo(() => parseFloat(quantityInput) || 0, [quantityInput]);

  const calculation = useMemo(() => {
    if (!selectedRate || qty <= 0) return null;
    const materialCost = selectedRate.materialCostPerUnit * qty;
    const laborCost = selectedRate.laborCostPerUnit * qty;
    const equipmentCost = selectedRate.equipmentCostPerUnit * qty;
    const totalCost = materialCost + laborCost + equipmentCost;
    const daysToComplete = selectedRate.dailyOutput > 0 ? qty / selectedRate.dailyOutput : 0;
    return { materialCost, laborCost, equipmentCost, totalCost, daysToComplete };
  }, [selectedRate, qty]);

  const handleAddToEstimate = useCallback(() => {
    if (!selectedRate || !calculation || !onAddToEstimate) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onAddToEstimate({
      name: `${selectedRate.task} (${qty} ${selectedRate.unit})`,
      materialCost: calculation.materialCost,
      laborCost: calculation.laborCost,
      equipmentCost: calculation.equipmentCost,
      totalCost: calculation.totalCost,
    });
    setSelectedRate(null);
    setQuantityInput('');
    onClose();
  }, [selectedRate, calculation, qty, onAddToEstimate, onClose]);

  const handleClose = useCallback(() => {
    setSelectedRate(null);
    setQuery('');
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined} onRequestClose={handleClose}>
      <View style={s.container}>
        <View style={s.header}>
          <View>
            <Text style={s.headerTitle}>Productivity Calc</Text>
            <Text style={s.headerSub}>Crew output & cost estimator</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={s.closeBtn}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
        </View>

        {selectedRate ? (
          <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
            <TouchableOpacity style={s.backBtn} onPress={() => setSelectedRate(null)}>
              <Text style={s.backBtnText}>← Select different task</Text>
            </TouchableOpacity>

            <Text style={s.taskTitle}>{selectedRate.task}</Text>

            <View style={s.crewCard}>
              <View style={s.crewRow}>
                <Users size={14} color={Colors.primary} />
                <Text style={s.crewLabel}>Crew:</Text>
                <Text style={s.crewValue}>{selectedRate.crew}</Text>
              </View>
              <View style={s.crewRow}>
                <Clock size={14} color={Colors.accent} />
                <Text style={s.crewLabel}>Daily Output:</Text>
                <Text style={s.crewValue}>{selectedRate.dailyOutput} {selectedRate.unit}/day</Text>
              </View>
            </View>

            <Text style={s.fieldLabel}>Quantity ({selectedRate.unit})</Text>
            <TextInput
              style={s.qtyInput}
              value={quantityInput}
              onChangeText={setQuantityInput}
              keyboardType="decimal-pad"
              textAlign="center"
              placeholder={`Enter ${selectedRate.unit}`}
              placeholderTextColor={Colors.textMuted}
            />

            {calculation && (
              <View style={s.resultCard}>
                <Text style={s.resultTitle}>Cost Breakdown</Text>

                <View style={s.costRow}>
                  <Text style={s.costLabel}>Materials</Text>
                  <Text style={s.costSub}>${selectedRate.materialCostPerUnit.toFixed(2)}/{selectedRate.unit}</Text>
                  <Text style={s.costValue}>${calculation.materialCost.toFixed(2)}</Text>
                </View>
                <View style={s.costRow}>
                  <Text style={s.costLabel}>Labor</Text>
                  <Text style={s.costSub}>${selectedRate.laborCostPerUnit.toFixed(2)}/{selectedRate.unit}</Text>
                  <Text style={s.costValue}>${calculation.laborCost.toFixed(2)}</Text>
                </View>
                <View style={s.costRow}>
                  <Text style={s.costLabel}>Equipment</Text>
                  <Text style={s.costSub}>${selectedRate.equipmentCostPerUnit.toFixed(2)}/{selectedRate.unit}</Text>
                  <Text style={s.costValue}>${calculation.equipmentCost.toFixed(2)}</Text>
                </View>

                <View style={s.divider} />

                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Cost</Text>
                  <Text style={s.totalValue}>${calculation.totalCost.toFixed(2)}</Text>
                </View>

                <View style={s.scheduleCard}>
                  <View style={s.scheduleRow}>
                    <Clock size={14} color={Colors.info} />
                    <Text style={s.scheduleLabel}>Estimated Duration:</Text>
                    <Text style={s.scheduleValue}>
                      {calculation.daysToComplete < 1
                        ? `${(calculation.daysToComplete * 8).toFixed(1)} hours`
                        : `${calculation.daysToComplete.toFixed(1)} days`}
                    </Text>
                  </View>
                  <View style={s.scheduleRow}>
                    <Users size={14} color={Colors.info} />
                    <Text style={s.scheduleLabel}>Crew:</Text>
                    <Text style={s.scheduleValue}>{selectedRate.crew}</Text>
                  </View>
                </View>

                {selectedRate.notes ? (
                  <Text style={s.notes}>{selectedRate.notes}</Text>
                ) : null}

                {onAddToEstimate && (
                  <TouchableOpacity style={s.addBtn} onPress={handleAddToEstimate} activeOpacity={0.85}>
                    <DollarSign size={16} color={Colors.textOnPrimary} />
                    <Text style={s.addBtnText}>Add to Estimate</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        ) : (
          <View style={s.body}>
            <View style={s.searchBar}>
              <Search size={16} color={Colors.textMuted} />
              <TextInput
                style={s.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search tasks..."
                placeholderTextColor={Colors.textMuted}
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <X size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={s.catContent}>
              {PRODUCTIVITY_CATEGORIES.map(cat => {
                const isActive = selectedCategory === cat.id;
                return (
                  <TouchableOpacity key={cat.id} style={[s.catChip, isActive && s.catChipActive]} onPress={() => setSelectedCategory(cat.id)}>
                    <Text style={[s.catChipText, isActive && s.catChipTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView style={s.rateList} showsVerticalScrollIndicator={false}>
              {filteredRates.map(rate => {
                const isExpanded = expandedId === rate.id;
                const unitCost = rate.materialCostPerUnit + rate.laborCostPerUnit + rate.equipmentCostPerUnit;
                return (
                  <View key={rate.id} style={s.rateCard}>
                    <TouchableOpacity style={s.rateCardTop} onPress={() => handleSelect(rate)} activeOpacity={0.7}>
                      <View style={s.rateInfo}>
                        <Text style={s.rateName}>{rate.task}</Text>
                        <Text style={s.rateCrew}>{rate.crew}</Text>
                      </View>
                      <View style={s.rateRight}>
                        <Text style={s.rateUnitCost}>${unitCost.toFixed(2)}</Text>
                        <Text style={s.rateUnit}>/{rate.unit}</Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.expandToggle}
                      onPress={() => setExpandedId(isExpanded ? null : rate.id)}
                    >
                      <Text style={s.expandText}>{rate.dailyOutput} {rate.unit}/day</Text>
                      {isExpanded ? <ChevronUp size={12} color={Colors.textMuted} /> : <ChevronDown size={12} color={Colors.textMuted} />}
                    </TouchableOpacity>
                    {isExpanded && (
                      <View style={s.expandedContent}>
                        <Text style={s.expandedRow}>Mat: ${rate.materialCostPerUnit.toFixed(2)} · Lab: ${rate.laborCostPerUnit.toFixed(2)} · Equip: ${rate.equipmentCostPerUnit.toFixed(2)}</Text>
                        {rate.notes ? <Text style={s.expandedNotes}>{rate.notes}</Text> : null}
                      </View>
                    )}
                  </View>
                );
              })}
              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
});

export default ProductivityCalculator;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.fillTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  backBtn: { marginBottom: 8 },
  backBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' as const },
  taskTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary,
    borderRadius: 12, paddingHorizontal: 12, gap: 8, height: 42, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  catScroll: { maxHeight: 40, marginBottom: 8 },
  catContent: { gap: 6, paddingRight: 16 },
  catChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.fillTertiary,
  },
  catChipActive: { backgroundColor: Colors.primary },
  catChipText: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary },
  catChipTextActive: { color: Colors.textOnPrimary },
  rateList: { flex: 1 },
  rateCard: {
    backgroundColor: Colors.surface, borderRadius: 12, marginBottom: 6,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const,
  },
  rateCardTop: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  rateInfo: { flex: 1, gap: 2 },
  rateName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  rateCrew: { fontSize: 11, color: Colors.textMuted },
  rateRight: { alignItems: 'flex-end' },
  rateUnitCost: { fontSize: 15, fontWeight: '700' as const, color: Colors.success },
  rateUnit: { fontSize: 10, color: Colors.textMuted },
  expandToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 8, gap: 6,
  },
  expandText: { fontSize: 11, color: Colors.info, fontWeight: '500' as const },
  expandedContent: {
    padding: 12, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surfaceAlt, gap: 4,
  },
  expandedRow: { fontSize: 11, color: Colors.textSecondary },
  expandedNotes: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' as const },
  crewCard: {
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14, gap: 10, marginBottom: 16,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crewLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  crewValue: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6 },
  qtyInput: {
    height: 52, backgroundColor: Colors.surface, borderRadius: 12, fontSize: 22,
    fontWeight: '700' as const, color: Colors.text, borderWidth: 1, borderColor: Colors.border, marginBottom: 16,
  },
  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 10,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  resultTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  costRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  costLabel: { fontSize: 14, color: Colors.textSecondary, width: 80 },
  costSub: { flex: 1, fontSize: 11, color: Colors.textMuted },
  costValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  divider: { height: 1, backgroundColor: Colors.borderLight },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  totalValue: { fontSize: 22, fontWeight: '800' as const, color: Colors.primary },
  scheduleCard: {
    backgroundColor: Colors.infoLight, borderRadius: 10, padding: 12, gap: 8,
  },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scheduleLabel: { fontSize: 12, color: Colors.info, fontWeight: '500' as const },
  scheduleValue: { fontSize: 12, fontWeight: '700' as const, color: Colors.info },
  notes: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, fontStyle: 'italic' as const },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  addBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
});

```

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Platform,
  FlatList,
  ViewToken,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  HardHat,
  Calculator,
  CalendarDays,
  Package,
  Gavel,
  Users,
  ArrowRight,
  CheckCircle,
  FileText,
  Receipt,
  BarChart3,
  Shield,
  Compass,
  MessageCircle,
  Camera,
  Briefcase,
  Home,
  Wrench,
  ClipboardList,
  TrendingUp,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  features: { icon: React.ReactNode; label: string; desc: string }[];
  accent: string;
  bg: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: 'welcome',
    title: 'Welcome to\nMAGE ID',
    subtitle: 'Your all-in-one construction management platform',
    features: [
      { icon: <Calculator size={20} color="#FFF" />, label: 'Cost Estimation', desc: 'Accurate material & labor pricing' },
      { icon: <CalendarDays size={20} color="#FFF" />, label: 'Schedule Builder', desc: 'Gantt charts & critical path' },
      { icon: <Gavel size={20} color="#FFF" />, label: 'Bid Marketplace', desc: 'Federal, community & homeowner bids' },
      { icon: <Users size={20} color="#FFF" />, label: 'Contractor Network', desc: 'Find & hire skilled professionals' },
    ],
    accent: '#1A6B3C',
    bg: '#1A6B3C',
  },
  {
    id: 'projects',
    title: 'Project\nManagement',
    subtitle: 'Create projects and manage every detail from one place',
    features: [
      { icon: <HardHat size={20} color="#FFF" />, label: 'Project Dashboard', desc: 'Track budgets, progress & deadlines' },
      { icon: <TrendingUp size={20} color="#FFF" />, label: 'Cash Flow Forecast', desc: 'Weekly projections & alerts' },
      { icon: <ClipboardList size={20} color="#FFF" />, label: 'Daily Reports', desc: 'Field logs with weather & photos' },
      { icon: <Camera size={20} color="#FFF" />, label: 'Photo Documentation', desc: 'Organize site photos by project' },
    ],
    accent: '#FF9500',
    bg: '#E08600',
  },
  {
    id: 'estimating',
    title: 'Smart\nEstimating',
    subtitle: 'Build accurate cost estimates with real pricing data',
    features: [
      { icon: <Package size={20} color="#FFF" />, label: 'Material Database', desc: '1000+ items with live pricing' },
      { icon: <Calculator size={20} color="#FFF" />, label: 'Line-Item Estimates', desc: 'Detailed cost breakdowns' },
      { icon: <BarChart3 size={20} color="#FFF" />, label: 'Bulk Discounts', desc: 'Auto-calculate volume savings' },
      { icon: <FileText size={20} color="#FFF" />, label: 'PDF Proposals', desc: 'Branded proposals with your logo' },
    ],
    accent: '#007AFF',
    bg: '#0055CC',
  },
  {
    id: 'scheduling',
    title: 'Schedule\nBuilder',
    subtitle: 'Plan timelines with professional Gantt charts',
    features: [
      { icon: <CalendarDays size={20} color="#FFF" />, label: 'Gantt Timeline', desc: 'Visual task & phase planning' },
      { icon: <Shield size={20} color="#FFF" />, label: 'Critical Path', desc: 'Identify schedule risks early' },
      { icon: <Wrench size={20} color="#FFF" />, label: 'WBS Structure', desc: 'Work Breakdown Structure editor' },
      { icon: <FileText size={20} color="#FFF" />, label: 'Landscape PDF', desc: 'Print-ready schedule exports' },
    ],
    accent: '#AF52DE',
    bg: '#8A2DB5',
  },
  {
    id: 'bids',
    title: 'Bid\nMarketplace',
    subtitle: 'Find work and win projects near you',
    features: [
      { icon: <Gavel size={20} color="#FFF" />, label: 'Federal Bids', desc: 'SAM.gov contracts synced daily' },
      { icon: <Home size={20} color="#FFF" />, label: 'Homeowner Requests', desc: 'Local renovation projects' },
      { icon: <Compass size={20} color="#FFF" />, label: 'Location Filtering', desc: 'GPS-based radius search' },
      { icon: <Briefcase size={20} color="#FFF" />, label: 'Community Posts', desc: 'Contractor-to-contractor work' },
    ],
    accent: '#1565C0',
    bg: '#0D47A1',
  },
  {
    id: 'documents',
    title: 'Documents\n& Invoicing',
    subtitle: 'Professional paperwork, automated and branded',
    features: [
      { icon: <Receipt size={20} color="#FFF" />, label: 'Invoicing', desc: 'Create, send & track payments' },
      { icon: <FileText size={20} color="#FFF" />, label: 'Change Orders', desc: 'Track scope changes with approvals' },
      { icon: <ClipboardList size={20} color="#FFF" />, label: 'Punch Lists', desc: 'QA checklists for closeout' },
      { icon: <MessageCircle size={20} color="#FFF" />, label: 'RFIs & Submittals', desc: 'Manage project communication' },
    ],
    accent: '#34C759',
    bg: '#28A745',
  },
  {
    id: 'network',
    title: 'Contractor\nNetwork',
    subtitle: 'Build your professional profile and get discovered',
    features: [
      { icon: <Users size={20} color="#FFF" />, label: 'Pro Profiles', desc: 'Showcase skills & certifications' },
      { icon: <HardHat size={20} color="#FFF" />, label: 'Job Listings', desc: 'Direct hire opportunities' },
      { icon: <MessageCircle size={20} color="#FFF" />, label: 'In-App Messaging', desc: 'Chat with clients & subs' },
      { icon: <Shield size={20} color="#FFF" />, label: 'Verified Badges', desc: 'Licensed & insured indicators' },
    ],
    accent: '#FF3B30',
    bg: '#CC2F26',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  const { completeOnboarding, hasSeenOnboarding } = useProjects();
  const isReplay = hasSeenOnboarding === true;

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const isLastSlide = currentIndex === SLIDES.length - 1;

  const handleFinish = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    if (isReplay) {
      router.back();
    } else {
      void completeOnboarding();
      router.replace('/(tabs)/(home)');
    }
  }, [router, completeOnboarding, isReplay]);

  const handleNext = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.92, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    if (isLastSlide) {
      handleFinish();
    } else {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    }
  }, [currentIndex, isLastSlide, buttonScale, handleFinish]);

  const handleSkip = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (isReplay) {
      router.back();
    } else {
      void completeOnboarding();
      router.replace('/(tabs)/(home)');
    }
  }, [router, completeOnboarding, isReplay]);

  const renderSlide = useCallback(({ item, index }: { item: OnboardingSlide; index: number }) => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];

    const contentOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    const contentTranslateY = scrollX.interpolate({
      inputRange,
      outputRange: [30, 0, -30],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
        <View style={[styles.slideBackground, { backgroundColor: item.bg }]}>
          <View style={styles.bgPattern}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.bgCircle,
                  {
                    width: 200 + i * 80,
                    height: 200 + i * 80,
                    borderRadius: 100 + i * 40,
                    opacity: 0.05 - i * 0.008,
                    top: SCREEN_HEIGHT * 0.08 - (i * 25),
                    left: SCREEN_WIDTH * 0.5 - (100 + i * 40),
                  },
                ]}
              />
            ))}
          </View>

          <ScrollView
            style={styles.slideScroll}
            contentContainerStyle={[styles.slideContent, { paddingTop: insets.top + 24 }]}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Animated.View
              style={{
                opacity: contentOpacity,
                transform: [{ translateY: contentTranslateY }],
                width: '100%',
              }}
            >
              <View style={styles.slideHeader}>
                <Text style={styles.stepLabel}>
                  {index + 1} of {SLIDES.length}
                </Text>
              </View>

              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideSubtitle}>{item.subtitle}</Text>

              <View style={styles.featureGrid}>
                {item.features.map((feature, fi) => (
                  <View key={fi} style={styles.featureCard}>
                    <View style={[styles.featureIconWrap, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                      {feature.icon}
                    </View>
                    <View style={styles.featureTextWrap}>
                      <Text style={styles.featureLabel}>{feature.label}</Text>
                      <Text style={styles.featureDesc}>{feature.desc}</Text>
                    </View>
                  </View>
                ))}
              </View>

              {index === 0 && (
                <View style={styles.welcomeExtras}>
                  <View style={styles.welcomeDivider} />
                  <Text style={styles.welcomeTagline}>
                    Built for contractors, by contractors
                  </Text>
                  <View style={styles.highlightRow}>
                    {['Free to start', 'No spam calls', 'GPS-based'].map((tag, ti) => (
                      <View key={ti} style={styles.highlightTag}>
                        <CheckCircle size={12} color="rgba(255,255,255,0.9)" />
                        <Text style={styles.highlightTagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Animated.View>
          </ScrollView>
        </View>
      </View>
    );
  }, [scrollX, insets.top]);

  return (
    <View style={styles.container}>
      <Animated.FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true }
        )}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.paginationRow}>
          {SLIDES.map((slide, i) => {
            const inputRange = [
              (i - 1) * SCREEN_WIDTH,
              i * SCREEN_WIDTH,
              (i + 1) * SCREEN_WIDTH,
            ];

            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 24, 8],
              extrapolate: 'clamp',
            });

            const dotOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.35, 1, 0.35],
              extrapolate: 'clamp',
            });

            return (
              <Animated.View
                key={slide.id}
                style={[
                  styles.dot,
                  {
                    width: dotWidth,
                    opacity: dotOpacity,
                    backgroundColor: '#FFFFFF',
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.buttonRow}>
          {!isLastSlide && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
              activeOpacity={0.7}
              testID="onboarding-skip"
            >
              <Text style={styles.skipText}>{isReplay ? 'Close' : 'Skip'}</Text>
            </TouchableOpacity>
          )}

          <Animated.View style={{ transform: [{ scale: buttonScale }], flex: isLastSlide ? 1 : undefined }}>
            <TouchableOpacity
              style={[
                styles.nextButton,
                isLastSlide && styles.getStartedButton,
              ]}
              onPress={handleNext}
              activeOpacity={0.85}
              testID="onboarding-next"
            >
              <Text style={[styles.nextButtonText, isLastSlide && styles.getStartedText]}>
                {isLastSlide ? (isReplay ? 'Back to App' : "Let's Build") : 'Next'}
              </Text>
              {!isLastSlide && (
                <ArrowRight size={18} color="#FFFFFF" strokeWidth={2.5} />
              )}
              {isLastSlide && (
                <HardHat size={20} color={Colors.primary} strokeWidth={2} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  slide: {
    flex: 1,
  },
  slideBackground: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  bgPattern: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgCircle: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
  },
  slideScroll: {
    flex: 1,
  },
  slideContent: {
    paddingHorizontal: 24,
    paddingBottom: 160,
  },
  slideHeader: {
    marginBottom: 16,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  slideTitle: {
    fontSize: 38,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -1,
    marginBottom: 10,
    lineHeight: 44,
  },
  slideSubtitle: {
    fontSize: 16,
    fontWeight: '400' as const,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
    marginBottom: 28,
  },
  featureGrid: {
    gap: 12,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTextWrap: {
    flex: 1,
    gap: 2,
  },
  featureLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  featureDesc: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 17,
  },
  welcomeExtras: {
    marginTop: 24,
    alignItems: 'center',
  },
  welcomeDivider: {
    width: 40,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 1,
    marginBottom: 16,
  },
  welcomeTagline: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500' as const,
    marginBottom: 14,
  },
  highlightRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  highlightTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  highlightTagText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600' as const,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  skipButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  skipText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.7)',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  nextButtonText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  getStartedButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  getStartedText: {
    color: Colors.primary,
  },
});


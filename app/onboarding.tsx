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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  HardHat,
  Calculator,
  CalendarDays,
  Package,
  Share2,
  Users,
  ArrowRight,
  CheckCircle,
  Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface OnboardingSlide {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  accent: string;
  bgGradientTop: string;
  bgGradientBottom: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: 'welcome',
    title: 'MAGE ID',
    subtitle: 'Your Construction Command Center',
    description: 'Estimate costs, build schedules, manage materials, and collaborate with your team — all in one powerful app.',
    icon: <HardHat size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#1A6B3C',
    bgGradientTop: '#1A6B3C',
    bgGradientBottom: '#0F4526',
  },
  {
    id: 'projects',
    title: 'Create Projects',
    subtitle: 'Organize Everything',
    description: 'Start by creating a project — name it, describe it, and choose the type. Everything from estimates to schedules lives inside your project.',
    icon: <Sparkles size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#FF9500',
    bgGradientTop: '#FF9500',
    bgGradientBottom: '#E08600',
  },
  {
    id: 'estimate',
    title: 'Smart Estimates',
    subtitle: 'Accurate Cost Breakdowns',
    description: 'Browse materials, add quantities, and get instant pricing with bulk savings. Link estimates directly to your projects for a complete picture.',
    icon: <Calculator size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#007AFF',
    bgGradientTop: '#007AFF',
    bgGradientBottom: '#0055CC',
  },
  {
    id: 'schedule',
    title: 'BW Schedule Maker',
    subtitle: 'Plan Like a Pro',
    description: 'Build timelines with tasks, milestones, critical path analysis, and work breakdown structures. Visualize your entire project on an interactive timeline.',
    icon: <CalendarDays size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#AF52DE',
    bgGradientTop: '#AF52DE',
    bgGradientBottom: '#8A2DB5',
  },
  {
    id: 'materials',
    title: 'Material Pricing',
    subtitle: 'Real Costs at Your Fingertips',
    description: 'Access a comprehensive material database with retail and bulk pricing. Compare suppliers and find savings across categories.',
    icon: <Package size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#FF3B30',
    bgGradientTop: '#FF3B30',
    bgGradientBottom: '#CC2F26',
  },
  {
    id: 'share',
    title: 'Share & Collaborate',
    subtitle: 'Work Together Seamlessly',
    description: 'Generate professional PDFs with your company logo and signature. Share via email or text, and invite team members to collaborate on projects.',
    icon: <Share2 size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#34C759',
    bgGradientTop: '#34C759',
    bgGradientBottom: '#28A745',
  },
  {
    id: 'settings',
    title: 'Make It Yours',
    subtitle: 'Company Branding & Settings',
    description: 'Upload your logo, draw your signature, and customize tax rates and contingency. Every PDF you generate will carry your professional brand.',
    icon: <Users size={56} color="#FFFFFF" strokeWidth={1.6} />,
    accent: '#5856D6',
    bgGradientTop: '#5856D6',
    bgGradientBottom: '#4240AB',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const iconAnim = useRef(new Animated.Value(0)).current;

  const startIconPulse = useCallback(() => {
    iconAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(iconAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(iconAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [iconAnim]);

  React.useEffect(() => {
    startIconPulse();
  }, [startIconPulse]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const isLastSlide = currentIndex === SLIDES.length - 1;

  const { completeOnboarding } = useProjects();

  const handleFinish = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    void completeOnboarding();
    router.replace('/(tabs)/(home)');
  }, [router, completeOnboarding]);

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
    void completeOnboarding();
    router.replace('/(tabs)/(home)');
  }, [router, completeOnboarding]);

  const iconScale = iconAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  const renderSlide = useCallback(({ item, index }: { item: OnboardingSlide; index: number }) => {
    const inputRange = [
      (index - 1) * SCREEN_WIDTH,
      index * SCREEN_WIDTH,
      (index + 1) * SCREEN_WIDTH,
    ];

    const titleOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    const titleTranslateY = scrollX.interpolate({
      inputRange,
      outputRange: [40, 0, -40],
      extrapolate: 'clamp',
    });

    const descOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    const descTranslateY = scrollX.interpolate({
      inputRange,
      outputRange: [60, 0, -60],
      extrapolate: 'clamp',
    });

    const iconOpacity = scrollX.interpolate({
      inputRange,
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });

    return (
      <View style={[styles.slide, { width: SCREEN_WIDTH }]}>
        <View style={[styles.slideBackground, { backgroundColor: item.bgGradientTop }]}>
          <View style={styles.bgPattern}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.bgCircle,
                  {
                    width: 120 + i * 60,
                    height: 120 + i * 60,
                    borderRadius: 60 + i * 30,
                    opacity: 0.06 - i * 0.008,
                    top: SCREEN_HEIGHT * 0.15 - (i * 30),
                    left: SCREEN_WIDTH * 0.5 - (60 + i * 30),
                  },
                ]}
              />
            ))}
          </View>

          <View style={[styles.slideContent, { paddingTop: insets.top + 80 }]}>
            <Animated.View
              style={[
                styles.iconContainer,
                {
                  opacity: iconOpacity,
                  transform: [{ scale: iconScale }],
                  backgroundColor: 'rgba(255,255,255,0.15)',
                },
              ]}
            >
              {item.icon}
            </Animated.View>

            <Animated.View
              style={{
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslateY }],
              }}
            >
              <Text style={styles.slideTitle}>{item.title}</Text>
              <Text style={styles.slideSubtitle}>{item.subtitle}</Text>
            </Animated.View>

            <Animated.View
              style={[
                styles.descriptionCard,
                {
                  opacity: descOpacity,
                  transform: [{ translateY: descTranslateY }],
                },
              ]}
            >
              <Text style={styles.slideDescription}>{item.description}</Text>
            </Animated.View>

            {index === 0 && (
              <Animated.View style={[styles.featureList, { opacity: descOpacity }]}>
                {[
                  'Cost estimation with bulk pricing',
                  'Interactive schedule timelines',
                  'Professional PDF generation',
                  'Team collaboration tools',
                ].map((feature, fi) => (
                  <View key={fi} style={styles.featureItem}>
                    <CheckCircle size={16} color="rgba(255,255,255,0.9)" strokeWidth={2} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </Animated.View>
            )}
          </View>
        </View>
      </View>
    );
  }, [scrollX, iconScale, insets.top]);

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

      <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.paginationRow}>
          {SLIDES.map((slide, i) => {
            const inputRange = [
              (i - 1) * SCREEN_WIDTH,
              i * SCREEN_WIDTH,
              (i + 1) * SCREEN_WIDTH,
            ];

            const dotScale = scrollX.interpolate({
              inputRange,
              outputRange: [1, 3.5, 1],
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
                    transform: [{ scaleX: dotScale }],
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
              <Text style={styles.skipText}>Skip</Text>
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
                {isLastSlide ? "Let's Build" : 'Next'}
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
  slideContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  slideTitle: {
    fontSize: 36,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  slideSubtitle: {
    fontSize: 17,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    letterSpacing: 0.3,
    marginBottom: 28,
  },
  descriptionCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  slideDescription: {
    fontSize: 16,
    lineHeight: 24,
    color: 'rgba(255,255,255,0.92)',
    textAlign: 'center',
    fontWeight: '400' as const,
  },
  featureList: {
    marginTop: 28,
    width: '100%',
    gap: 14,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 8,
  },
  featureText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '500' as const,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 24,
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

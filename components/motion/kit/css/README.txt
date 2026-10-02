components/motion/kit/css — the motion kit's web keyframes (lane MOTIONKIT)
==========================================================================

kitCss.ts is the ONLY file in the kit that may hold `animationKeyframes`
(scripts/validate-motion-kit.ts K4.9; scripts/validate-motion.ts rule 4 allows
this folder next to components/ui/motion.ts and components/loaders/css/).

The rules — the same ones components/loaders/css/README.txt and
components/ui/motion.ts (the "Web CSS motion" block) learned the hard way:

1. Keyframes compile ONLY through StyleSheet.create. An inline style object
   that carries animationKeyframes is silently dropped by react-native-web.
2. Every animationDuration / animationDelay is a STRING ending in 'ms'
   ('35ms'). A bare number becomes px and the animation silently runs 0 s.
3. Every keyframe transform is a STRING ('translateY(8px) scale(0.98)').
4. Keyframes animate `transform` and `opacity` ONLY (the compositor's two
   properties). Never width / height / position / margin / colour / filter.
5. Fill mode 'backwards' only — never 'forwards' or 'both'. The end state is
   the element's own style, so nothing is retained after the run: a transform
   left at translate(0) would re-root every position:fixed child (menus,
   toasts, sheets). A LEAVING animation (rollOut6, kitFadeOut) therefore sits
   on an element whose own style is already opacity 0.
6. Restart an animation on the SAME element by switching to its byte-different
   twin (rise8 / rise8B, fade / fadeB): react-native-web names a keyframe
   from its content, so identical keyframes share one name and never restart.
7. A part that also renders in a phone-web golden gates its CSS on
   useIsDesktopWeb() (useEntrance's desktopWebOnly), never on Platform.OS
   alone. A first render never carries a kit class (nothing is armed at mount
   unless a live event armed it).
8. Under prefers-reduced-motion: reduce the kit returns NO class at all; the
   content simply appears in its final state.

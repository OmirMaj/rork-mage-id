import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { AlertTriangle } from "lucide-react-native";
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function NotFoundScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <AlertTriangle size={32} color={themeColors.accent} strokeWidth={1.75} />
        </View>
        <Text style={styles.title}>Page Not Found</Text>
        <Text style={styles.subtitle}>This screen doesn&apos;t exist.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to Home</Text>
        </Link>
      </View>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: t.bg,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: t.warningSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: Type.title2.fontSize,
    fontWeight: "700",
    color: t.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
    marginBottom: 24,
  },
  link: {
    backgroundColor: t.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: Tokens.radius.card,
  },
  linkText: {
    fontSize: Type.callout.fontSize,
    fontWeight: "600",
    color: '#FFFFFF',
  },
});

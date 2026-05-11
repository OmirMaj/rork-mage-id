import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/constants/colors";
import { AlertTriangle } from "lucide-react-native";
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not Found" }} />
      <View style={styles.container}>
        <View style={styles.iconContainer}>
          <AlertTriangle size={32} color={Colors.accent} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Tokens.spacing.lg,
    backgroundColor: Colors.background,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: Colors.warningLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Tokens.spacing.md,
  },
  title: {
    fontSize: Type.title2.fontSize,
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: Type.subhead.fontSize,
    color: Colors.textSecondary,
    marginBottom: Tokens.spacing.xl,
  },
  link: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Tokens.spacing.xl,
    paddingVertical: 14,
    borderRadius: Tokens.radius.card,
  },
  linkText: {
    fontSize: Type.callout.fontSize,
    fontWeight: "600",
    color: Colors.textOnPrimary,
  },
});

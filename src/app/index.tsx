import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { supabase } from "../lib/supabase";

type AuthMode = "signin" | "signup";

export default function HomeScreen() {
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [activeTab, setActiveTab] = useState<"home" | "talk" | "health" | "insights" | "me">("home");
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aprilResponse, setAprilResponse] = useState("");

  const pulse = useRef(new Animated.Value(1)).current;
  const latestTranscript = useRef("");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionUser(data.session?.user ?? null);
      setSessionReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSessionUser(nextSession?.user ?? null);
      setSessionReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionUser) {
      setProfileReady(false);
      setNeedsOnboarding(false);
      return;
    }

    let mounted = true;

    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, date_of_birth, preferred_language, voice_preference")
        .eq("id", sessionUser.id)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        console.log("APRIL profile lookup error:", error.message);
        setProfileReady(true);
        setNeedsOnboarding(true);
        return;
      }

      setProfileName(data?.display_name ?? "");
      setNeedsOnboarding(!data);
      setProfileReady(true);
    };

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [sessionUser]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: isListening ? 1.08 : 1.03,
          duration: isListening ? 900 : 1800,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: isListening ? 900 : 1800,
          useNativeDriver: false,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [isListening, pulse]);

  useSpeechRecognitionEvent("start", () => {
    setIsListening(true);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript ?? "";
    latestTranscript.current = text;
    setTranscript(text);
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);

    if (latestTranscript.current.trim()) {
      setAprilResponse("Thank you for telling me. I’m here to listen.");
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.log("Speech recognition error:", event.error);
    setIsListening(false);
  });

  const handleAuth = async () => {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      setAuthMessage("Please enter your email and password.");
      return;
    }

    if (authMode === "signup" && !displayName.trim()) {
      setAuthMessage("Please tell me what you’d like me to call you.");
      return;
    }

    setAuthBusy(true);
    setAuthMessage("");

    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      });

      if (error) {
        setAuthMessage(error.message);
        setAuthBusy(false);
        return;
      }

      if (data.user && data.session) {
        const { error: profileError } = await supabase.from("profiles").insert({
          id: data.user.id,
          display_name: displayName.trim(),
          preferred_language: "en",
          voice_preference: "calm",
        });

        if (profileError) {
          console.log("APRIL profile creation error:", profileError.message);
        }
      }

      setAuthMessage(
        data.session
          ? "Your APRIL account is ready."
          : "Check your email to confirm your account, then come back to sign in."
      );
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        setAuthMessage(error.message);
      }
    }

    setAuthBusy(false);
  };

  const finishOnboarding = async () => {
    if (!sessionUser || !displayName.trim()) {
      setAuthMessage("Please tell me what you’d like me to call you.");
      return;
    }

    setAuthBusy(true);
    setAuthMessage("");

    const { error } = await supabase.from("profiles").upsert({
      id: sessionUser.id,
      display_name: displayName.trim(),
      preferred_language: "en",
      voice_preference: "calm",
    });

    if (error) {
      setAuthMessage(error.message);
      setAuthBusy(false);
      return;
    }

    setProfileName(displayName.trim());
    setNeedsOnboarding(false);
    setAuthBusy(false);
  };

  const startListening = async () => {
    const permission =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Microphone permission needed",
        "APRIL needs microphone access when you choose to talk."
      );
      return;
    }

    setTranscript("");
    setAprilResponse("");
    latestTranscript.current = "";

    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
    });
  };

  const stopListening = () => {
    ExpoSpeechRecognitionModule.stop();
  };

  const handleTalk = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  if (!sessionReady || (sessionUser && !profileReady)) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#E8A33D" />
          <Text style={styles.loadingText}>Preparing APRIL…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!sessionUser) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.authContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.authLogo}>APRIL</Text>

            <View style={styles.authCompanion}>
              <View style={styles.authCore} />
              <View style={styles.authEyeRow}>
                <View style={styles.authEye} />
                <View style={styles.authEye} />
              </View>
            </View>

            <Text style={styles.authTitle}>
              {authMode === "signin"
                ? "Welcome back."
                : "Let’s get started."}
            </Text>

            <Text style={styles.authSubtitle}>
              Your personal health & wellbeing companion.
            </Text>

            {authMode === "signup" && (
              <TextInput
                style={styles.input}
                placeholder="What should I call you?"
                placeholderTextColor="#777D89"
                value={displayName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
            )}

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#777D89"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#777D89"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            {authMessage ? (
              <Text style={styles.authMessage}>{authMessage}</Text>
            ) : null}

            <Pressable
              style={[styles.button, authBusy && styles.buttonDisabled]}
              onPress={handleAuth}
              disabled={authBusy}
            >
              {authBusy ? (
                <ActivityIndicator color="#0B0E14" />
              ) : (
                <Text style={styles.buttonText}>
                  {authMode === "signin" ? "Sign in" : "Create my account"}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={styles.switchButton}
              onPress={() => {
                setAuthMode(authMode === "signin" ? "signup" : "signin");
                setAuthMessage("");
              }}
            >
              <Text style={styles.switchText}>
                {authMode === "signin"
                  ? "New to APRIL? Create an account"
                  : "Already have an account? Sign in"}
              </Text>
            </Pressable>

            <Text style={styles.privacyNote}>
              Your health information is private and belongs to you. APRIL is
              designed to support your wellbeing, not replace a healthcare
              professional.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (needsOnboarding) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.authContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.authLogo}>APRIL</Text>
            <Text style={styles.authTitle}>A little about you.</Text>
            <Text style={styles.authSubtitle}>
              We’ll keep this simple. You’re in control of what you share.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="What should I call you?"
              placeholderTextColor="#777D89"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
            />

            {authMessage ? (
              <Text style={styles.authMessage}>{authMessage}</Text>
            ) : null}

            <Pressable
              style={[styles.button, authBusy && styles.buttonDisabled]}
              onPress={finishOnboarding}
              disabled={authBusy}
            >
              {authBusy ? (
                <ActivityIndicator color="#0B0E14" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </Pressable>

            <Text style={styles.privacyNote}>
              We’ll ask for other health information only when it becomes
              useful, rather than making you fill out a long medical form.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const renderHome = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent}>
      <View style={styles.dashboardHeader}>
        <View>
          <Text style={styles.eyebrow}>TODAY</Text>
          <Text style={styles.greeting}>Hi{profileName ? `, ${profileName}` : ""}.</Text>
        </View>
        <View style={styles.statusDot} />
      </View>

      <Text style={styles.question}>How are you feeling today?</Text>
      <Text style={styles.dashboardSubtitle}>
        You don’t have to fill anything out. Just talk to APRIL.
      </Text>

      <Pressable style={styles.talkCard} onPress={() => setActiveTab("talk")}>
        <View style={styles.smallCompanion}>
          <View style={styles.smallEyeRow}>
            <View style={styles.smallEye} />
            <View style={styles.smallEye} />
          </View>
        </View>
        <View style={styles.talkCardText}>
          <Text style={styles.talkCardTitle}>Talk to me</Text>
          <Text style={styles.talkCardSubtitle}>Tell me how you’re doing.</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Today</Text>
        <Text style={styles.sectionHint}>Your health, at a glance</Text>
      </View>

      <View style={styles.snapshotRow}>
        <View style={styles.snapshotCard}>
          <Text style={styles.snapshotIcon}>◷</Text>
          <Text style={styles.snapshotTitle}>Sleep</Text>
          <Text style={styles.snapshotValue}>Not recorded</Text>
        </View>
        <View style={styles.snapshotCard}>
          <Text style={styles.snapshotIcon}>✦</Text>
          <Text style={styles.snapshotTitle}>Energy</Text>
          <Text style={styles.snapshotValue}>Not recorded</Text>
        </View>
      </View>

      <Pressable style={styles.checkInCard} onPress={() => setActiveTab("talk")}>
        <View>
          <Text style={styles.checkInLabel}>DAILY CHECK-IN</Text>
          <Text style={styles.checkInTitle}>Take a moment for yourself.</Text>
          <Text style={styles.checkInSubtitle}>
            A short conversation can help you notice how you’re doing.
          </Text>
        </View>
        <Text style={styles.checkInArrow}>→</Text>
      </Pressable>

      <View style={styles.insightCard}>
        <Text style={styles.insightLabel}>APRIL’S NOTE</Text>
        <Text style={styles.insightText}>
          As you use APRIL, I’ll help you notice changes from your own baseline — not compare you to someone else.
        </Text>
      </View>
    </ScrollView>
  );

  const renderTalk = () => (
    <ScrollView contentContainerStyle={styles.talkContent}>
      <Text style={styles.screenEyebrow}>TALK</Text>
      <Text style={styles.screenTitle}>I’m here.</Text>
      <Text style={styles.screenSubtitle}>
        Tell me what’s on your mind or how you’re feeling.
      </Text>

      <Animated.View
        style={[styles.companionGlow, { transform: [{ scale: pulse }] }]}
      >
        <View style={styles.companion}>
          <View style={styles.eyes}>
            <View style={styles.eye} />
            <View style={styles.eye} />
          </View>
          <View style={[styles.mouth, isListening && styles.listeningMouth]} />
        </View>
      </Animated.View>

      {transcript.length > 0 && (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>I heard:</Text>
          <Text style={styles.transcript}>{transcript}</Text>
        </View>
      )}

      {aprilResponse.length > 0 && (
        <View style={styles.responseBox}>
          <Text style={styles.responseLabel}>APRIL</Text>
          <Text style={styles.response}>{aprilResponse}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={handleTalk}
      >
        <Text style={styles.buttonText}>{isListening ? "I’m done" : "Talk to me"}</Text>
      </Pressable>
    </ScrollView>
  );

  const renderHealth = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent}>
      <Text style={styles.screenEyebrow}>MY HEALTH</Text>
      <Text style={styles.screenTitle}>Your story, over time.</Text>
      <Text style={styles.screenSubtitle}>
        Things you choose to record will appear here in chronological order.
      </Text>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Nothing recorded yet.</Text>
        <Text style={styles.emptyText}>
          Start with a conversation. APRIL can turn what you tell her into useful health records you can review later.
        </Text>
        <Pressable style={styles.secondaryButton} onPress={() => setActiveTab("talk")}>
          <Text style={styles.secondaryButtonText}>Start a conversation</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const renderInsights = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent}>
      <Text style={styles.screenEyebrow}>INSIGHTS</Text>
      <Text style={styles.screenTitle}>Patterns, not diagnoses.</Text>
      <Text style={styles.screenSubtitle}>
        APRIL will only show observations based on information you’ve recorded.
      </Text>
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Your baseline is just beginning.</Text>
        <Text style={styles.emptyText}>
          After you’ve shared enough information, APRIL can help you notice changes in sleep, energy, mood and other areas you choose to track.
        </Text>
      </View>
    </ScrollView>
  );

  const renderMe = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent}>
      <Text style={styles.screenEyebrow}>ME</Text>
      <Text style={styles.screenTitle}>You’re in control.</Text>
      <Text style={styles.screenSubtitle}>
        Manage your account, preferences and privacy.
      </Text>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>ACCOUNT</Text>
        <Text style={styles.settingValue}>{sessionUser.email}</Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>COMPANION</Text>
        <Text style={styles.settingValue}>Calm voice · English</Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>PRIVACY</Text>
        <Text style={styles.settingValue}>Your health information belongs to you.</Text>
      </View>

      <Pressable style={styles.signOutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );

  const renderActiveScreen = () => {
    if (activeTab === "home") return renderHome();
    if (activeTab === "talk") return renderTalk();
    if (activeTab === "health") return renderHealth();
    if (activeTab === "insights") return renderInsights();
    return renderMe();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appShell}>
        {renderActiveScreen()}
        <View style={styles.tabBar}>
          {[
            ["home", "Home"],
            ["talk", "Talk"],
            ["health", "My Health"],
            ["insights", "Insights"],
            ["me", "Me"],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              style={styles.tab}
              onPress={() => setActiveTab(key as typeof activeTab)}
            >
              <View style={[styles.tabMark, activeTab === key && styles.tabMarkActive]} />
              <Text style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
        <Text style={styles.logo}>APRIL</Text>

        <Animated.View
          style={[
            styles.companionGlow,
            { transform: [{ scale: pulse }] },
          ]}
        >
          <View style={styles.companion}>
            <View style={styles.eyes}>
              <View style={styles.eye} />
              <View style={styles.eye} />
            </View>

            <View
              style={[
                styles.mouth,
                isListening && styles.listeningMouth,
              ]}
            />
          </View>
        </Animated.View>

        <Text style={styles.title}>
          {isListening ? "I’m listening." : "How are you feeling today?"}
        </Text>

        <Text style={styles.subtitle}>
          {isListening
            ? "Take your time. I’m here."
            : "Your personal health & wellbeing companion."}
        </Text>

        {transcript.length > 0 && (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>I heard:</Text>
            <Text style={styles.transcript}>{transcript}</Text>
          </View>
        )}

        {aprilResponse.length > 0 && (
          <View style={styles.responseBox}>
            <Text style={styles.responseLabel}>APRIL</Text>
            <Text style={styles.response}>{aprilResponse}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleTalk}
        >
          <Text style={styles.buttonText}>
            {isListening ? "I’m done" : "Talk to me"}
          </Text>
        </Pressable>

        <Pressable
          style={styles.signOutButton}
          onPress={() => supabase.auth.signOut()}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#0B0E14" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#A7ACB8", marginTop: 14, fontSize: 15 },

  authContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 26,
    paddingVertical: 50,
  },

  authLogo: {
    color: "#E8A33D",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 5,
    textAlign: "center",
    marginBottom: 34,
  },

  authCompanion: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(232,163,61,0.13)",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },

  authCore: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#E8A33D",
    opacity: 0.9,
  },

  authEyeRow: {
    flexDirection: "row",
    gap: 18,
  },

  authEye: {
    width: 8,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#0B0E14",
  },

  authTitle: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 10,
  },

  authSubtitle: {
    color: "#A7ACB8",
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    marginBottom: 28,
  },

  input: {
    width: "100%",
    backgroundColor: "#151A24",
    borderWidth: 1,
    borderColor: "#252C39",
    borderRadius: 16,
    color: "#FFFFFF",
    fontSize: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 12,
  },

  authMessage: {
    color: "#E8A33D",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginVertical: 10,
  },

  button: {
    backgroundColor: "#E8A33D",
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 30,
    minWidth: 150,
    alignItems: "center",
    marginTop: 6,
  },

  buttonDisabled: { opacity: 0.65 },

  buttonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },

  buttonText: {
    color: "#0B0E14",
    fontSize: 16,
    fontWeight: "700",
  },

  switchButton: {
    alignItems: "center",
    paddingVertical: 18,
  },

  switchText: {
    color: "#D5A75D",
    fontSize: 14,
    textAlign: "center",
  },

  privacyNote: {
    color: "#777D89",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 14,
  },

  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },

  logo: {
    position: "absolute",
    top: 40,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 4,
    color: "#E8A33D",
  },

  companionGlow: {
    width: 190,
    height: 190,
    borderRadius: 95,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(232, 163, 61, 0.12)",
    marginBottom: 42,
  },

  companion: {
    width: 145,
    height: 145,
    borderRadius: 72,
    backgroundColor: "#E8A33D",
    alignItems: "center",
    justifyContent: "center",
  },

  eyes: { flexDirection: "row", gap: 32, marginBottom: 20 },

  eye: {
    width: 14,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#0B0E14",
  },

  mouth: {
    width: 28,
    height: 10,
    borderRadius: 10,
    backgroundColor: "#0B0E14",
  },

  listeningMouth: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },

  title: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
  },

  subtitle: {
    color: "#A7ACB8",
    fontSize: 16,
    textAlign: "center",
    lineHeight: 24,
    maxWidth: 340,
    marginBottom: 24,
  },

  transcriptBox: {
    width: "100%",
    maxWidth: 420,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#151A24",
    marginBottom: 16,
  },

  transcriptLabel: {
    color: "#E8A33D",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },

  transcript: { color: "#FFFFFF", fontSize: 17, lineHeight: 25 },

  responseBox: {
    width: "100%",
    maxWidth: 420,
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#1B202C",
    marginBottom: 24,
  },

  responseLabel: {
    color: "#E8A33D",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },

  response: { color: "#FFFFFF", fontSize: 17, lineHeight: 25 },

  signOutButton: { marginTop: 18, padding: 10, alignItems: "center" },
  signOutText: { color: "#777D89", fontSize: 13 },

  appShell: { flex: 1 },

  dashboardContent: {
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 110,
  },

  dashboardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
  },

  eyebrow: { color: "#777D89", fontSize: 11, fontWeight: "700", letterSpacing: 2 },

  greeting: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "600",
    marginTop: 5,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#8ED6B1",
  },

  question: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "600",
    lineHeight: 34,
    marginBottom: 8,
  },

  dashboardSubtitle: {
    color: "#A7ACB8",
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 22,
  },

  talkCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#171D28",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#252C39",
  },

  smallCompanion: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#E8A33D",
    alignItems: "center",
    justifyContent: "center",
  },

  smallEyeRow: { flexDirection: "row", gap: 10 },

  smallEye: {
    width: 7,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0B0E14",
  },

  talkCardText: { flex: 1, marginLeft: 15 },

  talkCardTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },

  talkCardSubtitle: { color: "#A7ACB8", fontSize: 13, marginTop: 4 },

  chevron: { color: "#E8A33D", fontSize: 28, marginLeft: 8 },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: 30,
    marginBottom: 12,
  },

  sectionTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" },

  sectionHint: { color: "#777D89", fontSize: 12 },

  snapshotRow: { flexDirection: "row", gap: 12 },

  snapshotCard: {
    flex: 1,
    backgroundColor: "#151A24",
    borderRadius: 18,
    padding: 16,
    minHeight: 112,
  },

  snapshotIcon: { color: "#E8A33D", fontSize: 19, marginBottom: 10 },

  snapshotTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },

  snapshotValue: { color: "#777D89", fontSize: 12, marginTop: 8 },

  checkInCard: {
    backgroundColor: "#211F1A",
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
  },

  checkInLabel: { color: "#E8A33D", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },

  checkInTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600", marginTop: 7 },

  checkInSubtitle: { color: "#A7ACB8", fontSize: 12, lineHeight: 18, marginTop: 5, paddingRight: 12 },

  checkInArrow: { color: "#E8A33D", fontSize: 24 },

  insightCard: {
    backgroundColor: "#151A24",
    borderRadius: 20,
    padding: 18,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#252C39",
  },

  insightLabel: { color: "#B9A8D8", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },

  insightText: { color: "#D9DCE3", fontSize: 14, lineHeight: 21, marginTop: 8 },

  screenEyebrow: { color: "#777D89", fontSize: 11, fontWeight: "700", letterSpacing: 2, marginBottom: 8 },

  screenTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "600", lineHeight: 34, marginBottom: 8 },

  screenSubtitle: { color: "#A7ACB8", fontSize: 15, lineHeight: 23, marginBottom: 28 },

  talkContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 110,
  },

  emptyCard: {
    backgroundColor: "#151A24",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#252C39",
  },

  emptyTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600", marginBottom: 8 },

  emptyText: { color: "#A7ACB8", fontSize: 14, lineHeight: 22 },

  secondaryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#252C39",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 22,
    marginTop: 18,
  },

  secondaryButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },

  settingsCard: {
    backgroundColor: "#151A24",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#252C39",
  },

  settingLabel: { color: "#777D89", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },

  settingValue: { color: "#FFFFFF", fontSize: 15, marginTop: 8 },

  tabBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 10,
    height: 72,
    borderRadius: 24,
    backgroundColor: "#151A24",
    borderWidth: 1,
    borderColor: "#252C39",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 4,
  },

  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 5 },

  tabMark: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#4C5360",
  },

  tabMarkActive: { width: 18, backgroundColor: "#E8A33D" },

  tabLabel: { color: "#777D89", fontSize: 10 },

  tabLabelActive: { color: "#FFFFFF", fontWeight: "600" },
});

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
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

  signOutButton: { marginTop: 18, padding: 10 },
  signOutText: { color: "#777D89", fontSize: 13 },
});

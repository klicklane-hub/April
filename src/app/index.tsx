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
  const [activeTab, setActiveTab] = useState<"home" | "talk" | "health" | "insights" | "me" | "checkin">("home");
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
  const [talkStatus, setTalkStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [talkError, setTalkError] = useState(false);
  const [checkInStep, setCheckInStep] = useState(0);
  const [checkInAnswers, setCheckInAnswers] = useState({ overallFeeling: "", sleepHours: "", energyLevel: "", emotionalState: "", physicalConcerns: "" });
  const [checkInSaving, setCheckInSaving] = useState(false);
  const [checkInComplete, setCheckInComplete] = useState(false);
  const [checkInMessage, setCheckInMessage] = useState("");
  const [checkInSaveFailed, setCheckInSaveFailed] = useState(false);
  const [checkInVoiceError, setCheckInVoiceError] = useState(false);
  const [todayCheckIn, setTodayCheckIn] = useState<any>(null);
  const [checkInContextNote, setCheckInContextNote] = useState("");
  const [healthEntries, setHealthEntries] = useState<any[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthLoadError, setHealthLoadError] = useState(false);
  const [todayCheckInLoadError, setTodayCheckInLoadError] = useState(false);
  const [healthFilter, setHealthFilter] = useState<"all" | "sleep" | "energy" | "mood" | "symptom">("all");
  const [editingName, setEditingName] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMessage, setNameMessage] = useState("");

  const pulse = useRef(new Animated.Value(1)).current;
  const latestTranscript = useRef("");
  const talkContext = useRef<{ role: string; content: string }[]>([]);
  const checkInVoiceActive = useRef(false);
  const checkInFlowActive = useRef(false);
  const talkFlowActive = useRef(false);
  const suppressSpeechEnd = useRef(false);
  const checkInStepRef = useRef(0);

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
    checkInStepRef.current = checkInStep;
  }, [checkInStep]);

  const loadHealthData = async () => {
    if (!sessionUser) return;
    setHealthLoading(true);
    setHealthLoadError(false);
    setTodayCheckInLoadError(false);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data: checkIn, error: checkInError } = await supabase
      .from("check_ins")
      .select("id, overall_feeling, sleep_hours, energy_level, emotional_state, physical_concerns, checked_in_at")
      .eq("user_id", sessionUser.id)
      .gte("checked_in_at", start.toISOString())
      .order("checked_in_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (checkInError) {
      console.log("APRIL today check-in load error:", checkInError.message);
      setTodayCheckInLoadError(true);
    } else {
      setTodayCheckIn(checkIn ?? null);
    }
    const { data: entries, error: entriesError } = await supabase
      .from("health_entries")
      .select("id, category, title, content, severity, occurred_at, created_at")
      .eq("user_id", sessionUser.id)
      .order("occurred_at", { ascending: false })
      .limit(30);
    if (entriesError) {
      console.log("APRIL health story load error:", entriesError.message);
      setHealthLoadError(true);
      setHealthLoading(false);
      return;
    }
    setHealthEntries(entries ?? []);
    setHealthLoading(false);
  };

  useEffect(() => {
    if (sessionUser && profileReady) loadHealthData();
  }, [sessionUser?.id, profileReady]);

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
    if (suppressSpeechEnd.current) return;
    const text = event.results?.[0]?.transcript ?? "";
    latestTranscript.current = text;
    setTranscript(text);
  });

  const speakAprilResponse = (text: string) => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !("speechSynthesis" in window)) {
      setTalkStatus("idle");
      return;
    }
    setTalkStatus("speaking");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => setTalkStatus("idle");
    window.speechSynthesis.speak(utterance);
  };

  useSpeechRecognitionEvent("end", async () => {
    setIsListening(false);
    if (suppressSpeechEnd.current) {
      suppressSpeechEnd.current = false;
      setTalkStatus("idle");
      return;
    }
    if (!checkInVoiceActive.current) setTalkStatus("thinking");
    const spoken = latestTranscript.current.trim();

    if (checkInVoiceActive.current) {
      checkInVoiceActive.current = false;
      ExpoSpeechRecognitionModule.stop();
      if (spoken) {
        const key = checkInQuestions[checkInStepRef.current]?.key;
        if (key) {
          const numericMatch = spoken.match(/\d+(?:\.\d+)?/);
          const numericValue = numericMatch ? Number(numericMatch[0]) : null;
          if (key === "sleepHours" && numericValue !== null && numericValue > 24) {
            setCheckInVoiceError(false);
            setCheckInMessage("Please give your sleep in hours, up to 24. You can try again or type your answer.");
            return;
          }
          if (key === "energyLevel" && numericValue !== null && numericValue > 10) {
            setCheckInVoiceError(false);
            setCheckInMessage("Please give your energy from 0 to 10. You can try again or type your answer.");
            return;
          }
          setCheckInAnswers((current) => ({ ...current, [key]: spoken }));
          setCheckInVoiceError(false);
          setCheckInMessage("I heard you. Let me think about that…");
          const reply = await askApril(spoken, [
            { role: "assistant", content: checkInQuestions[checkInStepRef.current]?.title ?? "" },
            { role: "user", content: spoken },
          ]);

          if (!checkInFlowActive.current) {
            return;
          }

          setCheckInMessage(reply);
          speakAprilResponse(reply);

          const currentStep = checkInStepRef.current;
          if (currentStep < checkInQuestions.length - 1) {
            const nextStep = currentStep + 1;
            setCheckInStep(nextStep);
            checkInStepRef.current = nextStep;
            setTimeout(() => {
              setCheckInMessage("APRIL is asking…");
              speakCheckInQuestion(checkInQuestions[nextStep].title, () => {
                startCheckInVoice();
              });
            }, Platform.OS === "web" ? 700 : 0);
          } else {
            setCheckInMessage("That’s your check-in complete. Saving what you shared…");
            setTimeout(() => {
              saveCheckIn();
            }, Platform.OS === "web" ? 700 : 0);
          }
        }
      } else {
        setCheckInMessage("I didn’t catch that. You can try again or type your answer.");
      }
      return;
    }

    if (spoken) {
      setAprilResponse("Thinking…");
      const context = talkContext.current.slice(-6);
      askApril(spoken, context).then((reply) => {
        if (!talkFlowActive.current) return;
        talkContext.current = [
          ...talkContext.current,
          { role: "user", content: spoken },
          { role: "assistant", content: reply },
        ].slice(-8);
        setAprilResponse(reply);
        speakAprilResponse(reply);
      });
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.log("Speech recognition error:", event.error);
    setIsListening(false);
    if (checkInVoiceActive.current) {
      checkInVoiceActive.current = false;
      setCheckInVoiceError(true);
      setCheckInMessage("I couldn’t hear that clearly. You can try again or type your answer.");
    } else {
      setTalkStatus("idle");
      setTalkError(true);
      setAprilResponse("I couldn’t hear that clearly. Please try again.");
    }
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

    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) {
          setAuthMessage(error.message);
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
    } catch (error: any) {
      const detail = error?.message || String(error);
      console.log("APRIL authentication exception:", detail);
      setAuthMessage(`Connection error: ${detail}`);
    } finally {
      setAuthBusy(false);
    }
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

  const askApril = async (message: string, context: { role: string; content: string }[] = []) => {
    try {
      const { data, error } = await supabase.functions.invoke("april-conversation", {
        body: { message, context },
      });
      if (error) {
        console.log("APRIL conversation error:", error.message);
        return "I’m here with you. I can still record what you share.";
      }

    if (data?.diagnostic) {
      console.log("APRIL conversation diagnostic:", data.diagnostic);
      const messages: Record<string, string> = {
        GROQ_API_KEY_MISSING: "My conversation service is not connected yet.",
        GROQ_API_KEY_REJECTED: "My conversation service could not authenticate.",
        GROQ_ACCESS_DENIED: "My conversation service does not currently have access to its AI provider.",
        GROQ_MODEL_OR_ENDPOINT_NOT_FOUND: "My conversation service cannot reach its AI model.",
        GROQ_QUOTA_OR_RATE_LIMIT: "My conversation service is temporarily busy. Please try again shortly.",
        GROQ_PROVIDER_ERROR: "My conversation service is temporarily unavailable.",
        GROQ_REQUEST_REJECTED: "My conversation request was rejected. Please try again.",
        APRIL_FUNCTION_ERROR: "Something interrupted APRIL’s conversation service.",
      };
      return messages[data.diagnostic] ?? "My conversation service needs attention.";
    }

      return data?.reply ?? "I’m listening. Tell me a little more.";
    } catch (error: any) {
      const detail = error?.message || String(error);
      console.log("APRIL conversation exception:", detail);
      return "I’m here with you. Something interrupted our conversation. You can try again.";
    }
  };

  const startListening = async () => {
    talkFlowActive.current = true;
    const permission =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    if (!permission.granted) {
      talkFlowActive.current = false;
      setTalkStatus("idle");
      Alert.alert(
        "Microphone permission needed",
        "APRIL needs microphone access when you choose to talk."
      );
      return;
    }

    setTranscript("");
    setAprilResponse("");
    setTalkError(false);
    latestTranscript.current = "";

    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
      });
    } catch (error: any) {
      console.log("APRIL microphone start error:", error?.message || String(error));
      talkFlowActive.current = false;
      setIsListening(false);
      setTalkStatus("idle");
      setTalkError(true);
      setAprilResponse("I couldn’t start the microphone. Please try again.");
    }
  };

  const retryListening = () => {
    setTalkError(false);
    setAprilResponse("");
    setTranscript("");
    latestTranscript.current = "";
    setTalkStatus("listening");
    startListening();
  };

  const stopListening = () => {
    ExpoSpeechRecognitionModule.stop();
  };

  const handleTalk = () => {
    if (isListening) {
      setTalkStatus("thinking");
      stopListening();
    } else {
      setTalkStatus("listening");
      startListening();
    }
  };

  const resetTalkConversation = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (isListening) {
      suppressSpeechEnd.current = true;
      ExpoSpeechRecognitionModule.stop();
    }
    checkInVoiceActive.current = false;
    talkFlowActive.current = false;
    setTalkError(false);
    talkContext.current = [];
    latestTranscript.current = "";
    setIsListening(false);
    setTranscript("");
    setAprilResponse("");
    setTalkStatus("idle");
  };

  const finishTalkSession = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (isListening) {
      suppressSpeechEnd.current = true;
      ExpoSpeechRecognitionModule.stop();
    }
    talkFlowActive.current = false;
    checkInVoiceActive.current = false;
    latestTranscript.current = "";
    setIsListening(false);
    setTalkStatus("idle");
    setTalkError(false);
    setActiveTab("home");
  };

  const handleTabChange = (tab: typeof activeTab) => {
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (isListening) {
      suppressSpeechEnd.current = true;
      ExpoSpeechRecognitionModule.stop();
    }
    checkInFlowActive.current = false;
    checkInVoiceActive.current = false;
    talkFlowActive.current = false;
    setIsListening(false);
    if (tab !== "talk") {
      talkContext.current = [];
      setTalkError(false);
      setTranscript("");
      setAprilResponse("");
      setTalkStatus("idle");
    }
    setActiveTab(tab);
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
        <View pointerEvents="none" style={styles.authBackgroundArt}>
          <View style={styles.backgroundRingOne} />
          <View style={styles.backgroundRingTwo} />
          <View style={styles.backgroundWaveOne} />
          <View style={styles.backgroundWaveTwo} />
          <View style={styles.backgroundDotOne} />
          <View style={styles.backgroundDotTwo} />
        </View>
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
        <View pointerEvents="none" style={styles.authBackgroundArt}>
          <View style={styles.backgroundRingOne} />
          <View style={styles.backgroundRingTwo} />
          <View style={styles.backgroundWaveOne} />
          <View style={styles.backgroundWaveTwo} />
          <View style={styles.backgroundDotOne} />
          <View style={styles.backgroundDotTwo} />
        </View>
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

  const checkInQuestions = [
    { key: "overallFeeling", title: "How are you feeling overall?", placeholder: "Tell me in your own words…" },
    { key: "sleepHours", title: "How did you sleep?", placeholder: "For example: 7 hours" },
    { key: "energyLevel", title: "How’s your energy?", placeholder: "For example: 6 out of 10" },
    { key: "emotionalState", title: "How are you feeling emotionally?", placeholder: "For example: calm, stressed, happy…" },
    { key: "physicalConcerns", title: "Anything bothering you physically?", placeholder: "Tell me anything you’ve noticed, or say none." },
  ] as const;

  const beginCheckIn = (contextNote = "") => {
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (isListening) {
      suppressSpeechEnd.current = true;
      ExpoSpeechRecognitionModule.stop();
    }
    checkInFlowActive.current = true;
    checkInVoiceActive.current = false;
    latestTranscript.current = "";
    setIsListening(false);
    setTalkStatus("idle");
    setTranscript("");
    setAprilResponse("");
    talkContext.current = [];
    setTalkError(false);
    const trimmedContext = contextNote.trim();
    const hasContext = Boolean(trimmedContext);
    setCheckInStep(hasContext ? 1 : 0);
    checkInStepRef.current = hasContext ? 1 : 0;
    setCheckInContextNote(trimmedContext);
    setCheckInAnswers({
      overallFeeling: trimmedContext,
      sleepHours: "",
      energyLevel: "",
      emotionalState: "",
      physicalConcerns: "",
    });
    setCheckInComplete(false);
    setCheckInMessage("");
    setCheckInVoiceError(false);
    setActiveTab("checkin");
  };

  const continueTalkIntoCheckIn = () => {
    const note = transcript.trim();
    if (!note || todayCheckIn) return;
    beginCheckIn(note);
  };

  const reviewTodayCheckIn = () => {
    if (!todayCheckIn) return;
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (isListening) {
      suppressSpeechEnd.current = true;
      ExpoSpeechRecognitionModule.stop();
    }
    checkInFlowActive.current = false;
    checkInVoiceActive.current = false;
    talkFlowActive.current = false;
    latestTranscript.current = "";
    setIsListening(false);
    setTalkStatus("idle");
    setTranscript("");
    setTalkError(false);
    setAprilResponse("");
    setCheckInVoiceError(false);
    setCheckInMessage("");
    setCheckInContextNote("");
    setCheckInAnswers({
      overallFeeling: todayCheckIn.overall_feeling ?? "",
      sleepHours: todayCheckIn.sleep_hours != null ? String(todayCheckIn.sleep_hours) : "",
      energyLevel: todayCheckIn.energy_level != null ? String(todayCheckIn.energy_level) : "",
      emotionalState: todayCheckIn.emotional_state ?? "",
      physicalConcerns: todayCheckIn.physical_concerns ?? "",
    });
    setCheckInComplete(true);
    setCheckInMessage("");
    setActiveTab("checkin");
  };

  const updateCheckInAnswer = (value: string) => {
    const key = checkInQuestions[checkInStep].key;
    setCheckInAnswers((current) => ({ ...current, [key]: value }));
  };

  const saveCheckIn = async () => {
    if (!sessionUser) return;
    setCheckInSaving(true);
    setCheckInMessage("");
    setCheckInSaveFailed(false);
    const sleepMatch = checkInAnswers.sleepHours.match(/\d+(?:\.\d+)?/);
    const energyMatch = checkInAnswers.energyLevel.match(/\d+(?:\.\d+)?/);
    const sleepHours = sleepMatch ? Number(sleepMatch[0]) : null;
    const energyLevel = energyMatch ? Number(energyMatch[0]) : null;

    const { error } = await supabase.from("check_ins").insert({
      user_id: sessionUser.id,
      overall_feeling: checkInAnswers.overallFeeling.trim() || null,
      sleep_hours: sleepHours !== null && sleepHours <= 24 ? sleepHours : null,
      energy_level: energyLevel !== null && energyLevel <= 10 ? energyLevel : null,
      emotional_state: checkInAnswers.emotionalState.trim() || null,
      physical_concerns: checkInAnswers.physicalConcerns.trim() || null,
    });

    if (error) {
      console.log("APRIL check-in save error:", error.message);
      setCheckInMessage("I couldn’t save your check-in just now. Your answers are still on this screen, so you can try saving again.");
      setCheckInSaveFailed(true);
      setCheckInSaving(false);
      return;
    }

    const entries = [
      checkInAnswers.overallFeeling.trim() ? { category: "note", title: "Overall feeling", content: checkInAnswers.overallFeeling.trim() } : null,
      sleepHours !== null && sleepHours <= 24 ? { category: "sleep", title: "Sleep", content: String(sleepHours), metadata: { unit: "hours" } } : null,
      energyLevel !== null && energyLevel <= 10 ? { category: "energy", title: "Energy", content: String(energyLevel), severity: energyLevel, metadata: { scale: "0-10" } } : null,
      checkInAnswers.emotionalState.trim() ? { category: "mood", title: "Emotional state", content: checkInAnswers.emotionalState.trim() } : null,
      checkInAnswers.physicalConcerns.trim() && checkInAnswers.physicalConcerns.trim().toLowerCase() !== "none" ? { category: "symptom", title: "Physical concern", content: checkInAnswers.physicalConcerns.trim() } : null,
    ].filter(Boolean) as any[];

    let entriesSaveFailed = false;
    if (entries.length) {
      const { error: entriesError } = await supabase.from("health_entries").insert(
        entries.map((entry) => ({ ...entry, user_id: sessionUser.id, source: "check_in" }))
      );
      if (entriesError) {
        console.log("APRIL health entry save error:", entriesError.message);
        entriesSaveFailed = true;
      }
    }
    setCheckInComplete(true);
    setCheckInSaving(false);
    if (entriesSaveFailed) {
      setCheckInMessage("Your check-in was saved, but I couldn’t add all of its details to your health story. You can try another check-in later.");
    }
    await loadHealthData();
  };

  const speakCheckInQuestion = (questionText: string, onDone?: () => void) => {
    if (Platform.OS !== "web" || typeof window === "undefined" || !("speechSynthesis" in window)) {
      setCheckInMessage("Voice questions are available in the web voice experience. You can still answer by voice or type here.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(questionText);
    utterance.rate = 0.92;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => onDone?.();
    window.speechSynthesis.speak(utterance);
  };

  const startConversationalCheckIn = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setCheckInMessage("APRIL is asking…");
    const question = checkInQuestions[checkInStepRef.current];
    speakCheckInQuestion(question.title, () => {
      startCheckInVoice();
    });
  };

  const startCheckInVoice = async () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!checkInFlowActive.current) return;
    if (!permission.granted) {
      setCheckInVoiceError(true);
      setCheckInMessage("Microphone access is needed to answer by voice. You can allow it in your browser or device settings, or type your answer below.");
      return;
    }
    checkInVoiceActive.current = true;
    latestTranscript.current = "";
    setTranscript("");
    setCheckInVoiceError(false);
    setCheckInMessage("Listening…");
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
      });
    } catch (error: any) {
      console.log("APRIL check-in microphone start error:", error?.message || String(error));
      checkInVoiceActive.current = false;
      if (!checkInFlowActive.current) return;
      setCheckInVoiceError(true);
      setCheckInMessage("I couldn’t start the microphone. You can try again or type your answer below.");
    }
  };

  const nextCheckInStep = async () => {
    const key = checkInQuestions[checkInStep].key;
    const value = checkInAnswers[key].trim();

    if (!value) {
      setCheckInMessage("Take your time — an answer helps me understand your day.");
      return;
    }

    if (key === "sleepHours") {
      const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)?\s*$/i);
      if (!match || Number(match[1]) > 24) {
        setCheckInMessage("Please enter your sleep in hours, up to 24.");
        return;
      }
    }

    if (key === "energyLevel") {
      const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10|out of 10)?\s*$/i);
      if (!match || Number(match[1]) > 10) {
        setCheckInMessage("Please enter your energy from 0 to 10.");
        return;
      }
    }

    setCheckInMessage("");
    if (checkInStep < checkInQuestions.length - 1) setCheckInStep((step) => step + 1);
    else await saveCheckIn();
  };

  const renderCheckIn = () => {
    if (checkInComplete) {
      return (
        <ScrollView contentContainerStyle={styles.checkInContent}>
          <Text style={styles.screenEyebrow}>DAILY CHECK-IN</Text>
          <Text style={styles.screenTitle}>Thank you for checking in.</Text>
          <Text style={styles.screenSubtitle}>I’ve saved what you shared so you can come back to it later.</Text>
          {todayCheckIn?.checked_in_at ? <Text style={styles.checkInRecorded}>Recorded · {new Date(todayCheckIn.checked_in_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</Text> : null}
          {checkInMessage ? <Text style={styles.checkInMessage}>{checkInMessage}</Text> : null}
          {checkInSaveFailed ? (
            <Pressable style={styles.secondaryButton} onPress={saveCheckIn} disabled={checkInSaving}>
              <Text style={styles.secondaryButtonText}>{checkInSaving ? "Saving…" : "Try saving again"}</Text>
            </Pressable>
          ) : null}
          <View style={styles.checkInSummaryCard}>
            <Text style={styles.summaryLabel}>TODAY’S CHECK-IN</Text>
            {checkInAnswers.overallFeeling ? <Text style={styles.summaryText}>{checkInAnswers.overallFeeling}</Text> : null}
            {checkInAnswers.sleepHours ? <Text style={styles.summaryLine}>Sleep · {checkInAnswers.sleepHours} hours</Text> : null}
            {checkInAnswers.energyLevel ? <Text style={styles.summaryLine}>Energy · {checkInAnswers.energyLevel}/10</Text> : null}
            {checkInAnswers.emotionalState ? <Text style={styles.summaryLine}>Emotion · {checkInAnswers.emotionalState}</Text> : null}
            {checkInAnswers.physicalConcerns ? <Text style={styles.summaryLine}>Physical · {checkInAnswers.physicalConcerns}</Text> : null}
          </View>
          <Pressable style={styles.button} onPress={() => handleTabChange("home")}><Text style={styles.buttonText}>Back to today</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={beginCheckIn}><Text style={styles.secondaryButtonText}>Start another check-in</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => handleTabChange("health")}><Text style={styles.secondaryButtonText}>View my health story</Text></Pressable>
        </ScrollView>
      );
    }
    const question = checkInQuestions[checkInStep];
    const value = checkInAnswers[question.key];
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.checkInContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.screenEyebrow}>DAILY CHECK-IN</Text>
          <View style={styles.progressRow}>{checkInQuestions.map((_, index) => <View key={index} style={[styles.progressDot, index <= checkInStep && styles.progressDotActive]} />)}</View>
          <Text style={styles.checkInStepText}>{checkInStep + 1} of {checkInQuestions.length}</Text>
          {checkInContextNote && checkInStep === 1 ? (
            <View style={styles.contextNoteCard}>
              <Text style={styles.contextNoteLabel}>FROM YOUR TALK WITH APRIL</Text>
              <Text style={styles.contextNoteText}>{checkInContextNote}</Text>
              <Text style={styles.contextNoteHint}>I’ll keep this in mind so you don’t have to repeat it.</Text>
            </View>
          ) : null}
          <Text style={styles.checkInQuestion}>{question.title}</Text>
          <Text style={styles.checkInPrompt}>There’s no perfect answer. Just tell me what feels true right now.</Text>
          <Pressable
            style={styles.conversationButton}
            onPress={startConversationalCheckIn}
            disabled={isListening || checkInSaving}
          >
            <Text style={styles.conversationButtonText}>Talk through this check-in</Text>
          </Pressable>
          <Pressable
            style={[styles.voiceAnswerButton, isListening && styles.voiceAnswerButtonActive]}
            onPress={startCheckInVoice}
            disabled={isListening || checkInSaving}
          >
            <Text style={styles.voiceAnswerIcon}>◉</Text>
            <Text style={styles.voiceAnswerText}>{isListening ? "Listening…" : "Answer by voice"}</Text>
          </Pressable>
          <TextInput style={styles.checkInInput} placeholder={question.placeholder} placeholderTextColor="#777D89" value={value} onChangeText={updateCheckInAnswer} multiline={question.key !== "sleepHours" && question.key !== "energyLevel"} keyboardType={question.key === "sleepHours" || question.key === "energyLevel" ? "decimal-pad" : "default"} />
          {checkInMessage ? <Text style={styles.checkInMessage}>{checkInMessage}</Text> : null}
          {checkInVoiceError && !isListening ? (
            <Pressable style={styles.newConversationButton} onPress={startCheckInVoice} disabled={checkInSaving}>
              <Text style={styles.newConversationText}>Try again</Text>
            </Pressable>
          ) : null}
          <View style={styles.checkInActions}>
            {checkInStep > 0 ? <Pressable style={styles.backButton} onPress={() => { setCheckInMessage(""); setCheckInStep((step) => step - 1); }}><Text style={styles.backButtonText}>Back</Text></Pressable> : null}
            <Pressable style={[styles.button, checkInSaving && styles.buttonDisabled]} onPress={nextCheckInStep} disabled={checkInSaving}>
              {checkInSaving ? <ActivityIndicator color="#0B0E14" /> : <Text style={styles.buttonText}>{checkInStep === checkInQuestions.length - 1 ? "Save check-in" : "Continue"}</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const renderHome = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent}>
      <View style={styles.dashboardHeader}>
        <View>
          <Text style={styles.eyebrow}>TODAY</Text>
          <Text style={styles.greeting}>Hi{profileName ? `, ${profileName}` : ""}.</Text>
        </View>
        <View style={styles.statusDot} />
      </View>

      <View style={styles.aprilHero}>
        <View style={styles.aprilHeroOrb}>
          <View style={styles.orbit orbitA} />
          <View style={styles.orbit orbitB} />
          <View style={styles.orbitDot orbitDotA} />
          <View style={styles.orbitDot orbitDotB} />
          <View style={styles.aprilAura} />
          <View style={styles.aprilBotFace}>
            <View style={styles.aprilBotBrowRow}>
              <View style={styles.aprilBotBrow} />
              <View style={styles.aprilBotBrow} />
            </View>
            <View style={styles.aprilBotEyeRow}>
              <View style={styles.aprilBotEye}><View style={styles.aprilBotEyeGlow} /></View>
              <View style={styles.aprilBotEye}><View style={styles.aprilBotEyeGlow} /></View>
            </View>
            <View style={styles.aprilBotMouth} />
          </View>
        </View>
        <View style={styles.aprilHeroCopy}>
          <View style={styles.aprilNameRow}>
            <Text style={styles.homePresenceLabel}>APRIL</Text>
            <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.livePillText}>PRESENT</Text></View>
          </View>
          <Text style={styles.homePresenceText}>I’m here. Take your time.</Text>
          <Text style={styles.aprilHeroHint}>A quiet space to talk, reflect and notice your own patterns.</Text>
        </View>
      </View>

      <Text style={styles.question}>How are you feeling today?</Text>
      <Text style={styles.dashboardSubtitle}>
        You don’t have to fill anything out. Just talk to APRIL.
      </Text>

      <Pressable style={styles.talkCard} onPress={() => handleTabChange("talk")}>
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

      {todayCheckInLoadError ? (
        <View style={styles.todayNoteCard}>
          <Text style={styles.insightLabel}>TODAY’S CHECK-IN</Text>
          <Text style={styles.todayNoteText}>Today’s check-in could not be loaded right now.</Text>
          <Text style={styles.todayNoteMeta}>Your saved health information has not been changed.</Text>
          <Pressable style={styles.secondaryButton} onPress={loadHealthData}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.snapshotRow}>
        <View style={styles.snapshotCard}>
          <Text style={styles.snapshotIcon}>◷</Text>
          <Text style={styles.snapshotTitle}>Sleep</Text>
          <Text style={styles.snapshotValue}>{todayCheckIn?.sleep_hours != null ? `${todayCheckIn.sleep_hours} hours` : "Not recorded"}</Text>
        </View>
        <View style={styles.snapshotCard}>
          <Text style={styles.snapshotIcon}>✦</Text>
          <Text style={styles.snapshotTitle}>Energy</Text>
          <Text style={styles.snapshotValue}>{todayCheckIn?.energy_level != null ? `${todayCheckIn.energy_level}/10` : "Not recorded"}</Text>
        </View>
      </View>

      {todayCheckIn ? (
        <View style={styles.todayNoteCard}>
          <Text style={styles.insightLabel}>TODAY’S CHECK-IN</Text>
          {todayCheckIn.overall_feeling ? <Text style={styles.todayNoteText}>{todayCheckIn.overall_feeling}</Text> : null}
          {todayCheckIn.emotional_state ? <Text style={styles.todayNoteMeta}>Emotion · {todayCheckIn.emotional_state}</Text> : null}
          {todayCheckIn.physical_concerns ? <Text style={styles.todayNoteMeta}>Physical · {todayCheckIn.physical_concerns}</Text> : null}
          {todayCheckIn.checked_in_at ? (
            <Text style={styles.todayNoteTime}>
              Recorded · {new Date(todayCheckIn.checked_in_at).toLocaleString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Pressable style={styles.checkInCard} onPress={todayCheckIn ? reviewTodayCheckIn : beginCheckIn}>
        <View>
          <Text style={styles.checkInLabel}>{todayCheckIn ? "TODAY’S CHECK-IN" : "DAILY CHECK-IN"}</Text>
          <Text style={styles.checkInTitle}>
            {todayCheckIn ? "Review today’s check-in." : "Take a moment for yourself."}
          </Text>
          <Text style={styles.checkInSubtitle}>
            {todayCheckIn
              ? "See what you recorded, or start another check-in if something has changed."
              : "A short conversation can help you notice how you’re doing."}
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

      <Animated.View style={[styles.talkBotStage, { transform: [{ scale: pulse }] }]}>
        <View style={styles.talkOrbit talkOrbitOne} />
        <View style={styles.talkOrbit talkOrbitTwo} />
        <View style={styles.talkOrbitDot} />
        <View style={styles.talkBotAura} />
        <View style={styles.talkBotFace}>
          <View style={styles.aprilBotBrowRow}>
            <View style={styles.aprilBotBrow} />
            <View style={styles.aprilBotBrow} />
          </View>
          <View style={styles.aprilBotEyeRow}>
            <View style={styles.aprilBotEye}><View style={styles.aprilBotEyeGlow} /></View>
            <View style={styles.aprilBotEye}><View style={styles.aprilBotEyeGlow} /></View>
          </View>
          <View style={[styles.aprilBotMouth, isListening && styles.aprilBotMouthListening]} />
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

      <Text style={styles.voiceStatus}>
        {talkStatus === "listening" ? "APRIL is listening…" :
          talkStatus === "thinking" ? "APRIL is thinking…" :
          talkStatus === "speaking" ? "APRIL is speaking…" :
          "Ready when you are."}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={handleTalk}
      >
        <Text style={styles.buttonText}>{isListening ? "I’m done" : "Talk to me"}</Text>
      </Pressable>
      {talkError && !isListening ? (
        <Pressable style={styles.newConversationButton} onPress={retryListening}>
          <Text style={styles.newConversationText}>Try again</Text>
        </Pressable>
      ) : null}
      {(transcript.length > 0 || aprilResponse.length > 0) && !isListening ? (
        <>
          {transcript.trim() && !todayCheckIn ? (
            <Pressable style={styles.newConversationButton} onPress={continueTalkIntoCheckIn}>
              <Text style={styles.newConversationText}>Use this in today’s check-in</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.newConversationButton} onPress={finishTalkSession}>
            <Text style={styles.newConversationText}>I’m done for now</Text>
          </Pressable>
          <Pressable style={styles.newConversationButton} onPress={resetTalkConversation}>
            <Text style={styles.newConversationText}>Start a new conversation</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );

  const renderHealth = () => (
    <ScrollView contentContainerStyle={styles.dashboardContent}>
      <Text style={styles.screenEyebrow}>MY HEALTH</Text>
      <Text style={styles.screenTitle}>Your story, over time.</Text>
      <Text style={styles.screenSubtitle}>
        Things you choose to record will appear here in chronological order.
      </Text>
      {!healthLoading && healthEntries.length > 0 ? (
        <>
          {(() => {
            const filteredForTimestamp = healthFilter === "all"
              ? healthEntries
              : healthEntries.filter((entry) => String(entry.category).toLowerCase() === healthFilter);
            const latestForFilter = filteredForTimestamp[0];
            const filterLabel = healthFilter === "all" ? "overall" :
              healthFilter === "sleep" ? "sleep" :
              healthFilter === "energy" ? "energy" :
              healthFilter === "mood" ? "emotional" : "physical";
            return (
              <>
                <Text style={styles.timelineUpdated}>
                  Last {filterLabel} recorded · {new Date(latestForFilter?.occurred_at || latestForFilter?.created_at || healthEntries[0]?.occurred_at || healthEntries[0]?.created_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </Text>
                <Text style={styles.timelineCoverage}>
                  Showing your 30 most recent recorded entries.
                </Text>
              </>
            );
          })()}
        </>
      ) : null}
      {healthLoading ? (
        <View style={styles.emptyCard}><ActivityIndicator color="#E8A33D" /><Text style={styles.emptyText}>Loading your health story…</Text></View>
      ) : healthLoadError ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your health story couldn’t be loaded.</Text>
          <Text style={styles.emptyText}>Your recorded information has not been changed. Please try again.</Text>
          <Pressable style={styles.secondaryButton} onPress={loadHealthData}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : healthEntries.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Nothing recorded yet.</Text>
          <Text style={styles.emptyText}>
            Start with a daily check-in. APRIL will keep the information you choose to record in your timeline.
          </Text>
          <Pressable style={styles.secondaryButton} onPress={beginCheckIn}>
            <Text style={styles.secondaryButtonText}>Start a check-in</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {([
              ["all", "All"],
              ["sleep", "Sleep"],
              ["energy", "Energy"],
              ["mood", "Emotional"],
              ["symptom", "Physical"],
            ] as const).map(([key, label]) => (
              <Pressable
                key={key}
                style={[styles.filterChip, healthFilter === key && styles.filterChipActive]}
                onPress={() => setHealthFilter(key)}
              >
                <Text style={[styles.filterChipText, healthFilter === key && styles.filterChipTextActive]}>
                  {label} · {key === "all" ? healthEntries.length : healthEntries.filter((entry) => String(entry.category).toLowerCase() === key).length}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {(() => {
            const filteredEntries = healthEntries.filter(
              (entry) => healthFilter === "all" || String(entry.category).toLowerCase() === healthFilter
            );
            if (filteredEntries.length === 0) {
              const filterLabel = healthFilter === "sleep" ? "sleep" :
                healthFilter === "energy" ? "energy" :
                healthFilter === "mood" ? "emotional" :
                healthFilter === "symptom" ? "physical" : "health";
              return (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>No {filterLabel} entries yet.</Text>
                  <Text style={styles.emptyText}>
                    APRIL will show them here when you choose to record them.
                  </Text>
                  <Pressable style={styles.secondaryButton} onPress={beginCheckIn}>
                    <Text style={styles.secondaryButtonText}>Add a check-in</Text>
                  </Pressable>
                </View>
              );
            }
            return (
              <View style={styles.timeline}>
              {filteredEntries.map((entry, index) => {
                const category = String(entry.category).toLowerCase();
            const entryDate = new Date(entry.occurred_at || entry.created_at);
            const previousEntry = filteredEntries[index - 1];
            const previousDate = previousEntry ? new Date(previousEntry.occurred_at || previousEntry.created_at) : null;
            const isNewDay = !previousDate || entryDate.toDateString() !== previousDate.toDateString();
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);
            const dayLabel =
              entryDate.toDateString() === today.toDateString() ? "TODAY" :
              entryDate.toDateString() === yesterday.toDateString() ? "YESTERDAY" :
              entryDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase();
            const categoryLabel =
              category === "sleep" ? "SLEEP" :
              category === "energy" ? "ENERGY" :
              category === "mood" ? "EMOTIONAL" :
              category === "symptom" ? "PHYSICAL" : "NOTE";
            const displayContent =
              category === "sleep" ? `${entry.content} hours` :
              category === "energy" ? `${entry.content}/10` :
              String(entry.content);

            return (
              <React.Fragment key={entry.id}>
                {isNewDay ? <Text style={styles.timelineDayLabel}>{dayLabel}</Text> : null}
              <View style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineCard}>
                  <Text style={styles.timelineCategory}>{categoryLabel}</Text>
                  <Text style={styles.timelineTitle}>{entry.title}</Text>
                  <Text style={styles.timelineText}>{displayContent}</Text>
                  <Text style={styles.timelineDate}>
                    {new Date(entry.occurred_at || entry.created_at).toLocaleString(undefined, {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
              </View>
              </React.Fragment>
            );
              })}
              </View>
            );
          })()}
        </>
      )}
    </ScrollView>
  );

  const renderInsights = () => {
    const sleepValues = healthEntries
      .filter((entry) => entry.category === "sleep")
      .map((entry) => Number(entry.content))
      .filter((value) => Number.isFinite(value) && value > 0 && value <= 24);
    const energyValues = healthEntries
      .filter((entry) => entry.category === "energy")
      .map((entry) => Number(entry.content))
      .filter((value) => Number.isFinite(value) && value >= 0 && value <= 10);
    const average = (values: number[]) =>
      values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1) : null;
    const numericAverage = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const dayKey = (entry: any) => {
      const value = entry.occurred_at ?? entry.created_at;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
    };
    const recordedDays = Array.from(new Set(healthEntries.map(dayKey).filter((day) => day !== "unknown")));
    const recentDays = new Set(recordedDays.slice(0, 3));
    const earlierDays = new Set(recordedDays.slice(3));
    const valuesForDays = (category: string, days: Set<string>, min: number, max: number) =>
      healthEntries
        .filter((entry) => entry.category === category && days.has(dayKey(entry)))
        .map((entry) => Number(entry.content))
        .filter((value) => Number.isFinite(value) && value >= min && value <= max);
    const recentEnergy = valuesForDays("energy", recentDays, 0, 10);
    const earlierEnergy = valuesForDays("energy", earlierDays, 0, 10);
    const recentSleep = valuesForDays("sleep", recentDays, 0.01, 24);
    const earlierSleep = valuesForDays("sleep", earlierDays, 0.01, 24);
    const describeChange = (recent: number | null, earlier: number | null, unit: string) => {
      if (recent === null || earlier === null || Math.abs(recent - earlier) < 0.5) return null;
      const earlierCount = earlierDays.size;
      return `Your recorded ${unit} has been ${recent > earlier ? "higher" : "lower"} across your most recent recorded ${recentDays.size === 1 ? "day" : "days"} (${recent.toFixed(1)} vs ${earlier.toFixed(1)} across the earlier ${earlierCount === 1 ? "day" : "days"}).`;
    };
    const recentSleepEntryCount = valuesForDays("sleep", recentDays, 0.01, 24).length;
    const earlierSleepEntryCount = valuesForDays("sleep", earlierDays, 0.01, 24).length;
    const recentEnergyEntryCount = valuesForDays("energy", recentDays, 0, 10).length;
    const earlierEnergyEntryCount = valuesForDays("energy", earlierDays, 0, 10).length;
    const energyChangeNote = describeChange(numericAverage(recentEnergy), numericAverage(earlierEnergy), "energy");
    const sleepChangeNote = describeChange(numericAverage(recentSleep), numericAverage(earlierSleep), "sleep");
    const averageSleep = average(sleepValues);
    const averageEnergy = average(energyValues);
    const latestMood = healthEntries.find((entry) => entry.category === "mood");
    const latestRecordedValue = healthEntries
      .map((entry) => entry.occurred_at ?? entry.created_at)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const latestRecordedLabel = latestRecordedValue
      ? latestRecordedValue.toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : null;
    const hasEnoughHistory = recordedDays.length >= 2;
    const hasSleepData = sleepValues.length > 0;
    const hasEnergyData = energyValues.length > 0;
    const missingBaselineAreas = [
      !hasSleepData ? "sleep" : null,
      !hasEnergyData ? "energy" : null,
    ].filter(Boolean) as string[];

    return (
      <ScrollView contentContainerStyle={styles.dashboardContent}>
        <Text style={styles.screenEyebrow}>INSIGHTS</Text>
        <Text style={styles.screenTitle}>Patterns, not diagnoses.</Text>
        <Text style={styles.screenSubtitle}>
          APRIL only shows observations from information you’ve chosen to record.
        </Text>
        {recordedDays.length > 0 ? (
          <View>
            <Text style={styles.insightHistoryMeta}>
              Based on {recordedDays.length} recorded {recordedDays.length === 1 ? "day" : "days"} in your recent history.
              {latestRecordedLabel ? ` Last recorded ${latestRecordedLabel}.` : ""}
            </Text>
            <Text style={styles.timelineCoverage}>
              Insights use the 30 most recent recorded entries available to APRIL.
            </Text>
          </View>
        ) : null}

        {!hasEnoughHistory ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Your baseline is just beginning.</Text>
            <Text style={styles.emptyText}>
              Keep checking in over the next few days. Once there is enough of your own history, APRIL can highlight simple changes and patterns without diagnosing you.
            </Text>
            <Pressable style={styles.secondaryButton} onPress={beginCheckIn}>
              <Text style={styles.secondaryButtonText}>Add today’s check-in</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.snapshotRow}>
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotIcon}>◷</Text>
                <Text style={styles.snapshotTitle}>{sleepValues.length === 1 ? "Recorded sleep" : "Average sleep"}</Text>
                <Text style={styles.snapshotValue}>{averageSleep !== null ? `${averageSleep} hours` : "Not recorded yet"}</Text>
                {averageSleep !== null ? (
                  <Text style={styles.snapshotMeta}>{sleepValues.length} recorded {sleepValues.length === 1 ? "entry" : "entries"}</Text>
                ) : null}
              </View>
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotIcon}>✦</Text>
                <Text style={styles.snapshotTitle}>{energyValues.length === 1 ? "Recorded energy" : "Average energy"}</Text>
                <Text style={styles.snapshotValue}>{averageEnergy !== null ? `${averageEnergy}/10` : "Not recorded yet"}</Text>
                {averageEnergy !== null ? (
                  <Text style={styles.snapshotMeta}>{energyValues.length} recorded {energyValues.length === 1 ? "entry" : "entries"}</Text>
                ) : null}
              </View>
            </View>

            {missingBaselineAreas.length > 0 ? (
              <View style={styles.insightCard}>
                <Text style={styles.insightLabel}>BUILDING YOUR BASELINE</Text>
                <Text style={styles.insightText}>
                  You have recorded {recordedDays.length} {recordedDays.length === 1 ? "day" : "days"}, but APRIL does not have enough recorded {missingBaselineAreas.length === 2 ? "sleep or energy entries" : `${missingBaselineAreas[0]} entries`} yet to summarize {missingBaselineAreas.length === 2 ? "those areas" : `that area`}.
                </Text>
                <Pressable style={styles.secondaryButton} onPress={beginCheckIn}>
                  <Text style={styles.secondaryButtonText}>Add another check-in</Text>
                </Pressable>
              </View>
            ) : null}

            {latestMood ? (
              <View style={styles.insightCard}>
                <Text style={styles.insightLabel}>RECENTLY RECORDED</Text>
                <Text style={styles.insightText}>
                  You most recently recorded your emotional state as “{latestMood.content}”.
                </Text>
              </View>
            ) : null}

            {recordedDays.length >= 4 ? (
              <View style={styles.insightCard}>
                <Text style={styles.insightLabel}>RECENT CHANGE</Text>
                {energyChangeNote && <Text style={styles.insightText}>{energyChangeNote}</Text>}
                {sleepChangeNote && <Text style={[styles.insightText, energyChangeNote ? { marginTop: 8 } : null]}>{sleepChangeNote}</Text>}
                {!energyChangeNote && !sleepChangeNote ? (
                  <Text style={styles.insightText}>
                    {recentSleepEntryCount > 0 && earlierSleepEntryCount > 0 || recentEnergyEntryCount > 0 && earlierEnergyEntryCount > 0
                      ? "APRIL does not see a clear difference of 0.5 or more in the measures that have recorded values in both periods."
                      : "APRIL needs a recorded sleep or energy value in both comparison periods before it can describe a change for that measure."}
                  </Text>
                ) : null}
                {recentSleepEntryCount > 0 && earlierSleepEntryCount > 0 ? (
                  <Text style={styles.insightHint}>
                    Sleep comparison: {recentSleepEntryCount} recent recorded {recentSleepEntryCount === 1 ? "entry" : "entries"} vs {earlierSleepEntryCount} earlier recorded {earlierSleepEntryCount === 1 ? "entry" : "entries"}.
                  </Text>
                ) : null}
                {recentEnergyEntryCount > 0 && earlierEnergyEntryCount > 0 ? (
                  <Text style={[styles.insightHint, recentSleepEntryCount > 0 && earlierSleepEntryCount > 0 ? { marginTop: 5 } : null]}>
                    Energy comparison: {recentEnergyEntryCount} recent recorded {recentEnergyEntryCount === 1 ? "entry" : "entries"} vs {earlierEnergyEntryCount} earlier recorded {earlierEnergyEntryCount === 1 ? "entry" : "entries"}.
                  </Text>
                ) : null}
                <Text style={styles.insightHint}>
                  This compares your {recentDays.size} most recent recorded {recentDays.size === 1 ? "day" : "days"} with {earlierDays.size} earlier recorded {earlierDays.size === 1 ? "day" : "days"}. APRIL only averages days that have a recorded value for each measure.
                </Text>
              </View>
            ) : recordedDays.length >= 2 ? (
              <View style={styles.insightCard}>
                <Text style={styles.insightLabel}>RECENT CHANGE</Text>
                <Text style={styles.insightText}>
                  Keep recording for a little longer. APRIL compares recent changes only after 4 recorded days, so there is enough of your own history to compare two periods.
                </Text>
              </View>
            ) : null}

            <View style={styles.insightCard}>
              <Text style={styles.insightLabel}>ABOUT THESE INSIGHTS</Text>
              <Text style={styles.insightText}>
                These are summaries of what you recorded, not medical conclusions. If something concerns you, APRIL can help you organize what you’ve noticed to discuss with a healthcare professional.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    );
  };

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
        {editingName ? (
          <>
            <TextInput
              style={styles.nameInput}
              value={profileName}
              onChangeText={setProfileName}
              placeholder="Your name"
              placeholderTextColor="#777D89"
              autoFocus
            />
            {nameMessage ? <Text style={styles.settingHint}>{nameMessage}</Text> : null}
            <View style={styles.nameActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => { setEditingName(false); setNameMessage(""); }}
                disabled={nameSaving}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.button, nameSaving && styles.buttonDisabled]}
                disabled={nameSaving}
                onPress={async () => {
                  if (!sessionUser) return;
                  const name = profileName.trim();
                  if (!name) { setNameMessage("Enter a name to continue."); return; }
                  setNameSaving(true);
                  setNameMessage("");
                  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", sessionUser.id);
                  setNameSaving(false);
                  if (error) { setNameMessage("I couldn’t save that just yet."); return; }
                  setEditingName(false);
                }}
              >
                {nameSaving ? <ActivityIndicator color="#0B0E14" /> : <Text style={styles.buttonText}>Save name</Text>}
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable onPress={() => setEditingName(true)} style={styles.nameRow}>
            <View style={styles.nameRowText}>
              <Text style={styles.settingValue}>{profileName || "Add your name"}</Text>
              <Text style={styles.settingHint}>Your name is used to personalize APRIL.</Text>
            </View>
            <Text style={styles.nameEdit}>Edit</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>COMPANION</Text>
        <Text style={styles.settingValue}>Calm voice · English</Text>
        <Text style={styles.settingHint}>Warm, concise conversations focused on your wellbeing.</Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>YOUR DATA</Text>
        <Text style={styles.settingValue}>Your health information belongs to you.</Text>
        <Text style={styles.settingHint}>Only information you choose to record is added to your health story.</Text>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.settingLabel}>HEALTH SAFETY</Text>
        <Text style={styles.settingValue}>Patterns, not diagnoses.</Text>
        <Text style={styles.settingHint}>APRIL helps you notice changes and organize what you experience. It does not replace a healthcare professional.</Text>
      </View>

      <Pressable
        style={styles.signOutButton}
        onPress={() =>
          Alert.alert(
            "Sign out of APRIL?",
            "You can sign back in later and your saved health information will remain in your account.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Sign out", style: "destructive", onPress: () => supabase.auth.signOut() },
            ]
          )
        }
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );

  const renderActiveScreen = () => {
    if (activeTab === "home") return renderHome();
    if (activeTab === "talk") return renderTalk();
    if (activeTab === "checkin") return renderCheckIn();
    if (activeTab === "health") return renderHealth();
    if (activeTab === "insights") return renderInsights();
    return renderMe();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View pointerEvents="none" style={styles.backgroundArt}>
        <View style={styles.backgroundRingOne} />
        <View style={styles.backgroundRingTwo} />
        <View style={styles.backgroundWaveOne} />
        <View style={styles.backgroundWaveTwo} />
        <View style={styles.backgroundDotOne} />
        <View style={styles.backgroundDotTwo} />
      </View>
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
            <Pressable key={key} style={[styles.tab, activeTab === key && styles.tabActive]} onPress={() => handleTabChange(key as typeof activeTab)}>
              <View style={[styles.tabMark, activeTab === key && styles.tabMarkActive]} />
              <Text style={[styles.tabLabel, activeTab === key && styles.tabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#090C12" },

  authBackgroundArt: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    opacity: 0.96,
  },
  backgroundArt: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    opacity: 1,
  },
  backgroundRingOne: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    borderWidth: 1,
    borderColor: "rgba(232,163,61,0.18)",
    top: -150,
    right: -150,
  },
  backgroundRingTwo: {
    position: "absolute",
    width: 560,
    height: 560,
    borderRadius: 280,
    borderWidth: 1,
    borderColor: "rgba(185,168,216,0.15)",
    bottom: -260,
    left: -250,
  },
  backgroundWaveOne: {
    position: "absolute",
    width: 700,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: "rgba(142,214,177,0.13)",
    transform: [{ rotate: "-18deg" }],
    top: 220,
    left: -260,
  },
  backgroundWaveTwo: {
    position: "absolute",
    width: 620,
    height: 190,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(232,163,61,0.11)",
    transform: [{ rotate: "14deg" }],
    bottom: 170,
    right: -300,
  },
  backgroundDotOne: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(232,163,61,0.28)",
    top: 150,
    left: 34,
  },
  backgroundDotTwo: {
    position: "absolute",
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(185,168,216,0.24)",
    bottom: 250,
    right: 42,
  },
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

  aprilHero: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    marginBottom: 26,
  },

  aprilHeroOrb: {
    width: 156,
    height: 156,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },

  orbit: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 999,
  },

  orbitA: {
    width: 148,
    height: 148,
    borderColor: "rgba(232,163,61,0.34)",
    transform: [{ rotate: "18deg" }],
  },

  orbitB: {
    width: 126,
    height: 126,
    borderColor: "rgba(142,214,177,0.22)",
    transform: [{ rotate: "-24deg" }],
  },

  orbitDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  orbitDotA: { backgroundColor: "#E8A33D", top: 10, right: 27 },
  orbitDotB: { backgroundColor: "#8ED6B1", bottom: 18, left: 21 },

  aprilAura: {
    position: "absolute",
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "rgba(232,163,61,0.13)",
    borderWidth: 1,
    borderColor: "rgba(232,163,61,0.18)",
  },

  aprilBotFace: {
    width: 88,
    height: 88,
    borderRadius: 30,
    backgroundColor: "#E8A33D",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-3deg" }],
    shadowColor: "#E8A33D",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },

  aprilBotBrowRow: {
    flexDirection: "row",
    gap: 28,
    marginBottom: 7,
  },

  aprilBotBrow: {
    width: 15,
    height: 3,
    borderRadius: 3,
    backgroundColor: "rgba(11,14,20,0.52)",
  },

  aprilBotEyeRow: {
    flexDirection: "row",
    gap: 22,
    marginBottom: 10,
  },

  aprilBotEye: {
    width: 16,
    height: 21,
    borderRadius: 8,
    backgroundColor: "#0B0E14",
    alignItems: "center",
    justifyContent: "center",
  },

  aprilBotEyeGlow: {
    width: 5,
    height: 7,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
    opacity: 0.72,
  },

  aprilBotMouth: {
    width: 25,
    height: 8,
    borderRadius: 6,
    backgroundColor: "#0B0E14",
  },

  aprilBotMouthListening: {
    width: 13,
    height: 17,
    borderRadius: 9,
  },

  aprilHeroCopy: { flex: 1, paddingLeft: 15 },

  aprilNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 5,
  },

  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(142,214,177,0.09)",
    borderWidth: 1,
    borderColor: "rgba(142,214,177,0.18)",
  },

  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#8ED6B1" },
  livePillText: { color: "#8ED6B1", fontSize: 8, fontWeight: "800", letterSpacing: 1 },

  aprilHeroHint: { color: "#777D89", fontSize: 11, lineHeight: 17, marginTop: 7 },

  talkBotStage: {
    width: 224,
    height: 224,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 34,
    position: "relative",
  },

  talkOrbit: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 999,
  },

  talkOrbitOne: {
    width: 214,
    height: 214,
    borderColor: "rgba(232,163,61,0.24)",
    transform: [{ rotate: "20deg" }],
  },

  talkOrbitTwo: {
    width: 176,
    height: 176,
    borderColor: "rgba(185,168,216,0.22)",
    transform: [{ rotate: "-28deg" }],
  },

  talkOrbitDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#E8A33D",
    top: 18,
    right: 35,
  },

  talkBotAura: {
    position: "absolute",
    width: 154,
    height: 154,
    borderRadius: 77,
    backgroundColor: "rgba(232,163,61,0.12)",
    borderWidth: 1,
    borderColor: "rgba(232,163,61,0.2)",
  },

  talkBotFace: {
    width: 124,
    height: 124,
    borderRadius: 40,
    backgroundColor: "#E8A33D",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-3deg" }],
    shadowColor: "#E8A33D",
    shadowOpacity: 0.3,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  talkContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 110,
  },

  companionGlow: {
    width: 210,
    height: 210,
    borderRadius: 95,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(232, 163, 61, 0.09)",
    borderWidth: 1,
    borderColor: "rgba(232,163,61,0.16)",
    marginBottom: 42,
  },

  companion: {
    width: 150,
    height: 150,
    borderRadius: 72,
    backgroundColor: "#E8A33D",
    alignItems: "center",
    justifyContent: "center",
  },

  eyes: { flexDirection: "row", gap: 32, marginBottom: 20 },

  eye: { width: 14, height: 18, borderRadius: 9, backgroundColor: "#0B0E14" },

  mouth: { width: 28, height: 10, borderRadius: 10, backgroundColor: "#0B0E14" },

  listeningMouth: { width: 20, height: 20, borderRadius: 10 },

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
    paddingTop: 32,
    paddingBottom: 120,
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
    fontSize: 34,
    fontWeight: "600",
    letterSpacing: -0.6,
    marginTop: 5,
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#8ED6B1",
  },

  homePresence: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 28,
    padding: 10,
    paddingLeft: 0,
  },
  homePresenceOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(232,163,61,0.22)",
    backgroundColor: "rgba(232,163,61,0.045)",
  },
  homePresenceMid: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(142,214,177,0.18)",
    backgroundColor: "rgba(142,214,177,0.045)",
  },
  homePresenceCore: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#E8A33D",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#E8A33D",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  homePresenceEyes: { flexDirection: "row", gap: 12, marginBottom: 7 },
  homePresenceEye: { width: 6, height: 8, borderRadius: 4, backgroundColor: "#090C12" },
  homePresenceMouth: { width: 16, height: 5, borderRadius: 6, backgroundColor: "#090C12" },
  homePresenceCopy: { marginLeft: 16, flex: 1 },
  homePresenceLabel: { color: "#E8A33D", fontSize: 10, fontWeight: "800", letterSpacing: 2.2, marginBottom: 5 },
  homePresenceText: { color: "#D9DCE3", fontSize: 15, lineHeight: 21, maxWidth: 220 },

  question: {
    color: "#FFFFFF",
    fontSize: 31,
    fontWeight: "600",
    lineHeight: 38,
    letterSpacing: -0.5,
    marginBottom: 10,
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
    backgroundColor: "rgba(18,23,34,0.82)",
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    shadowColor: "#000000",
    shadowOpacity: 0.26,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
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

  checkInLabel: { color: "#E8A33D", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },

  checkInTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600", marginTop: 7 },

  checkInSubtitle: { color: "#A7ACB8", fontSize: 12, lineHeight: 18, marginTop: 5, paddingRight: 12 },

  checkInArrow: { color: "#E8A33D", fontSize: 24 },

  todayNoteCard: { backgroundColor: "rgba(18,23,34,0.82)", borderRadius: 24, padding: 19, marginBottom: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", shadowColor: "#000000", shadowOpacity: 0.16, shadowRadius: 22, shadowOffset: { width: 0, height: 9 }, elevation: 5 },

  todayNoteText: { color: "#FFFFFF", fontSize: 16, lineHeight: 23, marginTop: 8 },

  todayNoteMeta: { color: "#A7ACB8", fontSize: 13, lineHeight: 20, marginTop: 8 },
  todayNoteTime: { color: "#777D89", fontSize: 11, marginTop: 10 },

  insightHistoryMeta: { color: "#777D89", fontSize: 12, marginTop: -18, marginBottom: 18 },
  insightCard: {
    backgroundColor: "rgba(18,23,34,0.82)",
    borderRadius: 24,
    padding: 19,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(185,168,216,0.16)",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 9 },
    elevation: 5,
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
    backgroundColor: "rgba(18,23,34,0.82)",
    borderRadius: 24,
    padding: 21,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 9 },
    elevation: 5,
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
    backgroundColor: "rgba(18,23,34,0.82)",
    borderRadius: 22,
    padding: 19,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    shadowColor: "#000000",
    shadowOpacity: 0.13,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  settingLabel: { color: "#777D89", fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },

  settingValue: { color: "#FFFFFF", fontSize: 15, marginTop: 8 },

  nameInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#2A2F3A",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#F4F5F7",
    fontSize: 15,
  },
  nameActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    alignItems: "center",
  },
  nameRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  nameRowText: { flex: 1, paddingRight: 12 },
  nameEdit: {
    color: "#E8A33D",
    fontSize: 13,
    fontWeight: "700",
  },
  settingHint: { color: "#777D89", fontSize: 13, lineHeight: 19, marginTop: 7 },

  newConversationButton: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  newConversationText: { color: "#A7ACB8", fontSize: 13, fontWeight: "600" },
  conversationButton: { marginTop: 18, minHeight: 56, borderRadius: 18, backgroundColor: "#E8A33D", alignItems: "center", justifyContent: "center" },
  conversationButtonText: { color: "#0B0E14", fontSize: 16, fontWeight: "700" },
  voiceAnswerButton: { marginTop: 14, minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: "#343C4B", backgroundColor: "#111620", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  voiceAnswerButtonActive: { borderColor: "#E8A33D", backgroundColor: "#171A20" },
  voiceAnswerIcon: { color: "#E8A33D", fontSize: 14 },
  voiceAnswerText: { color: "#D7DAE0", fontSize: 15, fontWeight: "600" },
  checkInContent: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 110 },
  progressRow: { flexDirection: "row", gap: 6, marginTop: 8, marginBottom: 8 },
  progressDot: { width: 28, height: 4, borderRadius: 2, backgroundColor: "#252C39" },
  progressDotActive: { backgroundColor: "#E8A33D" },
  checkInStepText: { color: "#777D89", fontSize: 12, marginBottom: 18 },
  checkInQuestion: { color: "#FFFFFF", fontSize: 30, fontWeight: "600", lineHeight: 37, marginBottom: 10 },
  checkInPrompt: { color: "#A7ACB8", fontSize: 15, lineHeight: 23, marginBottom: 24 },
  checkInInput: { minHeight: 130, backgroundColor: "rgba(18,23,34,0.78)", borderWidth: 1, borderColor: "rgba(255,255,255,0.11)", borderRadius: 24, color: "#FFFFFF", fontSize: 17, lineHeight: 25, paddingHorizontal: 18, paddingVertical: 17, textAlignVertical: "top" },
  checkInMessage: { color: "#E8A33D", fontSize: 13, lineHeight: 19, marginTop: 12 },
  checkInActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 22 },
  backButton: { paddingVertical: 15, paddingHorizontal: 16 },
  backButtonText: { color: "#A7ACB8", fontSize: 15, fontWeight: "600" },
  checkInRecorded: { color: "#777D89", fontSize: 12, marginTop: -14, marginBottom: 18 },
  contextNoteCard: { backgroundColor: "#211F1A", borderRadius: 18, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: "#3A3325" },
  contextNoteLabel: { color: "#E8A33D", fontSize: 9, fontWeight: "800", letterSpacing: 1.4, marginBottom: 7 },
  contextNoteText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },
  contextNoteHint: { color: "#A7ACB8", fontSize: 12, lineHeight: 18, marginTop: 8 },
  checkInSummaryCard: { backgroundColor: "#151A24", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#252C39", marginBottom: 22 },
  summaryLabel: { color: "#E8A33D", fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginBottom: 10 },
  summaryText: { color: "#FFFFFF", fontSize: 18, lineHeight: 26, marginBottom: 12 },
  summaryLine: { color: "#A7ACB8", fontSize: 14, lineHeight: 22, marginTop: 4 },

  timelineDayLabel: {
    color: "#E8A33D",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginTop: 18,
    marginBottom: 8,
  },
  filterRow: {
    gap: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  filterChip: {
    borderWidth: 1,
    borderColor: "#2A2F3A",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterChipActive: {
    borderColor: "#E8A33D",
    backgroundColor: "#171A20",
  },
  filterChipText: {
    color: "#9EA4B0",
    fontSize: 12,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#E8A33D",
  },
  timelineUpdated: { color: "#777D89", fontSize: 12, marginTop: -18, marginBottom: 4 },
  timelineCoverage: { color: "#5F6672", fontSize: 11, marginBottom: 18 },
  timeline: { marginTop: 8 },
  timelineItem: { flexDirection: "row", marginBottom: 12 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E8A33D", marginTop: 24, marginRight: 12 },
  timelineCard: { flex: 1, backgroundColor: "rgba(18,23,34,0.78)", borderRadius: 22, padding: 17, borderWidth: 1, borderColor: "rgba(255,255,255,0.09)", shadowColor: "#000000", shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 7 }, elevation: 3 },
  timelineCategory: { color: "#E8A33D", fontSize: 9, fontWeight: "800", letterSpacing: 1.3, marginBottom: 6 },
  timelineTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "600", marginBottom: 5 },
  timelineText: { color: "#A7ACB8", fontSize: 14, lineHeight: 21 },
  timelineDate: { color: "#777D89", fontSize: 11, marginTop: 10 },
  tabBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
    height: 72,
    borderRadius: 30,
    backgroundColor: "rgba(12,16,25,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    shadowColor: "#000000",
    shadowOpacity: 0.30,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 4,
  },

  tab: { flex: 1, height: 56, marginHorizontal: 2, borderRadius: 22, alignItems: "center", justifyContent: "center", gap: 5 },
  tabActive: { backgroundColor: "rgba(232,163,61,0.10)", borderWidth: 1, borderColor: "rgba(232,163,61,0.16)" },

  tabMark: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#4C5360",
  },

  tabMarkActive: { width: 24, height: 4, backgroundColor: "#E8A33D" },

  tabLabel: { color: "#777D89", fontSize: 10, letterSpacing: 0.2 },

  tabLabelActive: { color: "#FFFFFF", fontWeight: "600" },
});
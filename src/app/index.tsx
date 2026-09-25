import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

export default function HomeScreen() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aprilResponse, setAprilResponse] = useState("");

  const pulse = useRef(new Animated.Value(1)).current;
  const latestTranscript = useRef("");

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
      setAprilResponse(
        "Thank you for telling me. I’m here to listen."
      );
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    console.log("Speech recognition error:", event.error);
    setIsListening(false);
  });

  const startListening = async () => {
    const permission =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync();

    if (!permission.granted) {
      console.log("Speech recognition permission was not granted.");
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>APRIL</Text>

        <Animated.View
          style={[
            styles.companionGlow,
            {
              transform: [{ scale: pulse }],
            },
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
          {isListening
            ? "I’m listening."
            : "How are you feeling today?"}
        </Text>

        <Text style={styles.subtitle}>
          {isListening
            ? "Take your time. I’m here."
            : "Your personal health & wellbeing companion."}
        </Text>

        {transcript.length > 0 && (
          <View style={styles.transcriptBox}>
            <Text style={styles.transcriptLabel}>I heard:</Text>

            <Text style={styles.transcript}>
              {transcript}
            </Text>
          </View>
        )}

        {aprilResponse.length > 0 && (
          <View style={styles.responseBox}>
            <Text style={styles.responseLabel}>APRIL</Text>

            <Text style={styles.response}>
              {aprilResponse}
            </Text>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0E14",
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

  eyes: {
    flexDirection: "row",
    gap: 32,
    marginBottom: 20,
  },

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

  transcript: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 25,
  },

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

  response: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 25,
  },

  button: {
    backgroundColor: "#E8A33D",
    paddingVertical: 16,
    paddingHorizontal: 34,
    borderRadius: 30,
    minWidth: 150,
    alignItems: "center",
  },

  buttonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },

  buttonText: {
    color: "#0B0E14",
    fontSize: 16,
    fontWeight: "700",
  },
});
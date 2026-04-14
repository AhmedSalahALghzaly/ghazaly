import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Modal, SafeAreaView, Platform, StatusBar, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { createShadow } from '../../utils/shadowUtils';
import AiAgentTab from '../chat/AiAgentTab';
import { useChat } from '../../hooks/useChat';
import { useTranslation } from '../../hooks/useTranslation';
import { useTheme } from '../../hooks/useTheme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BTN_SIZE = 50;
const EDGE_MARGIN = 16;

export default function FloatingAiAgentIcon() {
  const { colors } = useTheme();
  const { isRTL } = useTranslation();
  const {
    aiMessages,
    sending,
    sendAiMessage,
    setAiConversationId,
  } = useChat();

  const [modalVisible, setModalVisible] = useState(false);

  const posX = useSharedValue(EDGE_MARGIN);
  const posY = useSharedValue(SCREEN_H * 0.55);
  const isDragging = useSharedValue(false);
  const bobOffset = useSharedValue(0);

  const glowPulse = useSharedValue(1);

  useEffect(() => {
    bobOffset.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );

    glowPulse.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  const snapToEdge = () => {
    'worklet';
    const targetX =
      posX.value + BTN_SIZE / 2 < SCREEN_W / 2
        ? EDGE_MARGIN
        : SCREEN_W - BTN_SIZE - EDGE_MARGIN;
    const clampedY = Math.max(
      EDGE_MARGIN,
      Math.min(posY.value, SCREEN_H - BTN_SIZE - EDGE_MARGIN - 80),
    );
    posX.value = withSpring(targetX, { damping: 18, stiffness: 180 });
    posY.value = withSpring(clampedY, { damping: 18, stiffness: 180 });
  };

  const openAiChat = () => setModalVisible(true);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const wasDragged = useSharedValue(false);

  const panGesture = Gesture.Pan()
    .onBegin(() => {
      isDragging.value = true;
      startX.value = posX.value;
      startY.value = posY.value;
      wasDragged.value = false;
    })
    .onUpdate((e) => {
      if (Math.abs(e.translationX) > 4 || Math.abs(e.translationY) > 4) {
        wasDragged.value = true;
      }
      posX.value = startX.value + e.translationX;
      posY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      isDragging.value = false;
      snapToEdge();
      if (!wasDragged.value) runOnJS(openAiChat)();
    });

  const tapGesture = Gesture.Tap().onEnd(() => runOnJS(openAiChat)());

  const composed = Gesture.Exclusive(panGesture, tapGesture);

  const containerStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: posX.value,
    top: posY.value + (isDragging.value ? 0 : bobOffset.value),
    zIndex: 998,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowPulse.value }],
    opacity: 0.4,
  }));

  return (
    <>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.wrapper, containerStyle]}>
          <Animated.View style={[styles.glow, glowStyle]} />
          <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.button}>
            <Ionicons name="sparkles" size={22} color="#fff" />
          </LinearGradient>
          <View style={styles.labelBadge}>
            <Text style={styles.labelText}>AI</Text>
          </View>
        </Animated.View>
      </GestureDetector>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => setModalVisible(false)}
              style={styles.modalBackBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name={isRTL ? 'chevron-forward' : 'chevron-back'}
                size={24}
                color="#fff"
              />
            </TouchableOpacity>
            <View style={styles.modalHeaderCenter}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="sparkles" size={18} color="#FFD700" />
                <Text style={styles.modalTitle}>
                  {isRTL ? 'المساعد الذكي' : 'AI Assistant'}
                </Text>
              </View>
              <Text style={styles.modalSubtitle}>
                {isRTL ? 'غزالي بوت — جاهز لمساعدتك' : 'GhazalyBot — Ready to help'}
              </Text>
            </View>
            <View style={styles.modalHeaderRight}>
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>AI</Text>
              </View>
            </View>
          </LinearGradient>

          <AiAgentTab
            aiMessages={aiMessages}
            sending={sending}
            isRTL={isRTL}
            onSend={sendAiMessage}
            onSetAiConversationId={setAiConversationId}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    ...createShadow('#7C3AED', 0, 6, 0.4, 14, 8),
    borderRadius: 14,
  },
  glow: {
    position: 'absolute',
    width: BTN_SIZE + 16,
    height: BTN_SIZE + 16,
    borderRadius: (BTN_SIZE + 16) / 2,
    backgroundColor: '#7C3AED',
    top: -8,
    left: -8,
  },
  button: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
  },
  labelBadge: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: '#FFD700',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  labelText: {
    color: '#1a1a1a',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    paddingTop:
      Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) + 14 : 14,
  },
  modalBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderCenter: { flex: 1, alignItems: 'center' },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  modalSubtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  modalHeaderRight: { width: 36, alignItems: 'center', justifyContent: 'center' },
  aiBadge: {
    backgroundColor: '#FFD700',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  aiBadgeText: {
    color: '#1a1a1a',
    fontSize: 11,
    fontWeight: '900',
  },
});

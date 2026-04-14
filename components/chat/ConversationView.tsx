import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { useTheme } from '../../hooks/useTheme';
import { Message, Conversation } from '../../hooks/useChat';
import { chatApi, customerApi } from '../../services/api';

interface CustomerInfo {
  id?: string;
  user_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
}

interface Props {
  conversation: Conversation;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  currentUserId?: string;
  isPrivileged: boolean;
  isOwner: boolean;
  customerInfo?: CustomerInfo;
  readOnly?: boolean;
  onSend: (content: string, message_type?: string, file_url?: string) => void;
  onBack: () => void;
  onArchive?: (id: string) => void;
  isRTL: boolean;
  suggestedReplies?: string[];
  suggestionsLoading?: boolean;
  onUseSuggestedReply?: (text: string) => void;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ساعة`;
  if (hrs < 48)
    return `أمس ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short' });
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short' });
}

function TypeIcon({ type }: { type: string }) {
  if (type === 'file') return <Ionicons name="document-attach-outline" size={13} color="currentColor" />;
  if (type === 'voice' || type === 'audio') return <Ionicons name="mic-outline" size={13} color="currentColor" />;
  if (type === 'image') return <Ionicons name="image-outline" size={13} color="currentColor" />;
  return null;
}

// ─── WhatsApp-style Media Bubbles ──────────────────────────────────────────

function AudioPlayerBubble({ url, mine }: { url: string; mine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const bars = useRef(Array.from({ length: 20 }, () => new Animated.Value(0.3))).current;
  const animsRef = useRef<Animated.CompositeAnimation[]>([]);

  const startWave = () => {
    animsRef.current.forEach((a) => a.stop());
    animsRef.current = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 50),
          Animated.timing(b, { toValue: 0.2 + Math.random() * 0.8, duration: 250 + Math.floor(Math.random() * 200), useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.15 + Math.random() * 0.4, duration: 250 + Math.floor(Math.random() * 200), useNativeDriver: true }),
        ]),
      ),
    );
    animsRef.current.forEach((a) => a.start());
  };

  const stopWave = () => {
    animsRef.current.forEach((a) => a.stop());
    bars.forEach((b) => Animated.timing(b, { toValue: 0.3, duration: 200, useNativeDriver: true }).start());
  };

  const toggle = async () => {
    if (playing) {
      await soundRef.current?.pauseAsync().catch(() => {});
      setPlaying(false);
      stopWave();
      return;
    }
    setLoading(true);
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        const { sound } = await Audio.Sound.createAsync({ uri: url });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlaying(false);
            stopWave();
            soundRef.current?.unloadAsync().catch(() => {});
            soundRef.current = null;
          }
        });
      }
      await soundRef.current.playAsync();
      setPlaying(true);
      startWave();
    } catch {
      Alert.alert('خطأ', 'تعذّر تشغيل الصوت');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
      animsRef.current.forEach((a) => a.stop());
    };
  }, []);

  return (
    <View style={media.audioRow}>
      <TouchableOpacity onPress={toggle} disabled={loading} style={[media.playBtn, { backgroundColor: mine ? 'rgba(255,255,255,0.2)' : '#7C3AED20' }]}>
        {loading ? (
          <ActivityIndicator size="small" color={mine ? '#fff' : '#7C3AED'} />
        ) : (
          <Ionicons name={playing ? 'pause' : 'play'} size={20} color={mine ? '#fff' : '#7C3AED'} />
        )}
      </TouchableOpacity>
      <View style={media.waveWrap}>
        {bars.map((b, i) => (
          <Animated.View
            key={i}
            style={[
              media.waveBar,
              { backgroundColor: mine ? 'rgba(255,255,255,0.7)' : '#7C3AED80', transform: [{ scaleY: b }] },
            ]}
          />
        ))}
      </View>
      <Ionicons name="mic" size={14} color={mine ? 'rgba(255,255,255,0.6)' : '#7C3AED60'} />
    </View>
  );
}

function ImageBubble({ url, mine }: { url: string; mine: boolean }) {
  const [lightbox, setLightbox] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setLightbox(true)} activeOpacity={0.85}>
        <Image
          source={{ uri: url }}
          style={media.imgThumb}
          resizeMode="cover"
        />
      </TouchableOpacity>
      <Modal visible={lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(false)}>
        <TouchableOpacity
          style={media.lightboxOverlay}
          onPress={() => setLightbox(false)}
          activeOpacity={1}
        >
          <Image source={{ uri: url }} style={media.lightboxImg} resizeMode="contain" />
          <TouchableOpacity style={media.lightboxClose} onPress={() => setLightbox(false)}>
            <Ionicons name="close-circle" size={34} color="#fff" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function FileBubble({ url, name, mine }: { url: string; name: string; mine: boolean }) {
  const { colors } = useTheme();
  const handleDownload = () => {
    Linking.openURL(url).catch(() => Alert.alert('خطأ', 'تعذّر فتح الملف'));
  };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const isDoc = ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(ext);
  return (
    <TouchableOpacity onPress={handleDownload} activeOpacity={0.8} style={[media.fileCard, { backgroundColor: mine ? 'rgba(255,255,255,0.15)' : '#7C3AED12' }]}>
      <Ionicons name={isDoc ? 'document-text-outline' : 'attach-outline'} size={24} color={mine ? '#fff' : '#7C3AED'} />
      <View style={{ flex: 1 }}>
        <Text style={[media.fileName, { color: mine ? '#fff' : colors.text }]} numberOfLines={1}>{name}</Text>
        <Text style={[media.fileAction, { color: mine ? 'rgba(255,255,255,0.6)' : '#7C3AED' }]}>اضغط للتحميل</Text>
      </View>
      <Ionicons name="download-outline" size={18} color={mine ? 'rgba(255,255,255,0.7)' : '#7C3AED'} />
    </TouchableOpacity>
  );
}

function LinkText({ text, mine }: { text: string; mine: boolean }) {
  const { colors } = useTheme();
  const urlRegex = /https?:\/\/[^\s]+/g;
  const parts: { part: string; isUrl: boolean }[] = [];
  let last = 0;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > last) parts.push({ part: text.slice(last, match.index), isUrl: false });
    parts.push({ part: match[0], isUrl: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ part: text.slice(last), isUrl: false });
  const textColor = mine ? '#fff' : colors.text;
  if (parts.length <= 1 && !parts[0]?.isUrl) return <Text style={[cv.bubbleText, { color: textColor }]}>{text}</Text>;
  return (
    <Text style={[cv.bubbleText, { color: textColor }]}>
      {parts.map((p, i) =>
        p.isUrl ? (
          <Text key={i} style={{ color: mine ? '#A5F3FC' : '#3B82F6', textDecorationLine: 'underline' }} onPress={() => Linking.openURL(p.part).catch(() => {})}>
            {p.part}
          </Text>
        ) : (
          <Text key={i}>{p.part}</Text>
        )
      )}
    </Text>
  );
}

const media = StyleSheet.create({
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, minWidth: 160 },
  playBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  waveWrap: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1, height: 32 },
  waveBar: { width: 3, height: 24, borderRadius: 2 },
  imgThumb: { width: 180, height: 180, borderRadius: 12, marginVertical: 4 },
  lightboxOverlay: { flex: 1, backgroundColor: '#000000EE', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '95%', height: '80%' },
  lightboxClose: { position: 'absolute', top: 50, right: 16 },
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, minWidth: 180 },
  fileName: { fontSize: 13, fontWeight: '600' },
  fileAction: { fontSize: 11, marginTop: 2 },
});

function CustomerInfoBar({
  conversation,
  customerInfo,
  isRTL,
  isPrivileged,
}: {
  conversation: Conversation;
  customerInfo?: CustomerInfo;
  isRTL: boolean;
  isPrivileged: boolean;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const [fetched, setFetched] = useState<CustomerInfo | null>(null);

  useEffect(() => {
    if (customerInfo) return;
    if (!conversation.user_id) return;
    customerApi
      .getById(conversation.user_id)
      .then((res) => {
        const d = res.data?.customer ?? res.data ?? null;
        if (d) setFetched(d);
      })
      .catch(() => {});
  }, [conversation.user_id, customerInfo]);

  const info = customerInfo ?? fetched ?? {};
  const displayName =
    info.name ?? conversation.user_name ?? conversation.user_email ?? 'عميل';
  const email = info.email ?? conversation.user_email ?? '';
  const phone = info.phone ?? '';
  const isOpen = conversation.status === 'open' || conversation.status === 'active';

  const goToProfile = () => {
    if (isPrivileged) router.push('/admin/customers');
  };

  return (
    <TouchableOpacity
      activeOpacity={isPrivileged ? 0.8 : 1}
      onPress={goToProfile}
      style={[
        bar.container,
        { backgroundColor: colors.surface, borderBottomColor: colors.border },
      ]}
    >
      <View style={bar.avatarWrap}>
        <View style={[bar.avatarCircle, { backgroundColor: colors.primary + '25' }]}>
          <Ionicons name="person" size={26} color={colors.primary} />
        </View>
        {isOpen && <View style={bar.dot} />}
      </View>
      <View style={bar.info}>
        <Text style={[bar.name, { color: colors.text }]} numberOfLines={1}>
          {displayName}
        </Text>
        {phone ? (
          <Text style={[bar.meta, { color: colors.textSecondary }]}>📞 {phone}</Text>
        ) : email ? (
          <Text style={[bar.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            ✉ {email}
          </Text>
        ) : null}
        <View style={bar.statusRow}>
          <View style={[bar.statusDot, { backgroundColor: isOpen ? '#10B981' : '#9CA3AF' }]} />
          <Text style={[bar.statusText, { color: isOpen ? '#10B981' : colors.textSecondary }]}>
            {isOpen ? 'نشط' : 'مغلق'}
          </Text>
        </View>
      </View>
      {isPrivileged && (
        <Ionicons
          name={isRTL ? 'chevron-back' : 'chevron-forward'}
          size={18}
          color={colors.textSecondary}
        />
      )}
    </TouchableOpacity>
  );
}

const bar = StyleSheet.create({
  container: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatarWrap: { position: 'relative' },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#fff',
  },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 17, fontWeight: '700' },
  meta: { fontSize: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusText: { fontSize: 11, fontWeight: '600' },
});

function useTimer(running: boolean): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    setSecs(0);
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function WaveformBars({ active }: { active: boolean }) {
  const bars = useRef(
    Array.from({ length: 18 }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => Animated.timing(b, { toValue: 0.3, duration: 200, useNativeDriver: true }).start());
      return;
    }
    const anims = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 60),
          Animated.timing(b, {
            toValue: 0.2 + Math.random() * 0.8,
            duration: 300 + Math.floor(Math.random() * 200),
            useNativeDriver: true,
          }),
          Animated.timing(b, {
            toValue: 0.15 + Math.random() * 0.4,
            duration: 300 + Math.floor(Math.random() * 200),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [active]);

  return (
    <View style={vm.waveRow}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            vm.waveBar,
            { transform: [{ scaleY: b }] },
          ]}
        />
      ))}
    </View>
  );
}

const vm = StyleSheet.create({
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 56,
    paddingHorizontal: 4,
  },
  waveBar: {
    width: 4,
    height: 48,
    borderRadius: 3,
    backgroundColor: '#7C3AED',
  },
});

interface VoiceModalProps {
  visible: boolean;
  onClose: () => void;
  onSend: (uri: string | null, durationSecs: number) => void;
}

function VoiceRecordingModal({ visible, onClose, onSend }: VoiceModalProps) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const timer = useTimer(recording);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingRef = useRef<Audio.Recording | null>(null);
  const mediaRecorderWebRef = useRef<any>(null);
  const audioChunksWebRef = useRef<any[]>([]);

  const parseSeconds = () => {
    const [m, s] = timer.split(':').map(Number);
    return m * 60 + s;
  };

  const stopRecordingCleanup = async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (rec) {
      try { await rec.stopAndUnloadAsync(); } catch {}
    }
    const mr = mediaRecorderWebRef.current;
    if (mr) {
      try { mr.stop(); } catch {}
      try { mr.stream?.getTracks?.()?.forEach((t: any) => t.stop()); } catch {}
      mediaRecorderWebRef.current = null;
    }
    audioChunksWebRef.current = [];
    try {
      if (Platform.OS !== 'web') await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {}
  };

  const startRecordingSession = async () => {
    setError(null);
    setInitializing(true);
    try {
      if (Platform.OS === 'web') {
        const nav = navigator as any;
        if (!nav.mediaDevices?.getUserMedia) {
          setError('المتصفح لا يدعم التسجيل الصوتي');
          return;
        }
        let stream: MediaStream;
        try {
          stream = await nav.mediaDevices.getUserMedia({ audio: true });
        } catch (e: any) {
          if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
            setError('تم رفض إذن الميكروفون — يرجى السماح بالوصول في إعدادات المتصفح');
          } else {
            setError('تعذّر الوصول إلى الميكروفون — تأكد من توصيله وإعادة المحاولة');
          }
          return;
        }
        const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm'))
          ? 'audio/webm'
          : 'audio/ogg';
        const mr = new MediaRecorder(stream, { mimeType });
        audioChunksWebRef.current = [];
        mr.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) audioChunksWebRef.current.push(e.data);
        };
        mr.start();
        mediaRecorderWebRef.current = mr;
        setRecording(true);
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          setError('يجب منح إذن الميكروفون من إعدادات التطبيق للتسجيل الصوتي');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        recordingRef.current = rec;
        setRecording(true);
      }
    } catch {
      setError('حدث خطأ غير متوقع — يرجى إغلاق المودال والمحاولة مجدداً');
    } finally {
      setInitializing(false);
    }
  };

  useEffect(() => {
    if (!visible) {
      setRecording(false);
      setError(null);
      setInitializing(false);
      stopRecordingCleanup();
      return;
    }
    startRecordingSession();
    return () => { stopRecordingCleanup(); };
  }, [visible]);

  useEffect(() => {
    if (recording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.25, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [recording]);

  const handleSend = async () => {
    setRecording(false);
    setUploading(true);
    try {
      if (Platform.OS === 'web') {
        const mr = mediaRecorderWebRef.current;
        if (!mr) { onSend(null, 0); return; }
        const mimeType = mr.mimeType || 'audio/webm';
        await new Promise<void>((resolve) => {
          mr.onstop = () => resolve();
          mr.stop();
        });
        try { mr.stream?.getTracks?.()?.forEach((t: any) => t.stop()); } catch {}
        mediaRecorderWebRef.current = null;
        const blob = new Blob(audioChunksWebRef.current, { type: mimeType });
        audioChunksWebRef.current = [];
        const blobUrl = URL.createObjectURL(blob);
        onSend(blobUrl, parseSeconds());
      } else {
        const rec = recordingRef.current;
        recordingRef.current = null;
        if (rec) {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          onSend(uri ?? null, parseSeconds());
        } else {
          onSend(null, 0);
        }
      }
    } catch {
      onSend(null, 0);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = async () => {
    setRecording(false);
    await stopRecordingCleanup();
    onClose();
  };

  const handlePauseResume = async () => {
    if (Platform.OS === 'web') {
      const mr = mediaRecorderWebRef.current;
      if (!mr) return;
      try {
        if (mr.state === 'recording') {
          mr.pause();
          setRecording(false);
        } else if (mr.state === 'paused') {
          mr.resume();
          setRecording(true);
        }
      } catch {}
      return;
    }
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      const status = await rec.getStatusAsync();
      if ((status as any).isRecording) {
        await rec.pauseAsync();
        setRecording(false);
      } else {
        await rec.startAsync();
        setRecording(true);
      }
    } catch {}
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <View style={rec.overlay}>
        <View style={rec.sheet}>
          <View style={rec.handle} />

          <Text style={rec.title}>تسجيل رسالة صوتية</Text>

          {error ? (
            <>
              <View style={rec.errorBox}>
                <Ionicons name="mic-off-outline" size={40} color="#EF4444" />
                <Text style={rec.errorText}>{error}</Text>
              </View>
              <View style={rec.btnRow}>
                <TouchableOpacity style={rec.cancelBtn} onPress={handleCancel} activeOpacity={0.8}>
                  <Ionicons name="close-outline" size={22} color="#EF4444" />
                  <Text style={[rec.btnLabel, { color: '#EF4444' }]}>إغلاق</Text>
                </TouchableOpacity>
                <TouchableOpacity style={rec.retryBtn} onPress={startRecordingSession} activeOpacity={0.8}>
                  <Ionicons name="refresh-outline" size={22} color="#fff" />
                  <Text style={[rec.btnLabel, { color: '#fff' }]}>إعادة المحاولة</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : initializing ? (
            <>
              <View style={rec.errorBox}>
                <ActivityIndicator size="large" color="#7C3AED" />
                <Text style={[rec.errorText, { color: '#6B7280' }]}>جارٍ تفعيل الميكروفون...</Text>
              </View>
              <TouchableOpacity style={rec.cancelBtn} onPress={handleCancel} activeOpacity={0.8}>
                <Ionicons name="close-outline" size={22} color="#EF4444" />
                <Text style={[rec.btnLabel, { color: '#EF4444' }]}>إلغاء</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={rec.waveWrap}>
                <WaveformBars active={recording} />
              </View>

              <Text style={rec.timer}>{timer}</Text>
              <Text style={rec.hint}>
                {uploading ? '⏳ جاري الإرسال...' : recording ? '● جاري التسجيل...' : '⏸ متوقف'}
              </Text>

              <View style={rec.btnRow}>
                <TouchableOpacity style={rec.cancelBtn} onPress={handleCancel} disabled={uploading} activeOpacity={0.8}>
                  <Ionicons name="trash-outline" size={22} color="#EF4444" />
                  <Text style={[rec.btnLabel, { color: '#EF4444' }]}>إلغاء</Text>
                </TouchableOpacity>

                <Animated.View style={[rec.micWrap, { transform: [{ scale: pulseAnim }] }]}>
                  <TouchableOpacity
                    style={[rec.micBtn, { backgroundColor: recording ? '#EF4444' : '#6B7280' }]}
                    onPress={handlePauseResume}
                    disabled={uploading}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={recording ? 'stop' : 'mic'} size={28} color="#fff" />
                  </TouchableOpacity>
                </Animated.View>

                <TouchableOpacity
                  style={[rec.sendBtn, { opacity: (parseSeconds() > 0 && !uploading) ? 1 : 0.4 }]}
                  onPress={handleSend}
                  disabled={parseSeconds() === 0 || uploading}
                  activeOpacity={0.8}
                >
                  {uploading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="send" size={22} color="#fff" />
                  }
                  <Text style={[rec.btnLabel, { color: '#fff' }]}>{uploading ? '...' : 'إرسال'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const rec = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    alignItems: 'center',
    gap: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 4,
  },
  waveWrap: {
    width: '100%',
    backgroundColor: '#7C3AED10',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  timer: {
    fontSize: 36,
    fontWeight: '800',
    color: '#7C3AED',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 8,
    paddingHorizontal: 8,
  },
  cancelBtn: {
    alignItems: 'center',
    gap: 4,
    width: 72,
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#EF444415',
  },
  micWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239,68,68,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  sendBtn: {
    alignItems: 'center',
    gap: 4,
    width: 72,
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#10B981',
  },
  btnLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorBox: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    width: '100%',
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#7C3AED',
    marginStart: 12,
  },
});

interface QaChip {
  id: string;
  question: string;
  answer: string;
  category: string | null;
}

interface PendingFile {
  id: string;
  name: string;
}

export default function ConversationView({
  conversation,
  messages,
  loading,
  sending,
  currentUserId,
  isPrivileged,
  isOwner,
  customerInfo,
  readOnly = false,
  onSend,
  onBack,
  onArchive,
  isRTL,
  suggestedReplies = [],
  suggestionsLoading = false,
  onUseSuggestedReply,
}: Props) {
  const { colors } = useTheme();
  const [inputText, setInputText] = useState('');
  const [fetchingAi, setFetchingAi] = useState(false);
  const [showNewMsgChip, setShowNewMsgChip] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [voiceModalVisible, setVoiceModalVisible] = useState(false);
  const [aiAutoReply, setAiAutoReply] = useState<boolean>(
    conversation.ai_auto_reply !== false,
  );
  const [togglingAi, setTogglingAi] = useState(false);
  const [qaChips, setQaChips] = useState<QaChip[]>([]);
  const [sendingChip, setSendingChip] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const isAtBottomRef = useRef(true);
  const prevCountRef = useRef(messages.length);

  // Fetch QA chips for customers
  useEffect(() => {
    if (isPrivileged) return;
    chatApi.getQuickReplies()
      .then(res => setQaChips(res.data?.chips ?? []))
      .catch(() => {});
  }, [isPrivileged]);

  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      if (isAtBottomRef.current) {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
      } else {
        setShowNewMsgChip(true);
      }
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const dist = contentSize.height - contentOffset.y - layoutMeasurement.height;
      isAtBottomRef.current = dist < 60;
      if (isAtBottomRef.current && showNewMsgChip) setShowNewMsgChip(false);
    },
    [showNewMsgChip],
  );

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    onSend(text);
  }, [inputText, onSend]);

  const uriToBase64 = useCallback(async (uri: string): Promise<string> => {
    if (uri.startsWith('file://') && FileSystem.readAsStringAsync) {
      return FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    }
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      if (typeof FileReader !== 'undefined') {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      } else {
        blob.arrayBuffer().then(buf => {
          const bytes = new Uint8Array(buf);
          let binary = '';
          bytes.forEach(b => { binary += String.fromCharCode(b); });
          resolve(btoa(binary));
        }).catch(reject);
      }
    });
  }, []);

  const handleAttach = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const pfId = `pf-${Date.now()}`;
      setPendingFiles((prev) => [...prev, { id: pfId, name: asset.name ?? 'ملف' }]);
      try {
        const base64 = await uriToBase64(asset.uri);
        const uploadRes = await chatApi.uploadFile({
          data: base64,
          content_type: asset.mimeType ?? 'application/octet-stream',
          file_name: asset.name ?? 'file',
        });
        const { downloadURL } = uploadRes.data;
        const mimeType = asset.mimeType ?? '';
        const messageType = mimeType.startsWith('image/') ? 'image' : 'file';
        onSend(asset.name ?? 'ملف', messageType, downloadURL);
      } catch (err: any) {
        Alert.alert('خطأ', err?.response?.data?.detail ?? 'فشل رفع الملف، تحقق من اتصالك بالإنترنت');
      } finally {
        setPendingFiles((prev) => prev.filter((f) => f.id !== pfId));
      }
    } catch {}
  }, [onSend, uriToBase64]);

  const handleCamera = useCallback(async () => {
    Alert.alert(
      'إضافة صورة',
      'اختر مصدر الصورة',
      [
        {
          text: 'الكاميرا',
          onPress: async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('إذن مطلوب', 'يرجى السماح للتطبيق باستخدام الكاميرا');
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: true,
              quality: 0.85,
            });
            if (result.canceled || !result.assets?.[0]) return;
            const asset = result.assets[0];
            const pfId = `pf-${Date.now()}`;
            setPendingFiles((prev) => [...prev, { id: pfId, name: 'صورة من الكاميرا' }]);
            try {
              const base64 = await uriToBase64(asset.uri);
              const uploadRes = await chatApi.uploadFile({
                data: base64,
                content_type: asset.mimeType ?? 'image/jpeg',
                file_name: `camera-${Date.now()}.jpg`,
              });
              const { downloadURL } = uploadRes.data;
              onSend('', 'image', downloadURL);
            } catch {
              Alert.alert('خطأ', 'فشل رفع الصورة');
            } finally {
              setPendingFiles((prev) => prev.filter((f) => f.id !== pfId));
            }
          },
        },
        {
          text: 'معرض الصور',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert('إذن مطلوب', 'يرجى السماح للتطبيق بالوصول للصور');
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: true,
              quality: 0.85,
            });
            if (result.canceled || !result.assets?.[0]) return;
            const asset = result.assets[0];
            const pfId = `pf-${Date.now()}`;
            setPendingFiles((prev) => [...prev, { id: pfId, name: 'صورة من المعرض' }]);
            try {
              const base64 = await uriToBase64(asset.uri);
              const uploadRes = await chatApi.uploadFile({
                data: base64,
                content_type: asset.mimeType ?? 'image/jpeg',
                file_name: `gallery-${Date.now()}.jpg`,
              });
              const { downloadURL } = uploadRes.data;
              onSend('', 'image', downloadURL);
            } catch {
              Alert.alert('خطأ', 'فشل رفع الصورة');
            } finally {
              setPendingFiles((prev) => prev.filter((f) => f.id !== pfId));
            }
          },
        },
        { text: 'إلغاء', style: 'cancel' },
      ],
    );
  }, [onSend, uriToBase64]);

  const handleMic = useCallback(() => {
    setVoiceModalVisible(true);
  }, []);

  const handleAiToggle = useCallback(async () => {
    if (togglingAi) return;
    setTogglingAi(true);
    const next = !aiAutoReply;
    setAiAutoReply(next);
    try {
      await chatApi.toggleAiAutoReply(conversation.id, next);
    } catch {
      setAiAutoReply(!next);
      Alert.alert('خطأ', 'فشل تغيير إعداد الرد التلقائي');
    } finally {
      setTogglingAi(false);
    }
  }, [togglingAi, aiAutoReply, conversation.id]);

  const handleVoiceSend = useCallback(async (uri: string | null, durationSecs: number) => {
    setVoiceModalVisible(false);
    const label = durationSecs > 0
      ? (Math.floor(durationSecs / 60) > 0
        ? `${Math.floor(durationSecs / 60)}:${String(durationSecs % 60).padStart(2, '0')}`
        : `${durationSecs}ث`)
      : '';
    if (!uri) {
      onSend(`🎤 رسالة صوتية${label ? ` (${label})` : ''}`, 'text');
      return;
    }
    try {
      const base64 = await uriToBase64(uri);
      const uploadRes = await chatApi.uploadFile({
        data: base64,
        content_type: 'audio/m4a',
        file_name: `voice-${Date.now()}.m4a`,
      });
      const { downloadURL } = uploadRes.data;
      onSend(`🎤 رسالة صوتية${label ? ` (${label})` : ''}`, 'audio', downloadURL);
    } catch {
      onSend(`🎤 رسالة صوتية${label ? ` (${label})` : ''}`, 'text');
    }
  }, [onSend, uriToBase64]);

  const handleChipTap = useCallback(async (chip: QaChip) => {
    if (sendingChip) return;
    setSendingChip(chip.id);
    try {
      await chatApi.sendQuickReply({
        conversation_id: conversation.id,
        qa_id: chip.id,
      });
      // Scroll to end after reply arrives
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 500);
    } catch {
      Alert.alert('خطأ', 'تعذّر إرسال السؤال. حاول مجدداً.');
    } finally {
      setSendingChip(null);
    }
  }, [conversation.id, sendingChip]);

  const handleAiAssist = useCallback(async () => {
    if (fetchingAi || sending) return;
    setFetchingAi(true);
    try {
      const hint = inputText.trim() || undefined;
      const res = await chatApi.getAiAssist({
        conversation_id: conversation.id,
        hint,
      });
      const suggestion: string = res.data?.response ?? '';
      if (suggestion) {
        setInputText(suggestion.slice(0, 1000));
      } else {
        Alert.alert('AI Assist', 'لم يتم الحصول على اقتراح. حاول مجدداً.');
      }
    } catch {
      Alert.alert('خطأ', 'فشل الاتصال بالمساعد الذكي.');
    } finally {
      setFetchingAi(false);
    }
  }, [conversation.id, inputText, fetchingAi, sending]);

  const isMine = (msg: Message) => {
    if (isPrivileged) return msg.sender_type === 'admin' || msg.sender_type === 'owner';
    return msg.sender_type === 'customer';
  };

  const renderMessage = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const mine = isMine(item);
      const isAi = item.sender_type === 'ai_agent';
      const prev = messages[index - 1];
      const showDate =
        !prev ||
        new Date(item.created_at).toDateString() !== new Date(prev.created_at).toDateString();
      const hasType = item.message_type && item.message_type !== 'text';

      return (
        <View>
          {showDate && (
            <View style={cv.dateSep}>
              <Text
                style={[
                  cv.dateSepText,
                  { color: colors.textSecondary, backgroundColor: colors.background },
                ]}
              >
                {dateLabel(item.created_at)}
              </Text>
            </View>
          )}
          <View style={[cv.row, mine ? cv.rowMine : cv.rowOther]}>
            <View
              style={[
                cv.bubble,
                mine
                  ? [cv.bubbleMine, { backgroundColor: colors.primary }]
                  : isAi
                  ? [cv.bubbleAi, { backgroundColor: '#7C3AED15', borderColor: '#7C3AED30' }]
                  : [cv.bubbleOther, { backgroundColor: colors.surface }],
              ]}
            >
              {!mine && (
                <Text style={[cv.sender, { color: isAi ? '#7C3AED' : colors.textSecondary }]}>
                  {isAi ? '🤖 AI' : item.sender_type === 'admin' ? '👤 مدير' : '👑 المالك'}
                </Text>
              )}
              {/* Rich Media Content */}
              {(item.message_type === 'audio' || item.message_type === 'voice') && item.file_url ? (
                <AudioPlayerBubble url={item.file_url} mine={mine} />
              ) : item.message_type === 'image' && item.file_url ? (
                <>
                  <ImageBubble url={item.file_url} mine={mine} />
                  {!!item.content && (
                    <Text style={[cv.bubbleText, { color: mine ? '#fff' : colors.text, marginTop: 6 }]}>
                      {item.content}
                    </Text>
                  )}
                </>
              ) : item.message_type === 'file' && item.file_url ? (
                <FileBubble url={item.file_url} name={item.content || 'ملف'} mine={mine} />
              ) : (
                <LinkText text={item.content} mine={mine} />
              )}
              <View style={cv.timeRow}>
                <Text style={[cv.timeText, { color: mine ? 'rgba(255,255,255,0.65)' : colors.textSecondary }]}>
                  {relativeTime(item.created_at)}
                </Text>
                {mine && (
                  <Text style={[cv.tick, { color: item.is_read ? '#A5F3FC' : 'rgba(255,255,255,0.5)' }]}>
                    {item.is_read ? ' ✓✓' : ' ✓'}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </View>
      );
    },
    [messages, isMine, colors],
  );

  const renderPendingBubble = (pf: PendingFile) => (
    <View key={pf.id} style={cv.rowMine}>
      <View
        style={[
          cv.bubble,
          cv.bubbleMine,
          {
            backgroundColor: colors.primary + 'CC',
            borderStyle: 'dashed',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.5)',
          },
        ]}
      >
        <View style={cv.typeRow}>
          <Ionicons name="document-attach-outline" size={14} color="rgba(255,255,255,0.8)" />
          <Text style={[cv.bubbleText, { color: 'rgba(255,255,255,0.9)', flex: 1 }]} numberOfLines={1}>
            {pf.name}
          </Text>
        </View>
        <Text style={[cv.timeText, { color: 'rgba(255,255,255,0.5)', marginTop: 2 }]}>
          جاري الرفع...
        </Text>
      </View>
    </View>
  );

  const isOpen = conversation.status === 'open' || conversation.status === 'active';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <VoiceRecordingModal
        visible={voiceModalVisible}
        onClose={() => setVoiceModalVisible(false)}
        onSend={handleVoiceSend}
      />

      <View style={[cv.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={onBack}
          style={cv.headerBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={isRTL ? 'chevron-forward' : 'chevron-back'}
            size={24}
            color={colors.primary}
          />
        </TouchableOpacity>
        <View style={cv.headerCenter}>
          <Text style={[cv.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {conversation.user_name ?? conversation.user_email ?? 'محادثة'}
          </Text>
          <View style={cv.statusRow}>
            <View style={[cv.statusDot, { backgroundColor: isOpen ? '#10B981' : '#9CA3AF' }]} />
            <Text style={[cv.statusLabel, { color: isOpen ? '#10B981' : colors.textSecondary }]}>
              {isOpen ? 'متصل' : 'مغلق'}
            </Text>
          </View>
        </View>
        {isPrivileged ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              onPress={handleAiToggle}
              style={[
                cv.headerBtn,
                {
                  backgroundColor: aiAutoReply ? '#7C3AED20' : colors.surface,
                  borderWidth: 1,
                  borderColor: aiAutoReply ? '#7C3AED60' : colors.border,
                },
              ]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              disabled={togglingAi}
            >
              <Ionicons
                name="sparkles"
                size={18}
                color={aiAutoReply ? '#7C3AED' : colors.textSecondary}
              />
            </TouchableOpacity>
            {onArchive && (
              <TouchableOpacity
                onPress={() => onArchive(conversation.id)}
                style={cv.headerBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="archive-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {isPrivileged && (
        <CustomerInfoBar
          conversation={conversation}
          customerInfo={customerInfo}
          isRTL={isRTL}
          isPrivileged={isPrivileged}
        />
      )}

      {loading ? (
        <View style={cv.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            contentContainerStyle={[
              cv.msgList,
              messages.length === 0 && { flexGrow: 1, justifyContent: 'center' },
            ]}
            ListEmptyComponent={
              <View style={cv.empty}>
                <Ionicons name="chatbubbles-outline" size={48} color={colors.textSecondary} />
                <Text style={[cv.emptyText, { color: colors.textSecondary }]}>ابدأ المحادثة</Text>
              </View>
            }
            ListFooterComponent={
              pendingFiles.length > 0 ? (
                <View>{pendingFiles.map(renderPendingBubble)}</View>
              ) : null
            }
          />
          {showNewMsgChip && (
            <TouchableOpacity
              style={[cv.chip, { backgroundColor: colors.primary }]}
              onPress={() => {
                flatListRef.current?.scrollToEnd({ animated: true });
                setShowNewMsgChip(false);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="arrow-down" size={14} color="#fff" />
              <Text style={cv.chipText}>رسالة جديدة</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* QA Quick-Reply Chips — visible to customers when there are saved Q&As */}
      {!readOnly && !isPrivileged && qaChips.length > 0 && (
        <View style={[cv.chipsContainer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={cv.chipsScroll}
          >
            {qaChips.map(chip => (
              <TouchableOpacity
                key={chip.id}
                style={[
                  cv.chip2,
                  {
                    backgroundColor: sendingChip === chip.id ? colors.primary + '30' : colors.surface,
                    borderColor: colors.primary + '50',
                  },
                ]}
                onPress={() => handleChipTap(chip)}
                disabled={!!sendingChip}
                activeOpacity={0.75}
              >
                {sendingChip === chip.id ? (
                  <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 4 }} />
                ) : (
                  <Ionicons name="help-circle-outline" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                )}
                <Text style={[cv.chip2Text, { color: colors.primary }]} numberOfLines={1}>
                  {chip.question}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* AI Smart Reply Chips — for privileged users (admins/agents) */}
      {!readOnly && isPrivileged && (suggestionsLoading || suggestedReplies.length > 0) && (
        <View style={[cv.aiChipsContainer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={cv.chipsScroll}
          >
            {suggestionsLoading && suggestedReplies.length === 0 ? (
              <>
                <View style={[cv.aiChipSkeleton, { backgroundColor: colors.surface }]} />
                <View style={[cv.aiChipSkeleton, { backgroundColor: colors.surface, width: 100 }]} />
                <View style={[cv.aiChipSkeleton, { backgroundColor: colors.surface, width: 80 }]} />
              </>
            ) : (
              suggestedReplies.map((reply, i) => (
                <TouchableOpacity
                  key={i}
                  style={[cv.aiChip, { backgroundColor: '#7C3AED18', borderColor: '#7C3AED40' }]}
                  onPress={() => onUseSuggestedReply?.(reply)}
                  activeOpacity={0.72}
                >
                  <Ionicons name="sparkles" size={12} color="#7C3AED" style={{ marginRight: 5 }} />
                  <Text style={[cv.aiChipText, { color: '#7C3AED' }]} numberOfLines={1}>
                    {reply}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {!readOnly && (
        <View style={[cv.composer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[cv.iconBtn, { backgroundColor: colors.surface }]}
            onPress={handleAttach}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[cv.iconBtn, { backgroundColor: colors.surface }]}
            onPress={handleCamera}
          >
            <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[cv.iconBtn, { backgroundColor: colors.surface }]}
            onPress={handleMic}
          >
            <Ionicons name="mic-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TextInput
            style={[cv.input, { backgroundColor: colors.inputBackground, color: colors.text }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="اكتب رسالة..."
            placeholderTextColor={colors.textSecondary}
            multiline
            textAlign={isRTL ? 'right' : 'left'}
          />
          {isPrivileged && (
            <TouchableOpacity
              style={[cv.iconBtn, { backgroundColor: '#7C3AED15' }]}
              onPress={handleAiAssist}
              disabled={fetchingAi || sending}
            >
              {fetchingAi ? (
                <ActivityIndicator size="small" color="#7C3AED" />
              ) : (
                <Ionicons name="sparkles" size={20} color="#7C3AED" />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              cv.sendBtn,
              { backgroundColor: colors.primary, opacity: !inputText.trim() || sending ? 0.45 : 1 },
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name="send"
                size={19}
                color="#fff"
                style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }}
              />
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const cv = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusLabel: { fontSize: 11, fontWeight: '600' },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  msgList: { padding: 12, paddingBottom: 8 },
  dateSep: { alignItems: 'center', marginVertical: 10 },
  dateSepText: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: { marginVertical: 2, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end', marginVertical: 2 },
  rowOther: { justifyContent: 'flex-start', marginVertical: 2 },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  bubbleAi: { borderBottomLeftRadius: 4, borderWidth: 1 },
  sender: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 },
  timeText: { fontSize: 10 },
  tick: { fontSize: 10, fontWeight: '700' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 40 },
  emptyText: { fontSize: 15, fontWeight: '600' },
  chip: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 6,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  chipsScroll: {
    paddingHorizontal: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip2: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 220,
  },
  chip2Text: {
    fontSize: 13,
    fontWeight: '600',
  },
  aiChipsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 7,
  },
  aiChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 220,
  },
  aiChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  aiChipSkeleton: {
    width: 130,
    height: 32,
    borderRadius: 20,
    opacity: 0.5,
  },
});

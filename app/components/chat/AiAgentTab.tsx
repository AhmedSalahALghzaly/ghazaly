import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  Alert,
  Image,
  Modal,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated2, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Audio } from 'expo-av';
import { useTheme } from '../../hooks/useTheme';
import { Message, Conversation } from '../../hooks/useChat';
import { chatApi, knowledgeBaseApi } from '../../services/api';
import ConversationView from './ConversationView';
import { useAppStore } from '../../store/appStore';

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const DEBOUNCE_MS = 300;

interface Props {
  aiMessages: Message[];
  sending: boolean;
  isRTL: boolean;
  onSend: (text: string) => void;
  isPrivileged?: boolean;
  conversations?: Conversation[];
  onOpenConversation?: (conv: Conversation) => void;
  liveMessages?: Message[];
  activeConvId?: string;
  onSetAiConversationId?: (id: string | null) => void;
}

const FALLBACK_QUICK_QUESTIONS = [
  { icon: 'car-sport-outline' as const, text: 'ما هي أفضل زيوت المحركات لسيارتي؟' },
  { icon: 'battery-charging-outline' as const, text: 'كيف أختار البطارية المناسبة؟' },
  { icon: 'construct-outline' as const, text: 'ما الفرق بين الفرامل الأمامية والخلفية؟' },
  { icon: 'shield-checkmark-outline' as const, text: 'متى يجب تغيير فلتر الهواء؟' },
];

interface QuickQuestion {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}

function useDebounce<T>(val: T, ms: number): T {
  const [deb, setDeb] = useState(val);
  useEffect(() => {
    const t = setTimeout(() => setDeb(val), ms);
    return () => clearTimeout(t);
  }, [val, ms]);
  return deb;
}

function useKbQuickQuestions(): { questions: QuickQuestion[]; loaded: boolean } {
  const [questions, setQuestions] = useState<QuickQuestion[]>(FALLBACK_QUICK_QUESTIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    knowledgeBaseApi
      .getAll({ type: 'qa' })
      .then((res) => {
        const items: { question?: string }[] = Array.isArray(res.data)
          ? res.data
          : res.data?.items ?? [];
        const icons: React.ComponentProps<typeof Ionicons>['name'][] = [
          'help-circle-outline',
          'car-sport-outline',
          'construct-outline',
          'shield-checkmark-outline',
          'battery-charging-outline',
          'cog-outline',
        ];
        const mapped: QuickQuestion[] = items
          .filter((i) => i.question)
          .slice(0, 5)
          .map((i, idx) => ({
            icon: icons[idx % icons.length],
            text: i.question!,
          }));
        if (mapped.length > 0) {
          setQuestions(mapped);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return { questions, loaded };
}

function TypingDots() {
  const dots = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay((dots.length - i) * 150),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={tst.row}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            tst.dot,
            {
              opacity: dot,
              transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) }],
            },
          ]}
        />
      ))}
    </View>
  );
}
const tst = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#7C3AED' },
});

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins}د`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}س`;
  return d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short' });
}

function PrivilegedAiTab({
  conversations,
  isRTL,
  onSend,
  sending,
  onOpenConversation,
  liveMessages,
  activeConvId,
}: {
  conversations: Conversation[];
  isRTL: boolean;
  onSend: (text: string) => void;
  sending: boolean;
  onOpenConversation?: (conv: Conversation) => void;
  liveMessages?: Message[];
  activeConvId?: string;
}) {
  const { colors } = useTheme();
  const { userRole } = useAppStore();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, DEBOUNCE_MS);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [fallbackMsgs, setFallbackMsgs] = useState<Message[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const convMsgs =
    selected && selected.type === 'ai_agent' && liveMessages && activeConvId === selected.id
      ? liveMessages
      : fallbackMsgs;

  const aiConversations = useMemo(
    () => conversations.filter((c) => c.type === 'ai_agent'),
    [conversations],
  );

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return aiConversations;
    const q = debouncedSearch.toLowerCase();
    return aiConversations.filter(
      (c) =>
        (c.user_name ?? '').toLowerCase().includes(q) ||
        (c.user_email ?? '').toLowerCase().includes(q),
    );
  }, [aiConversations, debouncedSearch]);

  const handleSelect = useCallback(async (conv: Conversation) => {
    setSelected(conv);
    setFallbackMsgs([]);
    if (onOpenConversation) {
      onOpenConversation(conv);
    } else {
      setLoadingMsgs(true);
      try {
        const res = await chatApi.getMessages(conv.id);
        setFallbackMsgs(Array.isArray(res.data) ? res.data : (res.data?.messages ?? []));
      } catch {
        setFallbackMsgs([]);
      } finally {
        setLoadingMsgs(false);
      }
    }
  }, [onOpenConversation]);

  const isOwner = userRole === 'owner';

  const renderConvRow = ({ item }: { item: Conversation }) => {
    const isActive = selected?.id === item.id;
    const isOpen = item.status === 'open' || item.status === 'active';
    const displayName = item.user_name ?? item.user_email ?? 'عميل';
    const preview = item.last_message ?? '';

    return (
      <TouchableOpacity
        onPress={() => handleSelect(item)}
        activeOpacity={0.75}
        style={[
          priv.convRow,
          {
            backgroundColor: isActive ? '#7C3AED12' : colors.card,
            borderBottomColor: colors.border,
            borderLeftWidth: isRTL ? 0 : 3,
            borderRightWidth: isRTL ? 3 : 0,
            borderLeftColor: isActive ? '#7C3AED' : 'transparent',
            borderRightColor: isActive ? '#7C3AED' : 'transparent',
          },
        ]}
      >
        <View style={priv.convAvatar}>
          <LinearGradient
            colors={isActive ? ['#7C3AED', '#6366F1'] : ['#7C3AED30', '#6366F130']}
            style={priv.convAvatarGrad}
          >
            <Ionicons name="sparkles" size={16} color={isActive ? '#fff' : '#7C3AED'} />
          </LinearGradient>
          {isOpen && <View style={priv.onlineDot} />}
        </View>
        <View style={priv.convInfo}>
          <View style={priv.convTopRow}>
            <Text
              style={[priv.convName, { color: isActive ? '#7C3AED' : colors.text }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <Text style={[priv.convTime, { color: colors.textSecondary }]}>
              {item.updated_at ? relativeTime(item.updated_at) : ''}
            </Text>
          </View>
          <View style={priv.convBottomRow}>
            <Text style={[priv.convPreview, { color: colors.textSecondary }]} numberOfLines={1}>
              {preview || 'محادثة AI'}
            </Text>
            {item.unread_count > 0 && (
              <View style={priv.unreadBadge}>
                <Text style={priv.unreadText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={[priv.searchBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={priv.searchIcon}>
          <Ionicons name="search" size={15} color={colors.textSecondary} />
        </View>
        <TextInput
          style={[priv.searchInput, { color: colors.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="بحث في محادثات AI..."
          placeholderTextColor={colors.textSecondary}
          textAlign={isRTL ? 'right' : 'left'}
          clearButtonMode="while-editing"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flex: 1, flexDirection: isRTL ? 'row-reverse' : 'row' }}>
        <View
          style={[
            priv.listPane,
            {
              borderRightWidth: isRTL ? 0 : StyleSheet.hairlineWidth,
              borderLeftWidth: isRTL ? StyleSheet.hairlineWidth : 0,
              borderColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          {filtered.length === 0 ? (
            <View style={priv.empty}>
              <LinearGradient colors={['#7C3AED20', '#6366F120']} style={priv.emptyIcon}>
                <Ionicons name="sparkles-outline" size={28} color="#7C3AED" />
              </LinearGradient>
              <Text style={[priv.emptyTitle, { color: colors.text }]}>
                {aiConversations.length === 0 ? 'لا توجد محادثات' : 'لا نتائج'}
              </Text>
              <Text style={[priv.emptySub, { color: colors.textSecondary }]}>
                {aiConversations.length === 0 ? 'ستظهر محادثات AI هنا' : 'جرب بحثاً مختلفاً'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(c) => c.id}
              renderItem={renderConvRow}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
              ListHeaderComponent={
                <View style={[priv.listHeader, { borderBottomColor: colors.border }]}>
                  <Ionicons name="sparkles" size={13} color="#7C3AED" />
                  <Text style={[priv.listHeaderText, { color: '#7C3AED' }]}>
                    محادثات المساعد ({aiConversations.length})
                  </Text>
                </View>
              }
            />
          )}
        </View>

        <View style={{ flex: 1 }}>
          {selected ? (
            <ConversationView
              conversation={selected}
              messages={convMsgs}
              loading={loadingMsgs}
              sending={false}
              isPrivileged
              isOwner={isOwner}
              readOnly={!isOwner}
              onSend={isOwner ? onSend : () => {}}
              onBack={() => setSelected(null)}
              isRTL={isRTL}
            />
          ) : (
            <View style={priv.noSel}>
              <LinearGradient colors={['#7C3AED15', '#6366F115']} style={priv.noSelIcon}>
                <Ionicons name="sparkles" size={32} color="#7C3AED" />
              </LinearGradient>
              <Text style={[priv.noSelTitle, { color: colors.text }]}>
                {aiConversations.length === 0 ? 'لا توجد محادثات AI' : 'اختر محادثة'}
              </Text>
              <Text style={[priv.noSelSub, { color: colors.textSecondary }]}>
                {aiConversations.length === 0
                  ? 'ستظهر هنا محادثات المساعد الذكي مع العملاء'
                  : 'اضغط على محادثة لعرضها والرد عليها'}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const priv = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  searchIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  listPane: { width: 200 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listHeaderText: { fontSize: 12, fontWeight: '700' },
  convRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  convAvatar: { position: 'relative' },
  convAvatarGrad: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10B981',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  convInfo: { flex: 1, minWidth: 0 },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 3 },
  convName: { fontSize: 13, fontWeight: '700', flex: 1 },
  convTime: { fontSize: 10, fontWeight: '500' },
  convBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  convPreview: { fontSize: 11, flex: 1 },
  unreadBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  noSel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  noSelIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  noSelTitle: { fontSize: 17, fontWeight: '800' },
  noSelSub: { fontSize: 13, textAlign: 'center', lineHeight: 20, opacity: 0.7 },
});

function AiImageBubble({ url }: { url: string }) {
  const [lightbox, setLightbox] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setLightbox(true)} activeOpacity={0.85}>
        <Image
          source={{ uri: url }}
          style={ms.imgThumb}
          resizeMode="cover"
        />
      </TouchableOpacity>
      <Modal visible={lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(false)}>
        <TouchableOpacity style={ms.lightboxOverlay} onPress={() => setLightbox(false)} activeOpacity={1}>
          <Image source={{ uri: url }} style={ms.lightboxImg} resizeMode="contain" />
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function AiAudioBubble({ url, isAi }: { url: string; isAi: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (Platform.OS === 'web') {
        try { webAudioRef.current?.pause(); } catch {}
        webAudioRef.current = null;
      } else {
        soundRef.current?.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const toggle = useCallback(async () => {
    if (Platform.OS === 'web') {
      if (playing) {
        webAudioRef.current?.pause();
        setPlaying(false);
        return;
      }
      setLoading(true);
      try {
        if (!webAudioRef.current) {
          const audio = new window.Audio(url);
          audio.onended = () => { setPlaying(false); webAudioRef.current = null; };
          audio.onerror = () => { setPlaying(false); webAudioRef.current = null; };
          webAudioRef.current = audio;
        }
        await webAudioRef.current.play();
        setPlaying(true);
      } catch {
        Alert.alert('خطأ', 'تعذّر تشغيل الصوت');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (playing) {
      await soundRef.current?.pauseAsync().catch(() => {});
      setPlaying(false);
      return;
    }
    setLoading(true);
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        const { sound } = await Audio.Sound.createAsync({ uri: url });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlaying(false);
            soundRef.current?.unloadAsync().catch(() => {});
            soundRef.current = null;
          }
        });
      }
      await soundRef.current.playAsync();
      setPlaying(true);
    } catch {
      Alert.alert('خطأ', 'تعذّر تشغيل الصوت');
    } finally {
      setLoading(false);
    }
  }, [playing, url]);

  return (
    <TouchableOpacity
      onPress={toggle}
      disabled={loading}
      style={[ms.audioBubble, { backgroundColor: isAi ? '#7C3AED15' : 'rgba(255,255,255,0.15)' }]}
      activeOpacity={0.75}
    >
      {loading ? (
        <ActivityIndicator size="small" color={isAi ? '#7C3AED' : '#fff'} />
      ) : (
        <Ionicons name={playing ? 'pause-circle' : 'play-circle'} size={26} color={isAi ? '#7C3AED' : '#fff'} />
      )}
      <Ionicons name="mic-outline" size={13} color={isAi ? '#7C3AEDaa' : 'rgba(255,255,255,0.55)'} />
      <Text style={[ms.audioLabel, { color: isAi ? '#7C3AED' : 'rgba(255,255,255,0.9)' }]}>
        {playing ? 'جارٍ التشغيل...' : 'رسالة صوتية'}
      </Text>
    </TouchableOpacity>
  );
}

function renderMsg(
  { item }: { item: Message },
  colors: ReturnType<typeof useTheme>['colors'],
) {
  const isAi = item.sender_type === 'ai_agent';
  const isImage = item.message_type === 'image' && item.file_url;
  const isAudio = (item.message_type === 'audio' || item.message_type === 'voice') && item.file_url;
  const isFile = item.message_type === 'file' && item.file_url;
  return (
    <View style={[ms.row, isAi ? ms.aiRow : ms.userRow]}>
      {isAi && (
        <View style={[ms.aiAvatar, { backgroundColor: '#7C3AED20' }]}>
          <Ionicons name="sparkles" size={14} color="#7C3AED" />
        </View>
      )}
      <View
        style={[
          ms.bubble,
          isAi
            ? [ms.bubbleAi, { backgroundColor: colors.surface, borderColor: '#7C3AED20' }]
            : [ms.bubbleUser, { backgroundColor: colors.primary }],
        ]}
      >
        {isAi && <Text style={[ms.aiLabel, { color: '#7C3AED' }]}>مساعد غزالي AI</Text>}
        {isImage && item.file_url ? (
          <>
            <AiImageBubble url={item.file_url} />
            {!!item.content && (
              <Text style={[ms.text, { color: isAi ? colors.text : '#fff', marginTop: 6 }]}>
                {item.content}
              </Text>
            )}
          </>
        ) : isAudio && item.file_url ? (
          <AiAudioBubble url={item.file_url} isAi={isAi} />
        ) : isFile && item.file_url ? (
          <TouchableOpacity
            style={ms.fileIndicator}
            onPress={() => Linking.openURL(item.file_url!).catch(() => {})}
            activeOpacity={0.75}
          >
            <Ionicons name="document-attach" size={14} color={isAi ? '#7C3AED' : '#fff'} />
            <Text style={[ms.fileText, { color: isAi ? '#7C3AED' : '#fff' }]}>
              {item.content || 'مرفق'}
            </Text>
            <Ionicons name="open-outline" size={12} color={isAi ? '#7C3AED80' : 'rgba(255,255,255,0.5)'} />
          </TouchableOpacity>
        ) : null}
        {item.content && !isImage && !isAudio && !isFile ? (
          <Text style={[ms.text, { color: isAi ? colors.text : '#fff' }]}>{item.content}</Text>
        ) : null}
        <Text style={[ms.timeText, { color: isAi ? colors.textSecondary : 'rgba(255,255,255,0.6)' }]}>
          {new Date(item.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}
const ms = StyleSheet.create({
  row: { marginVertical: 4, flexDirection: 'row', gap: 8 },
  aiRow: { alignItems: 'flex-start' },
  userRow: { alignItems: 'flex-end', flexDirection: 'row-reverse' },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  bubbleAi: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleUser: { borderBottomRightRadius: 4 },
  aiLabel: { fontSize: 11, fontWeight: '700', marginBottom: 3 },
  text: { fontSize: 14, lineHeight: 21 },
  timeText: { fontSize: 9, alignSelf: 'flex-end', marginTop: 2 },
  fileIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  fileText: { fontSize: 11, fontWeight: '600' },
  imgThumb: { width: 180, height: 130, borderRadius: 10, marginBottom: 4 },
  audioBubble: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderRadius: 10, marginBottom: 4 },
  audioLabel: { fontSize: 12, fontWeight: '600' },
  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '95%', height: '80%' },
});

function SubscriptionGate() {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(withTiming(1.06, { duration: 2000 }), withTiming(0.96, { duration: 2000 })),
      -1,
      true,
    );
  }, []);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <LinearGradient colors={['#1A1A2E', '#16213E', '#0F3460']} style={gc.subsGrad}>
      <Animated2.View style={[gc.iconWrapSubs, animStyle]}>
        <LinearGradient colors={['#FFD70060', '#FFA50040']} style={gc.iconGrad}>
          <Ionicons name="lock-closed" size={40} color="#FFD70080" />
        </LinearGradient>
      </Animated2.View>
      <Text style={gc.subsTitle}>مساعد غزالي الذكي</Text>
      <Text style={gc.subsSub}>هذه الميزة للمشتركين فقط</Text>
      <Text style={gc.subsHint}>اشترك لتفعيل المساعد الذكي</Text>
      <TouchableOpacity style={gc.subsBtn} activeOpacity={0.85}>
        <LinearGradient colors={['#FFD700', '#FFA500']} style={gc.subsBtnGrad}>
          <Ionicons name="diamond-outline" size={18} color="#000" />
          <Text style={gc.subsBtnText}>اشترك الآن</Text>
        </LinearGradient>
      </TouchableOpacity>
    </LinearGradient>
  );
}

function SmallAiIcon({ active }: { active: boolean }) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    if (active) {
      rotation.value = withRepeat(withTiming(360, { duration: 1800 }), -1, false);
    } else {
      rotation.value = withTiming(0, { duration: 400 });
    }
  }, [active]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  return (
    <Animated2.View style={animStyle}>
      <LinearGradient colors={['#7C3AED', '#6366F1']} style={gc.smallIcon}>
        <Ionicons name={active ? 'chatbubble-ellipses' : 'sparkles'} size={20} color="#fff" />
      </LinearGradient>
    </Animated2.View>
  );
}

async function uriToBase64(uri: string): Promise<string> {
  if (Platform.OS !== 'web' && uri.startsWith('file://')) {
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
      blob.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        bytes.forEach((b) => { binary += String.fromCharCode(b); });
        resolve(btoa(binary));
      }).catch(reject);
    }
  });
}


function CustomerAiTab({
  aiMessages,
  sending,
  isRTL,
  onSend,
  onSetAiConversationId,
}: {
  aiMessages: Message[];
  sending: boolean;
  isRTL: boolean;
  onSend: (text: string) => void;
  onSetAiConversationId?: (id: string | null) => void;
}) {
  const { colors } = useTheme();
  const { userRole, subscriptionStatus } = useAppStore();
  const flatListRef = useRef<FlatList>(null);
  const { questions: quickQuestions } = useKbQuickQuestions();

  const isAllowed =
    userRole === 'owner' ||
    userRole === 'admin' ||
    subscriptionStatus === 'subscriber';

  const [uiState, setUiState] = useState<'idle' | 'chat'>('idle');
  const [inputText, setInputText] = useState('');
  const [liveMode, setLiveMode] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [persistedMessages, setPersistedMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{
    uri: string;
    fileName: string;
    mimeType: string;
    isImage: boolean;
  } | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<any[]>([]);
  const lastSpokenIdRef = useRef<string | null>(null);
  const startRecordingRef = useRef<() => Promise<void>>(async () => {});
  const ttsAudioRef = useRef<any>(null);
  const lastAiMsgRef = useRef<{ text: string; id: string } | null>(null);
  const prevMutedRef = useRef(false);

  const displayMessages = persistedMessages.length > 0 ? persistedMessages : aiMessages;

  const scale = useSharedValue(1);
  const glow = useSharedValue(0);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(withTiming(1.05, { duration: 1800 }), withTiming(0.97, { duration: 1800 })),
      -1, true,
    );
    glow.value = withRepeat(
      withSequence(withTiming(1, { duration: 1500 }), withTiming(0.4, { duration: 1500 })),
      -1, false,
    );
  }, []);

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
  }));

  useEffect(() => {
    loadExistingConversation();
  }, []);

  const loadExistingConversation = useCallback(async () => {
    try {
      const res = await chatApi.getConversations();
      const convs: Conversation[] = res.data?.conversations ?? res.data ?? [];
      const aiConv = convs.find((c: Conversation) => c.type === 'ai_agent');
      if (aiConv) {
        setConversationId(aiConv.id);
        onSetAiConversationId?.(aiConv.id);
        setLoadingHistory(true);
        const msgRes = await chatApi.getMessages(aiConv.id);
        const msgs = msgRes.data?.messages ?? msgRes.data ?? [];
        if (Array.isArray(msgs) && msgs.length > 0) {
          setPersistedMessages(msgs);
          setUiState('chat');
        }
        setLoadingHistory(false);
      }
    } catch {
      setLoadingHistory(false);
    }
  }, [onSetAiConversationId]);

  useEffect(() => {
    if (aiMessages.length > 0 && displayMessages !== aiMessages) {
      const lastAi = aiMessages[aiMessages.length - 1];
      if (lastAi && !persistedMessages.find((m) => m.id === lastAi.id)) {
        setPersistedMessages((prev) => [...prev, ...aiMessages.filter((m) => !prev.find((p) => p.id === m.id))]);
      }
    }
  }, [aiMessages]);

  useEffect(() => {
    if (displayMessages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [displayMessages.length]);

  const stopAiSpeaking = useCallback(async () => {
    setSpeaking(false);
    const audio = ttsAudioRef.current;
    ttsAudioRef.current = null;
    if (!audio) return;
    if (Platform.OS === 'web') {
      try { audio.pause(); } catch {}
    } else {
      await (audio as Audio.Sound).stopAsync().catch(() => {});
      await (audio as Audio.Sound).unloadAsync().catch(() => {});
    }
  }, []);

  const aiSpeak = useCallback(async (text: string, msgId: string) => {
    if (!liveMode || muted || lastSpokenIdRef.current === msgId) return;
    lastSpokenIdRef.current = msgId;
    await stopAiSpeaking();
    const cleanText = text.replace(/[*_~`#>/]/g, '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return;
    setSpeaking(true);
    try {
      const res = await chatApi.tts({ text: cleanText.slice(0, 500), voice: 'alloy' });
      const audioBase64 = res.data?.audio_base64;
      if (!audioBase64) { setSpeaking(false); return; }
      const dataUri = `data:audio/mp3;base64,${audioBase64}`;
      if (Platform.OS === 'web') {
        const audio = new (window as any).Audio(dataUri);
        ttsAudioRef.current = audio;
        audio.onended = () => { setSpeaking(false); ttsAudioRef.current = null; };
        audio.onerror = () => { setSpeaking(false); ttsAudioRef.current = null; };
        await audio.play();
      } else {
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
        const { sound } = await Audio.Sound.createAsync({ uri: dataUri });
        ttsAudioRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (status.didJustFinish || status.error) {
            setSpeaking(false);
            sound.unloadAsync().catch(() => {});
            ttsAudioRef.current = null;
          }
        });
        await sound.playAsync();
      }
    } catch (err) {
      console.error('[TTS] aiSpeak error:', err);
      setSpeaking(false);
    }
  }, [liveMode, muted, stopAiSpeaking]);

  useEffect(() => {
    const lastAi = displayMessages.slice().reverse().find(
      (m) => m.sender_type === 'ai_agent' && m.content,
    );
    if (lastAi) lastAiMsgRef.current = { text: lastAi.content, id: lastAi.id };
  }, [displayMessages]);

  useEffect(() => {
    if (!liveMode || displayMessages.length === 0) return;
    const lastMsg = displayMessages[displayMessages.length - 1];
    if (
      lastMsg &&
      lastMsg.sender_type === 'ai_agent' &&
      lastMsg.content &&
      lastMsg.id !== lastSpokenIdRef.current
    ) {
      aiSpeak(lastMsg.content, lastMsg.id);
    }
  }, [displayMessages, liveMode, aiSpeak]);

  useEffect(() => {
    const wasMuted = prevMutedRef.current;
    prevMutedRef.current = muted;
    if (wasMuted && !muted && liveMode && lastAiMsgRef.current) {
      lastSpokenIdRef.current = null;
      aiSpeak(lastAiMsgRef.current.text, lastAiMsgRef.current.id);
    }
  }, [muted, liveMode, aiSpeak]);

  useEffect(() => {
    return () => {
      stopAiSpeaking();
    };
  }, [stopAiSpeaking]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;
    setInputText('');
    if (uiState === 'idle') setUiState('chat');
    onSend(text.trim());
  }, [sending, onSend, uiState]);

  const sendMediaViaChat = useCallback(async (uri: string, fileName: string, mimeType: string) => {
    const messageType: string = mimeType.startsWith('image/') ? 'image' : 'file';
    if (uiState === 'idle') setUiState('chat');
    setUploading(true);
    const tempId = `temp-${Date.now()}`;
    try {
      const base64 = await uriToBase64(uri);
      const uploadRes = await chatApi.uploadFile({
        data: base64,
        content_type: mimeType,
        file_name: fileName,
      });
      const fileUrl: string = uploadRes.data?.downloadURL ?? '';
      if (!fileUrl) throw new Error('Upload failed');
      let convId = conversationId;
      if (!convId) {
        const convRes = await chatApi.createConversation({ type: 'ai_agent' });
        convId = convRes.data?.conversation?.id ?? null;
        if (convId) {
          setConversationId(convId);
          onSetAiConversationId?.(convId);
        }
      }
      if (!convId) throw new Error('No conversation');
      const tempMsg: Message = {
        id: tempId,
        conversation_id: convId,
        sender_type: 'customer',
        content: fileName,
        message_type: messageType,
        file_url: fileUrl,
        is_read: true,
        created_at: new Date().toISOString(),
      };
      setPersistedMessages((prev) => [...prev, tempMsg]);
      await chatApi.sendMessage({
        conversation_id: convId,
        content: fileName,
        message_type: messageType,
        file_url: fileUrl,
      });
      const msgRes = await chatApi.getMessages(convId);
      const msgs = Array.isArray(msgRes.data) ? msgRes.data : (msgRes.data?.messages ?? []);
      if (msgs.length > 0) setPersistedMessages(msgs);
    } catch (err: any) {
      setPersistedMessages((prev) => prev.filter((m) => m.id !== tempId));
      Alert.alert('خطأ', err?.response?.data?.detail ?? 'تعذّر إرسال الملف');
    } finally {
      setUploading(false);
    }
  }, [conversationId, onSetAiConversationId, uiState]);

  const handlePickImage = useCallback(async () => {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) {
      Alert.alert('الإذن مطلوب', 'يجب السماح بالوصول إلى الصور');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const fileName = asset.fileName ?? `image_${Date.now()}.jpg`;
      const mimeType = asset.mimeType ?? 'image/jpeg';
      setPendingMedia({ uri: asset.uri, fileName, mimeType, isImage: true });
    }
  }, []);

  const handleCameraCapture = useCallback(async () => {
    const { granted } = await ImagePicker.requestCameraPermissionsAsync();
    if (!granted) {
      Alert.alert('الإذن مطلوب', 'يجب السماح بالوصول إلى الكاميرا');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const fileName = asset.fileName ?? `photo_${Date.now()}.jpg`;
      const mimeType = asset.mimeType ?? 'image/jpeg';
      setPendingMedia({ uri: asset.uri, fileName, mimeType, isImage: true });
    }
  }, []);

  const handlePickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets?.[0]) {
        const file = result.assets[0];
        const mimeType = file.mimeType ?? 'application/octet-stream';
        const isImage = mimeType.startsWith('image/');
        setPendingMedia({ uri: file.uri, fileName: file.name, mimeType, isImage });
      }
    } catch {
      Alert.alert('خطأ', 'تعذّر اختيار الملف');
    }
  }, []);

  const handleSendAll = useCallback(async () => {
    const text = inputText.trim();
    const media = pendingMedia;
    if (!text && !media) return;
    setInputText('');
    setPendingMedia(null);

    if (media) {
      const isImage = media.mimeType.startsWith('image/');
      const messageType: string = isImage ? 'image' : 'file';
      // Images: caption text stored as content (shown below image)
      // Files: filename stored as content (shown as file label)
      const primaryContent = isImage ? (text || '') : media.fileName;
      if (uiState === 'idle') setUiState('chat');
      setUploading(true);
      const tempId = `temp-${Date.now()}`;
      try {
        const base64 = await uriToBase64(media.uri);
        const uploadRes = await chatApi.uploadFile({
          data: base64,
          content_type: media.mimeType,
          file_name: media.fileName,
        });
        const fileUrl: string = uploadRes.data?.downloadURL ?? '';
        if (!fileUrl) throw new Error('Upload failed');

        // Show user's message optimistically
        const tempMsg: Message = {
          id: tempId,
          conversation_id: conversationId ?? '',
          sender_type: 'customer',
          content: primaryContent,
          message_type: messageType,
          file_url: fileUrl,
          is_read: true,
          created_at: new Date().toISOString(),
        };
        setPersistedMessages((prev) => [...prev, tempMsg]);

        // Call the AI agent endpoint directly — it saves the message, runs vision/file
        // analysis, and returns a synchronous AI reply (no double-reply race condition)
        const aiRes = await chatApi.sendAiMessage({
          message: text || undefined,
          file_url: fileUrl,
          message_type: messageType,
          conversation_id: conversationId ?? undefined,
        });

        const reply = aiRes.data;
        const returnedConvId: string = reply?.conversation_id ?? conversationId ?? '';

        if (returnedConvId && returnedConvId !== conversationId) {
          setConversationId(returnedConvId);
          onSetAiConversationId?.(returnedConvId);
        }

        // Replace temp message with the real persisted one, then add AI reply
        const aiMsg: Message = {
          id: reply?.message?.id ?? `ai-${Date.now()}`,
          conversation_id: returnedConvId,
          sender_type: 'ai_agent',
          content: reply?.response ?? reply?.message?.content ?? 'عذراً، حدث خطأ.',
          message_type: 'text',
          is_read: true,
          created_at: new Date().toISOString(),
        };

        setPersistedMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          // Re-add user message with correct conversation_id, then AI reply
          const userMsg: Message = { ...tempMsg, id: `usr-${Date.now()}`, conversation_id: returnedConvId };
          return [...withoutTemp, userMsg, aiMsg];
        });
      } catch (err: any) {
        setPersistedMessages((prev) => prev.filter((m) => m.id !== tempId));
        Alert.alert('خطأ', err?.response?.data?.detail ?? 'تعذّر إرسال الملف');
      } finally {
        setUploading(false);
      }
    } else if (text) {
      handleSend(text);
    }
  }, [inputText, pendingMedia, conversationId, onSetAiConversationId, uiState, handleSend]);

  const stopLiveMode = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (recordingRef.current) {
      recordingRef.current.stopAndUnloadAsync().catch(() => {});
      recordingRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch {}
      try { mediaRecorderRef.current.stream?.getTracks?.()?.forEach((t: any) => t.stop()); } catch {}
      mediaRecorderRef.current = null;
    }
    audioChunksRef.current = [];
    setRecording(false);
    stopAiSpeaking();
    setMuted(false);
    setLiveMode(false);
  }, [stopAiSpeaking]);

  const toggleLiveMode = useCallback(async () => {
    if (liveMode) {
      stopLiveMode();
      return;
    }
    // Activating live mode — check microphone permissions first
    if (Platform.OS === 'web') {
      const nav = navigator as any;
      if (!nav.mediaDevices?.getUserMedia) {
        Alert.alert('غير مدعوم', 'المتصفح لا يدعم التسجيل الصوتي');
        return;
      }
      try {
        // Probe for permission: open + immediately release the stream
        const probe = await nav.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t: any) => t.stop());
      } catch (e: any) {
        const msg =
          e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
            ? 'تم رفض إذن الميكروفون — يرجى السماح بالوصول في إعدادات المتصفح ثم حاول مجدداً'
            : 'تعذّر الوصول إلى الميكروفون — تأكد من توصيله';
        Alert.alert('إذن الميكروفون', msg);
        return;
      }
    } else {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'إذن الميكروفون',
          'يجب السماح بالوصول إلى الميكروفون لتفعيل المحادثة المباشرة',
        );
        return;
      }
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLiveMode(true);
  }, [liveMode, stopLiveMode]);

  const startRecording = useCallback(async () => {
    if (recording || transcribing) return;

    try {
      if (Platform.OS === 'web') {
        const nav = navigator as any;
        if (!nav.mediaDevices?.getUserMedia) {
          Alert.alert('خطأ', 'المتصفح لا يدعم التسجيل الصوتي');
          return;
        }
        const stream = await nav.mediaDevices.getUserMedia({ audio: true });
        const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm'))
          ? 'audio/webm'
          : 'audio/ogg';
        const mr = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];
        mr.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        mr.start();
        mediaRecorderRef.current = mr;
      } else {
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('الإذن مطلوب', 'يجب السماح بالوصول إلى الميكروفون لاستخدام المحادثة الصوتية');
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording: rec } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY,
        );
        recordingRef.current = rec;
      }
      setRecording(true);
    } catch {
      Alert.alert('خطأ', 'تعذّر بدء التسجيل');
    }
  }, [recording, transcribing]);
  startRecordingRef.current = startRecording;

  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!recording) return;
    setRecording(false);
    setTranscribing(true);
    try {
      let base64 = '';
      let contentType = 'audio/m4a';

      if (Platform.OS === 'web') {
        const mr = mediaRecorderRef.current;
        if (!mr) throw new Error('لا يوجد مسجل');
        contentType = mr.mimeType || 'audio/webm';
        await new Promise<void>((resolve) => {
          mr.onstop = () => resolve();
          mr.stop();
        });
        try { mr.stream?.getTracks?.()?.forEach((t: any) => t.stop()); } catch {}
        mediaRecorderRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: contentType });
        audioChunksRef.current = [];
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        if (!recordingRef.current) throw new Error('لا يوجد مسجل');
        await recordingRef.current.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        if (!uri) throw new Error('لم يتم الحصول على ملف صوتي');
        base64 = await uriToBase64(uri);
      }

      const res = await chatApi.transcribeAudio({ audio_base64: base64, content_type: contentType });
      const transcript = res.data?.transcript?.trim() ?? '';
      if (transcript) {
        if (uiState === 'idle') setUiState('chat');
        onSend(transcript);
      } else {
        Alert.alert('تنبيه', 'لم يتم التعرف على الكلام، حاول مجدداً');
      }
    } catch {
      Alert.alert('خطأ', 'تعذّر تحويل الصوت إلى نص');
      recordingRef.current = null;
      mediaRecorderRef.current = null;
    } finally {
      setTranscribing(false);
    }
  }, [recording, onSend, uiState]);

  if (!isAllowed && uiState === 'idle') {
    return <SubscriptionGate />;
  }

  if (uiState === 'idle') {
    return (
      <LinearGradient colors={['#0D0D1A', '#1A1A2E', '#0F3460']} style={gc.container}>
        <ScrollView contentContainerStyle={gc.idleBg} showsVerticalScrollIndicator={false}>
          <View style={gc.idleCenter}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setUiState('chat')}
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <Animated2.View style={[gc.iconWrap, iconAnimStyle]}>
                <Animated2.View style={[gc.glowRing, glowStyle]} />
                <LinearGradient
                  colors={['#7C3AED', '#6366F1', '#4F46E5']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={gc.iconGrad}
                >
                  <Ionicons name="sparkles" size={40} color="#fff" />
                </LinearGradient>
              </Animated2.View>
            </TouchableOpacity>
            <Text style={gc.idleTitle}>مساعد غزالي AI</Text>
            <Text style={gc.idleSub}>مساعدك الذكي لقطع غيار السيارات{'\n'}مدعوم بتقنية OpenAI</Text>

            <View style={{ gap: 8, width: '100%', marginTop: 8 }}>
              {quickQuestions.map((q, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => handleSend(q.text)}
                  style={[gc.quickChip, { backgroundColor: '#ffffff10', borderColor: '#7C3AED30' }]}
                  activeOpacity={0.75}
                >
                  <Ionicons name={q.icon} size={14} color="#7C3AED" />
                  <Text style={{ color: '#ffffffCC', fontSize: 13, flex: 1 }}>{q.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0D0D1A', '#1A1A2E']} style={gc.container}>
      <View style={gc.chatHeader}>
        <TouchableOpacity onPress={() => setUiState('idle')} style={gc.backBtn} activeOpacity={0.7}>
          <Ionicons name={isRTL ? 'chevron-forward' : 'chevron-back'} size={22} color="#7C3AED" />
        </TouchableOpacity>
        <SmallAiIcon active={sending} />
        <View style={{ flex: 1, paddingHorizontal: 10 }}>
          <Text style={gc.chatTitle}>مساعد غزالي AI</Text>
          <Text style={gc.chatSub}>
            {uploading
              ? 'جارٍ الرفع...'
              : speaking
              ? '🔊 يتحدث المساعد...'
              : sending
              ? 'يفكر...'
              : liveMode
              ? '● محادثة مباشرة'
              : 'جاهز للمحادثة'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={toggleLiveMode}
          style={[gc.liveToggle, liveMode && gc.liveToggleActive]}
          activeOpacity={0.7}
        >
          <Ionicons name={liveMode ? 'radio' : 'radio-outline'} size={16} color={liveMode ? '#fff' : '#7C3AED'} />
          <Text style={[gc.liveToggleText, liveMode && { color: '#fff' }]}>مباشر</Text>
        </TouchableOpacity>

        {liveMode && (
          <TouchableOpacity
            onPress={() => {
              if (!muted) {
                stopAiSpeaking();
                setMuted(true);
              } else {
                setMuted(false);
              }
            }}
            style={[gc.clearBtn, muted && { backgroundColor: '#EF444420', borderRadius: 8 }]}
            activeOpacity={0.7}
          >
            <Ionicons
              name={muted ? 'volume-mute' : speaking ? 'volume-high' : 'volume-medium-outline'}
              size={18}
              color={muted ? '#EF4444' : speaking ? '#10B981' : '#7C3AED80'}
            />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={() => {
            setPersistedMessages([]);
            setConversationId(null);
            onSetAiConversationId?.(null);
          }}
          style={gc.clearBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="refresh-outline" size={18} color="#7C3AED80" />
        </TouchableOpacity>
      </View>

      {loadingHistory ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={{ color: '#ffffff50', fontSize: 13, marginTop: 10 }}>جارٍ تحميل المحادثة...</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 8, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12 }}>
              <Ionicons name="chatbubbles-outline" size={48} color="#7C3AED40" />
              <Text style={{ color: '#ffffff50', fontSize: 14, textAlign: 'center' }}>
                اسألني أي سؤال عن قطع غيار السيارات أو الصيانة
              </Text>
              {quickQuestions.slice(0, 3).map((q, i) => (
                <TouchableOpacity
                  key={i}
                  style={[gc.quickChip, { backgroundColor: '#ffffff08', borderColor: '#7C3AED20' }]}
                  onPress={() => handleSend(q.text)}
                  disabled={sending}
                >
                  <Ionicons name={q.icon} size={14} color="#7C3AED" />
                  <Text style={{ color: '#ffffffAA', fontSize: 13, flex: 1 }}>{q.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          }
          renderItem={({ item }) => renderMsg({ item }, colors)}
        />
      )}

      {sending && (
        <View style={[gc.typingRow, { backgroundColor: 'transparent' }]}>
          <View style={[gc.aiMiniAvatar, { backgroundColor: '#7C3AED20' }]}>
            <Ionicons name="sparkles" size={12} color="#7C3AED" />
          </View>
          <View style={[gc.typingBubble, { backgroundColor: '#ffffff10' }]}>
            <TypingDots />
          </View>
        </View>
      )}

      <View style={[gc.composer, { backgroundColor: '#1A1A2E', borderTopColor: '#7C3AED20' }]}>
        {liveMode ? (
          <>
            <TouchableOpacity
              style={[gc.iconBtn, { backgroundColor: '#7C3AED15' }]}
              onPress={handlePickFile}
              disabled={uploading || sending || recording || transcribing}
            >
              <Ionicons name="attach" size={20} color={uploading ? '#7C3AED60' : '#7C3AED'} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                gc.micBtn,
                recording && gc.micBtnRecording,
                transcribing && { opacity: 0.5 },
              ]}
              onPress={recording ? stopRecordingAndTranscribe : startRecording}
              disabled={transcribing || sending}
              activeOpacity={0.8}
            >
              {transcribing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name={recording ? 'stop' : 'mic'} size={22} color="#fff" />
              )}
            </TouchableOpacity>

            <View style={[gc.input, { backgroundColor: '#ffffff08', justifyContent: 'center' }]}>
              <Text style={{ color: recording ? '#EF4444' : transcribing ? '#FFD700' : '#ffffff60', fontSize: 13, textAlign: 'center' }}>
                {transcribing ? 'جارٍ التحويل...' : recording ? '● يتم التسجيل — اضغط للإيقاف' : 'اضغط على الميكروفون للتحدث'}
              </Text>
            </View>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={[gc.iconBtn, { backgroundColor: '#7C3AED15' }]}
              onPress={handlePickFile}
              disabled={uploading || sending}
            >
              <Ionicons name="attach" size={20} color={uploading ? '#7C3AED60' : '#7C3AED'} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[gc.iconBtn, { backgroundColor: '#7C3AED15' }]}
              onPress={handlePickImage}
              disabled={uploading || sending}
            >
              <Ionicons name="image-outline" size={20} color={uploading ? '#7C3AED60' : '#7C3AED'} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[gc.iconBtn, { backgroundColor: '#7C3AED15' }]}
              onPress={handleCameraCapture}
              disabled={uploading || sending}
            >
              <Ionicons name="camera-outline" size={20} color={uploading ? '#7C3AED60' : '#7C3AED'} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              {pendingMedia && (
                <View style={gc.mediaPreviewRow}>
                  {pendingMedia.isImage ? (
                    <Image
                      source={{ uri: pendingMedia.uri }}
                      style={gc.mediaThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={gc.fileThumb}>
                      <Ionicons name="document-attach" size={18} color="#7C3AED" />
                    </View>
                  )}
                  <Text style={gc.mediaFileName} numberOfLines={1}>
                    {pendingMedia.fileName}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setPendingMedia(null)}
                    style={gc.mediaRemoveBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={18} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              )}
              <TextInput
                style={[gc.input, { backgroundColor: '#ffffff10', color: '#fff' }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={pendingMedia ? 'أضف تعليقاً أو سؤالاً (اختياري)...' : 'اكتب سؤالك هنا...'}
                placeholderTextColor="#ffffff40"
                multiline
                textAlign={isRTL ? 'right' : 'left'}
                onSubmitEditing={handleSendAll}
              />
            </View>

            <TouchableOpacity
              style={[
                gc.sendBtn,
                {
                  backgroundColor: '#7C3AED',
                  opacity: (inputText.trim() || pendingMedia) && !sending && !uploading ? 1 : 0.35,
                },
              ]}
              onPress={handleSendAll}
              disabled={(!inputText.trim() && !pendingMedia) || sending || uploading}
            >
              {sending || uploading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={17} color="#fff" style={{ transform: [{ scaleX: isRTL ? -1 : 1 }] }} />
              )}
            </TouchableOpacity>
          </>
        )}
      </View>
    </LinearGradient>
  );
}

export default function AiAgentTab({
  aiMessages,
  sending,
  isRTL,
  onSend,
  isPrivileged = false,
  conversations = [],
  onOpenConversation,
  liveMessages,
  activeConvId,
  onSetAiConversationId,
}: Props) {
  if (isPrivileged) {
    return (
      <PrivilegedAiTab
        conversations={conversations}
        isRTL={isRTL}
        onSend={onSend}
        sending={sending}
        onOpenConversation={onOpenConversation}
        liveMessages={liveMessages}
        activeConvId={activeConvId}
      />
    );
  }

  return (
    <CustomerAiTab
      aiMessages={aiMessages}
      sending={sending}
      isRTL={isRTL}
      onSend={onSend}
      onSetAiConversationId={onSetAiConversationId}
    />
  );
}

const gc = StyleSheet.create({
  container: { flex: 1 },
  idleBg: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  idleCenter: { alignItems: 'center', gap: 16, padding: 32 },
  idleTitle: { color: '#7C3AED', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  idleSub: { color: '#ffffff80', fontSize: 14, textAlign: 'center' },
  iconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconWrapSubs: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconGrad: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  glowRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: '#7C3AED50',
  },
  smallIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  subsGrad: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 },
  subsTitle: { color: '#7C3AED', fontSize: 26, fontWeight: '900', textAlign: 'center' },
  subsSub: { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  subsHint: { color: '#ffffff80', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  subsBtn: { marginTop: 10, borderRadius: 16, overflow: 'hidden' },
  subsBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingVertical: 14 },
  subsBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    width: '100%',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#7C3AED30',
    gap: 8,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#7C3AED15',
  },
  chatTitle: { color: '#7C3AED', fontSize: 15, fontWeight: '800' },
  chatSub: { color: '#ffffff60', fontSize: 11, marginTop: 1 },
  clearBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  liveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#7C3AED40',
    backgroundColor: '#7C3AED10',
  },
  liveToggleActive: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  liveToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7C3AED',
  },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 4 },
  typingBubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  aiMiniAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 8,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14,
    maxHeight: 100,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
  },
  micBtnRecording: {
    backgroundColor: '#EF4444',
  },
  mediaPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED18',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 4,
    gap: 6,
  },
  mediaThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#ffffff10',
  },
  fileThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#7C3AED20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaFileName: {
    flex: 1,
    color: '#ffffffCC',
    fontSize: 12,
    fontWeight: '600',
  },
  mediaRemoveBtn: {
    padding: 2,
  },
});

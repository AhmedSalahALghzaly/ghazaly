/**
 * Customers Management Screen - Enhanced with all features
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, RefreshControl,
  Modal, TextInput, ActivityIndicator, Linking, Platform,
  Animated,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAppStore } from '../../src/store/appStore';
import { customerApi } from '../../src/services/api';
import { ListItemSkeleton } from '../../src/components/ui/Skeleton';
import { AddCustomerModal } from '../../src/components/ui/AddCustomerModal';
import api from '../../src/services/api';
import { apiRequest, getApiUrl } from '@/lib/query-client';

const OWNER_WA = '0201011033571';

function openWhatsApp(phone: string) {
  const clean = phone.replace(/[^0-9]/g, '');
  const url = `https://wa.me/${clean}`;
  if (Platform.OS === 'web') {
    window.open(url, '_blank');
  } else {
    Linking.openURL(url);
  }
}

// ── Pulsing icon for "wants password" ──────────────────────────────────────
function PulsingIcon({ onPress }: { onPress: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Animated.View style={[styles.pulsingIconWrap, { transform: [{ scale: pulse }] }]}>
        <Ionicons name="key" size={14} color="#FFF" />
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── Set Password Modal ─────────────────────────────────────────────────────
function SetPasswordModal({ visible, customerName, customerId, isDark, ar, onClose, onSuccess }: {
  visible: boolean; customerName: string; customerId: string;
  isDark: boolean; ar: boolean; onClose: () => void; onSuccess: (pwd: string) => void;
}) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (!visible) { setPwd(''); setConfirm(''); setError(''); } }, [visible]);

  const handleSet = async () => {
    if (!pwd || pwd.length < 6) { setError(ar ? 'كلمة المرور يجب 6 أحرف على الأقل' : 'Password must be at least 6 characters'); return; }
    if (pwd !== confirm) { setError(ar ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match'); return; }
    setLoading(true); setError('');
    try {
      const url = new URL('/api/admin/set-user-password', getApiUrl());
      const res = await apiRequest('POST', url.toString(), { userId: customerId, password: pwd });
      const data = await res.json() as any;
      if (data.success) {
        try {
          const notifUrl = new URL('/api/admin/notify-user', getApiUrl());
          await apiRequest('POST', notifUrl.toString(), {
            userId: customerId,
            title: '🔐 تم إنشاء كلمة المرور',
            title_ar: '🔐 تم إنشاء كلمة المرور',
            message: `مرحباً ${customerName}،\n\nتم إنشاء كلمة مرور لحسابك في الغزالي لقطع غيار السيارات.\n\n🔑 كلمة المرور: ${pwd}\n\nيمكنك الآن تسجيل الدخول بالبريد الإلكتروني وكلمة المرور هذه. نوصي بتغييرها من إعدادات حسابك.`,
            message_ar: `مرحباً ${customerName}،\n\nتم إنشاء كلمة مرور لحسابك في الغزالي لقطع غيار السيارات.\n\n🔑 كلمة المرور: ${pwd}\n\nيمكنك الآن تسجيل الدخول بالبريد الإلكتروني وكلمة المرور هذه. نوصي بتغييرها من إعدادات حسابك.`,
          });
        } catch (_) {}
        onSuccess(pwd);
      }
      else { setError(data.detail || (ar ? 'حدث خطأ' : 'An error occurred')); }
    } catch (e: any) {
      const raw = e.message || '';
      try { const p = JSON.parse(raw.includes('{') ? raw.slice(raw.indexOf('{')) : '{}'); setError(p?.detail || (ar ? 'حدث خطأ' : 'An error occurred')); }
      catch { setError(ar ? 'حدث خطأ' : 'An error occurred'); }
    } finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[modalStyles.card, { backgroundColor: isDark ? '#0F172A' : '#FFF' }]}>
          <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color={isDark ? '#64748B' : '#94A3B8'} />
          </TouchableOpacity>
          <LinearGradient colors={['#7C3AED', '#A78BFA']} style={modalStyles.iconGrad}>
            <Ionicons name="key" size={28} color="#FFF" />
          </LinearGradient>
          <Text style={[modalStyles.title, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
            {ar ? 'تعيين كلمة مرور' : 'Set Password'}
          </Text>
          <Text style={[modalStyles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
            {customerName}
          </Text>

          <View style={[modalStyles.inputRow, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC', borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0' }]}>
            <Ionicons name="lock-closed-outline" size={18} color="#7C3AED" />
            <TextInput
              style={[modalStyles.input, { color: isDark ? '#F1F5F9' : '#1E293B' }]}
              placeholder={ar ? 'كلمة المرور الجديدة' : 'New password'}
              placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
              value={pwd}
              onChangeText={setPwd}
              secureTextEntry={!showPwd}
              textAlign={ar ? 'right' : 'left'}
            />
            <TouchableOpacity onPress={() => setShowPwd(!showPwd)}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <View style={[modalStyles.inputRow, { marginTop: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F8FAFC', borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#E2E8F0' }]}>
            <Ionicons name="checkmark-circle-outline" size={18} color={confirm && confirm === pwd ? '#10B981' : '#94A3B8'} />
            <TextInput
              style={[modalStyles.input, { color: isDark ? '#F1F5F9' : '#1E293B' }]}
              placeholder={ar ? 'تأكيد كلمة المرور' : 'Confirm password'}
              placeholderTextColor={isDark ? '#475569' : '#CBD5E1'}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPwd}
              textAlign={ar ? 'right' : 'left'}
            />
          </View>

          {error ? <View style={modalStyles.errorBox}><Ionicons name="alert-circle" size={14} color="#EF4444" /><Text style={modalStyles.errorText}>{error}</Text></View> : null}

          <TouchableOpacity style={[modalStyles.confirmBtn, loading && { opacity: 0.7 }]} onPress={handleSet} disabled={loading} activeOpacity={0.85}>
            <LinearGradient colors={['#7C3AED', '#A78BFA']} style={modalStyles.confirmBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {loading ? <ActivityIndicator color="#FFF" size="small" /> : (
                <>
                  <Ionicons name="shield-checkmark" size={18} color="#FFF" />
                  <Text style={modalStyles.confirmBtnText}>{ar ? 'حفظ كلمة المرور' : 'Save Password'}</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Dismiss Password Request Modal ─────────────────────────────────────────
function ConfirmDismissModal({ visible, customerName, requestId, isDark, ar, onClose, onDismissed }: {
  visible: boolean; customerName: string; requestId: string;
  isDark: boolean; ar: boolean; onClose: () => void; onDismissed: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleDismiss = async () => {
    setLoading(true);
    try {
      const url = new URL(`/api/admin/password-requests/${requestId}`, getApiUrl());
      await apiRequest('DELETE', url.toString());
      onDismissed();
    } catch {} finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        <View style={[modalStyles.card, { backgroundColor: isDark ? '#0F172A' : '#FFF' }]}>
          <LinearGradient colors={['#F59E0B', '#FBBF24']} style={modalStyles.iconGrad}>
            <Ionicons name="key" size={28} color="#FFF" />
          </LinearGradient>
          <Text style={[modalStyles.title, { color: isDark ? '#F1F5F9' : '#0F172A' }]}>
            {ar ? 'طلب كلمة مرور' : 'Password Request'}
          </Text>
          <Text style={[modalStyles.subtitle, { color: isDark ? '#94A3B8' : '#64748B' }]}>
            {ar ? `العميل ${customerName} يطلب كلمة مرور` : `${customerName} is requesting a password`}
          </Text>
          <Text style={[modalStyles.dismissNote, { color: isDark ? '#64748B' : '#94A3B8' }]}>
            {ar ? 'بعد إرسال كلمة المرور للعميل، اضغط تأكيد لإخفاء الإشعار' : 'After sending the password to the customer, tap confirm to hide the notification'}
          </Text>

          <View style={modalStyles.btnRow}>
            <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}>
              <Text style={[modalStyles.cancelBtnText, { color: isDark ? '#94A3B8' : '#64748B' }]}>{ar ? 'لاحقاً' : 'Later'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[modalStyles.confirmBtn, { flex: 1, marginTop: 0 }, loading && { opacity: 0.7 }]} onPress={handleDismiss} disabled={loading}>
              <LinearGradient colors={['#F59E0B', '#FBBF24']} style={modalStyles.confirmBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {loading ? <ActivityIndicator color="#FFF" size="small" /> : (
                  <Text style={modalStyles.confirmBtnText}>{ar ? 'تم الإرسال' : 'Sent, Dismiss'}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────
export default function CustomersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const customers = useAppStore((state) => state.customers);
  const setCustomers = useAppStore((state) => state.setCustomers);
  const isRTL = language === 'ar';
  const ar = isRTL;

  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState('most_purchased');
  const [showAddModal, setShowAddModal] = useState(false);
  const [customersList, setCustomersList] = useState<any[]>([]);

  // Modals
  const [setPwdModal, setSetPwdModal] = useState<{ visible: boolean; customerId: string; name: string }>({ visible: false, customerId: '', name: '' });
  const [dismissModal, setDismissModal] = useState<{ visible: boolean; customerId: string; name: string; requestId: string }>({ visible: false, customerId: '', name: '', requestId: '' });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingPhone, setConfirmingPhone] = useState<{ [userId: string]: boolean }>({});

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const res = await customerApi.getAll();
      const list = res.data?.customers || res.data || [];
      setCustomers(list);
      setCustomersList(list);
    } catch (err) {
      console.error('Error fetching customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCustomers();
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchCustomers(); }, []);

  const sortedCustomers = useMemo(() => {
    const list = Array.isArray(customersList) ? [...customersList] : [];
    if (sortMode === 'most_purchased') {
      return list.sort((a, b) => (Number(b.orders_count) || 0) - (Number(a.orders_count) || 0));
    }
    return list.sort((a, b) => (Number(b.total_spent) || 0) - (Number(a.total_spent) || 0));
  }, [customersList, sortMode]);

  const totals = useMemo(() => {
    const list = Array.isArray(customersList) ? customersList : [];
    return {
      totalCustomers: list.length,
      totalOrders: list.reduce((sum, c) => sum + (Number(c.orders_count) || 0), 0),
      totalValue: list.reduce((sum, c) => sum + (Number(c.total_spent) || 0), 0),
    };
  }, [customersList]);

  const handleCopyPassword = async (pwd: string, id: string) => {
    await Clipboard.setStringAsync(pwd);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConfirmPhone = async (userId: string) => {
    setConfirmingPhone(prev => ({ ...prev, [userId]: true }));
    try {
      const url = new URL('/api/phone-verification/owner-confirm', getApiUrl());
      await apiRequest('POST', url.toString(), { userId });
      setCustomersList(prev => prev.map(c =>
        (c.id === userId || c.user_id === userId)
          ? { ...c, phone: c.pending_phone, phone_verified: true, pending_phone: null }
          : c
      ));
    } catch {} finally {
      setConfirmingPhone(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleRejectPhone = async (userId: string) => {
    try {
      const url = new URL('/api/phone-verification/owner-reject', getApiUrl());
      await apiRequest('POST', url.toString(), { userId });
      setCustomersList(prev => prev.map(c =>
        (c.id === userId || c.user_id === userId) ? { ...c, pending_phone: null } : c
      ));
    } catch {}
  };

  const ListHeaderComponent = () => (
    <>
      <View style={[styles.header, isRTL && styles.headerRTL]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{ar ? 'العملاء' : 'Customers'}</Text>
        <View style={styles.headerRight}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{customersList.length}</Text>
          </View>
          <TouchableOpacity style={styles.addCircleBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.8}>
            <Ionicons name="add" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statsRow}>
        {[
          { icon: 'people', color: '#3B82F6', value: totals.totalCustomers, label: ar ? 'العملاء' : 'Customers' },
          { icon: 'receipt', color: '#10B981', value: totals.totalOrders, label: ar ? 'الطلبات' : 'Orders' },
          { icon: 'cash', color: '#F59E0B', value: `${(totals.totalValue / 1000).toFixed(1)}K`, label: ar ? 'ج.م' : 'EGP' },
        ].map((s, i) => (
          <View key={i} style={styles.statBox}>
            <Ionicons name={s.icon as any} size={22} color={s.color} />
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.toggleContainer}>
        {[
          { key: 'most_purchased', icon: 'cart', label: ar ? 'الأكثر شراءً' : 'Most Purchased' },
          { key: 'highest_value', icon: 'trending-up', label: ar ? 'أعلى قيمة' : 'Highest Value' },
        ].map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.toggleButton, sortMode === t.key && styles.toggleActive]}
            onPress={() => setSortMode(t.key)}
          >
            <Ionicons name={t.icon as any} size={17} color={sortMode === t.key ? '#FFF' : 'rgba(255,255,255,0.6)'} />
            <Text style={[styles.toggleText, sortMode === t.key && styles.toggleTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const ListEmptyComponent = () => {
    if (loading) {
      return <View>{[1, 2, 3].map(i => <View key={i} style={{ marginBottom: 12 }}><ListItemSkeleton /></View>)}</View>;
    }
    return (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={56} color="rgba(255,255,255,0.4)" />
        <Text style={styles.emptyText}>{ar ? 'لا يوجد عملاء' : 'No customers yet'}</Text>
      </View>
    );
  };

  const renderCustomerItem = ({ item: customer, index }: { item: any; index: number }) => {
    const userId = customer.id || customer.user_id;
    const isOwner = !!customer.is_owner;
    const hasPassword = !!customer.has_password;
    const isOAuthOnly = (!hasPassword) && !isOwner;
    const wantsPwd = !!customer.password_request_id && !isOwner;
    const pendingPhone = customer.pending_phone;
    const phone = customer.phone;
    const pwd = customer.owner_temp_password;
    const isConfirming = !!confirmingPhone[userId];
    const orderCount = Number(customer.orders_count) || 0;

    return (
      <TouchableOpacity
        style={styles.customerCard}
        onPress={() => router.push(`/admin/customers?customerId=${userId}`)}
        activeOpacity={0.75}
      >
        <BlurView intensity={12} tint="light" style={styles.cardBlur}>
          {/* Rank + top-right icons */}
          <View style={[styles.cardTopRow, isRTL && { flexDirection: 'row-reverse' }]}>
            <View style={[styles.rankBadge, index === 0 && styles.rankGold, index === 1 && styles.rankSilver, index === 2 && styles.rankBronze]}>
              <Text style={styles.rankText}>#{index + 1}</Text>
            </View>

            <View style={styles.iconRow}>
              {/* "Wants password" pulsing icon */}
              {wantsPwd && (
                <PulsingIcon onPress={() => setDismissModal({ visible: true, customerId: userId, name: customer.name || customer.email, requestId: customer.password_request_id })} />
              )}

              {/* "No password / OAuth only" icon */}
              {isOAuthOnly && (
                <TouchableOpacity
                  style={styles.noPwdIcon}
                  onPress={() => setSetPwdModal({ visible: true, customerId: userId, name: customer.name || customer.email })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="key-outline" size={14} color="#FFF" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Main content */}
          <View style={[styles.cardBody, isRTL && { flexDirection: 'row-reverse' }]}>
            <View style={styles.customerAvatar}>
              {isOwner
                ? <Ionicons name="shield" size={22} color="#F59E0B" />
                : <Ionicons name="person" size={22} color="#3B82F6" />}
            </View>

            <View style={styles.customerInfo}>
              <View style={[styles.nameRow, isRTL && { flexDirection: 'row-reverse' }]}>
                <Text style={styles.customerName} numberOfLines={1}>{customer.name || customer.email}</Text>
                {isOwner && <View style={styles.ownerBadge}><Text style={styles.ownerBadgeText}>{ar ? 'مالك' : 'Owner'}</Text></View>}
              </View>
              <Text style={styles.customerEmail} numberOfLines={1}>{customer.email}</Text>

              {/* Stats row */}
              <View style={[styles.statsInCard, isRTL && { flexDirection: 'row-reverse' }]}>
                <View style={styles.cardStat}>
                  <Ionicons name="cart" size={11} color="#10B981" />
                  <Text style={styles.cardStatText}>{orderCount} {ar ? 'طلبات' : 'orders'}</Text>
                </View>
                <View style={styles.cardStat}>
                  <Ionicons name="cash" size={11} color="#F59E0B" />
                  <Text style={styles.cardStatText}>{(Number(customer.total_spent) || 0).toLocaleString()} {ar ? 'ج.م' : 'EGP'}</Text>
                </View>
              </View>

              {/* Phone row */}
              {phone ? (
                <TouchableOpacity
                  style={[styles.phoneRow, isRTL && { flexDirection: 'row-reverse' }]}
                  onPress={() => openWhatsApp(phone)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="logo-whatsapp" size={13} color="#25D366" />
                  <Text style={styles.phoneText}>{phone}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Pending phone row - visible to owner for confirm/reject */}
              {pendingPhone ? (
                <View style={styles.pendingPhoneRow}>
                  <Ionicons name="time-outline" size={13} color="#F59E0B" />
                  <Text style={styles.pendingPhoneText} numberOfLines={1}>{pendingPhone}</Text>
                  <TouchableOpacity
                    style={[styles.phActBtn, styles.phConfirmBtn]}
                    onPress={() => handleConfirmPhone(userId)}
                    disabled={isConfirming}
                  >
                    {isConfirming
                      ? <ActivityIndicator size="small" color="#FFF" />
                      : <Ionicons name="checkmark" size={14} color="#FFF" />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.phActBtn, styles.phRejectBtn]}
                    onPress={() => handleRejectPhone(userId)}
                  >
                    <Ionicons name="close" size={14} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Password row - copyable (except owner) */}
              {!isOwner && pwd ? (
                <TouchableOpacity
                  style={[styles.pwdRow, isRTL && { flexDirection: 'row-reverse' }]}
                  onPress={() => handleCopyPassword(pwd, userId)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="lock-closed" size={11} color="rgba(255,255,255,0.5)" />
                  <Text style={styles.pwdText}>{pwd}</Text>
                  <View style={[styles.copyBadge, copiedId === userId && styles.copyBadgeCopied]}>
                    <Ionicons name={copiedId === userId ? 'checkmark' : 'copy-outline'} size={11} color="#FFF" />
                    <Text style={styles.copyBadgeText}>{copiedId === userId ? (ar ? 'تم' : 'Copied') : (ar ? 'نسخ' : 'Copy')}</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </BlurView>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1E3A5F', '#2D5A8F', '#3D7ABF']} style={StyleSheet.absoluteFill} />

      <AddCustomerModal visible={showAddModal} onClose={() => setShowAddModal(false)} onSuccess={() => fetchCustomers()} />

      {/* Set Password Modal */}
      <SetPasswordModal
        visible={setPwdModal.visible}
        customerName={setPwdModal.name}
        customerId={setPwdModal.customerId}
        isDark={true}
        ar={ar}
        onClose={() => setSetPwdModal({ visible: false, customerId: '', name: '' })}
        onSuccess={(pwd) => {
          setCustomersList(prev => prev.map(c =>
            (c.id === setPwdModal.customerId || c.user_id === setPwdModal.customerId)
              ? { ...c, has_password: true, owner_temp_password: pwd }
              : c
          ));
          setSetPwdModal({ visible: false, customerId: '', name: '' });
        }}
      />

      {/* Dismiss password request modal */}
      <ConfirmDismissModal
        visible={dismissModal.visible}
        customerName={dismissModal.name}
        requestId={dismissModal.requestId}
        isDark={true}
        ar={ar}
        onClose={() => setDismissModal({ visible: false, customerId: '', name: '', requestId: '' })}
        onDismissed={() => {
          setCustomersList(prev => prev.map(c =>
            (c.id === dismissModal.customerId || c.user_id === dismissModal.customerId)
              ? { ...c, password_request_id: null }
              : c
          ));
          setDismissModal({ visible: false, customerId: '', name: '', requestId: '' });
        }}
      />

      <FlashList
        data={loading ? [] : sortedCustomers}
        renderItem={renderCustomerItem}
        keyExtractor={(item, index) => item.id || String(index)}
        estimatedItemSize={120}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        ListFooterComponent={() => <View style={{ height: insets.bottom + 40 }} />}
        contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFF" />}
      />
    </View>
  );
}

// ── Modal shared styles ──────────────────────────────────────────────────────
const modalStyles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 400, borderRadius: 28, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.3, shadowRadius: 30, elevation: 20 },
  closeBtn: { position: 'absolute', top: 14, right: 14, zIndex: 10, padding: 6 },
  iconGrad: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, marginBottom: 20, textAlign: 'center' },
  dismissNote: { fontSize: 12, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 50, width: '100%' },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 10, marginTop: 10, width: '100%' },
  errorText: { color: '#EF4444', fontSize: 13, flex: 1 },
  confirmBtn: { marginTop: 16, borderRadius: 14, overflow: 'hidden', width: '100%' },
  confirmBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 50, gap: 8 },
  confirmBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10, width: '100%', alignItems: 'center' },
  cancelBtn: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(100,116,139,0.3)', marginTop: 16 },
  cancelBtnText: { fontSize: 14, fontWeight: '600' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  headerRTL: { flexDirection: 'row-reverse' },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '700', color: '#FFF' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  headerBadgeText: { color: '#FFF', fontWeight: '600' },
  addCircleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(59,130,246,0.85)', alignItems: 'center', justifyContent: 'center', shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  statsRow: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 16 },
  statBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', color: '#FFF', marginTop: 6 },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 3 },
  toggleContainer: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 4, marginBottom: 16 },
  toggleButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 10, gap: 5 },
  toggleActive: { backgroundColor: 'rgba(59,130,246,0.8)' },
  toggleText: { fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  toggleTextActive: { color: '#FFF' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 16, marginTop: 16 },

  // Customer card
  customerCard: { marginBottom: 14, borderRadius: 18, overflow: 'hidden' },
  cardBlur: { backgroundColor: 'rgba(255,255,255,0.1)' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 },
  rankBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  rankGold: { backgroundColor: 'rgba(234,179,8,0.5)' },
  rankSilver: { backgroundColor: 'rgba(156,163,175,0.5)' },
  rankBronze: { backgroundColor: 'rgba(180,83,9,0.5)' },
  rankText: { fontSize: 10, fontWeight: '700', color: '#FFF' },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  pulsingIconWrap: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.6, shadowRadius: 6, elevation: 4 },
  noPwdIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(124,58,237,0.8)', alignItems: 'center', justifyContent: 'center', shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 6, elevation: 4 },

  cardBody: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, paddingTop: 4, gap: 12 },
  customerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(59,130,246,0.2)', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  customerInfo: { flex: 1 },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  customerName: { fontSize: 15, fontWeight: '600', color: '#FFF', flex: 1 },
  ownerBadge: { backgroundColor: 'rgba(245,158,11,0.25)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  ownerBadgeText: { fontSize: 10, color: '#FBBF24', fontWeight: '700' },
  customerEmail: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 6 },

  statsInCard: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  cardStat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardStatText: { fontSize: 11, color: 'rgba(255,255,255,0.8)' },

  // Phone row (confirmed phone with WhatsApp)
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(37,211,102,0.08)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6, alignSelf: 'flex-start' },
  phoneText: { fontSize: 12, color: '#4ADE80', fontWeight: '600' },

  // Pending phone row
  pendingPhoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6 },
  pendingPhoneText: { fontSize: 11, color: '#FBBF24', flex: 1 },
  phActBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  phConfirmBtn: { backgroundColor: '#10B981' },
  phRejectBtn: { backgroundColor: '#EF4444' },

  // Password row
  pwdRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  pwdText: { fontSize: 12, color: 'rgba(255,255,255,0.75)', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, flex: 1, letterSpacing: 0.5 },
  copyBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(59,130,246,0.4)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  copyBadgeCopied: { backgroundColor: 'rgba(16,185,129,0.5)' },
  copyBadgeText: { fontSize: 10, color: '#FFF', fontWeight: '600' },
});

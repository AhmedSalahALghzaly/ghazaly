/**
 * ProfileTab - Profile information display tab
 * Shows user account details, subscription data strips, and quick stats
 * Strip 1 (Basic): subscription form fields — governorate, village, address, car model
 * Strip 2 (Additional): checkout shipping address if modified from subscription data
 */
import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '../ui/GlassCard';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppStore, NEON_NIGHT_THEME } from '../../store/appStore';
import { subscriptionRequestApi, orderApi, customerApi } from '../../services/api';

interface ProfileTabProps {
  profileData: any;
  ordersCount: number;
  favoritesCount: number;
  cartItemsCount: number;
  isRTL: boolean;
  isAdminView?: boolean;
  customerEmail?: string;
}

export const ProfileTab: React.FC<ProfileTabProps> = ({
  profileData,
  ordersCount,
  favoritesCount,
  cartItemsCount,
  isRTL,
  isAdminView = false,
  customerEmail,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const userRole = useAppStore((s) => s.userRole);
  const ar = language === 'ar';

  const { data: subRequests } = useQuery<any[]>({
    queryKey: ['/api/subscription-requests'],
    queryFn: () => subscriptionRequestApi.getAll().then((r: any) => r.data),
    enabled: !isAdminView,
  });

  const { data: adminSubRequests } = useQuery<any[]>({
    queryKey: ['/api/subscription-requests', customerEmail],
    queryFn: () => subscriptionRequestApi.getByEmail(customerEmail!).then((r: any) => r.data),
    enabled: isAdminView && !!customerEmail,
  });

  const activeRequests = isAdminView ? (adminSubRequests || []) : (subRequests || []);
  const approvedSub = activeRequests.find((r: any) => r.status === 'approved') || null;
  const pendingSub = !approvedSub ? (activeRequests[0] || null) : null;
  const activeSub = approvedSub || pendingSub;

  const { data: orders } = useQuery<any[]>({
    queryKey: ['/api/orders'],
    queryFn: () => orderApi.getAll().then((r: any) => r.data),
    enabled: !isAdminView && !!approvedSub,
  });

  const { data: adminCustomerOrders } = useQuery<any[]>({
    queryKey: ['/api/customers/admin/orders', profileData?.id],
    queryFn: () => customerApi.getOrders(profileData!.id).then((r: any) => r.data?.orders || r.data || []),
    enabled: isAdminView && !!profileData?.id && !!approvedSub,
  });

  const activeOrders: any[] = Array.isArray(isAdminView ? adminCustomerOrders : orders)
    ? (isAdminView ? adminCustomerOrders! : orders!)
    : [];

  const parseAddress = (addr: string): [string, string, string] => {
    if (!addr) return ['', '', ''];
    const first = addr.indexOf(' - ');
    if (first < 0) return [addr, '', ''];
    const second = addr.indexOf(' - ', first + 3);
    if (second < 0) return [addr.slice(0, first), addr.slice(first + 3), ''];
    return [addr.slice(0, first), addr.slice(first + 3, second), addr.slice(second + 3)];
  };

  const changedDeliveryFields = (() => {
    if (!approvedSub || activeOrders.length === 0) return [];
    const latestOrder = activeOrders.find((o: any) =>
      o.status === 'delivered' || o.status === 'shipped' || o.status === 'pending'
    );
    if (!latestOrder) return [];
    const orderAddr = latestOrder.street_address || latestOrder.shipping_address || '';
    const [orderGov, orderCity, orderDetailed] = parseAddress(orderAddr);
    const fields: { icon: string; label: string; value: string }[] = [];
    if (orderGov && approvedSub.governorate && orderGov !== approvedSub.governorate) {
      fields.push({ icon: 'business-outline', label: ar ? 'المحافظة' : 'Governorate', value: orderGov });
    }
    if (orderCity && approvedSub.village && orderCity !== approvedSub.village) {
      fields.push({ icon: 'map-outline', label: ar ? 'المدينة/المنطقة' : 'City/Area', value: orderCity });
    }
    if (orderDetailed && approvedSub.detailed_address && orderDetailed !== approvedSub.detailed_address) {
      fields.push({ icon: 'home-outline', label: ar ? 'العنوان التفصيلي' : 'Detailed Address', value: orderDetailed });
    }
    if (latestOrder.phone && approvedSub.phone && latestOrder.phone !== approvedSub.phone) {
      fields.push({ icon: 'call-outline', label: ar ? 'رقم الهاتف' : 'Phone', value: latestOrder.phone });
    }
    return fields;
  })();

  const phoneVerified = !!profileData?.phone_verified;
  const phoneColorAnim = useRef(new Animated.Value(phoneVerified ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(phoneColorAnim, {
      toValue: phoneVerified ? 1 : 0,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [phoneVerified]);

  const animatedPhoneColor = phoneColorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#3B82F6', '#10B981'],
  });

  const isPrivileged = userRole === 'owner' || userRole === 'admin';

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString(ar ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  };

  const handleEmailPress = () => {
    if (profileData?.email) Linking.openURL(`mailto:${profileData.email}`);
  };

  const handlePhonePress = () => {
    if (profileData?.phone) {
      const waNumber = profileData.phone.replace(/\D/g, '');
      Linking.openURL(`https://wa.me/${waNumber}`);
    }
  };

  const basicFields = activeSub ? [
    { icon: 'person-outline', label: ar ? 'الاسم' : 'Name', value: activeSub.customer_name },
    { icon: 'call-outline', label: ar ? 'الهاتف' : 'Phone', value: activeSub.phone },
    { icon: 'location-outline', label: ar ? 'المحافظة' : 'Governorate', value: activeSub.governorate },
    { icon: 'map-outline', label: ar ? 'القرية/المنطقة' : 'Village/Area', value: activeSub.village },
    { icon: 'home-outline', label: ar ? 'العنوان' : 'Address', value: activeSub.detailed_address },
    { icon: 'car-outline', label: ar ? 'موديل السيارة' : 'Car Model', value: activeSub.car_model_name },
    { icon: 'chatbubble-outline', label: ar ? 'ملاحظات' : 'Notes', value: activeSub.notes },
  ].filter(f => f.value) : [];

  return (
    <>
      <GlassCard>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {ar ? 'معلومات الحساب' : 'Account Information'}
        </Text>

        <View style={styles.profileDetails}>
          {/* Name */}
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Ionicons name="person-outline" size={20} color={NEON_NIGHT_THEME.primary} />
            <View style={styles.detailInfo}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                {ar ? 'الاسم' : 'Name'}
              </Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {profileData?.name || '-'}
              </Text>
            </View>
          </View>

          {/* Email */}
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Ionicons name="mail-outline" size={20} color={NEON_NIGHT_THEME.primary} />
            <View style={styles.detailInfo}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                {ar ? 'البريد الإلكتروني' : 'Email'}
              </Text>
              {isAdminView && isPrivileged && profileData?.email ? (
                <TouchableOpacity onPress={handleEmailPress} activeOpacity={0.7}>
                  <Text style={[styles.detailValue, { color: '#3B82F6', textDecorationLine: 'underline' }]}>
                    {profileData.email}
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {profileData?.email || '-'}
                </Text>
              )}
            </View>
          </View>

          {/* Phone */}
          <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
            <Ionicons
              name={phoneVerified ? 'call' : 'call-outline'}
              size={20}
              color={NEON_NIGHT_THEME.primary}
            />
            <View style={[styles.detailInfo, { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }]}>
              <View style={styles.phoneBlock}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                  {ar ? 'رقم الهاتف' : 'Phone'}
                </Text>
                {profileData?.phone ? (
                  <View style={styles.phoneRow}>
                    {isAdminView && isPrivileged ? (
                      <TouchableOpacity onPress={handlePhonePress} activeOpacity={0.7} style={styles.phoneRow}>
                        <Animated.Text style={[styles.detailValue, { color: animatedPhoneColor }]}>
                          {profileData.phone}
                        </Animated.Text>
                        <Ionicons name="logo-whatsapp" size={14} color="#25D366" style={{ marginLeft: 4 }} />
                      </TouchableOpacity>
                    ) : (
                      <Animated.Text style={[styles.detailValue, { color: animatedPhoneColor }]}>
                        {profileData.phone}
                      </Animated.Text>
                    )}
                  </View>
                ) : (
                  <Text style={[styles.detailValue, { color: colors.text }]}>-</Text>
                )}
              </View>
              {profileData?.phone && (
                <View style={[
                  styles.verifiedBadge,
                  { backgroundColor: phoneVerified ? '#10B98120' : '#3B82F620', borderColor: phoneVerified ? '#10B981' : '#3B82F6' },
                ]}>
                  <Ionicons
                    name={phoneVerified ? 'checkmark-circle' : 'time-outline'}
                    size={11}
                    color={phoneVerified ? '#10B981' : '#3B82F6'}
                  />
                  <Text style={[styles.verifiedText, { color: phoneVerified ? '#10B981' : '#3B82F6' }]}>
                    {phoneVerified
                      ? (ar ? 'موثّق' : 'Verified')
                      : (ar ? 'غير موثّق' : 'Unverified')}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Join Date */}
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Ionicons name="calendar-outline" size={20} color={NEON_NIGHT_THEME.primary} />
            <View style={styles.detailInfo}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                {ar ? 'تاريخ الانضمام' : 'Joined'}
              </Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {formatDate(profileData?.created_at)}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Stats */}
        <View style={[styles.statsGrid, { marginTop: 16 }]}>
          <View style={[styles.statCard, { backgroundColor: '#3B82F6' + '20' }]}>
            <Text style={[styles.statValue, { color: '#3B82F6' }]}>{ordersCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {ar ? 'الطلبات' : 'Orders'}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#EF4444' + '20' }]}>
            <Text style={[styles.statValue, { color: '#EF4444' }]}>{favoritesCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {ar ? 'المفضلة' : 'Favorites'}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#10B981' + '20' }]}>
            <Text style={[styles.statValue, { color: '#10B981' }]}>{cartItemsCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              {ar ? 'السلة' : 'In Cart'}
            </Text>
          </View>
        </View>
      </GlassCard>

      {/* Strip 1: Basic Subscription Data */}
      {activeSub && basicFields.length > 0 && (
        <GlassCard style={styles.stripCard}>
          <View style={styles.stripHeader}>
            <View style={[styles.stripBadge, {
              backgroundColor: approvedSub ? '#10B98118' : '#F59E0B18',
              borderColor: approvedSub ? '#10B981' : '#F59E0B',
            }]}>
              <Ionicons
                name={approvedSub ? 'checkmark-circle' : 'time-outline'}
                size={13}
                color={approvedSub ? '#10B981' : '#F59E0B'}
              />
              <Text style={[styles.stripBadgeText, { color: approvedSub ? '#10B981' : '#F59E0B' }]}>
                {approvedSub
                  ? (ar ? 'مشترك فعّال' : 'Active Subscriber')
                  : (ar ? 'قيد المراجعة' : 'Pending Review')}
              </Text>
            </View>
            <Text style={[styles.stripTitle, { color: colors.text }]}>
              {ar ? 'بيانات الاشتراك الأساسية' : 'Basic Subscription Data'}
            </Text>
          </View>

          {basicFields.map((field, idx) => (
            <View
              key={idx}
              style={[
                styles.stripRow,
                { borderTopColor: colors.border },
                idx === 0 && { borderTopWidth: 0, marginTop: 8 },
              ]}
            >
              <View style={[styles.stripIconWrap, { backgroundColor: NEON_NIGHT_THEME.primary + '18' }]}>
                <Ionicons name={field.icon as any} size={15} color={NEON_NIGHT_THEME.primary} />
              </View>
              <View style={styles.stripRowInfo}>
                <Text style={[styles.stripRowLabel, { color: colors.textSecondary }]}>{field.label}</Text>
                <Text style={[styles.stripRowValue, { color: colors.text }]}>{field.value}</Text>
              </View>
            </View>
          ))}
        </GlassCard>
      )}

      {/* Strip 2: Additional Checkout Data (only if any delivery field differs from subscription) */}
      {changedDeliveryFields.length > 0 && (
        <GlassCard style={styles.stripCard}>
          <View style={styles.stripHeader}>
            <View style={[styles.stripBadge, { backgroundColor: '#3B82F618', borderColor: '#3B82F6' }]}>
              <Ionicons name="bag-handle-outline" size={13} color="#3B82F6" />
              <Text style={[styles.stripBadgeText, { color: '#3B82F6' }]}>
                {ar ? 'مُعدَّل من الدفع' : 'Modified at Checkout'}
              </Text>
            </View>
            <Text style={[styles.stripTitle, { color: colors.text }]}>
              {ar ? 'بيانات التوصيل الإضافية' : 'Additional Delivery Data'}
            </Text>
          </View>

          {changedDeliveryFields.map((field, idx) => (
            <View
              key={idx}
              style={[
                styles.stripRow,
                { borderTopColor: colors.border },
                idx === 0 && { borderTopWidth: 0, marginTop: 8 },
              ]}
            >
              <View style={[styles.stripIconWrap, { backgroundColor: '#3B82F618' }]}>
                <Ionicons name={field.icon as any} size={15} color="#3B82F6" />
              </View>
              <View style={styles.stripRowInfo}>
                <Text style={[styles.stripRowLabel, { color: colors.textSecondary }]}>{field.label}</Text>
                <Text style={[styles.stripRowValue, { color: colors.text }]}>{field.value}</Text>
              </View>
            </View>
          ))}
        </GlassCard>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  profileDetails: {},
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  detailInfo: { flex: 1 },
  detailLabel: { fontSize: 12, marginBottom: 2 },
  detailValue: { fontSize: 15, fontWeight: '500' },
  phoneBlock: { flex: 1 },
  phoneRow: { flexDirection: 'row', alignItems: 'center' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  verifiedText: { fontSize: 10, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, padding: 12, borderRadius: 12, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 4 },

  stripCard: { marginTop: 12 },
  stripHeader: { marginBottom: 4 },
  stripBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, marginBottom: 8 },
  stripBadgeText: { fontSize: 11, fontWeight: '700' },
  stripTitle: { fontSize: 15, fontWeight: '700' },
  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1 },
  stripIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stripRowInfo: { flex: 1 },
  stripRowLabel: { fontSize: 11, marginBottom: 2 },
  stripRowValue: { fontSize: 14, fontWeight: '500' },
});

/**
 * OrdersTab - Order history + Booking Strip (2026 design)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '../ui/EmptyState';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';
import { appointmentsApi } from '../../services/api';
import MaintenanceBookingModal from '../chat/MaintenanceBookingModal';

const ARABIC_MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];
const DAY_LABELS = ['أح','إث','ث','أر','خ','ج','س'];

interface Appointment {
  id: string;
  appointment_date: string;
  service_type?: string;
  status?: string;
  car_info?: string;
}

interface OrdersTabProps {
  orders: any[];
  isRTL: boolean;
  canEditOrderStatus: boolean;
  updatingOrderId: string | null;
  onUpdateStatus: (orderId: string, newStatus: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const getStatusInfo = (status: string) => {
  const statusMap: { [key: string]: { label: string; labelAr: string; color: string; icon: string } } = {
    pending: { label: 'Pending', labelAr: 'قيد الانتظار', color: '#f59e0b', icon: 'time-outline' },
    preparing: { label: 'Preparing', labelAr: 'قيد التحضير', color: '#3b82f6', icon: 'construct-outline' },
    shipped: { label: 'Shipped', labelAr: 'تم الشحن', color: '#eab308', icon: 'airplane-outline' },
    out_for_delivery: { label: 'Out for Delivery', labelAr: 'في الطريق', color: '#6b7280', icon: 'car-outline' },
    delivered: { label: 'Delivered', labelAr: 'تم التسليم', color: '#10b981', icon: 'checkmark-circle' },
    cancelled: { label: 'Cancelled', labelAr: 'ملغي', color: '#ef4444', icon: 'close-circle' },
  };
  return statusMap[status] || statusMap.pending;
};

const StatusActionButton: React.FC<{
  orderId: string;
  status: string;
  label: string;
  labelAr: string;
  icon: string;
  color: string;
  updatingOrderId: string | null;
  language: string;
  onPress: () => void;
}> = ({ orderId, status, label, labelAr, icon, color, updatingOrderId, language, onPress }) => {
  const isLoading = updatingOrderId === `${orderId}_${status}`;
  return (
    <Pressable
      style={[styles.statusActionBtn, { backgroundColor: color }]}
      onPress={onPress}
      disabled={updatingOrderId !== null}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <>
          <Ionicons name={icon as any} size={12} color="#FFF" />
          <Text style={styles.statusActionText}>{language === 'ar' ? labelAr : label}</Text>
        </>
      )}
    </Pressable>
  );
};

const TIME_SLOT_COUNT = 9; // 09:00 → 17:00

// ─── Booking Strip ──────────────────────────────────────────────────────────
function BookingStrip({ onOpenBooking }: { onOpenBooking: () => void }) {
  const { colors } = useTheme();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [bookedTimesMap, setBookedTimesMap] = useState<Map<string, Set<string>>>(new Map());
  const [loading, setLoading] = useState(false);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      appointmentsApi.getAll().then((res) => {
        const data: Appointment[] = Array.isArray(res.data) ? res.data : (res.data?.appointments ?? res.data?.items ?? []);
        setAppointments(data);
      }),
      appointmentsApi.getSlots().then((res) => {
        const slots: string[] = res.data?.slots ?? [];
        const map = new Map<string, Set<string>>();
        slots.forEach((isoStr: string) => {
          const d = new Date(isoStr);
          const dateKey = d.toISOString().split('T')[0];
          const timeKey = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          if (!map.has(dateKey)) map.set(dateKey, new Set());
          map.get(dateKey)!.add(timeKey);
        });
        setBookedTimesMap(map);
      }),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const getApptForDate = (iso: string) =>
    appointments.find((a) => a.appointment_date.split('T')[0] === iso);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();

  const cells: { day: number | null; iso: string | null }[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, iso: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, iso });
  }

  const goNextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };
  const goPrevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const handleDayPress = (iso: string) => {
    const bookedTimes = bookedTimesMap.get(iso);
    if (bookedTimes && bookedTimes.size > 0) {
      const appt = getApptForDate(iso);
      setSelectedAppt(appt ?? null);
      setTooltipVisible(true);
    }
  };

  const confirmDelete = (appt: Appointment) => {
    Alert.alert(
      'حذف الموعد',
      `هل تريد حذف هذا الموعد نهائياً؟\n${new Date(appt.appointment_date).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await appointmentsApi.delete(appt.id);
              setTooltipVisible(false);
              setSelectedAppt(null);
              loadData();
            } catch {
              Alert.alert('خطأ', 'فشل حذف الموعد');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const todayIso = today.toISOString().split('T')[0];

  return (
    <View style={[strip.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Strip Header */}
      <View style={strip.header}>
        <TouchableOpacity
          style={[strip.calIconBtn, { backgroundColor: '#FFD70015', borderColor: '#FFD70040' }]}
          onPress={onOpenBooking}
          activeOpacity={0.8}
        >
          <Ionicons name="calendar-outline" size={20} color="#FFD700" />
          <Text style={strip.calIconLabel}>حجز موعد</Text>
        </TouchableOpacity>

        <View style={strip.monthNav}>
          <TouchableOpacity onPress={goNextMonth} style={strip.navBtn}>
            <Ionicons name="chevron-forward" size={16} color="#FFD700" />
          </TouchableOpacity>
          <Text style={[strip.monthTitle, { color: colors.text }]}>
            {ARABIC_MONTHS[viewMonth]} {viewYear}
          </Text>
          <TouchableOpacity onPress={goPrevMonth} style={strip.navBtn}>
            <Ionicons name="chevron-back" size={16} color="#FFD700" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Day Headers */}
      <View style={strip.dayRow}>
        {DAY_LABELS.map((d) => (
          <Text key={d} style={strip.dayLabel}>{d}</Text>
        ))}
      </View>

      {/* Calendar Grid */}
      {loading ? (
        <ActivityIndicator color="#FFD700" style={{ marginVertical: 12 }} />
      ) : (
        <View style={strip.grid}>
          {cells.map((cell, idx) => {
            if (!cell.day || !cell.iso) {
              return <View key={idx} style={strip.emptyCell} />;
            }
            const bookedTimes = bookedTimesMap.get(cell.iso);
            const bookedCount = bookedTimes?.size ?? 0;
            const isPartial = bookedCount > 0 && bookedCount < TIME_SLOT_COUNT;
            const isFull = bookedCount >= TIME_SLOT_COUNT;
            const hasMyAppt = !!getApptForDate(cell.iso);
            const isToday = cell.iso === todayIso;
            const canPress = bookedCount > 0 || hasMyAppt;
            return (
              <TouchableOpacity
                key={idx}
                onPress={() => handleDayPress(cell.iso!)}
                activeOpacity={canPress ? 0.7 : 1}
                disabled={!canPress}
              >
                <View style={[
                  strip.dayCell,
                  isToday && !isPartial && !isFull && strip.todayCell,
                  isPartial && strip.partialCell,
                  isFull && strip.bookedCell,
                ]}>
                  {isFull && <View style={strip.bookedGlow} />}
                  <Text style={[
                    strip.dayNum,
                    isPartial && { color: '#F59E0B', fontWeight: '700' },
                    isFull && { color: '#EF4444', fontWeight: '800' },
                    !isPartial && !isFull && isToday && { color: '#FFD700', fontWeight: '700' },
                    !isPartial && !isFull && !isToday && { color: colors.textSecondary },
                  ]}>
                    {cell.day}
                  </Text>
                  {isPartial && <Text style={[strip.dayBadge, { color: '#F59E0B' }]}>جزئي</Text>}
                  {isFull && <Text style={[strip.dayBadge, { color: '#EF4444' }]}>مكتمل</Text>}
                  {hasMyAppt && !isFull && <View style={strip.bookedDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Legend */}
      <View style={strip.legend}>
        <View style={[strip.legendDot, { backgroundColor: '#F59E0B' }]} />
        <Text style={[strip.legendText, { color: colors.textSecondary }]}>محجوز جزئياً</Text>
        <View style={[strip.legendDot, { backgroundColor: '#EF4444', marginStart: 10 }]} />
        <Text style={[strip.legendText, { color: colors.textSecondary }]}>مكتمل</Text>
        <View style={[strip.legendDot, { backgroundColor: '#FFD700', marginStart: 10 }]} />
        <Text style={[strip.legendText, { color: colors.textSecondary }]}>موعدي</Text>
      </View>

      {/* Tooltip Modal for booked day */}
      <Modal
        visible={tooltipVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setTooltipVisible(false)}
      >
        <Pressable style={strip.overlay} onPress={() => setTooltipVisible(false)}>
          <View style={[strip.tooltip, { backgroundColor: colors.card, borderColor: '#FFD70040' }]}>
            <LinearGradient colors={['#FFD70020', '#FFA50010']} style={strip.tooltipGrad}>
              <Ionicons name="calendar" size={24} color="#FFD700" />
              <View style={{ flex: 1 }}>
                {selectedAppt ? (
                  <>
                    <Text style={[strip.tooltipTitle, { color: colors.text }]}>
                      {selectedAppt.service_type === 'installation' ? 'تركيب قطع' : 'صيانة وفحص'}
                    </Text>
                    <Text style={[strip.tooltipTime, { color: '#FFD700' }]}>
                      🕐 {new Date(selectedAppt.appointment_date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {selectedAppt.car_info && (
                      <Text style={[strip.tooltipMeta, { color: colors.textSecondary }]}>
                        🚗 {selectedAppt.car_info}
                      </Text>
                    )}
                    <Text style={[strip.tooltipDate, { color: colors.textSecondary }]}>
                      {new Date(selectedAppt.appointment_date).toLocaleDateString('ar-EG', {
                        weekday: 'long', day: 'numeric', month: 'long',
                      })}
                    </Text>
                  </>
                ) : (
                  <Text style={[strip.tooltipTitle, { color: colors.textSecondary }]}>
                    هذا اليوم محجوز بالكامل أو جزئياً
                  </Text>
                )}
              </View>
              {selectedAppt && (
                <TouchableOpacity
                  style={strip.deleteBtn}
                  onPress={() => confirmDelete(selectedAppt)}
                  disabled={deleting}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <Ionicons name="trash-outline" size={20} color="#EF4444" />
                  )}
                </TouchableOpacity>
              )}
            </LinearGradient>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── OrdersTab ───────────────────────────────────────────────────────────────
export const OrdersTab: React.FC<OrdersTabProps> = ({
  orders,
  isRTL,
  canEditOrderStatus,
  updatingOrderId,
  onUpdateStatus,
  onRefresh,
  refreshing = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();
  const [bookingVisible, setBookingVisible] = useState(false);

  const safeOrders = Array.isArray(orders) ? orders : [];

  const formatDate = useCallback((dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  }, [language]);

  const renderOrderItem = useCallback(({ item: order }: { item: any }) => {
    const statusInfo = getStatusInfo(order.status);
    return (
      <View style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.orderHeader, isRTL && styles.rowReverse]}>
          <Pressable onPress={() => router.push(`/admin/order/${order.id}`)}>
            <Text style={[styles.orderNumber, { color: NEON_NIGHT_THEME.primary }]}>
              {order.order_number}
            </Text>
          </Pressable>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.color }]}>
            <Ionicons name={statusInfo.icon as any} size={10} color="#FFF" />
            <Text style={styles.statusText}>
              {language === 'ar' ? statusInfo.labelAr : statusInfo.label}
            </Text>
          </View>
        </View>
        <View style={[styles.orderDetails, isRTL && styles.rowReverse]}>
          <Text style={[styles.orderDate, { color: colors.textSecondary }]}>
            {formatDate(order.created_at)}
          </Text>
          <Text style={[styles.orderTotal, { color: colors.text }]}>
            {(parseFloat(String(order.total || order.total_amount || 0)) || 0).toFixed(0)} ج.م
          </Text>
        </View>
        {canEditOrderStatus && order.status !== 'delivered' && order.status !== 'cancelled' && (
          <View style={styles.orderActions}>
            {order.status === 'pending' && (
              <StatusActionButton orderId={order.id} status="preparing" label="Prepare" labelAr="تحضير" icon="construct-outline" color="#3B82F6" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'preparing')} />
            )}
            {order.status === 'preparing' && (
              <StatusActionButton orderId={order.id} status="shipped" label="Ship" labelAr="شحن" icon="airplane-outline" color="#EAB308" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'shipped')} />
            )}
            {order.status === 'shipped' && (
              <StatusActionButton orderId={order.id} status="out_for_delivery" label="Out" labelAr="في الطريق" icon="car-outline" color="#6B7280" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'out_for_delivery')} />
            )}
            {order.status === 'out_for_delivery' && (
              <StatusActionButton orderId={order.id} status="delivered" label="Deliver" labelAr="تسليم" icon="checkmark-circle" color="#10B981" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'delivered')} />
            )}
            <StatusActionButton orderId={order.id} status="cancelled" label="Cancel" labelAr="إلغاء" icon="close-circle" color="#EF4444" updatingOrderId={updatingOrderId} language={language} onPress={() => onUpdateStatus(order.id, 'cancelled')} />
          </View>
        )}
      </View>
    );
  }, [colors, language, isRTL, canEditOrderStatus, updatingOrderId, formatDate, router, onUpdateStatus]);

  const ListHeaderComponent = useCallback(() => (
    <>
      <BookingStrip onOpenBooking={() => setBookingVisible(true)} />
      <View style={[styles.sectionHeader, isRTL && styles.rowReverse]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {language === 'ar' ? 'سجل الطلبات' : 'Order History'}
        </Text>
        <View style={[styles.countBadge, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
          <Text style={styles.countBadgeText}>{safeOrders.length}</Text>
        </View>
      </View>
    </>
  ), [colors, language, isRTL, safeOrders.length]);

  const ListFooterComponent = useCallback(() => <View style={{ height: 100 }} />, []);

  const ListEmptyComponent = useCallback(() => (
    <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <EmptyState icon="receipt-outline" title={language === 'ar' ? 'لا توجد طلبات' : 'No orders yet'} />
    </View>
  ), [language, colors]);

  return (
    <>
      <MaintenanceBookingModal
        visible={bookingVisible}
        onClose={() => setBookingVisible(false)}
      />
      <FlashList
        data={safeOrders}
        renderItem={renderOrderItem}
        keyExtractor={(item, index) => item.id || `order-item-${index}`}
        estimatedItemSize={100}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={NEON_NIGHT_THEME.primary}
            />
          ) : undefined
        }
      />
    </>
  );
};

const CELL = 36;

const strip = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  calIconLabel: { color: '#FFD700', fontSize: 13, fontWeight: '700' },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFD70015',
  },
  monthTitle: { fontSize: 13, fontWeight: '700' },
  dayRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 4 },
  dayLabel: { width: CELL, textAlign: 'center', fontSize: 10, color: '#888', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyCell: { width: CELL, height: CELL, margin: 1 },
  dayCell: {
    width: CELL, height: CELL, margin: 1,
    borderRadius: CELL / 2,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  todayCell: { borderWidth: 1.5, borderColor: '#FFD70070' },
  bookedCell: { backgroundColor: '#EF444420', borderWidth: 1, borderColor: '#EF444450' },
  partialCell: { backgroundColor: '#F59E0B18', borderWidth: 1, borderColor: '#F59E0B50' },
  bookedGlow: {
    position: 'absolute',
    width: CELL + 8, height: CELL + 8,
    borderRadius: (CELL + 8) / 2,
    backgroundColor: '#EF444425',
  },
  dayNum: { fontSize: 11, color: '#888' },
  dayBadge: { fontSize: 7, fontWeight: '800', textAlign: 'center' },
  bookedDot: {
    position: 'absolute', bottom: 2,
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: '#FFD700',
  },
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10 },
  deleteBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#EF444415',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    flex: 1, backgroundColor: '#00000080',
    alignItems: 'center', justifyContent: 'center',
  },
  tooltip: {
    width: '80%', borderRadius: 16, borderWidth: 1, overflow: 'hidden',
    shadowColor: '#FFD700', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 10,
  },
  tooltipGrad: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: 12, padding: 16,
  },
  tooltipTitle: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  tooltipTime: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  tooltipMeta: { fontSize: 12, marginBottom: 2 },
  tooltipDate: { fontSize: 12 },
});

const styles = StyleSheet.create({
  listContainer: { paddingHorizontal: 16, paddingTop: 8 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12, paddingHorizontal: 4,
  },
  rowReverse: { flexDirection: 'row-reverse' },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  countBadgeText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  emptyContainer: { marginTop: 8, borderRadius: 16, padding: 16, borderWidth: 1 },
  orderCard: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  orderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  orderNumber: { fontSize: 14, fontWeight: '700' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
  orderDetails: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderDate: { fontSize: 12 },
  orderTotal: { fontSize: 14, fontWeight: '700' },
  orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  statusActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  statusActionText: { color: '#FFF', fontSize: 10, fontWeight: '600' },
});

export default OrdersTab;

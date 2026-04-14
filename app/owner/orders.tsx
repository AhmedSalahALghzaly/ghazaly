/**
 * Orders Screen — with Calendar Date-Range Filter + Status Icons
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useAppStore } from '../../src/store/appStore';
import { ordersApi, api } from '../../src/services/api';
import { queryKeys } from '../../src/lib/queryClient';

type FilterType = 'all' | 'today' | 'pending' | 'shipped' | 'delivered' | 'cancelled';
type StatusFilter = 'pending' | 'shipped' | 'delivered' | null;

interface Order {
  id: string;
  order_number?: string;
  status: string;
  created_at: string;
  customer_name?: string;
  customer_email?: string;
  user_name?: string;
  user_email?: string;
  customer_phone?: string;
  phone?: string;
  total?: number;
  items?: any[];
  customer_last_read_status?: string;
  customer_read_at?: string;
}

interface DateRange {
  start: Date;
  end: Date;
}

const STATUS_CONFIG: Record<string, { color: string; icon: string; labelEn: string; labelAr: string }> = {
  pending:          { color: '#F59E0B', icon: 'time',           labelEn: 'Pending',          labelAr: 'قيد الانتظار' },
  processing:       { color: '#3B82F6', icon: 'cog',            labelEn: 'Processing',        labelAr: 'قيد المعالجة' },
  confirmed:        { color: '#3B82F6', icon: 'checkmark',      labelEn: 'Confirmed',         labelAr: 'مؤكد' },
  preparing:        { color: '#6366F1', icon: 'construct',       labelEn: 'Preparing',         labelAr: 'قيد التحضير' },
  shipped:          { color: '#8B5CF6', icon: 'airplane',        labelEn: 'Shipped',           labelAr: 'تم الشحن' },
  out_for_delivery: { color: '#06B6D4', icon: 'bicycle',         labelEn: 'Out for Delivery',  labelAr: 'قيد التوصيل' },
  delivered:        { color: '#10B981', icon: 'checkmark-circle',labelEn: 'Delivered',         labelAr: 'تم التسليم' },
  cancelled:        { color: '#EF4444', icon: 'close-circle',    labelEn: 'Cancelled',         labelAr: 'ملغي' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar helpers
// ─────────────────────────────────────────────────────────────────────────────
const DAYS_AR = ['أح', 'إث', 'ثل', 'أر', 'خم', 'جم', 'سب'];
const DAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function startOfDay(d: Date) {
  const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
}
function endOfDay(d: Date) {
  const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
}
function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
function inRange(d: Date, range: { start: Date; end: Date } | null) {
  if (!range) return false;
  return d >= range.start && d <= range.end;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalendarModal
// ─────────────────────────────────────────────────────────────────────────────
interface CalendarModalProps {
  visible: boolean;
  isRTL: boolean;
  onClose: () => void;
  onConfirm: (range: DateRange | null, status: StatusFilter) => void;
  initialRange: DateRange | null;
  initialStatus: StatusFilter;
}

function CalendarModal({ visible, isRTL, onClose, onConfirm, initialRange, initialStatus }: CalendarModalProps) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [rangeStart, setRangeStart] = useState<Date | null>(initialRange?.start ?? null);
  const [rangeEnd,   setRangeEnd]   = useState<Date | null>(initialRange?.end   ?? null);
  const [pickingEnd, setPickingEnd] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);

  // Reset when reopened
  useEffect(() => {
    if (visible) {
      setRangeStart(initialRange?.start ?? null);
      setRangeEnd(initialRange?.end ?? null);
      setStatusFilter(initialStatus);
      setPickingEnd(false);
    }
  }, [visible]);

  // Build calendar grid
  const daysInGrid = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const grid: (Date | null)[] = Array(firstDay).fill(null);
    for (let d = 1; d <= daysInMonth; d++) grid.push(new Date(viewYear, viewMonth, d));
    while (grid.length % 7 !== 0) grid.push(null);
    return grid;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const handleDayPress = (day: Date) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!rangeStart || pickingEnd === false && rangeEnd !== null) {
      // Start fresh range
      setRangeStart(startOfDay(day));
      setRangeEnd(null);
      setPickingEnd(true);
    } else if (pickingEnd) {
      if (day < rangeStart) {
        setRangeStart(startOfDay(day));
        setRangeEnd(null);
      } else {
        setRangeEnd(endOfDay(day));
        setPickingEnd(false);
      }
    } else {
      setRangeStart(startOfDay(day));
      setRangeEnd(null);
      setPickingEnd(true);
    }
  };

  const setPreset = (preset: 'today' | 'week' | 'month') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = new Date();
    if (preset === 'today') {
      setRangeStart(startOfDay(now));
      setRangeEnd(endOfDay(now));
    } else if (preset === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      setRangeStart(startOfDay(start));
      setRangeEnd(endOfDay(now));
    } else {
      setRangeStart(new Date(now.getFullYear(), now.getMonth(), 1));
      setRangeEnd(endOfDay(now));
    }
    setPickingEnd(false);
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  const clearRange = () => {
    setRangeStart(null);
    setRangeEnd(null);
    setPickingEnd(false);
  };

  const handleConfirm = () => {
    const range = rangeStart ? { start: rangeStart, end: rangeEnd ?? endOfDay(rangeStart) } : null;
    onConfirm(range, statusFilter);
    onClose();
  };

  const toggleStatus = (s: StatusFilter) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStatusFilter(prev => prev === s ? null : s);
  };

  const getDayStyle = (day: Date | null) => {
    if (!day) return null;
    const isStart = rangeStart && sameDay(day, rangeStart);
    const isEnd   = rangeEnd   && sameDay(day, rangeEnd);
    const isMid   = rangeStart && rangeEnd && inRange(day, { start: rangeStart, end: rangeEnd }) && !isStart && !isEnd;
    const isToday = sameDay(day, today);
    return { isStart, isEnd, isMid, isToday };
  };

  const STATUS_ICONS: { key: StatusFilter; icon: string; labelAr: string; color: string }[] = [
    { key: 'pending',   icon: 'time-outline',            labelAr: 'انتظار', color: '#F59E0B' },
    { key: 'shipped',   icon: 'airplane-outline',         labelAr: 'شحن',    color: '#8B5CF6' },
    { key: 'delivered', icon: 'checkmark-circle-outline', labelAr: 'تسليم',  color: '#10B981' },
  ];

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cStyles.backdrop} activeOpacity={1} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      </TouchableOpacity>

      <View style={cStyles.sheet}>
        {/* Title */}
        <View style={cStyles.modalHeader}>
          <Text style={cStyles.modalTitle}>{isRTL ? 'تصفية حسب التاريخ' : 'Filter by Date'}</Text>
          <TouchableOpacity onPress={onClose} style={cStyles.closeBtn}>
            <Ionicons name="close" size={22} color="#6B7280" />
          </TouchableOpacity>
        </View>

        {/* Quick presets */}
        <View style={cStyles.presetRow}>
          {[
            { key: 'today', ar: 'اليوم',     en: 'Today' },
            { key: 'week',  ar: 'هذا الأسبوع', en: 'This Week' },
            { key: 'month', ar: 'هذا الشهر',  en: 'This Month' },
          ].map(p => (
            <TouchableOpacity key={p.key} style={cStyles.presetBtn} onPress={() => setPreset(p.key as any)}>
              <Text style={cStyles.presetText}>{isRTL ? p.ar : p.en}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[cStyles.presetBtn, { backgroundColor: '#FEE2E2' }]} onPress={clearRange}>
            <Text style={[cStyles.presetText, { color: '#EF4444' }]}>{isRTL ? 'مسح' : 'Clear'}</Text>
          </TouchableOpacity>
        </View>

        {/* Month Navigation */}
        <View style={cStyles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={cStyles.navBtn}>
            <Ionicons name="chevron-back" size={20} color="#374151" />
          </TouchableOpacity>
          <Text style={cStyles.monthLabel}>
            {isRTL ? MONTHS_AR[viewMonth] : MONTHS_EN[viewMonth]} {viewYear}
          </Text>
          <TouchableOpacity onPress={nextMonth} style={cStyles.navBtn}>
            <Ionicons name="chevron-forward" size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        {/* Day labels */}
        <View style={cStyles.weekRow}>
          {(isRTL ? DAYS_AR : DAYS_EN).map((d, i) => (
            <Text key={i} style={cStyles.weekDay}>{d}</Text>
          ))}
        </View>

        {/* Days grid */}
        <View style={cStyles.daysGrid}>
          {daysInGrid.map((day, idx) => {
            if (!day) return <View key={`e-${idx}`} style={cStyles.dayCell} />;
            const ds = getDayStyle(day);
            const isSelected = !!(ds?.isStart || ds?.isEnd);
            const isMid = !!ds?.isMid;
            const isToday = !!ds?.isToday;
            return (
              <TouchableOpacity
                key={day.toISOString()}
                style={[
                  cStyles.dayCell,
                  isMid      && cStyles.dayCellMid,
                  isSelected && cStyles.dayCellSelected,
                ]}
                onPress={() => handleDayPress(day)}
                activeOpacity={0.7}
              >
                <View style={[
                  cStyles.dayInner,
                  isSelected && cStyles.dayInnerSelected,
                ]}>
                  <Text style={[
                    cStyles.dayText,
                    isToday    && cStyles.dayTextToday,
                    isSelected && cStyles.dayTextSelected,
                    isMid      && cStyles.dayTextMid,
                  ]}>
                    {day.getDate()}
                  </Text>
                  {isToday && !isSelected && <View style={cStyles.todayDot} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Selected range display */}
        {(rangeStart || rangeEnd) && (
          <Text style={cStyles.rangeLabel}>
            {rangeStart ? rangeStart.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }) : '—'}
            {' → '}
            {rangeEnd ? rangeEnd.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' }) : (isRTL ? 'اختر نهاية' : 'pick end')}
          </Text>
        )}

        {/* Divider */}
        <View style={cStyles.divider} />

        {/* Status filter icons */}
        <Text style={cStyles.sectionLabel}>
          {isRTL ? 'تصفية حسب الحالة (اختياري)' : 'Filter by Status (optional)'}
        </Text>
        <View style={cStyles.statusIconRow}>
          {STATUS_ICONS.map(s => {
            const active = statusFilter === s.key;
            return (
              <TouchableOpacity
                key={s.key!}
                style={[
                  cStyles.statusIconBtn,
                  active && { backgroundColor: s.color + '20', borderColor: s.color },
                ]}
                onPress={() => toggleStatus(s.key)}
                activeOpacity={0.75}
              >
                <View style={[
                  cStyles.statusIconCircle,
                  active && { backgroundColor: s.color },
                ]}>
                  <Ionicons
                    name={s.icon as any}
                    size={24}
                    color={active ? '#FFF' : s.color}
                  />
                </View>
                <Text style={[cStyles.statusIconLabel, active && { color: s.color, fontWeight: '700' }]}>
                  {s.labelAr}
                </Text>
                {active && (
                  <View style={[cStyles.activeIndicator, { backgroundColor: s.color }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Actions */}
        <View style={cStyles.actionRow}>
          <TouchableOpacity style={cStyles.cancelBtn} onPress={onClose}>
            <Text style={cStyles.cancelText}>{isRTL ? 'إلغاء' : 'Cancel'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={cStyles.confirmBtn} onPress={handleConfirm}>
            <LinearGradient colors={['#6366F1', '#8B5CF6']} style={cStyles.confirmGrad}>
              <Ionicons name="checkmark" size={18} color="#FFF" />
              <Text style={cStyles.confirmText}>{isRTL ? 'تأكيد' : 'Confirm'}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Calendar modal styles
const cStyles = StyleSheet.create({
  backdrop:      { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: Platform.OS === 'web' ? 40 : 32,
    paddingTop: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 30, zIndex: 20,
  },
  modalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle:    { fontSize: 18, fontWeight: '700', color: '#111827' },
  closeBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  presetRow:     { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  presetBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#EEF2FF' },
  presetText:    { fontSize: 12, fontWeight: '600', color: '#6366F1' },
  monthNav:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  navBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center' },
  monthLabel:    { fontSize: 16, fontWeight: '700', color: '#1F2937' },
  weekRow:       { flexDirection: 'row', marginBottom: 6 },
  weekDay:       { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: '#9CA3AF' },
  daysGrid:      { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell:       { width: `${100/7}%`, height: 42, alignItems: 'center', justifyContent: 'center' },
  dayCellMid:    { backgroundColor: '#EEF2FF' },
  dayCellSelected: { backgroundColor: '#6366F1' },
  dayInner:      { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dayInnerSelected: { backgroundColor: '#6366F1' },
  dayText:       { fontSize: 14, color: '#374151' },
  dayTextToday:  { fontWeight: '700', color: '#6366F1' },
  dayTextSelected: { color: '#FFF', fontWeight: '700' },
  dayTextMid:    { color: '#6366F1' },
  todayDot:      { width: 4, height: 4, borderRadius: 2, backgroundColor: '#6366F1', marginTop: 2 },
  rangeLabel:    { textAlign: 'center', color: '#6366F1', fontSize: 12, fontWeight: '600', marginTop: 6, marginBottom: 2 },
  divider:       { height: 1, backgroundColor: '#E5E7EB', marginVertical: 14 },
  sectionLabel:  { fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 12 },
  statusIconRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  statusIconBtn: {
    alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent',
    minWidth: 90,
  },
  statusIconCircle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center',
  },
  statusIconLabel:  { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  activeIndicator: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 12 },
  cancelBtn: {
    flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText:  { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  confirmBtn:  { flex: 2, borderRadius: 14, overflow: 'hidden' },
  confirmGrad: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Order List Item
// ─────────────────────────────────────────────────────────────────────────────
const OrderListItem = React.memo(({
  order, isRTL, formatDate, formatCurrency, onPress,
}: {
  order: Order;
  isRTL: boolean;
  formatDate: (d: string) => string;
  formatCurrency: (n: number) => string;
  onPress: (o: Order) => void;
}) => {
  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const readStatusConfig = order.customer_last_read_status
    ? (STATUS_CONFIG[order.customer_last_read_status] || null) : null;

  return (
    <TouchableOpacity style={styles.orderCard} onPress={() => onPress(order)} activeOpacity={0.7}>
      <BlurView intensity={15} tint="light" style={styles.orderBlur}>
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '30' }]}>
          <Ionicons name={statusConfig.icon as any} size={16} color={statusConfig.color} />
          <Text style={[styles.statusText, { color: statusConfig.color }]}>
            {isRTL ? statusConfig.labelAr : statusConfig.labelEn}
          </Text>
        </View>
        <View style={styles.orderInfo}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>#{order.order_number || order.id?.slice(-8) || 'N/A'}</Text>
            <Text style={styles.orderDate}>{formatDate(order.created_at)}</Text>
          </View>
          {/* Customer name + WhatsApp phone */}
          {(() => {
            const name = order.user_name || order.customer_name || order.user_email || order.customer_email || (isRTL ? 'عميل' : 'Customer');
            const phone = order.customer_phone || order.phone;
            const waUrl = phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : null;
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={styles.customerName} numberOfLines={1}>{name}</Text>
                {waUrl && (
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      if (Platform.OS === 'web') { (window as any).open(waUrl, '_blank'); }
                      else { Linking.openURL(waUrl); }
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="logo-whatsapp" size={13} color="#25D366" />
                    <Text style={{ color: '#25D366', fontSize: 11, textDecorationLine: 'underline' }}>
                      {phone}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}
          <View style={styles.orderFooter}>
            <Text style={styles.itemCount}>
              {order.items?.length || 0} {isRTL ? 'منتجات' : 'items'}
            </Text>
            <Text style={styles.orderTotal}>{formatCurrency(order.total || 0)}</Text>
          </View>
          {readStatusConfig && (
            <View style={[styles.readBadgeRow, isRTL && styles.readBadgeRowRTL]}>
              <Ionicons name="checkmark-circle" size={13} color="#10B981" />
              <Text style={styles.readBadgeText}>
                {isRTL ? 'قرأ العميل الإشعار' : 'Customer read notification'}
              </Text>
              <View style={[styles.readStatusPill, { backgroundColor: readStatusConfig.color + '30' }]}>
                <Text style={[styles.readStatusPillText, { color: readStatusConfig.color }]}>
                  {isRTL ? readStatusConfig.labelAr : readStatusConfig.labelEn}
                </Text>
              </View>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.4)" />
      </BlurView>
    </TouchableOpacity>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Active Date Filter Badge
// ─────────────────────────────────────────────────────────────────────────────
function ActiveFilterBadge({
  dateRange, statusFilter, isRTL, onClear,
}: {
  dateRange: DateRange | null;
  statusFilter: StatusFilter;
  isRTL: boolean;
  onClear: () => void;
}) {
  if (!dateRange && !statusFilter) return null;

  const STATUS_ICONS: Record<string, { icon: string; color: string; labelAr: string }> = {
    pending:   { icon: 'time-outline',             color: '#F59E0B', labelAr: 'انتظار' },
    shipped:   { icon: 'airplane-outline',          color: '#8B5CF6', labelAr: 'شحن' },
    delivered: { icon: 'checkmark-circle-outline',  color: '#10B981', labelAr: 'تسليم' },
  };

  const s = statusFilter ? STATUS_ICONS[statusFilter] : null;

  return (
    <View style={styles.activeFilerBadge}>
      <Ionicons name="calendar" size={13} color="#6366F1" />
      {dateRange && (
        <Text style={styles.activeFilterText} numberOfLines={1}>
          {dateRange.start.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}
          {!sameDay(dateRange.start, dateRange.end) && (
            ` → ${dateRange.end.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { day: 'numeric', month: 'short' })}`
          )}
        </Text>
      )}
      {s && (
        <>
          <View style={styles.activeSep} />
          <Ionicons name={s.icon as any} size={13} color={s.color} />
          <Text style={[styles.activeFilterText, { color: s.color }]}>{s.labelAr}</Text>
        </>
      )}
      <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close-circle" size={16} color="rgba(255,255,255,0.6)" />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────
export default function OrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const language = useAppStore((state) => state.language);
  const isRTL = language === 'ar';

  const initialFilter = (params.filter as FilterType) || 'all';
  const [activeFilter, setActiveFilter] = useState<FilterType>(initialFilter);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [dateRange, setDateRange]     = useState<DateRange | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

  const { data: ordersData, isLoading, isRefetching, refetch } = useQuery({
    queryKey: queryKeys.orders.all,
    queryFn: async () => {
      try {
        const response = await ordersApi.getAllAdmin();
        return response.data?.orders || [];
      } catch {
        try {
          const r = await ordersApi.getAll();
          return r.data?.orders || r.data || [];
        } catch { return []; }
      }
    },
    staleTime: 60 * 1000,
  });

  const orders: Order[] = Array.isArray(ordersData) ? ordersData : [];

  useEffect(() => {
    if (params.filter) setActiveFilter(params.filter as FilterType);
  }, [params.filter]);

  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await refetch();
  }, [refetch]);

  const handleFilterChange = useCallback((filter: FilterType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveFilter(filter);
  }, []);

  const handleOrderPress = useCallback((order: Order) => {
    router.push(`/admin/order/${order.id}`);
  }, [router]);

  const handleCalendarConfirm = useCallback((range: DateRange | null, status: StatusFilter) => {
    setDateRange(range);
    setStatusFilter(status);
    // Clear the quick filter when calendar filter applied
    if (range) setActiveFilter('all');
  }, []);

  const clearCalendarFilter = useCallback(() => {
    setDateRange(null);
    setStatusFilter(null);
  }, []);

  const formatDate = useCallback((dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }, [language]);

  const formatCurrency = useCallback((amount: number) => {
    return `${amount.toLocaleString()} ${isRTL ? 'ج.م' : 'EGP'}`;
  }, [isRTL]);

  // Filtered orders (quick filter + calendar range + status)
  const filteredOrders = useMemo(() => {
    let result = [...orders];

    // Quick filter tabs
    if (!dateRange) {
      switch (activeFilter) {
        case 'today':
          const today = new Date().toDateString();
          result = result.filter(o => new Date(o.created_at).toDateString() === today);
          break;
        case 'pending':   result = result.filter(o => o.status === 'pending');   break;
        case 'shipped':   result = result.filter(o => o.status === 'shipped');   break;
        case 'delivered': result = result.filter(o => o.status === 'delivered'); break;
        case 'cancelled': result = result.filter(o => o.status === 'cancelled'); break;
      }
    }

    // Calendar date range filter
    if (dateRange) {
      result = result.filter(o => {
        const d = new Date(o.created_at);
        return d >= dateRange.start && d <= dateRange.end;
      });
    }

    // Status filter from calendar
    if (statusFilter) {
      result = result.filter(o => o.status === statusFilter);
    }

    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [orders, activeFilter, dateRange, statusFilter]);

  const statusCounts = useMemo(() => ({
    all:       orders.length,
    today:     orders.filter(o => new Date(o.created_at).toDateString() === new Date().toDateString()).length,
    pending:   orders.filter(o => o.status === 'pending').length,
    shipped:   orders.filter(o => o.status === 'shipped').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
  }), [orders]);

  const handlePrint = useCallback(() => {
    if (filteredOrders.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === 'web') {
      const fmtMoney = (n: number) => n.toLocaleString('ar-EG', { style: 'currency', currency: 'EGP' });
      const totalAmt = filteredOrders.reduce((s, o) => s + (o.total || 0), 0);
      const totalItems = filteredOrders.reduce((s, o) => s + (o.items?.length || 0), 0);
      const now = new Date().toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // Build date range string for the subtitle
      let dateRangeStr = '';
      if (dateRange) {
        const startStr = dateRange.start.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const endStr = dateRange.end.toLocaleDateString(isRTL ? 'ar-EG' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
        dateRangeStr = isRTL ? `الفترة: ${startStr} — ${endStr}` : `Period: ${startStr} — ${endStr}`;
      } else if (activeFilter === 'today') {
        dateRangeStr = isRTL ? `التاريخ: ${now} (اليوم)` : `Date: ${now} (Today)`;
      } else {
        dateRangeStr = isRTL ? `تاريخ إصدار التقرير: ${now}` : `Report generated: ${now}`;
      }
      if (statusFilter) {
        const sfLabel = (STATUS_CONFIG[statusFilter] || STATUS_CONFIG.pending)[isRTL ? 'labelAr' : 'labelEn'];
        dateRangeStr += isRTL ? ` · الحالة: ${sfLabel}` : ` · Status: ${sfLabel}`;
      }

      const statusColors: Record<string, string> = {
        pending: '#F59E0B', processing: '#3B82F6', shipped: '#8B5CF6',
        delivered: '#10B981', cancelled: '#EF4444',
      };

      const rows = filteredOrders.map((o, idx) => {
        const num = o.order_number ? `#${o.order_number}` : `#${o.id?.slice(-8)}`;
        const date = new Date(o.created_at).toLocaleDateString(isRTL ? 'ar-EG' : 'en-US');
        const cust = o.user_name || o.customer_name || o.user_email || o.customer_email || (isRTL ? 'عميل' : 'Customer');
        const phone = o.customer_phone || o.phone || '—';
        const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.pending;
        const statusLabel = isRTL ? cfg.labelAr : cfg.labelEn;
        const statusColor = statusColors[o.status] || '#6B7280';
        const itemsCount = o.items?.length || 0;
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        return `<tr style="background:${rowBg};">
          <td style="color:#1e293b;font-weight:600;font-size:12px;">${num}</td>
          <td style="color:#475569;">${date}</td>
          <td style="color:#1e293b;font-weight:500;">${cust}</td>
          <td style="color:#0ea5e9;font-size:11px;">${phone}</td>
          <td><span style="background:${statusColor}18;color:${statusColor};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;border:1px solid ${statusColor}30;">${statusLabel}</span></td>
          <td style="text-align:center;color:#64748b;">${itemsCount}</td>
          <td style="font-weight:700;color:#0f172a;text-align:${isRTL ? 'left' : 'right'};">${fmtMoney(o.total || 0)}</td>
        </tr>`;
      }).join('');

      const html = `<!DOCTYPE html>
<html lang="${isRTL ? 'ar' : 'en'}" dir="${isRTL ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${isRTL ? 'تقرير الطلبات — الغزالي' : 'Orders Report — Al-Ghazaly'}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Tajawal',Arial,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh;}
  .wrapper{max-width:1100px;margin:0 auto;padding:32px 20px 60px;}

  /* ── Header card ── */
  .report-header{background:linear-gradient(135deg,#0f2010 0%,#1B4F28 45%,#155a35 100%);border-radius:16px;padding:18px 28px;margin-bottom:20px;color:#fff;display:flex;align-items:center;gap:16px;flex-wrap:wrap;}
  .brand-badge{width:46px;height:46px;flex-shrink:0;background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;}
  .header-main{flex:1;min-width:0;}
  .brand-name{font-size:20px;font-weight:800;letter-spacing:-0.3px;}
  .period-line{font-size:12px;color:rgba(255,255,255,0.7);margin-top:3px;font-weight:400;}
  .report-badge{flex-shrink:0;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:5px 14px;font-size:12px;color:rgba(255,255,255,0.85);font-weight:600;}

  /* ── Stats row ── */
  .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;}
  .stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);}
  .stat-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
  .stat-label{font-size:11px;color:#64748b;font-weight:500;}
  .stat-num{font-size:20px;font-weight:800;color:#0f172a;margin-top:1px;}

  /* ── Table ── */
  .table-card{background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
  .table-title{padding:16px 24px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;}
  .table-title-text{font-size:15px;font-weight:700;color:#1e293b;}
  table{width:100%;border-collapse:collapse;}
  thead tr{background:linear-gradient(90deg,#0f2010,#1B4F28);}
  th{padding:13px 16px;font-size:11px;font-weight:700;color:#fff;text-align:${isRTL ? 'right' : 'left'};letter-spacing:0.4px;text-transform:uppercase;}
  td{padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:middle;}
  tr:last-child td{border-bottom:none;}

  /* ── Total footer ── */
  .total-bar{background:linear-gradient(135deg,#0f2010,#1B4F28);color:#fff;padding:20px 28px;display:flex;justify-content:space-between;align-items:center;margin-top:20px;border-radius:14px;}
  .total-label{font-size:13px;color:rgba(255,255,255,0.7);}
  .total-amount{font-size:26px;font-weight:800;color:#4ade80;}

  /* ── Print footer ── */
  .print-footer{text-align:center;margin-top:32px;color:#94a3b8;font-size:11px;}

  /* ── Print button (no-print) ── */
  .print-btn{position:fixed;bottom:24px;right:24px;background:#1B4F28;color:#fff;border:none;border-radius:12px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(27,79,40,0.5);font-family:inherit;display:flex;align-items:center;gap:8px;transition:transform 0.1s;}
  .print-btn:hover{transform:scale(1.04);}

  @media print{
    body{background:#fff;}
    .wrapper{padding:16px;}
    .print-btn{display:none;}
    .report-header{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    thead tr{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .total-bar{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="report-header">
    <div class="brand-badge">🔧</div>
    <div class="header-main">
      <div class="brand-name">${isRTL ? 'الغزالي لقطع غيار السيارات' : 'Al-Ghazaly Auto Parts'}</div>
      <div class="period-line">${dateRangeStr}</div>
    </div>
    <div class="report-badge">${isRTL ? '📋 تقرير رسمي' : '📋 Official Report'}</div>
  </div>

  <!-- Stats -->
  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-icon" style="background:#f0fdf4;">📦</div>
      <div><div class="stat-label">${isRTL ? 'إجمالي الطلبات' : 'Total Orders'}</div><div class="stat-num">${filteredOrders.length}</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#eff6ff;">🛍️</div>
      <div><div class="stat-label">${isRTL ? 'إجمالي المنتجات' : 'Total Items'}</div><div class="stat-num">${totalItems}</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#fefce8;">✅</div>
      <div><div class="stat-label">${isRTL ? 'مُسلَّم' : 'Delivered'}</div><div class="stat-num">${filteredOrders.filter(o => o.status === 'delivered').length}</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#fff7ed;">⏳</div>
      <div><div class="stat-label">${isRTL ? 'قيد الانتظار' : 'Pending'}</div><div class="stat-num">${filteredOrders.filter(o => o.status === 'pending').length}</div></div>
    </div>
  </div>

  <!-- Table -->
  <div class="table-card">
    <div class="table-title">
      <span style="font-size:16px;">📋</span>
      <span class="table-title-text">${isRTL ? 'قائمة الطلبات التفصيلية' : 'Detailed Orders List'}</span>
    </div>
    <table>
      <thead><tr>
        <th>${isRTL ? 'رقم الطلب' : 'Order #'}</th>
        <th>${isRTL ? 'التاريخ' : 'Date'}</th>
        <th>${isRTL ? 'العميل' : 'Customer'}</th>
        <th>${isRTL ? 'الهاتف' : 'Phone'}</th>
        <th>${isRTL ? 'الحالة' : 'Status'}</th>
        <th style="text-align:center;">${isRTL ? 'المنتجات' : 'Items'}</th>
        <th style="text-align:${isRTL ? 'left' : 'right'};">${isRTL ? 'المجموع' : 'Total'}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <!-- Grand Total -->
  <div class="total-bar">
    <span class="total-label">${isRTL ? 'الإجمالي الكلي للطلبات' : 'Grand Total of All Orders'}</span>
    <span class="total-amount">${fmtMoney(totalAmt)}</span>
  </div>

  <!-- Footer -->
  <div class="print-footer">
    ${isRTL
      ? `تم إنشاء هذا التقرير تلقائياً بواسطة نظام الغزالي لإدارة المتجر · ${now}`
      : `This report was automatically generated by Al-Ghazaly Store Management System · ${now}`}
  </div>
</div>

<!-- Print Button -->
<button class="print-btn no-print" onclick="window.print()">
  🖨️ ${isRTL ? 'طباعة التقرير' : 'Print Report'}
</button>

<script>
  window.onload = function() {
    setTimeout(function() { window.print(); }, 800);
  };
<\/script>
</body></html>`;
      const w = (window as any).open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); }
    } else {
      setShowPrintModal(true);
    }
  }, [filteredOrders, isRTL, dateRange, activeFilter, statusFilter]);

  const filters: { id: FilterType; labelEn: string; labelAr: string; color: string }[] = [
    { id: 'all',       labelEn: 'All',       labelAr: 'الكل',   color: '#6B7280' },
    { id: 'today',     labelEn: 'Today',     labelAr: 'اليوم',  color: '#3B82F6' },
    { id: 'pending',   labelEn: 'Pending',   labelAr: 'انتظار', color: '#F59E0B' },
    { id: 'shipped',   labelEn: 'Shipped',   labelAr: 'شحن',    color: '#8B5CF6' },
    { id: 'delivered', labelEn: 'Delivered', labelAr: 'تسليم',  color: '#10B981' },
    { id: 'cancelled', labelEn: 'Cancelled', labelAr: 'ملغي',   color: '#EF4444' },
  ];

  const hasCalendarFilter = !!(dateRange || statusFilter);

  const ListHeaderComponent = useCallback(() => (
    <>
      {/* Header */}
      <View style={[styles.header, isRTL && styles.headerRTL]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isRTL ? 'الطلبات' : 'Orders'}</Text>

        {/* Counter + Calendar + Excel icons */}
        <View style={styles.headerRight}>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{filteredOrders.length}</Text>
          </View>
          <TouchableOpacity
            style={[styles.calendarBtn, hasCalendarFilter && styles.calendarBtnActive]}
            onPress={() => setCalendarVisible(true)}
          >
            <Ionicons
              name="calendar"
              size={20}
              color={hasCalendarFilter ? '#FFF' : 'rgba(255,255,255,0.8)'}
            />
            {hasCalendarFilter && <View style={styles.calendarActiveDot} />}
          </TouchableOpacity>

          {/* Print Button */}
          <TouchableOpacity
            style={[styles.excelBtn, { backgroundColor: '#2563EB' }, filteredOrders.length === 0 && styles.excelBtnDisabled]}
            onPress={handlePrint}
            disabled={filteredOrders.length === 0}
            activeOpacity={0.8}
          >
            <View style={styles.excelBtnInner}>
              <Ionicons name="print-outline" size={16} color="#FFF" />
              <Text style={styles.excelBtnLabel}>{isRTL ? 'طباعة' : 'Print'}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active calendar filter badge */}
      <ActiveFilterBadge
        dateRange={dateRange}
        statusFilter={statusFilter}
        isRTL={isRTL}
        onClear={clearCalendarFilter}
      />

      {/* Quick Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterContainer}
      >
        {filters.map(filter => (
          <TouchableOpacity
            key={filter.id}
            style={[
              styles.filterPill,
              activeFilter === filter.id && !hasCalendarFilter && { backgroundColor: filter.color },
            ]}
            onPress={() => {
              clearCalendarFilter();
              handleFilterChange(filter.id);
            }}
          >
            <Text style={[
              styles.filterText,
              activeFilter === filter.id && !hasCalendarFilter && styles.filterTextActive,
            ]}>
              {isRTL ? filter.labelAr : filter.labelEn}
            </Text>
            <View style={[
              styles.filterBadge,
              activeFilter === filter.id && !hasCalendarFilter && styles.filterBadgeActive,
            ]}>
              <Text style={[
                styles.filterBadgeText,
                activeFilter === filter.id && !hasCalendarFilter && styles.filterBadgeTextActive,
              ]}>
                {statusCounts[filter.id]}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </>
  ), [isRTL, filteredOrders.length, activeFilter, statusCounts, router, handleFilterChange, dateRange, statusFilter, hasCalendarFilter, handlePrint]);

  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyState}>
      {isLoading ? (
        <ActivityIndicator size="large" color="#FFF" />
      ) : (
        <>
          <Ionicons name="receipt-outline" size={64} color="rgba(255,255,255,0.5)" />
          <Text style={styles.emptyText}>
            {isRTL ? 'لا توجد طلبات' : 'No orders found'}
          </Text>
        </>
      )}
    </View>
  ), [isLoading, isRTL]);

  const ListFooterComponent = useCallback(() => (
    <View style={{ height: insets.bottom + 40 }} />
  ), [insets.bottom]);

  const renderOrderItem = useCallback(({ item }: { item: Order }) => (
    <OrderListItem
      order={item}
      isRTL={isRTL}
      formatDate={formatDate}
      formatCurrency={formatCurrency}
      onPress={handleOrderPress}
    />
  ), [isRTL, formatDate, formatCurrency, handleOrderPress]);

  const keyExtractor = useCallback((item: Order) => item.id, []);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1E1E3F', '#2D2D5F', '#3D3D7F']} style={StyleSheet.absoluteFill} />

      <FlashList
        data={filteredOrders}
        renderItem={renderOrderItem}
        keyExtractor={keyExtractor}
        estimatedItemSize={100}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        ListFooterComponent={ListFooterComponent}
        contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor="#FFF"
            colors={['#FFF']}
          />
        }
        extraData={[activeFilter, isRTL, filteredOrders.length]}
      />

      {/* Calendar Modal */}
      <CalendarModal
        visible={calendarVisible}
        isRTL={isRTL}
        onClose={() => setCalendarVisible(false)}
        onConfirm={handleCalendarConfirm}
        initialRange={dateRange}
        initialStatus={statusFilter}
      />

      {/* Print Modal (native only) */}
      <Modal visible={showPrintModal} transparent animationType="slide" onRequestClose={() => setShowPrintModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={{ backgroundColor: '#1E2140', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <Ionicons name="print-outline" size={28} color="#60A5FA" />
              <Text style={{ color: '#FFF', fontSize: 18, fontWeight: '700', flex: 1 }}>
                {isRTL ? 'تقرير الطلبات' : 'Orders Report'}
              </Text>
              <TouchableOpacity onPress={() => setShowPrintModal(false)}>
                <Ionicons name="close" size={24} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 16, fontSize: 13 }}>
              {isRTL
                ? `إجمالي الطلبات: ${filteredOrders.length} — المجموع: ${filteredOrders.reduce((s,o)=>s+(o.total||0),0).toLocaleString('ar-EG',{style:'currency',currency:'EGP'})}`
                : `Total orders: ${filteredOrders.length} — Sum: ${filteredOrders.reduce((s,o)=>s+(o.total||0),0).toLocaleString('en-US',{style:'currency',currency:'EGP'})}`}
            </Text>
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {filteredOrders.map((o) => {
                const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.pending;
                const num = o.order_number ? `#${o.order_number}` : `#${o.id?.slice(-8)}`;
                const cust = o.user_name || o.customer_name || o.user_email || o.customer_email || (isRTL ? 'عميل' : 'Customer');
                const phone = o.customer_phone || o.phone;
                return (
                  <View key={o.id} style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', gap: 10 }}>
                    <Text style={{ color: '#94A3B8', fontSize: 12, width: 80 }}>{num}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>{cust}</Text>
                      {phone && (
                        <TouchableOpacity onPress={() => Linking.openURL(`https://wa.me/${phone.replace(/\D/g,'')}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
                          <Text style={{ color: '#25D366', fontSize: 11 }}>{phone}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={[{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }, { backgroundColor: cfg.color + '30' }]}>
                      <Text style={{ color: cfg.color, fontSize: 11, fontWeight: '600' }}>{isRTL ? cfg.labelAr : cfg.labelEn}</Text>
                    </View>
                    <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '700', minWidth: 60, textAlign: 'right' }}>
                      {(o.total || 0).toLocaleString('ar-EG', { style: 'currency', currency: 'EGP' })}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setShowPrintModal(false)}
              style={{ marginTop: 20, backgroundColor: '#2563EB', borderRadius: 14, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>{isRTL ? 'إغلاق' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  header:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  headerRTL: { flexDirection: 'row-reverse' },
  backButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, fontSize: 24, fontWeight: '700', color: '#FFF' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12,
    paddingVertical: 4, borderRadius: 16,
  },
  headerBadgeText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  calendarBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  calendarBtnActive: { backgroundColor: '#6366F1' },
  calendarActiveDot: {
    position: 'absolute', top: 6, right: 6,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#FCD34D', borderWidth: 1.5, borderColor: '#6366F1',
  },
  excelBtn: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#1D6F42',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1D6F42', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  excelBtnDisabled: { backgroundColor: 'rgba(29,111,66,0.4)', shadowOpacity: 0.1 },
  excelBtnInner:  { alignItems: 'center', justifyContent: 'center', gap: 2 },
  excelIconGrid:  { flexDirection: 'row', flexWrap: 'wrap', width: 16, height: 12, gap: 1 },
  excelCell:      { width: 7, height: 5, borderRadius: 1 },
  excelBtnLabel:  { color: '#FFF', fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  activeFilerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(99,102,241,0.25)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(99,102,241,0.4)',
    alignSelf: 'flex-start', flexWrap: 'wrap',
  },
  activeFilterText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
  activeSep:  { width: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.3)' },
  filterContainer: { paddingVertical: 12, gap: 8, flexDirection: 'row' },
  filterPill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)', gap: 8,
  },
  filterText:        { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '500' },
  filterTextActive:  { color: '#FFF' },
  filterBadge:       { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  filterBadgeActive: { backgroundColor: 'rgba(255,255,255,0.3)' },
  filterBadgeText:   { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
  filterBadgeTextActive: { color: '#FFF' },
  orderCard:  { marginBottom: 12, borderRadius: 16, overflow: 'hidden' },
  orderBlur:  { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, gap: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  orderInfo:  { flex: 1, gap: 4 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId:    { color: '#FFF', fontSize: 16, fontWeight: '700' },
  orderDate:  { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  customerName: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  itemCount:  { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  orderTotal: { color: '#10B981', fontSize: 16, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 60, gap: 16 },
  emptyText:  { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
  readBadgeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  readBadgeRowRTL: { flexDirection: 'row-reverse' },
  readBadgeText:   { color: '#10B981', fontSize: 11, fontWeight: '500' },
  readStatusPill:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  readStatusPillText: { fontSize: 11, fontWeight: '600' },
});

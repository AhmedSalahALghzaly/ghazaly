import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../../hooks/useTheme';
import { appointmentsApi } from '../../services/api';

interface Props {
  visible: boolean;
  onClose: () => void;
  userEmail?: string;
  userPhone?: string;
  userName?: string;
}

const SERVICE_TYPES = [
  { value: 'maintenance', label: 'صيانة وفحص', icon: 'construct-outline' as const },
  { value: 'installation', label: 'تركيب قطع', icon: 'build-outline' as const },
];

const TIME_SLOTS = [
  '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00',
];

const ARABIC_MONTHS = [
  'يناير','فبراير','مارس','أبريل','مايو','يونيو',
  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر',
];
const ARABIC_DAYS_SHORT = ['أح', 'إث', 'ث', 'أر', 'خ', 'ج', 'س'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function buildCalendarGrid(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells: { day: number | null; date: Date | null; past: boolean }[] = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, date: null, past: false });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    cells.push({ day: d, date, past: date < today });
  }
  return cells;
}

function DayCell({
  day,
  date,
  past,
  selected,
  partiallyBooked,
  fullyBooked,
  onPress,
}: {
  day: number | null;
  date: Date | null;
  past: boolean;
  selected: boolean;
  partiallyBooked: boolean;
  fullyBooked: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const disabled = !date || past || fullyBooked;

  const handlePress = () => {
    if (disabled) return;
    scale.value = withSequence(withSpring(0.85), withSpring(1));
    onPress();
  };

  if (!day || !date) {
    return <View style={cal.emptyCell} />;
  }

  const isToday = new Date().toDateString() === date.toDateString();

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7} disabled={disabled}>
      <Animated.View
        style={[
          cal.dayCell,
          past && cal.pastCell,
          partiallyBooked && !fullyBooked && cal.partialCell,
          fullyBooked && cal.bookedCell,
          isToday && !fullyBooked && !partiallyBooked && cal.todayCell,
          selected && cal.selectedCell,
          animStyle,
        ]}
      >
        {selected && <View style={cal.selectedGlow} />}
        {fullyBooked && <View style={cal.bookedDot} />}
        <Text
          style={[
            cal.dayText,
            past && { color: '#555' },
            partiallyBooked && !fullyBooked && { color: '#F59E0B', fontWeight: '700' },
            fullyBooked && { color: '#EF4444', fontWeight: '700' },
            isToday && !selected && !fullyBooked && !partiallyBooked && { color: '#FFD700', fontWeight: '700' },
            selected && { color: '#000', fontWeight: '800' },
          ]}
        >
          {day}
        </Text>
        {fullyBooked && !past && (
          <Text style={cal.bookedLabel}>مكتمل</Text>
        )}
        {partiallyBooked && !fullyBooked && !past && (
          <Text style={[cal.bookedLabel, { color: '#F59E0B' }]}>جزئي</Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

function MonthCalendar({
  year,
  month,
  selectedDate,
  bookedTimesMap,
  onSelectDate,
}: {
  year: number;
  month: number;
  selectedDate: string;
  bookedTimesMap: Map<string, Set<string>>;
  onSelectDate: (iso: string) => void;
}) {
  const cells = buildCalendarGrid(year, month);
  const totalSlots = TIME_SLOTS.length;

  return (
    <View>
      <View style={cal.weekRow}>
        {ARABIC_DAYS_SHORT.map((d) => (
          <Text key={d} style={cal.weekDay}>{d}</Text>
        ))}
      </View>
      <View style={cal.grid}>
        {cells.map((cell, idx) => {
          const iso = cell.date ? cell.date.toISOString().split('T')[0] : '';
          const bookedTimes = iso ? (bookedTimesMap.get(iso) ?? new Set<string>()) : new Set<string>();
          const partiallyBooked = bookedTimes.size > 0 && bookedTimes.size < totalSlots;
          const fullyBooked = bookedTimes.size >= totalSlots;
          return (
            <DayCell
              key={idx}
              day={cell.day}
              date={cell.date}
              past={cell.past}
              partiallyBooked={partiallyBooked}
              fullyBooked={fullyBooked}
              selected={iso === selectedDate}
              onPress={() => onSelectDate(iso)}
            />
          );
        })}
      </View>
    </View>
  );
}

function buildGoogleCalendarUrl(
  title: string,
  dateStr: string,
  timeStr: string,
  description: string,
): string {
  const start = new Date(`${dateStr}T${timeStr}:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const reminder = new Date(start);
  reminder.setHours(7, 0, 0, 0);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: description,
    location: 'Al-GhazalyParts — قطع غيار السيارات',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export default function MaintenanceBookingModal({ visible, onClose, userEmail, userPhone, userName }: Props) {
  const { colors } = useTheme();
  const [serviceType, setServiceType] = useState<'maintenance' | 'installation'>('maintenance');
  const [carInfo, setCarInfo] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [lastAppointment, setLastAppointment] = useState<{ date: string; time: string; service: string } | null>(null);
  const [bookedTimesMap, setBookedTimesMap] = useState<Map<string, Set<string>>>(new Map());

  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const fetchBookedDates = useCallback(() => {
    appointmentsApi.getSlots().then((res: any) => {
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
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchBookedDates();
  }, [visible, fetchBookedDates]);

  const goToPrevMonth = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const goToNextMonth = () => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime) {
      Alert.alert('تنبيه', 'يرجى اختيار التاريخ والوقت');
      return;
    }
    setSubmitting(true);
    try {
      const appointmentDate = new Date(`${selectedDate}T${selectedTime}:00`).toISOString();
      await appointmentsApi.create({
        service_type: serviceType,
        car_info: carInfo || undefined,
        notes: notes || undefined,
        appointment_date: appointmentDate,
        duration_minutes: 60,
        user_name: userName,
        user_phone: userPhone,
      });
      setLastAppointment({ date: selectedDate, time: selectedTime, service: serviceType });
      setSuccess(true);
      fetchBookedDates();
    } catch (err: any) {
      Alert.alert('خطأ', err?.response?.data?.detail || 'فشل في حجز الموعد');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddToGoogleCalendar = () => {
    if (!lastAppointment) return;
    const serviceLabel = lastAppointment.service === 'maintenance' ? 'صيانة وفحص' : 'تركيب قطع';
    const title = `حجز ${serviceLabel} - Al-GhazalyParts`;
    const description = `حجز موعد ${serviceLabel}\n${carInfo ? `السيارة: ${carInfo}` : ''}\n${notes ? `ملاحظات: ${notes}` : ''}`;
    const url = buildGoogleCalendarUrl(title, lastAppointment.date, lastAppointment.time, description);
    Linking.openURL(url).catch(() => Alert.alert('خطأ', 'تعذّر فتح Google Calendar'));
  };

  const handleClose = () => {
    setSuccess(false);
    setCarInfo('');
    setNotes('');
    setSelectedDate('');
    setSelectedTime('');
    setServiceType('maintenance');
    setLastAppointment(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <LinearGradient colors={['#1A1A2E', '#16213E']} style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <View style={styles.headerIcon}>
              <Ionicons name="calendar-outline" size={22} color="#FFD700" />
            </View>
            <Text style={styles.headerTitle}>حجز موعد صيانة وتركيب</Text>
            <Text style={styles.headerSub}>Al-GhazalyParts — خدمة الزبائن</Text>
          </View>
        </LinearGradient>

        {success ? (
          <View style={styles.successContainer}>
            <LinearGradient colors={['#10B981', '#059669']} style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={48} color="#fff" />
            </LinearGradient>
            <Text style={[styles.successTitle, { color: colors.text }]}>تم الحجز بنجاح!</Text>
            <Text style={[styles.successSub, { color: colors.textSecondary }]}>
              سيتواصل معك فريقنا لتأكيد الموعد
            </Text>
            {/* Google Calendar Button */}
            <TouchableOpacity style={styles.gcalBtn} onPress={handleAddToGoogleCalendar} activeOpacity={0.8}>
              <LinearGradient colors={['#4285F4', '#34A853']} style={styles.gcalGrad}>
                <Ionicons name="logo-google" size={20} color="#fff" />
                <Text style={styles.gcalText}>أضف للتقويم Google</Text>
              </LinearGradient>
            </TouchableOpacity>
            <Text style={[styles.gcalNote, { color: colors.textSecondary }]}>
              سيُضاف تذكير في الساعة 7:00 صباحاً يوم الموعد
            </Text>
            <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
              <Text style={styles.doneBtnText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* Service Type */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>نوع الخدمة</Text>
            <View style={styles.serviceRow}>
              {SERVICE_TYPES.map((s) => {
                const active = serviceType === s.value;
                return (
                  <TouchableOpacity
                    key={s.value}
                    style={[
                      styles.serviceCard,
                      { backgroundColor: active ? '#FFD70018' : colors.card, borderColor: active ? '#FFD700' : colors.border },
                    ]}
                    onPress={() => setServiceType(s.value as typeof serviceType)}
                  >
                    <Ionicons name={s.icon} size={24} color={active ? '#FFD700' : colors.textSecondary} />
                    <Text style={[styles.serviceLabel, { color: active ? '#FFD700' : colors.text }]}>{s.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Car Info */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>معلومات السيارة</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={carInfo}
              onChangeText={setCarInfo}
              placeholder="الماركة والموديل والسنة (مثال: تويوتا كامري 2022)"
              placeholderTextColor={colors.textSecondary}
              textAlign="right"
            />

            {/* Full Month Calendar */}
            <View style={[styles.calCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {/* Month Header */}
              <View style={styles.monthNav}>
                <TouchableOpacity onPress={goToNextMonth} style={styles.navBtn}>
                  <Ionicons name="chevron-forward" size={20} color="#FFD700" />
                </TouchableOpacity>
                <Text style={[styles.monthTitle, { color: colors.text }]}>
                  {ARABIC_MONTHS[calMonth]} {calYear}
                </Text>
                <TouchableOpacity onPress={goToPrevMonth} style={styles.navBtn}>
                  <Ionicons name="chevron-back" size={20} color="#FFD700" />
                </TouchableOpacity>
              </View>
              <MonthCalendar
                year={calYear}
                month={calMonth}
                selectedDate={selectedDate}
                bookedTimesMap={bookedTimesMap}
                onSelectDate={(iso) => { setSelectedDate(iso); setSelectedTime(''); }}
              />
              {selectedDate ? (
                <Text style={styles.selectedDateLabel}>
                  📅 {new Date(selectedDate + 'T12:00:00').toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </Text>
              ) : null}
            </View>

            {/* Time Slots */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>اختر الوقت</Text>
            <View style={styles.timeGrid}>
              {TIME_SLOTS.map((t) => {
                const active = selectedTime === t;
                const bookedTimesForDay = selectedDate ? (bookedTimesMap.get(selectedDate) ?? new Set<string>()) : new Set<string>();
                const isBooked = bookedTimesForDay.has(t);
                return (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.timeSlot,
                      isBooked && { backgroundColor: '#EF444420', borderColor: '#EF4444' },
                      active && { backgroundColor: '#FFD700', borderColor: '#FFD700' },
                      !isBooked && !active && { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                    onPress={() => { if (!isBooked) setSelectedTime(t); }}
                    disabled={isBooked}
                    activeOpacity={isBooked ? 1 : 0.7}
                  >
                    {isBooked && (
                      <Ionicons name="close-circle" size={12} color="#EF4444" style={{ marginBottom: 1 }} />
                    )}
                    <Text style={[
                      styles.timeLabel,
                      { color: active ? '#000' : isBooked ? '#EF4444' : colors.text },
                      isBooked && { textDecorationLine: 'line-through', fontSize: 11 },
                    ]}>{t}</Text>
                    {isBooked && <Text style={{ fontSize: 8, color: '#EF4444' }}>محجوز</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Notes */}
            <Text style={[styles.sectionLabel, { color: colors.text }]}>ملاحظات إضافية</Text>
            <TextInput
              style={[styles.input, styles.notesInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="أي تفاصيل إضافية تود إضافتها..."
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlign="right"
            />

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, { opacity: submitting ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <LinearGradient colors={['#FFD700', '#FFA500']} style={styles.submitGrad}>
                {submitting ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <>
                    <Ionicons name="calendar-outline" size={20} color="#000" />
                    <Text style={styles.submitText}>تأكيد الحجز</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const CELL_SIZE = 40;

const cal = StyleSheet.create({
  weekRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 },
  weekDay: { width: CELL_SIZE, textAlign: 'center', fontSize: 11, color: '#888', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  emptyCell: { width: CELL_SIZE, height: CELL_SIZE, margin: 1 },
  dayCell: {
    width: CELL_SIZE, height: CELL_SIZE, margin: 1,
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  pastCell: { opacity: 0.3 },
  bookedCell: {
    backgroundColor: '#EF444418',
    borderWidth: 1,
    borderColor: '#EF444440',
  },
  partialCell: {
    backgroundColor: '#F59E0B10',
    borderWidth: 1,
    borderColor: '#F59E0B40',
  },
  todayCell: { borderWidth: 1.5, borderColor: '#FFD70070' },
  selectedCell: { backgroundColor: '#FFD700' },
  selectedGlow: {
    position: 'absolute', width: CELL_SIZE + 8, height: CELL_SIZE + 8,
    borderRadius: 24, backgroundColor: '#FFD70030',
  },
  bookedDot: {
    position: 'absolute',
    top: 3,
    right: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  bookedLabel: {
    fontSize: 7,
    color: '#EF4444',
    fontWeight: '700',
    marginTop: -3,
  },
  dayText: { fontSize: 14, color: '#ccc', fontWeight: '500' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: Platform.OS === 'ios' ? 16 : 20,
    paddingBottom: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 16 : 20,
    left: 16,
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  headerContent: { alignItems: 'center', gap: 6 },
  headerIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#FFD70020',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFD70050',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: '#ffffff80', fontSize: 12 },
  body: { padding: 20, gap: 6 },
  sectionLabel: { fontSize: 14, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  serviceRow: { flexDirection: 'row', gap: 12 },
  serviceCard: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 14, borderWidth: 1.5,
  },
  serviceLabel: { fontSize: 14, fontWeight: '700' },
  input: {
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 14,
  },
  notesInput: { height: 80, textAlignVertical: 'top', paddingTop: 11 },
  calCard: {
    borderRadius: 16, borderWidth: 1,
    padding: 12, marginVertical: 8,
  },
  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, paddingHorizontal: 4,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFD70015',
  },
  monthTitle: { fontSize: 16, fontWeight: '800' },
  selectedDateLabel: {
    textAlign: 'center', color: '#FFD700', fontSize: 13,
    fontWeight: '600', marginTop: 10, paddingBottom: 4,
  },
  timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeSlot: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1,
  },
  timeLabel: { fontSize: 14, fontWeight: '600' },
  submitBtn: { marginTop: 20, borderRadius: 16, overflow: 'hidden' },
  submitGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 16,
  },
  submitText: { color: '#000', fontSize: 16, fontWeight: '800' },
  successContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 },
  successIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 24, fontWeight: '800' },
  successSub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  gcalBtn: { borderRadius: 14, overflow: 'hidden', width: '100%', marginTop: 4 },
  gcalGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 14,
  },
  gcalText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  gcalNote: { fontSize: 12, textAlign: 'center' },
  doneBtn: {
    marginTop: 8, backgroundColor: '#FFD700',
    paddingHorizontal: 40, paddingVertical: 14, borderRadius: 14,
  },
  doneBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
});

/**
 * Admin Order Detail Page - Complete Professional Redesign 2026
 * - Fixed status update (same approach as useOrderOperations)
 * - Fixed price fields (unit_price, not final_unit_price)
 * - Modern invoice-style UI with bundle offer support
 * - Print + Word export functionality
 * - Product/Bundle navigation on tap
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, Alert, Modal,
  Platform, Pressable, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useTranslation } from '../../../src/hooks/useTranslation';
import { Header } from '../../../src/components/Header';
import api from '../../../src/services/api';
import { useIsOwner, useCanAccessAdminPanel } from '../../../src/store/appStore';
import { useConfirmModal } from '../../../src/components/ConfirmModal';

const SHIPPING_COST = 150;

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; icon: string; bg: string }> = {
  pending:          { label: 'Pending',         labelAr: 'قيد الانتظار',  color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  icon: 'time-outline' },
  confirmed:        { label: 'Confirmed',        labelAr: 'مؤكد',          color: '#6366F1', bg: 'rgba(99,102,241,0.12)',  icon: 'checkmark-done-outline' },
  preparing:        { label: 'Preparing',        labelAr: 'جارٍ التحضير',  color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  icon: 'construct-outline' },
  shipped:          { label: 'Shipped',          labelAr: 'تم الشحن',      color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)',  icon: 'cube-outline' },
  out_for_delivery: { label: 'Out for Delivery', labelAr: 'في الطريق',     color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)',  icon: 'bicycle-outline' },
  delivered:        { label: 'Delivered',        labelAr: 'تم التوصيل',    color: '#10B981', bg: 'rgba(16,185,129,0.12)',  icon: 'checkmark-circle' },
  cancelled:        { label: 'Cancelled',        labelAr: 'ملغي',          color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   icon: 'close-circle-outline' },
};

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered'];

// ─── Helper to generate print/Word HTML content ───────────────────────────
function buildOrderHTML(order: any, language: string): string {
  const isAr = language === 'ar';
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = items.reduce((s: number, i: any) => s + (parseFloat(String(i.unit_price || 0)) * (i.quantity || 1)), 0);
  const shipping = parseFloat(String(order.shipping_cost || SHIPPING_COST)) || SHIPPING_COST;
  const discount = parseFloat(String(order.discount_amount || order.discount || 0)) || 0;
  const total = parseFloat(String(order.total_amount || order.total || 0)) || (subtotal + shipping - discount);

  const statusLabel = STATUS_CONFIG[order.status]?.[isAr ? 'labelAr' : 'label'] || order.status;
  const statusColor = STATUS_CONFIG[order.status]?.color || '#6B7280';

  const formatDate = (d: string) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const itemRows = items.map((item: any) => {
    const orig = parseFloat(String(item.original_unit_price || item.unit_price || 0)) || 0;
    const bundleDisc = parseFloat(String(item.bundle_discount_percentage || 0)) || 0;
    let final = parseFloat(String(item.unit_price || 0)) || 0;
    if (bundleDisc > 0 && item.bundle_group_id && orig > 0 && Math.abs(final - orig) < 0.01) {
      final = orig * (1 - bundleDisc / 100);
    }
    const hasDisc = orig > 0 && orig > final + 0.01;
    const discPct = hasDisc ? Math.round((1 - final / orig) * 100) : (bundleDisc > 0 ? bundleDisc : 0);
    const itemName = isAr ? (item.name_ar || item.name || '') : (item.name || item.name_ar || '');
    const lineTotal = (final * (item.quantity || 1)).toFixed(2);
    const bundleLabel = item.bundle_group_id
      ? `🎁 ${isAr ? 'عرض مجمع' : 'Bundle Offer'}${discPct > 0 ? ` <span style="background:#10b98122;color:#10b981;padding:1px 6px;border-radius:6px;font-weight:700;">-${discPct}%</span>` : ''}`
      : '';
    return `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;">
        <div style="font-weight:600;color:#1a1a2e;">${itemName}</div>
        ${item.sku ? `<div style="font-size:11px;color:#888;">SKU: ${item.sku}</div>` : ''}
        ${bundleLabel ? `<div style="font-size:11px;color:#10b981;margin-top:2px;">${bundleLabel}</div>` : ''}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;text-align:center;">${item.quantity || 1}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;text-align:center;">
        ${hasDisc ? `<div style="text-decoration:line-through;color:#999;font-size:11px;">${orig.toFixed(2)} ج.م</div>` : ''}
        <div style="color:${hasDisc ? '#10b981' : '#1a1a2e'};font-weight:600;">${final.toFixed(2)} ج.م</div>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#1a1a2e;">${lineTotal} ج.م</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html dir="${isAr ? 'rtl' : 'ltr'}" lang="${isAr ? 'ar' : 'en'}">
<head>
<meta charset="UTF-8">
<title>${isAr ? 'تفاصيل الطلب' : 'Order Details'} - ${order.order_number}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&family=Inter:wght@400;500;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:${isAr ? "'Tajawal'" : "'Inter'"}, sans-serif; background:#f8f9ff; color:#1a1a2e; direction:${isAr ? 'rtl' : 'ltr'}; }
  .invoice { max-width:800px; margin:30px auto; background:#fff; border-radius:16px; box-shadow:0 4px 30px rgba(0,0,0,0.08); overflow:hidden; }
  .invoice-header { background:linear-gradient(135deg,#1a1a2e,#16213e); color:#fff; padding:32px 40px; }
  .company-name { font-size:26px; font-weight:700; letter-spacing:1px; }
  .company-sub { font-size:13px; color:rgba(255,255,255,0.6); margin-top:4px; }
  .order-meta { display:flex; justify-content:space-between; align-items:flex-start; margin-top:24px; flex-wrap:wrap; gap:16px; }
  .order-number { font-size:20px; font-weight:700; }
  .order-date { font-size:13px; color:rgba(255,255,255,0.7); margin-top:4px; }
  .status-pill { padding:6px 16px; border-radius:20px; font-size:13px; font-weight:700; background:${statusColor}22; color:${statusColor}; border:2px solid ${statusColor}44; }
  .body-section { padding:32px 40px; }
  .section-grid { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:28px; }
  .info-card { background:#f8f9ff; border-radius:12px; padding:20px; }
  .info-card h4 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#888; margin-bottom:12px; }
  .info-line { margin-bottom:6px; }
  .info-label { font-size:12px; color:#888; }
  .info-value { font-size:14px; font-weight:600; color:#1a1a2e; }
  table { width:100%; border-collapse:collapse; margin-bottom:24px; }
  thead { background:#f8f9ff; }
  th { padding:12px 8px; text-align:${isAr ? 'right' : 'left'}; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#888; font-weight:600; }
  .summary-box { background:#f8f9ff; border-radius:12px; padding:20px; margin-bottom:24px; }
  .summary-row { display:flex; justify-content:space-between; padding:6px 0; font-size:14px; }
  .summary-row.total { border-top:2px solid #e0e0e0; margin-top:8px; padding-top:14px; font-size:18px; font-weight:700; color:#1a1a2e; }
  .footer { text-align:center; padding:20px; color:#888; font-size:12px; border-top:1px solid #f0f0f0; }
  @media print {
    body { background:#fff; }
    .invoice { box-shadow:none; margin:0; }
  }
</style>
</head>
<body>
<div class="invoice">
  <div class="invoice-header">
    <div class="company-name">الغزالي لقطع غيار السيارات</div>
    <div class="company-sub">Al-Ghazaly Auto Parts</div>
    <div class="order-meta">
      <div>
        <div class="order-number">${order.order_number}</div>
        <div class="order-date">${formatDate(order.created_at)}</div>
      </div>
      <div class="status-pill">${statusLabel}</div>
    </div>
  </div>
  <div class="body-section">
    <div class="section-grid">
      <div class="info-card">
        <h4>${isAr ? 'بيانات العميل' : 'Customer Information'}</h4>
        <div class="info-line"><div class="info-label">${isAr ? 'الاسم' : 'Name'}</div><div class="info-value">${order.user_name || [order.first_name, order.last_name].filter(Boolean).join(' ') || '-'}</div></div>
        <div class="info-line"><div class="info-label">${isAr ? 'الهاتف' : 'Phone'}</div><div class="info-value">${order.phone || '-'}</div></div>
        <div class="info-line"><div class="info-label">${isAr ? 'البريد' : 'Email'}</div><div class="info-value">${order.user_email || order.email || '-'}</div></div>
      </div>
      <div class="info-card">
        <h4>${isAr ? 'عنوان التوصيل' : 'Delivery Address'}</h4>
        <div class="info-value">${[order.street_address, order.city, order.state, order.country].filter(Boolean).join(', ') || '-'}</div>
        ${order.delivery_instructions ? `<div class="info-label" style="margin-top:8px;">${order.delivery_instructions}</div>` : ''}
        <div style="margin-top:10px;"><div class="info-label">${isAr ? 'طريقة الدفع' : 'Payment'}</div><div class="info-value">${order.payment_method === 'cash_on_delivery' ? (isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery') : (order.payment_method || '-')}</div></div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>${isAr ? 'المنتج' : 'Product'}</th>
          <th style="text-align:center;">${isAr ? 'الكمية' : 'Qty'}</th>
          <th style="text-align:center;">${isAr ? 'سعر الوحدة' : 'Unit Price'}</th>
          <th style="text-align:right;">${isAr ? 'الإجمالي' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="summary-box">
      <div class="summary-row"><span>${isAr ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${subtotal.toFixed(2)} ج.م</span></div>
      <div class="summary-row"><span>${isAr ? 'الشحن' : 'Shipping'}</span><span>${shipping.toFixed(2)} ج.م</span></div>
      ${discount > 0 ? `<div class="summary-row" style="color:#10b981;"><span>${isAr ? 'الخصم' : 'Discount'}</span><span>-${discount.toFixed(2)} ج.م</span></div>` : ''}
      <div class="summary-row total"><span>${isAr ? 'الإجمالي النهائي' : 'Grand Total'}</span><span style="color:#1a1a2e;">${total.toFixed(2)} ج.م</span></div>
    </div>
  </div>
  <div class="footer">الغزالي لقطع غيار السيارات · Al-Ghazaly Auto Parts · ${new Date().getFullYear()}</div>
</div>
</body>
</html>`;
}

// ─── Print handler (web) ──────────────────────────────────────────────────
function printOrder(order: any, language: string) {
  if (Platform.OS !== 'web') {
    Alert.alert(language === 'ar' ? 'الطباعة' : 'Print', language === 'ar' ? 'الطباعة متاحة على الويب فقط' : 'Printing is available on web only');
    return;
  }
  const html = buildOrderHTML(order, language);
  const w = (window as any).open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  }
}

// ─── Word download handler (web) ──────────────────────────────────────────
function downloadWordOrder(order: any, language: string) {
  if (Platform.OS !== 'web') {
    Alert.alert(language === 'ar' ? 'تحميل' : 'Download', language === 'ar' ? 'التحميل متاح على الويب فقط' : 'Download is available on web only');
    return;
  }
  const html = buildOrderHTML(order, language);
  // Wrap in Word-compatible XML for .doc format
  const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${order.order_number}</title></head><body>${html}</body></html>`;
  const blob = new Blob([wordDoc], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `order-${order.order_number}.doc`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── StatusUpdateBar ──────────────────────────────────────────────────────
const StatusUpdateBar: React.FC<{
  order: any;
  language: string;
  isRTL: boolean;
  updatingStatus: string | null;
  onUpdate: (status: string) => void;
  onCancel: () => void;
  colors: any;
}> = ({ order, language, isRTL, updatingStatus, onUpdate, onCancel, colors }) => {
  const currentIdx = STATUS_FLOW.indexOf(order.status);

  return (
    <View style={[sbar.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[sbar.titleRow, isRTL && sbar.rowRev]}>
        <View style={[sbar.titleIcon, { backgroundColor: 'rgba(99,102,241,0.1)' }]}>
          <Ionicons name="sync-outline" size={16} color="#6366F1" />
        </View>
        <Text style={[sbar.title, { color: colors.text }]}>
          {language === 'ar' ? 'تحديث حالة الطلب' : 'Update Order Status'}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sbar.buttonsRow}>
        {STATUS_FLOW.filter(s => s !== 'pending').map((status) => {
          const cfg = STATUS_CONFIG[status];
          const isCurrent = order.status === status;
          const isPast = currentIdx > STATUS_FLOW.indexOf(status);
          const isLoading = updatingStatus === status;
          return (
            <TouchableOpacity
              key={status}
              style={[
                sbar.btn,
                {
                  backgroundColor: isCurrent ? cfg.color : isPast ? 'rgba(16,185,129,0.1)' : cfg.bg,
                  borderColor: isCurrent ? cfg.color : isPast ? '#10B981' : `${cfg.color}55`,
                  opacity: isCurrent ? 1 : isPast ? 0.7 : 1,
                },
              ]}
              onPress={() => !isCurrent && !isPast && onUpdate(status)}
              disabled={isCurrent || isPast || updatingStatus !== null}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={isCurrent ? '#FFF' : cfg.color} />
              ) : (
                <>
                  <Ionicons
                    name={(isPast ? 'checkmark-circle' : cfg.icon) as any}
                    size={14}
                    color={isCurrent ? '#FFF' : isPast ? '#10B981' : cfg.color}
                  />
                  <Text style={[sbar.btnText, { color: isCurrent ? '#FFF' : isPast ? '#10B981' : cfg.color }]}>
                    {language === 'ar' ? cfg.labelAr : cfg.label}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!['shipped', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status) && (
        <TouchableOpacity
          style={[sbar.cancelBtn, { borderColor: '#EF4444' }]}
          onPress={onCancel}
          disabled={updatingStatus !== null}
        >
          {updatingStatus === 'cancelled' ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <>
              <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
              <Text style={sbar.cancelText}>{language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order'}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const sbar = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  rowRev: { flexDirection: 'row-reverse' },
  titleIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  buttonsRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, borderWidth: 1.5, minWidth: 90 },
  btnText: { fontSize: 12, fontWeight: '700' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingVertical: 11, gap: 8, marginTop: 12 },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#EF4444' },
});

// ─── CustomerInfoCard ─────────────────────────────────────────────────────
const CustomerInfoCard: React.FC<{ order: any; language: string; isRTL: boolean; colors: any }> = ({ order, language, isRTL, colors }) => {
  const isAr = language === 'ar';
  const name = order.user_name || [order.first_name, order.last_name].filter(Boolean).join(' ') || '-';
  const fields = [
    { icon: 'person-outline', label: isAr ? 'الاسم' : 'Name', value: name },
    { icon: 'call-outline', label: isAr ? 'الهاتف' : 'Phone', value: order.phone || '-' },
    { icon: 'mail-outline', label: isAr ? 'البريد' : 'Email', value: order.user_email || order.email || '-' },
    { icon: 'card-outline', label: isAr ? 'الدفع' : 'Payment', value: order.payment_method === 'cash_on_delivery' ? (isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery') : (order.payment_method || '-') },
  ];
  const hasAddress = !!(order.street_address || order.city);
  const addressParts = [order.street_address, order.city, order.state, order.country].filter(Boolean);

  return (
    <View style={[cust.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[cust.header, isRTL && cust.rev]}>
        <View style={[cust.iconWrap, { backgroundColor: 'rgba(99,102,241,0.1)' }]}>
          <Ionicons name="person" size={18} color="#6366F1" />
        </View>
        <Text style={[cust.sectionTitle, { color: colors.text }]}>
          {isAr ? 'بيانات العميل' : 'Customer Details'}
        </Text>
      </View>
      <View style={cust.grid}>
        {fields.map((f, i) => (
          <View key={i} style={[cust.field, isRTL && cust.rev]}>
            <View style={[cust.fieldIcon, { backgroundColor: colors.surface }]}>
              <Ionicons name={f.icon as any} size={14} color={colors.textSecondary} />
            </View>
            <View style={cust.fieldText}>
              <Text style={[cust.fieldLabel, { color: colors.textSecondary }]}>{f.label}</Text>
              <Text style={[cust.fieldValue, { color: colors.text }]} numberOfLines={1}>{f.value}</Text>
            </View>
          </View>
        ))}
      </View>
      {hasAddress && (
        <View style={[cust.addressBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[cust.row, isRTL && cust.rev]}>
            <Ionicons name="location-outline" size={14} color="#6366F1" />
            <Text style={[cust.addressLabel, { color: colors.textSecondary }]}>
              {isAr ? 'عنوان التوصيل' : 'Delivery Address'}
            </Text>
          </View>
          <Text style={[cust.addressText, { color: colors.text }]}>{addressParts.join(', ')}</Text>
          {order.delivery_instructions ? (
            <Text style={[cust.instructions, { color: colors.textSecondary }]}>
              {isAr ? '📝 ' : '📝 '}{order.delivery_instructions}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

const cust = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  rev: { flexDirection: 'row-reverse' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '47%' },
  fieldIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  fieldText: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 13, fontWeight: '600', marginTop: 1 },
  addressBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 12, gap: 4 },
  addressLabel: { fontSize: 11, fontWeight: '600' },
  addressText: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  instructions: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});

// ─── OrderItemRow ─────────────────────────────────────────────────────────
const OrderItemRow: React.FC<{ item: any; language: string; isRTL: boolean; colors: any; onPressProduct: () => void; onPressBundle: () => void }> = ({
  item, language, isRTL, colors, onPressProduct, onPressBundle,
}) => {
  const isAr = language === 'ar';
  const origPrice = parseFloat(String(item.original_unit_price || item.unit_price || 0)) || 0;
  const bundleDiscPct = parseFloat(String(item.bundle_discount_percentage || 0)) || 0;
  let finalPrice = parseFloat(String(item.unit_price || 0)) || 0;
  if (bundleDiscPct > 0 && item.bundle_group_id && origPrice > 0 && Math.abs(finalPrice - origPrice) < 0.01) {
    finalPrice = origPrice * (1 - bundleDiscPct / 100);
  }
  const hasDiscount = origPrice > 0 && origPrice > finalPrice + 0.01;
  const lineTotal = finalPrice * (item.quantity || 1);
  const discPct = hasDiscount ? Math.round((1 - finalPrice / origPrice) * 100) : (bundleDiscPct > 0 ? bundleDiscPct : 0);
  const productName = isAr ? (item.name_ar || item.name || '') : (item.name || item.name_ar || '');

  return (
    <View style={[irow.container, { borderColor: colors.border }]}>
      {/* Product Image */}
      <TouchableOpacity onPress={onPressProduct} activeOpacity={0.8} style={irow.imgWrap}>
        {item.image_url ? (
          <Image source={{ uri: item.image_url }} style={irow.img} contentFit="cover" cachePolicy="memory-disk" />
        ) : (
          <View style={[irow.imgPlaceholder, { backgroundColor: colors.surface }]}>
            <Ionicons name="cube-outline" size={28} color={colors.textSecondary} />
          </View>
        )}
        {hasDiscount && (
          <View style={irow.discBadge}>
            <Text style={irow.discText}>-{discPct}%</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Info */}
      <View style={irow.info}>
        <TouchableOpacity onPress={onPressProduct} activeOpacity={0.7}>
          <Text style={[irow.name, { color: colors.text }]} numberOfLines={2}>{productName}</Text>
        </TouchableOpacity>
        {item.sku ? (
          <Text style={[irow.sku, { color: colors.textSecondary }]}>SKU: {item.sku}</Text>
        ) : null}
        <Text style={[irow.qty, { color: colors.textSecondary }]}>
          {isAr ? `الكمية: ${item.quantity}` : `Qty: ${item.quantity}`}
        </Text>

        {/* Bundle badge */}
        {item.bundle_group_id && (
          <TouchableOpacity onPress={onPressBundle} style={irow.bundleBtn} activeOpacity={0.7}>
            <Ionicons name="gift-outline" size={11} color="#10B981" />
            <Text style={irow.bundleText}>{isAr ? 'عرض مجمع' : 'Bundle Offer'}</Text>
            <Ionicons name="chevron-forward" size={10} color="#10B981" />
          </TouchableOpacity>
        )}
      </View>

      {/* Pricing */}
      <View style={[irow.pricing, isRTL && { alignItems: 'flex-start' }]}>
        {hasDiscount && (
          <Text style={irow.origPrice}>{origPrice.toFixed(2)} ج.م</Text>
        )}
        <Text style={[irow.finalPrice, { color: hasDiscount ? '#10B981' : colors.textSecondary }]}>
          {finalPrice.toFixed(2)} ج.م
        </Text>
        <View style={irow.separator} />
        <Text style={[irow.lineTotal, { color: colors.text }]}>{lineTotal.toFixed(2)} ج.م</Text>
      </View>
    </View>
  );
};

const irow = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  imgWrap: { position: 'relative' },
  img: { width: 76, height: 76, borderRadius: 12 },
  imgPlaceholder: { width: 76, height: 76, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  discBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: '#EF4444', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8 },
  discText: { color: '#FFF', fontSize: 9, fontWeight: '700' },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  sku: { fontSize: 11 },
  qty: { fontSize: 12 },
  bundleBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, backgroundColor: 'rgba(16,185,129,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start' },
  bundleText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  pricing: { alignItems: 'flex-end', gap: 2 },
  origPrice: { fontSize: 11, color: '#9CA3AF', textDecorationLine: 'line-through' },
  finalPrice: { fontSize: 12, fontWeight: '600' },
  separator: { width: 32, height: 1, backgroundColor: '#E5E7EB', marginVertical: 2 },
  lineTotal: { fontSize: 15, fontWeight: '800' },
});

// ─── ExportModal ──────────────────────────────────────────────────────────
const ExportModal: React.FC<{
  visible: boolean;
  language: string;
  isRTL: boolean;
  colors: any;
  onClose: () => void;
  onPrint: () => void;
  onWord: () => void;
}> = ({ visible, language, isRTL, colors, onClose, onPrint, onWord }) => {
  const isAr = language === 'ar';
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }).start();
    } else {
      scaleAnim.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={exp.overlay} onPress={onClose}>
        <Animated.View
          style={[exp.sheet, { backgroundColor: colors.card, transform: [{ scale: scaleAnim }] }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[exp.title, { color: colors.text }]}>
            {isAr ? 'تصدير الطلب' : 'Export Order'}
          </Text>
          <Text style={[exp.subtitle, { color: colors.textSecondary }]}>
            {isAr ? 'اختر طريقة التصدير' : 'Choose export method'}
          </Text>
          <View style={[exp.btns, isRTL && exp.revRow]}>
            <TouchableOpacity style={[exp.exportBtn, { backgroundColor: 'rgba(99,102,241,0.1)', borderColor: '#6366F1' }]} onPress={onPrint}>
              <View style={[exp.btnIcon, { backgroundColor: '#6366F1' }]}>
                <Ionicons name="print-outline" size={26} color="#FFF" />
              </View>
              <Text style={[exp.btnLabel, { color: '#6366F1' }]}>{isAr ? 'طباعة' : 'Print'}</Text>
              <Text style={[exp.btnSub, { color: colors.textSecondary }]}>{isAr ? 'طباعة الطلب كاملاً' : 'Print full order'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[exp.exportBtn, { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: '#10B981' }]} onPress={onWord}>
              <View style={[exp.btnIcon, { backgroundColor: '#10B981' }]}>
                <Ionicons name="document-text-outline" size={26} color="#FFF" />
              </View>
              <Text style={[exp.btnLabel, { color: '#10B981' }]}>{isAr ? 'Word' : 'Word'}</Text>
              <Text style={[exp.btnSub, { color: colors.textSecondary }]}>{isAr ? 'تحميل كملف Word' : 'Download as .doc'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[exp.closeBtn, { borderColor: colors.border }]} onPress={onClose}>
            <Text style={[exp.closeTxt, { color: colors.textSecondary }]}>{isAr ? 'إلغاء' : 'Cancel'}</Text>
          </TouchableOpacity>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const exp = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 360, borderRadius: 24, padding: 24, alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  subtitle: { fontSize: 13, marginBottom: 20 },
  btns: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  revRow: { flexDirection: 'row-reverse' },
  exportBtn: { flex: 1, alignItems: 'center', borderRadius: 16, borderWidth: 1.5, paddingVertical: 18, paddingHorizontal: 8, gap: 8 },
  btnIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { fontSize: 16, fontWeight: '800' },
  btnSub: { fontSize: 11, textAlign: 'center' },
  closeBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 32 },
  closeTxt: { fontSize: 14, fontWeight: '600' },
});

// ─── Main Component ───────────────────────────────────────────────────────
export default function OrderDetailAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const orderId = Array.isArray(params.id) ? params.id[0] : params.id;
  const isOwner = useIsOwner();
  const isAdmin = useCanAccessAdminPanel();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [discountInput, setDiscountInput] = useState('');
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const fabScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (orderId) fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    setLoading(true);
    try {
      let response;
      if (isAdmin) {
        response = await api.get(`/orders/admin/${orderId}`);
      } else {
        response = await api.get(`/orders/my/${orderId}`);
      }
      setOrder(response.data);
      const discAmt = response.data?.discount_amount || response.data?.discount || 0;
      if (discAmt > 0) { setDiscountInput(String(discAmt)); setDiscountApplied(true); }
    } catch (e: any) {
      if (!isAdmin && e?.response?.status === 404) {
        setOrder(null);
      } else if (isAdmin) {
        try {
          const fallback = await api.get(`/orders/my/${orderId}`);
          setOrder(fallback.data);
        } catch {
          setOrder(null);
        }
      } else {
        setOrder(null);
      }
      console.error('Error fetching order:', e);
    } finally {
      setLoading(false);
    }
  };

  // ── Status update: same URL approach as useOrderOperations ────────────
  const updateOrderStatus = useCallback(async (newStatus: string) => {
    setUpdatingStatus(newStatus);
    try {
      await api.patch(`/orders/${orderId}/status?status=${newStatus}`);
      setOrder((prev: any) => ({ ...prev, status: newStatus }));
    } catch (error: any) {
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error',
        error?.response?.data?.detail || 'Failed to update status'
      );
    } finally {
      setUpdatingStatus(null);
    }
  }, [orderId, language]);

  const handleCancelOrder = useCallback(() => {
    showConfirm({
      title: language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order',
      message: language === 'ar' ? 'هل أنت متأكد من إلغاء هذا الطلب؟' : 'Are you sure you want to cancel this order?',
      confirmText: language === 'ar' ? 'نعم' : 'Yes',
      cancelText: language === 'ar' ? 'لا' : 'No',
      onConfirm: async () => {
        setUpdatingStatus('cancelled');
        try {
          await api.patch(`/orders/${orderId}/status?status=cancelled`);
          setOrder((prev: any) => ({ ...prev, status: 'cancelled' }));
        } catch (e) { console.error(e); }
        finally { setUpdatingStatus(null); }
      },
    });
  }, [orderId, language, showConfirm]);

  const handleCustomerCancelOrder = useCallback(() => {
    showConfirm({
      title: language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order',
      message: language === 'ar' ? 'هل أنت متأكد من إلغاء هذا الطلب؟ لا يمكن التراجع بعد الشحن.' : 'Are you sure you want to cancel? Cannot cancel after shipping.',
      confirmText: language === 'ar' ? 'نعم، إلغاء' : 'Yes, Cancel',
      cancelText: language === 'ar' ? 'لا' : 'No',
      onConfirm: async () => {
        setUpdatingStatus('cancelled');
        try {
          await api.patch(`/orders/my/${orderId}/cancel`);
          setOrder((prev: any) => ({ ...prev, status: 'cancelled' }));
        } catch (e: any) {
          Alert.alert(
            language === 'ar' ? 'خطأ' : 'Error',
            e?.response?.data?.detail || (language === 'ar' ? 'تعذر إلغاء الطلب' : 'Failed to cancel order')
          );
        } finally { setUpdatingStatus(null); }
      },
    });
  }, [orderId, language, showConfirm]);

  const handleDeleteOrder = useCallback(() => {
    showConfirm({
      title: language === 'ar' ? 'حذف الطلب نهائياً' : 'Delete Order Permanently',
      message: language === 'ar' ? 'سيتم حذف هذا الطلب نهائياً. هل أنت متأكد؟' : 'This order will be permanently deleted. Are you sure?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.delete(`/orders/${orderId}`);
          router.back();
        } catch (e) { console.error(e); setDeleting(false); }
      },
    });
  }, [orderId, language, router, showConfirm]);

  const applyDiscount = async () => {
    const amt = parseFloat(discountInput);
    if (isNaN(amt) || amt < 0) {
      Alert.alert(language === 'ar' ? 'خطأ' : 'Error', language === 'ar' ? 'قيمة خصم غير صحيحة' : 'Invalid discount value');
      return;
    }
    setApplyingDiscount(true);
    try {
      const res = await api.patch(`/orders/${orderId}/discount`, { discount: amt });
      setOrder((prev: any) => ({ ...prev, discount: amt, total: res.data.total, total_amount: res.data.total }));
      setDiscountApplied(true);
    } catch (e: any) {
      Alert.alert(language === 'ar' ? 'خطأ' : 'Error', e?.response?.data?.detail || 'Error');
    } finally { setApplyingDiscount(false); }
  };

  const clearDiscount = async () => {
    setApplyingDiscount(true);
    try {
      const res = await api.patch(`/orders/${orderId}/discount`, { discount: 0 });
      setOrder((prev: any) => ({ ...prev, discount: 0, total: res.data.total, total_amount: res.data.total }));
      setDiscountInput(''); setDiscountApplied(false);
    } catch (e) { console.error(e); }
    finally { setApplyingDiscount(false); }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const pressFab = () => {
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.timing(fabScale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    setShowExportModal(true);
  };

  // ── Loading / Error states ────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header title={language === 'ar' ? 'تفاصيل الطلب' : 'Order Details'} showBack showSearch={false} showCart={false} />
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header title={language === 'ar' ? 'تفاصيل الطلب' : 'Order Details'} showBack showSearch={false} showCart={false} />
        <View style={styles.center}>
          <Text style={{ color: colors.error, fontSize: 16 }}>{language === 'ar' ? 'الطلب غير موجود' : 'Order not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Price calculations (using correct field: unit_price) ──────────────
  const itemsArray: any[] = Array.isArray(order.items) ? order.items : [];
  const subtotal = itemsArray.length > 0
    ? itemsArray.reduce((sum: number, item: any) => sum + (parseFloat(String(item.unit_price || 0)) || 0) * (item.quantity || 1), 0)
    : (parseFloat(String(order.total_amount || 0)) || 0) - (parseFloat(String(order.shipping_cost || SHIPPING_COST)) || SHIPPING_COST);
  const shipping = parseFloat(String(order.shipping_cost || SHIPPING_COST)) || SHIPPING_COST;
  const discount = parseFloat(String(order.discount_amount || order.discount || 0)) || 0;
  const total = parseFloat(String(order.total_amount || order.total || 0)) || (subtotal + shipping - discount);

  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const isAr = language === 'ar';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={isAr ? 'تفاصيل الطلب' : 'Order Details'} showBack showSearch={false} showCart={false} />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 100 }]} showsVerticalScrollIndicator={false}>

        {/* ── Order Header Card ─────────────────────────────────────── */}
        <View style={[styles.orderTopCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.orderTopRow, isRTL && styles.rowRev]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.orderNum, { color: colors.primary }]}>{order.order_number}</Text>
              <Text style={[styles.orderDate, { color: colors.textSecondary }]}>{formatDate(order.created_at)}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: statusCfg.bg, borderColor: `${statusCfg.color}66` }]}>
              <Ionicons name={statusCfg.icon as any} size={13} color={statusCfg.color} />
              <Text style={[styles.statusPillText, { color: statusCfg.color }]}>
                {isAr ? statusCfg.labelAr : statusCfg.label}
              </Text>
            </View>
            {isOwner && (
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteOrder} disabled={deleting}>
                {deleting ? <ActivityIndicator size="small" color="#EF4444" /> : <Ionicons name="trash-outline" size={18} color="#EF4444" />}
              </TouchableOpacity>
            )}
          </View>
          {/* Progress bar */}
          {order.status !== 'cancelled' && (
            <View style={styles.progressWrap}>
              {STATUS_FLOW.map((s, i) => {
                const done = STATUS_FLOW.indexOf(order.status) >= i;
                return (
                  <React.Fragment key={s}>
                    <View style={[styles.progressDot, { backgroundColor: done ? STATUS_CONFIG[s].color : colors.border }]}>
                      {done && <Ionicons name="checkmark" size={8} color="#FFF" />}
                    </View>
                    {i < STATUS_FLOW.length - 1 && (
                      <View style={[styles.progressLine, { backgroundColor: STATUS_FLOW.indexOf(order.status) > i ? '#10B981' : colors.border }]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Status Update (Admin/Owner) ───────────────────────────── */}
        {isAdmin && order.status !== 'cancelled' && order.status !== 'delivered' && (
          <StatusUpdateBar
            order={order}
            language={language}
            isRTL={isRTL}
            updatingStatus={updatingStatus}
            onUpdate={updateOrderStatus}
            onCancel={handleCancelOrder}
            colors={colors}
          />
        )}

        {/* ── Cancel button for customers/subscribers ───────────────── */}
        {!isAdmin && !['shipped', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status) && (
          <TouchableOpacity
            style={[styles.customerCancelBtn, { borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.06)' }]}
            onPress={handleCustomerCancelOrder}
            disabled={updatingStatus !== null}
          >
            {updatingStatus === 'cancelled' ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#EF4444' }}>
                  {isAr ? 'إلغاء الطلب' : 'Cancel Order'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* ── Customer Info ─────────────────────────────────────────── */}
        <CustomerInfoCard order={order} language={language} isRTL={isRTL} colors={colors} />

        {/* ── Order Items ───────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, isRTL && styles.rowRev]}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(59,130,246,0.1)' }]}>
              <Ionicons name="cube-outline" size={16} color="#3B82F6" />
            </View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {isAr ? `المنتجات (${itemsArray.length})` : `Items (${itemsArray.length})`}
            </Text>
          </View>
          {itemsArray.length === 0 ? (
            <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingVertical: 16 }}>
              {isAr ? 'لا توجد منتجات' : 'No items'}
            </Text>
          ) : (
            itemsArray.map((item: any, idx: number) => (
              <OrderItemRow
                key={idx}
                item={item}
                language={language}
                isRTL={isRTL}
                colors={colors}
                onPressProduct={() => item.product_id && router.push(`/product/${item.product_id}`)}
                onPressBundle={() => {
                  const offerId = item.bundle_offer_id || item.bundle_group_id;
                  if (offerId) router.push(`/offer/${offerId}`);
                }}
              />
            ))
          )}
        </View>

        {/* ── Order Summary ─────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, isRTL && styles.rowRev]}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(245,158,11,0.1)' }]}>
              <Ionicons name="calculator-outline" size={16} color="#F59E0B" />
            </View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {isAr ? 'ملخص الطلب' : 'Order Summary'}
            </Text>
          </View>

          {[
            { label: isAr ? 'المجموع الفرعي' : 'Subtotal', value: `${subtotal.toFixed(2)} ج.م`, color: colors.text },
            { label: isAr ? 'الشحن' : 'Shipping', value: `${shipping.toFixed(2)} ج.م`, color: colors.text },
          ].map((row, i) => (
            <View key={i} style={[styles.sumRow, isRTL && styles.rowRev]}>
              <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>{row.label}</Text>
              <Text style={[styles.sumValue, { color: row.color }]}>{row.value}</Text>
            </View>
          ))}

          {/* Discount section */}
          <View style={[styles.discountSection, { borderColor: colors.border }]}>
            <Text style={[styles.discountLabel, { color: colors.text }]}>
              {isAr ? 'الخصم (ج.م)' : 'Discount (EGP)'}
            </Text>
            {isOwner ? (
              <View style={[styles.discountRow, isRTL && styles.rowRev]}>
                <TextInput
                  style={[styles.discountInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  value={discountInput}
                  onChangeText={setDiscountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                />
                <TouchableOpacity style={[styles.discBtn, { backgroundColor: '#10B981' }]} onPress={applyDiscount} disabled={applyingDiscount}>
                  {applyingDiscount ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="checkmark" size={18} color="#FFF" />}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.discBtn, { backgroundColor: '#EF4444' }]} onPress={clearDiscount} disabled={applyingDiscount}>
                  <Ionicons name="close" size={18} color="#FFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[styles.discountDisplay, { color: discount > 0 ? '#10B981' : colors.textSecondary }]}>
                {discount > 0 ? `-${discount.toFixed(2)} ج.م` : (isAr ? 'لا يوجد خصم' : 'No discount')}
              </Text>
            )}
          </View>

          {discount > 0 && (
            <View style={[styles.sumRow, isRTL && styles.rowRev]}>
              <Text style={[styles.sumLabel, { color: '#10B981' }]}>{isAr ? 'الخصم' : 'Discount'}</Text>
              <Text style={[styles.sumValue, { color: '#10B981' }]}>-{discount.toFixed(2)} ج.م</Text>
            </View>
          )}

          {/* Grand total */}
          <View style={[styles.totalRow, { borderColor: colors.border }, isRTL && styles.rowRev]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>{isAr ? 'الإجمالي النهائي' : 'Grand Total'}</Text>
            <View style={{ alignItems: isRTL ? 'flex-start' : 'flex-end' }}>
              {discount > 0 && (
                <Text style={{ color: '#9CA3AF', fontSize: 12, textDecorationLine: 'line-through' }}>
                  {(subtotal + shipping).toFixed(2)} ج.م
                </Text>
              )}
              <Text style={[styles.totalValue, { color: discount > 0 ? '#10B981' : colors.text }]}>{total.toFixed(2)} ج.م</Text>
            </View>
          </View>
        </View>

      </ScrollView>

      {/* ── Floating Export Button ────────────────────────────────── */}
      <Animated.View style={[styles.fab, { bottom: insets.bottom + 20, transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity style={[styles.fabBtn, { backgroundColor: '#6366F1' }]} onPress={pressFab} activeOpacity={0.85}>
          <Ionicons name="share-outline" size={22} color="#FFF" />
        </TouchableOpacity>
      </Animated.View>

      <ExportModal
        visible={showExportModal}
        language={language}
        isRTL={isRTL}
        colors={colors}
        onClose={() => setShowExportModal(false)}
        onPrint={() => { setShowExportModal(false); setTimeout(() => printOrder(order, language), 300); }}
        onWord={() => { setShowExportModal(false); setTimeout(() => downloadWordOrder(order, language), 300); }}
      />

      {ConfirmModalNode}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  orderTopCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  orderTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowRev: { flexDirection: 'row-reverse' },
  orderNum: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  orderDate: { fontSize: 12, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  deleteBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  progressDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  progressLine: { flex: 1, height: 2 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  cardIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' },

  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sumLabel: { fontSize: 14 },
  sumValue: { fontSize: 14, fontWeight: '600' },

  discountSection: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 12, marginVertical: 8 },
  discountLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discountInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlign: 'center' },
  discountDisplay: { fontSize: 16, fontWeight: '700' },
  discBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1.5, paddingTop: 14, marginTop: 8 },
  totalLabel: { fontSize: 17, fontWeight: '700' },
  totalValue: { fontSize: 22, fontWeight: '800' },

  customerCancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, gap: 8, marginBottom: 14 },
  fab: { position: 'absolute', right: 20, zIndex: 100 },
  fabBtn: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#6366F1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
});

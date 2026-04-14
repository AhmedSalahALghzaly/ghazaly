/**
 * CheckoutTab - Checkout form and order submission tab
 * Handles customer information and delivery details
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../ui/GlassCard';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';
import type { CheckoutForm } from '../../hooks/shopping/useOrderOperations';

const SHIPPING_COST = 150;

interface CheckoutTabProps {
  checkoutForm: CheckoutForm;
  setCheckoutForm: (form: CheckoutForm) => void;
  submittingOrder: boolean;
  cartItemsCount: number;
  getSubtotal: () => number;
  getItemCount: () => number;
  isRTL: boolean;
  onSubmitOrder: () => void;
}

export const CheckoutTab: React.FC<CheckoutTabProps> = ({
  checkoutForm,
  setCheckoutForm,
  submittingOrder,
  cartItemsCount,
  getSubtotal,
  getItemCount,
  isRTL,
  onSubmitOrder,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();

  const updateForm = (field: keyof CheckoutForm, value: string) => {
    setCheckoutForm({ ...checkoutForm, [field]: value });
  };

  return (
    <GlassCard>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {language === 'ar' ? 'إتمام الطلب' : 'Checkout'}
      </Text>

      {/* Customer Information */}
      <View style={styles.formSection}>
        <Text style={[styles.formSectionTitle, { color: NEON_NIGHT_THEME.primary }]}>
          {language === 'ar' ? 'معلومات العميل' : 'Customer Information'}
        </Text>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'الاسم الأول *' : 'First Name *'}
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={checkoutForm.firstName}
              onChangeText={(t) => updateForm('firstName', t)}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'الاسم الأخير' : 'Last Name'}
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={checkoutForm.lastName}
              onChangeText={(t) => updateForm('lastName', t)}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>
            {language === 'ar' ? 'البريد الإلكتروني' : 'Email'}
          </Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            value={checkoutForm.email}
            onChangeText={(t) => updateForm('email', t)}
            keyboardType="email-address"
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={styles.inputGroup}>
          <View style={styles.phoneLabelRow}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'رقم الهاتف *' : 'Phone *'}
            </Text>
            {checkoutForm.phone?.length >= 10 && (
              <TouchableOpacity
                style={styles.whatsappBadge}
                onPress={() => {
                  const phone = checkoutForm.phone.replace(/[^0-9]/g, '');
                  Linking.openURL(`https://wa.me/${phone}`);
                }}
              >
                <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.phoneInputRow}>
            <TextInput
              style={[
                styles.input,
                styles.phoneInput,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={checkoutForm.phone}
              onChangeText={(t) => updateForm('phone', t)}
              keyboardType="phone-pad"
              placeholderTextColor={colors.textSecondary}
              placeholder={language === 'ar' ? '01xxxxxxxxx' : '01xxxxxxxxx'}
            />
            <TouchableOpacity
              style={[styles.whatsappIconBtn, { backgroundColor: '#25D366' + '20', borderColor: '#25D366' + '40' }]}
              onPress={async () => {
                if (checkoutForm.phone?.length >= 10) {
                  const phone = checkoutForm.phone.replace(/[^0-9]/g, '');
                  const whatsappPhone = phone.startsWith('0') ? '2' + phone : phone;
                  const url = `https://wa.me/${whatsappPhone}`;
                  try {
                    const supported = await Linking.canOpenURL(url);
                    if (supported) {
                      await Linking.openURL(url);
                    } else {
                      await Linking.openURL(`https://wa.me/${whatsappPhone}`);
                    }
                  } catch { /* silently fail */ }
                }
              }}
            >
              <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Delivery Address */}
      <View style={styles.formSection}>
        <Text style={[styles.formSectionTitle, { color: NEON_NIGHT_THEME.primary }]}>
          {language === 'ar' ? 'عنوان التوصيل' : 'Delivery Address'}
        </Text>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>
            {language === 'ar' ? 'العنوان *' : 'Street Address *'}
          </Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            value={checkoutForm.streetAddress}
            onChangeText={(t) => updateForm('streetAddress', t)}
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'المدينة *' : 'City *'}
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={checkoutForm.city}
              onChangeText={(t) => updateForm('city', t)}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              {language === 'ar' ? 'المحافظة' : 'State'}
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
              ]}
              value={checkoutForm.state}
              onChangeText={(t) => updateForm('state', t)}
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>
            {language === 'ar' ? 'تعليمات التوصيل' : 'Delivery Instructions'}
          </Text>
          <TextInput
            style={[
              styles.textArea,
              { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
            ]}
            value={checkoutForm.deliveryInstructions}
            onChangeText={(t) => updateForm('deliveryInstructions', t)}
            multiline
            numberOfLines={3}
            placeholderTextColor={colors.textSecondary}
          />
        </View>
      </View>

      {/* Order Summary */}
      <View style={[styles.checkoutSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.formSectionTitle, { color: NEON_NIGHT_THEME.primary }]}>
          {language === 'ar' ? 'ملخص الطلب' : 'Order Summary'}
        </Text>
        <Text style={[styles.summaryDetail, { color: colors.textSecondary }]}>
          {language === 'ar' ? `${getItemCount()} منتج` : `${getItemCount()} items`}
        </Text>
        <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {getSubtotal().toFixed(0)} ج.م
          </Text>
        </View>
        <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الشحن' : 'Shipping'}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {SHIPPING_COST.toFixed(0)} ج.م
          </Text>
        </View>
        <View style={[styles.totalRow, { borderTopColor: colors.border }, isRTL && styles.rowReverse]}>
          <Text style={[styles.totalLabel, { color: colors.text }]}>
            {language === 'ar' ? 'الإجمالي' : 'Total'}
          </Text>
          <Text style={[styles.totalValue, { color: NEON_NIGHT_THEME.primary }]}>
            {(getSubtotal() + SHIPPING_COST).toFixed(0)} ج.م
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitOrderBtn, { backgroundColor: NEON_NIGHT_THEME.primary }]}
        onPress={onSubmitOrder}
        disabled={submittingOrder || cartItemsCount === 0}
      >
        {submittingOrder ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={20} color="#FFF" />
            <Text style={styles.submitOrderBtnText}>
              {language === 'ar' ? 'تأكيد الطلب' : 'Confirm Order'}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 16,
  },
  formSection: {
    marginBottom: 20,
  },
  formSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  inputGroup: {
    marginBottom: 12,
  },
  phoneLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  whatsappBadge: {
    padding: 4,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  phoneInput: {
    flex: 1,
  },
  whatsappIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  checkoutSummary: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  summaryDetail: {
    fontSize: 12,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  submitOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 12,
  },
  submitOrderBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default CheckoutTab;

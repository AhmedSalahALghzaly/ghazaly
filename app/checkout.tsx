import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
} from 'react-native-reanimated';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useAppStore, NEON_NIGHT_THEME } from '../src/store/appStore';
import { ordersApi, cartApi, subscriptionRequestApi } from '../src/services/api';
import { useQuery } from '@tanstack/react-query';
import ConfettiEffect from '../src/components/ui/ConfettiEffect';

const { width: screenWidth } = Dimensions.get('window');

// Step indicator component
const StepIndicator = ({ currentStep, totalSteps, labels, isRTL, colors }: any) => {
  return (
    <View style={[styles.stepIndicatorContainer, isRTL && styles.rowReverse]}>
      {labels.map((label: string, index: number) => {
        const isActive = index <= currentStep;
        const isCurrent = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <View
                style={[
                  styles.stepLine,
                  {
                    backgroundColor: isActive
                      ? NEON_NIGHT_THEME.primary
                      : colors.border,
                  },
                ]}
              />
            )}
            <View style={styles.stepItem}>
              <Animated.View
                entering={FadeIn.delay(index * 100)}
                style={[
                  styles.stepCircle,
                  {
                    backgroundColor: isActive
                      ? NEON_NIGHT_THEME.primary
                      : colors.surface,
                    borderColor: isActive
                      ? NEON_NIGHT_THEME.primary
                      : colors.border,
                  },
                  isCurrent && styles.stepCircleCurrent,
                ]}
              >
                {isCompleted ? (
                  <Ionicons name="checkmark" size={16} color="#FFF" />
                ) : (
                  <Text
                    style={[
                      styles.stepNumber,
                      { color: isActive ? '#FFF' : colors.textSecondary },
                    ]}
                  >
                    {index + 1}
                  </Text>
                )}
              </Animated.View>
              <Text
                style={[
                  styles.stepLabel,
                  {
                    color: isActive ? colors.text : colors.textSecondary,
                    fontWeight: isCurrent ? '700' : '500',
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
};

// Step 1: Review Cart with Enhanced Pricing
const ReviewStep = ({ cartItems, getTotal, getOriginalTotal, getTotalSavings, language, isRTL, colors, onNext }: any) => {
  const totalSavings = getTotalSavings();
  
  return (
    <Animated.View
      entering={SlideInRight.duration(300)}
      exiting={SlideOutLeft.duration(300)}
      style={styles.stepContent}
    >
      <Text style={[styles.stepTitle, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'مراجعة الطلب' : 'Review Your Order'}
      </Text>
      <Text style={[styles.stepSubtitle, { color: colors.textSecondary }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'تأكد من صحة المنتجات والكميات' : 'Confirm your items and quantities'}
      </Text>

      <View style={[styles.cartReviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {cartItems.map((item: any, index: number) => {
          // Use server-side cart pricing
          const originalPrice = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
          const finalPrice = parseFloat(String(item.final_unit_price ?? item.discountedPrice ?? item.product?.price ?? 0)) || 0;
          const hasDiscount = originalPrice > finalPrice && originalPrice > 0;
          const discountDetails = item.discount_details;
          
          return (
            <Animated.View
              key={item.product_id || item.productId || index}
              entering={FadeInDown.delay(index * 50)}
              style={[
                styles.reviewItem,
                isRTL && styles.rowReverse,
                index < cartItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.reviewItemImage}>
                {item.product?.image ? (
                  <Image 
                    source={{ uri: item.product.image }} 
                    style={styles.reviewImg} 
                    contentFit="cover"
                    cachePolicy="disk"
                  />
                ) : (
                  <View style={[styles.reviewImgPlaceholder, { backgroundColor: colors.border }]}>
                    <Ionicons name="cube-outline" size={24} color={colors.textSecondary} />
                  </View>
                )}
              </View>
              <View style={[styles.reviewItemInfo, isRTL && { alignItems: 'flex-end' }]}>
                <Text style={[styles.reviewItemName, { color: colors.text }]} numberOfLines={2}>
                  {language === 'ar' ? item.product?.name_ar || item.product?.name : item.product?.name || 'Product'}
                </Text>
                <View style={styles.reviewItemMeta}>
                  <Text style={[styles.reviewItemQty, { color: colors.textSecondary }]}>
                    {language === 'ar' ? `الكمية: ${item.quantity}` : `Qty: ${item.quantity}`}
                  </Text>
                  {hasDiscount && discountDetails?.discount_type === 'bundle' && (
                    <View style={[styles.reviewDiscountBadge, { backgroundColor: NEON_NIGHT_THEME.accent }]}>
                      <Text style={styles.reviewDiscountBadgeText}>
                        -{discountDetails.discount_value}%
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.reviewItemPrice}>
                {hasDiscount && (
                  <Text style={[styles.reviewOriginalPrice, { color: colors.textSecondary }]}>
                    {(originalPrice * item.quantity).toFixed(0)} ج.م
                  </Text>
                )}
                <Text style={[styles.reviewFinalPrice, { color: NEON_NIGHT_THEME.primary }]}>
                  {(finalPrice * item.quantity).toFixed(0)} ج.م
                </Text>
              </View>
            </Animated.View>
          );
        })}

        {/* Order Summary with Savings */}
        <View style={[styles.reviewSummary, { borderTopColor: colors.border }]}>
          {totalSavings > 0 && (
            <View style={[styles.reviewSummaryRow, isRTL && styles.rowReverse]}>
              <Text style={[styles.reviewSummaryLabel, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'المجموع الأصلي:' : 'Original:'}
              </Text>
              <Text style={[styles.reviewOriginalTotal, { color: colors.textSecondary }]}>
                {getOriginalTotal().toFixed(0)} ج.م
              </Text>
            </View>
          )}
          {totalSavings > 0 && (
            <View style={[styles.reviewSummaryRow, isRTL && styles.rowReverse]}>
              <View style={styles.savingsIconRow}>
                <Ionicons name="sparkles" size={14} color={NEON_NIGHT_THEME.accent} />
                <Text style={[styles.reviewSavingsLabel, { color: NEON_NIGHT_THEME.accent }]}>
                  {language === 'ar' ? 'التوفير:' : 'Savings:'}
                </Text>
              </View>
              <Text style={[styles.reviewSavingsValue, { color: NEON_NIGHT_THEME.accent }]}>
                -{totalSavings.toFixed(0)} ج.م
              </Text>
            </View>
          )}
          <View style={[styles.reviewTotal, isRTL && styles.rowReverse]}>
            <Text style={[styles.reviewTotalLabel, { color: colors.text }]}>
              {language === 'ar' ? 'الإجمالي:' : 'Total:'}
            </Text>
            <Text style={[styles.reviewTotalValue, { color: NEON_NIGHT_THEME.primary }]}>
              {getTotal().toFixed(0)} ج.م
            </Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

// Step 2: Shipping Details
const ShippingStep = ({
  governorate,
  setGovernorate,
  city,
  setCity,
  shippingAddress,
  setShippingAddress,
  phone,
  setPhone,
  notes,
  setNotes,
  language,
  isRTL,
  colors,
  subGovernorate,
  subCity,
  subAddress,
  subPhone,
}: any) => {
  const govModified  = subGovernorate && governorate && governorate !== subGovernorate;
  const cityModified = subCity && city && city !== subCity;
  const addrModified = subAddress && shippingAddress && shippingAddress !== subAddress;
  const phoneModified = subPhone && phone && phone !== subPhone;
  const hasAutoFill = !!(subGovernorate || subCity || subAddress || subPhone);

  return (
  <Animated.View
    entering={SlideInRight.duration(300)}
    exiting={SlideOutLeft.duration(300)}
    style={styles.stepContent}
  >
    <Text style={[styles.stepTitle, { color: colors.text }, isRTL && styles.textRight]}>
      {language === 'ar' ? 'بيانات التوصيل' : 'Shipping Details'}
    </Text>
    <Text style={[styles.stepSubtitle, { color: colors.textSecondary }, isRTL && styles.textRight]}>
      {language === 'ar' ? 'أدخل عنوان التوصيل ورقم الهاتف' : 'Enter your delivery address and phone'}
    </Text>

    {hasAutoFill && (
      <View style={[styles.autoFillBanner, { backgroundColor: NEON_NIGHT_THEME.primary + '15', borderColor: NEON_NIGHT_THEME.primary + '40' }]}>
        <Ionicons name="checkmark-circle" size={14} color={NEON_NIGHT_THEME.primary} />
        <Text style={[styles.autoFillText, { color: NEON_NIGHT_THEME.primary }]}>
          {language === 'ar' ? 'تم التعبئة التلقائية من بيانات الاشتراك' : 'Auto-filled from subscription data'}
        </Text>
      </View>
    )}

    {/* Governorate field */}
    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'المحافظة *' : 'Governorate *'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="business-outline" size={20} color={NEON_NIGHT_THEME.primary}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]} />
        <TextInput
          style={[styles.textInput, { color: colors.text }, isRTL && { textAlign: 'right' }]}
          placeholder={language === 'ar' ? 'مثال: القاهرة' : 'e.g. Cairo'}
          placeholderTextColor={colors.textSecondary}
          value={governorate}
          onChangeText={setGovernorate}
        />
      </View>
      {govModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText} numberOfLines={1}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subGovernorate}
          </Text>
        </View>
      )}
    </View>

    {/* City / Village field */}
    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'المدينة/المنطقة' : 'City / Area'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons name="map-outline" size={20} color={NEON_NIGHT_THEME.primary}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]} />
        <TextInput
          style={[styles.textInput, { color: colors.text }, isRTL && { textAlign: 'right' }]}
          placeholder={language === 'ar' ? 'مثال: مدينة نصر' : 'e.g. Nasr City'}
          placeholderTextColor={colors.textSecondary}
          value={city}
          onChangeText={setCity}
        />
      </View>
      {cityModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText} numberOfLines={1}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subCity}
          </Text>
        </View>
      )}
    </View>

    {/* Detailed address field */}
    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'العنوان بالتفصيل *' : 'Detailed Address *'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons
          name="location-outline"
          size={20}
          color={NEON_NIGHT_THEME.primary}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <TextInput
          style={[
            styles.textAreaInput,
            { color: colors.text },
            isRTL && { textAlign: 'right' },
          ]}
          placeholder={language === 'ar' ? 'الشارع، رقم المبنى، الدور...' : 'Street, building, floor...'}
          placeholderTextColor={colors.textSecondary}
          value={shippingAddress}
          onChangeText={setShippingAddress}
          multiline
          numberOfLines={3}
        />
      </View>
      {addrModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText} numberOfLines={1}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subAddress}
          </Text>
        </View>
      )}
    </View>

    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'رقم الهاتف *' : 'Phone Number *'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons
          name="call-outline"
          size={20}
          color={NEON_NIGHT_THEME.primary}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <TextInput
          style={[
            styles.textInput,
            { color: colors.text },
            isRTL && { textAlign: 'right' },
          ]}
          placeholder={language === 'ar' ? '01xxxxxxxxx' : '01xxxxxxxxx'}
          placeholderTextColor={colors.textSecondary}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <TouchableOpacity
          onPress={() => Linking.openURL('https://wa.me/201011033571?text=%D8%AA%D9%81%D8%B6%D9%84%20%D9%83%D9%8A%D9%81%20%D9%8A%D9%85%D9%83%D9%86%D9%86%D9%8A%20%D9%85%D8%B3%D8%A7%D8%B9%D8%AF%D8%AA%D9%83')}
          activeOpacity={0.7}
          style={{ padding: 6 }}
        >
          <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
        </TouchableOpacity>
      </View>
      {phoneModified && (
        <View style={styles.modifiedStrip}>
          <Ionicons name="information-circle-outline" size={13} color="#F59E0B" />
          <Text style={styles.modifiedStripText}>
            {language === 'ar' ? 'الاشتراك: ' : 'Subscription: '}{subPhone}
          </Text>
        </View>
      )}
    </View>

    <View style={styles.formGroup}>
      <Text style={[styles.inputLabel, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'ملاحظات (اختياري)' : 'Notes (Optional)'}
      </Text>
      <View style={[styles.inputWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Ionicons
          name="document-text-outline"
          size={20}
          color={NEON_NIGHT_THEME.primary}
          style={[styles.inputIcon, isRTL && { marginLeft: 12, marginRight: 0 }]}
        />
        <TextInput
          style={[
            styles.textAreaInput,
            { color: colors.text },
            isRTL && { textAlign: 'right' },
          ]}
          placeholder={language === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
          placeholderTextColor={colors.textSecondary}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />
      </View>
    </View>
  </Animated.View>
  );
};

// Step 3: Confirmation with Enhanced Pricing Display
const ConfirmStep = ({
  cartItems,
  getTotal,
  getOriginalTotal,
  getTotalSavings,
  shippingAddress,
  phone,
  notes,
  language,
  isRTL,
  colors,
}: any) => {
  const totalSavings = getTotalSavings();
  
  return (
    <Animated.View
      entering={SlideInRight.duration(300)}
      exiting={SlideOutLeft.duration(300)}
      style={styles.stepContent}
    >
      <Text style={[styles.stepTitle, { color: colors.text }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'تأكيد الطلب' : 'Confirm Order'}
      </Text>
      <Text style={[styles.stepSubtitle, { color: colors.textSecondary }, isRTL && styles.textRight]}>
        {language === 'ar' ? 'راجع تفاصيل الطلب قبل التأكيد' : 'Review order details before confirming'}
      </Text>

      {/* Order Summary with Savings */}
      <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
          <View style={[styles.confirmIconCircle, { backgroundColor: `${NEON_NIGHT_THEME.primary}20` }]}>
            <Ionicons name="cart" size={20} color={NEON_NIGHT_THEME.primary} />
          </View>
          <View style={styles.confirmSectionContent}>
            <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'ملخص الطلب' : 'Order Summary'}
            </Text>
            <View style={[styles.orderPriceBreakdown, isRTL && { alignItems: 'flex-end' }]}>
              <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }]}>
                {cartItems.length} {language === 'ar' ? 'منتج' : 'items'}
              </Text>
              {totalSavings > 0 && (
                <View style={[styles.confirmSavingsRow, isRTL && styles.rowReverse]}>
                  <Text style={[styles.confirmOriginalPrice, { color: colors.textSecondary }]}>
                    {getOriginalTotal().toFixed(0)} ج.م
                  </Text>
                  <View style={[styles.confirmSavingsBadge, { backgroundColor: NEON_NIGHT_THEME.accent }]}>
                    <Ionicons name="sparkles" size={12} color="#FFF" />
                    <Text style={styles.confirmSavingsText}>
                      -{totalSavings.toFixed(0)}
                    </Text>
                  </View>
                </View>
              )}
              <Text style={[styles.confirmFinalPrice, { color: NEON_NIGHT_THEME.primary }]}>
                {getTotal().toFixed(0)} ج.م
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />

        <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
          <View style={[styles.confirmIconCircle, { backgroundColor: `${NEON_NIGHT_THEME.primary}20` }]}>
            <Ionicons name="location" size={20} color={NEON_NIGHT_THEME.primary} />
          </View>
          <View style={styles.confirmSectionContent}>
            <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'عنوان التوصيل' : 'Shipping Address'}
            </Text>
            <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }, isRTL && styles.textRight]}>
              {shippingAddress}
            </Text>
          </View>
        </View>

        <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />

        <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
          <View style={[styles.confirmIconCircle, { backgroundColor: `${NEON_NIGHT_THEME.primary}20` }]}>
            <Ionicons name="call" size={20} color={NEON_NIGHT_THEME.primary} />
          </View>
          <View style={styles.confirmSectionContent}>
            <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'رقم الهاتف' : 'Phone'}
            </Text>
            <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }, isRTL && styles.textRight]}>
              {phone}
            </Text>
          </View>
        </View>

        {notes ? (
          <>
            <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />
            <View style={[styles.confirmSection, isRTL && styles.rowReverse]}>
              <View style={[styles.confirmIconCircle, { backgroundColor: `${NEON_NIGHT_THEME.primary}20` }]}>
                <Ionicons name="document-text" size={20} color={NEON_NIGHT_THEME.primary} />
              </View>
              <View style={styles.confirmSectionContent}>
                <Text style={[styles.confirmSectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
                  {language === 'ar' ? 'ملاحظات' : 'Notes'}
                </Text>
                <Text style={[styles.confirmSectionValue, { color: colors.textSecondary }, isRTL && styles.textRight]}>
                  {notes}
                </Text>
              </View>
            </View>
          </>
        ) : null}
      </View>

      {/* Payment Method */}
      <View style={[styles.paymentCard, { backgroundColor: `${NEON_NIGHT_THEME.primary}15`, borderColor: NEON_NIGHT_THEME.primary }]}>
        <View style={[styles.paymentRow, isRTL && styles.rowReverse]}>
          <Ionicons name="cash-outline" size={24} color={NEON_NIGHT_THEME.primary} />
          <Text style={[styles.paymentText, { color: colors.text }]}>
            {language === 'ar' ? 'الدفع عند الاستلام' : 'Cash on Delivery'}
          </Text>
          <View style={[styles.paymentBadge, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
            <Text style={styles.paymentBadgeText}>COD</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

export default function CheckoutScreen() {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { cartItems, clearLocalCart, user, clearCart, setCartItems } = useAppStore();

  const [currentStep, setCurrentStep] = useState(0);
  const [governorate, setGovernorate] = useState('');
  const [city, setCity] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [serverCartItems, setServerCartItems] = useState<any[]>([]);
  const autoFilledRef = useRef(false);

  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);

  const { data: subRequests } = useQuery<any[]>({
    queryKey: ['/api/subscription-requests'],
    queryFn: () => subscriptionRequestApi.getAll().then((r: any) => r.data),
    enabled: !!user,
  });

  const approvedSub = useMemo(() =>
    subRequests?.find((r: any) => r.status === 'approved') || null,
    [subRequests]
  );

  const subGovernorate = approvedSub?.governorate || '';
  const subCity        = approvedSub?.village || '';
  const subAddress     = approvedSub?.detailed_address || '';
  const subPhone       = approvedSub?.phone || '';

  useEffect(() => {
    if (approvedSub && !autoFilledRef.current) {
      autoFilledRef.current = true;
      if (subGovernorate) setGovernorate(subGovernorate);
      if (subCity)        setCity(subCity);
      if (subAddress)     setShippingAddress(subAddress);
      if (subPhone)       setPhone(subPhone);
    }
  }, [approvedSub, subGovernorate, subCity, subAddress, subPhone]);

  // Fetch server cart on mount
  useEffect(() => {
    const fetchServerCart = async () => {
      if (!user) {
        setInitialLoading(false);
        return;
      }
      
      try {
        const response = await cartApi.get();
        const items = response.data.items || [];
        setServerCartItems(items);
        setCartItems(items);
      } catch (error) {
        console.error('Error fetching cart:', error);
      } finally {
        setInitialLoading(false);
      }
    };
    
    fetchServerCart();
  }, [user]);

  // Use server cart items for display (fallback to store if not loaded yet)
  const displayCartItems = serverCartItems.length > 0 ? serverCartItems : cartItems;

  const stepLabels = language === 'ar'
    ? ['المراجعة', 'التوصيل', 'التأكيد']
    : ['Review', 'Shipping', 'Confirm'];

  // Calculate total using server-side cart pricing (final_unit_price)
  const getTotal = useCallback(() => {
    return displayCartItems.reduce((sum, item: any) => {
      const price = parseFloat(String(item.final_unit_price ?? item.discountedPrice ?? item.product?.price ?? 0)) || 0;
      return sum + price * item.quantity;
    }, 0);
  }, [displayCartItems]);

  // Calculate original total (before any discounts)
  const getOriginalTotal = useCallback(() => {
    return displayCartItems.reduce((sum, item: any) => {
      const price = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
      return sum + price * item.quantity;
    }, 0);
  }, [displayCartItems]);

  // Calculate total savings from discounts
  const getTotalSavings = useCallback(() => {
    return displayCartItems.reduce((sum, item: any) => {
      const originalPrice = parseFloat(String(item.original_unit_price ?? item.product?.price ?? 0)) || 0;
      const finalPrice = parseFloat(String(item.final_unit_price ?? item.discountedPrice ?? item.product?.price ?? 0)) || 0;
      return sum + (originalPrice - finalPrice) * item.quantity;
    }, 0);
  }, [displayCartItems]);

  const fullShippingAddress = [governorate, city, shippingAddress].filter(Boolean).join(' - ');

  const validateStep = () => {
    if (currentStep === 1) {
      if (!governorate.trim()) {
        Alert.alert('', language === 'ar' ? 'الرجاء إدخال المحافظة' : 'Please enter the governorate');
        return false;
      }
      if (!shippingAddress.trim()) {
        Alert.alert('', language === 'ar' ? 'الرجاء إدخال العنوان' : 'Please enter the address');
        return false;
      }
      if (!phone.trim()) {
        Alert.alert('', language === 'ar' ? 'الرجاء إدخال رقم الهاتف' : 'Please enter phone number');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      router.back();
    }
  };

  const handlePlaceOrder = async () => {
    setLoading(true);
    try {
      const response = await ordersApi.create({
        shipping_address: fullShippingAddress,
        phone: phone,
        notes: notes || undefined,
      });

      // Only clear cart and show success if we got a successful response (200 OK)
      if (response.status === 200 || response.status === 201) {
        setShowConfetti(true);
        setOrderPlaced(true);

        // Clear cart ONLY after successful order creation
        setTimeout(() => {
          clearLocalCart();
          clearCart();
          // Also clear server cart
          cartApi.clear().catch(() => {});
          router.replace('/orders');
        }, 2500);
      } else {
        throw new Error('Order creation failed');
      }
    } catch (error: any) {
      console.error('Error placing order:', error);
      // DO NOT clear cart on failure - preserve user's items
      const errorMessage = error?.response?.data?.detail || (language === 'ar' ? 'فشل إرسال الطلب. يرجى المحاولة مرة أخرى.' : 'Failed to place order. Please try again.');
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error', 
        errorMessage
      );
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    router.replace('/login');
    return null;
  }

  // Show loading while fetching cart
  if (initialLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={NEON_NIGHT_THEME.primary} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'جاري تحميل السلة...' : 'Loading cart...'}
        </Text>
      </View>
    );
  }

  // Show empty cart message
  if (displayCartItems.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 },
          ]}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'إتمام الشراء' : 'Checkout'}
          </Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.emptyCartContainer}>
          <Ionicons name="cart-outline" size={80} color={colors.border} />
          <Text style={[styles.emptyCartTitle, { color: colors.text }]}>
            {language === 'ar' ? 'السلة فارغة' : 'Your cart is empty'}
          </Text>
          <Text style={[styles.emptyCartSubtitle, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'أضف منتجات للمتابعة' : 'Add items to continue'}
          </Text>
          <TouchableOpacity
            style={[styles.shopButton, { backgroundColor: NEON_NIGHT_THEME.primary }]}
            onPress={() => router.push('/')}
          >
            <Text style={styles.shopButtonText}>
              {language === 'ar' ? 'تصفح المنتجات' : 'Browse Products'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (orderPlaced) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {showConfetti && <ConfettiEffect active={showConfetti} />}
        <View style={styles.successContainer}>
          <Animated.View entering={FadeIn.duration(500)} style={[styles.successIcon, { backgroundColor: `${NEON_NIGHT_THEME.primary}20` }]}>
            <Ionicons name="checkmark-circle" size={64} color={NEON_NIGHT_THEME.primary} />
          </Animated.View>
          <Text style={[styles.successTitle, { color: colors.text }]}>
            {language === 'ar' ? 'تم الطلب بنجاح!' : 'Order Placed Successfully!'}
          </Text>
          <Text style={[styles.successSubtitle, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'سيتم توجيهك لصفحة الطلبات...' : 'Redirecting to orders page...'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 },
          ]}
        >
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            {language === 'ar' ? 'إتمام الشراء' : 'Checkout'}
          </Text>
          <View style={styles.placeholder} />
        </View>

        {/* Step Indicator */}
        <View style={[styles.stepIndicatorWrapper, { backgroundColor: colors.surface }]}>
          <StepIndicator
            currentStep={currentStep}
            totalSteps={3}
            labels={stepLabels}
            isRTL={isRTL}
            colors={colors}
          />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {currentStep === 0 && (
            <ReviewStep
              cartItems={displayCartItems}
              getTotal={getTotal}
              getOriginalTotal={getOriginalTotal}
              getTotalSavings={getTotalSavings}
              language={language}
              isRTL={isRTL}
              colors={colors}
            />
          )}
          {currentStep === 1 && (
            <ShippingStep
              governorate={governorate}
              setGovernorate={setGovernorate}
              city={city}
              setCity={setCity}
              shippingAddress={shippingAddress}
              setShippingAddress={setShippingAddress}
              phone={phone}
              setPhone={setPhone}
              notes={notes}
              setNotes={setNotes}
              language={language}
              isRTL={isRTL}
              colors={colors}
              subGovernorate={subGovernorate}
              subCity={subCity}
              subAddress={subAddress}
              subPhone={subPhone}
            />
          )}
          {currentStep === 2 && (
            <ConfirmStep
              cartItems={displayCartItems}
              getTotal={getTotal}
              getOriginalTotal={getOriginalTotal}
              getTotalSavings={getTotalSavings}
              shippingAddress={fullShippingAddress}
              phone={phone}
              notes={notes}
              language={language}
              isRTL={isRTL}
              colors={colors}
            />
          )}
        </ScrollView>

        {/* Footer */}
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 16 },
          ]}
        >
          {currentStep < 2 ? (
            <TouchableOpacity
              style={[styles.nextButton, { backgroundColor: NEON_NIGHT_THEME.primary }]}
              onPress={handleNext}
              activeOpacity={0.85}
            >
              <Text style={styles.nextButtonText}>
                {language === 'ar' ? 'التالي' : 'Next'}
              </Text>
              <Ionicons name={isRTL ? 'arrow-back' : 'arrow-forward'} size={20} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <View>
              {getTotalSavings() > 0 && (
                <View style={[styles.footerSavingsRow, isRTL && styles.rowReverse]}>
                  <Ionicons name="sparkles" size={14} color={NEON_NIGHT_THEME.accent} />
                  <Text style={[styles.footerSavingsText, { color: NEON_NIGHT_THEME.accent }]}>
                    {language === 'ar' ? `توفير ${getTotalSavings().toFixed(0)} ج.م` : `Saving ${getTotalSavings().toFixed(0)} EGP`}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.placeOrderButton, { backgroundColor: NEON_NIGHT_THEME.primary }]}
                onPress={handlePlaceOrder}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color="#FFF" />
                    <Text style={styles.placeOrderText}>
                      {language === 'ar' ? 'تأكيد الطلب' : 'Place Order'}
                    </Text>
                    <Text style={styles.placeOrderPrice}>{getTotal().toFixed(0)} ج.م</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  placeholder: {
    width: 40,
  },
  stepIndicatorWrapper: {
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  stepIndicatorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepItem: {
    alignItems: 'center',
    width: 70,
  },
  stepCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  stepCircleCurrent: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
  },
  stepLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
  stepLine: {
    width: 40,
    height: 2,
    marginHorizontal: 4,
    marginBottom: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepSubtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  cartReviewCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  reviewItem: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  reviewItemImage: {
    width: 60,
    height: 60,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 12,
  },
  reviewImg: {
    width: '100%',
    height: '100%',
  },
  reviewImgPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewItemInfo: {
    flex: 1,
  },
  reviewItemName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
    lineHeight: 18,
  },
  reviewItemQty: {
    fontSize: 12,
  },
  reviewItemPrice: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  reviewOriginalPrice: {
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  reviewFinalPrice: {
    fontSize: 15,
    fontWeight: '700',
  },
  reviewSummary: {
    borderTopWidth: 1,
    paddingTop: 12,
    marginTop: 8,
  },
  reviewSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  reviewSummaryLabel: {
    fontSize: 13,
  },
  reviewOriginalTotal: {
    fontSize: 13,
    textDecorationLine: 'line-through',
  },
  savingsIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  reviewSavingsLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  reviewSavingsValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  reviewItemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  reviewDiscountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  reviewDiscountBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  reviewTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
  },
  reviewTotalLabel: {
    fontSize: 14,
  },
  reviewTotalValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  autoFillBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    marginBottom: 16,
  },
  autoFillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modifiedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F59E0B15',
    borderRadius: 7,
    borderLeftWidth: 2,
    borderLeftColor: '#F59E0B',
  },
  modifiedStripText: {
    fontSize: 11,
    color: '#F59E0B',
    flex: 1,
    fontWeight: '500',
  },
  formGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  textAreaInput: {
    flex: 1,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: 'top',
    paddingVertical: 0,
  },
  confirmCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    marginBottom: 16,
  },
  confirmSection: {
    flexDirection: 'row',
    padding: 14,
    alignItems: 'flex-start',
  },
  confirmIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  confirmSectionContent: {
    flex: 1,
  },
  confirmSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  confirmSectionValue: {
    fontSize: 13,
    lineHeight: 18,
  },
  confirmDivider: {
    height: 1,
    marginHorizontal: 14,
  },
  paymentCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  paymentText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  paymentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  paymentBadgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
  },
  nextButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
  },
  nextButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  placeOrderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 14,
    gap: 10,
  },
  placeOrderText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
  placeOrderPrice: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  textRight: {
    textAlign: 'right',
  },
  orderPriceBreakdown: {
    marginTop: 4,
  },
  confirmSavingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  confirmOriginalPrice: {
    fontSize: 13,
    textDecorationLine: 'line-through',
  },
  confirmSavingsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  confirmSavingsText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  confirmFinalPrice: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 4,
  },
  footerSavingsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  footerSavingsText: {
    fontSize: 14,
    fontWeight: '700',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  emptyCartContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyCartTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
  },
  emptyCartSubtitle: {
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
  },
  shopButton: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  shopButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

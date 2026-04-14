import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  interpolateColor,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import { carModelsApi, cartApi, favoritesApi } from '../../src/services/api';
import { FuelTypeIcon, getFuelTypeConfig } from '../../src/components/ui/FuelTypeSelector';
import { useCartMutations, shoppingHubKeys } from '../../src/hooks/queries/useShoppingHubQuery';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatedCartButton, AnimatedCartButtonRef, AnimatedFavoriteButton } from '../../src/components/AnimatedIconButton';

const GOLD_COLOR = '#FFD700';
const IMAGE_SIZE = Math.min(SCREEN_WIDTH, 500);

// Check if user can view entity profiles
const canViewEntityProfile = (userRole?: string, subscriptionStatus?: string, userObjRole?: string): boolean => {
  const allowedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  return (
    allowedRoles.includes(userRole || '') ||
    allowedRoles.includes(userObjRole || '') ||
    subscriptionStatus === 'subscriber'
  );
};

export default function CarModelDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, addToLocalCart } = useAppStore();
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const userRole = useAppStore((state) => state.userRole);

  // Cart mutations with bidirectional duplicate prevention
  const queryClient = useQueryClient();
  const { checkDuplicate, checkBundleDuplicate } = useCartMutations();

  // Check if user can download catalog (subscriber, owner, partner, or admin)
  const privilegedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  const canDownloadCatalog =
    subscriptionStatus === 'subscriber' ||
    privilegedRoles.includes(userRole || '') ||
    privilegedRoles.includes(user?.role || '');

  // Check if user should see subscribe button (not a subscriber and no pending request)
  const showSubscribeButton =
    subscriptionStatus === 'none' &&
    !privilegedRoles.includes(userRole || '') &&
    !privilegedRoles.includes(user?.role || '');

  // RBAC: Check if user can view entity profiles
  const canViewProfile = canViewEntityProfile(userRole, subscriptionStatus, user?.role);

  // State for tracking added products and loading
  const [addedProducts, setAddedProducts] = useState<Set<string>>(new Set());
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Set<string>>(new Set());
  const [togglingFavorite, setTogglingFavorite] = useState<Set<string>>(new Set());

  // Refs for cart buttons to trigger shake animation
  const cartButtonRefs = useRef<Map<string, AnimatedCartButtonRef>>(new Map());

  // Callback to set ref for each product
  const setCartButtonRef = useCallback((productId: string, ref: AnimatedCartButtonRef | null) => {
    if (ref) {
      cartButtonRefs.current.set(productId, ref);
    } else {
      cartButtonRefs.current.delete(productId);
    }
  }, []);

  // Golden Glow Animation for restricted access
  const glowProgress = useSharedValue(0);
  const [isGlowing, setIsGlowing] = useState(false);

  const triggerGoldenGlow = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setIsGlowing(true);

    const flashDuration = 250;
    glowProgress.value = withSequence(
      withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: flashDuration, easing: Easing.inOut(Easing.ease) }, () => {
        runOnJS(setIsGlowing)(false);
      })
    );
  }, []);

  const glowTextStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(
        glowProgress.value,
        [0, 1],
        ['#FFFFFF', GOLD_COLOR]
      ),
    };
  });

  const [carModel, setCarModel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloadingCatalog, setDownloadingCatalog] = useState(false);

  useEffect(() => {
    fetchCarModel();
  }, [id]);

  const fetchCarModel = async () => {
    try {
      const response = await carModelsApi.getById(id as string);
      setCarModel(response.data);
    } catch (error) {
      console.error('Error fetching car model:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch user favorites when logged in
  useEffect(() => {
    if (!user) return;
    const loadFavorites = async () => {
      try {
        const response = await favoritesApi.getAll();
        const favIds = new Set<string>((response.data || []).map((f: any) => f.product_id || f.id));
        setFavoriteProducts(favIds);
      } catch {
        // silent
      }
    };
    loadFavorites();
  }, [user]);

  // Toggle favorite for a compatible product
  const handleToggleFavorite = useCallback(async (productId: string) => {
    if (!user) {
      router.push('/login');
      return;
    }
    setTogglingFavorite(prev => new Set(prev).add(productId));
    try {
      const response = await favoritesApi.toggle(productId);
      setFavoriteProducts(prev => {
        const next = new Set(prev);
        if (response.data.is_favorite) {
          next.add(productId);
        } else {
          next.delete(productId);
        }
        return next;
      });
    } catch (error) {
      console.error('Toggle favorite error:', error);
    } finally {
      setTogglingFavorite(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }, [user, router]);

  // Download PDF catalog — direct save to device downloads folder
  const handleDownloadCatalog = async () => {
    if (!carModel?.catalog_pdf) {
      Alert.alert(
        language === 'ar' ? 'غير متاح' : 'Not Available',
        language === 'ar' ? 'لا يوجد كتالوج متاح لهذا الموديل حالياً' : 'No catalog available for this model yet'
      );
      return;
    }

    setDownloadingCatalog(true);
    try {
      const catalogData = carModel.catalog_pdf;
      const rawName = (carModel.name_ar || carModel.name || 'catalog').replace(/\s+/g, '_');
      const fileName = `${rawName}_catalog.pdf`;

      if (Platform.OS === 'web') {
        // Web: convert base64 → Blob → Object URL so Firefox/Chrome/Safari all work
        let blobUrl: string;

        if (catalogData.startsWith('data:application/pdf;base64,')) {
          const base64 = catalogData.split(',')[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: 'application/pdf' });
          blobUrl = URL.createObjectURL(blob);
        } else {
          // Plain URL — open directly
          window.open(catalogData, '_blank');
          return;
        }

        // Trigger download (works in Firefox, Chrome, Safari, Edge)
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Release memory after a short delay
        setTimeout(() => URL.revokeObjectURL(blobUrl), 500);

      } else {
        // Mobile (iOS/Android) — write to cache then share/open
        const base64Data = catalogData.startsWith('data:')
          ? catalogData.split(',')[1]
          : catalogData;
        const fileUri = `${FileSystem.documentDirectory ?? ''}${fileName}`;

        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: 'base64',
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/pdf',
            dialogTitle: language === 'ar' ? 'فتح الكتالوج' : 'Open Catalog',
            UTI: 'com.adobe.pdf',
          });
        } else {
          await Linking.openURL(fileUri);
        }
      }
    } catch (error) {
      console.error('Error downloading catalog:', error);
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error',
        language === 'ar' ? 'فشل تحميل الكتالوج، يرجى المحاولة مرة أخرى' : 'Failed to download catalog, please try again'
      );
    } finally {
      setDownloadingCatalog(false);
    }
  };

  const getName = (item: any, field: string = 'name') => {
    if (!item) return '';
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  };

  const handleAddToCart = useCallback(async (product: any) => {
    if (!user) {
      router.push('/login');
      return;
    }

    // BIDIRECTIONAL: Check if product already exists in cart (as bundle OR normal item)
    if (checkDuplicate(product.id)) {
      // Trigger shake animation on cart button
      const buttonRef = cartButtonRefs.current.get(product.id);
      if (buttonRef) {
        buttonRef.triggerShake();
      }

      // Haptic feedback for warning
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
      Alert.alert(
        language === 'ar' ? 'تنبيه' : 'Notice',
        'عرض المنتج تم اضافته بالفعل',
        [{ text: language === 'ar' ? 'حسناً' : 'OK', style: 'default' }],
        { cancelable: true }
      );
      return;
    }

    setAddingProductId(product.id);
    try {
      await cartApi.addItem(product.id, 1);
      // Invalidate cart query for real-time sync
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
      addToLocalCart({ product_id: product.id, quantity: 1, product });

      // Mark product as added for checkmark display
      setAddedProducts(prev => new Set(prev).add(product.id));

      // Success feedback
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setAddingProductId(null);
    }
  }, [user, router, checkDuplicate, language, queryClient, addToLocalCart]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title="" showBack={true} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <Footer />
      </View>
    );
  }

  if (!carModel) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header title={t('error')} showBack={true} />
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {t('error')}
          </Text>
        </View>
        <Footer />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <Header title={getName(carModel)} showBack={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Car Image Gallery - 16:9 aspect ratio */}
        <View style={[styles.imageContainer, { backgroundColor: colors.surface }]}>
          {(carModel.images && carModel.images.length > 0) || carModel.image_url ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.imageGallery}
              contentContainerStyle={styles.imageGalleryContent}
            >
              {(carModel.images && carModel.images.length > 0 
                ? carModel.images 
                : [carModel.image_url]
              ).map((imageUrl: string, index: number) => (
                <View key={index} style={styles.galleryImageWrapper}>
                  <Image
                    source={{ uri: imageUrl }}
                    style={styles.galleryImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                  {/* Image indicator dots */}
                  {((carModel.images && carModel.images.length > 1) || false) && (
                    <View style={styles.imageIndicatorContainer}>
                      {carModel.images.map((_: string, dotIndex: number) => (
                        <View 
                          key={dotIndex} 
                          style={[
                            styles.imageIndicatorDot,
                            { backgroundColor: dotIndex === index ? colors.primary : 'rgba(255,255,255,0.5)' }
                          ]} 
                        />
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.noImageContainer}>
              <Ionicons name="car-sport" size={100} color={colors.textSecondary} />
            </View>
          )}
        </View>

        {/* Distributor Contact Button - Only visible if distributor is linked */}
        {carModel.distributor && (
          <TouchableOpacity
            style={[styles.distributorButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {
              if (canViewProfile) {
                router.push(`/owner/distributors?viewMode=profile&id=${carModel.distributor.id}`);
              } else {
                triggerGoldenGlow();
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.distributorContent}>
              <View style={[styles.distributorImageContainer, { backgroundColor: colors.surface }]}>
                {carModel.distributor.profile_image ? (
                  <Image
                    source={{ uri: carModel.distributor.profile_image }}
                    style={styles.distributorProfileImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <Ionicons name="person-circle" size={44} color={colors.primary} />
                )}
              </View>
              <View style={styles.distributorTextContainer}>
                <Text style={[styles.distributorLabel, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'موزع هذه السيارة' : 'Car Distributor'}
                </Text>
                <Text style={[styles.distributorName, { color: colors.text }]}>
                  {language === 'ar' && carModel.distributor.name_ar 
                    ? carModel.distributor.name_ar 
                    : carModel.distributor.name}
                </Text>
              </View>
              <View style={[styles.distributorArrowContainer, { backgroundColor: colors.primary + '20' }]}>
                <Ionicons name={canViewProfile ? "chevron-forward" : "lock-closed"} size={18} color={colors.primary} />
              </View>
            </View>
            {/* Subscribe CTA Banner - Only for non-subscribers */}
            {showSubscribeButton && (
              <View style={styles.subscribeBannerContainer}>
                <LinearGradient
                  colors={['#1a1a2e', '#2d2d44']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.subscribeBanner}
                >
                  <View style={styles.subscribeBannerGoldBorder} />
                  <Ionicons name="star" size={16} color="#FFD700" />
                  <Animated.Text style={[styles.subscribeBannerText, glowTextStyle]}>
                    {language === 'ar' 
                      ? 'اشترك للتواصل وظهور البيانات والكتالوج' 
                      : 'Subscribe to contact & view data & catalog'}
                  </Animated.Text>
                  <Ionicons name="star" size={16} color="#FFD700" />
                  <View style={styles.subscribeBannerGoldBorderRight} />
                </LinearGradient>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Premium Subscribe Button - Only visible for non-subscribers */}
        {showSubscribeButton && (
          <TouchableOpacity
            style={styles.subscribeButtonContainer}
            onPress={() => router.push('/subscription-request')}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['#FFD700', '#FFA500', '#FF8C00']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.subscribeGradient}
            >
              <View style={styles.subscribeContent}>
                <View style={styles.subscribeIconContainer}>
                  <Ionicons name="star" size={28} color="#FFF" />
                </View>
                <View style={styles.subscribeTextContainer}>
                  <Text style={styles.subscribeTitle}>
                    {language === 'ar' ? 'اشترك الآن' : 'Subscribe Now'}
                  </Text>
                  <Text style={styles.subscribeSubtitle}>
                    {language === 'ar' ? 'احصل على مزايا حصرية' : 'Get exclusive benefits'}
                  </Text>
                </View>
                <View style={styles.subscribeArrowContainer}>
                  <Ionicons name="chevron-forward" size={20} color="#FFF" />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        )}

          {/* Car Info */}
          <View style={styles.infoContainer}>
            {/* Badges Row: Brand and Catalog */}
            <View style={styles.badgesRow}>
              {/* Brand Badge */}
              {carModel.brand && (
                <TouchableOpacity 
                  style={[styles.brandBadge, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}
                  onPress={() => router.push(`/brand/${carModel.brand.id}`)}
                >
                  <Ionicons name="car-sport" size={17} color={colors.primary} />
                  <Text style={[styles.brandText, { color: colors.primary }]}>
                    {getName(carModel.brand)}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.primary} />
                </TouchableOpacity>
              )}

              {/* Catalog Badge */}
              <TouchableOpacity 
                style={[
                  styles.catalogBadge, 
                  { backgroundColor: '#FFD70020' },
                  !canDownloadCatalog && styles.catalogBadgeDisabled
                ]}
                onPress={() => {
                  if (canDownloadCatalog) {
                    handleDownloadCatalog();
                  } else {
                    router.push('/subscription-request');
                  }
                }}
                activeOpacity={0.7}
                disabled={downloadingCatalog}
              >
                {downloadingCatalog ? (
                  <ActivityIndicator size="small" color="#FFD700" />
                ) : (
                  <Ionicons name="document-text" size={16} color="#FFD700" />
                )}
                <Text style={styles.catalogText}>
                  {downloadingCatalog 
                    ? (language === 'ar' ? 'جاري...' : 'Loading...')
                    : (language === 'ar' ? 'الكتالوج' : 'Catalog')
                  }
                </Text>
                {canDownloadCatalog ? (
                  carModel.catalog_pdf ? (
                    <Ionicons name="download-outline" size={14} color="#FFD700" />
                  ) : (
                    <Ionicons name="time-outline" size={14} color="#FFD70080" />
                  )
                ) : (
                  <Ionicons name="lock-closed" size={14} color="#FFD70080" />
                )}
              </TouchableOpacity>
            </View>

            {/* Name & Year */}
          <Text style={[styles.carName, { color: colors.text }]}>
            {getName(carModel)}
          </Text>
          <Text style={[styles.yearRange, { color: colors.textSecondary }]}>
            {carModel.year_start} - {carModel.year_end}
          </Text>

          {carModel.fuel_type && (
            <View style={[styles.fuelTypeBadge, { backgroundColor: getFuelTypeConfig(carModel.fuel_type).color + '15', borderColor: getFuelTypeConfig(carModel.fuel_type).color + '40' }]}>
              <FuelTypeIcon type={carModel.fuel_type} size={19} />
              <Text style={[styles.fuelTypeText, { color: getFuelTypeConfig(carModel.fuel_type).color }]}>
                {language === 'ar' ? getFuelTypeConfig(carModel.fuel_type).labelAr : getFuelTypeConfig(carModel.fuel_type).label}
              </Text>
            </View>
          )}

          {/* Chassis Number Display */}
          {carModel.chassis_number && (
            <View style={[styles.chassisSection, { backgroundColor: colors.secondary + '10', borderColor: colors.secondary + '30' }]}>
              <View style={styles.chassisHeader}>
                <Ionicons name="key-outline" size={18} color={colors.secondary} />
                <Text style={[styles.chassisLabel, { color: colors.secondary }]}>
                  {language === 'ar' ? 'رقم الشاسيه' : 'Chassis Number'}
                </Text>
              </View>
              <Text style={[styles.chassisNumber, { color: colors.text }]}>
                {carModel.chassis_number}
              </Text>
            </View>
          )}

          {/* Description */}
          {(carModel.description || carModel.description_ar) && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('description')}
              </Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                {getName(carModel, 'description')}
              </Text>
            </View>
          )}

          {/* Variants */}
          {carModel.variants && carModel.variants.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'الفئات والمحركات' : 'Variants & Engines'}
              </Text>
              {carModel.variants.map((variant: any, index: number) => (
                <View 
                  key={index} 
                  style={[styles.variantCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.variantName, { color: colors.text }]}>
                    {getName(variant)}
                  </Text>
                  <View style={styles.variantDetails}>
                    <View style={styles.detailRow}>
                      <Ionicons name="speedometer-outline" size={16} color={colors.primary} />
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        {getName(variant, 'engine')}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Ionicons name="cog-outline" size={16} color={colors.primary} />
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        {getName(variant, 'transmission')}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Ionicons name="water-outline" size={16} color={colors.primary} />
                      <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                        {getName(variant, 'fuel_type')}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Compatible Products */}
          {carModel.compatible_products && carModel.compatible_products.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {language === 'ar' ? 'المنتجات المتوافقة' : 'Compatible Products'}
                </Text>
                <View style={[styles.countBadge, { backgroundColor: colors.success + '20' }]}>
                  <Text style={[styles.countText, { color: colors.success }]}>
                    {carModel.compatible_products_count}
                  </Text>
                </View>
              </View>

              {carModel.compatible_products.map((product: any) => (
                <TouchableOpacity
                  key={product.id}
                  style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => router.push(`/product/${product.id}`)}
                >
                  <View style={[styles.productImageContainer, { backgroundColor: colors.surface }]}>
                    {product.image_url ? (
                      <Image
                        source={{ uri: product.image_url }}
                        style={styles.productImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <Ionicons name="cube-outline" size={30} color={colors.textSecondary} />
                    )}
                  </View>
                  <View style={styles.productInfo}>
                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                      {getName(product)}
                    </Text>
                    {product.sku ? (
                      <Text style={[styles.productSku, { color: colors.textSecondary }]} numberOfLines={1}>
                        {language === 'ar' ? 'رقم القطعة: ' : 'SKU: '}{product.sku}
                      </Text>
                    ) : null}
                    {product.category && (
                      <Text style={[styles.productCategory, { color: colors.textSecondary }]}>
                        {getName(product.category)}
                      </Text>
                    )}
                    <View style={styles.productFooter}>
                      <Text style={[styles.productPrice, { color: colors.primary }]}>
                        {parseFloat(String(product.price || 0)).toFixed(2)} ج.م
                      </Text>
                      <View style={[styles.compatibleBadge, { backgroundColor: colors.success + '15' }]}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                        <Text style={[styles.compatibleText, { color: colors.success }]}>
                          {language === 'ar' ? 'متوافق' : 'Compatible'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {/* Action Buttons: Favorite + Cart */}
                  <View style={styles.addToCartBtnWrapper}>
                    <AnimatedFavoriteButton
                      isFavorite={favoriteProducts.has(product.id)}
                      isLoading={togglingFavorite.has(product.id)}
                      onPress={() => handleToggleFavorite(product.id)}
                      size={19}
                    />
                    <AnimatedCartButton
                      ref={(ref) => setCartButtonRef(product.id, ref)}
                      isInCart={addedProducts.has(product.id)}
                      isLoading={addingProductId === product.id}
                      onPress={() => handleAddToCart(product)}
                      size={19}
                      primaryColor={colors.primary}
                    />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* No Compatible Products */}
          {(!carModel.compatible_products || carModel.compatible_products.length === 0) && (
            <View style={styles.emptyProducts}>
              <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'لا توجد منتجات متوافقة حالياً' : 'No compatible products yet'}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer */}
      <Footer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  badgesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 13,
    marginTop: 3,
    gap: 5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    height: IMAGE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carImage: {
    width: '100%',
    height: '100%',
  },
  imageGallery: {
    width: '100%',
    height: '100%',
  },
  imageGalleryContent: {
    alignItems: 'center',
  },
  galleryImageWrapper: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    position: 'relative',
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  noImageContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageIndicatorContainer: {
    position: 'absolute',
    bottom: 9,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 7,
  },
  imageIndicatorDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  infoContainer: {
    padding: 15,
  },
  // Catalog Badge - Golden styling
  catalogBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1.5,
    borderColor: '#FFD70050',
  },
  catalogBadgeDisabled: {
    opacity: 0.6,
  },
  catalogText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFD700',
  },
  brandBadge: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1.9,
  },
  brandText: {
    fontSize: 13,
    fontWeight: '700',
  },
  carName: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 3,
    textAlign: 'center',
  },
  yearRange: {
    fontSize: 19,
    marginBottom: 7,
    textAlign: 'center',
  },
  fuelTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1.9,
    gap: 3,
    marginBottom: 5,
  },
  fuelTypeText: {
    fontSize: 15,
    fontWeight: '600',
  },
  chassisSection: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 15,
    alignItems: 'center',
  },
  chassisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 7,
  },
  chassisLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  chassisNumber: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  section: {
    marginTop: 19,
    width: '100%', // Ensure section takes full width
  },
  sectionTitle: {
    alignItems: 'center',
    fontSize: 19,
    fontWeight: '600',
    marginBottom: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
    gap: 7,
  },
  countBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countText: {
    fontSize: 13,
    fontWeight: '700',
  },
  description: {
    fontSize: 15,
    lineHeight: 24,
  },
  variantCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  variantName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 10,
  },
  variantDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
    flex: 1,
  },
  productCard: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1.9,
    padding: 5,
    marginBottom: 10,
    alignItems: 'center',
  },
  productImageContainer: {
    width: 130,
    height: 105,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productInfo: {
    flex: 1,
    marginLeft: 7,
  },
  productName: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 3.5,
    textAlign: 'center',
  },
  productSku: {
    fontSize: 12,
    marginBottom: 2,
    textAlign: 'center',
    fontWeight: '500',
  },
  productCategory: {
    fontSize: 15,
    marginBottom: 3.5,
    textAlign: 'center',
  },
  productFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  productPrice: {
    fontSize: 19,
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    fontWeight: '700',
  },
  compatibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 19,
    marginBottom: 5.5,
    gap: 5,
  },
  compatibleText: {
    fontSize: 11,
    fontWeight: '700',
  },
  addToCartBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  addToCartBtnWrapper: {
    marginLeft: 7,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 19,
  },
  emptyProducts: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 12,
  },
  // Distributor Button Styles
  distributorButton: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  distributorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  distributorImageContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  distributorProfileImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  distributorTextContainer: {
    flex: 1,
    alignItems: 'center',
  },
  distributorLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  distributorName: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  distributorArrowContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Subscribe Button Styles
  subscribeButtonContainer: {
    marginHorizontal: 17,
    marginTop: 0,
    marginBottom: 3,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  subscribeGradient: {
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 18,
  },
  subscribeContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subscribeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 19,
  },
  subscribeTextContainer: {
    flex: 1,
  },
  subscribeTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 1,
    textAlign: 'center'
  },
  subscribeSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  subscribeArrowContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Subscribe Banner inside Distributor button
  subscribeBannerContainer: {
    marginTop: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 30,
    gap: 7,
    position: 'relative',
  },
  subscribeBannerGoldBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#FFD700',
  },
  subscribeBannerGoldBorderRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#FFD700',
  },
  subscribeBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});

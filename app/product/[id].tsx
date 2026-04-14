import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Animated as RNAnimated,
  Dimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import type { LocalComment } from '../../src/store/appStore';
import { productsApi, cartApi, commentsApi, favoritesApi } from '../../src/services/api';
import { AnimatedFavoriteButton, AnimatedCartButton } from '../../src/components/AnimatedIconButton';
import { useBundleProducts } from '../../src/hooks/queries/useBundleProducts';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import { useCartMutations, shoppingHubKeys } from '../../src/hooks/queries/useShoppingHubQuery';
import { useQueryClient } from '@tanstack/react-query';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withSequence, 
  withTiming,
  interpolate,
  interpolateColor,
  Extrapolation,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
const { width: screenWidth } = Dimensions.get('window');
const GOLD_COLOR = '#FFD700';

// Check if user can view entity profiles
const canViewEntityProfile = (userRole?: string, subscriptionStatus?: string, userObjRole?: string): boolean => {
  const allowedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  return (
    allowedRoles.includes(userRole || '') ||
    allowedRoles.includes(userObjRole || '') ||
    subscriptionStatus === 'subscriber'
  );
};

interface Comment {
  id: string;
  product_id: string;
  user_id: string;
  user_name: string;
  user_picture?: string;
  text: string;
  rating?: number;
  created_at: string;
  is_owner: boolean;
}

interface CarModelCardProps {
  model: any;
  cardWidth: number;
  onPress: (id: string) => void;
  getName: (item: any) => string;
  colors: any;
}

const CarModelCard = React.memo<CarModelCardProps>(({ model, cardWidth, onPress, getName, colors }) => {
  // Use an intermediate variable for clarity and consistency
  const modelImage = model.image_url;
  // Get brand info for display
  const brandInfo = model.brand || model.car_brand;
  const brandName = brandInfo ? (brandInfo.name_ar || brandInfo.name || '') : '';

  return (
    <TouchableOpacity
      style={[
        carModelCardStyles.card, 
        { 
          width: cardWidth, 
          backgroundColor: colors.surface, 
          borderColor: colors.border,
          shadowColor: colors.text,
        }
      ]}
      onPress={() => onPress(model.id)}
      activeOpacity={0.85}
    >
      {/* Image Container with proper aspect ratio */}
      <View style={[carModelCardStyles.imageContainer, { backgroundColor: colors.background }]}>
        {modelImage ? (
          <Image
            source={{ uri: modelImage }}
            style={carModelCardStyles.image}
            contentFit="cover"
            transition={200}
            cachePolicy="disk"
          />
        ) : (
          <View style={carModelCardStyles.placeholderContainer}>
            <Ionicons name="car-sport" size={36} color={colors.textSecondary} />
          </View>
        )}
      </View>
      
      {/* Info Container */}
      <View style={carModelCardStyles.infoContainer}>
        {/* Model Name */}
        <Text style={[carModelCardStyles.modelName, { color: colors.text }]} numberOfLines={1}>
          {getName(model)}
        </Text>
        
        {/* Brand Name (if available) */}
        {brandName ? (
          <Text style={[carModelCardStyles.brandName, { color: colors.primary }]} numberOfLines={1}>
            {brandName}
          </Text>
        ) : null}
        
        {/* Year Range */}
        {(model.year_start || model.year_end) && (
          <View style={[carModelCardStyles.yearBadge, { backgroundColor: colors.primary + '15' }]}>
            <Text style={[carModelCardStyles.yearText, { color: colors.primary }]}>
              {model.year_start ? `${model.year_start}` : ''}{model.year_end ? ` - ${model.year_end}` : '+'}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

// Dedicated styles for CarModelCard - Professional and Clean
const carModelCardStyles = StyleSheet.create({
  card: {
    borderRadius: 15,
    borderWidth: 1.9,
    overflow: 'hidden',
    // Professional shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1.5, // Optimal ratio for images
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContainer: {
    padding: 1.9 ,
    alignItems: 'center',
    minHeight: 55,
    justifyContent: 'center',
  },
  modelName: {
    fontSize: 11.9,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 15.9,
  },
  brandName: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
  yearBadge: {
    marginTop: 1,
    paddingHorizontal: 3,
    paddingVertical: 1.5,
    borderRadius: 9,
    textAlign: 'center',
  },
  yearText: {
    fontSize: 10.5,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const { user, addToLocalCart, addLocalComment, deleteLocalComment, getProductComments } = useAppStore();
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const userRole = useAppStore((state) => state.userRole);
  const localComments = useAppStore((state) => state.localComments);

  // Check if this product is in any active bundle
  const { isProductInBundle } = useBundleProducts();
  const isInBundle = id ? isProductInBundle(id) : false;

  // Cart mutations with duplicate prevention
  const queryClient = useQueryClient();
  const { checkBundleDuplicate } = useCartMutations();

  // Check if user should see subscribe button (not a subscriber and no pending request)
  const productPrivilegedRoles = ['owner', 'admin', 'partner', 'subscriber'];
  const showSubscribeButton =
    subscriptionStatus === 'none' &&
    !productPrivilegedRoles.includes(userRole || '') &&
    !productPrivilegedRoles.includes(user?.role || '');
  
  // RBAC: Check if user can view entity profiles
  const canViewProfile = canViewEntityProfile(userRole, subscriptionStatus, user?.role);
  
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

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState(false);
  const [quantity, setQuantity] = useState(1);
  
  // Image slider state
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [productImages, setProductImages] = useState<string[]>([]);
  
  // Favorites state
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  
  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  
  // New comment form
  const [commentText, setCommentText] = useState('');
  const [selectedRating, setSelectedRating] = useState(0);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showCommentForm, setShowCommentForm] = useState(false);

  const { carGridNumColumns, carGridCardWidth } = useMemo(() => {
    const MIN_COLUMNS = 5;
    const PADDING_HORIZONTAL = 10; // Total horizontal padding of the container (5 each side)
    const GAP = 5; // Gap between cards
    const availableWidth = screenWidth - PADDING_HORIZONTAL;
    const totalInternalGaps = GAP * (MIN_COLUMNS - 1);
    const cardWidth = (availableWidth - totalInternalGaps) / MIN_COLUMNS;

    return { carGridNumColumns: MIN_COLUMNS, carGridCardWidth: cardWidth };
  }, [screenWidth]);

  useEffect(() => {
    fetchProduct();
  }, [id]);

  useEffect(() => {
    if (id) {
      fetchComments();
      if (user) {
        checkFavoriteStatus();
      }
    }
  }, [id, user]);

  // Set up product images when product is loaded
  useEffect(() => {
    if (product) {
      const images: string[] = [];
      // Add images array first
      if (product.images && product.images.length > 0) {
        images.push(...product.images);
      } 
      // Add image_url if exists and not already in images
      else if (product.image_url && !images.includes(product.image_url)) {
        images.push(product.image_url);
      }
      setProductImages(images);
      setSelectedImageIndex(0);
    }
  }, [product]);

  const fetchProduct = useCallback(async () => {
    if (!id) return;
    try {
      const response = await productsApi.getById(id);
      setProduct(response.data);
    } catch (error) {
      console.error('Error fetching product:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const localCommentsRef = React.useRef(localComments);
  React.useEffect(() => { localCommentsRef.current = localComments; }, [localComments]);

  const fetchComments = useCallback(async () => {
    if (!id) return;
    setCommentsLoading(true);
    try {
      const response = await commentsApi.getProductComments(id);
      const serverComments = response.data.comments || [];
      setComments(serverComments);
      const rawAvg = response.data.avg_rating;
      setAvgRating(rawAvg != null && rawAvg !== undefined ? parseFloat(String(rawAvg)) : null);
      setRatingCount(response.data.rating_count || 0);
    } catch (error) {
      console.error('Error fetching comments from server, using local comments:', error);
      const current = localCommentsRef.current;
      const productLocalComments = current.filter((c: LocalComment) => c.product_id === id);
      setComments(productLocalComments);
      const ratingsFromLocal = productLocalComments.filter((c: LocalComment) => c.rating && c.rating > 0);
      if (ratingsFromLocal.length > 0) {
        const avg = ratingsFromLocal.reduce((sum: number, c: LocalComment) => sum + (c.rating || 0), 0) / ratingsFromLocal.length;
        setAvgRating(avg);
        setRatingCount(ratingsFromLocal.length);
      } else {
        setAvgRating(null);
        setRatingCount(0);
      }
    } finally {
      setCommentsLoading(false);
    }
  }, [id]);

  const checkFavoriteStatus = useCallback(async () => {
    if (!id || !user) return;
    try {
      const response = await favoritesApi.check(id);
      setIsFavorite(response.data.is_favorite);
    } catch (error) {
      console.error('Error checking favorite status:', error);
    }
  }, [id, user]);

  const handleToggleFavorite = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!id) return;

    setFavoriteLoading(true);
    try {
      const response = await favoritesApi.toggle(id);
      setIsFavorite(response.data.is_favorite);
    } catch (error) {
      console.error('Error toggling favorite:', error);
      Alert.alert(t('error'));
    } finally {
      setFavoriteLoading(false);
    }
  }, [id, user, router, t]);

  const handleAddToCart = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!product) return;

    if (checkBundleDuplicate(product.id)) {
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

    setAddingToCart(true);
    try {
      await cartApi.addItem(product.id, quantity);
      queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
      addToLocalCart({ product_id: product.id, quantity: quantity, product });
      Alert.alert('', t('addToCart') + ' ✔', [{ text: 'OK' }]);
      setQuantity(1);
    } catch (error) {
      console.error('Error adding to cart:', error);
      Alert.alert(t('error'));
    } finally {
      setAddingToCart(false);
    }
  }, [user, product, quantity, checkBundleDuplicate, router, language, t, queryClient, addToLocalCart]);

  const handleSubmitComment = useCallback(async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!id) return;

    if (!commentText.trim()) {
      Alert.alert(language === 'ar' ? 'يرجى كتابة تعليق' : 'Please enter a comment');
      return;
    }

    setSubmittingComment(true);
    
    // Create a local comment object
    const newComment: LocalComment = {
      id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      product_id: id,
      user_id: user.id,
      user_name: user.name || user.email,
      user_picture: user.picture,
      text: commentText.trim(),
      rating: selectedRating > 0 ? selectedRating : undefined,
      created_at: new Date().toISOString(),
      is_owner: true,
    };
    
    try {
      // Try to submit to server first
      await commentsApi.addComment(id, commentText.trim(), selectedRating > 0 ? selectedRating : undefined);
      // On success: reset form and reload from server only (no local copy to avoid duplicates)
      setCommentText('');
      setSelectedRating(0);
      setShowCommentForm(false);
      Keyboard.dismiss();
      fetchComments();
      Alert.alert(language === 'ar' ? 'تم إضافة التعليق بنجاح' : 'Comment added successfully');
    } catch (error) {
      console.error('Error adding comment to server, saving locally:', error);
      // Save locally even if server fails (offline-first approach)
      addLocalComment(newComment);
      setCommentText('');
      setSelectedRating(0);
      setShowCommentForm(false);
      Keyboard.dismiss();
      // Update comments list immediately with local comment
      setComments(prev => [newComment, ...prev]);
      // Update rating calculations
      if (newComment.rating) {
        const newCount = ratingCount + 1;
        const newAvg = avgRating ? ((avgRating * ratingCount) + newComment.rating) / newCount : newComment.rating;
        setAvgRating(newAvg);
        setRatingCount(newCount);
      }
      Alert.alert(language === 'ar' ? 'تم حفظ التعليق محلياً' : 'Comment saved locally');
    } finally {
      setSubmittingComment(false);
    }
  }, [id, user, commentText, selectedRating, router, language, fetchComments, addLocalComment, avgRating, ratingCount]);

  const handleDeleteComment = useCallback((commentId: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف التعليق' : 'Delete Comment',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا التعليق؟' : 'Are you sure you want to delete this comment?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        let previousComments: Comment[] = [];
        setComments(prev => {
          previousComments = prev;
          return prev.filter(c => c.id !== commentId);
        });
        deleteLocalComment(commentId);
        try {
          await commentsApi.deleteComment(commentId);
          fetchComments();
        } catch (error) {
          console.error('Error deleting comment:', error);
          setComments(previousComments);
        }
      },
    });
  }, [language, deleteLocalComment, fetchComments, showConfirm]);

  const getName = (item: any, field: string = 'name') => {
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  interface StarsDisplayProps {
    rating: number;
    size?: number;
    interactive?: boolean;
    onPress?: (rating: number) => void;
    color?: string;
    secondaryColor?: string;
  }

  const StarsDisplay = React.memo<StarsDisplayProps>(({
    rating,
    size = 17.5,
    interactive = false,
    onPress,
    color = GOLD_COLOR, // Use the defined GOLD_COLOR constant
    secondaryColor = '#A9A9A9'
  }) => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            disabled={!interactive}
            onPress={() => onPress && onPress(star)}
            style={styles.starButton}
            activeOpacity={0.7}
          >
            <Ionicons
              name={star <= rating ? 'star' : 'star-outline'}
              size={size}
              color={star <= rating ? color : secondaryColor}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  });
  
  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            {t('error')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <Header title={getName(product)} showBack={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Product Image Slider with Thumbnails */}
        <View style={[styles.imageContainer, { backgroundColor: colors.surface }]}>
          {/* Main Image */}
          {productImages.length > 0 ? (
            <Image
              source={{ uri: productImages[selectedImageIndex] }}
              style={styles.productImage}
              contentFit="contain"
              cachePolicy="disk"
              placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
              transition={200}
            />
          ) : (
            <Ionicons name="cube-outline" size={100} color={colors.textSecondary} />
          )}
          
          {/* Golden Gift Icon for Bundle Products */}
          {isInBundle && (
            <View style={styles.bundleIconContainer}>
              <View style={styles.bundleIconBadge}>
                <Ionicons name="gift" size={18} color="#FFD700" />
              </View>
              <Text style={styles.bundleLabel}>
                {language === 'ar' ? 'عرض خاص' : 'Bundle'}
              </Text>
            </View>
          )}
          
          {/* Favorite Button */}
          <View style={[styles.favoriteButton, { backgroundColor: 'transparent' }]}>
            <AnimatedFavoriteButton
              isFavorite={isFavorite}
              isLoading={favoriteLoading}
              onPress={handleToggleFavorite}
              size={24}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card }}
            />
          </View>

          {/* Image Counter */}
          {productImages.length > 1 && (
            <View style={[styles.imageCounter, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
              <Text style={styles.imageCounterText}>
                {selectedImageIndex + 1}/{productImages.length}
              </Text>
            </View>
          )}
        </View>

        {/* Thumbnail Images */}
        {productImages.length > 1 && (
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            style={styles.thumbnailsContainer}
            contentContainerStyle={styles.thumbnailsContent}
          >
            {productImages.map((img, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.thumbnail,
                  { 
                    borderColor: selectedImageIndex === index ? colors.primary : 'transparent',
                    backgroundColor: colors.surface,
                  }
                ]}
                onPress={() => setSelectedImageIndex(index)}
                activeOpacity={0.7}
              >
                <Image 
                  source={{ uri: img }} 
                  style={styles.thumbnailImage}
                  contentFit="cover"
                  cachePolicy="disk"
                />
                {selectedImageIndex === index && (
                  <View style={[styles.thumbnailOverlay, { borderColor: colors.primary }]} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Supplier Contact Button - Only visible if supplier is linked */}
        {product.supplier && (
          <TouchableOpacity
            style={[styles.supplierButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => {
              if (canViewProfile) {
                router.push(`/owner/suppliers?viewMode=profile&id=${product.supplier.id}`);
              } else {
                triggerGoldenGlow();
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.supplierContent}>
              <View style={[styles.supplierImageContainer, { backgroundColor: colors.surface }]}>
                {product.supplier.profile_image ? (
                  <Image 
                    source={{ uri: product.supplier.profile_image }} 
                    style={styles.supplierProfileImage}
                    contentFit="cover"
                  />
                ) : (
                  <Ionicons name="person-circle" size={44} color={colors.secondary} />
                )}
              </View>
              <View style={styles.supplierTextContainer}>
                <Text style={[styles.supplierLabel, { color: colors.textSecondary }]}>
                  {language === 'ar' ? 'مورد هذا المنتج' : 'Product Supplier'}
                </Text>
                <Text style={[styles.supplierName, { color: colors.text }]}>
                  {language === 'ar' && product.supplier.name_ar 
                    ? product.supplier.name_ar 
                    : product.supplier.name}
                </Text>
              </View>
              <View style={[styles.supplierArrowContainer, { backgroundColor: colors.secondary + '20' }]}>
                <Ionicons name={canViewProfile ? "chevron-forward" : "lock-closed"} size={18} color={colors.secondary} />
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

        {/* Product Info */}
        <View style={styles.infoContainer}>
          {/* Rating Summary */}
          {avgRating !== null && avgRating !== undefined && typeof avgRating === 'number' && (
            <View style={styles.ratingContainer}>
              <StarsDisplay rating={Math.round(avgRating)} />
              <Text style={[styles.ratingText, { color: colors.text }]}>
                {avgRating.toFixed(1)}
              </Text>
              <Text style={[styles.ratingCount, { color: colors.textSecondary }]}>
                ({ratingCount} {language === 'ar' ? 'تقييم' : 'reviews'})
              </Text>
            </View>
          )}

          {/* Brand & Price Row */}
          <View style={styles.rowContainer}>
            {product.product_brand && (
              <TouchableOpacity 
                style={[styles.brandBadge, { backgroundColor: colors.primary + '15', marginBottom: 0 }]}
                onPress={() => router.push(`/search?product_brand_id=${product.product_brand.id}`)}
              >
                <Ionicons name="pricetag" size={17} color={colors.primary} />
                <Text style={[styles.brandText, { color: colors.primary }]}>
                  {product.product_brand.name}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.primary} />
              </TouchableOpacity>
            )}
            <Text style={[styles.price, { color: colors.primary, marginBottom: 0 }]}>
              {parseFloat(String(product.price || 0)).toFixed(2)} ج.م
            </Text>
          </View>

          {/* Name */}
          <Text style={[styles.productName, { color: colors.text, marginTop: 10 }]}>
            {getName(product)}
          </Text>

          {/* SKU & Category Row */}
          <View style={[styles.rowContainer, { marginTop: 5 }]}>
            <Text style={[styles.sku, { color: colors.textSecondary, marginBottom: 0 }]}>
              {t('sku')}: {product.sku}
            </Text>
            {product.category && (
              <TouchableOpacity 
                style={[styles.categoryBadge, { borderColor: colors.border }]}
                onPress={() => router.push(`/search?category_id=${product.category.id}`)}
              >
                <Ionicons name="grid-outline" size={16} color={colors.primary} />
                <Text style={[styles.categoryText, { color: colors.text, fontSize: 14 }]}>
                  {getName(product.category)}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          
          {/* Description */}
          {(product.description || product.description_ar) && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('description')}
              </Text>
              <Text style={[styles.description, { color: colors.textSecondary }]}>
                {getName(product, 'description')}
              </Text>
            </View>
          )}

                    {/* Compatible Cars - Clickable */}
          {product.car_models && product.car_models.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('compatibleWith')}
              </Text>
              {/* Compatible Car Models Grid - View+map for reliable ScrollView nesting */}
              <View style={[carModelGridStyles.gridContainer, { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 3 }]}>
                {product.car_models.map((model: any) => (
                  <View key={model.id} style={{ width: carGridCardWidth, padding: 15 }}>
                    <CarModelCard
                      model={model}
                      cardWidth={carGridCardWidth - 1.9}
                      onPress={(id) => router.push(`/car/${id}`)}
                      getName={getName}
                      colors={colors}
                    />
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Comments Section */}
          <View style={[styles.commentsSection, { borderTopColor: colors.border }]}>
            <View style={styles.commentsHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === 'ar' ? 'التعليقات والتقييمات' : 'Comments & Reviews'}
              </Text>
              <Text style={[styles.commentsCount, { color: colors.textSecondary }]}>
                ({comments.length})
              </Text>
            </View>

            {/* Add Comment Button */}
            {!showCommentForm && (
              <TouchableOpacity
                style={[styles.addCommentButton, { backgroundColor: colors.primary + '15' }]}
                onPress={() => {
                  if (!user) {
                    router.push('/login');
                    return;
                  }
                  setShowCommentForm(true);
                }}
              >
                <Ionicons name="create-outline" size={20} color={colors.primary} />
                <Text style={[styles.addCommentText, { color: colors.primary }]}>
                  {language === 'ar' ? 'أضف تعليقك' : 'Write a review'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Comment Form */}
            {showCommentForm && (
              <View style={[styles.commentForm, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.formLabel, { color: colors.text }]}>
                  {language === 'ar' ? 'تقييمك' : 'Your Rating'}
                </Text>
                <StarsDisplay rating={selectedRating} size={28} interactive={true} onPress={setSelectedRating} secondaryColor={colors.textSecondary} />
               
                <Text style={[styles.formLabel, { color: colors.text, marginTop: 12 }]}>
                  {language === 'ar' ? 'تعليقك' : 'Your Comment'}
                </Text>
                <TextInput
                  style={[styles.commentInput, { 
                    backgroundColor: colors.background, 
                    color: colors.text,
                    borderColor: colors.border,
                    textAlign: isRTL ? 'right' : 'left',
                  }]}
                  placeholder={language === 'ar' ? 'اكتب تعليقك هنا...' : 'Write your comment here...'}
                  placeholderTextColor={colors.textSecondary}
                  value={commentText}
                  onChangeText={setCommentText}
                  multiline
                  numberOfLines={4}
                />
                
                <View style={styles.formButtons}>
                  <TouchableOpacity
                    style={[styles.cancelButton, { borderColor: colors.border }]}
                    onPress={() => {
                      setShowCommentForm(false);
                      setCommentText('');
                      setSelectedRating(0);
                    }}
                  >
                    <Text style={[styles.cancelButtonText, { color: colors.textSecondary }]}>
                      {language === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.submitButton, { backgroundColor: colors.primary }]}
                    onPress={handleSubmitComment}
                    disabled={submittingComment}
                  >
                    {submittingComment ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.submitButtonText}>
                        {language === 'ar' ? 'إرسال' : 'Submit'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Comments List */}           
             <FlashList
              data={comments}
              keyExtractor={(item) => item.id.toString()}
              estimatedItemSize={130} // Approximate height of a comment card
              renderItem={({ item: comment }) => (
                <View 
                  key={comment.id} 
                  style={[styles.commentCard, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 9 }]}
                >
                  <View style={styles.commentHeader}>
                    <View style={styles.commentUserInfo}>
                      <View style={[styles.commentAvatar, { backgroundColor: colors.primary + '20' }]}>
                        {comment.user_picture ? (
                          <Image 
                            source={{ uri: comment.user_picture }} 
                            style={styles.avatarImage}
                            contentFit="cover"
                            cachePolicy="disk"
                          />
                        ) : (
                          <Ionicons name="person" size={18} color={colors.primary} />
                        )}
                      </View>
                      <View>
                        <Text style={[styles.commentUserName, { color: colors.text }]}>
                          {comment.user_name}
                       </Text>
                        <Text style={[styles.commentDate, { color: colors.textSecondary }]}>
                          {formatDate(comment.created_at)}
                       </Text>
                      </View>
                    </View>
        
                    {comment.is_owner && (
                      <TouchableOpacity
                        style={styles.deleteCommentButton}
                        onPress={() => handleDeleteComment(comment.id)}
                      >
                        <Ionicons name="trash-outline" size={19} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
      
                  {comment.rating && (
                    <View style={styles.commentRating}>
                      <StarsDisplay rating={comment.rating} size={14} secondaryColor={colors.textSecondary} />
                    </View>
                  )}
      
                  <Text style={[styles.commentText, { color: colors.text }]}>
                    {comment.text}
                  </Text>
                </View>
              )}
            />
          </View>
        </View>

        {/* Bottom padding for button */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Add to Cart Button - Professional Animated */}
      <AnimatedAddToCartBar
        onPress={handleAddToCart}
        isLoading={addingToCart}
        price={parseFloat(String(product.price || 0)) || 0}
        quantity={quantity}
        onQuantityChange={setQuantity}
        label={t('addToCart')}
        colors={colors}
        language={language}
        isRTL={isRTL}
      />
      {ConfirmModalNode}
    </KeyboardAvoidingView>
  );
}

// Professional Animated Add to Cart Component with Quantity Selector
const AnimatedAddToCartBar: React.FC<{
  onPress: () => void;
  isLoading: boolean;
  price: number;
  quantity: number;
  onQuantityChange: (qty: number) => void;
  label: string;
  colors: any;
  language: string;
  isRTL: boolean;
}> = ({ onPress, isLoading, price, quantity, onQuantityChange, label, colors, language, isRTL }) => {
  const scale = useSharedValue(1);
  const iconRotate = useSharedValue(0);
  const shimmerX = useSharedValue(-200);
  const successScale = useSharedValue(0);
  const priceScale = useSharedValue(1);
  const quantityScale = useSharedValue(1);
  const [showSuccess, setShowSuccess] = useState(false);

  // Calculate total price
  const totalPrice = price * quantity;

  // Start shimmer animation on mount
  useEffect(() => {
    const animateShimmer = () => {
      shimmerX.value = withSequence(
        withTiming(-200, { duration: 0 }),
        withTiming(400, { duration: 2000 })
      );
    };
    const interval = setInterval(animateShimmer, 3000);
    animateShimmer();
    return () => clearInterval(interval);
  }, []);

  const handlePress = () => {
    if (isLoading) return;
    
    // Haptic feedback
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // Button press animation
    scale.value = withSequence(
      withSpring(0.92, { damping: 10, stiffness: 400 }),
      withSpring(1.05, { damping: 8, stiffness: 300 }),
      withSpring(1, { damping: 10, stiffness: 400 })
    );
    
    // Icon rotation animation
    iconRotate.value = withSequence(
      withTiming(-15, { duration: 80 }),
      withTiming(15, { duration: 80 }),
      withTiming(-10, { duration: 60 }),
      withTiming(10, { duration: 60 }),
      withTiming(0, { duration: 100 })
    );
    
    onPress();
  };

  const handleIncrease = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onQuantityChange(quantity + 1);
    
    // Animate quantity badge
    quantityScale.value = withSequence(
      withSpring(1.3, { damping: 5, stiffness: 300 }),
      withSpring(1, { damping: 5, stiffness: 300 })
    );
    
    // Animate price
    priceScale.value = withSequence(
      withTiming(1.1, { duration: 100 }),
      withSpring(1, { damping: 5, stiffness: 300 })
    );
  };

  const handleDecrease = () => {
    if (quantity > 1) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onQuantityChange(quantity - 1);
      
      // Animate quantity badge
      quantityScale.value = withSequence(
        withSpring(0.7, { damping: 5, stiffness: 300 }),
        withSpring(1, { damping: 5, stiffness: 300 })
      );
      
      // Animate price
      priceScale.value = withSequence(
        withTiming(0.9, { duration: 100 }),
        withSpring(1, { damping: 5, stiffness: 300 })
      );
    }
  };

  // Show success animation after loading completes
  useEffect(() => {
    if (!isLoading && showSuccess) {
      successScale.value = withSequence(
        withSpring(1.2, { damping: 8, stiffness: 400 }),
        withSpring(1, { damping: 10, stiffness: 400 })
      );
      setTimeout(() => setShowSuccess(false), 1500);
    }
  }, [isLoading]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${iconRotate.value}deg` }],
  }));

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }],
  }));

  const priceAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: priceScale.value }],
  }));

  const quantityAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: quantityScale.value }],
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: interpolate(successScale.value, [0, 0.5, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={[
      addToCartStyles.container, 
      { backgroundColor: colors.card, borderTopColor: colors.border }
    ]}>
      {/* Left Side - Quantity Selector */}
      <View style={[addToCartStyles.quantitySection, isRTL && addToCartStyles.quantitySectionRTL]}>
        <TouchableOpacity
          onPress={handleDecrease}
          style={[
            addToCartStyles.qtyButton,
            { 
              backgroundColor: quantity > 1 ? colors.primary + '20' : colors.surface,
              borderColor: quantity > 1 ? colors.primary : colors.border,
            },
          ]}
          disabled={quantity <= 1}
        >
          <Ionicons name="remove" size={18} color={quantity > 1 ? colors.primary : colors.textSecondary} />
        </TouchableOpacity>
        
        <Animated.View style={[addToCartStyles.qtyBadge, { backgroundColor: colors.primary }, quantityAnimStyle]}>
          <Text style={addToCartStyles.qtyText}>{quantity}</Text>
        </Animated.View>
        
        <TouchableOpacity
          onPress={handleIncrease}
          style={[
            addToCartStyles.qtyButton,
            { 
              backgroundColor: colors.primary + '20',
              borderColor: colors.primary,
            },
          ]}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Center - Dynamic Price */}
      <View style={addToCartStyles.priceSection}>
        <Text style={[addToCartStyles.priceLabel, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'الإجمالي' : 'Total'}
        </Text>
        <Animated.Text style={[addToCartStyles.priceValue, { color: colors.text }, priceAnimStyle]}>
          {totalPrice?.toFixed(2)} <Text style={addToCartStyles.currency}>{language === 'ar' ? 'ج.م' : 'EGP'}</Text>
        </Animated.Text>
      </View>

      {/* Right - Add to Cart Button */}
      <Animated.View style={[addToCartStyles.buttonWrapper, containerStyle]}>
        <TouchableOpacity
          style={addToCartStyles.button}
          onPress={handlePress}
          disabled={isLoading}
          activeOpacity={1}
        >
          <LinearGradient
            colors={isLoading ? ['#6B7280', '#4B5563'] : ['#3B82F6', '#2563EB']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={addToCartStyles.gradient}
          >
            {/* Shimmer effect */}
            <Animated.View style={[addToCartStyles.shimmer, shimmerStyle]}>
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.3)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={addToCartStyles.shimmerGradient}
              />
            </Animated.View>

            {isLoading ? (
              <View style={addToCartStyles.loadingContainer}>
                <ActivityIndicator size="small" color="#FFF" />
              </View>
            ) : (
              <View style={addToCartStyles.buttonContent}>
                <Animated.View style={iconStyle}>
                  <Ionicons name="cart" size={20} color="#FFF" />
                </Animated.View>
                <View style={addToCartStyles.plusBadge}>
                  <Ionicons name="add" size={12} color="#FFF" />
                </View>
              </View>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const addToCartStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 50,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    borderTopWidth: 1,
    gap: 10,
  },
  quantitySection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quantitySectionRTL: {
    flexDirection: 'row-reverse',
  },
  qtyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  qtyBadge: {
    minWidth: 36,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  qtyText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  priceSection: {
    flex: 1,
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 2,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  currency: {
    fontSize: 12,
    fontWeight: '600',
  },
  buttonWrapper: {
    minWidth: 60,
  },
  button: {
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 100,
  },
  shimmerGradient: {
    flex: 1,
    width: 100,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  plusBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  imageContainer: {
    height: 275,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  // Golden Gift Icon for Bundle Products - Product Detail Page
  bundleIconContainer: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  bundleIconBadge: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  bundleLabel: {
    backgroundColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#FFD700',
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '700',
  },
  imageCounter: {
    position: 'absolute',
    bottom: 13,
    left: 19,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  imageCounterText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  thumbnailsContainer: {
    paddingVertical: 10,
    paddingHorizontal: 19,
  },
  thumbnailsContent: {
    gap: 7,
  },
  thumbnail: {
    width: 79,
    height: 79,
    borderRadius: 8,
    borderWidth: 1.9,
    overflow: 'hidden',
    marginRight: 10,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderRadius: 6,
  },
  favoriteButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  infoContainer: {
    paddingVertical: 3,
    paddingHorizontal: 0, // Remove horizontal padding to allow children to fill width
    alignItems: 'center',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
    gap: 13,
  },
  starsContainer: {
    flexDirection: 'row',
  },
  starButton: {
    padding: 3.5,
  },
  ratingText: {
    fontSize: 19,
    fontWeight: '700',
  },
  ratingCount: {
    fontSize: 13,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 15,
    marginVertical: 5,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  brandText: {
    fontSize: 14,
    fontWeight: '600',
  },
  price: {
    fontSize: 30,
    fontWeight: '900',
  },
  productName: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 7,
    lineHeight: 50,
    textAlign: 'center',
  },
  sku: {
    fontSize: 15,
    fontWeight: '900',
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 0.7,
    gap: 5,
  },
  categoryText: {
    fontSize: 17,
    fontWeight: '700',
  },
  section: {
    marginTop: 9,
    width: '100%', // Ensure section takes full width
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 1,
    textAlign: 'center',
  },
  description: {
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  
  // Comments Section
  commentsSection: {
    marginTop: 13,
    paddingTop: 13,
    borderTopWidth: 1.9,
    width: '95%', // Ensure section takes full width
  },
  commentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
    gap: 7,
  },
  commentsCount: {
    fontSize: 13,
  },
  addCommentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 13,
    borderRadius: 15,
    gap: 8,
  },
  addCommentText: {
    fontSize: 17,
    fontWeight: '700',
  },
  commentForm: {
    padding: 13,
    borderRadius: 12,
    borderWidth: 1.9,
    marginBottom: 10,
  },
  formLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 7,
    textAlign: 'center',
  },
  commentInput: {
    minHeight: 110,
    borderWidth: 1.9,
    borderRadius: 8,
    padding: 13,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 15,
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.9,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  submitButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  noComments: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  noCommentsText: {
    fontSize: 14,
  },
  commentsList: {
    marginTop: 15,
  },
  commentCard: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1.9,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  commentUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  commentAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  commentUserName: {
    fontSize: 15,
    fontWeight: '700',
  },
  commentDate: {
    fontSize: 11,
  },
  deleteCommentButton: {
    padding: 7,
  },
  commentRating: {
    marginTop: 10,
  },
  commentText: {
    fontSize: 17,
    lineHeight: 30,
    marginTop: 19,
  },
  // Supplier Button Styles
  supplierButton: {
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
  supplierContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  supplierImageContainer: {
    width: 70,
    height: 70,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  supplierProfileImage: {
    width: 70,
    height: 70,
    borderRadius: 30,
  },
  supplierTextContainer: {
    flex: 1,
    alignItems: 'center',
  },
  supplierLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  supplierName: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  supplierArrowContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Premium Subscribe Button Styles
  subscribeButtonContainer: {
    marginHorizontal: 39,
    marginBottom: 7,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#FFD711',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  subscribeGradient: {
    borderRadius: 16,
  },
  subscribeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 19,
  },
  subscribeIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 5,
  },
  subscribeTextContainer: {
    flex: 1,
  },
  subscribeTitle: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  subscribeSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
  subscribeArrowContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Subscribe Banner inside Supplier/Distributor button
  subscribeBannerContainer: {
    marginTop: 7,
    borderRadius: 10,
    overflow: 'hidden',
  },
  subscribeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
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
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});

// Car Model Grid Styles - Separate for cleaner organization
const carModelGridStyles = StyleSheet.create({
  gridContainer: {
    width: '100%',
    minHeight: 200,
    marginTop: 5,
  },
  listContent: {
    paddingVertical: 5,
  },
  cardWrapper: {
    flex: 1, // Let FlashList handle the column width
    padding: 5,
    minHeight: 160,
  },
});

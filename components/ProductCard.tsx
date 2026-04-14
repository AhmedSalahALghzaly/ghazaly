import React, { useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform, Alert } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';
import { useAppStore } from '../store/appStore';
import { AnimatedFavoriteButton, AnimatedCartButton, AnimatedCartButtonRef } from './AnimatedIconButton';
import { useBundleProducts } from '../hooks/queries/useBundleProducts';
import { useCartMutations } from '../hooks/queries/useShoppingHubQuery';
import { useFavorites, useToggleFavorite } from '../hooks/useFavorites';
import * as Haptics from 'expo-haptics';

interface ProductCardProps {
  product: {
    id: string;
    name: string;
    name_ar: string;
    price: number;
    image_url?: string;
    product_brand_id?: string;
    // Enhanced fields for detailed display
    product_brand_name?: string;
    product_brand_name_ar?: string;
    manufacturer_country?: string;
    manufacturer_country_ar?: string;
    sku?: string;
    // Car compatibility fields - format: "Brand Model Year"
    compatible_car_model?: string;
    compatible_car_model_ar?: string;
    compatible_car_brand?: string;
    compatible_car_brand_ar?: string;
    compatible_car_year_from?: number;
    compatible_car_year_to?: number;
    compatible_car_models_count?: number;
  };
  onAddToCart?: (quantity: number) => void;
  cardWidth?: number;
  showDetails?: boolean;
}

// Memoized ProductCard component
const ProductCardComponent: React.FC<ProductCardProps> = ({ 
  product, 
  onAddToCart, 
  cardWidth, 
  showDetails = true 
}) => {
  const { colors, isDark } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const user = useAppStore(useCallback((state) => state.user, []));
  
  // Check if product is in any active bundle
  const { isProductInBundle } = useBundleProducts();
  const isInBundle = useMemo(() => isProductInBundle(product.id), [product.id, isProductInBundle]);
  
  // Cart mutations for bidirectional duplicate checking
  const { checkDuplicate, checkBundleDuplicate } = useCartMutations();
  
  // Ref for AnimatedCartButton to trigger shake animation
  const cartButtonRef = useRef<AnimatedCartButtonRef>(null);
  
  const { data: favoritesData } = useFavorites();
  const toggleFavoriteMutation = useToggleFavorite();
  const isFavorite = useMemo(() => {
    if (!favoritesData) return false;
    return favoritesData.some((f: any) => f.product_id === product.id);
  }, [favoritesData, product.id]);
  const favoriteLoading = toggleFavoriteMutation.isPending;
  const [cartLoading, setCartLoading] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [quantity, setQuantity] = useState(1);
  
  // Animation refs
  const priceScaleAnim = useRef(new Animated.Value(1)).current;
  const quantityBounceAnim = useRef(new Animated.Value(1)).current;

  // Memoized computed values
  const displayName = useMemo(() => 
    language === 'ar' && product.name_ar ? product.name_ar : product.name,
    [language, product.name, product.name_ar]
  );

  const brandName = useMemo(() => {
    if (language === 'ar' && product.product_brand_name_ar) {
      return product.product_brand_name_ar;
    }
    return product.product_brand_name || '';
  }, [language, product.product_brand_name, product.product_brand_name_ar]);

  const carModelName = useMemo(() => {
    // Build the full compatibility string: "Brand Model Year-Year" (e.g., "Toyota Corolla 2020-2024")
    const parts: string[] = [];
    
    // Get car brand name
    if (language === 'ar' && product.compatible_car_brand_ar) {
      parts.push(product.compatible_car_brand_ar);
    } else if (product.compatible_car_brand) {
      parts.push(product.compatible_car_brand);
    }
    
    // Get car model name
    if (language === 'ar' && product.compatible_car_model_ar) {
      parts.push(product.compatible_car_model_ar);
    } else if (product.compatible_car_model) {
      parts.push(product.compatible_car_model);
    }
    
    // Add year range if available
    if (product.compatible_car_year_from) {
      if (product.compatible_car_year_to && product.compatible_car_year_to !== product.compatible_car_year_from) {
        parts.push(`${product.compatible_car_year_from}-${product.compatible_car_year_to}`);
      } else {
        parts.push(`${product.compatible_car_year_from}`);
      }
    }
    
    return parts.join(' ');
  }, [language, product.compatible_car_model, product.compatible_car_model_ar, product.compatible_car_brand, product.compatible_car_brand_ar, product.compatible_car_year_from, product.compatible_car_year_to]);

  const countryName = useMemo(() => {
    if (language === 'ar' && product.manufacturer_country_ar) {
      return product.manufacturer_country_ar;
    }
    return product.manufacturer_country || '';
  }, [language, product.manufacturer_country, product.manufacturer_country_ar]);

  const totalPrice = useMemo(() => (parseFloat(String(product.price || 0)) || 0) * quantity, [product.price, quantity]);
  
  const formattedPrice = useMemo(() => `${totalPrice.toFixed(2)} ج.م`, [totalPrice]);


  // Memoized handlers
  const handleCardPress = useCallback(() => {
    router.push(`/product/${product.id}`);
  }, [router, product.id]);

  const handleToggleFavorite = useCallback(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    toggleFavoriteMutation.mutate(product.id);
  }, [user, router, product.id, toggleFavoriteMutation]);

  const animatePrice = useCallback(() => {
    Animated.sequence([
      Animated.timing(priceScaleAnim, {
        toValue: 1.15,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(priceScaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [priceScaleAnim]);

  const handleAddToCart = useCallback(async () => {
    if (!onAddToCart) return;
    
    // BIDIRECTIONAL: Check if product already exists in cart at all (bundle OR normal)
    if (checkDuplicate(product.id)) {
      // Trigger shake animation on cart button
      if (cartButtonRef.current) {
        cartButtonRef.current.triggerShake();
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
      
      // Do NOT set addedToCart to true - keep showing 'add' icon
      return;
    }
    
    // Success path - product is not a duplicate
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    
    setCartLoading(true);
    
    try {
      await onAddToCart(quantity);
      // Only set addedToCart to true after successful addition
      setAddedToCart(true);
      setTimeout(() => setAddedToCart(false), 1500);
    } catch (error) {
      console.error('Error adding to cart:', error);
      setAddedToCart(false);
    } finally {
      setCartLoading(false);
    }
  }, [onAddToCart, quantity, checkDuplicate, product.id, language]);

  const handleIncreaseQuantity = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setQuantity(prev => prev + 1);
    
    Animated.sequence([
      Animated.spring(quantityBounceAnim, {
        toValue: 1.3,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
      Animated.spring(quantityBounceAnim, {
        toValue: 1,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
    ]).start();

    animatePrice();
  }, [quantityBounceAnim, animatePrice]);

  const handleDecreaseQuantity = useCallback(() => {
    if (quantity > 1) {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setQuantity(prev => prev - 1);
      
      Animated.sequence([
        Animated.spring(quantityBounceAnim, {
          toValue: 0.7,
          friction: 5,
          tension: 300,
          useNativeDriver: true,
        }),
        Animated.spring(quantityBounceAnim, {
          toValue: 1,
          friction: 5,
          tension: 300,
          useNativeDriver: true,
        }),
      ]).start();

      animatePrice();
    }
  }, [quantity, quantityBounceAnim, animatePrice]);

  // Memoized style computations with Glassmorphism Dark Mode Enhancement
  const containerStyle = useMemo(() => [
    styles.container,
    {
      // Glassmorphism Background - 30% more solid in Dark Mode
      backgroundColor: isDark ? 'rgba(30, 41, 59, 0.91)' : 'rgba(255, 255, 255, 0.9)',
      // Enhanced Border for Dark Mode clarity
      borderColor: isDark ? 'rgba(255, 255, 255, 0.18)' : colors.border,
      borderWidth: 1,
      borderRadius: 20,
      width: cardWidth || 160,
      // Enhanced Shadow for Premium Depth
      ...Platform.select({
        web: {
          boxShadow: isDark 
            ? '0px 8px 32px rgba(0, 0, 0, 0.4), inset 0px 1px 0px rgba(255, 255, 255, 0.05)'
            : '0px 4px 16px rgba(0, 0, 0, 0.1)',
          backdropFilter: 'blur(15px)',
          WebkitBackdropFilter: 'blur(15px)',
        },
        default: {
          shadowColor: isDark ? '#000000' : '#000000',
          shadowOffset: { width: 0, height: isDark ? 8 : 4 },
          shadowOpacity: isDark ? 0.25 : 0.1,
          shadowRadius: isDark ? 15 : 8,
          elevation: isDark ? 12 : 6,
        },
      }),
    },
  ], [isDark, colors.border, cardWidth]);

  const imageContainerStyle = useMemo(() => [
    styles.imageContainer, 
    { backgroundColor: 'transparent' }
  ], []);

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={handleCardPress}
      activeOpacity={0.7}
    >
      {/* Image Container - with transparency support */}
      <View style={imageContainerStyle}>
        {product.image_url ? (
          <Image
            source={{ uri: product.image_url }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="disk"
            transition={200}
          />
        ) : (
          <Ionicons name="cube-outline" size={48} color={colors.textSecondary} />
        )}
        
        {/* Golden Gift Icon for Bundle Products */}
        {isInBundle && (
          <View style={styles.bundleIconContainer}>
            <View style={styles.bundleIconBadge}>
              <Ionicons name="gift" size={14} color="#FFD700" />
            </View>
          </View>
        )}
      </View>
      
      <View style={styles.content}>
        {/* Product Name */}
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
          {displayName}
        </Text>
        
        {/* Product Details Section - Reordered as per requirements */}
        {showDetails && (
          <View style={styles.detailsContainer}>
            {/* 1. Compatible Car Brands */}
            {carModelName ? (
              <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
                <Ionicons name="car-sport-outline" size={15} color={colors.success || '#10B981'} />
                <Text style={[styles.detailText, styles.carModelText, { color: colors.success || '#10B981' }]} numberOfLines={1}>
                  {carModelName}
                  {product.compatible_car_models_count && product.compatible_car_models_count > 1 && (
                    ` +${product.compatible_car_models_count - 1}`
                  )}
                </Text>
              </View>
            ) : null}
            
            {/* 2. Product Brand & Country */}
            {brandName ? (
              <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
                <Ionicons name="pricetag-outline" size={15} color={colors.primary} />
                <Text style={[styles.detailText, styles.brandText, { color: colors.primary }]} numberOfLines={1}>
                  {brandName}{countryName ? ` • ${countryName}` : ''}
                </Text>
              </View>
            ) : null}
            
            {/* 3. Product SKU */}
            {product.sku ? (
              <View style={[styles.detailRow, isRTL && styles.detailRowRTL]}>
                <Ionicons name="barcode-outline" size={15} color={colors.textSecondary} />
                <Text style={[styles.detailText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {product.sku}
                </Text>
              </View>
            ) : null}
          </View>
        )}
        
        {/* Quantity Selector Row */}
        <View style={[styles.quantityRow, isRTL && styles.quantityRowRTL]}>
          {/* Minus Button */}
          <TouchableOpacity
            onPress={handleDecreaseQuantity}
            style={[
              styles.quantityButton,
              { 
                backgroundColor: quantity > 1 ? colors.primary + '20' : colors.surface,
                borderColor: quantity > 1 ? colors.primary : colors.border,
              },
            ]}
            disabled={quantity <= 1}
          >
            <Ionicons 
              name="remove" 
              size={14} 
              color={quantity > 1 ? colors.primary : colors.textSecondary} 
            />
          </TouchableOpacity>
          
          {/* Quantity Display */}
          <Animated.View
            style={[
              styles.quantityBadge,
              { 
                backgroundColor: colors.primary,
                transform: [{ scale: quantityBounceAnim }],
              },
            ]}
          >
            <Text style={styles.quantityText}>{quantity}</Text>
          </Animated.View>
          
          {/* Plus Button */}
          <TouchableOpacity
            onPress={handleIncreaseQuantity}
            style={[
              styles.quantityButton,
              { 
                backgroundColor: colors.primary + '20',
                borderColor: colors.primary,
              },
            ]}
          >
            <Ionicons name="add" size={14} color={colors.primary} />
          </TouchableOpacity>
        </View>
        
        {/* Footer with Favorites button, Dynamic Price, and Add to Cart button */}
        <View style={[styles.footer, isRTL && styles.footerRTL]}>
          {/* Animated Favorites Button - Left */}
          <AnimatedFavoriteButton
            isFavorite={isFavorite}
            isLoading={favoriteLoading}
            onPress={handleToggleFavorite}
            size={16}
            style={styles.iconButton}
          />
          
          {/* Dynamic Price - Center */}
          <Animated.Text 
            style={[
              styles.price, 
              { 
                color: colors.primary,
                transform: [{ scale: priceScaleAnim }],
              }
            ]}
          >
            {formattedPrice}
          </Animated.Text>
          
          {/* Animated Add to Cart Button - Right */}
          {onAddToCart && (
            <AnimatedCartButton
              ref={cartButtonRef}
              isInCart={addedToCart}
              isLoading={cartLoading}
              onPress={handleAddToCart}
              size={16}
              primaryColor={colors.primary}
              style={styles.iconButton}
            />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Export memoized component with custom comparison
export const ProductCard = React.memo(ProductCardComponent, (prevProps, nextProps) => {
  // Only re-render if these props change
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.image_url === nextProps.product.image_url &&
    prevProps.product.name === nextProps.product.name &&
    prevProps.product.name_ar === nextProps.product.name_ar &&
    prevProps.cardWidth === nextProps.cardWidth &&
    prevProps.showDetails === nextProps.showDetails
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    borderWidth: 1.9,
    overflow: 'hidden',
    margin: 5,
  },
  imageContainer: {
    height: 139,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  // Golden Gift Icon for Bundle Products - Premium Look
  bundleIconContainer: {
    position: 'absolute',
    top: 9,
    left: 9,
    zIndex: 10,
  },
  bundleIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#000000',
    borderWidth: 1.5,
    borderColor: '#FFD700',
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow for premium effect (cross-platform)
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 4px rgba(255, 215, 0, 0.3)',
      },
      default: {
        shadowColor: '#FFD700',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
      },
    }),
  },
  brandBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    right: 5,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  brandBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: {
    padding: 9,
    paddingTop: 5,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 5,
    minHeight: 19.9,
    textAlign: 'center',
  },
  detailsContainer: {
    marginBottom: 7,
    gap: 5,
    alignItems: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    gap: 5,
  },
  detailRowRTL: {
  flexDirection: 'row-reverse',
  },
  detailText: {
    fontSize: 13,
    flex: 1,
  },
  brandText: {
    fontWeight: '700',
    textAlign: 'center',
  },
  carModelText: {
    fontWeight: '700',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
    gap: 9,
  },
  quantityRowRTL: {
    flexDirection: 'row-reverse',
  },
  quantityButton: {
    width: 30,
    height: 30,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.9,
  },
  quantityBadge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
  },
  quantityText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerRTL: {
    flexDirection: 'row-reverse',
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  iconButton: {
    padding: 5,
  },
});

export default ProductCard;

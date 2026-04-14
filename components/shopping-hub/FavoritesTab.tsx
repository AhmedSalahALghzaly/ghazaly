/**
 * FavoritesTab - Favorites list display tab
 * REDESIGNED: Larger product cards with SKU and compatible car models
 * FIXED: Proper list spacing and car models display
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Image, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { EmptyState } from '../ui/EmptyState';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';

interface FavoritesTabProps {
  favorites: any[];
  isRTL: boolean;
  isAdminView: boolean;
  onAddToCart: (product: any) => void;
  onToggleFavorite: (productId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const FavoritesTab: React.FC<FavoritesTabProps> = ({
  favorites,
  isRTL,
  isAdminView,
  onAddToCart,
  onToggleFavorite,
  onRefresh,
  refreshing = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();

  const safeFavorites = useMemo(() => 
    Array.isArray(favorites) ? favorites : [], 
    [favorites]
  );

  // Format compatible car models for display
  const formatCarModels = useCallback((product: any, item: any) => {
    const carModels = product?.compatible_car_models || 
                      product?.car_models || 
                      item?.compatible_car_models ||
                      item?.car_models;
    
    if (carModels && Array.isArray(carModels) && carModels.length > 0) {
      if (carModels.length <= 2) {
        return carModels.map((m: any) => m.name || m.name_ar || m).join(', ');
      }
      const firstTwo = carModels.slice(0, 2).map((m: any) => m.name || m.name_ar || m).join(', ');
      return `${firstTwo} +${carModels.length - 2} ${language === 'ar' ? 'أخرى' : 'more'}`;
    }
    
    const carModelIds = product?.car_model_ids || item?.car_model_ids;
    if (carModelIds && Array.isArray(carModelIds) && carModelIds.length > 0) {
      return language === 'ar' 
        ? `${carModelIds.length} موديل متوافق` 
        : `${carModelIds.length} compatible models`;
    }
    
    return null;
  }, [language]);

  // Render professional favorite item card
  const renderFavoriteItem = useCallback(({ item }: { item: any }) => {
    const product = item.product || {};
    const productId = item.product_id || product.id;
    const carModelsDisplay = formatCarModels(product, item);
    const sku = product.sku || 'N/A';
    const price = parseFloat(String(product.price || 0)) || 0;
    const originalPriceNum = parseFloat(String(product.original_price || 0)) || 0;
    const hasDiscount = originalPriceNum > 0 && originalPriceNum > price;

    return (
      <Pressable
        style={[styles.productCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => router.push(`/product/${productId}`)}
      >
        {/* Product Image */}
        <View style={[styles.productThumb, { backgroundColor: colors.surface }]}>
          {product.image_url || (product.images && product.images[0]) ? (
            <Image 
              source={{ uri: product.images?.[0] || product.image_url }} 
              style={styles.productImage}
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="cube-outline" size={32} color={colors.textSecondary} />
          )}
        </View>

        {/* Product Info */}
        <View style={styles.productInfo}>
          {/* Product Name */}
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
            {language === 'ar' ? product.name_ar || product.name : product.name || product.name_ar}
          </Text>

          {/* SKU Badge */}
          <View style={[styles.skuContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="barcode-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.skuText, { color: colors.textSecondary }]}>
              SKU: {sku}
            </Text>
          </View>

          {/* Compatible Car Models */}
          {carModelsDisplay && (
            <View style={[styles.carModelsContainer, { backgroundColor: '#3B82F6' + '15' }]}>
              <Ionicons name="car-outline" size={12} color="#3B82F6" />
              <Text style={[styles.carModelsText, { color: '#3B82F6' }]} numberOfLines={1}>
                {carModelsDisplay}
              </Text>
            </View>
          )}

          {/* Price Row */}
          <View style={[styles.priceRow, isRTL && styles.rowReverse]}>
            {hasDiscount && (
              <Text style={[styles.originalPrice, { color: colors.textSecondary }]}>
                {originalPriceNum.toFixed(0)} ج.م
              </Text>
            )}
            <Text style={[styles.productPrice, { color: NEON_NIGHT_THEME.primary }]}>
              {price.toFixed(0)} ج.م
            </Text>
            {hasDiscount && originalPriceNum > 0 && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>
                  -{Math.round(((originalPriceNum - price) / originalPriceNum) * 100)}%
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.productActions}>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: NEON_NIGHT_THEME.primary }]}
            onPress={() => onAddToCart(product)}
          >
            <Ionicons name="cart-outline" size={18} color="#FFF" />
            <Text style={styles.actionBtnText}>
              {language === 'ar' ? 'أضف' : 'Add'}
            </Text>
          </Pressable>
          {!isAdminView && (
            <Pressable
              style={[styles.removeBtn, { backgroundColor: '#EF4444' + '15' }]}
              onPress={() => onToggleFavorite(productId)}
            >
              <Ionicons name="heart-dislike-outline" size={18} color="#EF4444" />
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  }, [colors, language, router, isAdminView, isRTL, onAddToCart, onToggleFavorite, formatCarModels]);

  // List header with section title - NO extra padding
  const ListHeaderComponent = useCallback(() => (
    <View style={[styles.headerRow, isRTL && styles.rowReverse]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {language === 'ar' ? 'المنتجات المفضلة' : 'Favorite Products'}
      </Text>
      <View style={[styles.countBadge, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
        <Text style={styles.countBadgeText}>{safeFavorites.length}</Text>
      </View>
    </View>
  ), [colors, language, isRTL, safeFavorites.length]);

  // List footer
  const ListFooterComponent = useCallback(() => (
    <View style={{ height: 100 }} />
  ), []);

  // Empty state
  const ListEmptyComponent = useCallback(() => (
    <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <EmptyState
        icon="heart-outline"
        title={language === 'ar' ? 'لا توجد منتجات مفضلة' : 'No favorites yet'}
        subtitle={language === 'ar' ? 'أضف منتجات إلى المفضلة من صفحة المنتج' : 'Add products to favorites from product page'}
      />
    </View>
  ), [language, colors]);

  return (
    <FlashList
      data={safeFavorites}
      renderItem={renderFavoriteItem}
      keyExtractor={(item, index) => item.product_id || item.id || `fav-item-${index}`}
      estimatedItemSize={180}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={ListFooterComponent}
      ListEmptyComponent={ListEmptyComponent}
      contentContainerStyle={styles.listContainer}
      showsVerticalScrollIndicator={false}
      extraData={safeFavorites}
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
  );
};

const styles = StyleSheet.create({
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  countBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  countBadgeText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
  },
  productCard: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    minHeight: 140,
  },
  productThumb: {
    width: 100,
    height: 100,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  productImage: {
    width: 100,
    height: 100,
    borderRadius: 12,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'flex-start',
  },
  productName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 6,
    lineHeight: 20,
  },
  skuContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginBottom: 6,
  },
  skuText: {
    fontSize: 11,
    fontWeight: '500',
  },
  carModelsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
    marginBottom: 8,
    maxWidth: '100%',
  },
  carModelsText: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  originalPrice: {
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '700',
  },
  discountBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  discountText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
  },
  productActions: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  removeBtn: {
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
});

export default FavoritesTab;

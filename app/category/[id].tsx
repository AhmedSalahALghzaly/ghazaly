import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProductCard } from '../../src/components/ProductCard';
import { CategoryCard } from '../../src/components/CategoryCard';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore } from '../../src/store/appStore';
import { productsApi, categoriesApi, cartApi } from '../../src/services/api';

const MAX_CARD_WIDTH = 270;
const GAP = 9;
const PADDING = 18;

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, addToLocalCart, cartItems: cart } = useAppStore();

  const availableWidth = width - PADDING * 2;
  const numColumns = Math.max(2, Math.ceil(availableWidth / (MAX_CARD_WIDTH + GAP)));
  const cardWidth = (availableWidth - GAP * (numColumns - 1)) / numColumns;

  const [category, setCategory] = useState<any>(null);
  const [subcategories, setSubcategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [allCats, prodsRes] = await Promise.all([
        categoriesApi.getAll(),
        productsApi.getAll({ category_id: id }),
      ]);
      const currentCat = allCats.data.find((c: any) => c.id === id);
      setCategory(currentCat);
      const subCats = allCats.data.filter((c: any) => c.parent_id === id);
      setSubcategories(subCats);
      setProducts(prodsRes.data.products || []);
    } catch (error) {
      console.error('Error fetching category data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const isInCart = (productId: string) => {
    if (!cart) return false;
    return cart.some((item: any) => (item.product_id || item.id) === productId);
  };

  const handleAddToCart = useCallback(async (product: any) => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (isInCart(product.id)) return;
    setAddingProductId(product.id);
    try {
      await cartApi.addItem(product.id, 1);
      addToLocalCart({ product_id: product.id, quantity: 1, product });
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setAddingProductId(null);
    }
  }, [user, cart, addToLocalCart, router]);

  const getName = (item: any) =>
    language === 'ar' && item?.name_ar ? item.name_ar : item?.name || '';

  const renderItem = useCallback(({ item }: { item: any }) => (
    <View style={{ padding: GAP / 2 }}>
      <ProductCard
        product={item}
        cardWidth={cardWidth}
        onAddToCart={() => handleAddToCart(item)}
      />
    </View>
  ), [cardWidth, handleAddToCart]);

  const ListHeaderComponent = useCallback(() => (
    <>
      {subcategories.length > 0 && (
        <View style={styles.subcategoriesSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {t('subcategories')}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subcategoriesList}
          >
            {subcategories.map((item) => (
              <CategoryCard key={item.id} category={item} size="small" />
            ))}
          </ScrollView>
        </View>
      )}
      <View style={styles.productsHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {t('products')}
        </Text>
        <Text style={[styles.productCount, { color: colors.textSecondary }]}>
          ({products.length})
        </Text>
      </View>
    </>
  ), [subcategories, products.length, colors, t]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[
        styles.header,
        { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: insets.top + 10 }
      ]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons
            name={isRTL ? 'arrow-forward' : 'arrow-back'}
            size={24}
            color={colors.text}
          />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {getName(category)}
        </Text>
        <View style={styles.placeholder} />
      </View>

      <View style={[styles.listContainer, { paddingHorizontal: PADDING - GAP / 2 }]}>
        <FlashList
          data={products}
          keyExtractor={(item) => item.id}
          numColumns={numColumns}
          estimatedItemSize={cardWidth + 60}
          renderItem={renderItem}
          ListHeaderComponent={ListHeaderComponent}
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Ionicons name="cube-outline" size={60} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {t('noProducts')}
              </Text>
            </View>
          )}
          onRefresh={onRefresh}
          refreshing={refreshing}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  placeholder: {
    width: 40,
  },
  listContainer: {
    flex: 1,
  },
  subcategoriesSection: {
    marginBottom: 16,
    paddingTop: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  subcategoriesList: {
    paddingHorizontal: 4,
  },
  productsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  productCount: {
    fontSize: 14,
    marginLeft: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
});

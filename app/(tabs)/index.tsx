/**
 * Home Screen - Optimized with React Query
 * Main landing page with car brands, offers, products, and search
 */
import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  memo,
  useEffect,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Animated,
  Keyboard,
  Dimensions,
  Platform,
  FlatList,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "../../src/components/Header";
import { DynamicOfferSlider } from "../../src/components/DynamicOfferSlider";
import { InteractiveCarSelector } from "../../src/components/InteractiveCarSelector";
import { AnimatedBrandCard } from "../../src/components/AnimatedBrandCard";
import { ProductCard } from "../../src/components/ProductCard";
import { useTheme } from "../../src/hooks/useTheme";
import { useTranslation } from "../../src/hooks/useTranslation";
import { useAppStore } from "../../src/store/appStore";
import { useQueryClient } from "@tanstack/react-query";
import { cartApi, favoritesApi } from "../../src/services/api";
import { shoppingHubKeys } from "../../src/hooks/queries/useShoppingHubQuery";
import {
  Skeleton,
  ProductCardSkeleton,
} from "../../src/components/ui/Skeleton";
import { syncService } from "../../src/services/syncService";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useHomeScreenQuery } from "../../src/hooks/queries";
import { createTextShadow } from "../../src/utils/shadowUtils";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Product card sizing
const BASE_CARD_WIDTH = 179;
const MAX_ENLARGEMENT_PERCENT = 0.19;
const MAX_CARD_WIDTH = Math.floor(
  BASE_CARD_WIDTH * (1 + MAX_ENLARGEMENT_PERCENT),
);

const calculateCardWidth = () => {
  const horizontalPadding = 13 * 2;
  const cardGap = 11;
  const availableWidth = SCREEN_WIDTH - horizontalPadding;
  const minCardsPerRow = Math.floor(
    availableWidth / (BASE_CARD_WIDTH + cardGap),
  );
  const optimalWidth = Math.floor(
    (availableWidth - cardGap * (minCardsPerRow - 1)) / minCardsPerRow,
  );
  return Math.min(optimalWidth, MAX_CARD_WIDTH);
};

const HOME_PRODUCT_CARD_WIDTH = calculateCardWidth();

// Memoized components
const MemoizedBrandCard = memo(AnimatedBrandCard);
const MemoizedProductCard = memo(ProductCard);

// Memoized Car Model Card component
const CarModelCard = memo(({ model, colors, getName, onPress }: any) => (
  <TouchableOpacity
    style={[
      styles.carModelCard,
      { backgroundColor: colors.card, borderColor: colors.border },
    ]}
    onPress={onPress}
  >
    <View
      style={[
        styles.carModelImageContainer,
        { backgroundColor: colors.surface },
      ]}
    >
      {model.image_url ? (
        <Image
          source={{ uri: model.image_url }}
          style={styles.carModelImage}
          contentFit="cover"
          cachePolicy="disk"
          transition={200}
        />
      ) : (
        <Ionicons name="car-sport" size={36} color={colors.textSecondary} />
      )}
    </View>
    <View style={styles.carModelInfo}>
      <Text
        style={[styles.carModelName, { color: colors.text }]}
        numberOfLines={1}
      >
        {getName(model)}
      </Text>
      {model.year_start && model.year_end && (
        <Text style={[styles.carModelYear, { color: colors.textSecondary }]}>
          {model.year_start} - {model.year_end}
        </Text>
      )}
    </View>
  </TouchableOpacity>
));

export default function HomeScreen() {
  const { colors, isDark } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const { user, addToLocalCart } = useAppStore();
  const queryClient = useQueryClient();

  // Use React Query for all data fetching
  const {
    categories,
    carBrands,
    carModels,
    productBrands,
    products,
    favorites: favoritesSet,
    banners,
    isLoading,
    isRefetching,
    refetch,
  } = useHomeScreenQuery();

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [cartLoadingStates, setCartLoadingStates] = useState<
    Record<string, boolean>
  >({});
  const [addedToCartStates, setAddedToCartStates] = useState<
    Record<string, boolean>
  >({});

  // Sync favorites from query - with strict value comparison guard
  const prevFavoritesRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (favoritesSet instanceof Set) {
      // Only update if the favorites set has actually changed
      const prevFavs = prevFavoritesRef.current;
      const currentFavsArray = Array.from(favoritesSet).sort();
      const prevFavsArray = prevFavs ? Array.from(prevFavs).sort() : [];

      // Deep comparison of sets
      const hasChanged =
        currentFavsArray.length !== prevFavsArray.length ||
        currentFavsArray.some((id, idx) => id !== prevFavsArray[idx]);

      if (hasChanged) {
        prevFavoritesRef.current = new Set(favoritesSet);
        setFavorites(new Set(favoritesSet));
      }
    }
  }, [favoritesSet]);

  // Sync is started globally in _layout.tsx — do not start again here

  // Search filter - with debouncing applied via useCallback/useMemo
  // No need for useEffect - derived state pattern is more efficient
  const filteredProducts = useMemo(() => {
    if (searchQuery.trim() === "") {
      return products;
    }
    const query = searchQuery.toLowerCase();
    return products.filter((product: any) => {
      const name = (product.name || "").toLowerCase();
      const nameAr = (product.name_ar || "").toLowerCase();
      const sku = (product.sku || "").toLowerCase();
      return (
        name.includes(query) || nameAr.includes(query) || sku.includes(query)
      );
    });
  }, [searchQuery, products]);

  // Search focus animation - consolidated with debounce ref to prevent rapid calls
  const searchAnimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    // Clear any pending animation timeout
    if (searchAnimTimeoutRef.current) {
      clearTimeout(searchAnimTimeoutRef.current);
    }

    // Debounce animation to prevent rapid calls
    searchAnimTimeoutRef.current = setTimeout(() => {
      Animated.timing(searchAnim, {
        toValue: isSearchFocused ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }, 50);

    return () => {
      if (searchAnimTimeoutRef.current) {
        clearTimeout(searchAnimTimeoutRef.current);
      }
    };
  }, [isSearchFocused]); // Remove searchAnim from dependencies - it's a ref and stable

  const getName = useCallback(
    (item: any) => {
      return language === "ar" && item.name_ar ? item.name_ar : item.name;
    },
    [language],
  );

  // Pre-compute brand models count map to avoid expensive filter in renderItem
  const brandModelsCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    carModels.forEach((m: any) => {
      if (m.brand_id) map[m.brand_id] = (map[m.brand_id] || 0) + 1;
    });
    return map;
  }, [carModels]);

  // Memoized render functions for FlatLists
  const renderCarBrandItem = useCallback(
    ({ item: brand }: { item: any }) => (
      <MemoizedBrandCard
        brand={brand}
        type="car"
        modelsCount={brandModelsCountMap[brand.id] || 0}
        onPress={() => router.push(`/brand/${brand.id}`)}
      />
    ),
    [brandModelsCountMap, router],
  );

  const renderCarModelItem = useCallback(
    ({ item: model }: { item: any }) => (
      <CarModelCard
        model={model}
        colors={colors}
        getName={getName}
        onPress={() => router.push(`/car/${model.id}`)}
      />
    ),
    [colors, getName, router],
  );

  const renderProductBrandItem = useCallback(
    ({ item: brand }: { item: any }) => (
      <MemoizedBrandCard
        brand={{
          ...brand,
          country_of_origin: brand.country_of_origin || "Japan",
        }}
        type="product"
        onPress={() => router.push(`/search?product_brand_id=${brand.id}`)}
      />
    ),
    [router],
  );

  const handleAddToCart = useCallback(
    async (product: any, quantity: number = 1) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setCartLoadingStates((prev) => ({ ...prev, [product.id]: true }));

      try {
        await cartApi.addItem(product.id, quantity);
        addToLocalCart({ product_id: product.id, quantity: quantity, product });
        queryClient.invalidateQueries({ queryKey: shoppingHubKeys.cart });
        setAddedToCartStates((prev) => ({ ...prev, [product.id]: true }));

        setTimeout(() => {
          setAddedToCartStates((prev) => ({ ...prev, [product.id]: false }));
        }, 1500);
      } catch (error) {
        console.error("Error adding to cart:", error);
      } finally {
        setCartLoadingStates((prev) => ({ ...prev, [product.id]: false }));
      }
    },
    [user, router, addToLocalCart],
  );

  const handleToggleFavorite = useCallback(
    async (productId: string) => {
      if (!user) {
        router.push("/login");
        return;
      }
      try {
        const response = await favoritesApi.toggle(productId);
        setFavorites((prev) => {
          const newSet = new Set(prev);
          if (response.data.is_favorite) {
            newSet.add(productId);
          } else {
            newSet.delete(productId);
          }
          return newSet;
        });
      } catch (error) {
        console.error("Error toggling favorite:", error);
      }
    },
    [user, router],
  );

  // Render product item
  const renderProductItem = useCallback(
    ({ item: product }: { item: any }) => (
      <MemoizedProductCard
        product={product}
        cardWidth={HOME_PRODUCT_CARD_WIDTH}
        onAddToCart={(quantity: number) => handleAddToCart(product, quantity)}
      />
    ),
    [handleAddToCart],
  );

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Header showBack={false} />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.section}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Skeleton width={135} height={30} />
              <Skeleton width={70} height={19} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
            >
              {[1, 2, 3, 4].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.brandCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Skeleton
                    width={50}
                    height={50}
                    borderRadius={25}
                    style={{ marginBottom: 9 }}
                  />
                  <Skeleton width={75} height={17} />
                </View>
              ))}
            </ScrollView>
          </View>
          <View style={styles.sliderSection}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Skeleton width={155} height={30} />
            </View>
            <Skeleton
              height={170}
              borderRadius={12}
              style={{ marginHorizontal: 16 }}
            />
          </View>
          <View style={styles.section}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Skeleton width={80} height={20} />
              <Skeleton width={60} height={16} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
            >
              {[1, 2, 3].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  }

  const searchBorderColor = searchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={
          isDark
            ? ["#0a1628", "#152238", "#1a2744", "#0d1b2a"]
            : ["#f0f4f8", "#e2e8f0", "#cbd5e1", "#f8fafc"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {Platform.OS !== "web" && (
        <BlurView
          intensity={15}
          tint={isDark ? "dark" : "light"}
          style={[StyleSheet.absoluteFill, styles.blurOverlay]}
        />
      )}
      <View
        style={[
          styles.glassOverlay,
          {
            backgroundColor: isDark
              ? "rgba(255, 255, 255, 0.03)"
              : "rgba(0, 0, 0, 0.02)",
          },
        ]}
      />

      <Header showBack={false} />

      <ScrollView
        style={[styles.scrollView, { backgroundColor: "transparent" }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor="#fff"
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Dynamic Marketing Slider */}
        <View style={styles.sliderSection}>
          <View
            style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {language === "ar" ? "عروض غزالي الخاصة" : "Special Offers"}
            </Text>
            <View
              style={[
                styles.liveBadge,
                { backgroundColor: colors.error + "20" },
              ]}
            >
              <View
                style={[styles.liveDot, { backgroundColor: colors.error }]}
              />
              <Text style={[styles.liveText, { color: colors.error }]}>
                {language === "ar" ? "عرض  حصري  لدي  الغزالي" : "EXCLUSIVE"}
              </Text>
            </View>
          </View>
          <DynamicOfferSlider />
        </View>

        {/* 2. Car Brands Section */}
        <View style={styles.section}>
          <View
            style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t("carBrands")}
            </Text>
            <TouchableOpacity onPress={() => router.push("/car-brands")}>
              <Text style={[styles.viewAll, { color: colors.primary }]}>
                {t("viewAll")}
              </Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={carBrands}
            renderItem={renderCarBrandItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
            initialNumToRender={5}
            maxToRenderPerBatch={8}
            windowSize={3}
            removeClippedSubviews={true}
            getItemLayout={(_, index) => ({
              length: 146,
              offset: 146 * index,
              index,
            })}
          />
        </View>

        {/* 3. Car Models Section */}
        {carModels.length > 0 && (
          <View style={styles.section}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === "ar" ? "موديلات السيارات" : "Car Models"}
              </Text>
              <TouchableOpacity onPress={() => router.push("/models")}>
                <Text style={[styles.viewAll, { color: colors.primary }]}>
                  {t("viewAll")}
                </Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={carModels.slice(0, 10)}
              renderItem={renderCarModelItem}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
              initialNumToRender={5}
              maxToRenderPerBatch={5}
              windowSize={3}
              removeClippedSubviews={true}
              getItemLayout={(_, index) => ({
                length: 154,
                offset: 154 * index,
                index,
              })}
            />
          </View>
        )}

        {/* 4. Product Brands Section */}
        <View style={styles.section}>
          <View
            style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t("productBrands")}
            </Text>
            <TouchableOpacity onPress={() => router.push("/brands")}>
              <Text style={[styles.viewAll, { color: colors.primary }]}>
                {t("viewAll")}
              </Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={productBrands}
            renderItem={renderProductBrandItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalScroll}
            initialNumToRender={5}
            maxToRenderPerBatch={8}
            windowSize={3}
            removeClippedSubviews={true}
            getItemLayout={(_, index) => ({
              length: 146,
              offset: 146 * index,
              index,
            })}
          />
        </View>

        {/* 5. Products Section */}
        {filteredProducts.length > 0 && (
          <View style={styles.section}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t("products")}
                {searchQuery && (
                  <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
                    {" "}
                    ({filteredProducts.length})
                  </Text>
                )}
              </Text>
              <TouchableOpacity onPress={() => router.push("/search")}>
                <Text style={[styles.viewAll, { color: colors.primary }]}>
                  {t("viewAll")}
                </Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={filteredProducts.slice(0, 20)}
              renderItem={renderProductItem}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
              initialNumToRender={4}
              maxToRenderPerBatch={6}
              windowSize={3}
              removeClippedSubviews={true}
            />
          </View>
        )}

        {/* 6. Search Bar */}
        <View style={styles.searchSection}>
          <Text style={[styles.searchLabel, { color: colors.text }]}>
            {language === "ar" ? "ابحث عن منتج" : "Search Products"}
          </Text>
          <Animated.View
            style={[
              styles.searchInputContainer,
              {
                backgroundColor: colors.surface,
                borderColor: searchBorderColor,
              },
            ]}
          >
            <Ionicons
              name="search"
              size={20}
              color={isSearchFocused ? colors.primary : colors.textSecondary}
            />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder={
                language === "ar"
                  ? "ادخل اسم المنتج أو كود المنتج..."
                  : "Enter product name or SKU..."
              }
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setSearchQuery("");
                  Keyboard.dismiss();
                }}
                style={styles.clearButton}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </Animated.View>

          {searchQuery.length > 0 && (
            <View style={styles.searchResults}>
              <Ionicons
                name={
                  filteredProducts.length > 0
                    ? "checkmark-circle"
                    : "alert-circle"
                }
                size={16}
                color={
                  filteredProducts.length > 0 ? colors.success : colors.error
                }
              />
              <Text
                style={[
                  styles.searchResultsText,
                  {
                    color:
                      filteredProducts.length > 0
                        ? colors.success
                        : colors.error,
                  },
                ]}
              >
                {filteredProducts.length > 0
                  ? language === "ar"
                    ? `تم العثور على ${filteredProducts.length} منتج`
                    : `Found ${filteredProducts.length} products`
                  : language === "ar"
                    ? "لا توجد نتائج"
                    : "No results found"}
              </Text>
            </View>
          )}
        </View>

        <View style={{ height: 20 }} />

        {/* 7. Promotional Banners */}
        {banners.length > 0 && (
          <View style={styles.bannersSection}>
            <View
              style={[styles.sectionHeader, isRTL && styles.sectionHeaderRTL]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {language === "ar" ? "اخبار ومقالات خاصة" : "Special Offers"}
              </Text>
            </View>
            {banners.map((banner: any) => (
              <TouchableOpacity
                key={banner.id}
                style={styles.bannerCard}
                onPress={() => {
                  if (banner.target_product_id) {
                    router.push(`/product/${banner.target_product_id}`);
                  } else if (banner.target_car_model_id) {
                    router.push(`/car/${banner.target_car_model_id}`);
                  }
                }}
                activeOpacity={0.3}
              >
                {banner.image ? (
                  <Image
                    source={{ uri: banner.image }}
                    style={styles.bannerImage}
                    contentFit="cover"
                    cachePolicy="disk"
                    transition={200}
                  />
                ) : (
                  <LinearGradient
                    colors={["#3B82F6", "#8B5CF6"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.bannerGradient}
                  >
                    <Ionicons
                      name="megaphone"
                      size={40}
                      color="rgba(255,255,255,0.3)"
                    />
                  </LinearGradient>
                )}
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.5)"]}
                  style={styles.bannerOverlay}
                >
                  <View style={styles.bannerContent}>
                    <Text style={styles.bannerTitle}>
                      {language === "ar"
                        ? banner.title_ar || banner.title
                        : banner.title}
                    </Text>
                    <View style={styles.bannerBadge}>
                      <Ionicons name="arrow-forward" size={14} color="#FFF" />
                      <Text style={styles.bannerBadgeText}>
                        {language === "ar" ? "اكتشف المزيد" : "Learn More"}
                      </Text>
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      <InteractiveCarSelector />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#375e99",
  },
  blurOverlay: {
    zIndex: 0,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(200, 200, 255, 0.03)",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 19,
  },
  section: {
    marginTop: 19,
  },
  sliderSection: {
    marginTop: 7,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 37.9,
    marginBottom: 5,
  },
  sectionHeaderRTL: {
    flexDirection: "row-reverse",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  viewAll: {
    fontSize: 13,
    fontWeight: "700",
  },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 1.9,
    borderRadius: 19,
    gap: 3,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  liveText: {
    fontSize: 11,
    fontWeight: "700",
  },
  horizontalScroll: {
    paddingHorizontal: 1,
  },
  brandCard: {
    width: 100,
    height: 100,
    borderRadius: 12,
    borderWidth: 1.9,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 10,
  },
  carModelCard: {
    width: 150,
    height: 159,
    borderRadius: 12,
    borderWidth: 1.9,
    marginHorizontal: 1.9,
    overflow: "hidden",
  },
  carModelImageContainer: {
    width: "100%",
    aspectRatio: 1.5, // Optimal ratio for car images
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  carModelImage: {
    width: "100%",
    height: "100%",
  },
  carModelInfo: {
    padding: 3,
  },
  carModelName: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 1.5,
    textAlign: "center",
  },
  carModelYear: {
    fontSize: 17,
    fontWeight: "500",
    textAlign: "center",
  },
  searchSection: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  searchLabel: {
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 12,
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  clearButton: {
    padding: 4,
  },
  searchResults: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 6,
  },
  searchResultsText: {
    fontSize: 13,
    fontWeight: "500",
  },
  bannersSection: {
    marginTop: 19,
    paddingHorizontal: 10,
  },
  bannerCard: {
    height: 399,
    marginHorizontal: 15,
    marginBottom: 15,
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: "#1a1a2e",
  },
  bannerImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  bannerGradient: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "10%",
    justifyContent: "flex-end",
    padding: 15,
  },
  bannerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bannerTitle: {
    color: "#FFF",
    fontSize: 19,
    fontWeight: "700",
    flex: 1,
    ...createTextShadow("rgba(0,0,0,0.3)", 0, 1, 4),
  },
  bannerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.01)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  bannerBadgeText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "700",
  },
});

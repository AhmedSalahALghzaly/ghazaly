/**
 * Product Brands Page - Refactored with FlashList and React Query
 * Displays all product brands with search and country filters
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { Header } from '../src/components/Header';
import { Footer } from '../src/components/Footer';
import { useBrandsQuery } from '../src/hooks/queries';

export default function ProductBrandsPage() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();

  // Use React Query for data fetching
  const { data: brands = [], isLoading, isError, refetch, isRefetching } = useBrandsQuery();

  // Local state for filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  // Extract unique countries from brands
  const countries = useMemo(() => {
    return [...new Set(
      brands
        .map((b: any) => b.country_of_origin)
        .filter((c: string) => c && c.trim())
    )] as string[];
  }, [brands]);

  // Filter brands based on search and country
  const filteredBrands = useMemo(() => {
    let result = [...brands];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((brand: any) =>
        brand.name?.toLowerCase().includes(query) ||
        brand.name_ar?.includes(query)
      );
    }

    // Filter by country
    if (selectedCountry) {
      result = result.filter((brand: any) => brand.country_of_origin === selectedCountry);
    }

    return result;
  }, [brands, searchQuery, selectedCountry]);

  const navigateToBrand = useCallback((brandId: string) => {
    router.push(`/brand/${brandId}`);
  }, [router]);

  // Render brand item for FlashList
  const renderBrandItem = useCallback(({ item: brand }: { item: any }) => (
    <TouchableOpacity
      style={[styles.brandCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => navigateToBrand(brand.id)}
      activeOpacity={0.7}
    >
      {/* Brand Logo */}
      <View style={[styles.brandLogoContainer, { backgroundColor: colors.surface }]}>
        {brand.image ? (
          <Image source={{ uri: brand.image }} style={styles.brandLogo} contentFit="contain" cachePolicy="memory-disk" />
        ) : (
          <Ionicons name="briefcase" size={40} color={colors.textSecondary} />
        )}
      </View>

      {/* Brand Info */}
      <View style={styles.brandInfo}>
        <Text style={[styles.brandName, { color: colors.text }]} numberOfLines={2}>
          {language === 'ar' ? brand.name_ar || brand.name : brand.name}
        </Text>
        {brand.country_of_origin && (
          <View style={styles.countryRow}>
            <Ionicons name="location" size={12} color={colors.textSecondary} />
            <Text style={[styles.countryText, { color: colors.textSecondary }]}>
              {brand.country_of_origin}
            </Text>
          </View>
        )}
      </View>

      {/* Arrow Icon */}
      <View style={[styles.arrowContainer, { backgroundColor: colors.primary + '15' }]}>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.primary} />
      </View>
    </TouchableOpacity>
  ), [colors, language, isRTL, navigateToBrand]);

  const ListHeaderComponent = useCallback(() => (
    <View style={[styles.pageHeader, { backgroundColor: colors.primary }]}>
      <View style={styles.headerIcon}>
        <Ionicons name="briefcase" size={32} color="#FFF" />
      </View>
      <Text style={styles.pageTitle}>
        {language === 'ar' ? 'العلامات التجارية للمنتجات' : 'Product Brands'}
      </Text>
      <Text style={styles.pageSubtitle}>
        {language === 'ar'
          ? 'اكتشف أفضل العلامات التجارية لقطع غيار السيارات'
          : 'Discover top brands for auto parts'}
      </Text>
    </View>
  ), [colors, language]);

  // Empty component
  const ListEmptyComponent = useCallback(() => (
    <View style={styles.emptyContainer}>
      <Ionicons name="search-outline" size={60} color={colors.textSecondary} />
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        {language === 'ar' ? 'لم يتم العثور على علامات تجارية' : 'No brands found'}
      </Text>
    </View>
  ), [colors, language]);

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header
          title={language === 'ar' ? 'العلامات التجارية' : 'Product Brands'}
          showBack
          showSearch={false}
          showCart
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header
          title={language === 'ar' ? 'العلامات التجارية' : 'Product Brands'}
          showBack
          showSearch={false}
          showCart
        />
        <View style={styles.emptyContainer}>
          <Ionicons name="alert-circle-outline" size={60} color={colors.error} />
          <Text style={[styles.emptyText, { color: colors.error }]}>
            {language === 'ar' ? 'حدث خطأ أثناء تحميل البيانات' : 'Error loading data'}
          </Text>
          <TouchableOpacity
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => refetch()}
          >
            <Text style={styles.retryButtonText}>
              {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <Header
        title={language === 'ar' ? 'العلامات التجارية' : 'Product Brands'}
        showBack
        showSearch={false}
        showCart
      />

      {/* Search & Filter - outside FlashList to prevent keyboard dismissal */}
      <View style={[styles.filterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.searchInputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={language === 'ar' ? 'ابحث عن علامة تجارية...' : 'Search brands...'}
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        {countries.length > 0 && (
          <View style={styles.countryFilterContainer}>
            <Text style={[styles.filterLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'تصفية حسب البلد:' : 'Filter by Country:'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.countryScroll}>
              <TouchableOpacity
                style={[styles.countryChip, { backgroundColor: selectedCountry === null ? colors.primary : colors.surface, borderColor: colors.border }]}
                onPress={() => setSelectedCountry(null)}
              >
                <Text style={[styles.countryChipText, { color: selectedCountry === null ? '#FFF' : colors.text }]}>
                  {language === 'ar' ? 'الكل' : 'All'}
                </Text>
              </TouchableOpacity>
              {countries.map((country) => (
                <TouchableOpacity
                  key={country}
                  style={[styles.countryChip, { backgroundColor: selectedCountry === country ? colors.primary : colors.surface, borderColor: colors.border }]}
                  onPress={() => setSelectedCountry(country)}
                >
                  <Text style={[styles.countryChipText, { color: selectedCountry === country ? '#FFF' : colors.text }]}>
                    {country}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>
      <View style={styles.resultsInfo}>
        <Text style={[styles.resultsText, { color: colors.textSecondary }]}>
          {language === 'ar' ? `عرض ${filteredBrands.length} علامة تجارية` : `Showing ${filteredBrands.length} brands`}
        </Text>
      </View>

      <FlashList
        data={filteredBrands}
        renderItem={renderBrandItem}
        keyExtractor={(item) => item.id}
        estimatedItemSize={94}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContainer}
        onRefresh={refetch}
        refreshing={isRefetching}
      />
      <Footer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  listContainer: {
    paddingBottom: 32,
  },
  pageHeader: {
    padding: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  headerIcon: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  pageTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 9,
  },
  pageSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
  },
  filterCard: {
    marginHorizontal: 17,
    marginTop: 0,
    borderRadius: 12,
    borderWidth: 1.9,
    padding: 15,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.9,
    paddingHorizontal: 13,
    height: 50,
    gap: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },
  countryFilterContainer: {
    marginTop: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 9,
    textAlign: 'center',
  
  },
  countryScroll: {
    flexGrow: 0,
  },
  countryChip: {
    paddingHorizontal: 17,
    paddingVertical: 5,
    borderRadius: 19,
    borderWidth: 1.9,
    marginRight: 10,
  },
  countryChipText: {
    fontSize: 15,
    fontWeight: '500',
  },
  resultsInfo: {
    paddingHorizontal: 10,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsText: {
    fontSize: 15,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 16,
  },
  brandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1.9,
    padding: 13,
    marginBottom: 10,
    marginHorizontal: 13,
  },
  brandLogoContainer: {
    width: 110,
    height: 110,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  brandLogo: {
    width: 110,
    height: 110,
  },
  brandInfo: {
    flex: 1,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 19,
    fontWeight: '600',
    marginBottom: 9,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  countryText: {
    fontSize: 19,
  },
  arrowContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
});

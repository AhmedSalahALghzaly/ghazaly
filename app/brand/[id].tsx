import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../../src/components/Header';
import { Footer } from '../../src/components/Footer';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { carBrandsApi, carModelsApi } from '../../src/services/api';

export default function BrandModelsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [brand, setBrand] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const [brandsRes, modelsRes] = await Promise.all([
        carBrandsApi.getAll(),
        carModelsApi.getAll(id as string),
      ]);
      
      const foundBrand = brandsRes.data.find((b: any) => b.id === id);
      setBrand(foundBrand);
      setModels(modelsRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
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

  const getName = (item: any, field: string = 'name') => {
    if (!item) return '';
    const arField = `${field}_ar`;
    return language === 'ar' && item?.[arField] ? item[arField] : item?.[field] || '';
  };

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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <Header title={getName(brand)} showBack={true} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Brand Header */}
        <View style={[styles.brandHeader, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.brandIconLarge, { backgroundColor: colors.primary + '15' }]}>
            {(brand?.image || brand?.logo) ? (
              <Image 
                source={{ uri: brand.image || brand.logo }} 
                style={styles.brandLogoLarge} 
                contentFit="contain"
                cachePolicy="disk"
                transition={200}
              />
            ) : (
              <Ionicons name="car-sport" size={48} color={colors.primary} />
            )}
          </View>
          <Text style={[styles.brandName, { color: colors.text }]}>
            {getName(brand)}
          </Text>
          <Text style={[styles.modelsCount, { color: colors.textSecondary }]}>
            {models.length} {language === 'ar' ? 'موديل' : 'Models'}
          </Text>
        </View>

        {/* Models List */}
        <View style={styles.modelsSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            {language === 'ar' ? 'موديلات السيارات' : 'Car Models'}
          </Text>
          
          {models.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="car-outline" size={60} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {language === 'ar' ? 'لا توجد موديلات حالياً' : 'No models available'}
              </Text>
            </View>
          ) : (
            models.map((model) => (
              <TouchableOpacity
                key={model.id}
                style={[styles.modelCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/car/${model.id}`)}
              >
                <View style={[styles.modelImageContainer, { backgroundColor: colors.surface }]}>
                  {model.image_url ? (
                    <Image
                      source={{ uri: model.image_url }}
                      style={styles.modelImage}
                      contentFit="cover"
                      cachePolicy="disk"
                      transition={200}
                    />
                  ) : (
                    <Ionicons name="car-sport" size={40} color={colors.textSecondary} />
                  )}
                </View>
                <View style={styles.modelInfo}>
                  <Text style={[styles.modelName, { color: colors.text }]}>
                    {getName(model)}
                  </Text>
                  {model.year_start && model.year_end && (
                    <Text style={[styles.modelYear, { color: colors.textSecondary }]}>
                      {model.year_start} - {model.year_end}
                    </Text>
                  )}
                  {model.variants && model.variants.length > 0 && (
                    <View style={styles.variantsInfo}>
                      <Ionicons name="speedometer-outline" size={14} color={colors.primary} />
                      <Text style={[styles.variantsText, { color: colors.primary }]}>
                        {model.variants.length} {language === 'ar' ? 'فئات' : 'Variants'}
                      </Text>
                    </View>
                  )}
                </View>
                <Ionicons 
                  name={isRTL ? 'chevron-back' : 'chevron-forward'} 
                  size={22} 
                  color={colors.textSecondary} 
                />
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* Search Products Button */}
        <TouchableOpacity
          style={[styles.searchButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push(`/search?car_brand_id=${id}`)}
        >
          <Ionicons name="search" size={20} color="#FFF" />
          <Text style={styles.searchButtonText}>
            {language === 'ar' ? 'البحث عن قطع غيار لهذه الماركة' : 'Search Parts for this Brand'}
          </Text>
        </TouchableOpacity>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 13,
    paddingBottom: 40,
  },
  brandHeader: {
    alignItems: 'center',
    padding: 9,
    borderRadius: 16,
    borderWidth: 1.9,
    marginBottom: 9,
  },
  brandIconLarge: {
    width: 100,
    height: 100,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
    overflow: 'hidden',
  },
  brandLogoLarge: {
    width: '100%',
    height: '100%',
  },
  brandName: {
    fontSize: 30,
    fontWeight: '700',
    marginBottom: 1,
  },
  modelsCount: {
    fontSize: 19,
    fontWeight: '700',
  },
  modelsSection: {
    marginBottom: 9,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 16,
  },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 9,
    borderRadius: 12,
    borderWidth: 1.9,
    marginBottom: 9,
  },
  modelImageContainer: {
    width: 190,
    height: 135,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  modelImage: {
    width: '100%',
    height: '100%',
  },
  modelInfo: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelName: {
    fontSize: 19,
    fontWeight: '700',
    marginBottom: 2,
  },
  modelYear: {
    fontSize: 19,
    marginBottom: 4,
  },
  variantsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  variantsText: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    marginTop: 12,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 17,
    borderRadius: 12,
    gap: 10,
  },
  searchButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '700',
  },
});

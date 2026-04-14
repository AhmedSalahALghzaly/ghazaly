/**
 * Add Entity Form - Unified Screen for Adding/Editing Suppliers and Distributors
 * Accessible via query parameters: entityType ('supplier' | 'distributor'), id (optional for editing)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useAppStore } from '../../src/store/appStore';
import { supplierApi, distributorApi } from '../../src/services/api';
import { ErrorCapsule } from '../../src/components/ui/ErrorCapsule';
import { ConfettiEffect } from '../../src/components/ui/ConfettiEffect';

type EntityType = 'supplier' | 'distributor';

export default function AddEntityFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ entityType: string; id?: string }>();
  const insets = useSafeAreaInsets();
  const language = useAppStore((state) => state.language);
  const productBrands = useAppStore((state) => state.productBrands);
  const carBrands = useAppStore((state) => state.carBrands);
  const suppliers = useAppStore((state) => state.suppliers);
  const distributors = useAppStore((state) => state.distributors);
  const setSuppliers = useAppStore((state) => state.setSuppliers);
  const setDistributors = useAppStore((state) => state.setDistributors);
  const isRTL = language === 'ar';

  const entityType: EntityType = (params.entityType as EntityType) || 'supplier';
  const entityId = params.id;
  const isEditing = !!entityId;

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    phone_numbers: [] as string[],
    contact_email: '',
    address: '',
    address_ar: '',
    website_url: '',
    description: '',
    description_ar: '',
    profile_image: '',
    slider_images: [] as string[],
    linked_brands: [] as string[],
  });

  const [phoneInput, setPhoneInput] = useState('');

  // Use same gradient colors for both entity types (teal/green theme)
  const gradientColors: [string, string, string] = ['#0D9488', '#14B8A6', '#2DD4BF'];
  const primaryColor = '#14B8A6';

  // Get brands based on entity type
  const availableBrands = entityType === 'supplier' ? productBrands : carBrands;

  // Load existing entity data if editing
  useEffect(() => {
    if (isEditing && entityId) {
      loadEntityData();
    }
  }, [entityId, isEditing]);

  const loadEntityData = async () => {
    setLoading(true);
    try {
      // First try to find in local store
      let existingEntity = entityType === 'supplier'
        ? suppliers.find((s: any) => s.id === entityId)
        : distributors.find((d: any) => d.id === entityId);

      // If not found in store, fetch from API directly
      if (!existingEntity) {
        try {
          const api = entityType === 'supplier' ? supplierApi : distributorApi;
          const response = await api.getById(entityId!);
          if (response.data) {
            existingEntity = response.data;
          }
        } catch (apiErr) {
          console.error('Error fetching entity from API:', apiErr);
        }
      }

      if (existingEntity) {
        setFormData({
          name: existingEntity.name || '',
          name_ar: existingEntity.name_ar || '',
          phone_numbers: existingEntity.phone_numbers || (existingEntity.phone ? [existingEntity.phone] : []),
          contact_email: existingEntity.contact_email || '',
          address: existingEntity.address || '',
          address_ar: existingEntity.address_ar || '',
          website_url: existingEntity.website_url || existingEntity.website || '',
          description: existingEntity.description || '',
          description_ar: existingEntity.description_ar || '',
          profile_image: existingEntity.profile_image || '',
          slider_images: existingEntity.slider_images || existingEntity.images || [],
          linked_brands: entityType === 'supplier'
            ? existingEntity.linked_product_brand_ids || existingEntity.linked_brands || []
            : existingEntity.linked_car_brand_ids || existingEntity.linked_brands || [],
        });
      }
    } catch (err) {
      console.error('Error loading entity:', err);
    } finally {
      setLoading(false);
    }
  };

  const addPhoneNumber = () => {
    if (phoneInput.trim()) {
      setFormData(prev => ({
        ...prev,
        phone_numbers: [...prev.phone_numbers, phoneInput.trim()],
      }));
      setPhoneInput('');
    }
  };

  const removePhoneNumber = (index: number) => {
    setFormData(prev => ({
      ...prev,
      phone_numbers: prev.phone_numbers.filter((_, i) => i !== index),
    }));
  };

  // Image picker functions
  const pickProfileImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          isRTL ? 'الإذن مطلوب' : 'Permission Required',
          isRTL ? 'نحتاج إذن الوصول إلى الصور' : 'We need permission to access your photos'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const base64Image = asset.base64 
          ? `data:image/jpeg;base64,${asset.base64}` 
          : asset.uri;
        setFormData(prev => ({ ...prev, profile_image: base64Image }));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      setError(isRTL ? 'فشل في اختيار الصورة' : 'Failed to pick image');
    }
  };

  const addSliderImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          isRTL ? 'الإذن مطلوب' : 'Permission Required',
          isRTL ? 'نحتاج إذن الوصول إلى الصور' : 'We need permission to access your photos'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const base64Image = asset.base64 
          ? `data:image/jpeg;base64,${asset.base64}` 
          : asset.uri;
        setFormData(prev => ({ 
          ...prev, 
          slider_images: [...prev.slider_images, base64Image] 
        }));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.error('Error picking image:', err);
      setError(isRTL ? 'فشل في اختيار الصورة' : 'Failed to pick image');
    }
  };

  const removeSliderImage = (index: number) => {
    setFormData(prev => ({
      ...prev,
      slider_images: prev.slider_images.filter((_, i) => i !== index),
    }));
  };

  const toggleBrandLink = (brandId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormData(prev => ({
      ...prev,
      linked_brands: prev.linked_brands.includes(brandId)
        ? prev.linked_brands.filter(id => id !== brandId)
        : [...prev.linked_brands, brandId],
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setError(isRTL ? 'الاسم مطلوب' : 'Name is required');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const apiPayload = {
        name: formData.name,
        name_ar: formData.name_ar || null,
        phone_numbers: formData.phone_numbers,
        contact_email: formData.contact_email || null,
        address: formData.address || null,
        address_ar: formData.address_ar || null,
        description: formData.description || null,
        description_ar: formData.description_ar || null,
        website_url: formData.website_url || null,
        profile_image: formData.profile_image || null,
        slider_images: formData.slider_images,
        ...(entityType === 'supplier'
          ? { linked_product_brand_ids: formData.linked_brands }
          : { linked_car_brand_ids: formData.linked_brands }),
      };

      if (isEditing && entityId) {
        // Update existing entity
        if (entityType === 'supplier') {
          await supplierApi.update(entityId, apiPayload);
          const updatedSuppliers = suppliers.map((s: any) =>
            s.id === entityId ? { ...s, ...apiPayload } : s
          );
          setSuppliers(updatedSuppliers);
        } else {
          await distributorApi.update(entityId, apiPayload);
          const updatedDistributors = distributors.map((d: any) =>
            d.id === entityId ? { ...d, ...apiPayload } : d
          );
          setDistributors(updatedDistributors);
        }
      } else {
        // Create new entity
        if (entityType === 'supplier') {
          const res = await supplierApi.create(apiPayload);
          setSuppliers([res.data, ...suppliers]);
        } else {
          const res = await distributorApi.create(apiPayload);
          setDistributors([res.data, ...distributors]);
        }
      }

      setShowConfetti(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate back after animation
      setTimeout(() => {
        router.back();
      }, 1200);
    } catch (err: any) {
      console.error('Error saving entity:', err);
      setError(err.response?.data?.detail || (isRTL ? 'فشل في الحفظ' : 'Failed to save'));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FFF" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />
      <ErrorCapsule message={error || ''} visible={!!error} onDismiss={() => setError(null)} />
      <ConfettiEffect active={showConfetti} onComplete={() => setShowConfetti(false)} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={[styles.header, isRTL && styles.headerRTL]}>
            <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {isEditing
                ? (entityType === 'supplier'
                    ? (isRTL ? 'تعديل المورد' : 'Edit Supplier')
                    : (isRTL ? 'تعديل الموزع' : 'Edit Distributor'))
                : (entityType === 'supplier'
                    ? (isRTL ? 'إضافة مورد جديد' : 'Add New Supplier')
                    : (isRTL ? 'إضافة موزع جديد' : 'Add New Distributor'))}
            </Text>
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: primaryColor }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="checkmark" size={24} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>

          {/* Profile Image Section */}
          <View style={styles.profileImageSection}>
            <View style={[styles.profileImageContainer, { borderColor: primaryColor }]}>
              {formData.profile_image ? (
                <TouchableOpacity
                  style={styles.profileImageWrapper}
                  onPress={pickProfileImage}
                  onLongPress={() => setFormData(prev => ({ ...prev, profile_image: '' }))}
                >
                  <Image 
                    source={{ uri: formData.profile_image }} 
                    style={styles.profileImageActual}
                    resizeMode="cover"
                  />
                  <View style={styles.profileImageOverlay}>
                    <Ionicons name="camera" size={24} color="#FFF" />
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.profileImagePlaceholder} onPress={pickProfileImage}>
                  <Ionicons
                    name={entityType === 'supplier' ? 'briefcase' : 'car'}
                    size={50}
                    color={primaryColor}
                  />
                  <Text style={styles.profileImageText}>
                    {isRTL ? 'إضافة صورة' : 'Add Photo'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Slider Images Section */}
          <View style={styles.sliderImagesSection}>
            <Text style={styles.sectionTitle}>
              {isRTL ? 'صور إضافية' : 'Additional Images'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sliderImagesScroll}>
              {formData.slider_images.map((img, index) => (
                <TouchableOpacity 
                  key={index} 
                  style={styles.sliderImageItem}
                  onPress={() => removeSliderImage(index)}
                >
                  <Image source={{ uri: img }} style={styles.sliderImageThumb} />
                  <View style={styles.sliderImageRemove}>
                    <Ionicons name="close-circle" size={20} color="#EF4444" />
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.addSliderImageBtn, { borderColor: primaryColor }]} onPress={addSliderImage}>
                <Ionicons name="add" size={30} color={primaryColor} />
              </TouchableOpacity>
            </ScrollView>
          </View>

          {/* Form Fields */}
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>
              {isRTL ? 'المعلومات الأساسية' : 'Basic Information'}
            </Text>

            <TextInput
              style={[styles.input, isRTL && styles.inputRTL]}
              placeholder={isRTL ? 'الاسم (بالإنجليزية) *' : 'Name (English) *'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.name}
              onChangeText={(text) => setFormData(prev => ({ ...prev, name: text }))}
            />

            <TextInput
              style={[styles.input, styles.inputRTL]}
              placeholder={isRTL ? 'الاسم (بالعربية)' : 'Name (Arabic)'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.name_ar}
              onChangeText={(text) => setFormData(prev => ({ ...prev, name_ar: text }))}
              textAlign="right"
            />

            {/* Phone Numbers */}
            <Text style={styles.fieldLabel}>
              {isRTL ? 'أرقام الهاتف' : 'Phone Numbers'}
            </Text>
            <View style={styles.phoneInputRow}>
              <TextInput
                style={[styles.phoneInput, isRTL && styles.inputRTL]}
                placeholder={isRTL ? 'أضف رقم هاتف' : 'Add phone number'}
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={phoneInput}
                onChangeText={setPhoneInput}
                keyboardType="phone-pad"
              />
              <TouchableOpacity
                style={[styles.addPhoneButton, { backgroundColor: primaryColor }]}
                onPress={addPhoneNumber}
              >
                <Ionicons name="add" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
            {formData.phone_numbers.length > 0 && (
              <View style={styles.phoneList}>
                {formData.phone_numbers.map((phone, index) => (
                  <View key={index} style={styles.phoneItem}>
                    <Text style={styles.phoneText}>{phone}</Text>
                    <TouchableOpacity onPress={() => removePhoneNumber(index)}>
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <TextInput
              style={[styles.input, isRTL && styles.inputRTL]}
              placeholder={isRTL ? 'البريد الإلكتروني' : 'Email'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.contact_email}
              onChangeText={(text) => setFormData(prev => ({ ...prev, contact_email: text }))}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TextInput
              style={[styles.input, isRTL && styles.inputRTL]}
              placeholder={isRTL ? 'العنوان (بالإنجليزية)' : 'Address (English)'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.address}
              onChangeText={(text) => setFormData(prev => ({ ...prev, address: text }))}
            />

            <TextInput
              style={[styles.input, styles.inputRTL]}
              placeholder={isRTL ? 'العنوان (بالعربية)' : 'Address (Arabic)'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.address_ar}
              onChangeText={(text) => setFormData(prev => ({ ...prev, address_ar: text }))}
              textAlign="right"
            />

            <TextInput
              style={[styles.input, isRTL && styles.inputRTL]}
              placeholder={isRTL ? 'رابط الموقع الإلكتروني' : 'Website URL'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.website_url}
              onChangeText={(text) => setFormData(prev => ({ ...prev, website_url: text }))}
              keyboardType="url"
              autoCapitalize="none"
            />

            <TextInput
              style={[styles.input, styles.textArea, isRTL && styles.inputRTL]}
              placeholder={isRTL ? 'الوصف (بالإنجليزية)' : 'Description (English)'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.description}
              onChangeText={(text) => setFormData(prev => ({ ...prev, description: text }))}
              multiline
              numberOfLines={4}
            />

            <TextInput
              style={[styles.input, styles.textArea, styles.inputRTL]}
              placeholder={isRTL ? 'الوصف (بالعربية)' : 'Description (Arabic)'}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={formData.description_ar}
              onChangeText={(text) => setFormData(prev => ({ ...prev, description_ar: text }))}
              multiline
              numberOfLines={4}
              textAlign="right"
            />
          </View>

          {/* Brand Linkage Section */}
          <View style={styles.brandLinkSection}>
            <Text style={styles.sectionTitle}>
              {entityType === 'supplier'
                ? (isRTL ? 'ربط العلامات التجارية للمنتجات' : 'Link Product Brands')
                : (isRTL ? 'ربط ماركات السيارات' : 'Link Car Brands')}
            </Text>
            <Text style={styles.sectionSubtitle}>
              {entityType === 'supplier'
                ? (isRTL ? 'اختر العلامات التجارية للمنتجات التي يوفرها هذا المورد' : 'Select product brands supplied by this supplier')
                : (isRTL ? 'اختر ماركات السيارات التي يوزعها هذا الموزع' : 'Select car brands distributed by this distributor')}
            </Text>

            <View style={styles.brandGrid}>
              {availableBrands.length === 0 ? (
                <Text style={styles.noBrandsText}>
                  {entityType === 'supplier'
                    ? (isRTL ? 'لا توجد علامات تجارية للمنتجات' : 'No product brands available')
                    : (isRTL ? 'لا توجد ماركات سيارات' : 'No car brands available')}
                </Text>
              ) : (
                availableBrands.map((brand: any) => (
                  <TouchableOpacity
                    key={brand.id}
                    style={[
                      styles.brandSelectItem,
                      formData.linked_brands.includes(brand.id) && [
                        styles.brandSelectActive,
                        { borderColor: primaryColor, backgroundColor: primaryColor + '30' },
                      ],
                    ]}
                    onPress={() => toggleBrandLink(brand.id)}
                  >
                    <Text style={styles.brandSelectText}>
                      {isRTL && brand.name_ar ? brand.name_ar : brand.name}
                    </Text>
                    {formData.linked_brands.includes(brand.id) && (
                      <Ionicons name="checkmark-circle" size={16} color={primaryColor} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>

          {/* Bottom Padding */}
          <View style={{ height: insets.bottom + 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  headerRTL: {
    flexDirection: 'row-reverse',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
  },
  saveButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileImageSection: {
    alignItems: 'center',
    marginVertical: 20,
  },
  profileImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    overflow: 'hidden',
  },
  profileImageWrapper: {
    width: '100%',
    height: '100%',
  },
  profileImagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  profileImageText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 6,
  },
  formCard: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
    marginTop: 12,
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFF',
    marginBottom: 12,
  },
  inputRTL: {
    textAlign: 'right',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  phoneInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#FFF',
  },
  addPhoneButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  phoneItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 8,
  },
  phoneText: {
    fontSize: 14,
    color: '#FFF',
  },
  brandLinkSection: {
    marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: 16,
  },
  brandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  brandSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  brandSelectActive: {
    borderWidth: 1.5,
  },
  brandSelectText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '500',
  },
  noBrandsText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic',
  },
  // New styles for image picker
  profileImageActual: {
    width: '100%',
    height: '100%',
  },
  profileImageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    paddingVertical: 6,
  },
  sliderImagesSection: {
    marginBottom: 20,
  },
  sliderImagesScroll: {
    marginTop: 8,
  },
  sliderImageItem: {
    width: 80,
    height: 60,
    marginRight: 10,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  sliderImageThumb: {
    width: '100%',
    height: '100%',
  },
  sliderImageRemove: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FFF',
    borderRadius: 10,
  },
  addSliderImageBtn: {
    width: 80,
    height: 60,
    borderRadius: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
});

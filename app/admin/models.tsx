/**
 * Car Models Admin - Refactored with standalone form component
 * Fixes TextInput focus loss by extracting form outside FlashList
 */
import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { carBrandsApi, carModelsApi } from '../../src/services/api';
import { useAdminSync } from '../../src/services/adminSyncService';
import { Header } from '../../src/components/Header';
import { Toast } from '../../src/components/ui/FormFeedback';
import { ImageUploader } from '../../src/components/ui/ImageUploader';
import { queryKeys } from '../../src/lib/queryClient';
import { useConfirmModal } from '../../src/components/ConfirmModal';
import { FuelTypeSelector, FuelTypeIcon, type FuelType } from '../../src/components/ui/FuelTypeSelector';

// Types
interface CarModel {
  id: string;
  name: string;
  name_ar: string;
  brand_id: string;
  year_start?: number;
  year_end?: number;
  chassis_number?: string;
  image_url?: string;
  catalog_pdf?: string;
  fuel_type?: string;
}

interface CarBrand {
  id: string;
  name: string;
  name_ar: string;
  logo?: string;
}

interface FormState {
  name: string;
  nameAr: string;
  selectedBrandId: string;
  yearFrom: string;
  yearTo: string;
  chassisNumber: string;
  images: string[];
  catalogPdf: string | null;
  catalogPdfName: string;
  isEditMode: boolean;
  editingModel: CarModel | null;
  searchQuery: string;
  fuelType: string;
}

interface FormHandlers {
  setName: (v: string) => void;
  setNameAr: (v: string) => void;
  setSelectedBrandId: (v: string) => void;
  setYearFrom: (v: string) => void;
  setYearTo: (v: string) => void;
  setChassisNumber: (v: string) => void;
  setImages: (v: string[]) => void;
  setCatalogPdf: (v: string | null) => void;
  setCatalogPdfName: (v: string) => void;
  handleSave: () => void;
  resetForm: () => void;
  setSearchQuery: (v: string) => void;
  pickCatalogPdf: () => void;
  setFuelType: (v: string) => void;
}

interface FormHeaderProps {
  formState: FormState;
  handlers: FormHandlers;
  colors: any;
  language: string;
  isRTL: boolean;
  isSaving: boolean;
  modelsCount: number;
  brands: CarBrand[];
  router: any;
}

// ============================================================================
// Standalone Form Header Component - OUTSIDE main component to prevent re-mounting
// ============================================================================
const ModelFormHeader = memo(({
  formState,
  handlers,
  colors,
  language,
  isRTL,
  isSaving,
  modelsCount,
  brands,
  router,
}: FormHeaderProps) => {
  const {
    name, nameAr, selectedBrandId, yearFrom, yearTo, chassisNumber,
    images, catalogPdfName, isEditMode, searchQuery, fuelType,
  } = formState;
  const {
    setName, setNameAr, setSelectedBrandId, setYearFrom, setYearTo,
    setChassisNumber, setImages, setCatalogPdf, setCatalogPdfName,
    handleSave, resetForm, setSearchQuery, pickCatalogPdf, setFuelType,
  } = handlers;

  return (
    <View style={styles.listHeaderContainer}>
      {/* Breadcrumb */}
      <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
        <TouchableOpacity onPress={() => router.push('/admin')}>
          <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
            {language === 'ar' ? 'لوحة التحكم' : 'Admin'}
          </Text>
        </TouchableOpacity>
        <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.textSecondary} />
        <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
          {language === 'ar' ? 'الموديلات' : 'Models'}
        </Text>
      </View>

      {/* Add/Edit Form */}
      <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: isEditMode ? colors.primary : colors.border }]}>
        <View style={styles.formTitleRow}>
          <Text style={[styles.formTitle, { color: isEditMode ? colors.primary : colors.text }]}>
            {isEditMode 
              ? (language === 'ar' ? 'تعديل الموديل' : 'Edit Model')
              : (language === 'ar' ? 'إضافة موديل جديد' : 'Add New Model')
            }
          </Text>
          {isEditMode && (
            <TouchableOpacity
              style={[styles.cancelEditBtn, { backgroundColor: colors.error + '20' }]}
              onPress={resetForm}
            >
              <Ionicons name="close" size={18} color={colors.error} />
              <Text style={[styles.cancelEditText, { color: colors.error }]}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Model Images Upload - Using ImageUploader Component */}
        <ImageUploader
          mode="multiple"
          value={images}
          onChange={(newImages) => setImages(newImages as string[])}
          maxImages={15}
          aspectRatio={[16, 9]}
          size="medium"
          label={language === 'ar' ? 'صور الموديل' : 'Model Images'}
          hint={language === 'ar' ? 'يمكنك إضافة حتى 15 صورة للموديل' : 'You can add up to 15 images for the model'}
        />

        {/* Brand Selector */}
        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'اختر الماركة *' : 'Select Brand *'}
          </Text>
          <View style={styles.brandSelectorWrapper}>
            {brands.map((brand) => (
              <TouchableOpacity
                key={brand.id}
                style={[
                  styles.brandChip,
                  { backgroundColor: selectedBrandId === brand.id ? colors.primary : colors.surface, borderColor: colors.border }
                ]}
                onPress={() => setSelectedBrandId(brand.id)}
              >
                <Text style={{ color: selectedBrandId === brand.id ? '#FFF' : colors.text }}>
                  {language === 'ar' ? brand.name_ar : brand.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Name Fields */}
        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'الاسم (بالإنجليزية) *' : 'Name (English) *'}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={name}
            onChangeText={setName}
            placeholder={language === 'ar' ? 'مثال: Camry' : 'e.g., Camry'}
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'الاسم (بالعربية) *' : 'Name (Arabic) *'}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }, isRTL && styles.inputRTL]}
            value={nameAr}
            onChangeText={setNameAr}
            placeholder={language === 'ar' ? 'مثال: كامري' : 'e.g., كامري'}
            placeholderTextColor={colors.textSecondary}
          />
        </View>

        {/* Year Range */}
        <View style={styles.row}>
          <View style={[styles.formGroup, { flex: 1 }]}>
            <Text style={[styles.label, { color: colors.text }]}>
              {language === 'ar' ? 'من سنة' : 'Year From'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={yearFrom}
              onChangeText={setYearFrom}
              placeholder="2020"
              keyboardType="numeric"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
          <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
            <Text style={[styles.label, { color: colors.text }]}>
              {language === 'ar' ? 'إلى سنة' : 'Year To'}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              value={yearTo}
              onChangeText={setYearTo}
              placeholder="2024"
              keyboardType="numeric"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>

        {/* Chassis Number */}
        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'رقم الشاسيه (VIN)' : 'Chassis Number (VIN)'}
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            value={chassisNumber}
            onChangeText={setChassisNumber}
            placeholder={language === 'ar' ? 'مثال: JTDKN3DU5A0...' : 'e.g., JTDKN3DU5A0...'}
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="characters"
          />
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'رقم الهيكل للبحث المباشر' : 'Vehicle Identification Number for direct search'}
          </Text>
        </View>

        {/* Catalog PDF Upload */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: colors.text }]}>
            {language === 'ar' ? 'كتالوج الموديل (PDF)' : 'Model Catalog (PDF)'}
          </Text>
          <TouchableOpacity
            style={[styles.catalogUploadButton, { backgroundColor: '#FFD70015', borderColor: '#FFD70050' }]}
            onPress={pickCatalogPdf}
          >
            <View style={styles.catalogUploadContent}>
              <View style={styles.catalogIconContainer}>
                <Ionicons name="document-text" size={24} color="#FFD700" />
              </View>
              <View style={styles.catalogTextContainer}>
                {catalogPdfName ? (
                  <>
                    <Text style={[styles.catalogFileName, { color: colors.text }]} numberOfLines={1}>
                      {catalogPdfName}
                    </Text>
                    <Text style={styles.catalogSelectedText}>
                      {language === 'ar' ? 'تم اختيار الملف' : 'File selected'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.catalogUploadText}>
                      {language === 'ar' ? 'اضغط لاختيار ملف PDF' : 'Tap to select PDF file'}
                    </Text>
                    <Text style={[styles.catalogHelperText, { color: colors.textSecondary }]}>
                      {language === 'ar' ? 'للمشتركين فقط' : 'For subscribers only'}
                    </Text>
                  </>
                )}
              </View>
              {catalogPdfName && (
                <TouchableOpacity 
                  style={styles.catalogRemoveButton}
                  onPress={() => {
                    setCatalogPdf(null);
                    setCatalogPdfName('');
                  }}
                >
                  <Ionicons name="close-circle" size={22} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* Fuel Type Selector */}
        <View style={styles.formGroup}>
          <Text style={[styles.label, { color: colors.text }]}>
            {language === 'ar' ? 'نوع الوقود' : 'Fuel Type'}
          </Text>
          <FuelTypeSelector
            selected={fuelType as FuelType}
            onSelect={(type) => setFuelType(type)}
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name={isEditMode ? "create" : "save"} size={20} color="#FFF" />
              <Text style={styles.saveButtonText}>
                {isEditMode 
                  ? (language === 'ar' ? 'تحديث' : 'Update')
                  : (language === 'ar' ? 'حفظ' : 'Save')
                }
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* List Header with Search */}
      <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.listTitle, { color: colors.text }]}>
          {language === 'ar' ? 'الموديلات الحالية' : 'Existing Models'} ({modelsCount})
        </Text>

        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={language === 'ar' ? 'ابحث بالاسم أو الماركة...' : 'Search by name or brand...'}
            placeholderTextColor={colors.textSecondary}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
});

ModelFormHeader.displayName = 'ModelFormHeader';

// ============================================================================
// Memoized Model List Item Component
// ============================================================================
const ModelListItem = memo(({
  model,
  brandName,
  colors,
  onEdit,
  onDelete,
}: {
  model: CarModel;
  brandName: string;
  colors: any;
  onEdit: (model: CarModel) => void;
  onDelete: (id: string) => void;
}) => (
  <View style={[styles.listItem, { borderColor: colors.border }]}>
    <View style={{ position: 'relative' }}>
      {model.image_url ? (
        <Image source={{ uri: model.image_url }} style={styles.modelThumb} />
      ) : (
        <View style={[styles.modelIcon, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="layers" size={24} color={colors.primary} />
        </View>
      )}
      {model.fuel_type && <FuelTypeIcon type={model.fuel_type} size={19} />}
    </View>
    <View style={styles.modelInfo}>
      <Text style={[styles.modelName, { color: colors.text }]}>{model.name}</Text>
      <Text style={[styles.modelNameAr, { color: colors.textSecondary }]}>{model.name_ar}</Text>
      <Text style={[styles.modelMeta, { color: colors.textSecondary }]}>
        {brandName} {model.year_start && model.year_end ? `(${model.year_start}-${model.year_end})` : ''}
      </Text>
    </View>
    <View style={styles.actionButtons}>
      <TouchableOpacity
        style={[styles.editButton, { backgroundColor: colors.primary + '20' }]}
        onPress={() => onEdit(model)}
      >
        <Ionicons name="create" size={18} color={colors.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.deleteButton, { backgroundColor: colors.error + '20' }]}
        onPress={() => onDelete(model.id)}
      >
        <Ionicons name="trash" size={18} color={colors.error} />
      </TouchableOpacity>
    </View>
  </View>
));

ModelListItem.displayName = 'ModelListItem';

// ============================================================================
// Main Component
// ============================================================================
export default function ModelsAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const router = useRouter();
  const queryClient = useQueryClient();
  const adminSync = useAdminSync();
  const insets = useSafeAreaInsets();

  // Form state
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [chassisNumber, setChassisNumber] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [catalogPdf, setCatalogPdf] = useState<string | null>(null);
  const [catalogPdfName, setCatalogPdfName] = useState('');
  const [editingModel, setEditingModel] = useState<CarModel | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [fuelType, setFuelType] = useState('petrol');

  // Toast state
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');

  // TanStack Query: Fetch Brands
  const { data: brandsData } = useQuery({
    queryKey: queryKeys.carBrands.all,
    queryFn: async () => {
      const response = await carBrandsApi.getAll();
      return response.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const brands: CarBrand[] = brandsData || [];

  // TanStack Query: Fetch Models
  const {
    data: modelsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: queryKeys.carModels.all,
    queryFn: async () => {
      const response = await carModelsApi.getAll();
      return response.data || [];
    },
    staleTime: 2 * 60 * 1000,
  });

  const models: CarModel[] = modelsData || [];

  // Pre-compute brand name map
  const brandNameMap = useMemo(() => {
    const map: Record<string, { name: string; name_ar: string }> = {};
    brands.forEach(brand => {
      map[brand.id] = { name: brand.name, name_ar: brand.name_ar };
    });
    return map;
  }, [brands]);

  const getBrandName = useCallback((brandId: string) => {
    const brand = brandNameMap[brandId];
    if (!brand) return '';
    return language === 'ar' ? brand.name_ar : brand.name;
  }, [brandNameMap, language]);

  // Filter models
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return models;
    const query = searchQuery.toLowerCase();
    return models.filter((model) => {
      const modelName = (model.name || '').toLowerCase();
      const modelNameAr = (model.name_ar || '').toLowerCase();
      const brandName = getBrandName(model.brand_id).toLowerCase();
      return modelName.includes(query) || modelNameAr.includes(query) || brandName.includes(query);
    });
  }, [models, searchQuery, getBrandName]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: any) => adminSync.createCarModel(data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.carModels.all });
        showToast(language === 'ar' ? 'تم إضافة الموديل بنجاح' : 'Model created successfully', 'success');
        resetForm();
      } else {
        showToast(result.error || 'Failed to create model', 'error');
      }
    },
    onError: (error: any) => showToast(error.message || 'Failed to create model', 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => adminSync.updateCarModel(id, data),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: queryKeys.carModels.all });
        showToast(language === 'ar' ? 'تم تحديث الموديل بنجاح' : 'Model updated successfully', 'success');
        resetForm();
      } else {
        showToast(result.error || 'Failed to update model', 'error');
      }
    },
    onError: (error: any) => showToast(error.message || 'Failed to update model', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => adminSync.deleteCarModel(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.carModels.all });
      const previousModels = queryClient.getQueryData(queryKeys.carModels.all);
      queryClient.setQueryData(queryKeys.carModels.all, (old: CarModel[] | undefined) =>
        old ? old.filter(m => m.id !== deletedId) : []
      );
      return { previousModels };
    },
    onSuccess: (result) => {
      if (result.success) {
        showToast(language === 'ar' ? 'تم حذف الموديل بنجاح' : 'Model deleted successfully', 'success');
      } else {
        showToast(result.error || 'Failed to delete model', 'error');
        queryClient.invalidateQueries({ queryKey: queryKeys.carModels.all });
      }
    },
    onError: (error, variables, context) => {
      if (context?.previousModels) queryClient.setQueryData(queryKeys.carModels.all, context.previousModels);
      showToast(language === 'ar' ? 'فشل في حذف الموديل' : 'Failed to delete model', 'error');
    },
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
  }, []);

  const pickCatalogPdf = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const file = result.assets[0];
        setCatalogPdfName(file.name || 'catalog.pdf');
        
        try {
          const base64 = await FileSystem.readAsStringAsync(file.uri, {
            encoding: 'base64',
          });
          setCatalogPdf(`data:application/pdf;base64,${base64}`);
          showToast(language === 'ar' ? 'تم اختيار الكتالوج بنجاح' : 'Catalog selected successfully', 'success');
        } catch (readError) {
          console.error('Error reading PDF:', readError);
          setCatalogPdf(file.uri);
          showToast(language === 'ar' ? 'تم اختيار الكتالوج' : 'Catalog selected', 'success');
        }
      }
    } catch (error) {
      console.error('Error picking PDF:', error);
      showToast(language === 'ar' ? 'فشل اختيار الملف' : 'Failed to select file', 'error');
    }
  }, [language, showToast]);

  const resetForm = useCallback(() => {
    setName(''); setNameAr(''); setSelectedBrandId(''); setYearFrom(''); setYearTo('');
    setChassisNumber(''); setImages([]); setCatalogPdf(null);
    setCatalogPdfName(''); setIsEditMode(false); setEditingModel(null); setFuelType('petrol');
  }, []);

  const handleEditModel = useCallback((model: CarModel) => {
    setName(model.name || ''); setNameAr(model.name_ar || '');
    setSelectedBrandId(model.brand_id || ''); setYearFrom(model.year_start?.toString() || '');
    setYearTo(model.year_end?.toString() || ''); setChassisNumber(model.chassis_number || '');
    let modelImages: string[] = [];
    if ((model as any).images && (model as any).images.length > 0) {
      modelImages = (model as any).images;
    } else if (model.image_url) {
      modelImages = [model.image_url];
    }
    setImages(modelImages);
    setCatalogPdf(model.catalog_pdf || null); setCatalogPdfName(model.catalog_pdf ? 'catalog.pdf' : '');
    setFuelType(model.fuel_type || 'petrol');
    setEditingModel(model); setIsEditMode(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedBrandId || !name.trim() || !nameAr.trim()) {
      showToast(language === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة' : 'Please fill all required fields', 'error');
      return;
    }
    const modelData = {
      name: name.trim(), name_ar: nameAr.trim(), brand_id: selectedBrandId,
      year_start: yearFrom ? parseInt(yearFrom) : null, year_end: yearTo ? parseInt(yearTo) : null,
      chassis_number: chassisNumber.trim() || null, 
      image_url: images.length > 0 ? images[0] : null,
      images: images,
      catalog_pdf: catalogPdf || null,
      fuel_type: fuelType || 'petrol',
    };
    if (isEditMode && editingModel) updateMutation.mutate({ id: editingModel.id, data: modelData });
    else createMutation.mutate(modelData);
  }, [selectedBrandId, name, nameAr, yearFrom, yearTo, chassisNumber, images, catalogPdf, isEditMode, editingModel, language, showToast, createMutation, updateMutation]);

  const handleDelete = useCallback((id: string) => {
    showConfirm({
      title: language === 'ar' ? 'حذف الموديل' : 'Delete Model',
      message: language === 'ar' ? 'هل أنت متأكد من حذف هذا الموديل؟' : 'Are you sure you want to delete this model?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: () => deleteMutation.mutate(id),
    });
  }, [deleteMutation, showConfirm, language]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const formState: FormState = useMemo(() => ({
    name, nameAr, selectedBrandId, yearFrom, yearTo, chassisNumber,
    images, catalogPdf, catalogPdfName, isEditMode, editingModel, searchQuery, fuelType,
  }), [name, nameAr, selectedBrandId, yearFrom, yearTo, chassisNumber, images, catalogPdf, catalogPdfName, isEditMode, editingModel, searchQuery, fuelType]);

  const formHandlers: FormHandlers = useMemo(() => ({
    setName, setNameAr, setSelectedBrandId, setYearFrom, setYearTo, setChassisNumber,
    setImages, setCatalogPdf, setCatalogPdfName, handleSave, resetForm,
    setSearchQuery, pickCatalogPdf, setFuelType,
  }), [handleSave, resetForm, pickCatalogPdf]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={language === 'ar' ? 'الموديلات' : 'Models'} showBack showSearch={false} showCart={false} />

      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {/* Form Section - OUTSIDE list to prevent focus loss */}
        <View style={styles.formSection}>
          <ModelFormHeader
            formState={formState}
            handlers={formHandlers}
            colors={colors}
            language={language}
            isRTL={isRTL}
            isSaving={isSaving}
            modelsCount={filteredModels.length}
            brands={brands}
            router={router}
          />
        </View>

        {/* Models List Section - Using map() since form is outside */}
        <View style={styles.modelsListContainer}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : filteredModels.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="layers-outline" size={48} color={colors.textSecondary} />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {searchQuery ? (language === 'ar' ? 'لا توجد نتائج' : 'No results found') : (language === 'ar' ? 'لا توجد موديلات' : 'No models found')}
              </Text>
            </View>
          ) : (
            <View>
              {filteredModels.map((model: CarModel) => (
                <ModelListItem
                  key={model.id}
                  model={model}
                  brandName={getBrandName(model.brand_id)}
                  colors={colors}
                  onEdit={handleEditModel}
                  onDelete={handleDelete}
                />
              ))}
            </View>
          )}
        </View>
        
        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>
      
      <Toast visible={toastVisible} message={toastMessage} type={toastType} onDismiss={() => setToastVisible(false)} />
      {ConfirmModalNode}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mainScrollView: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 16 },
  formSection: { paddingTop: 16 },
  modelsListContainer: { flex: 1 },
  loadingContainer: { padding: 40, alignItems: 'center' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  listHeaderContainer: {},
  breadcrumb: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 },
  breadcrumbRTL: { flexDirection: 'row-reverse' },
  breadcrumbText: { fontSize: 14 },
  formCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  formTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  formTitle: { fontSize: 18, fontWeight: '700' },
  cancelEditBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, gap: 4 },
  cancelEditText: { fontSize: 14, fontWeight: '600' },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
  inputRTL: { textAlign: 'right' },
  row: { flexDirection: 'row' },
  imageUploadSection: { alignItems: 'center', marginBottom: 12 },
  uploadBtn: { width: '100%', height: 100, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  uploadBtnText: { fontSize: 12, marginTop: 4, fontWeight: '500' },
  imagePreviewContainer: { position: 'relative', width: '100%' },
  modelImagePreview: { width: '100%', height: 120, borderRadius: 12 },
  removeImageBtn: { position: 'absolute', top: -8, right: -8 },
  urlInputSection: { marginTop: 8 },
  orText: { fontSize: 12, textAlign: 'center', marginBottom: 8 },
  brandSelectorWrapper: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  brandChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  helperText: { fontSize: 12, marginTop: 4 },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 8, gap: 8 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  listCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 8 },
  listTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.9, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  emptyText: { textAlign: 'center', marginTop: 12, fontSize: 15 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1 },
  modelIcon: { width: 100, height: 100, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modelThumb: { width: 190, height: 115, },
  modelInfo: { flex: 1, marginLeft: 15 },
  modelName: { fontSize: 16, fontWeight: '600',textAlign: 'center' },
  modelNameAr: { fontSize: 17, marginTop: 2 ,textAlign: 'center'},
  modelMeta: { fontSize: 15, marginTop: 4,textAlign: 'center' },
  actionButtons: { flexDirection: 'column', gap: 8 },
  editButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  deleteButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  catalogUploadButton: { borderWidth: 2, borderStyle: 'dashed', borderRadius: 12, padding: 16, marginTop: 8 },
  catalogUploadContent: { flexDirection: 'row', alignItems: 'center' },
  catalogIconContainer: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFD70020', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  catalogTextContainer: { flex: 1 },
  catalogUploadText: { fontSize: 15, fontWeight: '600', color: '#FFD700' },
  catalogHelperText: { fontSize: 12, marginTop: 2 },
  catalogFileName: { fontSize: 14, fontWeight: '600' },
  catalogSelectedText: { fontSize: 12, color: '#10B981', marginTop: 2 },
  catalogRemoveButton: { padding: 4 },
});

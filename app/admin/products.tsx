import React, {
  useState,
  useMemo,
  useCallback,
  memo,
  useEffect,
  useRef,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Image,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "../../src/hooks/useTheme";
import { useTranslation } from "../../src/hooks/useTranslation";
import { useAdminSync } from "../../src/services/adminSyncService";
import { Header } from "../../src/components/Header";
import { ImageUploader } from "../../src/components/ui/ImageUploader";
import { Toast } from "../../src/components/ui/FormFeedback";
import {
  useAdminProductsListQuery,
  useProductMetadataQuery,
  useAdminProductMutations,
} from "../../src/hooks/queries";

// ============================================================================
// Types
// ============================================================================
interface FormState {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  price: string;
  sku: string;
  stockQuantity: string;
  selectedBrandId: string;
  selectedCategoryId: string;
  selectedCarModelIds: string[];
  images: string[];
  brandSearchQuery: string;
  categorySearchQuery: string;
  carModelSearchQuery: string;
  searchQuery: string;
  isEditMode: boolean;
  editingProduct: any;
  error: string;
  saving: boolean;
  showSuccess: boolean;
}

interface FormHandlers {
  setName: (v: string) => void;
  setNameAr: (v: string) => void;
  setDescription: (v: string) => void;
  setDescriptionAr: (v: string) => void;
  setPrice: (v: string) => void;
  setSku: (v: string) => void;
  setStockQuantity: (v: string) => void;
  setSelectedBrandId: (v: string) => void;
  setSelectedCategoryId: (v: string) => void;
  setSelectedCarModelIds: (v: string[]) => void;
  setImages: (v: string[]) => void;
  setBrandSearchQuery: (v: string) => void;
  setCategorySearchQuery: (v: string) => void;
  setCarModelSearchQuery: (v: string) => void;
  setSearchQuery: (v: string) => void;
  toggleCarModel: (id: string) => void;
  handleSave: () => void;
  resetForm: () => void;
}

interface Lookups {
  productBrands: any[];
  categories: any[];
  carModels: any[];
  brandMap: Record<string, any>;
  categoryMap: Record<string, any>;
  carModelMap: Record<string, any>;
}

interface ProductFormHeaderProps {
  formState: FormState;
  handlers: FormHandlers;
  lookups: Lookups;
  colors: any;
  language: string;
  isRTL: boolean;
  productsCount: number;
  router: any;
}

// ============================================================================
// Standalone Product Form Header Component - OUTSIDE main component
// This prevents re-mounting when form state changes
// ============================================================================
const ProductFormHeader = memo(
  ({
    formState,
    handlers,
    lookups,
    colors,
    language,
    isRTL,
    productsCount,
    router,
  }: ProductFormHeaderProps) => {
    const {
      name,
      nameAr,
      description,
      descriptionAr,
      price,
      sku,
      stockQuantity,
      selectedBrandId,
      selectedCategoryId,
      selectedCarModelIds,
      images,
      brandSearchQuery,
      categorySearchQuery,
      carModelSearchQuery,
      searchQuery,
      isEditMode,
      error,
      saving,
      showSuccess,
    } = formState;

    const {
      setName,
      setNameAr,
      setDescription,
      setDescriptionAr,
      setPrice,
      setSku,
      setStockQuantity,
      setSelectedBrandId,
      setSelectedCategoryId,
      setImages,
      setBrandSearchQuery,
      setCategorySearchQuery,
      setCarModelSearchQuery,
      setSearchQuery,
      toggleCarModel,
      handleSave,
      resetForm,
    } = handlers;

    const { productBrands, categories, carModels, brandMap } = lookups;

    const getSelectedBrandName = () => {
      if (!selectedBrandId) return null;
      const brand = brandMap[selectedBrandId];
      return language === "ar" ? brand?.name_ar : brand?.name;
    };

    return (
      <View style={styles.listHeaderContainer}>
        {/* Breadcrumb */}
        <View style={[styles.breadcrumb, isRTL && styles.breadcrumbRTL]}>
          <TouchableOpacity onPress={() => router.push("/admin")}>
            <Text style={[styles.breadcrumbText, { color: colors.primary }]}>
              {language === "ar" ? "لوحة التحكم" : "Admin"}
            </Text>
          </TouchableOpacity>
          <Ionicons
            name={isRTL ? "chevron-back" : "chevron-forward"}
            size={16}
            color={colors.textSecondary}
          />
          <Text
            style={[styles.breadcrumbText, { color: colors.textSecondary }]}
          >
            {language === "ar" ? "المنتجات" : "Products"}
          </Text>
        </View>

        {/* Add/Edit Form */}
        <View
          style={[
            styles.formCard,
            {
              backgroundColor: colors.card,
              borderColor: isEditMode ? colors.primary : colors.border,
            },
          ]}
        >
          <View style={styles.formTitleRow}>
            <Text
              style={[
                styles.formTitle,
                { color: isEditMode ? colors.primary : colors.text },
              ]}
            >
              {isEditMode
                ? language === "ar"
                  ? "تعديل المنتج"
                  : "Edit Product"
                : language === "ar"
                  ? "إضافة منتج جديد"
                  : "Add New Product"}
            </Text>
            {isEditMode && (
              <TouchableOpacity
                style={[
                  styles.cancelEditBtn,
                  { backgroundColor: colors.error + "20" },
                ]}
                onPress={resetForm}
              >
                <Ionicons name="close" size={18} color={colors.error} />
                <Text style={[styles.cancelEditText, { color: colors.error }]}>
                  {language === "ar" ? "إلغاء" : "Cancel"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Section 1: Basic Product Information */}
          <View
            style={[styles.formSectionInner, { borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              <Ionicons name="information-circle" size={14} />{" "}
              {language === "ar" ? "المعلومات الأساسية" : "Basic Information"}
            </Text>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "اسم المنتج (بالإنجليزية) *"
                  : "Product Name (English) *"}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={name}
                onChangeText={setName}
                placeholder={
                  language === "ar" ? "مثال: Oil Filter" : "e.g., Oil Filter"
                }
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "اسم المنتج (بالعربية) *"
                  : "Product Name (Arabic) *"}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                  isRTL && styles.inputRTL,
                ]}
                value={nameAr}
                onChangeText={setNameAr}
                placeholder={
                  language === "ar" ? "مثال: فلتر زيت" : "e.g., فلتر زيت"
                }
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "الوصف (بالإنجليزية)"
                  : "Description (English)"}
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                value={description}
                onChangeText={setDescription}
                placeholder={
                  language === "ar"
                    ? "وصف تفصيلي للمنتج..."
                    : "Detailed product description..."
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={[styles.label, { color: colors.text }]}>
                {language === "ar"
                  ? "الوصف (بالعربية)"
                  : "Description (Arabic)"}
              </Text>
              <TextInput
                style={[
                  styles.textArea,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                  isRTL && styles.inputRTL,
                ]}
                value={descriptionAr}
                onChangeText={setDescriptionAr}
                placeholder={
                  language === "ar"
                    ? "وصف تفصيلي بالعربية..."
                    : "Arabic description..."
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.text }]}>
                  SKU *
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={sku}
                  onChangeText={setSku}
                  placeholder="ABC-123"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "السعر *" : "Price *"}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1, marginLeft: 12 }]}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "الكمية" : "Stock"}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                  value={stockQuantity}
                  onChangeText={setStockQuantity}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>
          </View>

          {/* Section 2: Product Relationships */}
          <View
            style={[styles.formSectionInner, { borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              <Ionicons name="link" size={14} />{" "}
              {language === "ar"
                ? "التصنيفات والعلاقات"
                : "Classifications & Relations"}
            </Text>

            {/* Product Brand Selection */}
            <View style={styles.formGroup}>
              <View style={styles.labelWithSearch}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "ماركة المنتج *" : "Product Brand *"}
                </Text>
                <View
                  style={[
                    styles.miniSearchContainer,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.miniSearchInput, { color: colors.text }]}
                    value={brandSearchQuery}
                    onChangeText={setBrandSearchQuery}
                    placeholder={language === "ar" ? "بحث..." : "Search..."}
                    placeholderTextColor={colors.textSecondary}
                  />
                  {brandSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setBrandSearchQuery("")}>
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {language === "ar"
                  ? "اختر الماركة المصنعة للمنتج"
                  : "Select the product manufacturer brand"}
              </Text>

              {selectedBrandId && (
                <View
                  style={[
                    styles.selectedDisplay,
                    {
                      backgroundColor: colors.primary + "15",
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  {brandMap[selectedBrandId]?.logo && (
                    <Image
                      source={{ uri: brandMap[selectedBrandId]?.logo }}
                      style={styles.selectedBrandLogo}
                    />
                  )}
                  <Ionicons name="pricetag" size={16} color={colors.primary} />
                  <Text
                    style={[styles.selectedText, { color: colors.primary }]}
                  >
                    {getSelectedBrandName()}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handlers.setSelectedBrandId("")}
                  >
                    <Ionicons
                      name="close-circle"
                      size={18}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                </View>
              )}

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsContainer}
              >
                {productBrands
                  .filter((brand) => {
                    if (!brandSearchQuery.trim()) return true;
                    const query = brandSearchQuery.toLowerCase();
                    return (
                      (brand.name || "").toLowerCase().includes(query) ||
                      (brand.name_ar || "").toLowerCase().includes(query)
                    );
                  })
                  .map((brand) => (
                    <TouchableOpacity
                      key={brand.id}
                      style={[
                        styles.brandChip,
                        {
                          backgroundColor:
                            selectedBrandId === brand.id
                              ? colors.primary
                              : colors.surface,
                          borderColor:
                            selectedBrandId === brand.id
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedBrandId(brand.id)}
                    >
                      {brand.logo ? (
                        <Image
                          source={{ uri: brand.logo }}
                          style={[
                            styles.brandChipLogo,
                            {
                              borderColor:
                                selectedBrandId === brand.id
                                  ? "rgba(255,255,255,0.3)"
                                  : colors.border,
                            },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.brandChipPlaceholder,
                            { backgroundColor: colors.border },
                          ]}
                        >
                          <Ionicons
                            name="pricetag"
                            size={14}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                      {selectedBrandId === brand.id && (
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color="#FFF"
                          style={{ marginLeft: 4 }}
                        />
                      )}
                      <Text
                        style={{
                          color:
                            selectedBrandId === brand.id ? "#FFF" : colors.text,
                          fontSize: 12,
                          fontWeight: "500",
                        }}
                      >
                        {language === "ar" ? brand.name_ar : brand.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>

            {/* Category Selection */}
            <View style={styles.formGroup}>
              <View style={styles.labelWithSearch}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar" ? "الفئة *" : "Category *"}
                </Text>
                <View
                  style={[
                    styles.miniSearchContainer,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.miniSearchInput, { color: colors.text }]}
                    value={categorySearchQuery}
                    onChangeText={setCategorySearchQuery}
                    placeholder={language === "ar" ? "بحث..." : "Search..."}
                    placeholderTextColor={colors.textSecondary}
                  />
                  {categorySearchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setCategorySearchQuery("")}
                    >
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {language === "ar"
                  ? "اختر فئة المنتج"
                  : "Select product category"}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsContainer}
              >
                {categories
                  .filter((cat) => {
                    if (!categorySearchQuery.trim()) return true;
                    const query = categorySearchQuery.toLowerCase();
                    return (
                      (cat.name || "").toLowerCase().includes(query) ||
                      (cat.name_ar || "").toLowerCase().includes(query)
                    );
                  })
                  .map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor:
                            selectedCategoryId === cat.id
                              ? colors.primary
                              : colors.surface,
                          borderColor:
                            selectedCategoryId === cat.id
                              ? colors.primary
                              : colors.border,
                        },
                      ]}
                      onPress={() => setSelectedCategoryId(cat.id)}
                    >
                      {cat.image_data || cat.icon ? (
                        <Image
                          source={{ uri: cat.image_data || cat.icon }}
                          style={[
                            styles.categoryChipImage,
                            {
                              borderColor:
                                selectedCategoryId === cat.id
                                  ? "rgba(255,255,255,0.3)"
                                  : colors.border,
                            },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.categoryChipPlaceholder,
                            { backgroundColor: colors.border },
                          ]}
                        >
                          <Ionicons
                            name="grid"
                            size={14}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                      {selectedCategoryId === cat.id && (
                        <Ionicons
                          name="checkmark"
                          size={14}
                          color="#FFF"
                          style={{ marginLeft: 2 }}
                        />
                      )}
                      <Text
                        style={{
                          color:
                            selectedCategoryId === cat.id
                              ? "#FFF"
                              : colors.text,
                          fontSize: 13,
                          fontWeight: "500",
                        }}
                      >
                        {language === "ar" ? cat.name_ar : cat.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>

            {/* Car Models Selection */}
            <View style={styles.formGroup}>
              <View style={styles.labelWithSearch}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {language === "ar"
                    ? "موديلات السيارات المتوافقة"
                    : "Compatible Car Models"}
                </Text>
                <View
                  style={[
                    styles.miniSearchContainer,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name="search"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    style={[styles.miniSearchInput, { color: colors.text }]}
                    value={carModelSearchQuery}
                    onChangeText={setCarModelSearchQuery}
                    placeholder={language === "ar" ? "بحث..." : "Search..."}
                    placeholderTextColor={colors.textSecondary}
                  />
                  {carModelSearchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setCarModelSearchQuery("")}
                    >
                      <Ionicons
                        name="close-circle"
                        size={14}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
                {language === "ar"
                  ? "اختر موديلات السيارات المتوافقة"
                  : "Select compatible car models"}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsContainer}
              >
                {carModels
                  .filter((model) => {
                    if (!carModelSearchQuery.trim()) return true;
                    const query = carModelSearchQuery.toLowerCase();
                    return (
                      (model.name || "").toLowerCase().includes(query) ||
                      (model.name_ar || "").toLowerCase().includes(query)
                    );
                  })
                  .map((model) => {
                    const isSelected = selectedCarModelIds.includes(model.id);
                    const yearRange =
                      model.year_start && model.year_end
                        ? `${model.year_start} - ${model.year_end}`
                        : model.year_start
                          ? `${model.year_start}+`
                          : null;

                    return (
                      <TouchableOpacity
                        key={model.id}
                        style={[
                          styles.carModelChip,
                          {
                            backgroundColor: isSelected
                              ? "#10b981"
                              : colors.surface,
                            borderColor: isSelected ? "#10b981" : colors.border,
                          },
                        ]}
                        onPress={() => toggleCarModel(model.id)}
                      >
                        {model.image_url ? (
                          <Image
                            source={{ uri: model.image_url }}
                            style={[
                              styles.carModelChipImage,
                              {
                                borderColor: isSelected
                                  ? "rgba(255,255,255,0.3)"
                                  : colors.border,
                              },
                            ]}
                          />
                        ) : (
                          <View
                            style={[
                              styles.carModelChipPlaceholder,
                              { backgroundColor: colors.border },
                            ]}
                          >
                            <Ionicons
                              name="car"
                              size={16}
                              color={colors.textSecondary}
                            />
                          </View>
                        )}
                        <View style={styles.carModelChipTextContainer}>
                          <View style={styles.carModelNameRow}>
                            {isSelected && (
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color="#FFF"
                                style={{ marginRight: 4 }}
                              />
                            )}
                            <Text
                              style={{
                                color: isSelected ? "#FFF" : colors.text,
                                fontSize: 13,
                                fontWeight: "500",
                              }}
                              numberOfLines={1}
                            >
                              {language === "ar" ? model.name_ar : model.name}
                            </Text>
                          </View>
                          {yearRange && (
                            <Text
                              style={[
                                styles.carModelYearText,
                                {
                                  color: isSelected
                                    ? "rgba(255,255,255,0.75)"
                                    : colors.textSecondary,
                                },
                              ]}
                            >
                              {yearRange}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
              {selectedCarModelIds.length > 0 && (
                <Text style={[styles.selectedCount, { color: colors.primary }]}>
                  {language === "ar"
                    ? `تم اختيار ${selectedCarModelIds.length} موديل`
                    : `${selectedCarModelIds.length} models selected`}
                </Text>
              )}
            </View>
          </View>

          {/* Section 3: Product Images */}
          <View
            style={[styles.formSectionInner, { borderColor: colors.border }]}
          >
            <Text style={[styles.sectionLabel, { color: colors.primary }]}>
              <Ionicons name="images" size={14} />{" "}
              {language === "ar" ? "صور المنتج" : "Product Images"}
            </Text>

            <ImageUploader
              mode="multiple"
              value={images}
              onChange={(newImages) => setImages(newImages as string[])}
              maxImages={15}
              size="medium"
              label={language === "ar" ? "صور المنتج" : "Product Images"}
              hint={
                language === "ar"
                  ? "يمكنك إضافة حتى 15 صورة"
                  : "You can add up to 15 images"
              }
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[
              styles.saveButton,
              { backgroundColor: showSuccess ? "#10b981" : colors.primary },
            ]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : showSuccess ? (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                <Text style={styles.saveButtonText}>
                  {language === "ar" ? "تم الحفظ بنجاح" : "Saved Successfully"}
                </Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={isEditMode ? "create" : "save"}
                  size={20}
                  color="#FFF"
                />
                <Text style={styles.saveButtonText}>
                  {isEditMode
                    ? language === "ar"
                      ? "تحديث المنتج"
                      : "Update Product"
                    : language === "ar"
                      ? "حفظ المنتج"
                      : "Save Product"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Existing Products List Header */}
        <View
          style={[
            styles.listCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.listTitle, { color: colors.text }]}>
            {language === "ar" ? "المنتجات الحالية" : "Existing Products"} (
            {productsCount})
          </Text>

          {/* Search Bar */}
          <View
            style={[
              styles.searchContainer,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search" size={20} color={colors.textSecondary} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder={
                language === "ar"
                  ? "ابحث بالاسم أو رمز SKU..."
                  : "Search by name or SKU..."
              }
              placeholderTextColor={colors.textSecondary}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  },
);

ProductFormHeader.displayName = "ProductFormHeader";

// ============================================================================
// Memoized Product Item Component
// ============================================================================
interface ProductItemProps {
  product: any;
  colors: any;
  language: string;
  brandName: string;
  categoryName: string;
  carModelNames: string;
  quantityValue: string;
  isUpdatingQuantity: boolean;
  onQuantityChange: (value: string) => void;
  onUpdateQuantity: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const ProductItem = memo(
  ({
    product,
    colors,
    language,
    brandName,
    categoryName,
    carModelNames,
    quantityValue,
    isUpdatingQuantity,
    onQuantityChange,
    onUpdateQuantity,
    onEdit,
    onDelete,
  }: ProductItemProps) => (
    <View style={[styles.productCard, { borderColor: colors.border }]}>
      <View style={styles.productHeader}>
        {product.image_url || (product.images && product.images.length > 0) ? (
          <Image
            source={{ uri: product.images?.[0] || product.image_url }}
            style={styles.productImage}
          />
        ) : (
          <View
            style={[
              styles.productImagePlaceholder,
              { backgroundColor: colors.surface },
            ]}
          >
            <Ionicons name="cube" size={24} color={colors.textSecondary} />
          </View>
        )}
        <View style={styles.productMainInfo}>
          <Text
            style={[styles.productName, { color: colors.text }]}
            numberOfLines={1}
          >
            {language === "ar" ? product.name_ar : product.name}
          </Text>
          <Text style={[styles.productSku, { color: colors.textSecondary }]}>
            SKU: {product.sku}
          </Text>
          <Text style={[styles.productPrice, { color: colors.primary }]}>
            {parseFloat(String(product.price || 0)).toFixed(2)} ج.م
          </Text>
        </View>

        <View style={styles.actionButtonsContainer}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.error + "20" },
            ]}
            onPress={onDelete}
          >
            <Ionicons name="trash" size={18} color={colors.error} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: colors.primary + "20" },
            ]}
            onPress={onEdit}
          >
            <Ionicons name="create" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.productMeta, { backgroundColor: colors.surface }]}>
        <View style={styles.metaRow}>
          <Ionicons name="pricetag" size={12} color={colors.textSecondary} />
          <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
            {language === "ar" ? "الماركة:" : "Brand:"}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>
            {brandName || "-"}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="grid" size={12} color={colors.textSecondary} />
          <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
            {language === "ar" ? "الفئة:" : "Category:"}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]}>
            {categoryName || "-"}
          </Text>
        </View>
        {product.car_model_ids?.length > 0 && (
          <View style={styles.metaRow}>
            <Ionicons name="car" size={12} color={colors.textSecondary} />
            <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
              {language === "ar" ? "الموديلات:" : "Models:"}
            </Text>
            <Text
              style={[styles.metaValue, { color: colors.text }]}
              numberOfLines={1}
            >
              {carModelNames}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.quantitySection}>
        <View style={[styles.currentQuantity, { backgroundColor: "#10b981" }]}>
          <Ionicons name="cube" size={14} color="#FFF" />
          <Text style={styles.currentQuantityText}>
            {product.stock_quantity || product.stock || 0}
          </Text>
        </View>
        <TextInput
          style={[
            styles.quantityInput,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              color: colors.text,
            },
          ]}
          value={quantityValue}
          onChangeText={onQuantityChange}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={colors.textSecondary}
        />
        <TouchableOpacity
          style={[styles.updateQuantityBtn, { backgroundColor: "#f59e0b" }]}
          onPress={onUpdateQuantity}
          disabled={isUpdatingQuantity}
        >
          {isUpdatingQuantity ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Ionicons name="checkmark" size={16} color="#FFF" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  ),
);

ProductItem.displayName = "ProductItem";

// ============================================================================
// Main Component
// ============================================================================
export default function ProductsAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const adminSync = useAdminSync();

  // React Query hooks
  const {
    data: products = [],
    isLoading: loading,
    isRefetching: refreshing,
    refetch,
  } = useAdminProductsListQuery();
  const { data: metadata, isLoading: metadataLoading } =
    useProductMetadataQuery();
  const {
    updateQuantity: updateQuantityMutation,
    deleteProduct: deleteProductMutation,
  } = useAdminProductMutations();

  // Metadata
  const productBrands = useMemo(
    () => metadata?.productBrands || [],
    [metadata],
  );
  const categories = useMemo(() => metadata?.categories || [], [metadata]);
  const carModels = useMemo(() => metadata?.carModels || [], [metadata]);

  // Form state
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedCarModelIds, setSelectedCarModelIds] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [brandSearchQuery, setBrandSearchQuery] = useState("");
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [carModelSearchQuery, setCarModelSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // UI state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [productToDelete, setProductToDelete] = useState<any>(null);
  const [deleting, setDeleting] = useState(false);
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>(
    {},
  );
  const [updatingQuantityId, setUpdatingQuantityId] = useState<string | null>(
    null,
  );
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<
    "success" | "error" | "warning" | "info"
  >("success");

  // Lookup maps
  const brandMap = useMemo(() => {
    const map: Record<string, any> = {};
    productBrands.forEach((b: any) => {
      map[b.id] = b;
    });
    return map;
  }, [productBrands]);

  const categoryMap = useMemo(() => {
    const map: Record<string, any> = {};
    categories.forEach((c: any) => {
      map[c.id] = c;
    });
    return map;
  }, [categories]);

  const carModelMap = useMemo(() => {
    const map: Record<string, any> = {};
    carModels.forEach((m: any) => {
      map[m.id] = m;
    });
    return map;
  }, [carModels]);

  // Initialize quantity inputs
  const quantityInputsInitialized = useRef(false);
  useEffect(() => {
    if (products.length > 0 && !quantityInputsInitialized.current) {
      const quantities: Record<string, string> = {};
      products.forEach((p: any) => {
        quantities[p.id] = (p.stock_quantity || p.stock || 0).toString();
      });
      setQuantityInputs(quantities);
      quantityInputsInitialized.current = true;
    }
  }, [products]);

  useEffect(() => {
    if (products.length === 0) quantityInputsInitialized.current = false;
  }, [products.length]);

  // Handlers
  const showToast = useCallback(
    (message: string, type: "success" | "error" | "warning" | "info") => {
      setToastMessage(message);
      setToastType(type);
      setToastVisible(true);
    },
    [],
  );

  const resetForm = useCallback(() => {
    setName("");
    setNameAr("");
    setDescription("");
    setDescriptionAr("");
    setPrice("");
    setSku("");
    setStockQuantity("0");
    setImages([]);
    setSelectedBrandId("");
    setSelectedCategoryId("");
    setSelectedCarModelIds([]);
    setIsEditMode(false);
    setEditingProduct(null);
    setError("");
  }, []);

  const handleSave = useCallback(async () => {
    if (
      !name.trim() ||
      !nameAr.trim() ||
      !price ||
      !sku ||
      !selectedBrandId ||
      !selectedCategoryId
    ) {
      setError(
        language === "ar"
          ? "يرجى ملء جميع الحقول المطلوبة"
          : "Please fill all required fields",
      );
      return;
    }

    setSaving(true);
    setError("");

    const productData = {
      name: name.trim(),
      name_ar: nameAr.trim(),
      description: description.trim() || null,
      description_ar: descriptionAr.trim() || null,
      price: parseFloat(price),
      sku: sku.trim(),
      image_url: images.length > 0 ? images[0] : null,
      images,
      product_brand_id: selectedBrandId,
      category_id: selectedCategoryId,
      car_model_ids: selectedCarModelIds,
      stock_quantity: parseInt(stockQuantity) || 0,
    };

    try {
      let result;
      if (isEditMode && editingProduct) {
        result = await adminSync.updateProduct(editingProduct.id, productData);
        if (result.success)
          showToast(
            language === "ar"
              ? "تم تحديث المنتج بنجاح"
              : "Product updated successfully",
            "success",
          );
        else {
          setError(result.error || "Failed to update product");
          showToast(result.error || "Failed", "error");
        }
      } else {
        result = await adminSync.createProduct(productData);
        if (result.success)
          showToast(
            language === "ar"
              ? "تم إضافة المنتج بنجاح"
              : "Product created successfully",
            "success",
          );
        else {
          setError(result.error || "Failed to create product");
          showToast(result.error || "Failed", "error");
        }
      }

      if (result.success) {
        setShowSuccess(true);
        resetForm();
        await refetch();
        setTimeout(() => setShowSuccess(false), 2000);
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || "Error saving product");
      showToast("Operation failed", "error");
    } finally {
      setSaving(false);
    }
  }, [
    name,
    nameAr,
    description,
    descriptionAr,
    price,
    sku,
    stockQuantity,
    images,
    selectedBrandId,
    selectedCategoryId,
    selectedCarModelIds,
    isEditMode,
    editingProduct,
    language,
    adminSync,
    refetch,
    resetForm,
    showToast,
  ]);

  const handleEditProduct = useCallback((product: any) => {
    setName(product.name || "");
    setNameAr(product.name_ar || "");
    setDescription(product.description || "");
    setDescriptionAr(product.description_ar || "");
    setPrice(product.price?.toString() || "");
    setSku(product.sku || "");
    setStockQuantity((product.stock_quantity || product.stock || 0).toString());
    setImages(product.images || (product.image_url ? [product.image_url] : []));
    setSelectedBrandId(product.product_brand_id || "");
    setSelectedCategoryId(product.category_id || "");
    setSelectedCarModelIds(product.car_model_ids || []);
    setEditingProduct(product);
    setIsEditMode(true);
    setError("");
  }, []);

  const toggleCarModel = useCallback((modelId: string) => {
    setSelectedCarModelIds((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId],
    );
  }, []);

  const handleQuantityInputChange = useCallback(
    (productId: string, value: string) => {
      setQuantityInputs((prev) => ({ ...prev, [productId]: value }));
    },
    [],
  );

  const handleUpdateQuantity = useCallback(
    async (productId: string) => {
      const newQuantity = parseInt(quantityInputs[productId]) || 0;
      setUpdatingQuantityId(productId);
      try {
        await updateQuantityMutation.mutateAsync({
          productId,
          quantity: newQuantity,
        });
        showToast(
          language === "ar" ? "تم تحديث الكمية" : "Quantity updated",
          "success",
        );
      } catch {
        showToast(language === "ar" ? "فشل تحديث الكمية" : "Failed", "error");
      } finally {
        setUpdatingQuantityId(null);
      }
    },
    [quantityInputs, updateQuantityMutation, language, showToast],
  );

  const openDeleteConfirm = useCallback((product: any) => {
    setProductToDelete(product);
    setShowDeleteModal(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!productToDelete) return;
    setDeleting(true);
    try {
      const result = await deleteProductMutation.mutateAsync(
        productToDelete.id,
      );
      if (result.success)
        showToast(
          language === "ar" ? "تم حذف المنتج بنجاح" : "Deleted successfully",
          "success",
        );
      else showToast(result.error || "Failed", "error");
      setShowDeleteModal(false);
      setProductToDelete(null);
    } catch {
      showToast("Error deleting product", "error");
    } finally {
      setDeleting(false);
    }
  }, [productToDelete, deleteProductMutation, language, showToast]);

  // Filtered products
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const query = searchQuery.toLowerCase();
    return (products as any[]).filter(
      (p: any) =>
        (p.name || "").toLowerCase().includes(query) ||
        (p.name_ar || "").toLowerCase().includes(query) ||
        (p.sku || "").toLowerCase().includes(query),
    );
  }, [products, searchQuery]);

  // Products with display data
  const productsWithDisplayData = useMemo(
    () =>
      (filteredProducts as any[]).map((product: any) => ({
        ...product,
        _brandName: brandMap[product.product_brand_id]
          ? language === "ar"
            ? brandMap[product.product_brand_id].name_ar
            : brandMap[product.product_brand_id].name
          : "",
        _categoryName: categoryMap[product.category_id]
          ? language === "ar"
            ? categoryMap[product.category_id].name_ar
            : categoryMap[product.category_id].name
          : "",
        _carModelNames: (product.car_model_ids || [])
          .map((id: string) =>
            carModelMap[id]
              ? language === "ar"
                ? carModelMap[id].name_ar
                : carModelMap[id].name
              : "",
          )
          .filter(Boolean)
          .join(", "),
      })),
    [filteredProducts, brandMap, categoryMap, carModelMap, language],
  );

  // Form state object for header
  const formState: FormState = useMemo(
    () => ({
      name,
      nameAr,
      description,
      descriptionAr,
      price,
      sku,
      stockQuantity,
      selectedBrandId,
      selectedCategoryId,
      selectedCarModelIds,
      images,
      brandSearchQuery,
      categorySearchQuery,
      carModelSearchQuery,
      searchQuery,
      isEditMode,
      editingProduct,
      error,
      saving,
      showSuccess,
    }),
    [
      name,
      nameAr,
      description,
      descriptionAr,
      price,
      sku,
      stockQuantity,
      selectedBrandId,
      selectedCategoryId,
      selectedCarModelIds,
      images,
      brandSearchQuery,
      categorySearchQuery,
      carModelSearchQuery,
      searchQuery,
      isEditMode,
      editingProduct,
      error,
      saving,
      showSuccess,
    ],
  );

  // Form handlers object for header
  const formHandlers: FormHandlers = useMemo(
    () => ({
      setName,
      setNameAr,
      setDescription,
      setDescriptionAr,
      setPrice,
      setSku,
      setStockQuantity,
      setSelectedBrandId,
      setSelectedCategoryId,
      setSelectedCarModelIds,
      setImages,
      setBrandSearchQuery,
      setCategorySearchQuery,
      setCarModelSearchQuery,
      setSearchQuery,
      toggleCarModel,
      handleSave,
      resetForm,
    }),
    [toggleCarModel, handleSave, resetForm],
  );

  // Lookups object for header
  const lookups: Lookups = useMemo(
    () => ({
      productBrands,
      categories,
      carModels,
      brandMap,
      categoryMap,
      carModelMap,
    }),
    [productBrands, categories, carModels, brandMap, categoryMap, carModelMap],
  );

  // Use refs to hold latest values - this keeps the callback stable while still having access to fresh data
  const formStateRef = useRef(formState);
  const formHandlersRef = useRef(formHandlers);
  const lookupsRef = useRef(lookups);
  const colorsRef = useRef(colors);
  const languageRef = useRef(language);
  const isRTLRef = useRef(isRTL);
  const productsCountRef = useRef(products.length);
  const routerRef = useRef(router);

  // Update refs when values change
  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);
  useEffect(() => {
    formHandlersRef.current = formHandlers;
  }, [formHandlers]);
  useEffect(() => {
    lookupsRef.current = lookups;
  }, [lookups]);
  useEffect(() => {
    colorsRef.current = colors;
  }, [colors]);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  useEffect(() => {
    isRTLRef.current = isRTL;
  }, [isRTL]);
  useEffect(() => {
    productsCountRef.current = products.length;
  }, [products.length]);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Render product item
  const renderProductItem = useCallback(
    ({ item: product }: { item: any }) => (
      <ProductItem
        product={product}
        colors={colors}
        language={language}
        brandName={product._brandName}
        categoryName={product._categoryName}
        carModelNames={product._carModelNames}
        quantityValue={quantityInputs[product.id] || "0"}
        isUpdatingQuantity={updatingQuantityId === product.id}
        onQuantityChange={(value) =>
          handleQuantityInputChange(product.id, value)
        }
        onUpdateQuantity={() => handleUpdateQuantity(product.id)}
        onEdit={() => handleEditProduct(product)}
        onDelete={() => openDeleteConfirm(product)}
      />
    ),
    [
      colors,
      language,
      quantityInputs,
      updatingQuantityId,
      handleQuantityInputChange,
      handleUpdateQuantity,
      handleEditProduct,
      openDeleteConfirm,
    ],
  );

  // Header component - uses refs for stable callback identity while accessing fresh values
  // CRITICAL: This prevents FlashList from remounting the header on every keystroke
  const ListHeaderComponent = useCallback(
    () => (
      <ProductFormHeader
        formState={formStateRef.current}
        handlers={formHandlersRef.current}
        lookups={lookupsRef.current}
        colors={colorsRef.current}
        language={languageRef.current}
        isRTL={isRTLRef.current}
        productsCount={productsCountRef.current}
        router={routerRef.current}
      />
    ),
    [],
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["bottom"]}
    >
      <Header
        title={language === "ar" ? "المنتجات" : "Products"}
        showBack
        showSearch={false}
        showCart={false}
      />

      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        {/* Form Section - OUTSIDE FlashList to prevent focus loss */}
        <View style={styles.formSection}>
          <ProductFormHeader
            formState={formState}
            handlers={formHandlers}
            lookups={lookups}
            colors={colors}
            language={language}
            isRTL={isRTL}
            productsCount={products.length}
            router={router}
          />
        </View>

        {/* Products List Section - Using map() since FlashList doesn't work inside ScrollView */}
        <View style={styles.productsListContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : productsWithDisplayData.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons
                name="cube-outline"
                size={48}
                color={colors.textSecondary}
              />
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {language === "ar" ? "لا توجد منتجات" : "No products found"}
              </Text>
            </View>
          ) : (
            <View>
              {productsWithDisplayData.map((product: any) => (
                <ProductItem
                  key={product.id}
                  product={product}
                  colors={colors}
                  language={language}
                  brandName={product._brandName}
                  categoryName={product._categoryName}
                  carModelNames={product._carModelNames}
                  quantityValue={quantityInputs[product.id] || "0"}
                  isUpdatingQuantity={updatingQuantityId === product.id}
                  onQuantityChange={(value) =>
                    handleQuantityInputChange(product.id, value)
                  }
                  onUpdateQuantity={() => handleUpdateQuantity(product.id)}
                  onEdit={() => handleEditProduct(product)}
                  onDelete={() => openDeleteConfirm(product)}
                />
              ))}
            </View>
          )}
        </View>

        <View style={{ height: insets.bottom + 40 }} />
      </ScrollView>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.deleteConfirmModal,
              { backgroundColor: colors.card },
            ]}
          >
            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => {
                setShowDeleteModal(false);
                setProductToDelete(null);
              }}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
            <View
              style={[
                styles.deleteIconCircle,
                { backgroundColor: "#ef4444" + "20" },
              ]}
            >
              <Ionicons name="trash" size={36} color="#ef4444" />
            </View>
            <Text style={[styles.deleteConfirmText, { color: colors.text }]}>
              {language === "ar"
                ? "هل أنت متأكد من حذف هذا المنتج؟"
                : "Are you sure you want to delete this product?"}
            </Text>
            {productToDelete && (
              <Text
                style={[
                  styles.deleteProductName,
                  { color: colors.textSecondary },
                ]}
              >
                {language === "ar"
                  ? productToDelete.name_ar
                  : productToDelete.name}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.confirmDeleteBtn, { backgroundColor: "#ef4444" }]}
              onPress={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="trash" size={18} color="#FFF" />
                  <Text style={styles.confirmDeleteBtnText}>
                    {language === "ar" ? "حذف" : "Delete"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Toast
        visible={toastVisible}
        message={toastMessage}
        type={toastType}
        onDismiss={() => setToastVisible(false)}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// Styles
// ============================================================================
const styles = StyleSheet.create({
  container: { flex: 1 },
  mainScrollView: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 16 },
  formSection: { paddingTop: 16 },
  listHeaderContainer: { paddingHorizontal: 16, paddingVertical: 8 },
  productsListContainer: { flex: 1 },
  loadingContainer: { padding: 40, alignItems: "center" },
  emptyContainer: { padding: 40, alignItems: "center" },
  breadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  breadcrumbRTL: { flexDirection: "row-reverse" },
  breadcrumbText: { fontSize: 14 },
  formCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  formTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  formTitle: { fontSize: 20, fontWeight: "700" },
  cancelEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  cancelEditText: { fontSize: 14, fontWeight: "600" },
  formSectionInner: {
    borderBottomWidth: 1,
    paddingBottom: 20,
    marginBottom: 20,
  },
  sectionLabel: { fontSize: 14, fontWeight: "700", marginBottom: 16 },
  formGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  fieldHint: { fontSize: 12, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
  inputRTL: { textAlign: "right" },
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: "top",
  },
  row: { flexDirection: "row" },
  selectedDisplay: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
    gap: 8,
  },
  selectedText: { flex: 1, fontSize: 14, fontWeight: "600" },
  selectedBrandLogo: { width: 24, height: 24, borderRadius: 12 },
  chipsContainer: { flexDirection: "row", marginTop: 4 },
  brandChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 8,
    gap: 6,
  },
  brandChipLogo: { width: 28, height: 28, borderRadius: 6, borderWidth: 1 },
  brandChipPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedCount: { fontSize: 12, marginTop: 8, fontWeight: "500" },
  labelWithSearch: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
    flexWrap: "wrap",
    gap: 8,
  },
  miniSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    minWidth: 100,
    maxWidth: 150,
  },
  miniSearchInput: { flex: 1, fontSize: 12, paddingVertical: 2 },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 8,
    gap: 6,
  },
  categoryChipImage: { width: 26, height: 26, borderRadius: 6, borderWidth: 1 },
  categoryChipPlaceholder: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  carModelChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 10,
    marginBottom: 8,
    gap: 8,
    minWidth: 120,
  },
  carModelChipImage: { width: 36, height: 36, borderRadius: 8, borderWidth: 1 },
  carModelChipPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  carModelChipTextContainer: { flexDirection: "column", flex: 1 },
  carModelNameRow: { flexDirection: "row", alignItems: "center" },
  carModelYearText: { fontSize: 10, marginTop: 2, fontWeight: "400" },
  errorText: { color: "#ef4444", fontSize: 14, marginBottom: 12 },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  saveButtonText: { color: "#FFF", fontSize: 16, fontWeight: "700" },
  listCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 8 },
  listTitle: { fontSize: 18, fontWeight: "700", marginBottom: 16 },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  emptyText: { textAlign: "center", marginTop: 12, fontSize: 15 },
  productCard: { borderBottomWidth: 1, paddingVertical: 12 },
  productHeader: { flexDirection: "row", alignItems: "center" },
  productImage: { width: 56, height: 56, borderRadius: 10 },
  productImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  productMainInfo: { flex: 1, marginLeft: 12 },
  productName: { fontSize: 15, fontWeight: "600" },
  productSku: { fontSize: 12, marginTop: 2 },
  productPrice: { fontSize: 14, fontWeight: "700", marginTop: 2 },
  actionButtonsContainer: { flexDirection: "column", gap: 8 },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  productMeta: { marginTop: 10, padding: 10, borderRadius: 8 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    gap: 6,
  },
  metaLabel: { fontSize: 12 },
  metaValue: { fontSize: 12, fontWeight: "500", flex: 1 },
  quantitySection: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 10,
  },
  currentQuantity: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  currentQuantityText: { color: "#FFF", fontSize: 14, fontWeight: "700" },
  quantityInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: "center",
  },
  updateQuantityBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  deleteConfirmModal: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    position: "relative",
  },
  modalCloseBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  deleteConfirmText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  deleteProductName: { fontSize: 14, textAlign: "center", marginBottom: 20 },
  confirmDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
    minWidth: 120,
  },
  confirmDeleteBtnText: { color: "#FFF", fontSize: 16, fontWeight: "600" },
});

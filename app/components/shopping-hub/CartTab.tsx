/**
 * CartTab - Shopping cart display and management tab
 * REDESIGNED: Larger product cards with SKU and compatible car models
 * ENHANCED: Real-time deletion with confirmation modal and haptic feedback
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image, RefreshControl, Modal } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { EmptyState } from '../ui/EmptyState';
import { useTheme } from '../../hooks/useTheme';
import { useTranslation } from '../../hooks/useTranslation';
import { NEON_NIGHT_THEME } from '../../store/appStore';

const SHIPPING_COST = 150;

interface CartTabProps {
  cartItems: any[];
  isRTL: boolean;
  getSubtotal: () => number;
  getOriginalTotal: () => number;
  getTotalSavings: () => number;
  getItemCount: () => number;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

// Delete Confirmation Modal Component
const DeleteConfirmationModal: React.FC<{
  visible: boolean;
  productName: string;
  isRTL: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ visible, productName, isRTL, onCancel, onConfirm }) => {
  const { colors } = useTheme();
  const { language } = useTranslation();

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onCancel}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Warning Icon */}
          <View style={[styles.modalIconContainer, { backgroundColor: '#EF4444' + '15' }]}>
            <Ionicons name="trash-outline" size={32} color="#EF4444" />
          </View>

          {/* Title */}
          <Text style={[styles.modalTitle, { color: colors.text }]}>
            {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Removal'}
          </Text>

          {/* Message */}
          <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
            {language === 'ar' 
              ? `هل أنت متأكد من حذف "${productName}" من السلة؟`
              : `Are you sure you want to remove "${productName}" from your cart?`}
          </Text>

          {/* Buttons */}
          <View style={[styles.modalButtons, isRTL && styles.rowReverse]}>
            <Pressable
              style={[styles.modalButton, styles.cancelButton, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.cancelButtonText, { color: colors.text }]}>
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </Text>
            </Pressable>

            <Pressable
              style={[styles.modalButton, styles.deleteButton]}
              onPress={onConfirm}
            >
              <Ionicons name="trash" size={18} color="#FFF" />
              <Text style={styles.deleteButtonText}>
                {language === 'ar' ? 'حذف' : 'Remove'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export const CartTab: React.FC<CartTabProps> = ({
  cartItems,
  isRTL,
  getSubtotal,
  getOriginalTotal,
  getTotalSavings,
  getItemCount,
  onUpdateQuantity,
  onRemove,
  onCheckout,
  onRefresh,
  refreshing = false,
}) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();

  // State for delete confirmation modal
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ productId: string; productName: string } | null>(null);

  const safeCartItems = useMemo(() => 
    Array.isArray(cartItems) ? cartItems : [], 
    [cartItems]
  );

  // Format compatible car models for display - check multiple sources
  const formatCarModels = useCallback((product: any, item: any) => {
    // Check for pre-populated car models array
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
    
    // Check for car_model_ids count
    const carModelIds = product?.car_model_ids || item?.car_model_ids;
    if (carModelIds && Array.isArray(carModelIds) && carModelIds.length > 0) {
      return language === 'ar' 
        ? `${carModelIds.length} موديل متوافق` 
        : `${carModelIds.length} compatible models`;
    }
    
    return null;
  }, [language]);

  // Handle delete button press - show modal with haptic feedback
  const handleDeletePress = useCallback((productId: string, productName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setItemToDelete({ productId, productName });
    setDeleteModalVisible(true);
  }, []);

  // Handle delete confirmation
  const handleConfirmDelete = useCallback(async () => {
    if (itemToDelete) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDeleteModalVisible(false);
      // Call the removal function
      await onRemove(itemToDelete.productId);
      setItemToDelete(null);
    }
  }, [itemToDelete, onRemove]);

  // Handle cancel delete
  const handleCancelDelete = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDeleteModalVisible(false);
    setItemToDelete(null);
  }, []);

  // Handle quantity update with haptic feedback
  const handleQuantityUpdate = useCallback((productId: string, newQuantity: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onUpdateQuantity(productId, newQuantity);
  }, [onUpdateQuantity]);

  // Render professional cart item card - INCREASED HEIGHT
  const renderCartItem = useCallback(({ item }: { item: any }) => {
    const product = item.product ? { ...item, ...item.product } : item;
    const originalPrice = parseFloat(String(item.original_unit_price ?? product.price ?? 0)) || 0;
    const finalPrice = parseFloat(String(item.final_unit_price ?? product.price ?? 0)) || 0;
    const hasDiscount = originalPrice > finalPrice && originalPrice > 0;
    const lineTotal = finalPrice * item.quantity;
    const carModelsDisplay = formatCarModels(product, item);
    const sku = product.sku || item.sku || 'N/A';
    const productName = language === 'ar' ? product.name_ar || product.name : product.name || product.name_ar;

    return (
      <View style={[styles.cartItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Product Image Section */}
        <Pressable
          style={[styles.productThumb, { backgroundColor: colors.surface }]}
          onPress={() => router.push(`/product/${item.product_id}`)}
        >
          {product.image_url || (product.images && product.images[0]) ? (
            <Image 
              source={{ uri: product.image_url || product.images?.[0] }} 
              style={styles.productImage} 
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="cube-outline" size={32} color={colors.textSecondary} />
          )}
          {item.bundle_group_id && (
            <View style={[styles.bundleBadge, { backgroundColor: NEON_NIGHT_THEME.accent }]}>
              <Ionicons name="gift" size={10} color="#FFF" />
            </View>
          )}
        </Pressable>

        {/* Product Info Section */}
        <View style={styles.cartItemInfo}>
          {/* Product Name */}
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
            {productName}
          </Text>

          {/* SKU Badge */}
          <View style={[styles.skuContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="barcode-outline" size={12} color={colors.textSecondary} />
            <Text style={[styles.skuText, { color: colors.textSecondary }]}>
              SKU: {sku}
            </Text>
          </View>

          {/* Compatible Car Models - Always show if available */}
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
                {originalPrice.toFixed(0)} ج.م
              </Text>
            )}
            <Text style={[styles.finalPrice, { color: NEON_NIGHT_THEME.primary }]}>
              {finalPrice.toFixed(0)} ج.م
            </Text>
            {hasDiscount && originalPrice > 0 && (
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>
                  -{Math.round(((originalPrice - finalPrice) / originalPrice) * 100)}%
                </Text>
              </View>
            )}
          </View>

          {/* Line Total */}
          <View style={[styles.lineTotalRow, isRTL && styles.rowReverse]}>
            <Text style={[styles.lineTotalLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الإجمالي:' : 'Total:'}
            </Text>
            <Text style={[styles.lineTotalValue, { color: colors.text }]}>
              {lineTotal.toFixed(0)} ج.م
            </Text>
          </View>
        </View>

        {/* Actions Section */}
        <View style={styles.actionsSection}>
          {/* Quantity Controls - Hide for bundle items */}
          {!item.bundle_group_id ? (
            <View style={[styles.quantityControls, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                style={[styles.qtyBtn, { backgroundColor: colors.card }]}
                onPress={() => handleQuantityUpdate(item.product_id, item.quantity - 1)}
              >
                <Ionicons name="remove" size={16} color={colors.text} />
              </Pressable>
              <Text style={[styles.qtyText, { color: colors.text }]}>{item.quantity}</Text>
              <Pressable
                style={[styles.qtyBtn, { backgroundColor: colors.card }]}
                onPress={() => handleQuantityUpdate(item.product_id, item.quantity + 1)}
              >
                <Ionicons name="add" size={16} color={colors.text} />
              </Pressable>
            </View>
          ) : (
            // Bundle item - show locked indicator instead of quantity controls
            <View style={[styles.bundleLockedIndicator, { backgroundColor: '#FFD700' + '20', borderColor: '#FFD700' }]}>
              <Ionicons name="gift" size={14} color="#FFD700" />
              <Text style={[styles.bundleLockedText, { color: '#FFD700' }]}>
                {language === 'ar' ? 'عرض خاص' : 'Bundle'}
              </Text>
            </View>
          )}

          {/* Remove Button - Now triggers modal */}
          <Pressable
            style={[styles.removeBtn, { backgroundColor: '#EF4444' + '15' }]}
            onPress={() => handleDeletePress(item.product_id, productName)}
          >
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </Pressable>
        </View>
      </View>
    );
  }, [colors, language, isRTL, router, handleQuantityUpdate, handleDeletePress, formatCarModels]);

  // Order Summary Component
  const OrderSummary = useMemo(() => {
    if (safeCartItems.length === 0) return null;
    
    return (
      <View style={[styles.summaryContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {language === 'ar' ? 'ملخص الطلب' : 'Order Summary'}
        </Text>

        {getTotalSavings() > 0 && (
          <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
            <View style={[styles.savingsRow, isRTL && styles.rowReverse]}>
              <Ionicons name="sparkles" size={14} color="#10B981" />
              <Text style={[styles.savingsLabel, { color: '#10B981' }]}>
                {language === 'ar' ? 'التوفير' : 'You Save'}
              </Text>
            </View>
            <Text style={[styles.savingsValue, { color: '#10B981' }]}>
              -{getTotalSavings().toFixed(0)} ج.م
            </Text>
          </View>
        )}

        <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {getSubtotal().toFixed(0)} ج.م
          </Text>
        </View>

        <View style={[styles.summaryRow, isRTL && styles.rowReverse]}>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            {language === 'ar' ? 'الشحن' : 'Shipping'}
          </Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {SHIPPING_COST.toFixed(0)} ج.م
          </Text>
        </View>

        <View style={[styles.totalRow, { borderTopColor: colors.border }, isRTL && styles.rowReverse]}>
          <Text style={[styles.totalLabel, { color: colors.text }]}>
            {language === 'ar' ? 'الإجمالي' : 'Total'}
          </Text>
          <Text style={[styles.totalValue, { color: NEON_NIGHT_THEME.primary }]}>
            {(getSubtotal() + SHIPPING_COST).toFixed(0)} ج.م
          </Text>
        </View>

        <Pressable
          style={[styles.checkoutBtn, { backgroundColor: NEON_NIGHT_THEME.primary }]}
          onPress={onCheckout}
        >
          <Ionicons name="card-outline" size={20} color="#FFF" />
          <Text style={styles.checkoutBtnText}>
            {language === 'ar' ? 'المتابعة للدفع' : 'Proceed to Checkout'}
          </Text>
          <Ionicons name={isRTL ? 'arrow-back' : 'arrow-forward'} size={20} color="#FFF" />
        </Pressable>
      </View>
    );
  }, [colors, language, isRTL, getSubtotal, getTotalSavings, onCheckout, safeCartItems.length]);

  // List Header - ZERO top padding to fix gap
  const ListHeaderComponent = useCallback(() => (
    <View style={[styles.headerRow, isRTL && styles.rowReverse]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {language === 'ar' ? 'سلة التسوق' : 'Shopping Cart'}
      </Text>
      <View style={[styles.countBadge, { backgroundColor: NEON_NIGHT_THEME.primary }]}>
        <Text style={styles.countBadgeText}>{getItemCount()}</Text>
      </View>
    </View>
  ), [colors, language, isRTL, getItemCount]);

  // List Footer with summary
  const ListFooterComponent = useCallback(() => (
    <View>
      {OrderSummary}
      <View style={{ height: 100 }} />
    </View>
  ), [OrderSummary]);

  // Empty state
  const ListEmptyComponent = useCallback(() => (
    <View style={[styles.emptyContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <EmptyState
        icon="cart-outline"
        title={language === 'ar' ? 'السلة فارغة' : 'Cart is empty'}
        actionLabel={language === 'ar' ? 'تصفح المنتجات' : 'Browse Products'}
        onAction={() => router.push('/')}
      />
    </View>
  ), [language, router, colors]);

  return (
    <>
      <FlashList
        data={safeCartItems}
        renderItem={renderCartItem}
        keyExtractor={(item, index) => item.product_id || `cart-item-${index}`}
        estimatedItemSize={200}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        extraData={safeCartItems.length}
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

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        visible={deleteModalVisible}
        productName={itemToDelete?.productName || ''}
        isRTL={isRTL}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </>
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
  cartItem: {
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
  bundleBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartItemInfo: {
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
    marginBottom: 4,
  },
  originalPrice: {
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  finalPrice: {
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
  lineTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lineTotalLabel: {
    fontSize: 12,
  },
  lineTotalValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  actionsSection: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingLeft: 8,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  bundleLockedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  bundleLockedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  qtyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  qtyText: {
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 8,
    minWidth: 30,
    textAlign: 'center',
  },
  removeBtn: {
    padding: 10,
    borderRadius: 10,
    marginTop: 8,
  },
  summaryContainer: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginTop: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 14,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  savingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savingsLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  savingsValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    marginTop: 10,
    borderTopWidth: 1,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  totalValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 16,
  },
  checkoutBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  cancelButton: {
    borderWidth: 1,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#EF4444',
  },
  deleteButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default CartTab;

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Dimensions,
  Image,
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInRight,
  Layout,
} from 'react-native-reanimated';
import { useTheme } from '../src/hooks/useTheme';
import { useTranslation } from '../src/hooks/useTranslation';
import { useAppStore, NEON_NIGHT_THEME } from '../src/store/appStore';
import { ordersApi } from '../src/services/api';
import wsService from '../src/services/websocketService';

const { width: screenWidth } = Dimensions.get('window');

// Status steps configuration
const ORDER_STATUSES = [
  { key: 'pending', icon: 'receipt-outline', arLabel: 'قيد الانتظار', enLabel: 'Pending' },
  { key: 'processing', icon: 'cog-outline', arLabel: 'جاري المعالجة', enLabel: 'Processing' },
  { key: 'shipped', icon: 'car-outline', arLabel: 'تم الشحن', enLabel: 'Shipped' },
  { key: 'delivered', icon: 'checkmark-circle', arLabel: 'تم التوصيل', enLabel: 'Delivered' },
];

// Pulsing dot for current step
const PulsingDot = ({ color }: { color: string }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  React.useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 800 }),
        withTiming(1, { duration: 800 })
      ),
      -1,
      false
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800 }),
        withTiming(0.5, { duration: 800 })
      ),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.pulsingDot,
        { backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
};

// Order Timeline Component
const OrderTimeline = ({
  currentStatus,
  language,
  isRTL,
  colors,
  estimatedDelivery,
}: any) => {
  const currentIndex = ORDER_STATUSES.findIndex((s) => s.key === currentStatus);

  return (
    <View style={styles.timelineContainer}>
      {/* Estimated delivery */}
      {estimatedDelivery && currentStatus !== 'delivered' && (
        <View style={[styles.estimatedDelivery, { backgroundColor: `${NEON_NIGHT_THEME.primary}15` }]}>
          <Ionicons name="time-outline" size={16} color={NEON_NIGHT_THEME.primary} />
          <Text style={[styles.estimatedText, { color: colors.text }]}>
            {language === 'ar' ? `التوصيل المتوقع: ${estimatedDelivery}` : `Est. Delivery: ${estimatedDelivery}`}
          </Text>
        </View>
      )}

      {/* Timeline */}
      <View style={[styles.timeline, isRTL && styles.rowReverse]}>
        {ORDER_STATUSES.map((status, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isPending = index > currentIndex;

          const stepColor = isCompleted
            ? NEON_NIGHT_THEME.primary
            : isCurrent
            ? NEON_NIGHT_THEME.accent
            : colors.border;

          return (
            <React.Fragment key={status.key}>
              <View style={styles.timelineStep}>
                {/* Step Circle */}
                <View style={styles.stepCircleWrapper}>
                  {isCurrent && <PulsingDot color={`${NEON_NIGHT_THEME.accent}40`} />}
                  <View
                    style={[
                      styles.stepCircle,
                      {
                        backgroundColor: isCompleted || isCurrent ? stepColor : colors.surface,
                        borderColor: stepColor,
                      },
                    ]}
                  >
                    <Ionicons
                      name={isCompleted ? 'checkmark' : (status.icon as any)}
                      size={isCompleted ? 14 : 16}
                      color={isCompleted || isCurrent ? '#FFF' : colors.textSecondary}
                    />
                  </View>
                </View>

                {/* Step Label */}
                <Text
                  style={[
                    styles.stepLabel,
                    {
                      color: isCompleted || isCurrent ? colors.text : colors.textSecondary,
                      fontWeight: isCurrent ? '700' : '500',
                    },
                  ]}
                  numberOfLines={1}
                >
                  {language === 'ar' ? status.arLabel : status.enLabel}
                </Text>
              </View>

              {/* Connector Line */}
              {index < ORDER_STATUSES.length - 1 && (
                <View
                  style={[
                    styles.timelineConnector,
                    {
                      backgroundColor: isCompleted ? NEON_NIGHT_THEME.primary : colors.border,
                    },
                  ]}
                />
              )}
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
};

// Order Card Component
const OrderCard = ({ order, language, isRTL, colors, onPress }: any) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return '#F59E0B';
      case 'processing':
        return NEON_NIGHT_THEME.primary;
      case 'shipped':
        return '#06B6D4';
      case 'delivered':
        return '#10B981';
      default:
        return colors.textSecondary;
    }
  };

  const getStatusLabel = (status: string) => {
    const statusObj = ORDER_STATUSES.find((s) => s.key === status);
    return language === 'ar' ? statusObj?.arLabel : statusObj?.enLabel;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    if (language === 'ar') {
      return date.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(300).springify()}
      layout={Layout.springify()}
      style={animatedStyle}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        style={[styles.orderCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {/* Order Header */}
        <View style={[styles.orderHeader, isRTL && styles.rowReverse]}>
          <View style={isRTL ? { alignItems: 'flex-end' } : {}}>
            <Text style={[styles.orderId, { color: colors.text }]}>
              #{order.id.slice(-8).toUpperCase()}
            </Text>
            <Text style={[styles.orderDate, { color: colors.textSecondary }]}>
              {formatDate(order.created_at)}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${getStatusColor(order.status)}20` },
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: getStatusColor(order.status) }]}
            />
            <Text style={[styles.statusText, { color: getStatusColor(order.status) }]}>
              {getStatusLabel(order.status)}
            </Text>
          </View>
        </View>

        {/* Timeline Preview */}
        <OrderTimeline
          currentStatus={order.status}
          language={language}
          isRTL={isRTL}
          colors={colors}
          estimatedDelivery={order.estimated_delivery}
        />

        {/* Items Preview */}
        <View style={[styles.itemsPreview, { borderTopColor: colors.border }]}>
          <View style={[styles.itemsRow, isRTL && styles.rowReverse]}>
            <View style={[styles.itemsStack, isRTL && styles.rowReverse]}>
              {order.items.slice(0, 3).map((item: any, index: number) => (
                <View
                  key={index}
                  style={[
                    styles.itemThumb,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      marginLeft: isRTL ? 0 : index > 0 ? -12 : 0,
                      marginRight: isRTL ? (index > 0 ? -12 : 0) : 0,
                      zIndex: 3 - index,
                    },
                  ]}
                >
                  {item.product_image ? (
                    <Image source={{ uri: item.product_image }} style={styles.itemThumbImg} />
                  ) : (
                    <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
                  )}
                </View>
              ))}
              {order.items.length > 3 && (
                <View
                  style={[
                    styles.itemThumb,
                    styles.moreThumb,
                    {
                      backgroundColor: NEON_NIGHT_THEME.primary,
                      marginLeft: isRTL ? 0 : -12,
                      marginRight: isRTL ? -12 : 0,
                    },
                  ]}
                >
                  <Text style={styles.moreThumbText}>+{order.items.length - 3}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.itemsCount, { color: colors.textSecondary }]}>
              {order.items.length} {language === 'ar' ? 'منتج' : 'items'}
            </Text>
          </View>
        </View>

        {/* Order Footer */}
        <View style={[styles.orderFooter, isRTL && styles.rowReverse]}>
          <View style={[styles.totalSection, isRTL && { alignItems: 'flex-end' }]}>
            <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الإجمالي' : 'Total'}
            </Text>
            <Text style={[styles.totalAmount, { color: NEON_NIGHT_THEME.primary }]}>
              {(parseFloat(String(order.total || 0)) || 0).toFixed(0)} ج.م
            </Text>
          </View>
          <View style={[styles.viewDetailsBtn, { backgroundColor: `${NEON_NIGHT_THEME.primary}15` }]}>
            <Text style={[styles.viewDetailsText, { color: NEON_NIGHT_THEME.primary }]}>
              {language === 'ar' ? 'التفاصيل' : 'Details'}
            </Text>
            <Ionicons
              name={isRTL ? 'chevron-back' : 'chevron-forward'}
              size={16}
              color={NEON_NIGHT_THEME.primary}
            />
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Order Details Modal
const OrderDetailsModal = ({ order, visible, onClose, language, isRTL, colors }: any) => {
  if (!order) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={[styles.modalContent, { backgroundColor: colors.background }]}
        >
          {/* Modal Header */}
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              #{order.id.slice(-8).toUpperCase()}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Order Timeline */}
          <View style={styles.modalSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'حالة الطلب' : 'Order Status'}
            </Text>
            <OrderTimeline
              currentStatus={order.status}
              language={language}
              isRTL={isRTL}
              colors={colors}
              estimatedDelivery={order.estimated_delivery}
            />
          </View>

          {/* Items List */}
          <View style={styles.modalSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'المنتجات' : 'Items'}
            </Text>
            {order.items.map((item: any, index: number) => (
              <View
                key={index}
                style={[
                  styles.detailItem,
                  { borderBottomColor: colors.border },
                  isRTL && styles.rowReverse,
                ]}
              >
                <View style={[styles.detailItemImage, { backgroundColor: colors.surface }]}>
                  {item.product_image ? (
                    <Image source={{ uri: item.product_image }} style={styles.detailItemImg} />
                  ) : (
                    <Ionicons name="cube-outline" size={24} color={colors.textSecondary} />
                  )}
                </View>
                <View style={[styles.detailItemInfo, isRTL && { alignItems: 'flex-end' }]}>
                  <Text style={[styles.detailItemName, { color: colors.text }]} numberOfLines={2}>
                    {item.product_name}
                  </Text>
                  <Text style={[styles.detailItemQty, { color: colors.textSecondary }]}>
                    {language === 'ar' ? `الكمية: ${item.quantity}` : `Qty: ${item.quantity}`}
                  </Text>
                </View>
                <Text style={[styles.detailItemPrice, { color: NEON_NIGHT_THEME.primary }]}>
                  {((parseFloat(String(item.price || 0)) || 0) * item.quantity).toFixed(0)} ج.م
                </Text>
              </View>
            ))}
          </View>

          {/* Shipping Info */}
          <View style={styles.modalSection}>
            <Text style={[styles.sectionTitle, { color: colors.text }, isRTL && styles.textRight]}>
              {language === 'ar' ? 'بيانات التوصيل' : 'Shipping Info'}
            </Text>
            <View style={[styles.shippingCard, { backgroundColor: colors.surface }]}>
              <View style={[styles.shippingRow, isRTL && styles.rowReverse]}>
                <Ionicons name="location-outline" size={20} color={NEON_NIGHT_THEME.primary} />
                <Text style={[styles.shippingText, { color: colors.text }]}>
                  {order.shipping_address}
                </Text>
              </View>
              {order.phone && (
                <View style={[styles.shippingRow, isRTL && styles.rowReverse]}>
                  <Ionicons name="call-outline" size={20} color={NEON_NIGHT_THEME.primary} />
                  <Text style={[styles.shippingText, { color: colors.text }]}>{order.phone}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Total */}
          <View style={[styles.modalFooter, { borderTopColor: colors.border }, isRTL && styles.rowReverse]}>
            <Text style={[styles.modalTotalLabel, { color: colors.textSecondary }]}>
              {language === 'ar' ? 'الإجمالي:' : 'Total:'}
            </Text>
            <Text style={[styles.modalTotalValue, { color: NEON_NIGHT_THEME.primary }]}>
              {(parseFloat(String(order.total || 0)) || 0).toFixed(0)} ج.م
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default function OrdersScreen() {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAppStore();

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);

  const fetchOrders = async () => {
    if (!user) return;

    try {
      const response = await ordersApi.getAll();
      setOrders(response.data || []);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchOrders();

      // Subscribe to real-time order updates
      const unsubscribe = wsService.addMessageHandler('orders-page-handler', (msg) => {
        if (msg.type !== 'order_updated') return;
        const data = msg.data;
        setOrders((prev) =>
          prev.map((order) => (order.id === data?.order_id ? { ...order, ...data } : order))
        );
      }, { types: ['order_updated'] });

      return () => {
        if (unsubscribe) unsubscribe();
      };
    }, [user])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrders();
  };

  const handleOrderPress = (order: any) => {
    setSelectedOrder(order);
    setShowDetails(true);
  };

  if (!user) {
    router.replace('/login');
    return null;
  }

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={NEON_NIGHT_THEME.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 10,
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name={isRTL ? 'arrow-forward' : 'arrow-back'} size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {language === 'ar' ? 'طلباتي' : 'My Orders'}
        </Text>
        <View style={styles.placeholder} />
      </View>

      {orders.length > 0 ? (
        <View style={styles.flashListContainer}>
          <FlashList
            data={orders}
            keyExtractor={(item) => item.id}
            estimatedItemSize={300}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[NEON_NIGHT_THEME.primary]}
              />
            }
            renderItem={({ item, index }) => (
              <OrderCard
                order={item}
                language={language}
                isRTL={isRTL}
                colors={colors}
                onPress={() => handleOrderPress(item)}
              />
            )}
          />
        </View>
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[NEON_NIGHT_THEME.primary]}
            />
          }
        >
          <Animated.View entering={FadeIn.duration(500)} style={styles.emptyContainer}>
            <View style={[styles.emptyIcon, { backgroundColor: `${NEON_NIGHT_THEME.primary}20` }]}>
              <Ionicons name="receipt-outline" size={48} color={NEON_NIGHT_THEME.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {language === 'ar' ? 'لا توجد طلبات' : 'No Orders Yet'}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              {language === 'ar'
                ? 'ابدأ التسوق واطلب منتجاتك الآن'
                : 'Start shopping and place your first order'}
            </Text>
            <TouchableOpacity
              style={[styles.shopButton, { backgroundColor: NEON_NIGHT_THEME.primary }]}
              onPress={() => router.push('/(tabs)')}
            >
              <Ionicons name="storefront-outline" size={20} color="#FFF" />
              <Text style={styles.shopButtonText}>
                {language === 'ar' ? 'تصفح المنتجات' : 'Browse Products'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      )}

      {/* Order Details Modal */}
      <OrderDetailsModal
        order={selectedOrder}
        visible={showDetails}
        onClose={() => setShowDetails(false)}
        language={language}
        isRTL={isRTL}
        colors={colors}
      />
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
    fontWeight: '700',
  },
  placeholder: {
    width: 40,
  },
  flashListContainer: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  orderCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  orderId: {
    fontSize: 16,
    fontWeight: '700',
  },
  orderDate: {
    fontSize: 12,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timelineContainer: {
    marginBottom: 16,
  },
  estimatedDelivery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  estimatedText: {
    fontSize: 12,
    fontWeight: '500',
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
  },
  stepCircleWrapper: {
    position: 'relative',
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulsingDot: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepLabel: {
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
  },
  timelineConnector: {
    height: 2,
    flex: 1,
    marginTop: 17,
    marginHorizontal: -8,
  },
  itemsPreview: {
    paddingTop: 12,
    borderTopWidth: 1,
    marginBottom: 12,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemsStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemThumb: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  itemThumbImg: {
    width: '100%',
    height: '100%',
  },
  moreThumb: {
    borderWidth: 0,
  },
  moreThumbText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  itemsCount: {
    fontSize: 12,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalSection: {},
  totalLabel: {
    fontSize: 12,
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: '800',
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  viewDetailsText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  shopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  shopButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  closeBtn: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  detailItemImage: {
    width: 50,
    height: 50,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  detailItemImg: {
    width: '100%',
    height: '100%',
  },
  detailItemInfo: {
    flex: 1,
  },
  detailItemName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  detailItemQty: {
    fontSize: 12,
  },
  detailItemPrice: {
    fontSize: 15,
    fontWeight: '700',
  },
  shippingCard: {
    padding: 12,
    borderRadius: 12,
  },
  shippingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  shippingText: {
    flex: 1,
    fontSize: 14,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  },
  modalTotalLabel: {
    fontSize: 16,
  },
  modalTotalValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  textRight: {
    textAlign: 'right',
  },
});

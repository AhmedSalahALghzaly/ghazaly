/**
 * Cart Tab - Unified Shopping Hub Entry Point
 * This replaces the old cart screen with the Universal Shopping & Management Hub
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/hooks/useTheme';
import { UnifiedShoppingHub } from '../../src/components/UnifiedShoppingHub';
import { Header } from '../../src/components/Header';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useLocalSearchParams } from 'expo-router';

export default function CartScreen() {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const insets = useSafeAreaInsets();
  const { tab } = useLocalSearchParams<{ tab?: string }>();

  // Determine which tab to show - default to cart, but allow orders via query param
  const initialTab = (tab === 'orders' || tab === 'favorites' || tab === 'checkout' || tab === 'profile') 
    ? tab 
    : 'cart';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header 
        title={language === 'ar' ? 'حسابي' : 'My Account'} 
        showBack={false} 
        showSearch={true} 
        showCart={false} 
      />
      <UnifiedShoppingHub initialTab={initialTab as any} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

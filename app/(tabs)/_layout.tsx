import React, { useState, useCallback } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, StyleSheet, TouchableOpacity, Text, Pressable, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTheme } from '../../src/hooks/useTheme';
import { useTranslation } from '../../src/hooks/useTranslation';
import { useAppStore, useCanAccessAdminPanel } from '../../src/store/appStore';
import { AdvancedSearchBottomSheet } from '../../src/components/ui/AdvancedSearchBottomSheet';
import { createShadow } from '../../src/utils/shadowUtils';
import FloatingChatIcon from '../../src/components/ui/FloatingChatIcon';
import FloatingAiAgentIcon from '../../src/components/ui/FloatingAiAgentIcon';

// Owner email that can always access the interface
const OWNER_EMAIL = 'pc.2025.ai@gmail.com';

export default function TabLayout() {
  const { colors } = useTheme();
  const { t, isRTL, language } = useTranslation();
  const router = useRouter();
  const cartItems = useAppStore((state) => state.cartItems);
  const user = useAppStore((state) => state.user);
  const partners = useAppStore((state) => state.partners);
  const admins = useAppStore((state) => state.admins);
  const userRole = useAppStore((state) => state.userRole);
  const canAccessAdminPanel = useCanAccessAdminPanel();
  
  // State for advanced search bottom sheet
  const [showSearch, setShowSearch] = useState(false);
  
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  // Check if user can access owner interface
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase();
  const isPartner = partners.some(
    (p: any) => p.email?.toLowerCase() === user?.email?.toLowerCase()
  );
  const isAdmin = admins.some(
    (a: any) => a.email?.toLowerCase() === user?.email?.toLowerCase()
  ) || userRole === 'admin';
  const canAccessOwner = isOwner || isPartner;

  // Custom center button for Owner/Admin Access
  const CenterAccessButton = () => {
    // Show Owner button for owners/partners
    if (canAccessOwner) {
      return (
        <TouchableOpacity
          style={styles.ownerButton}
          onPress={() => router.push('/owner')}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#8B5CF6', '#6366F1']}
            style={styles.ownerButtonGradient}
          >
            <Ionicons name="diamond" size={30} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      );
    }
    
    // Show Admin button for admins
    if (isAdmin) {
      return (
        <TouchableOpacity
          style={styles.ownerButton}
          onPress={() => router.push('/admin')}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#10B981', '#059669']}
            style={styles.ownerButtonGradient}
          >
            <Ionicons name="settings" size={24} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      );
    }
    
    return null;
  };

  // Determine if we should show the center button
  const showCenterButton = canAccessOwner || isAdmin;

  // Memoized search tab button to prevent re-renders
  const SearchTabButton = useCallback((props: any) => {
    return (
      <Pressable
        onPress={() => setShowSearch(true)}
        style={({ pressed }) => [
          { 
            flex: 1,
            alignItems: 'center', 
            justifyContent: 'center',
            paddingVertical: 3,
            opacity: pressed ? 0.7 : 1,
          }
        ]}
      >
        <View style={{ alignItems: 'center' }}>
          <Ionicons 
            name="search" 
            size={24} 
            color={colors.tabBarInactive} 
          />
          <Text style={{ 
            fontSize: 11, 
            fontWeight: '700', 
            color: colors.tabBarInactive,
            marginTop: 1.9,
          }}>
            {language === 'ar' ? 'بحث' : 'Search'}
          </Text>
        </View>
      </Pressable>
    );
  }, [colors.tabBarInactive, language]);

  return (
    <>
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: colors.tabBar,
              borderTopColor: colors.border,
              height: Platform.OS === 'ios' ? 88 : 64,
              paddingBottom: Platform.OS === 'ios' ? 28 : 8,
              paddingTop: 1.9,
            },
            tabBarActiveTintColor: colors.tabBarActive,
            tabBarInactiveTintColor: colors.tabBarInactive,
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '700',
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: t('home'),
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="home" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="categories"
            options={{
              title: t('categories'),
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="grid" size={size} color={color} />
              ),
            }}
          />
          {/* Hidden owner-placeholder route - not shown in tab bar */}
          <Tabs.Screen
            name="owner-placeholder"
            options={{ href: null }}
          />
          <Tabs.Screen
            name="cart"
            options={{
              title: language === 'ar' ? 'حسابي' : 'My Hub',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="bag-handle" size={size} color={color} />
              ),
              tabBarBadge: cartCount > 0 ? cartCount : undefined,
              tabBarBadgeStyle: {
                backgroundColor: colors.error,
                fontSize: 10,
              },
            }}
          />
          {/* Search Tab - Opens Bottom Sheet instead of navigating */}
          <Tabs.Screen
            name="profile"
            options={{
              title: language === 'ar' ? 'بحث' : 'Search',
              tabBarIcon: ({ color, size }) => (
                <Ionicons name="search" size={size} color={color} />
              ),
              tabBarButton: SearchTabButton,
            }}
          />
        </Tabs>
        
        {/* Admin/Owner Access Center Button - Floating above tab bar */}
        {showCenterButton && (
          <View style={styles.ownerButtonContainer}>
            <CenterAccessButton />
          </View>
        )}

        {/* Chat Floating Button - self-positions via Reanimated; rendered in full-screen overlay */}
        {user && (
          <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
            <FloatingChatIcon />
            <FloatingAiAgentIcon />
          </View>
        )}
      </View>

      {/* Advanced Search Bottom Sheet - Outside Tabs to avoid expo-router warning */}
      <AdvancedSearchBottomSheet 
        visible={showSearch} 
        onClose={() => setShowSearch(false)} 
      />
    </>
  );
}

const styles = StyleSheet.create({
  ownerButtonContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 45 : 25,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
  },
  ownerButton: {
    ...createShadow('#8B5CF6', 0, 5, 0.13, 9, 9),
  },
  ownerButtonGradient: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
});

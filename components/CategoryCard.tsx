import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image as RNImage } from 'react-native';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../hooks/useTranslation';

interface CategoryCardProps {
  category: {
    id: string;
    name: string;
    name_ar: string;
    icon?: string;
    image_data?: string;
    children?: any[];
  };
  size?: 'small' | 'medium' | 'large';
}

const iconMap: { [key: string]: string } = {
  'engine': 'engine',
  'car-suspension': 'car-brake-abs',
  'car-clutch': 'cog',
  'lightning-bolt': 'lightning-bolt',
  'car-door': 'car-door',
  'car-tire-alert': 'tire',
  'filter': 'filter',
  'oil': 'oil',
  'air-filter': 'air-filter',
  'fan': 'fan',
  'flash': 'flash',
  'car-brake-abs': 'car-brake-abs',
  'cog': 'cog',
  'battery': 'battery',
  'lightbulb': 'lightbulb',
  'flip-horizontal': 'flip-horizontal',
  'car-side': 'car-side',
};

const sizeStyles = {
  small: { width: 80, height: 80, iconSize: 24, fontSize: 11, containerSize: 40 },
  medium: { width: 100, height: 100, iconSize: 32, fontSize: 12, containerSize: 50 },
  large: { width: 120, height: 120, iconSize: 40, fontSize: 14, containerSize: 60 },
};

const CategoryCardComponent: React.FC<CategoryCardProps> = ({ category, size = 'medium' }) => {
  const { colors } = useTheme();
  const { language } = useTranslation();
  const router = useRouter();

  const displayName = useMemo(() => 
    language === 'ar' && category.name_ar ? category.name_ar : category.name,
    [language, category.name, category.name_ar]
  );

  const iconName = useMemo(() => {
    const icon = category.icon || 'cube';
    return iconMap[icon] || 'cube';
  }, [category.icon]);

  const { width, height, iconSize, fontSize, containerSize } = sizeStyles[size];
  const hasImage = category.image_data && category.image_data.length > 0;

  const handlePress = useCallback(() => {
    router.push(`/category/${category.id}`);
  }, [router, category.id]);

  const containerStyle = useMemo(() => [
    styles.container,
    {
      width,
      height,
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
  ], [width, height, colors.card, colors.border]);

  const iconContainerStyle = useMemo(() => [
    styles.iconContainer,
    {
      backgroundColor: hasImage ? 'transparent' : colors.primary + '15',
      width: containerSize,
      height: containerSize,
      borderRadius: containerSize / 2,
      overflow: 'hidden' as const,
    }
  ], [hasImage, colors.primary, containerSize]);

  return (
    <TouchableOpacity
      style={containerStyle}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={iconContainerStyle}>
        {hasImage ? (
          <RNImage
            source={{ uri: category.image_data }}
            style={{
              width: containerSize,
              height: containerSize,
              borderRadius: containerSize / 2,
            }}
            resizeMode="cover"
          />
        ) : (
          <MaterialCommunityIcons
            name={iconName as any}
            size={iconSize}
            color={colors.primary}
          />
        )}
      </View>
      <Text
        style={[styles.name, { color: colors.text, fontSize }]}
        numberOfLines={2}
      >
        {displayName}
      </Text>
    </TouchableOpacity>
  );
};

// Memoized export
export const CategoryCard = React.memo(CategoryCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.category.id === nextProps.category.id &&
    prevProps.category.name === nextProps.category.name &&
    prevProps.category.name_ar === nextProps.category.name_ar &&
    prevProps.category.image_data === nextProps.category.image_data &&
    prevProps.size === nextProps.size
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 4,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  name: {
    fontWeight: '600',
    textAlign: 'center',
  },
});

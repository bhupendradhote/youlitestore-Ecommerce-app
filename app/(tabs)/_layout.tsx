import Colors from '@/utils/Colors';
import { AntDesign, Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
const TabLayout = () => {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.PRIMARY,
        tabBarInactiveTintColor: 'gray',
        tabBarStyle: {
          backgroundColor: 'white',
          height: 60 + insets.bottom, // ✅ adjust height
          paddingBottom: insets.bottom, // ✅ avoid overlap with back/home button
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <AntDesign name="home" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="CartScreen"
        options={{
          title: 'Cart',
          tabBarIcon: ({ color }) => (
            <Feather name="shopping-cart" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="Category"
        options={{
          title: 'Category',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="category" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="Profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <FontAwesome5 name="user" size={18} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="Chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => (
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
};

export default TabLayout;



import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';

import { colors, fonts } from '@/ui/theme';

const TABS = [
  { name: 'index', title: 'ホーム', icon: 'home' },
  { name: 'games', title: '試合', icon: 'list' },
  { name: 'analysis', title: '分析', icon: 'bar-chart' },
  { name: 'settings', title: '設定', icon: 'settings' },
] as const;

/** 縦画面の4タブ。試合中の入力・照合などは、このタブの外（下メニューなし）で開く */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.sub,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ focused, size }) => (
              <Ionicons
                name={focused ? t.icon : `${t.icon}-outline`}
                size={size}
                color={focused ? colors.text : colors.sub}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

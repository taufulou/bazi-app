import { useUser, useAuth } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';

const readingTypes = [
  { slug: 'lifetime', icon: '🌟', name: '八字終身運', description: '全面分析您的八字命盤', credits: 2 },
  { slug: 'annual', icon: '📅', name: '八字流年運勢', description: '預測您今年的運勢變化', credits: 2 },
  { slug: 'career', icon: '💼', name: '事業財運', description: '分析事業發展與財運走勢', credits: 2 },
  { slug: 'love', icon: '💕', name: '愛情姻緣', description: '探索感情運勢與姻緣時機', credits: 2 },
  { slug: 'health', icon: '🏥', name: '先天健康分析', description: '五行體質與養生保健建議', credits: 2 },
  { slug: 'compatibility', icon: '🤝', name: '合盤比較', description: '兩人八字契合度分析', credits: 3 },
];

export default function DashboardScreen() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    Alert.alert('登出', '確定要登出嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '確定',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User Info */}
      <View style={styles.userSection}>
        <View>
          <Text style={styles.greeting}>
            歡迎回來{user?.firstName ? `，${user.firstName}` : ''}
          </Text>
          <Text style={styles.email}>
            {user?.primaryEmailAddress?.emailAddress || ''}
          </Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>登出</Text>
        </TouchableOpacity>
      </View>

      {/* Reading Type Cards */}
      <Text style={styles.sectionTitle}>選擇服務</Text>
      <View style={styles.grid}>
        {readingTypes.map((reading) => (
          <TouchableOpacity key={reading.slug} style={styles.card} activeOpacity={0.7}>
            <Text style={styles.cardIcon}>{reading.icon}</Text>
            <Text style={styles.cardName}>{reading.name}</Text>
            <Text style={styles.cardDescription}>{reading.description}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.cardCredits}>{reading.credits} 點數</Text>
              <Text style={styles.cardAction}>開始 →</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  userSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(232, 213, 183, 0.15)',
    marginBottom: 24,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e8d5b7',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#a0a0a0',
  },
  signOutButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(232, 213, 183, 0.3)',
  },
  signOutText: {
    color: '#e8d5b7',
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e0e0e0',
    marginBottom: 16,
  },
  grid: {
    gap: 16,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(232, 213, 183, 0.1)',
  },
  cardIcon: {
    fontSize: 28,
    marginBottom: 10,
  },
  cardName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e8d5b7',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 14,
    color: '#a0a0a0',
    lineHeight: 20,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  cardCredits: {
    color: '#e8d5b7',
    fontSize: 13,
    opacity: 0.7,
  },
  cardAction: {
    color: '#e8d5b7',
    fontSize: 14,
    fontWeight: '500',
  },
});

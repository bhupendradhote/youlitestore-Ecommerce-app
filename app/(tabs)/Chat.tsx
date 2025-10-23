import Colors from '@/utils/Colors';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getSession } from '../../lib/services/authService';
import { SafeAreaView } from 'react-native-safe-area-context';
import Loading from '../components/Loading';
import Dimenstion from '@/utils/Dimenstion';
import { Ionicons } from '@expo/vector-icons';

interface Product {
  id: number;
  name: string;
  images: { src: string }[];
}

interface Message {
  id: string;
  text: string;
  sender: 'customer' | 'admin';
  time: string;
  userName?: string;
  user_id: number;
  created_at: string;
  is_read: Boolean
}

const WC_PRODUCTS_API =
  'https://youlitestore.in/wp-json/wc/v3/products?consumer_key=ck_d75d53f48f9fb87921a2523492a995c741d368df&consumer_secret=cs_ae3184c5435dd5d46758e91fa9ed3917d85e0c17';
const PC_FETCH_API = 'https://youlitestore.in/wp-json/product-chat/v1/fetch';
const PC_SEND_API = 'https://youlitestore.in/wp-json/product-chat/v1/send';

const ChatScreen = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const [getMessageUser, setGetMessageUser] = useState<string>('');

  useEffect(() => {
    initUser();
  }, []);

  useEffect(() => {
    if (searchQuery.trim().length === 0) {
      setFilteredProducts(products);
    } else {
      const lower = searchQuery.toLowerCase();
      setFilteredProducts(
        products.filter((p) => p.name.toLowerCase().includes(lower))
      );
    }
  }, [searchQuery, products]);

  useEffect(() => {
    const hasReadMessage = messages.some((msg) => msg.is_read === true);
    setGetMessageUser(hasReadMessage ? 'read' : 'unread');
  }, [messages]);


  const initUser = async () => {
    const session = await getSession();
    if (session?.user?.id) {
      setUserId(session.user.id);
      setUserName(session.user.name || session.user.first_name || session.user.email);
      setUserEmail(session.user.email);
      fetchProductsWithChats(session.user.id);
    } else {
      console.warn('No user session found.');
    }
  };

  /** Fetch products but only include those which have chat messages */
  const fetchProductsWithChats = async (customerId: number) => {
    try {
      setLoadingProducts(true);

      // Fetch all products
      const res = await fetch(WC_PRODUCTS_API);
      const allProducts = await res.json();

      // Check which products have chat messages
      const productsWithMessages: Product[] = [];
      for (const product of allProducts) {
        const chatRes = await fetch(`${PC_FETCH_API}?product_id=${product.id}&customer_id=${customerId}`);
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          if (chatData.length > 0) {
            productsWithMessages.push(product);
          }
        }

      }

      setProducts(productsWithMessages);
      setFilteredProducts(productsWithMessages);
    } catch (e) {
      console.error('Fetch products error:', e);
    } finally {
      setLoadingProducts(false);
    }
  };

  const selectProduct = async (product: Product) => {
    setSelectedProduct(product);
    setMessages([]);
    if (!userId) return;
    await fetchMessages(product.id);
  };

  const fetchMessages = async (productId: number) => {
    try {
      setLoadingMessages(true);
      const res = await fetch(`${PC_FETCH_API}?product_id=${productId}&customer_id=${userId}`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      const data = await res.json();

      const processedData = data.map((message: any) => ({
        ...message,
        user_id: parseInt(message.user_id, 10),
      }));

      const mapped: Message[] = processedData
        .map((m: any): Message => ({
          id: m.id.toString(),
          text: m.message,
          sender: m.user_id === userId ? 'customer' : 'admin',
          time: new Date(m.created_at).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          userName: m.user_name,
          user_id: m.user_id,
          created_at: m.created_at,
          is_read: m.is_read,
        }))
        .sort((a: Message, b: Message) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      setMessages(mapped);
      setTimeout(scrollToBottom, 500);
    } catch (e) {
      console.error('Fetch messages error:', e);
    } finally {
      setLoadingMessages(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedProduct || !inputMsg.trim() || !userId) return;

    try {
      const body = {
        product_id: selectedProduct.id,
        customer_id: userId,
        sender_id: userId,
        message: inputMsg,
      };

      const res = await fetch(PC_SEND_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Send failed: ${res.status} - ${errorText}`);
      }

      const newMessage: Message = {
        id: `temp-${Date.now()}`,
        text: inputMsg,
        sender: 'customer',
        time: timeNow(),
        userName: userName || undefined,
        user_id: userId,
        created_at: new Date().toISOString(),
        is_read: false
      };

      setMessages((prev) => [...prev, newMessage]);
      setInputMsg('');

      setTimeout(() => {
        if (selectedProduct) fetchMessages(selectedProduct.id);
      }, 500);
    } catch (e) {
      console.error('Send message error:', e);
    }
  };

  const timeNow = () => {
    const d = new Date();
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  };

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    let isCurrentUser = item.user_id === userId;

    return (
      <View style={[styles.msgRow, isCurrentUser ? styles.outgoing : styles.incoming]}>
        {!isCurrentUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.userName?.charAt(0) || 'A'}</Text>
          </View>
        )}
        <View style={[styles.bubble, isCurrentUser ? styles.bubbleOutgoing : styles.bubbleIncoming]}>
          {!isCurrentUser && <Text style={styles.userName}>{item.userName || 'Admin'}</Text>}
          <Text style={[styles.msgText, isCurrentUser && styles.outgoingMsgText]}>{item.text}</Text>
          <Text style={[styles.time, isCurrentUser && styles.outgoingTime]}>{item.time}</Text>

          {/* Show read status for outgoing messages */}
          {isCurrentUser && (
            <Text style={styles.readStatus}>
              {item.is_read ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
        {isCurrentUser && (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{userName?.charAt(0) || 'Y'}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderProductItem = ({ item }: { item: Product }) => {
    // We need to fetch the latest messages for this product to check read status
    // For now, we'll show a generic indicator since we don't have real-time status
    // In a real app, you would fetch this data or maintain it in state
    const hasUnreadMessages = false; // This should be determined from your data

    return (
      <TouchableOpacity style={styles.productItem} onPress={() => selectProduct(item)}>
        <Image
          source={{ uri: item.images[0]?.src || 'https://via.placeholder.com/50' }}
          style={styles.productAvatar}
        />
        <Text style={styles.productName}>{item.name}</Text>

        {/* Show unread indicator - you'll need to implement the actual logic */}
        {hasUnreadMessages && (
          <View style={styles.unreadIndicator} />
        )}
      </TouchableOpacity>
    );
  };



  return (
    <View style={styles.container}>
      <StatusBar barStyle={'light-content'} backgroundColor={'transparent'} />
      {!selectedProduct ? (
        <View style={styles.productListContainer}>
          <View style={styles.header}>
            <Text style={styles.headerText}>{userId ? 'Product Messages' : 'Please Login to View Messages'}</Text>
          </View>

          {userId && (
            <TextInput
              style={styles.searchInput}
              placeholder="Search products..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          )}

          {loadingProducts ? (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
              <Loading />
              <Text style={{ marginTop: 12, fontSize: 18, fontWeight: '600', color: Colors.SECONDARY }}>
                Loading your Chats
              </Text>
            </View>
          ) : !userId ? (
            <View style={styles.loginPrompt}>
              <Text style={styles.loginText}>You need to be logged in to view your messages.</Text>
            </View>
          ) : filteredProducts.length === 0 ? (
            <View style={styles.stateWrap}>
              <Ionicons name="search" size={36} color="#6B7280" />
              <Text style={styles.noResults}>No Messages found</Text>
            </View>
          ) : (
            <FlatList
              data={filteredProducts}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderProductItem}
              contentContainerStyle={styles.productList}
            />
          )}
        </View>
      ) : (
        <>
          <SafeAreaView style={styles.chatHeader}>
            <StatusBar barStyle={'dark-content'} backgroundColor={'transparent'} />
            <TouchableOpacity onPress={() => setSelectedProduct(null)}>
              <Text style={styles.backBtn}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {selectedProduct.name}
            </Text>
            <View style={styles.headerSpacer} />
          </SafeAreaView>

          {loadingMessages ? (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
              <Loading />
              <Text style={{ marginTop: 12, fontSize: 18, fontWeight: '600', color: Colors.SECONDARY }}>
                Loading your Chats
              </Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No messages yet</Text>
              <Text style={styles.emptyStateSubText}>Start a conversation about this product</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messagesContainer}
              onContentSizeChange={scrollToBottom}
              onLayout={scrollToBottom}
            />
          )}

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Type your message..."
              value={inputMsg}
              onChangeText={setInputMsg}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.sendBtn, !inputMsg.trim() && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!inputMsg.trim()}
            >
              <Text style={styles.sendText}>➤</Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7fb' },
  header: {
    padding: 16,
    backgroundColor: Colors.PRIMARY,
    marginBottom: 10,
    height: Dimenstion.headerHeight,
    justifyContent: 'flex-end',
    textAlign: 'center',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    alignItems: 'center'
  },
  headerText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.WHITE,
  },

  stateWrap: { height: 600, alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20, justifyContent: 'center' },
  noResults: { marginTop: 8, color: '#374151', fontSize: 16, fontWeight: '800' },
  noResultsSub: { marginTop: 4, color: '#6B7280', fontSize: 12, textAlign: 'center' },
  productListContainer: { flex: 1 },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  productList: { paddingBottom: 20 },
  productItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 8,
  },
  productAvatar: { width: 50, height: 50, borderRadius: 8, marginRight: 12 },
  productName: { fontSize: 16, fontWeight: '600', flex: 1 },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  unreadIndicator: {
    width: 10,
    height: 10,
    backgroundColor: 'green',
    borderRadius: 50,
  },
  readStatus: {
    fontSize: 10,
    color: '#999',
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  backBtn: { fontSize: 16, color: Colors.PRIMARY, fontWeight: '600' },
  chatTitle: { fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  headerSpacer: { width: 60 },
  msgRow: { marginVertical: 6, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12 },
  incoming: { justifyContent: 'flex-start' },
  outgoing: { justifyContent: 'flex-end' },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  avatarText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  bubble: { maxWidth: '70%', padding: 12, borderRadius: 20, marginHorizontal: 4 },
  bubbleIncoming: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e0e0e0' },
  bubbleOutgoing: { backgroundColor: Colors.PRIMARY },
  userName: { fontWeight: '600', marginBottom: 4, color: '#555', fontSize: 12 },
  msgText: { fontSize: 15, color: '#000', lineHeight: 20 },
  outgoingMsgText: { color: '#fff' },
  time: { fontSize: 11, color: '#666', marginTop: 4, alignSelf: 'flex-end' },
  outgoingTime: { color: 'rgba(255,255,255,0.8)' },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#fff',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderColor: '#eee',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    maxHeight: 100,
    backgroundColor: '#f9f9f9',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: Colors.PRIMARY,
    borderRadius: 25,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#ccc' },
  sendText: { color: '#fff', fontSize: 18 },
  loader: { marginTop: 20 },
  loginPrompt: { padding: 20, alignItems: 'center' },
  loginText: { fontSize: 16, color: '#666', textAlign: 'center' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyStateText: { fontSize: 18, fontWeight: '600', color: '#666', marginBottom: 8 },
  emptyStateSubText: { fontSize: 14, color: '#999', textAlign: 'center' },
  messagesContainer: { paddingVertical: 12 },
});

export default ChatScreen;

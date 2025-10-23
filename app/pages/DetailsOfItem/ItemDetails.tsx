import { getProductDetail, getProducts } from '@/lib/api/productApi';
import { getCustomerById, getSession, updateCustomerById } from '@/lib/services/authService';
import Colors from '@/utils/Colors';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    FlatList,
    Image,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
// Import rating services
import { loadReviews } from '@/lib/services/ratingServices';
import Loading from '@/app/components/Loading';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const toNum = (v: any, fb = 0): number => {
    const n = parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : fb;
};

const stripHtml = (html?: string): string => {
    if (!html) return '';
    return html.replace(/(<([^>]+)>)/gi, '').replace(/&nbsp;/g, ' ').trim();
};

const decodeEntities = (s: string): string => {
    try {
        return s
            .replace(/&#x([a-fA-F0-9]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&#(\d+);/gi, (match, dec) => String.fromCharCode(parseInt(dec, 10)))
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&ndash;/g, '–')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<\/?p>/gi, ' ')
            .trim();
    } catch (e) {
        console.warn('decodeEntities error:', e);
        return s;
    }
};

const pctDiscount = (regular: number, sale: number): number | undefined => {
    if (regular > 0 && sale > 0 && regular > sale) {
        const pct = Math.round(((regular - sale) / regular) * 100);
        return Number.isFinite(pct) && pct > 0 ? pct : undefined;
    }
    return undefined;
};

const safeDatePlusDays = (days = 5): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const normalizeUri = (uri: string): string => {
    const trimmed = (uri || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://')) return trimmed.replace('http://', 'https://');
    return trimmed;
};

const parsePriceRangeFromHtml = (priceHtml?: string): { min?: number; max?: number } => {
    if (!priceHtml || typeof priceHtml !== 'string') return {};

    try {
        const priceMatches = priceHtml.match(/&#8377;([\d,]+\.?\d*)/g) || [];
        const prices: number[] = [];

        priceMatches.forEach((match: string) => {
            const priceStr = match.replace('&#8377;', '').replace(/,/g, '');
            const price = parseFloat(priceStr);
            if (!isNaN(price)) {
                prices.push(price);
            }
        });

        if (prices.length >= 2) {
            return { min: Math.min(...prices), max: Math.max(...prices) };
        } else if (prices.length === 1) {
            return { min: prices[0], max: prices[0] };
        }

        return {};
    } catch (error) {
        console.error('Error parsing price range:', error);
        return {};
    }
};

// Function to get variation details
const getVariationDetails = async (productId: string, variationIds: number[]): Promise<{
    variationPrices: { [key: string]: number };
    variationOriginalPrices: { [key: string]: number };
    variationDiscounts: { [key: string]: number };
}> => {
    const variationPrices: { [key: string]: number } = {};
    const variationOriginalPrices: { [key: string]: number } = {};
    const variationDiscounts: { [key: string]: number } = {};

    try {
        for (const variationId of variationIds) {
            const variationRes = await getProductDetail(variationId.toString());
            const variationData = variationRes?.data;

            if (variationData) {
                const salePrice = toNum(variationData.sale_price || variationData.price, 0);
                const regularPrice = toNum(variationData.regular_price || variationData.price, 0);
                const discount = pctDiscount(regularPrice, salePrice);

                const attributes = variationData.attributes || [];
                if (attributes.length > 0 && attributes[0].option) {
                    const optionKey = attributes[0].option;
                    variationPrices[optionKey] = salePrice;
                    variationOriginalPrices[optionKey] = regularPrice;
                    if (discount) {
                        variationDiscounts[optionKey] = discount;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error fetching variation details:', error);
    }

    return { variationPrices, variationOriginalPrices, variationDiscounts };
};

// Function to extract deposit settings from meta_data
const extractDepositSettings = (metaData: any[]): {
    depositEnabled: boolean;
    depositType: 'fixed' | 'percentage';
    depositAmount: number;
    forceDeposit: boolean;
} => {
    const defaultSettings = {
        depositEnabled: false,
        depositType: 'fixed' as const,
        depositAmount: 0,
        forceDeposit: false
    };

    if (!Array.isArray(metaData)) return defaultSettings;

    try {
        const depositEnabledMeta = metaData.find((m: any) => m.key === '_awcdp_deposit_enabled' || m.key === '_enable_deposit');
        const depositEnabled = depositEnabledMeta?.value === 'yes';

        const awcdpType = metaData.find((m: any) => m.key === '_awcdp_deposit_type')?.value;
        const depositsType = metaData.find((m: any) => m.key === '_deposits_type')?.value;
        const depositType = awcdpType === 'percentage' || depositsType === 'percentage' ? 'percentage' : 'fixed';

        const awcdpAmount = toNum(metaData.find((m: any) => m.key === '_awcdp_deposits_deposit_amount')?.value);
        const depositsValue = toNum(metaData.find((m: any) => m.key === '_deposits_value')?.value);
        const depositAmount = awcdpAmount || depositsValue || 0;

        const forceDeposit = metaData.find((m: any) => m.key === '_mepp_force_deposit')?.value === 'yes';

        return {
            depositEnabled,
            depositType,
            depositAmount,
            forceDeposit
        };
    } catch (error) {
        console.error('Error extracting deposit settings:', error);
        return defaultSettings;
    }
};

interface Product {
    id: string;
    name: string;
    price: number;
    originalPrice?: number;
    discount?: number;
    description: string;
    attributeName: string;
    options: string[];
    images: string[];
    rating: number;
    reviewCount: number;
    deliveryDate: string;
    inStock: boolean;
    isVariable?: boolean;
    variationPrices?: { [key: string]: number };
    variationOriginalPrices?: { [key: string]: number };
    variationDiscounts?: { [key: string]: number };
    depositEnabled?: boolean;
    depositType?: 'fixed' | 'percentage';
    depositAmount?: number;
    forceDeposit?: boolean;
    categoryName?: string;
}

interface RelatedProduct {
    id: string;
    name: string;
    price: number;
    image: string;
    rating: number;
    title: string;
}

interface Review {
    id: string;
    reviewer: string;
    rating: number;
    comment: string;
    date: string;
}

interface DepositOption {
    type: 'full' | 'deposit';
    label: string;
    amount: number;
    remainingAmount?: number;
}

const mapToUIProduct = async (p: any): Promise<Product> => {
    const safeName = stripHtml(decodeEntities(String(p?.name ?? 'Unnamed Product')));

    let sale = toNum(p?.sale_price ?? p?.price, 0);
    let regular = toNum(p?.regular_price ?? p?.price, 0);
    let variationPrices: { [key: string]: number } = {};
    let variationOriginalPrices: { [key: string]: number } = {};
    let variationDiscounts: { [key: string]: number } = {};

    // Handle variable products
    if (p?.type === 'variable') {
        const range = parsePriceRangeFromHtml(p?.price_html);
        if (range.min !== undefined && range.max !== undefined) {
            sale = range.min;
            regular = range.max;
        }

        // Get variation prices if variations exist
        if (p.variations && Array.isArray(p.variations) && p.variations.length > 0) {
            const variationDetails = await getVariationDetails(String(p.id), p.variations);
            variationPrices = variationDetails.variationPrices;
            variationOriginalPrices = variationDetails.variationOriginalPrices;
            variationDiscounts = variationDetails.variationDiscounts;
        }
    }

    const imgs = Array.isArray(p?.images) ? p.images : [];
    const imageUrls = imgs
        .map((im: any) => (typeof im?.src === 'string' ? normalizeUri(im.src) : ''))
        .filter((s: string) => s.length > 0);

    const desc = stripHtml(decodeEntities(p?.description || '')) || stripHtml(decodeEntities(p?.short_description || '')) || '';

    const attrs = Array.isArray(p?.attributes) ? p.attributes : [];
    let attr =
        attrs.find(
            (a: any) =>
                typeof a?.name === 'string' &&
                ['watt', 'weight'].includes(a.name.trim().toLowerCase())
        ) || null;

    if (!attr) {
        attr = attrs.find((a: any) => Array.isArray(a?.options) && a.options.length > 0) || null;
    }

    const attributeName = attr?.name || 'Option';
    const options =
        attr && Array.isArray(attr.options) && attr.options.length > 0
            ? attr.options
                .map((opt: any) => (typeof opt === 'string' ? opt : ''))
                .map((s: string) => s.trim())
                .filter((s: string) => s.length > 0)
            : ['Default'];

    // Extract deposit settings
    const depositSettings = extractDepositSettings(p?.meta_data || []);

    // Get category name
    const categories = Array.isArray(p?.categories) ? p.categories : [];
    const categoryName = categories.length > 0 ? categories[0]?.name : 'Uncategorized';

    return {
        id: String(p?.id ?? ''),
        name: safeName || 'Unnamed Product',
        price: sale,
        originalPrice: regular > sale ? regular : undefined,
        discount: pctDiscount(regular, sale),
        description: desc,
        attributeName,
        options,
        images: imageUrls,
        rating: toNum(p?.average_rating ?? 0, 0),
        reviewCount: toNum(p?.rating_count ?? 0, 0),
        deliveryDate: safeDatePlusDays(5),
        inStock: (p?.stock_status ?? 'instock').toLowerCase() === 'instock',
        isVariable: p?.type === 'variable',
        variationPrices,
        variationOriginalPrices,
        variationDiscounts,
        categoryName, // Add category name
        ...depositSettings
    };
};

const mapToRelated = (p: any): RelatedProduct => {
    const imgs = Array.isArray(p?.images) ? p.images : [];
    const first = imgs.length > 0 && typeof imgs[0]?.src === 'string' ? normalizeUri(imgs[0].src) : '';

    let price = toNum(p?.sale_price ?? p?.price, 0);

    // Handle variable product pricing for related products
    if (p?.type === 'variable') {
        const range = parsePriceRangeFromHtml(p?.price_html);
        if (range.min !== undefined) {
            price = range.min;
        }
    }

    return {
        id: String(p?.id ?? ''),
        name: stripHtml(decodeEntities(String(p?.name ?? 'Unnamed'))),
        price: price,
        image: first || 'https://via.placeholder.com/300x300.png?text=Product',
        rating: toNum(p?.average_rating ?? 0, 0),
        title: p.name || 'Unnamed',
    };
};

const mapToReview = (r: any): Review => {
    return {
        id: String(r?.id ?? ''),
        reviewer: stripHtml(decodeEntities(String(r?.reviewer ?? 'Anonymous'))),
        rating: toNum(r?.rating ?? 0, 0),
        comment: stripHtml(decodeEntities(String(r?.review ?? ''))),
        date: r?.date_created ? new Date(r.date_created).toLocaleDateString() : 'Unknown date',
    };
};

// Function to fetch reviews from WooCommerce API
const getProductReviews = async (productId: string) => {
    try {
        const reviews = await loadReviews({ product: Number(productId), per_page: 5 });
        const sortedReviews = reviews
            .sort((a: any, b: any) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime())
            .slice(0, 5);
        return { data: sortedReviews };
    } catch (error) {
        console.error('Error fetching reviews:', error);
        return { data: [] };
    }
};

const ItemDetails = () => {
    const params = useLocalSearchParams<{ id?: string }>();
    const productId = useMemo(() => (params?.id ? String(params.id) : ''), [params?.id]);
    const [selectedOption, setSelectedOption] = useState<string>('Default');
    const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
    const [quantity, setQuantity] = useState<number>(1);
    const [product, setProduct] = useState<Product | null>(null);
    const [relatedProducts, setRelatedProducts] = useState<RelatedProduct[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [addToCartLoading, setAddToCartLoading] = useState<boolean>(false);
    const [errorText, setErrorText] = useState<string>('');
    const [isInWishlist, setIsInWishlist] = useState<boolean>(false);
    const [userId, setUserId] = useState<number | null>(null);
    const [feedbackMessage, setFeedbackMessage] = useState<string>('');
    const [cartItems, setCartItems] = useState<string[]>([]);
    const [deliveryAddress, setDeliveryAddress] = useState<string>('Loading address...');
    const [customer, setCustomer] = useState<any>(null);
    const [selectedDepositOption, setSelectedDepositOption] = useState<'full' | 'deposit'>('full');

    // Calculate current price based on selected variation
    const getCurrentPrice = (): number => {
        if (!product) return 0;

        if (product.isVariable && product.variationPrices && product.variationPrices[selectedOption]) {
            return product.variationPrices[selectedOption];
        }

        return product.price;
    };

    // Calculate current original price based on selected variation
    const getCurrentOriginalPrice = (): number | undefined => {
        if (!product) return undefined;

        if (product.isVariable && product.variationOriginalPrices && product.variationOriginalPrices[selectedOption]) {
            const originalPrice = product.variationOriginalPrices[selectedOption];
            const currentPrice = getCurrentPrice();
            return originalPrice > currentPrice ? originalPrice : undefined;
        }

        return product.originalPrice;
    };

    // Calculate current discount based on selected variation
    const getCurrentDiscount = (): number | undefined => {
        if (!product) return undefined;

        if (product.isVariable && product.variationDiscounts && product.variationDiscounts[selectedOption]) {
            return product.variationDiscounts[selectedOption];
        }

        const currentPrice = getCurrentPrice();
        const currentOriginalPrice = getCurrentOriginalPrice();

        if (currentOriginalPrice && currentOriginalPrice > currentPrice) {
            return pctDiscount(currentOriginalPrice, currentPrice);
        }

        return product.discount;
    };

    // Calculate deposit options
    const getDepositOptions = (): DepositOption[] => {
        if (!product || !product.depositEnabled || !product.depositAmount || product.depositAmount <= 0) {
            return [];
        }

        const currentPrice = getCurrentPrice();
        const totalAmount = currentPrice * quantity;

        let depositAmount = 0;
        if (product.depositType === 'percentage') {
            depositAmount = (totalAmount * product.depositAmount) / 100;
        } else {
            depositAmount = product.depositAmount * quantity;
        }

        const depositOptions: DepositOption[] = [
            {
                type: 'full',
                label: 'Pay Full Amount',
                amount: totalAmount
            },
            {
                type: 'deposit',
                label: 'Pay Deposit Amount',
                amount: depositAmount,
                remainingAmount: totalAmount - depositAmount
            }
        ];

        return depositOptions;
    };

    // Get selected amount based on deposit option
    const getSelectedAmount = (): number => {
        const depositOptions = getDepositOptions();
        if (depositOptions.length === 0) {
            return getCurrentPrice() * quantity;
        }

        const selectedOptionData = depositOptions.find(opt => opt.type === selectedDepositOption);
        return selectedOptionData ? selectedOptionData.amount : getCurrentPrice() * quantity;
    };

    const handleOptionChange = (itemValue: string) => {
        setSelectedOption(itemValue);
    };

    const handleDepositOptionChange = (optionType: 'full' | 'deposit') => {
        setSelectedDepositOption(optionType);
    };

    useEffect(() => {
        setSelectedImageIndex(0);
    }, [product?.images?.length]);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                setLoading(true);
                setErrorText('');
                const session = await getSession();
                if (session?.user?.id) {
                    setUserId(session.user.id);
                } else {
                    setIsInWishlist(false);
                }

                if (!productId) {
                    setErrorText('Missing product id in route params.');
                    if (mounted) {
                        setProduct(null);
                        setRelatedProducts([]);
                        setReviews([]);
                    }
                    setLoading(false);
                    return;
                }

                // Parallel fetch
                const [detailRes, reviewsRes, fetchedCustomer] = await Promise.all([
                    getProductDetail(productId),
                    getProductReviews(productId),
                    session?.user?.id ? getCustomerById(session.user.id) : Promise.resolve(null)
                ]);

                const detailData = detailRes?.data ?? (Array.isArray(detailRes) ? detailRes[0] : null);

                if (!detailData || typeof detailData !== 'object') {
                    console.warn('ItemDetails: product not found for id', productId);
                    setErrorText('Product not found.');
                    if (mounted) {
                        setProduct(null);
                        setRelatedProducts([]);
                        setReviews([]);
                    }
                    setLoading(false);
                    return;
                }

                const uiProd = await mapToUIProduct(detailData);
                if (mounted) {
                    setProduct(uiProd);
                    if (uiProd.options.length > 0) setSelectedOption(uiProd.options[0]);

                    // Set default deposit option based on product settings
                    if (uiProd.depositEnabled && uiProd.forceDeposit) {
                        setSelectedDepositOption('deposit');
                    }
                }

                // Set reviews
                const reviewList = Array.isArray(reviewsRes?.data) ? reviewsRes.data : [];
                if (mounted) setReviews(reviewList.map(mapToReview));

                // Set wishlist, cart, and customer
                if (fetchedCustomer) {
                    setCustomer(fetchedCustomer);
                    const wishlist = fetchedCustomer?.meta_data?.find((m: any) => m.key === 'wishlist')?.value || [];
                    setIsInWishlist(wishlist.includes(uiProd.id));
                    const cart = fetchedCustomer?.meta_data?.find((m: any) => m.key === 'cart')?.value || [];
                    const cartIds = cart.map((item: any) => item.id);
                    setCartItems(cartIds);

                    // Set dynamic delivery address
                    let addr = 'No address set';
                    if (fetchedCustomer.shipping && fetchedCustomer.shipping.address_1) {
                        addr = `${fetchedCustomer.shipping.address_1}, ${fetchedCustomer.shipping.city}, ${fetchedCustomer.shipping.state} ${fetchedCustomer.shipping.postcode}`;
                    } else if (fetchedCustomer.billing && fetchedCustomer.billing.address_1) {
                        addr = `${fetchedCustomer.billing.address_1}, ${fetchedCustomer.billing.city}, ${fetchedCustomer.billing.state} ${fetchedCustomer.billing.postcode}`;
                    }
                    setDeliveryAddress(addr);
                }

                // Related products
                let related: RelatedProduct[] = [];
                const relatedIds = Array.isArray(detailData?.related_ids)
                    ? detailData.related_ids.map((x: any) => String(x)).filter(Boolean)
                    : [];

                if (relatedIds.length > 0) {
                    const include = relatedIds.join(',');
                    const relRes = await getProducts({
                        include,
                        per_page: relatedIds.length,
                        status: 'publish',
                    });
                    const relList = Array.isArray(relRes?.data) ? relRes.data : [];
                    related = relList.map(mapToRelated);
                } else {
                    const cats = Array.isArray(detailData?.categories) ? detailData.categories : [];
                    const categoryId = cats.length > 0 ? String(cats[0]?.id) : undefined;
                    const relRes = await getProducts({
                        per_page: 12,
                        page: 1,
                        status: 'publish',
                        order: 'desc',
                        orderby: 'date',
                        category: categoryId,
                        exclude: productId,
                    });
                    const relList = Array.isArray(relRes?.data) ? relRes.data : [];
                    related = relList.filter((p: any) => String(p?.id) !== String(productId)).map(mapToRelated);
                }

                if (mounted) setRelatedProducts(related);
            } catch (e: any) {
                console.error('ItemDetails load error:', e?.message || e);
                setErrorText('Failed to load product. Please try again.');
                if (mounted) {
                    setProduct(null);
                    setRelatedProducts([]);
                    setReviews([]);
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        return () => {
            mounted = false;
        };
    }, [productId]);

    const handleGoToChat = async () => {
        try {
            const session = await getSession();
            if (!session?.user?.id) {
                alert("Please login to start chat");
                return;
            }
            if (!customer || !product) {
                alert("Unable to start chat: missing user or product data");
                return;
            }
            router.push({
                pathname: "/pages/DetailsOfItem/ChatScreen",
                params: {
                    product_id: product.id.toString(),
                    user_id: customer.id.toString(),
                    user_name: customer.first_name || customer.username || "Guest",
                    product_name: product.name,
                },
            });
        } catch (error) {
            console.error("❌ Chat navigation error:", error);
        }
    };

    const toggleWishlist = async () => {
        if (!userId || !product) {
            router.push('/Login/LoginRegisterPage');
            return;
        }
        try {
            const fetchedCustomer = await getCustomerById(userId);
            let wishlist = fetchedCustomer?.meta_data?.find((m: any) => m.key === 'wishlist')?.value || [];
            const wasInWishlist = isInWishlist;
            if (isInWishlist) {
                wishlist = wishlist.filter((id: string) => id !== product.id);
            } else {
                wishlist.push(product.id);
            }
            await updateCustomerById(userId, {
                meta_data: [{ key: 'wishlist', value: wishlist }],
            });
            setIsInWishlist(!isInWishlist);
            setFeedbackMessage(wasInWishlist ? 'Item removed from wishlist' : 'Item added to wishlist');
            setTimeout(() => {
                setFeedbackMessage('');
            }, 3000);
            setCustomer({ ...fetchedCustomer, meta_data: [{ key: 'wishlist', value: wishlist }] });
        } catch (error) {
            console.error('Error toggling wishlist:', error);
            setFeedbackMessage('Failed to update wishlist');
            setTimeout(() => {
                setFeedbackMessage('');
            }, 3000);
        }
    };

    const handleAddToCart = async (addProductId: string, qty = 1) => {
        if (!userId) {
            router.push('/Login/LoginRegisterPage');
            return;
        }
        try {
            setAddToCartLoading(true);
            const fetchedCustomer = await getCustomerById(userId);
            let cart = fetchedCustomer?.meta_data?.find((m: any) => m.key === 'cart')?.value || [];
            const existingIndex = cart.findIndex((item: any) => item.id === addProductId);

            const depositOptions = getDepositOptions();
            const isDeposit = selectedDepositOption === 'deposit' && depositOptions.length > 0;
            const paymentAmount = getSelectedAmount();

            if (existingIndex !== -1) {
                cart[existingIndex].quantity = (cart[existingIndex].quantity || 1) + qty;
                cart[existingIndex].isDeposit = isDeposit;
                cart[existingIndex].paymentAmount = paymentAmount;
            } else {
                cart.push({
                    id: addProductId,
                    quantity: qty,
                    isDeposit: isDeposit,
                    paymentAmount: paymentAmount
                });
            }
            await updateCustomerById(userId, {
                meta_data: [{ key: 'cart', value: cart }],
            });
            const cartIds = cart.map((item: any) => String(item.id));
            setCartItems(cartIds);
            setFeedbackMessage('Item added to cart');
            setTimeout(() => {
                setFeedbackMessage('');
            }, 3000);
            setCustomer({ ...fetchedCustomer, meta_data: [{ key: 'cart', value: cart }] });
        } catch (error) {
            console.error('Error adding to cart:', error);
            setFeedbackMessage('Failed to add to cart');
            setTimeout(() => {
                setFeedbackMessage('');
            }, 3000);
        } finally {
            setAddToCartLoading(false);
        }
    };

    const renderRelatedProduct = ({ item }: { item: RelatedProduct }) => {
        const isInCart = cartItems.includes(item.id);
        return (
            <TouchableOpacity
                style={styles.relatedProduct}
                onPress={() => router.push({ pathname: '/pages/DetailsOfItem/ItemDetails', params: { id: item.id, title: item.title } })}
            >
                <Image source={{ uri: item.image }} style={styles.relatedProductImage} />
                <Text style={styles.relatedProductName} numberOfLines={1}>{item.name}</Text>
                <View style={styles.relatedProductRating}>
                    <Ionicons name="star" size={14} color="#FFD700" />
                    <Text style={styles.relatedProductRatingText}>{item.rating.toFixed(1)}</Text>
                </View>
                <Text style={styles.relatedProductPrice}>₹{item.price.toFixed(2)}</Text>
                <TouchableOpacity
                    style={styles.addToCartButton}
                    onPress={() => isInCart ? router.push('/(tabs)/CartScreen') : handleAddToCart(item.id)}
                >
                    {isInCart ? (
                        <Text style={styles.addToCartText}>Go to Cart</Text>
                    ) : (
                        <>
                            <Ionicons name="cart-outline" size={16} color={Colors.WHITE} />
                            <Text style={styles.addToCartText}>Add</Text>
                        </>
                    )}
                </TouchableOpacity>
            </TouchableOpacity>
        );
    };

    const renderImageItem = ({ item, index }: { item: string; index: number }) => {
        const uri = (item || '').trim();
        if (!uri) return null;
        return (
            <TouchableOpacity onPress={() => setSelectedImageIndex(index)}>
                <Image
                    source={{ uri }}
                    style={[
                        styles.thumbnail,
                        index === selectedImageIndex && styles.selectedThumbnail
                    ]}
                />
            </TouchableOpacity>
        );
    };

    const renderReview = (item: Review) => (
        <View key={item.id} style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
                <Text style={styles.reviewReviewer}>{item.reviewer}</Text>
                <View style={styles.reviewStars}>
                    {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons
                            key={star}
                            name={star <= Math.floor(item.rating) ? 'star' : 'star-outline'}
                            size={16}
                            color="#FFD700"
                        />
                    ))}
                </View>
                <Text style={styles.reviewDate}>{item.date}</Text>
            </View>
            <Text style={styles.reviewComment}>{item.comment}</Text>
        </View>
    );

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
                <Loading />
                <Text style={{ marginTop: 12, fontSize: 18, fontWeight: '600', color: Colors.SECONDARY }}>
                    Loading your Product....
                </Text>
            </View>
        );
    }

    if (!product) {
        return (
            <View style={{ flex: 1, padding: 24, gap: 12 }}>
                <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: 'flex-start' }}>
                    <Ionicons name="arrow-back" size={24} color={Colors.PRIMARY} />
                </TouchableOpacity>
                <Text style={{ color: '#c00', marginTop: 8 }}>{errorText || 'Unable to load product.'}</Text>
            </View>
        );
    }

    const heroUri =
        product.images.length > 0
            ? product.images[Math.min(selectedImageIndex, product.images.length - 1)]
            : 'https://via.placeholder.com/800x800.png?text=No+Image';

    const isProductInCart = cartItems.includes(product.id);
    const currentPrice = getCurrentPrice();
    const currentOriginalPrice = getCurrentOriginalPrice();
    const currentDiscount = getCurrentDiscount();
    const total = currentPrice * quantity;
    const depositOptions = getDepositOptions();
    const selectedAmount = getSelectedAmount();

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar
                backgroundColor="transparent"
                barStyle="dark-content"
            />
            <ScrollView showsVerticalScrollIndicator={false}>
                {/* Product Images */}
                <View style={styles.imageSection}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={Colors.WHITE} />
                    </TouchableOpacity>
                    <Image source={{ uri: heroUri }} style={styles.mainImage} resizeMode="cover" />
                    {product.images.length > 0 ? (
                        <FlatList
                            data={product.images}
                            renderItem={renderImageItem}
                            keyExtractor={(item, index) => index.toString()}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.thumbnailList}
                        />
                    ) : null}
                </View>

                {/* Product Info */}
                <View style={styles.infoSection}>
                    <Text style={styles.productName}>{product.name}</Text>

                    <View style={styles.priceContainer}>
                        <Text style={styles.price}>₹{currentPrice.toFixed(2)}</Text>
                        {currentOriginalPrice && (
                            <Text style={styles.originalPrice}>₹{currentOriginalPrice.toFixed(2)}</Text>
                        )}
                        {currentDiscount && currentDiscount > 0 ? (
                            <View style={styles.discountBadge}>
                                <Text style={styles.discountText}>{currentDiscount}% OFF</Text>
                            </View>
                        ) : null}
                    </View>

                    <View style={styles.ratingContainer}>
                        <View style={styles.stars}>
                            {[1, 2, 3, 4, 5].map((star) => (
                                <Ionicons
                                    key={star}
                                    name={star <= Math.floor(product.rating) ? 'star' : 'star-outline'}
                                    size={20}
                                    color="#FFD700"
                                />
                            ))}
                        </View>
                        <Text style={styles.ratingText}>
                            {product.rating} ({product.reviewCount} reviews)
                        </Text>
                        <View style={styles.categoryContainer}>
                            <Ionicons name="pricetag-outline" size={16} color="#666" />
                            <Text style={styles.categoryText}>{product.categoryName || 'Uncategorized'}</Text>
                        </View>
                    </View>

                    <TouchableOpacity style={styles.button} onPress={handleGoToChat}>
                        <Text style={styles.buttonText}>Lets Talk</Text>
                    </TouchableOpacity>

                
                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.wishlistButton} onPress={toggleWishlist}>
                            <Ionicons
                                name={isInWishlist ? "heart" : "heart-outline"}
                                size={24}
                                color={isInWishlist ? Colors.PRIMARY : Colors.PRIMARY}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.addToCartButtonFooter}
                            onPress={() => isProductInCart ? router.push('/(tabs)/CartScreen') : handleAddToCart(product.id, quantity)}
                            disabled={addToCartLoading && !isProductInCart}
                        >
                            {addToCartLoading && !isProductInCart ? (
                                <ActivityIndicator size="small" color={Colors.WHITE} />
                            ) : isProductInCart ? (
                                <Text style={styles.addToCartTextFooter}>Go to Cart</Text>
                            ) : (
                                <Text style={styles.addToCartTextFooter}>Add to Cart</Text>
                            )}
                        </TouchableOpacity>
                        <View style={{ flex: 1, alignItems: 'center' }}>
                            <TouchableOpacity
                                style={styles.checkoutButton}
                                onPress={async () => {
                                    if (!userId) {
                                        router.push('/Login/LoginRegisterPage');
                                        return;
                                    }
                                    router.push({
                                        pathname: '/pages/Checkout/Checkout',
                                        params: {
                                            buyNow: 'true',
                                            productId: product.id,
                                            quantity: quantity.toString(),
                                            option: selectedOption,
                                            isDeposit: (selectedDepositOption === 'deposit').toString(),
                                            paymentAmount: selectedAmount.toString(),
                                        }
                                    });
                                }}
                            >
                                <Text style={styles.checkoutText}>Buy Now</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.colorSection}>
                        <Text style={styles.sectionTitle}>{product.attributeName}: {selectedOption}</Text>
                        <Picker
                            selectedValue={selectedOption}
                            onValueChange={handleOptionChange}
                            style={styles.picker}
                        >
                            {product.options.map((option) => (
                                <Picker.Item key={option} label={option} value={option} />
                            ))}
                        </Picker>
                    </View>

                    <View style={styles.quantitySection}>
                        <Text style={styles.sectionTitle}>Quantity</Text>
                        <View style={styles.quantitySelector}>
                            <TouchableOpacity
                                style={styles.quantityButton}
                                onPress={() => setQuantity(Math.max(1, quantity - 1))}
                            >
                                <Ionicons name="remove" size={20} color="#333" />
                            </TouchableOpacity>
                            <Text style={styles.quantityText}>{quantity}</Text>
                            <TouchableOpacity
                                style={styles.quantityButton}
                                onPress={() => setQuantity(quantity + 1)}
                            >
                                <Ionicons name="add" size={20} color="#333" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.deliverySection}>
                        <Text style={styles.sectionTitle}>Delivery</Text>
                        <View style={styles.deliveryInfo}>
                            <Ionicons name="location-outline" size={20} color="#4a6cf7" />
                            <View style={styles.deliveryTextContainer}>
                                <Text style={styles.deliveryAddress}>Delivery to {deliveryAddress}</Text>
                            </View>
                            <TouchableOpacity onPress={() => router.push('/pages/Profile/ShippingAddress')}>
                                <Text style={styles.changeText}>Change</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.descriptionSection}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.descriptionText}>{product.description || 'No description.'}</Text>
                    </View>

                    {/* Ratings and Reviews Section */}
                    <View style={styles.reviewsSection}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <Text style={styles.sectionTitle}>Ratings and Reviews</Text>
                            <TouchableOpacity onPress={() => router.push({
                                pathname: '/pages/orderHistory/reviewPage',
                                params: { productId: productId, productName: product.name }
                            })}>
                                <Text style={{ color: Colors.PRIMARY, fontSize: 16, fontWeight: '600' }}>View All</Text>
                            </TouchableOpacity>
                        </View>
                        {reviews.length === 0 ? (
                            <Text style={{ color: '#666' }}>No reviews yet.</Text>
                        ) : (
                            reviews.map(renderReview)
                        )}
                    </View>
                </View>

                <View style={styles.relatedSection}>
                    <Text style={styles.sectionTitle}>You might also like</Text>
                    <FlatList
                        data={relatedProducts}
                        renderItem={renderRelatedProduct}
                        keyExtractor={(item) => item.id}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                    />
                </View>
            </ScrollView>

            {feedbackMessage ? (
                <View style={styles.messageContainer}>
                    <Text style={styles.messageText}>{feedbackMessage}</Text>
                </View>
            ) : null}
        </SafeAreaView>
    );
};

export default ItemDetails;

const styles = StyleSheet.create({
    button: {
        backgroundColor: Colors.PRIMARY,
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 10,
        alignItems: "center",
        marginTop: 20,
    },
    buttonText: {
        color: "#fff",
        fontSize: 16,
        fontWeight: "600",
    },
    container: { flex: 1, backgroundColor: '#f8f9fa' },
    imageSection: { backgroundColor: 'white', paddingBottom: 10, position: 'relative' },
    backButton: {
        position: 'absolute', top: 30, left: 20, zIndex: 10,
        backgroundColor: 'rgba(0,0,0,0.5)', width: 40, height: 40, borderRadius: 20,
        justifyContent: 'center', alignItems: 'center',
    },
    mainImage: { width: width, height: width },
    thumbnailList: { paddingHorizontal: 10, marginTop: 10 },
    thumbnail: { width: 60, height: 60, marginRight: 10, borderRadius: 8 },
    selectedThumbnail: { borderWidth: 2, borderColor: '#4a6cf7' },
    infoSection: { backgroundColor: 'white', padding: 16, marginTop: 10 },
    productName: { fontSize: 22, fontWeight: '700', color: '#2d3748', marginBottom: 10 },
    priceContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
    price: { fontSize: 20, fontWeight: 'bold', color: '#4a6cf7', marginRight: 10 },
    originalPrice: { fontSize: 18, color: '#a0aec0', textDecorationLine: 'line-through', marginRight: 10 },
    discountBadge: { backgroundColor: '#e53e3e', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
    discountText: { color: 'white', fontWeight: '600', fontSize: 12 },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 10,
    },
    stars: { flexDirection: 'row', marginRight: 10 },
    ratingText: { color: '#4a5568', fontSize: 16 },
    categoryContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        marginLeft: 'auto',
    },
    categoryText: {
        fontSize: 14,
        color: '#475569',
        marginLeft: 6,
        fontWeight: '500',
    },

    // Deposit Section Styles
    depositSection: { marginBottom: 20 },
    depositOption: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 8,
        marginBottom: 10,
    },
    selectedDepositOption: {
        borderColor: '#4a6cf7',
        backgroundColor: '#f0f4ff',
    },
    radioContainer: {
        marginRight: 12,
    },
    radio: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: '#cbd5e0',
        justifyContent: 'center',
        alignItems: 'center',
    },
    radioSelected: {
        borderColor: '#4a6cf7',
    },
    radioInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#4a6cf7',
    },
    depositOptionContent: {
        flex: 1,
    },
    depositOptionLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2d3748',
        marginBottom: 4,
    },
    depositOptionAmount: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#4a6cf7',
    },
    remainingAmount: {
        fontSize: 14,
        color: '#718096',
        marginTop: 2,
    },

    colorSection: { marginBottom: 20 },
    sectionTitle: { fontSize: 18, fontWeight: '600', color: '#2d3748', marginBottom: 10 },
    picker: { height: 50, width: '100%', backgroundColor: '#f7fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
    quantitySection: { marginBottom: 20 },
    quantitySelector: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, alignSelf: 'flex-start' },
    quantityButton: { padding: 10 },
    quantityText: { paddingHorizontal: 15, fontSize: 16, fontWeight: '600' },
    deliverySection: { marginBottom: 20 },
    deliveryInfo: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f7fafc', padding: 15, borderRadius: 8 },
    deliveryTextContainer: { flex: 1, marginLeft: 10 },
    deliveryAddress: { fontSize: 14, color: '#2d3748', marginBottom: 4 },
    deliveryDate: { fontSize: 14, color: '#4a5568' },
    changeText: { color: '#4a6cf7', fontWeight: '600' },
    descriptionSection: { marginBottom: 20 },
    descriptionText: { fontSize: 16, color: '#4a5568', lineHeight: 24 },
    reviewsSection: { marginBottom: 20 },
    reviewItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
    reviewHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
    reviewReviewer: { fontSize: 16, fontWeight: '600', flex: 1 },
    reviewStars: { flexDirection: 'row', marginRight: 10 },
    reviewDate: { fontSize: 12, color: '#718096' },
    reviewComment: { fontSize: 14, color: '#4a5568' },
    relatedSection: { backgroundColor: 'white', padding: 16, marginTop: 10, marginBottom: 80 },
    relatedProduct: { width: 150, marginRight: 15, position: 'relative' },
    relatedProductImage: { width: 150, height: 150, borderRadius: 8, marginBottom: 8 },
    relatedProductName: { fontSize: 14, fontWeight: '500', color: '#2d3748', marginBottom: 4 },
    relatedProductRating: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    relatedProductRatingText: { fontSize: 12, color: '#4a5568', marginLeft: 4 },
    relatedProductPrice: { fontSize: 16, fontWeight: 'bold', color: '#4a6cf7', marginBottom: 8 },
    addToCartButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.PRIMARY, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6 },
    addToCartText: { fontSize: 12, fontWeight: '600', color: Colors.WHITE, marginLeft: 4 },
    footer: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'white', padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
    wishlistButton: { justifyContent: 'center', alignItems: 'center', padding: 15, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, marginRight: 10 },
    addToCartButtonFooter: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 15, backgroundColor: Colors.SECONDARY, borderRadius: 8, marginRight: 10 },
    addToCartTextFooter: { color: Colors.WHITE, fontWeight: '600', fontSize: 16 },
    checkoutButton: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 15, backgroundColor: Colors.PRIMARY, borderRadius: 8 },
    checkoutText: { color: 'white', fontWeight: '600', fontSize: 16 },
    secureText: { fontSize: 12, color: '#666', marginTop: 4 },
    messageContainer: {
        position: 'absolute',
        bottom: 80,
        left: 0,
        right: 0,
        backgroundColor: '#333',
        padding: 16,
        marginHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    messageText: {
        color: '#fff',
        fontSize: 16,
    },
});
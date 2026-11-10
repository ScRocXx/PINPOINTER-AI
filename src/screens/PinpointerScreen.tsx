import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ModelDownloadSheet, FilterCategory } from '../components';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import type { MainTabNavigationOptions } from '../navigation/MainTabs';
import { addRecentPhoto } from '../utils/RecentPhotos';
import {
    View,
    TextInput,
    TouchableWithoutFeedback,
    StatusBar,
    Animated,
    Keyboard,
    useWindowDimensions,
    Vibration,
    BackHandler,
} from 'react-native';
import { usePinpointerShared } from '../hooks/PinpointerContext';
import { HomeScreen } from '../screens/HomeScreen';
import { HomeView } from './pinpointer/HomeView';
import { PhotoPreviewModal } from './pinpointer/PhotoPreviewModal';
import { SearchBar } from './pinpointer/SearchBar';
import { SearchOverlay } from './pinpointer/SearchOverlay';
import { styles } from './pinpointer/styles';

/**
 * Main Pinpointer screen: universal search over indexed photos and documents.
 *
 * Owns the screen's state and wiring; the parts live in `./pinpointer/`:
 * `HomeView` (at rest: indexing card, suggestions), `SearchOverlay` (recent
 * searches, filters, results), `ResultItem`, `SearchBar` (with voice) and
 * `PhotoPreviewModal`. The slide-in drawer embeds {@link HomeScreen}.
 */
export const PinpointerScreen: React.FC = () => {
    const { width } = useWindowDimensions();
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

    const {
        searchText, setSearchText,
        searchResults,
        isSearching, setIsSearching, isSearchPending,
        selectedImage, setSelectedImage,
        isRecording, isTranscribing, isModelLoading,
        startListening, stopListening,
        handleShare, handleEdit,
        handleQuickSync, handleDeepSync,
        isSyncing, isDeepSync, syncCount, lastSyncTime,
        isSyncingDocs, docSyncCount, totalDocs, lastDocSyncTime, handleDocumentSync,
        searchHistory, handleSelectHistory, handleDeleteHistory, handleClearHistory,
    } = usePinpointerShared();

    const route = useRoute<RouteProp<RootStackParamList, 'Pinpointer'>>();

    const [showModelSheet, setShowModelSheet] = useState(false);
    const [selectedFilter, setSelectedFilter] = useState<FilterCategory>('ALL');
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);

    const searchInputRef = useRef<TextInput>(null);
    const drawerAnim = useRef(new Animated.Value(-width)).current;

    // Search and the side menu use the whole screen: hide the tab bar.
    // (This screen is a tab; the stack-typed navigation doesn't know the option.)
    useEffect(() => {
        const tabs = navigation as unknown as { setOptions?: (options: MainTabNavigationOptions) => void };
        tabs.setOptions?.({ tabBarHidden: isSearching || isDrawerOpen });
    }, [isSearching, isDrawerOpen, navigation]);

    const openDrawer = () => {
        setIsDrawerOpen(true);
        Animated.timing(drawerAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
        }).start();
    };

    const closeDrawer = useCallback(() => {
        Animated.timing(drawerAnim, {
            toValue: -width,
            duration: 300,
            useNativeDriver: true,
        }).start(() => {
            setIsDrawerOpen(false);
        });
    }, [drawerAnim, width]);

    useEffect(() => {
        const backAction = () => {
            if (isDrawerOpen) {
                closeDrawer();
                return true;
            }
            // First behavior: cancel search if search is active
            if (isSearching) {
                Keyboard.dismiss();
                setIsSearching(false);
                // Delay state clearing so the Animated.timing isn't dropped by
                // native layout shifts caused by unmounting the Results List
                setTimeout(() => {
                    setSearchText('');
                }, 300);
                return true;
            }
            // Secondary behavior: go back to previous screen (exit)
            return false;
        };

        const backHandler = BackHandler.addEventListener(
            'hardwareBackPress',
            backAction
        );

        return () => backHandler.remove();
    }, [isSearching, isDrawerOpen, closeDrawer, setIsSearching, setSearchText]);

    // Handle Deep Sync trigger from HomeScreen Navigation
    useEffect(() => {
        if (route.params?.startUniversalSync) {
            // Automatically launch the heavy gallery sync
            handleDeepSync();
            // Clear parameter so it doesn't re-trigger on subsequent un-related mounts
            navigation.setParams({ startUniversalSync: false });
        }
    }, [route.params?.startUniversalSync, handleDeepSync, navigation]);

    const handleBackPress = () => {
        Keyboard.dismiss();
        setIsSearching(false);
        // Delay state clearing so the Animated.timing isn't dropped by
        // native layout shifts caused by unmounting the Results List
        setTimeout(() => {
            setSearchText('');
        }, 300);
    };

    const handleSearchFocus = () => {
        setIsSearching(true);
    };

    const openImage = async (uri: string) => {
        Vibration.vibrate(10); // Light tick
        setSelectedImage(uri);
        await addRecentPhoto(uri);
    };

    const handleLookEverywhere = () => {
        // 1. Close Search State
        Keyboard.dismiss();
        setIsSearching(false);

        // Delay state clearing so the Animated.timing isn't dropped by
        // native layout shifts caused by unmounting the Results List
        setTimeout(() => {
            setSearchText('');
        }, 300);

        // 2. Open the Home Screen Drawer
        openDrawer();

        // 3. Trigger Universal Sync
        handleDeepSync();
        handleDocumentSync();
    };

    const renderSearchBar = (isTop: boolean) => (
        <SearchBar
            isTop={isTop}
            searchText={searchText}
            onChangeText={setSearchText}
            onFocus={handleSearchFocus}
            autoFocus={isSearching}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            isModelLoading={isModelLoading}
            onStartListening={startListening}
            onStopListening={stopListening}
            inputRef={searchInputRef}
        />
    );

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor="#05050A" />
            <View style={styles.glassBackground}>
                {/* Aurora Background */}
                <View style={styles.aurora1} />
                <View style={styles.aurora2} />
                <View style={styles.aurora3} />
            </View>

            <View style={styles.flex1}>
                {/* ────── NORMAL MODE (Glassmorphism Dashboard) ────── */}
                <HomeView
                    onOpenMenu={openDrawer}
                    isSyncing={isSyncing}
                    isSyncingDocs={isSyncingDocs}
                    isDeepSync={isDeepSync}
                    syncCount={syncCount}
                    docSyncCount={docSyncCount}
                    totalDocs={totalDocs}
                    lastSyncTime={lastSyncTime}
                    lastDocSyncTime={lastDocSyncTime}
                    onQuickSync={handleQuickSync}
                    onDocumentSync={() => handleDocumentSync(50)}
                    onSuggestion={text => {
                        setSearchText(text);
                        setIsSearching(true);
                    }}
                    searchBar={renderSearchBar(false)}
                />

                {/* ────── SEARCHING MODE OVERLAY ────── */}
                <SearchOverlay
                    visible={isSearching}
                    searchText={searchText}
                    results={searchResults}
                    isSearchPending={isSearchPending}
                    selectedFilter={selectedFilter}
                    onSelectFilter={setSelectedFilter}
                    history={searchHistory}
                    onSelectHistory={handleSelectHistory}
                    onDeleteHistory={handleDeleteHistory}
                    onClearHistory={handleClearHistory}
                    onBack={handleBackPress}
                    onLookEverywhere={handleLookEverywhere}
                    onOpenImage={openImage}
                    searchBar={renderSearchBar(true)}
                />
            </View>

            {/* GALLERY PREVIEW MODAL */}
            <PhotoPreviewModal
                uri={selectedImage}
                onClose={() => setSelectedImage(null)}
                onScan={uri => {
                    setSelectedImage(null);
                    navigation.navigate('SmartClipboard', { scanUri: uri });
                }}
                onEdit={handleEdit}
                onShare={handleShare}
            />

            {/* MODEL DOWNLOAD SHEET */}
            <ModelDownloadSheet
                visible={showModelSheet}
                onClose={() => setShowModelSheet(false)}
            />

            {/* SLIDING DRAWER & OVERLAY */}
            {isDrawerOpen && (
                <TouchableWithoutFeedback onPress={closeDrawer}>
                    <Animated.View style={styles.drawerOverlay} />
                </TouchableWithoutFeedback>
            )}
            <Animated.View
                style={[
                    styles.drawerContainer,
                    { transform: [{ translateX: drawerAnim }] }
                ]}
            >
                <HomeScreen navigation={navigation} onCloseDrawer={closeDrawer} />
            </Animated.View>
        </View>
    );
};

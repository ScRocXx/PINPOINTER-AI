import React, { useRef, useEffect, useState } from 'react';
import { ModelDownloadSheet, FilterCategory } from '../components';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import type { MainTabNavigationOptions } from '../navigation/MainTabs';
import { addRecentPhoto } from '../utils/RecentPhotos';
import {
    View,
    TextInput,
    Keyboard,
    Vibration,
    BackHandler,
} from 'react-native';
import { usePinpointerShared } from '../hooks/PinpointerContext';
import { Home } from './pinpointer/Home';
import { PhotoPreviewModal } from './pinpointer/PhotoPreviewModal';
import { SearchBar } from './pinpointer/SearchBar';
import { SearchOverlay } from './pinpointer/SearchOverlay';
import { styles } from './pinpointer/styles';

/**
 * Main Pinpointer screen: universal search over indexed photos and documents.
 *
 * Owns the screen's state and wiring; the parts live in `./pinpointer/`:
 * `Home` (at rest: search and mic, Find quickly, Important, indexing),
 * `SearchOverlay` (recent searches, filters, results), `ResultItem`,
 * `SearchBar` (with voice) and `PhotoPreviewModal`. The bottom tabs replaced
 * the old side menu.
 */
export const PinpointerScreen: React.FC = () => {
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

    const {
        searchText, setSearchText,
        searchResults,
        isSearching, setIsSearching, isSearchPending,
        selectedImage, setSelectedImage,
        isRecording, isTranscribing, isModelLoading,
        startListening, stopListening,
        handleShare, handleEdit,
        handleDeepSync, handleDocumentSync,
        searchHistory, handleSelectHistory, handleDeleteHistory, handleClearHistory,
    } = usePinpointerShared();

    const route = useRoute<RouteProp<RootStackParamList, 'Pinpointer'>>();

    const [showModelSheet, setShowModelSheet] = useState(false);
    const [selectedFilter, setSelectedFilter] = useState<FilterCategory>('ALL');

    const searchInputRef = useRef<TextInput>(null);

    // Search uses the whole screen: hide the tab bar.
    // (This screen is a tab; the stack-typed navigation doesn't know the option.)
    useEffect(() => {
        const tabs = navigation as unknown as { setOptions?: (options: MainTabNavigationOptions) => void };
        tabs.setOptions?.({ tabBarHidden: isSearching });
    }, [isSearching, navigation]);

    useEffect(() => {
        const backAction = () => {
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
    }, [isSearching, setIsSearching, setSearchText]);

    // Another screen can ask for a look through all photos (startUniversalSync)
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

        // 2. Look through all photos and papers; Home shows the progress
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
            <View style={styles.flex1}>
                {/* ────── HOME (at rest) ────── */}
                <Home onOpenImage={openImage} />

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
        </View>
    );
};

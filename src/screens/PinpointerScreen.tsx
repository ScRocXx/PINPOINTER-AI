import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ModelDownloadSheet } from '../components';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import type { MainTabNavigationOptions } from '../navigation/MainTabs';
import { addRecentPhoto } from '../utils/RecentPhotos';
import { PhotoViewer, ViewerItem } from '../components/PhotoViewer';
import { DocumentRecord } from '../database';
import { matchTermsIn } from '../utils/MatchTerms';
import { visibleContent } from '../utils/SearchKeys';
import {
    View,
    TextInput,
    Keyboard,
    Vibration,
    BackHandler,
} from 'react-native';
import { usePinpointerShared } from '../hooks/PinpointerContext';
import { Home } from './pinpointer/Home';
import { SearchBar } from './pinpointer/SearchBar';
import { SearchOverlay } from './pinpointer/SearchOverlay';
import { styles } from './pinpointer/styles';

/**
 * Main Pinpointer screen: universal search over indexed photos and documents.
 *
 * Owns the screen's state and wiring; the parts live in `./pinpointer/`:
 * `Home` (at rest: search and mic, Find quickly, Important, indexing),
 * `SearchOverlay` (recent searches, filters, results, listening, nothing
 * found), `ResultItem` and `SearchBar` (with voice). Photos open in the shared
 * `PhotoViewer`. The bottom tabs replaced the old side menu.
 */
export const PinpointerScreen: React.FC = () => {
    const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();

    const {
        searchText, setSearchText,
        searchResults, resultsQuery, correctedFrom, dateMeaning,
        isSearching, setIsSearching, isSearchPending,
        isRecording, isTranscribing, isModelLoading,
        startListening, stopListening, cancelListening,
        isSyncing, isPaused, syncCount, totalImages,
        handleDeepSync, handleDocumentSync,
        searchHistory, handleSelectHistory, handleDeleteHistory, handleClearHistory,
    } = usePinpointerShared();

    const route = useRoute<RouteProp<RootStackParamList, 'Pinpointer'>>();

    const [showModelSheet, setShowModelSheet] = useState(false);
    // The photos as they were when one was tapped, so a re-rank underneath
    // doesn't move the viewer to another photo.
    const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number; query: string } | null>(null);
    const [viewerAt, setViewerAt] = useState(0);

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
                // Closing search also stops the mic, so it can't reopen search later.
                if (isRecording || isTranscribing) cancelListening();
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
    }, [isSearching, isRecording, isTranscribing, cancelListening, setIsSearching, setSearchText]);

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
        if (isRecording || isTranscribing) cancelListening();
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

    const showPhotos = useCallback((items: ViewerItem[], index: number, query: string) => {
        if (!items[index]) return;
        Vibration.vibrate(10); // Light tick
        setViewer({ items, index, query });
        setViewerAt(index);
        addRecentPhoto(items[index].uri);
    }, []);

    /** A photo from Home (Important, recent): the viewer reads its words from the index. */
    const openImage = useCallback((uri: string) => showPhotos([{ uri }], 0, ''), [showPhotos]);

    /** A photo result: swipe through the photo results, with the searched words marked. */
    const openPhotoResult = useCallback((photos: ReadonlyArray<DocumentRecord>, index: number) => {
        const items: ViewerItem[] = photos.map(p => ({
            uri: p.filePath,
            // Labels ("Dog, Grass") are what ML Kit saw, not words in the photo.
            text: p.detection_type === 'OBJECT' ? '' : visibleContent(p.content),
        }));
        showPhotos(items, index, searchText);
    }, [searchText, showPhotos]);

    const viewerTerms = useMemo(() => {
        const item = viewer?.items[viewerAt];
        return item?.text && viewer?.query ? matchTermsIn(item.text, viewer.query) : [];
    }, [viewer, viewerAt]);

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
            active={isTop && isSearchPending}
            inputRef={searchInputRef}
        />
    );

    return (
        <View style={styles.container}>
            <View style={styles.flex1}>
                {/* ────── HOME (at rest) ────── */}
                {/* Search covers Home: keep TalkBack off what is underneath. */}
                <View
                    style={styles.flex1}
                    importantForAccessibility={isSearching ? 'no-hide-descendants' : 'auto'}
                    accessibilityElementsHidden={isSearching}
                >
                    <Home onOpenImage={openImage} />
                </View>

                {/* ────── SEARCHING MODE OVERLAY ────── */}
                <SearchOverlay
                    visible={isSearching}
                    searchText={searchText}
                    results={searchResults}
                    resultsQuery={resultsQuery}
                    correctedFrom={correctedFrom}
                    dateMeaning={dateMeaning}
                    isSearchPending={isSearchPending}
                    history={searchHistory}
                    onSelectHistory={handleSelectHistory}
                    onDeleteHistory={handleDeleteHistory}
                    onClearHistory={handleClearHistory}
                    onBack={handleBackPress}
                    onLookEverywhere={handleLookEverywhere}
                    onOpenPhoto={openPhotoResult}
                    isRecording={isRecording}
                    isTranscribing={isTranscribing}
                    onStopListening={stopListening}
                    onCancelListening={cancelListening}
                    indexing={isSyncing && !isPaused ? { done: syncCount, total: totalImages || undefined } : null}
                    searchBar={renderSearchBar(true)}
                />
            </View>

            {/* PHOTO VIEWER */}
            <PhotoViewer
                items={viewer?.items ?? []}
                index={viewer ? viewer.index : null}
                onClose={() => setViewer(null)}
                onIndexChange={i => {
                    setViewerAt(i);
                    const uri = viewer?.items[i]?.uri;
                    if (uri) addRecentPhoto(uri);
                }}
                onReadText={uri => {
                    setViewer(null);
                    navigation.navigate('SmartClipboard', { scanUri: uri });
                }}
                highlightTerms={viewerTerms}
                testID="search-photo-viewer"
            />

            {/* MODEL DOWNLOAD SHEET */}
            <ModelDownloadSheet
                visible={showModelSheet}
                onClose={() => setShowModelSheet(false)}
            />
        </View>
    );
};

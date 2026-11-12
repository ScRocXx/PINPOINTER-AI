import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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
    StyleSheet,
    Vibration,
    BackHandler,
} from 'react-native';
import { usePinpointerShared } from '../hooks/PinpointerContext';
import { useIndexingProgress } from '../hooks/useIndexingProgress';
import { usePhotoAccess } from '../hooks/useStorageAccess';
import { Colors } from '../theme';
import { Home } from './pinpointer/Home';
import { SearchBar } from './pinpointer/SearchBar';
import { SearchOverlay } from './pinpointer/SearchOverlay';

/** How long the search screen takes to leave, before its words are cleared. */
const CLOSE_CLEAR_MS = 300;

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
        searchResults,
        isSearching, setIsSearching, isSearchPending,
        isRecording, isTranscribing, isModelLoading,
        startListening, stopListening, cancelListening,
        handleDeepSync, handleDocumentSync,
        searchHistory, handleSelectHistory, handleDeleteHistory, handleClearHistory,
    } = usePinpointerShared();

    const route = useRoute<RouteProp<RootStackParamList, 'Pinpointer'>>();

    // What is being got ready right now, whoever started it (Home, the first
    // run, the charging-time job). Counted again when photo access changes.
    const { access: photoAccess } = usePhotoAccess();
    const progress = useIndexingProgress(photoAccess);
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

    // Closing search clears its words once it has slid away. Opening it again
    // (a "Find quickly" tile, a recent search) before then keeps the new words.
    const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelClear = useCallback(() => {
        if (clearTimer.current) {
            clearTimeout(clearTimer.current);
            clearTimer.current = null;
        }
    }, []);
    useEffect(() => {
        if (isSearching) cancelClear();
    }, [isSearching, cancelClear]);
    useEffect(() => cancelClear, [cancelClear]);

    const closeSearch = useCallback(() => {
        // Closing search also stops the mic, so it can't reopen search later.
        if (isRecording || isTranscribing) cancelListening();
        Keyboard.dismiss();
        setIsSearching(false);
        cancelClear();
        clearTimer.current = setTimeout(() => {
            clearTimer.current = null;
            setSearchText('');
        }, CLOSE_CLEAR_MS);
    }, [isRecording, isTranscribing, cancelListening, setIsSearching, setSearchText, cancelClear]);

    // Android back closes search first; from Home it leaves the app.
    useEffect(() => {
        if (!isSearching) return;
        const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
            closeSearch();
            return true;
        });
        return () => backHandler.remove();
    }, [isSearching, closeSearch]);

    // Another screen can ask for a look through all photos (startUniversalSync)
    useEffect(() => {
        if (route.params?.startUniversalSync) {
            // Automatically launch the heavy gallery sync
            handleDeepSync();
            // Clear parameter so it doesn't re-trigger on subsequent un-related mounts
            navigation.setParams({ startUniversalSync: false });
        }
    }, [route.params?.startUniversalSync, handleDeepSync, navigation]);

    // The mic is the tab bar's middle button, on every tab. Listening always
    // shows on the search screen, so open it when the mic starts.
    useEffect(() => {
        if (isRecording) setIsSearching(true);
    }, [isRecording, setIsSearching]);

    const openScan = useCallback(() => navigation.navigate('SmartClipboard'), [navigation]);

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
        closeSearch();
        // Look through all photos and papers; Home shows the progress. Papers
        // are checked without a pop-up: the person asked about photos.
        handleDeepSync();
        handleDocumentSync(undefined, false, false);
    };

    const searchBar = (
        <SearchBar
            isTop
            searchText={searchText}
            onChangeText={setSearchText}
            onFocus={handleSearchFocus}
            autoFocus={isSearching && !isRecording && !isTranscribing}
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            isModelLoading={isModelLoading}
            onStartListening={startListening}
            onStopListening={stopListening}
            active={isSearchPending}
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
                    <Home onOpenImage={openImage} onScan={openScan} progress={progress} />
                </View>

                {/* ────── SEARCHING MODE OVERLAY ────── */}
                <SearchOverlay
                    visible={isSearching}
                    searchText={searchText}
                    results={searchResults}
                    isSearchPending={isSearchPending}
                    history={searchHistory}
                    onSelectHistory={handleSelectHistory}
                    onDeleteHistory={handleDeleteHistory}
                    onClearHistory={handleClearHistory}
                    onBack={closeSearch}
                    onLookEverywhere={handleLookEverywhere}
                    onOpenPhoto={openPhotoResult}
                    isRecording={isRecording}
                    isTranscribing={isTranscribing}
                    onStopListening={stopListening}
                    onCancelListening={cancelListening}
                    indexing={progress.photos.running
                        ? { done: progress.photos.done, total: progress.photos.total ?? undefined }
                        : null}
                    searchBar={searchBar}
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
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.canvas },
    flex1: { flex: 1 },
});

import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, FlatList, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FilterCategory, SearchFilterChips, SearchHistoryPanel } from '../../components';
import { DocumentRecord } from '../../database';
import { SearchHistoryItem } from '../../utils/SearchHistory';
import { AppColors } from '../../theme';
import { ResultItem } from './ResultItem';
import { styles } from './styles';

export interface SearchOverlayProps {
    /** Search is open (slides up and fades in). */
    visible: boolean;
    searchText: string;
    results: DocumentRecord[];
    isSearchPending: boolean;
    selectedFilter: FilterCategory;
    onSelectFilter: (filter: FilterCategory) => void;
    history: SearchHistoryItem[];
    onSelectHistory: (query: string) => void;
    onDeleteHistory: (query: string) => void;
    onClearHistory: () => void;
    onBack: () => void;
    /** "Not found" call to action: look through the whole phone. */
    onLookEverywhere: () => void;
    onOpenImage: (uri: string) => void;
    /** The editable search bar at the top. */
    searchBar: React.ReactNode;
}

/** Search mode: back arrow, search bar, recent searches or filtered results. */
export const SearchOverlay: React.FC<SearchOverlayProps> = ({
    visible,
    searchText,
    results,
    isSearchPending,
    selectedFilter,
    onSelectFilter,
    history,
    onSelectHistory,
    onDeleteHistory,
    onClearHistory,
    onBack,
    onLookEverywhere,
    onOpenImage,
    searchBar,
}) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const resultsSlideAnim = useRef(new Animated.Value(20)).current;
    const slideAnim = useRef(new Animated.Value(1200)).current;

    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
                Animated.timing(resultsSlideAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
                Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 55, useNativeDriver: true })
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
                Animated.timing(resultsSlideAnim, { toValue: 20, duration: 200, useNativeDriver: true }),
                Animated.timing(slideAnim, { toValue: 1200, duration: 250, useNativeDriver: true })
            ]).start();
        }
    }, [visible, fadeAnim, resultsSlideAnim, slideAnim]);

    return (
        <Animated.View
            pointerEvents={visible ? 'auto' : 'none'}
            style={[
                StyleSheet.absoluteFillObject,
                styles.searchOverlayBase,
                { opacity: fadeAnim }
            ]}
        >
            <View style={styles.glassBackground}>
                {/* Aurora Background overlay for drawer */}
                <View style={styles.aurora1} />
                <View style={styles.aurora2} />
                <View style={styles.aurora3} />
            </View>

            <View style={styles.glassHeaderRow}>
                <Pressable
                    onPressIn={onBack}
                    style={styles.headerMenuButton}
                    accessibilityLabel="Close search"
                >
                    <View style={styles.backArrowWrap}>
                        <View style={styles.backArrow} />
                    </View>
                </Pressable>
                <Text style={styles.glassHeaderTitle}>Pinpointer</Text>
            </View>

            <Animated.View style={[styles.searchingContainer, { transform: [{ translateY: slideAnim }] }]}>
                {/* Search bar pinned at top */}
                {searchBar}

                {/* Search History — shown when focused but no text typed */}
                {!searchText.trim() ? (
                    <View style={styles.searchContentArea}>
                        <SearchHistoryPanel
                            history={history}
                            onSelect={onSelectHistory}
                            onDelete={onDeleteHistory}
                            onClearAll={onClearHistory}
                        />
                    </View>
                ) : (
                    /* Results Section */
                    <Animated.View
                        style={[
                            styles.resultsContainer,
                            { opacity: fadeAnim, transform: [{ translateY: resultsSlideAnim }] }
                        ]}
                    >
                        <SearchFilterChips
                            selectedFilter={selectedFilter}
                            onSelectFilter={onSelectFilter}
                        />
                        <Text style={styles.sectionHeader}>
                            {selectedFilter === 'ALL' ? 'Top Results' : (selectedFilter === 'IMAGE' ? 'Found in Photos' : 'Found in Documents')}
                        </Text>
                        <FlatList
                            data={results.filter(item => selectedFilter === 'ALL' || item.type === selectedFilter)}
                            renderItem={({ item }) => <ResultItem item={item} searchText={searchText} onOpenImage={onOpenImage} />}
                            keyExtractor={(item) => item.filePath || String(item.id)}
                            contentContainerStyle={styles.resultsList}
                            showsVerticalScrollIndicator={false}
                            ListEmptyComponent={
                                isSearchPending ? (
                                    <View style={styles.emptyLoadingWrap}>
                                        <ActivityIndicator size="large" color={AppColors.accentCyan} />
                                    </View>
                                ) : (
                                    <View style={styles.emptyWrap}>
                                        <Text style={styles.subTitle}>No matches found.</Text>
                                        <Text style={styles.emptyHintText}>
                                            Not in the last 300 photos?
                                        </Text>
                                        <TouchableOpacity
                                            onPress={onLookEverywhere}
                                            style={styles.syncCtaButton}
                                            accessibilityLabel="Start Universal Sync"
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.syncCtaText}>
                                                ⚡ Start Universal Sync
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                )
                            }
                        />
                    </Animated.View>
                )}
            </Animated.View>
        </Animated.View>
    );
};

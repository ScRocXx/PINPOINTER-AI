import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { styles } from './styles';

export interface HomeViewProps {
    onOpenMenu: () => void;
    isSyncing: boolean;
    isSyncingDocs: boolean;
    isDeepSync: boolean;
    syncCount: number;
    docSyncCount: number;
    totalDocs: number;
    lastSyncTime: number | null;
    lastDocSyncTime: number | null;
    onQuickSync: () => void;
    onDocumentSync: () => void;
    /** A suggestion pill was tapped: search for this text. */
    onSuggestion: (text: string) => void;
    /** The search bar at the bottom (opens search). */
    searchBar: React.ReactNode;
}

const formatRelativeTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never synced';
    const now = Date.now();
    const diffInSecs = Math.floor((now - timestamp) / 1000);

    if (diffInSecs < 60) return 'now';
    if (diffInSecs < 3600) return `${Math.floor(diffInSecs / 60)}m ago`;
    if (diffInSecs < 86400) return `${Math.floor(diffInSecs / 3600)}h ago`;

    const days = Math.floor(diffInSecs / 86400);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
};

const SyncButton: React.FC<{ label: string; subtitle: string; color: string; onPress: () => void; active: boolean }> = ({
    label,
    subtitle,
    color,
    onPress,
    active,
}) => {
    const syncButtonStyle: StyleProp<ViewStyle> = [
        styles.solidButton,
        { backgroundColor: color, opacity: active ? 0.7 : 1 },
    ];
    return (
        <>
            <TouchableOpacity
                style={syncButtonStyle}
                onPress={onPress}
                disabled={active}
            >
                <Text style={styles.dashboardButtonText}>
                    {active ? 'Scanning...' : label}
                </Text>
            </TouchableOpacity>
            <Text style={styles.dashboardButtonSubtitle}>{subtitle}</Text>
        </>
    );
};

/** The search screen at rest: header, indexing card, suggestions, search bar. */
export const HomeView: React.FC<HomeViewProps> = ({
    onOpenMenu,
    isSyncing,
    isSyncingDocs,
    isDeepSync,
    syncCount,
    docSyncCount,
    totalDocs,
    lastSyncTime,
    lastDocSyncTime,
    onQuickSync,
    onDocumentSync,
    onSuggestion,
    searchBar,
}) => {
    // --- Loading UI Animations ---
    const syncProgress = useRef(new Animated.Value(0)).current;
    const syncSpinAnim = useRef(new Animated.Value(0)).current;
    const syncFadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isSyncing || isSyncingDocs) {
            // Entrance fade
            Animated.timing(syncFadeAnim, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
            }).start();

            // Spinning loader
            Animated.loop(
                Animated.timing(syncSpinAnim, {
                    toValue: 1,
                    duration: 1200,
                    easing: Easing.linear,
                    useNativeDriver: true,
                })
            ).start();
        } else {
            syncSpinAnim.stopAnimation();
            syncFadeAnim.setValue(0);
            syncSpinAnim.setValue(0);
            // reset progress for next time
            syncProgress.setValue(0);
        }
    }, [isSyncing, isSyncingDocs, syncFadeAnim, syncSpinAnim, syncProgress]);

    // Animate progress bar as items process
    useEffect(() => {
        let targetProgress = 0;
        if (isSyncing) {
            targetProgress = Math.min(syncCount / 50, 1);
        } else if (isSyncingDocs && totalDocs > 0) {
            targetProgress = Math.min(docSyncCount / totalDocs, 1);
        }

        Animated.timing(syncProgress, {
            toValue: targetProgress,
            duration: 300, // Smooth 300ms catchup
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
        }).start();
    }, [syncCount, docSyncCount, totalDocs, isSyncing, isSyncingDocs, syncProgress]);

    return (
        <View style={StyleSheet.absoluteFillObject}>
            <View style={styles.glassHeaderRow}>
                <TouchableOpacity
                    style={styles.headerMenuButton}
                    onPress={onOpenMenu}
                    accessibilityLabel="Open menu"
                >
                    <Text style={styles.headerMenuIcon}>☰</Text>
                </TouchableOpacity>
                <Text style={styles.glassHeaderTitle}>Pinpointer</Text>
            </View>

            <View style={styles.dashboardMiddleSection}>
                <View style={styles.flex1} />

                <View style={styles.indexingCard}>
                    {(isSyncing || isSyncingDocs) && !isDeepSync ? (
                        <Animated.View style={[styles.fullWidth, { opacity: syncFadeAnim }]}>
                            <View style={styles.loadingBoxContainer}>
                                <LinearGradient
                                    colors={['rgba(0, 217, 255, 0.12)', 'rgba(0, 217, 255, 0.03)']}
                                    style={styles.loadingBox}
                                >
                                    <View style={styles.loadingHeaderRow}>
                                        <View style={styles.loadingLoaderContainer}>
                                            <Animated.View style={[styles.loadingSpinner, { transform: [{ rotate: syncSpinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
                                                <LinearGradient colors={['#00D9FF', 'transparent']} style={StyleSheet.absoluteFill} />
                                            </Animated.View>
                                            <View style={styles.loadingSpinnerCenterMask} />
                                        </View>

                                        <View style={styles.loadingShieldBadge}>
                                            <Text style={styles.loadingShieldEmoji}>🛡️</Text>
                                            <View style={styles.loadingLiveDot} />
                                        </View>
                                    </View>

                                    <Text style={styles.loadingSubtitle}>
                                        {isSyncing
                                            ? `Analyzing images on-device...`
                                            : `Analyzing docs on-device...`}
                                    </Text>

                                    <View style={styles.loadingProgressTrack}>
                                        <Animated.View style={[styles.loadingProgressBar, { width: syncProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}>
                                            <LinearGradient
                                                colors={['#00D9FF', '#00A3FF']}
                                                start={{ x: 0, y: 0 }}
                                                end={{ x: 1, y: 0 }}
                                                style={StyleSheet.absoluteFill}
                                            />
                                        </Animated.View>
                                    </View>

                                    <View style={styles.loadingFooterRow}>
                                        <Text style={styles.loadingPrivacyText}>
                                            100% private. No data leaves this device.
                                        </Text>
                                    </View>
                                </LinearGradient>
                            </View>
                        </Animated.View>
                    ) : (
                        <View style={styles.dashboardActions}>
                            <View style={styles.actionColumn}>
                                <SyncButton
                                    label="Scan Images"
                                    subtitle={`last synced ${formatRelativeTime(lastSyncTime)}`}
                                    color="#0F766E"
                                    onPress={onQuickSync}
                                    active={isSyncing}
                                />
                            </View>
                            <View style={styles.actionColumn}>
                                <SyncButton
                                    label="Scan docs"
                                    subtitle={`last synced ${formatRelativeTime(lastDocSyncTime)}`}
                                    color="#4C1D95"
                                    onPress={onDocumentSync}
                                    active={isSyncingDocs}
                                />
                            </View>
                        </View>
                    )}
                </View>

                {/* Filling the Middle Void */}
                <View style={styles.middleVoidContainer}>
                    <Text style={styles.middleVoidText}>Ready to search your offline vault.</Text>
                    <View style={styles.suggestionRow}>
                        <TouchableOpacity style={styles.suggestionPill} onPress={() => onSuggestion('Aadhaar')}>
                            <Text style={styles.suggestionText}>Find Aadhaar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.suggestionPill} onPress={() => onSuggestion('cat')}>
                            <Text style={styles.suggestionText}>Image of my cat</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {searchBar}
            </View>
        </View>
    );
};

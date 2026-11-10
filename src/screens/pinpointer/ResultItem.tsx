import React from 'react';
import { Alert, Image, Linking, NativeModules, Text, TouchableOpacity, Vibration, View } from 'react-native';
import RNFS from 'react-native-fs';
import { DocumentRecord, extractSnippet } from '../../database';
import { classifyDocument } from '../../utils/DocumentClassifier';
import { forgetIfGone } from '../../utils/MissingFiles';
import { AppLogger } from '../../utils/AppLogger';
import { styles } from './styles';

const { StorageModule } = NativeModules;

/** The title with the first searched word marked. */
const HighlightedSnippet: React.FC<{ text: string; query: string }> = ({ text, query }) => {
    if (!text || !query) return <Text style={styles.resultTitle} numberOfLines={2}>{text}</Text>;
    const lower = text.toLowerCase();
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    // Find the first matching word position
    let bestPos = -1;
    let bestWord = '';
    for (const w of words) {
        const pos = lower.indexOf(w);
        if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
            bestPos = pos;
            bestWord = w;
        }
    }

    if (bestPos === -1) return <Text style={styles.resultTitle} numberOfLines={2}>{text}</Text>;

    const before = text.substring(0, bestPos);
    const match = text.substring(bestPos, bestPos + bestWord.length);
    const after = text.substring(bestPos + bestWord.length);

    return (
        <Text style={styles.resultTitle} numberOfLines={2}>
            {before}
            <Text style={styles.highlightText}>{match}</Text>
            {after}
        </Text>
    );
};

export interface ResultItemProps {
    item: DocumentRecord;
    searchText: string;
    /** Open a photo in the preview. PDFs open in the phone's PDF app. */
    onOpenImage: (uri: string) => void;
}

/** One search result: thumbnail or document icon, title, snippet, type. */
export const ResultItem: React.FC<ResultItemProps> = ({ item, searchText, onOpenImage }) => {
    const snippet = extractSnippet(item.content || '', searchText);

    return (
        <TouchableOpacity
            style={styles.resultItem}
            onPress={async () => {
                Vibration.vibrate(10);
                // A file deleted from the phone is taken out of search right away.
                if (await forgetIfGone(item.filePath, item.type)) {
                    Alert.alert('File Not Found', 'This file was deleted from your phone, so it was removed from search.');
                    return;
                }
                if (item.type === 'DOCUMENT') {
                    const cleanPath = item.filePath.replace('file://', '');
                    const exists = await RNFS.exists(cleanPath).catch(() => false);
                    if (!exists) {
                        Alert.alert('File Not Found', 'This file may have been deleted from your device.');
                        return;
                    }
                    if (StorageModule && StorageModule.openPDF) {
                        StorageModule.openPDF(cleanPath);
                    } else {
                        Linking.openURL(item.filePath).catch(e => AppLogger.error('Pinpointer', 'Failed to open document URL', e));
                    }
                } else {
                    onOpenImage(item.filePath);
                }
            }}
            accessibilityLabel={`View file: ${item.content?.substring(0, 40)} `}
            accessibilityRole="button"
        >
            {/* Thumbnail */}
            <View style={styles.resultIconContainer}>
                {item.type === 'DOCUMENT' ? (
                    <Text style={styles.documentEmoji}>{classifyDocument(item.content || '', item.filePath.split('/').pop() || '').emoji}</Text>
                ) : (
                    <Image
                        source={{ uri: item.filePath }}
                        style={styles.resultThumbnail}
                        resizeMode="cover"
                    />
                )}
            </View>
            <View style={styles.resultTextContainer}>
                {item.type === 'DOCUMENT'
                    ? <HighlightedSnippet text={item.title || item.filePath.split('/').pop() || ''} query={searchText} />
                    : <HighlightedSnippet text={snippet} query={searchText} />
                }
                {snippet ? (
                    <Text style={styles.resultSnippet} numberOfLines={1}>
                        {snippet}
                    </Text>
                ) : null}
                <Text style={styles.resultSubtitle}>
                    {item.type === 'DOCUMENT'
                        ? '📄 Document • Tap to open'
                        : (item.detection_type === 'OBJECT' ? '🏷 Object' : '📝 Text') + ' • Tap to view'}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

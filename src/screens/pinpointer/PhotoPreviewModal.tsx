import React from 'react';
import { Image, Modal, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { styles } from './styles';

const ScanIcon = ({ size = 22, color = '#fff' }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx="11" cy="11" r="8" />
        <Path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
    </Svg>
);

export interface PhotoPreviewModalProps {
    /** The photo on show; null hides the viewer. */
    uri: string | null;
    onClose: () => void;
    /** Read the text in this photo (opens Scan). */
    onScan: (uri: string) => void;
    onEdit: () => void;
    onShare: () => void;
}

/** Full-screen photo with close, scan, edit and share. Pinch to zoom. */
export const PhotoPreviewModal: React.FC<PhotoPreviewModalProps> = ({ uri, onClose, onScan, onEdit, onShare }) => {
    const { width, height } = useWindowDimensions();
    return (
        <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalContainer}>
                <View style={styles.modalHeader}>
                    <TouchableOpacity
                        onPress={onClose}
                        accessibilityLabel="Close image"
                        accessibilityRole="button"
                    >
                        <Text style={styles.headerIcon}>✕</Text>
                    </TouchableOpacity>
                    <View style={styles.modalActions}>
                        <TouchableOpacity
                            onPress={() => {
                                if (uri) {
                                    onScan(uri);
                                }
                            }}
                            style={styles.actionBtn}
                            accessibilityLabel="Scan image"
                            accessibilityRole="button"
                        >
                            <ScanIcon size={24} color="#FFF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={onEdit}
                            style={styles.actionBtn}
                            accessibilityLabel="Edit image"
                            accessibilityRole="button"
                        >
                            <Text style={styles.headerIcon}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={onShare}
                            accessibilityLabel="Share image"
                            accessibilityRole="button"
                        >
                            <Text style={styles.headerIcon}>📤</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <ScrollView maximumZoomScale={5} contentContainerStyle={styles.scrollContainer}>
                    {uri && (
                        <Image
                            source={{ uri }}
                            style={{ width: width, height: height * 0.8 }}
                            resizeMode="contain"
                        />
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};

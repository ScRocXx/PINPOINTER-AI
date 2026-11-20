/**
 * Duplicates.ts — WhatsApp keeps byte-identical copies of a forwarded photo
 * in several folders (received, sent, Downloads). A copy whose bytes match a
 * photo already read takes that photo's words and vector instead of being
 * decoded, read and encoded again; search shows such copies once.
 */
import { NativeModules } from 'react-native';
import type { DocumentRecord } from '../database/types';
import { AppLogger } from './AppLogger';

/** The file's fingerprint (PhotoReader.fingerprint), or null when it can't be had. */
export const fingerprintOf = async (uri: string): Promise<string | null> => {
    const reader = NativeModules.PhotoReader as { fingerprint?: (uri: string) => Promise<string> } | undefined;
    if (!reader?.fingerprint) return null;
    try {
        const fp = await reader.fingerprint(uri);
        return typeof fp === 'string' && fp.length > 0 ? fp : null;
    } catch (e) {
        AppLogger.warn('Duplicates', 'Could not fingerprint a photo', e);
        return null;
    }
};

/**
 * Results with each byte-identical copy once, kept where it first ranks.
 * Only real copies (same fingerprint): two photos that merely say the same
 * thing, like this month's and last month's bill, both stay.
 */
export const collapseCopies = (
    docs: DocumentRecord[],
    fingerprints: ReadonlyMap<string, string>,
): DocumentRecord[] => {
    if (fingerprints.size === 0) return docs;
    const seen = new Set<string>();
    return docs.filter(d => {
        const fp = fingerprints.get(d.filePath);
        if (!fp) return true;
        if (seen.has(fp)) return false;
        seen.add(fp);
        return true;
    });
};

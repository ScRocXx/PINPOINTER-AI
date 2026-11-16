import { useEffect, useCallback } from 'react';
import { useSearch } from './useSearch';
import { useGallerySync } from './useGallerySync';
import { useDocumentSync } from './useDocumentSync';
import { useVoiceRecording } from './useVoiceRecording';

/**
 * usePinpointer — thin composition hook wiring search, sync, and voice.
 */
export const usePinpointer = () => {
    // --- Sub-hooks ---
    const {
        searchText, setSearchText, debouncedSearchText,
        searchResults, correctedFrom, dateMeaning, newestFirst,
        isSearching, setIsSearching, isSearchPending,
        searchHistory,
        handleSelectHistory, handleDeleteHistory, handleClearHistory,
    } = useSearch(true); // DB is initialized in App.tsx

    const {
        isSyncing, isPaused, isDeepSync, syncCount, lastSyncTime,
        handleQuickSync, handleDeepSync, handlePauseSync, handleResumeSync,
        loadPersistedCount,
    } = useGallerySync();

    const {
        isSyncingDocs, docSyncCount, totalDocs, lastDocSyncTime,
        handleDocumentSync, loadPersistedState: loadPersistedDocs
    } = useDocumentSync();

    // Voice: deliver transcription into the search bar
    const onTranscription = useCallback((text: string) => {
        let cleanedText = text.toLowerCase().trim();

        // Strip common conversational voice prefixes
        const prefixes = [
            'search for my ', 'search for a ', 'search for ', 'search my ', 'search ',
            'find my ', 'find a ', 'find ',
            'look for my ', 'look for a ', 'look for ',
            'where is my ', 'where is the ', 'where is a ', 'where is ',
            'show me my ', 'show me the ', 'show me a ', 'show me ',
        ];

        for (const prefix of prefixes) {
            if (cleanedText.startsWith(prefix)) {
                cleanedText = cleanedText.substring(prefix.length).trim();
                break;
            }
        }

        // Remove trailing punctuation STT models often add (e.g. "Aadhar card.")
        cleanedText = cleanedText.replace(/[.!?]$/, '').trim();

        // If the user *just* said "search" and nothing else, fallback to raw text gracefully
        const finalText = cleanedText || text.trim();

        setSearchText(finalText);
        setIsSearching(true);
    }, [setSearchText, setIsSearching]);

    const {
        isRecording, isTranscribing, isModelLoading,
        startListening, stopListening, cancelListening,
        cleanupRecording,
    } = useVoiceRecording(onTranscription);

    // --- Init: load persisted index count ---
    useEffect(() => {
        loadPersistedCount();
        loadPersistedDocs();
        return () => {
            cleanupRecording();
        };
    }, [loadPersistedCount, loadPersistedDocs, cleanupRecording]);

    return {
        // Search
        searchText, setSearchText, searchResults, isSearching, setIsSearching, isSearchPending,
        // The query the current results were found for (lags typing by the debounce;
        // a corrected query when the typed words found nothing).
        resultsQuery: debouncedSearchText,
        // What was typed, when the results are for a corrected query.
        correctedFrom,
        // What the query's date words meant ("Diwali, every year").
        dateMeaning,
        // "latest bill", "pichla bill": the results are newest first.
        newestFirst,
        searchHistory, handleSelectHistory, handleDeleteHistory, handleClearHistory,

        // Voice
        isRecording, isTranscribing, isModelLoading,
        startListening, stopListening, cancelListening,

        // Sync
        isSyncing, isPaused, isDeepSync, syncCount, lastSyncTime,
        handleQuickSync, handleDeepSync, handlePauseSync, handleResumeSync,
        isSyncingDocs, docSyncCount, totalDocs, lastDocSyncTime, handleDocumentSync,
    };
};
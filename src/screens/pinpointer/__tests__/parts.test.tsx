import React from 'react';
import { AccessibilityInfo, Alert, NativeEventEmitter, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { DocumentRecord } from '../../../database';
import { ListeningPanel } from '../ListeningPanel';
import { MatchedSnippet } from '../MatchedSnippet';
import { NothingFound } from '../NothingFound';
import { RecentSearches } from '../RecentSearches';
import { ResultItem } from '../ResultItem';
import { SearchBar, SearchBarProps } from '../SearchBar';

jest.mock('react-native-svg', () => require('../../../components/ui/__tests__/svgMock').default);

const NOW = new Date(2026, 10, 10, 15, 0, 0).getTime();
const HOUR = 3600 * 1000;

const record = (over: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 1,
  content: 'electricity bill for March',
  filePath: 'file:///photos/bill.jpg',
  type: 'IMAGE',
  detection_type: 'TEXT',
  timestamp: NOW - HOUR,
  ...over,
});

/** Give a measured width to the hidden copy of the first matched word. */
const layout = async (testID: string, width: number) => {
  await act(async () => {
    fireEvent(screen.getByTestId(testID, { includeHiddenElements: true }), 'layout', { nativeEvent: { layout: { width, height: 24, x: 0, y: 0 } } });
  });
};

describe('ResultItem', () => {
  it('shows a photo as "Photo" with its matched words marked, and opens it', async () => {
    const onPress = jest.fn();
    const item = record();
    await render(<ResultItem item={item} query="bill" index={0} onPress={onPress} />);
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByTestId('result-item-thumb')).toBeTruthy();
    expect(screen.getAllByTestId('highlight-match')[0]).toHaveTextContent('bill');

    const row = screen.getByRole('button', { name: /^Photo\. bill for March/ });
    expect(row.props.accessibilityHint).toBe('Opens the photo');
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledWith(item);
  });

  it('shows a paper as "Paper" with its kind, title and when it was added', async () => {
    await render(
      <ResultItem
        item={record({
          type: 'DOCUMENT',
          title: 'Electricity bill March',
          content: 'BSES electricity bill. Amount due 1240. Units consumed 210 kWh.',
          filePath: 'file:///docs/bill.pdf',
        })}
        query="amount"
        index={1}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Paper')).toBeTruthy();
    expect(screen.getByText('Electricity bill March')).toBeTruthy();
    expect(screen.getByTestId('result-item-tile')).toBeTruthy();
    expect(screen.getByText(/^Added /)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Paper\./ }).props.accessibilityHint).toBe('Opens the paper');
  });

  it('says what a photo shows when it was found by its labels', async () => {
    await render(
      <ResultItem
        item={record({ detection_type: 'OBJECT', content: 'Dog, Grass' })}
        query="dog"
        index={0}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByTestId('result-item-snippet')).toHaveTextContent('Shows: Dog, Grass');
    // No corners on labels: the word's place isn't known.
    expect(screen.queryByTestId('result-item-snippet-measure')).toBeNull();
  });

  it('says a photo "looks like" the search when no word in it matched', async () => {
    await render(<ResultItem item={record({ content: 'happy birthday' })} query=" beach " index={0} onPress={jest.fn()} />);
    expect(screen.getByText('Looks similar')).toBeTruthy();
    expect(screen.getByText('Looks like “beach”')).toBeTruthy();
    expect(screen.queryByText('happy birthday')).toBeNull();
  });

  it('shows the star on an Important result and says so', async () => {
    await render(<ResultItem item={record()} query="bill" index={0} pinned onPress={jest.fn()} />);
    expect(screen.getByTestId('result-item-important')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Important$/ })).toBeTruthy();
  });
});

describe('MatchedSnippet', () => {
  it('locks the corners on the first matched word once its width is known', async () => {
    await render(<MatchedSnippet text="bill for March" terms={['bill']} lockOn />);
    expect(screen.queryByTestId('matched-snippet-corners')).toBeNull();
    expect(screen.getByTestId('matched-snippet-measure', { includeHiddenElements: true })).toHaveTextContent('bill');

    await layout('matched-snippet-measure', 38);
    expect(screen.getByTestId('matched-snippet-corners')).toBeTruthy();
  });

  it('keeps the measuring copy away from screen readers', async () => {
    await render(<MatchedSnippet text="bill for March" terms={['bill']} lockOn />);
    expect(screen.queryByText('bill', { exact: true, includeHiddenElements: false })).toBeTruthy();
    const hidden = screen.getByTestId('matched-snippet-measure', { includeHiddenElements: true });
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('shows no corners when the text does not start with a match', async () => {
    await render(<MatchedSnippet text="paid the bill" terms={['bill']} lockOn />);
    expect(screen.queryByTestId('matched-snippet-measure')).toBeNull();
    expect(screen.getByTestId('highlight-match')).toHaveTextContent('bill');
  });

  it('shows no corners unless asked, or when the word fills the whole line', async () => {
    const { rerender } = await render(<MatchedSnippet text="bill for March" terms={['bill']} />);
    expect(screen.queryByTestId('matched-snippet-measure')).toBeNull();

    await rerender(<MatchedSnippet text="bill for March" terms={['bill']} lockOn />);
    await act(async () => {
      fireEvent(screen.getByTestId('matched-snippet'), 'layout', { nativeEvent: { layout: { width: 40, height: 24, x: 0, y: 0 } } });
    });
    await layout('matched-snippet-measure', 40);
    expect(screen.queryByTestId('matched-snippet-corners')).toBeNull();
  });
});

describe('ListeningPanel', () => {
  let handlers: Record<string, Array<(e: unknown) => void>>;

  beforeEach(() => {
    handlers = {};
    jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockImplementation(((event: string, h: (e: unknown) => void) => {
      (handlers[event] ??= []).push(h);
      return { remove: () => { handlers[event] = handlers[event].filter(x => x !== h); } };
    }) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('says it is listening, stops on tap, and follows the real mic level', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const onStop = jest.fn();
    const { unmount } = await render(<ListeningPanel listening understanding={false} onStop={onStop} />);
    expect(screen.getByTestId('listening-panel-title')).toHaveTextContent('Listening… tap to stop');
    expect(screen.getByText('It stops by itself when you finish speaking.')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Listening… tap to stop');
    expect(screen.getAllByTestId('listening-panel-ring')).toHaveLength(3);

    // The level comes from the phone's microphone, not from a timer.
    expect(handlers.onSpeechVolume).toHaveLength(1);
    await act(async () => {
      handlers.onSpeechVolume[0]({ level: 0.8 });
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Stop listening' }));
    expect(onStop).toHaveBeenCalledTimes(1);

    await unmount();
    expect(handlers.onSpeechVolume).toHaveLength(0);
  });

  it('says "Understanding…" while the words are read, and cannot be tapped', async () => {
    const onStop = jest.fn();
    await render(<ListeningPanel listening={false} understanding onStop={onStop} />);
    expect(screen.getByTestId('listening-panel-title')).toHaveTextContent('Understanding…');
    expect(screen.getByText('Turning your words into a search.')).toBeTruthy();
    expect(screen.getByTestId('listening-panel-stop')).toBeDisabled();
    expect(handlers.onSpeechVolume ?? []).toHaveLength(0);
  });
});

describe('RecentSearches', () => {
  const history = [
    { query: 'bijli bill', timestamp: NOW - HOUR, resultCount: 4 },
    { query: 'my aadhaar 1234 5678 9012', timestamp: NOW - 30 * HOUR, resultCount: 0 },
  ];

  it('groups searches into Today and Earlier with what each one found', async () => {
    await render(
      <RecentSearches history={history} onSelect={jest.fn()} onDelete={jest.fn()} onClearAll={jest.fn()} now={NOW} />,
    );
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Earlier')).toBeTruthy();
    expect(screen.getByText(/· 4 found$/)).toBeTruthy();
    expect(screen.getByText(/· nothing found$/)).toBeTruthy();
  });

  it('never shows an ID number in full, but searches for what was typed', async () => {
    const onSelect = jest.fn();
    await render(
      <RecentSearches history={history} onSelect={onSelect} onDelete={jest.fn()} onClearAll={jest.fn()} now={NOW} />,
    );
    expect(screen.queryByText(/1234 5678 9012/)).toBeNull();
    const masked = screen.getByText(/^my aadhaar .*9012$/);
    await fireEvent.press(masked);
    expect(onSelect).toHaveBeenCalledWith('my aadhaar 1234 5678 9012');
  });

  it('removes one search, and asks before clearing all', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDelete = jest.fn();
    const onClearAll = jest.fn();
    await render(
      <RecentSearches history={history} onSelect={jest.fn()} onDelete={onDelete} onClearAll={onClearAll} now={NOW} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Remove bijli bill from recent searches' }));
    expect(onDelete).toHaveBeenCalledWith('bijli bill');

    await fireEvent.press(screen.getByText('Clear all'));
    expect(alert).toHaveBeenCalledWith('Clear all recent searches?', expect.any(String), expect.any(Array));
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it('offers searches to try, also when there is no history yet', async () => {
    const onSelect = jest.fn();
    await render(<RecentSearches history={[]} onSelect={onSelect} onDelete={jest.fn()} onClearAll={jest.fn()} />);
    expect(screen.getByText('Your searches will show here.')).toBeTruthy();
    expect(screen.queryByText('Clear all')).toBeNull();
    expect(screen.getAllByTestId('recent-searches-suggestion')).toHaveLength(4);
    await fireEvent.press(screen.getByText('bijli bill'));
    expect(onSelect).toHaveBeenCalledWith('bijli bill');
  });
});

describe('NothingFound', () => {
  it('offers to look through all photos, gives tips and searches that worked before', async () => {
    const onLook = jest.fn();
    const onSelect = jest.fn();
    await render(
      <NothingFound
        query=" pasport "
        onLookEverywhere={onLook}
        history={[
          { query: 'passport', timestamp: NOW, resultCount: 2 },
          { query: 'pasport', timestamp: NOW, resultCount: 5 },
          { query: 'xyz', timestamp: NOW, resultCount: 0 },
        ]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('header', { name: 'Nothing found for “pasport” yet' })).toBeTruthy();
    expect(screen.getByText('Check the spelling')).toBeTruthy();
    expect(screen.getByText('You searched before')).toBeTruthy();
    // Only earlier searches that found something, and not the one just tried.
    expect(screen.getAllByTestId('nothing-found-suggestion')).toHaveLength(1);
    await fireEvent.press(screen.getByText('passport'));
    expect(onSelect).toHaveBeenCalledWith('passport');
    await fireEvent.press(screen.getByRole('button', { name: 'Look through all photos' }));
    expect(onLook).toHaveBeenCalled();
  });

  it('says photos are still being read, with or without a total', async () => {
    const base = { query: 'x', onLookEverywhere: jest.fn(), history: [], onSelect: jest.fn() };
    const { rerender } = await render(<NothingFound {...base} indexing={{ done: 40, total: 1200 }} />);
    expect(screen.getByText(/\(40 of 1,200\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Look through all photos' })).toBeNull();
    expect(screen.getByText('Try one of these')).toBeTruthy();

    await rerender(<NothingFound {...base} indexing={{ done: 40 }} />);
    expect(screen.getByText('Pinpointer is still getting your photos ready. Try again in a little while.')).toBeTruthy();
  });
});

describe('SearchBar', () => {
  const props = (over: Partial<SearchBarProps> = {}): SearchBarProps => ({
    isTop: true,
    searchText: '',
    onChangeText: jest.fn(),
    onFocus: jest.fn(),
    autoFocus: false,
    isRecording: false,
    isTranscribing: false,
    isModelLoading: false,
    onStartListening: jest.fn(),
    onStopListening: jest.fn(),
    ...over,
  });

  it('on Home is one big button; its mic opens search and starts listening', async () => {
    const p = props({ isTop: false });
    await render(<View><SearchBar {...p} /></View>);
    expect(screen.queryByTestId('search-bar-home-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('search-bar-home-open'));
    expect(p.onFocus).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Search by voice' }));
    expect(p.onFocus).toHaveBeenCalledTimes(2);
    expect(p.onStartListening).toHaveBeenCalledTimes(1);
  });

  it('in search types, and the mic becomes a stop button while listening', async () => {
    const p = props({ searchText: 'bil' });
    const { rerender } = await render(<SearchBar {...p} />);
    await fireEvent.changeText(screen.getByTestId('search-bar-input'), 'bill');
    expect(p.onChangeText).toHaveBeenCalledWith('bill');
    expect(screen.getByTestId('search-bar-input').props.editable).toBe(true);

    await rerender(<SearchBar {...p} isRecording />);
    expect(screen.getByTestId('search-bar-input').props.editable).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Stop listening' }));
    expect(p.onStopListening).toHaveBeenCalledTimes(1);
    expect(p.onStartListening).not.toHaveBeenCalled();
  });

  it('does not start a second recording while the words are being read or the model loads', async () => {
    const p = props({ isTranscribing: true });
    const { rerender } = await render(<SearchBar {...p} />);
    await fireEvent.press(screen.getByTestId('search-bar-voice'));
    await rerender(<SearchBar {...p} isTranscribing={false} isModelLoading />);
    await fireEvent.press(screen.getByTestId('search-bar-voice'));
    expect(p.onStartListening).not.toHaveBeenCalled();
    expect(p.onStopListening).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { AccessibilityInfo, BackHandler, Keyboard, NativeModules } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import RNFS from 'react-native-fs';
import { SearchOverlay, SearchOverlayProps } from '../SearchOverlay';
import type { DocumentRecord } from '../../../database';
import { forgetIfGone } from '../../../utils/MissingFiles';
import { describeResult } from '../resultInfo';

jest.mock('react-native-svg', () => require('../../../components/ui/__tests__/svgMock').default);
jest.mock('../../../utils/MissingFiles', () => ({ forgetIfGone: jest.fn(async () => false) }));
// Real behaviour, counted: each call is one row working out its matched words.
jest.mock('../resultInfo', () => {
  const actual = jest.requireActual('../resultInfo');
  return { ...actual, describeResult: jest.fn(actual.describeResult) };
});

const photo = (over: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 1,
  content: 'electricity bill paid at the counter',
  filePath: 'file:///photos/bill.jpg',
  type: 'IMAGE',
  detection_type: 'TEXT',
  timestamp: 1700000000000,
  ...over,
});

const paper = (over: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 2,
  title: 'Electricity bill March',
  content: 'bill amount 1240 due on 5 April',
  filePath: 'file:///docs/bill.pdf',
  type: 'DOCUMENT',
  detection_type: 'TEXT',
  timestamp: 1700000001000,
  ...over,
});

const setup = async (over: Partial<SearchOverlayProps> = {}) => {
  const props: SearchOverlayProps = {
    visible: true,
    searchText: '',
    results: [],
    isSearchPending: false,
    history: [],
    onSelectHistory: jest.fn(),
    onDeleteHistory: jest.fn(),
    onClearHistory: jest.fn(),
    onBack: jest.fn(),
    onLookEverywhere: jest.fn(),
    onOpenPhoto: jest.fn(),
    isRecording: false,
    isTranscribing: false,
    onStopListening: jest.fn(),
    onCancelListening: jest.fn(),
    indexing: null,
    searchBar: null,
    ...over,
  };
  const r = await render(<SearchOverlay {...props} />);
  return { ...r, props };
};

beforeEach(() => {
  jest.clearAllMocks();
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
});

describe('SearchOverlay', () => {
  it('shows recent searches before anything is typed, and back closes search', async () => {
    const { props } = await setup({ history: [{ query: 'aadhaar', timestamp: Date.now(), resultCount: 2 }] });
    expect(screen.getByTestId('recent-searches')).toBeTruthy();
    expect(screen.getByText('aadhaar')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close search' }));
    expect(props.onBack).toHaveBeenCalled();
  });

  it('lists results with a count and the words also searched', async () => {
    await setup({ searchText: 'bijli bill', results: [photo(), paper()] });
    expect(screen.getAllByTestId('result-item')).toHaveLength(2);
    expect(screen.getByTestId('search-count')).toHaveTextContent('2 found');
    expect(screen.getByTestId('search-also')).toHaveTextContent(/Also searched.*बिजली/);
  });

  it('marks the words of the query the results were found for, not the half-typed one', async () => {
    // "bill" found these; the person has typed on to "billx" and the new
    // search hasn't answered yet.
    const looks = photo({ id: 9, content: 'a dog on grass', filePath: 'file:///photos/dog.jpg' });
    await setup({ searchText: 'billx', resultsQuery: 'bill', results: [looks] });
    expect(screen.getByText('Looks like “bill”')).toBeTruthy();
    expect(screen.queryByText('Looks like “billx”')).toBeNull();
  });

  it('rows do not redo their word matching while typing ahead of the results', async () => {
    const view = await setup({ searchText: 'bill', resultsQuery: 'bill', results: [photo(), paper()] });
    expect(describeResult).toHaveBeenCalledTimes(2);
    (describeResult as jest.Mock).mockClear();

    await view.rerender(<SearchOverlay {...view.props} searchText="bill p" />);
    await view.rerender(<SearchOverlay {...view.props} searchText="bill pa" />);
    expect(describeResult).not.toHaveBeenCalled();

    // The new results arrive for the new query: now the rows update.
    await view.rerender(<SearchOverlay {...view.props} searchText="bill pa" resultsQuery="bill pa" />);
    expect(describeResult).toHaveBeenCalledTimes(2);
  });

  it('says when it shows results for corrected words', async () => {
    await setup({ searchText: 'medicne', resultsQuery: 'medicine', correctedFrom: 'medicne', results: [photo()] });
    expect(screen.getByTestId('search-corrected')).toHaveTextContent(/Showing results for “medicine”/);
    expect(screen.getByText('You typed “medicne”')).toBeTruthy();
  });

  it('says when the results are from', async () => {
    await setup({ searchText: 'diwali photos', dateMeaning: { kind: 'festival', festival: 'diwali' }, results: [photo()] });
    expect(screen.getByTestId('search-when')).toHaveTextContent('When: Diwali, every year');
  });

  it('shows no correction line for words found as typed', async () => {
    await setup({ searchText: 'bill', results: [photo()] });
    expect(screen.queryByTestId('search-corrected')).toBeNull();
  });

  it('filters photos and papers, with counts on the chips', async () => {
    await setup({ searchText: 'bill', results: [photo(), paper(), paper({ id: 3, filePath: 'file:///docs/b2.pdf' })] });
    expect(screen.getByRole('button', { name: 'Photos, 1 found' })).toBeTruthy();
    expect(screen.getByTestId('search-filter-DOCUMENT')).toHaveTextContent('Papers 2');

    await fireEvent.press(screen.getByTestId('search-filter-IMAGE'));
    expect(screen.getAllByTestId('result-item')).toHaveLength(1);
    expect(screen.getByTestId('search-count')).toHaveTextContent('1 found');
    expect(screen.getByTestId('search-filter-IMAGE')).toBeSelected();

    await fireEvent.press(screen.getByTestId('search-filter-ALL'));
    expect(screen.getAllByTestId('result-item')).toHaveLength(3);
  });

  it('hides the filters when every result is the same kind', async () => {
    await setup({ searchText: 'bill', results: [paper()] });
    expect(screen.queryByTestId('search-filters')).toBeNull();
    expect(screen.getByTestId('search-count')).toHaveTextContent('1 found');
  });

  it('shows "Looking…" while the first results are on their way', async () => {
    await setup({ searchText: 'bill', isSearchPending: true });
    expect(screen.getByTestId('search-pending')).toBeTruthy();
    expect(screen.queryByTestId('nothing-found')).toBeNull();
  });

  it('shows the kind nothing-found page, and says when photos are still being read', async () => {
    const { props, rerender } = await setup({ searchText: 'xyz' });
    expect(screen.getByText('Nothing found for “xyz” yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Look through all photos' }));
    expect(props.onLookEverywhere).toHaveBeenCalled();

    await rerender(<SearchOverlay {...props} indexing={{ done: 120, total: 900 }} />);
    expect(screen.getByText(/still getting your photos ready \(120 of 900\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Look through all photos' })).toBeNull();
  });

  it('opens a photo in the viewer with the photo results in order', async () => {
    const second = photo({ id: 5, filePath: 'file:///photos/b2.jpg' });
    const { props } = await setup({ searchText: 'bill', results: [photo(), paper(), second] });
    await fireEvent.press(screen.getAllByTestId('result-item')[2]);
    await waitFor(() => expect(props.onOpenPhoto).toHaveBeenCalled());
    const [photos, index] = (props.onOpenPhoto as jest.Mock).mock.calls[0];
    expect(photos.map((p: DocumentRecord) => p.filePath)).toEqual(['file:///photos/bill.jpg', 'file:///photos/b2.jpg']);
    expect(index).toBe(1);
  });

  it('opens a paper in the PDF app', async () => {
    await setup({ searchText: 'bill', results: [paper()] });
    await fireEvent.press(screen.getByTestId('result-item'));
    await waitFor(() => expect(NativeModules.StorageModule.openPDF).toHaveBeenCalledWith('/docs/bill.pdf'));
  });

  it('takes a deleted file out of the list with a short note', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    (forgetIfGone as jest.Mock).mockResolvedValueOnce(true);
    const { props } = await setup({ searchText: 'bill', results: [photo(), paper()] });
    await fireEvent.press(screen.getAllByTestId('result-item')[0]);
    await waitFor(() => expect(screen.getAllByTestId('result-item')).toHaveLength(1));
    expect(announce).toHaveBeenCalledWith('This file is no longer on your phone.');
    expect(props.onOpenPhoto).not.toHaveBeenCalled();
    expect(screen.queryByTestId('search-filters')).toBeNull();
  });

  it('says so when a paper cannot be opened', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    (forgetIfGone as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await setup({ searchText: 'bill', results: [paper()] });
    await fireEvent.press(screen.getByTestId('result-item'));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('This paper could not be opened.'));
    expect(screen.getAllByTestId('result-item')).toHaveLength(1);
  });

  describe('while listening', () => {
    it('shows the listening panel instead of the list, and tapping it stops', async () => {
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      const { props } = await setup({ searchText: 'bill', results: [paper()], isRecording: true });
      expect(screen.getByText('Listening… tap to stop')).toBeTruthy();
      expect(screen.queryByTestId('search-results')).toBeNull();
      expect(dismiss).toHaveBeenCalled();
      await fireEvent.press(screen.getByRole('button', { name: 'Stop listening' }));
      expect(props.onStopListening).toHaveBeenCalled();
    });

    it('shows "Understanding…" while the words are read', async () => {
      await setup({ isTranscribing: true });
      expect(screen.getByText('Understanding…')).toBeTruthy();
    });

    it('back stops listening without searching and stays in search', async () => {
      const handlers: Array<() => boolean | null | undefined> = [];
      jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, h) => {
        handlers.push(h);
        return { remove: jest.fn() };
      });
      const { props } = await setup({ isRecording: true });
      expect(handlers).toHaveLength(1);
      let handled: boolean | null | undefined;
      await act(async () => {
        handled = handlers[0]();
      });
      expect(handled).toBe(true);
      expect(props.onCancelListening).toHaveBeenCalled();
      expect(props.onBack).not.toHaveBeenCalled();
    });
  });

  it('is not in the tree while closed, and leaves after closing', async () => {
    jest.useFakeTimers();
    try {
      const { props, rerender } = await setup({ visible: false });
      expect(screen.queryByTestId('search-overlay')).toBeNull();
      await rerender(<SearchOverlay {...props} visible />);
      expect(screen.getByTestId('search-overlay')).toBeTruthy();
      await rerender(<SearchOverlay {...props} visible={false} />);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByTestId('search-overlay')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

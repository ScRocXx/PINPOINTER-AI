import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Card, ListRow } from '../Card';
import { CollectionCard } from '../CollectionCard';
import { EmptyState } from '../EmptyState';
import { ScreenHeader, SectionHeader } from '../Headers';
import { HighlightedText, splitMatches } from '../HighlightedText';
import { ProgressBar, ProgressRing, clampProgress } from '../Progress';
import { ProgressCard } from '../ProgressCard';
import { Reveal } from '../Reveal';
import { Thumbnail } from '../Thumbnail';
import { LanguageProvider } from '../../../i18n';

jest.mock('react-native-svg', () => require('./svgMock').default);

describe('splitMatches', () => {
  it('marks every match, ignoring case', () => {
    expect(splitMatches('Bill paid. BILL due.', ['bill'])).toEqual([
      { text: 'Bill', match: true },
      { text: ' paid. ', match: false },
      { text: 'BILL', match: true },
      { text: ' due.', match: false },
    ]);
  });

  it('prefers the longer term and escapes regex characters', () => {
    expect(splitMatches('aadhaar card (a+b)', ['aadhaar card', 'aadhaar', '(a+b)'])).toEqual([
      { text: 'aadhaar card', match: true },
      { text: ' ', match: false },
      { text: '(a+b)', match: true },
    ]);
  });

  it('handles Hindi, empty terms and empty text', () => {
    expect(splitMatches('मेरा आधार कार्ड', ['आधार', ' '])).toEqual([
      { text: 'मेरा ', match: false },
      { text: 'आधार', match: true },
      { text: ' कार्ड', match: false },
    ]);
    expect(splitMatches('plain', [])).toEqual([{ text: 'plain', match: false }]);
    expect(splitMatches('', ['x'])).toEqual([]);
  });
});

describe('HighlightedText', () => {
  it('renders matches as marked spans', async () => {
    await render(<HighlightedText text="Electricity bill for March" terms={['bill', 'march']} />);
    expect(screen.getAllByTestId('highlight-match').map(n => n.props.children)).toEqual(['bill', 'March']);
  });
});

describe('Card and ListRow', () => {
  it('a plain card is not a button; a tappable one is', async () => {
    await render(
      <Card testID="c">
        <Text>Inside</Text>
      </Card>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    const onPress = jest.fn();
    await render(
      <Card onPress={onPress} accessibilityLabel="Open bill" flush elevation="raised">
        <Text>Inside</Text>
      </Card>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Open bill' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('a tappable row reads its title and subtitle and shows a chevron', async () => {
    const onPress = jest.fn();
    await render(<ListRow title="Language" subtitle="English" icon="language" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Language, English' }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByTestId('icon-chevronRight', { includeHiddenElements: true })).toBeTruthy();
  });

  it('a static row with a trailing element has no chevron', async () => {
    await render(<ListRow title="Version" trailing={<Text>1.0</Text>} last danger leading={<Text>L</Text>} />);
    expect(screen.queryByTestId('icon-chevronRight', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('1.0')).toBeTruthy();
  });
});

describe('CollectionCard', () => {
  it('speaks its label and count', async () => {
    const onPress = jest.fn();
    await render(<CollectionCard label="Bills" icon="bill" tint="bill" countLabel="12 found" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Bills, 12 found' }));
    expect(onPress).toHaveBeenCalled();
    await render(<CollectionCard label="Bank" icon="bank" tint="bank" onPress={onPress} />);
    expect(screen.getByRole('button', { name: 'Bank' })).toBeTruthy();
  });
});

describe('EmptyState', () => {
  it('shows a heading, body and both actions', async () => {
    const onAction = jest.fn();
    const onSecondary = jest.fn();
    await render(
      <EmptyState
        icon="search"
        title="Nothing found"
        body="Try another word"
        actionLabel="Look through all photos"
        onAction={onAction}
        secondaryLabel="Clear"
        onSecondary={onSecondary}
        searching
      />,
    );
    expect(screen.getByRole('header', { name: 'Nothing found' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Look through all photos' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(onAction).toHaveBeenCalled();
    expect(onSecondary).toHaveBeenCalled();
  });

  it('leaves out buttons without handlers', async () => {
    await render(<EmptyState icon="papers" title="No papers yet" actionLabel="Add" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Headers', () => {
  it('the screen title is a heading with a translated back button', async () => {
    const onBack = jest.fn();
    await render(
      <LanguageProvider initialLanguage="hi">
        <ScreenHeader title="कागज़" subtitle="12" onBack={onBack} actions={<Text>A</Text>} size="compact" onNight />
      </LanguageProvider>,
    );
    expect(screen.getByRole('header', { name: 'कागज़' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('screen-header-back'));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('section headers offer "See all" that names the section', async () => {
    const onAction = jest.fn();
    await render(<SectionHeader title="Important" actionLabel="See all" onAction={onAction} />);
    await fireEvent.press(screen.getByRole('button', { name: 'See all: Important' }));
    expect(onAction).toHaveBeenCalled();
    await render(<SectionHeader title="Recent" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Progress', () => {
  it('clamps odd values', () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(NaN)).toBe(0);
    expect(clampProgress(Infinity)).toBe(0);
    expect(clampProgress(0.4)).toBe(0.4);
  });

  it('the bar reports its percent to TalkBack', async () => {
    const { rerender } = await render(<ProgressBar value={0.42} accessibilityLabel="Photos" />);
    expect(screen.getByRole('progressbar', { name: 'Photos' }).props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
    await rerender(<ProgressBar accessibilityLabel="Photos" />);
    expect(screen.getByRole('progressbar').props.accessibilityValue).toBeUndefined();
  });

  it('the ring shows its middle', async () => {
    await render(
      <ProgressRing value={0.5} accessibilityLabel="Getting ready">
        <Text>50%</Text>
      </ProgressRing>,
    );
    expect(screen.getByRole('progressbar', { name: 'Getting ready' }).props.accessibilityValue.now).toBe(50);
  });
});

describe('ProgressCard', () => {
  it('running: bar and a pause action', async () => {
    const onAction = jest.fn();
    await render(
      <ProgressCard
        title="Getting your photos ready"
        detail="1,240 of 3,400"
        value={0.36}
        state="running"
        actionLabel="Pause"
        onAction={onAction}
        note="Keeps going while charging"
      />,
    );
    expect(screen.getByTestId('progress-card-bar')).toBeTruthy();
    expect(screen.getByTestId('icon-pause', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('paused offers resume; done drops the bar', async () => {
    await render(<ProgressCard title="Paused" state="paused" actionLabel="Resume" onAction={jest.fn()} />);
    expect(screen.getByTestId('icon-play', { includeHiddenElements: true })).toBeTruthy();
    await render(<ProgressCard title="All 3,400 photos ready" detail="Checked just now" state="done" actionLabel="Check again" onAction={jest.fn()} />);
    expect(screen.queryByTestId('progress-card-bar')).toBeNull();
    expect(screen.getByTestId('icon-refresh', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('icon-check', { includeHiddenElements: true })).toBeTruthy();
  });

  it('can be just a title', async () => {
    await render(<ProgressCard title="Getting ready" state="running" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Reveal', () => {
  it('renders its children whatever the index', async () => {
    jest.useFakeTimers();
    await render(
      <>
        <Reveal index={0} testID="r0">
          <Text>first</Text>
        </Reveal>
        <Reveal index={20} playKey="q">
          <Text>late</Text>
        </Reveal>
      </>,
    );
    await act(async () => {
      jest.runAllTimers();
    });
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('late')).toBeTruthy();
    jest.useRealTimers();
  });
});

describe('Thumbnail', () => {
  it('fades in a photo and falls back to an icon on error', async () => {
    await render(<Thumbnail uri="file:///p.jpg" fallbackIcon="papers" />);
    const img = screen.getByTestId('thumbnail-image');
    expect(img.props.resizeMethod).toBe('resize');
    await fireEvent(img, 'load');
    await fireEvent(img, 'error');
    expect(screen.queryByTestId('thumbnail-image')).toBeNull();
    expect(screen.getByTestId('icon-papers', { includeHiddenElements: true })).toBeTruthy();
  });

  it('shows only the placeholder without a uri, and can fill a grid cell', async () => {
    await render(<Thumbnail uri={null} fill aspectRatio={0.75} />);
    expect(screen.queryByTestId('thumbnail-image')).toBeNull();
    expect(screen.getByTestId('thumbnail')).toHaveStyle({ width: '100%', aspectRatio: 0.75 });
  });
});

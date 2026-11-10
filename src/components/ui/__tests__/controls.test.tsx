import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Chip, Tag } from '../Chip';
import { Segmented } from '../Segmented';
import { SearchField } from '../SearchField';
import { LanguageProvider } from '../../../i18n';
import { Touch } from '../../../theme';

const face = (testID: string) => screen.getByTestId(testID);

jest.mock('react-native-svg', () => require('./svgMock').default);

describe('Button', () => {
  it('is a labelled 56dp button that presses', async () => {
    const onPress = jest.fn();
    await render(<Button label="Allow photos" onPress={onPress} icon="photos" testID="b" />);
    const btn = screen.getByRole('button', { name: 'Allow photos' });
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(face('b')).toHaveStyle({ minHeight: Touch.comfortable });
  });

  it('shows a spinner and ignores taps while loading', async () => {
    const onPress = jest.fn();
    await render(<Button label="Saving" onPress={onPress} loading testID="b" />);
    expect(screen.getByTestId('b-loading')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Saving' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('draws the beam only on the beam variant', async () => {
    await render(<Button label="Start" variant="beam" testID="go" />);
    expect(screen.getByTestId('go-beam')).toBeTruthy();
    await render(<Button label="Later" variant="ghost" size="compact" testID="later" icon="chevronRight" iconAfter />);
    expect(screen.queryByTestId('later-beam')).toBeNull();
    expect(face('later')).toHaveStyle({ minHeight: Touch.min });
  });

  it('can say more than its label', async () => {
    await render(<Button label="See all" accessibilityLabel="See all important" variant="secondary" block />);
    expect(screen.getByRole('button', { name: 'See all important' })).toBeTruthy();
  });
});

describe('IconButton', () => {
  it('requires a label and keeps a 48dp touch area', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="close" label="Close" size={36} onPress={onPress} testID="x" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.props.hitSlop).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalled();
  });

  it('reports toggle state', async () => {
    await render(<IconButton icon="star" label="Important" selected filled variant="onNight" />);
    expect(screen.getByRole('button', { name: 'Important' }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('renders every variant', async () => {
    for (const variant of ['plain', 'tonal', 'onNight', 'beam', 'primary'] as const) {
      await render(<IconButton icon="mic" label={variant} variant={variant} disabled={variant === 'plain'} />);
      expect(screen.getByRole('button', { name: variant })).toBeTruthy();
    }
  });
});

describe('Chip and Tag', () => {
  it('a selected chip says so and shows a tick', async () => {
    const onPress = jest.fn();
    await render(<Chip label="Photos" selected onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'Photos' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('icon-check', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });

  it('a removable chip shows a cross', async () => {
    await render(<Chip label="aadhaar" removable icon="clock" />);
    expect(screen.getByTestId('icon-close', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('icon-clock', { includeHiddenElements: true })).toBeTruthy();
  });

  it('tags take every tone', async () => {
    for (const tone of ['found', 'important', 'neutral', 'bill', 'id'] as const) {
      await render(<Tag label={tone} tone={tone} icon="check" />);
      expect(screen.getByText(tone)).toBeTruthy();
    }
  });
});

describe('Segmented', () => {
  it('changes only when a different option is picked', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        accessibilityLabel="Language"
        value="en"
        onChange={onChange}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'हिन्दी', accessibilityLabel: 'Hindi' },
        ]}
      />,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Hindi' }));
    expect(onChange).toHaveBeenCalledWith('hi');
    expect(screen.getByRole('radio', { name: 'English' }).props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe('SearchField', () => {
  it('types, clears and offers the mic', async () => {
    const onChangeText = jest.fn();
    const onVoicePress = jest.fn();
    await render(
      <SearchField placeholder="Search photos and papers" value="bill" onChangeText={onChangeText} onVoicePress={onVoicePress} />,
    );
    await fireEvent.changeText(screen.getByTestId('search-field-input'), 'bijli');
    expect(onChangeText).toHaveBeenCalledWith('bijli');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChangeText).toHaveBeenCalledWith('');
    await fireEvent.press(screen.getByRole('button', { name: 'Search by voice' }));
    expect(onVoicePress).toHaveBeenCalled();
  });

  it('uses a custom clear handler and hides clear when empty', async () => {
    const onClear = jest.fn();
    const { rerender } = await render(<SearchField placeholder="Search" value="x" onClear={onClear} />);
    await fireEvent.press(screen.getByTestId('search-field-clear'));
    expect(onClear).toHaveBeenCalled();
    await rerender(<SearchField placeholder="Search" value="" onClear={onClear} />);
    expect(screen.queryByTestId('search-field-clear')).toBeNull();
  });

  it('calls focus and blur handlers', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    await render(<SearchField placeholder="Search" onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByTestId('search-field-input');
    await fireEvent(input, 'focus', {});
    await fireEvent(input, 'blur', {});
    expect(onFocus).toHaveBeenCalled();
    expect(onBlur).toHaveBeenCalled();
  });

  it('switches the mic to stop while listening, in Hindi too', async () => {
    await render(
      <LanguageProvider initialLanguage="hi">
        <SearchField placeholder="खोजें" listening onVoicePress={jest.fn()} stopVoiceLabel="रोकें" />
      </LanguageProvider>,
    );
    expect(screen.getByRole('button', { name: 'रोकें' })).toBeTruthy();
    expect(screen.getByTestId('icon-stop', { includeHiddenElements: true })).toBeTruthy();
  });

  it('works as a big button that opens search', async () => {
    const onPressFake = jest.fn();
    await render(<SearchField placeholder="Search photos and papers" onPressFake={onPressFake} onVoicePress={jest.fn()} />);
    expect(screen.queryByTestId('search-field-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('search-field-open'));
    expect(onPressFake).toHaveBeenCalled();
    expect(screen.getByText('Search photos and papers')).toBeTruthy();
  });
});

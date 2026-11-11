import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { StepFrame } from '../StepFrame';
import { LanguageProvider } from '../../../i18n';

const frame = (count: number) => (
  <LanguageProvider initialLanguage="en">
    <StepFrame dots={{ index: 0, count }} actions={<Text>go</Text>}>
      <Text>body</Text>
    </StepFrame>
  </LanguageProvider>
);

describe('StepFrame dots', () => {
  it('draws one dot per step, even when a step drops out after the first check', async () => {
    const view = await render(frame(4));
    expect(screen.getByTestId('step-dots').children).toHaveLength(4);
    await view.rerender(frame(3));
    expect(screen.getByTestId('step-dots').children).toHaveLength(3);
    expect(screen.getByLabelText('Step 1 of 3')).toBeTruthy();
  });
});

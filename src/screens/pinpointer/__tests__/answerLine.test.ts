import { translate, StringKey, StringParams } from '../../../i18n';
import { answerLine, formatRupees } from '../answerLine';

const en = (k: StringKey, p?: StringParams) => translate('en', k, p);
const hi = (k: StringKey, p?: StringParams) => translate('hi', k, p);
const NOW = new Date(2024, 2, 20, 10).getTime(); // 20 March 2024

describe('answerLine', () => {
    it('says amount and when to pay, in plain words', () => {
        expect(answerLine(en, { amount: 1240, due: { y: 2024, m: 4, d: 5 } }, NOW)).toBe('Amount ₹1,240 · Pay by 5 April');
        expect(answerLine(hi, { amount: 1240, due: { y: 2024, m: 4, d: 5 } }, NOW)).toBe('रकम ₹1,240 · 5 अप्रैल तक भरें');
    });

    it('says when a date has passed', () => {
        expect(answerLine(en, { due: { y: 2024, m: 3, d: 1 } }, NOW)).toBe('Was due 1 March');
        expect(answerLine(en, { validTill: { y: 2023, m: 12, d: 31 } }, NOW)).toBe('Expired on 31 December 2023');
        expect(answerLine(en, { validTill: { y: 2025, m: 3, d: 31 } }, NOW)).toBe('Valid till 31 March 2025');
    });

    it('says when to take medicine', () => {
        expect(answerLine(en, { medicine: { morning: true, afternoon: false, night: true, food: 'after' } }, NOW)).toBe(
            'Take: morning, night, after food',
        );
        expect(answerLine(hi, { medicine: { morning: true, afternoon: false, night: false, food: 'before' } }, NOW)).toBe(
            'लेना है: सुबह, खाने से पहले',
        );
    });

    it('is empty when there is nothing to say, and groups rupees the Indian way', () => {
        expect(answerLine(en, {}, NOW)).toBe('');
        expect(formatRupees(124500.5)).toBe('₹1,24,500.50');
        expect(formatRupees(99)).toBe('₹99');
    });
});

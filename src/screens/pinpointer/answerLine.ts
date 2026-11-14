import { StringKey, StringParams, formatCount, formatDay } from '../../i18n';
import type { AnswerFacts, FactDate, MedicineTimes } from '../../utils/AnswerCards';

type T = (key: StringKey, params?: StringParams) => string;

/** "₹1,240" or "₹1,240.50", grouped the Indian way. */
export const formatRupees = (amount: number): string => {
    const whole = Math.floor(amount);
    const paise = Math.round((amount - whole) * 100);
    return `₹${formatCount(whole)}${paise ? `.${String(paise).padStart(2, '0')}` : ''}`;
};

const dayMs = ({ y, m, d }: FactDate): number => new Date(y, m - 1, d).getTime();
const isPast = (date: FactDate, now: number): boolean => dayMs(date) + 86400000 <= now;

const times = (t: T, m: MedicineTimes): string => {
    const parts: string[] = [];
    if (m.morning) parts.push(t('answer.morning'));
    if (m.afternoon) parts.push(t('answer.afternoon'));
    if (m.night) parts.push(t('answer.night'));
    const when = parts.join(', ');
    const extras = [m.food === 'after' ? t('answer.afterFood') : m.food === 'before' ? t('answer.beforeFood') : '', m.asNeeded ? t('answer.asNeeded') : '']
        .filter(Boolean)
        .join(', ');
    return [when, extras].filter(Boolean).join(', ');
};

/**
 * The facts a result row shows at a glance, in plain words: "Amount ₹1,240 ·
 * Pay by 5 April", "Valid till 31 March 2025", "Take: morning, night, after
 * food". '' when there is nothing sure to say.
 */
export const answerLine = (t: T, facts: AnswerFacts, now: number = Date.now()): string => {
    const parts: string[] = [];
    if (facts.amount !== undefined) parts.push(t('answer.amount', { amount: formatRupees(facts.amount) }));
    if (facts.due) {
        const date = formatDay(t, dayMs(facts.due), now);
        parts.push(t(isPast(facts.due, now) ? 'answer.wasDue' : 'answer.payBy', { date }));
    }
    if (facts.validTill) {
        const date = formatDay(t, dayMs(facts.validTill), now);
        parts.push(t(isPast(facts.validTill, now) ? 'answer.expired' : 'answer.validTill', { date }));
    }
    if (facts.medicine) {
        const when = times(t, facts.medicine);
        if (when) parts.push(t('answer.take', { when }));
    }
    return parts.join(' · ');
};

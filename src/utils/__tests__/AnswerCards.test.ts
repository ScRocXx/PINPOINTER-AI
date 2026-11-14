import { amountToPay, answerFacts, firstDate, hasFacts, medicineTimes } from '../AnswerCards';

describe('answerFacts — bills', () => {
    it('reads amount and due date from an English electricity bill', () => {
        const bill = 'BSES Rajdhani Power Ltd Bill Date: 15/03/2024 Due Date: 05/04/2024 Units 212 Amount Payable Rs. 1,240.00 Pay online';
        expect(answerFacts(bill)).toEqual({ amount: 1240, due: { y: 2024, m: 4, d: 5 } });
    });

    it('reads a Hindi bill', () => {
        const bill = 'बिजली बिल उपभोक्ता संख्या XXXXXX1234 कुल देय राशि ₹ 1,240 अंतिम तिथि 05-04-2024';
        expect(answerFacts(bill)).toEqual({ amount: 1240, due: { y: 2024, m: 4, d: 5 } });
    });

    it('reads written-out dates and Indian digit grouping', () => {
        expect(answerFacts('Total Amount ₹ 1,24,500.50 Pay by 5th April 2024')).toEqual({
            amount: 124500.5,
            due: { y: 2024, m: 4, d: 5 },
        });
        expect(firstDate('due on April 5, 2024')).toEqual({ y: 2024, m: 4, d: 5 });
        expect(firstDate('5 अप्रैल 2024 तक')).toEqual({ y: 2024, m: 4, d: 5 });
    });

    it('falls back to the largest rupee amount, and ignores long numbers that are not amounts', () => {
        expect(amountToPay('Paid ₹ 250 and ₹ 1,000 for the gas cylinder')).toBe(1000);
        expect(amountToPay('Consumer No 1234567890123 meter reading 4521')).toBeNull();
    });
});

describe('answerFacts — validity', () => {
    it('reads "valid till" dates and month/year expiry', () => {
        expect(answerFacts('Policy No 12345 valid till 31 Mar 2025 premium paid').validTill).toEqual({ y: 2025, m: 3, d: 31 });
        expect(answerFacts('Driving licence Expiry: 12/2025').validTill).toEqual({ y: 2025, m: 12, d: 31 });
        expect(answerFacts('बीमा वैधता 31-03-2026 तक').validTill).toEqual({ y: 2026, m: 3, d: 31 });
    });
});

describe('answerFacts — medicine times', () => {
    it('reads the 1-0-1 shorthand and food', () => {
        expect(medicineTimes('Tab Telmisartan 40mg 1-0-1 after food x 30 days')).toEqual({
            morning: true, afternoon: false, night: true, food: 'after',
        });
    });

    it('reads OD / BD / TDS and Hindi instructions', () => {
        expect(medicineTimes('Tab Pan 40 OD before breakfast')).toEqual({ morning: true, afternoon: false, night: false, food: 'before' });
        expect(medicineTimes('Syrup 10 ml TDS')).toMatchObject({ morning: true, afternoon: true, night: true });
        expect(medicineTimes('दवाई सुबह शाम खाने के बाद')).toEqual({ morning: true, afternoon: false, night: true, food: 'after' });
        expect(medicineTimes('Tab Paracetamol 500 SOS')).toMatchObject({ asNeeded: true });
    });

    it('needs a prescription: 1-0-1 elsewhere is not a dose', () => {
        expect(medicineTimes('Score 1-0-1 in the match')).toBeNull();
    });
});

describe('answerFacts — nothing to say', () => {
    it('returns nothing for text without facts', () => {
        expect(answerFacts('train ticket from Delhi to Agra')).toEqual({});
        expect(answerFacts('')).toEqual({});
        expect(answerFacts(null)).toEqual({});
        expect(hasFacts({})).toBe(false);
        expect(hasFacts({ amount: 5 })).toBe(true);
    });

    it('rejects impossible dates', () => {
        expect(firstDate('31/02/2024')).toBeNull();
        expect(firstDate('45/13/2024')).toBeNull();
    });
});

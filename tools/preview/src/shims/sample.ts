// Sample data for the browser preview: drawn "photos" (no files, no network)
// and a few papers. Nothing here ships in the app.
const DAY = 24 * 60 * 60 * 1000;

const PAPER_TONES: Array<[string, string]> = [
  ['#D8CDBB', '#B7A68B'],
  ['#CFE3E8', '#9DBFC9'],
  ['#E6D6EE', '#BFA6D6'],
  ['#DDE7C9', '#A9BF86'],
  ['#F1D9C2', '#D9A77C'],
  ['#D5D9EA', '#9EA7CF'],
];

/** A drawn stand-in for a photo of a paper: a tinted table with a white sheet. */
export const fakePhoto = (i: number): string => {
  const [a, b] = PAPER_TONES[i % PAPER_TONES.length];
  const tilt = (i % 5) * 2 - 4;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="300" height="300" fill="url(#g)"/>` +
    `<g transform="rotate(${tilt} 150 150)"><rect x="62" y="48" width="176" height="204" rx="6" fill="#fff"/>` +
    `<rect x="80" y="70" width="${70 + (i % 4) * 14}" height="12" rx="3" fill="#5A3FE0"/>` +
    [100, 118, 136, 154, 172].map((y, k) => `<rect x="80" y="${y}" width="${140 - ((i + k) % 4) * 18}" height="7" rx="3" fill="#C9C4D6"/>`).join('') +
    `<rect x="160" y="212" width="60" height="14" rx="3" fill="#16131F"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Photos across today, yesterday, this week and older months. */
export const SAMPLE_PHOTOS = [0.4, 0.3, 0.2, -0.3, -0.5, -0.6, -2.4, -2.5, -4.3, -4.6, -5.2, -18, -18.2, -19, -47, -47.5, -48, -80, -81, -140].map(
  (offset, i) => ({ uri: fakePhoto(i), takenAt: startOfToday() + offset * DAY, screenshot: i % 4 === 1 }),
);

const paper = (id: number, title: string, content: string, file: string, daysAgo: number) => ({
  id,
  title,
  content,
  filePath: `/storage/emulated/0/Download/${file}`,
  type: 'DOCUMENT',
  detection_type: 'TEXT',
  timestamp: Date.now() - daysAgo * DAY,
});

export const SAMPLE_PAPERS = [
  paper(1, 'Electricity bill, March', 'electricity bill units consumed amount payable due date BSES बिजली बिल', 'bijli-bill-march.pdf', 0.1),
  paper(2, 'Aadhaar card', 'aadhaar unique identification authority of india XXXX XXXX 2291', 'aadhaar.pdf', 1),
  paper(3, 'SBI account statement', 'state bank of india account statement opening balance closing balance', 'sbi-statement.pdf', 3),
  paper(4, 'Blood test report', 'pathology lab report haemoglobin patient name blood test', 'blood-report.pdf', 9),
  paper(5, 'Income tax return 2025', 'income tax return acknowledgement assessment year ITR', 'itr-2025.pdf', 30),
  paper(6, 'Mobile bill, February', 'mobile bill postpaid airtel amount due bill period', 'airtel-feb.pdf', 34),
  paper(7, 'PAN card', 'income tax department permanent account number card XXXXX1234X', 'pan.pdf', 60),
  paper(8, 'Rent agreement', 'rent agreement between landlord and tenant', 'rent-agreement.pdf', 120),
];

export const SAMPLE_SCAN_TEXT = 'बिजली बिल · Electricity bill\nAccount no. XXXX 2291\nAmount due ₹1,240\nPay by 18 Nov 2026';

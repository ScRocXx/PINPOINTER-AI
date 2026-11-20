/* eslint-env node */
/**
 * Word pools for the test gallery: Indian names, places, companies, medicines,
 * messages. Everything is made up; ID numbers are random (Aadhaar-shaped
 * numbers fail the Verhoeff check on purpose, so none is a real one).
 * Each person has an English and a Devanagari spelling, as cards print both.
 */
const PEOPLE = [
  ['Ramesh', 'रमेश', 'M'], ['Sunita', 'सुनीता', 'F'], ['Priya', 'प्रिया', 'F'], ['Amit', 'अमित', 'M'],
  ['Rajesh', 'राजेश', 'M'], ['Kavita', 'कविता', 'F'], ['Mohammed', 'मोहम्मद', 'M'], ['Fatima', 'फ़ातिमा', 'F'],
  ['Gurpreet', 'गुरप्रीत', 'M'], ['Anita', 'अनीता', 'F'], ['Suresh', 'सुरेश', 'M'], ['Lakshmi', 'लक्ष्मी', 'F'],
  ['Venkatesh', 'वेंकटेश', 'M'], ['Arjun', 'अर्जुन', 'M'], ['Pooja', 'पूजा', 'F'], ['Deepak', 'दीपक', 'M'],
  ['Neha', 'नेहा', 'F'], ['Manoj', 'मनोज', 'M'], ['Sanjay', 'संजय', 'M'], ['Geeta', 'गीता', 'F'],
  ['Harish', 'हरीश', 'M'], ['Rekha', 'रेखा', 'F'], ['Vijay', 'विजय', 'M'], ['Asha', 'आशा', 'F'],
  ['Mahesh', 'महेश', 'M'], ['Savitri', 'सावित्री', 'F'], ['Imran', 'इमरान', 'M'], ['Shabnam', 'शबनम', 'F'],
  ['Ravi', 'रवि', 'M'], ['Meena', 'मीना', 'F'], ['Prakash', 'प्रकाश', 'M'], ['Usha', 'उषा', 'F'],
  ['Dinesh', 'दिनेश', 'M'], ['Kamla', 'कमला', 'F'], ['Naresh', 'नरेश', 'M'], ['Shanti', 'शांति', 'F'],
];
const SURNAMES = [
  ['Sharma', 'शर्मा'], ['Verma', 'वर्मा'], ['Gupta', 'गुप्ता'], ['Singh', 'सिंह'], ['Kumar', 'कुमार'],
  ['Yadav', 'यादव'], ['Patel', 'पटेल'], ['Khan', 'ख़ान'], ['Mishra', 'मिश्रा'], ['Joshi', 'जोशी'],
  ['Chauhan', 'चौहान'], ['Agarwal', 'अग्रवाल'], ['Tiwari', 'तिवारी'], ['Pandey', 'पांडेय'], ['Srivastava', 'श्रीवास्तव'],
  ['Saxena', 'सक्सेना'], ['Rathore', 'राठौर'], ['Ansari', 'अंसारी'], ['Dubey', 'दुबे'], ['Bansal', 'बंसल'],
];
const CITIES = [
  ['Lucknow', 'लखनऊ', 'Uttar Pradesh', 'उत्तर प्रदेश', '226001'], ['Kanpur', 'कानपुर', 'Uttar Pradesh', 'उत्तर प्रदेश', '208001'],
  ['Varanasi', 'वाराणसी', 'Uttar Pradesh', 'उत्तर प्रदेश', '221001'], ['Jaipur', 'जयपुर', 'Rajasthan', 'राजस्थान', '302001'],
  ['Patna', 'पटना', 'Bihar', 'बिहार', '800001'], ['Bhopal', 'भोपाल', 'Madhya Pradesh', 'मध्य प्रदेश', '462001'],
  ['Indore', 'इंदौर', 'Madhya Pradesh', 'मध्य प्रदेश', '452001'], ['New Delhi', 'नई दिल्ली', 'Delhi', 'दिल्ली', '110001'],
  ['Agra', 'आगरा', 'Uttar Pradesh', 'उत्तर प्रदेश', '282001'], ['Nagpur', 'नागपुर', 'Maharashtra', 'महाराष्ट्र', '440001'],
  ['Dehradun', 'देहरादून', 'Uttarakhand', 'उत्तराखंड', '248001'], ['Ranchi', 'रांची', 'Jharkhand', 'झारखंड', '834001'],
];
const AREAS = ['Gomti Nagar', 'Aliganj', 'Indira Nagar', 'Civil Lines', 'Rajendra Nagar', 'Malviya Nagar', 'Shastri Nagar', 'Arera Colony', 'Vaishali Nagar', 'Kankarbagh'];

/** Electricity companies: English name, Hindi name, website, how long the account number is. */
const POWER = [
  { en: 'BSES Rajdhani Power Limited', hi: 'बीएसईएस राजधानी पावर लिमिटेड', short: 'BSES', site: 'www.bsesdelhi.com', acct: 9, label: 'CA No' },
  { en: 'Tata Power Delhi Distribution Limited', hi: 'टाटा पावर दिल्ली', short: 'Tata Power', site: 'www.tatapower-ddl.com', acct: 11, label: 'CA No' },
  { en: 'Madhyanchal Vidyut Vitran Nigam Ltd', hi: 'मध्यांचल विद्युत वितरण निगम लिमिटेड', short: 'MVVNL', site: 'www.uppclonline.com', acct: 10, label: 'Account No' },
  { en: 'Jaipur Vidyut Vitran Nigam Ltd', hi: 'जयपुर विद्युत वितरण निगम लिमिटेड', short: 'JVVNL', site: 'energy.rajasthan.gov.in', acct: 12, label: 'K No' },
  { en: 'South Bihar Power Distribution Company Ltd', hi: 'साउथ बिहार पावर डिस्ट्रीब्यूशन कंपनी लिमिटेड', short: 'SBPDCL', site: 'www.sbpdcl.co.in', acct: 9, label: 'Consumer No' },
  { en: 'MP Paschim Kshetra Vidyut Vitaran Co Ltd', hi: 'म.प्र. पश्चिम क्षेत्र विद्युत वितरण कंपनी', short: 'MPPKVVCL', site: 'mpwz.co.in', acct: 10, label: 'IVRS No' },
];
const WATER = [
  { en: 'Delhi Jal Board', hi: 'दिल्ली जल बोर्ड', label: 'K No' },
  { en: 'Jal Sansthan Lucknow', hi: 'जल संस्थान लखनऊ', label: 'Connection No' },
];
const GAS = [
  { en: 'Indane', hi: 'इंडेन', company: 'Indian Oil Corporation Ltd' },
  { en: 'HP Gas', hi: 'एचपी गैस', company: 'Hindustan Petroleum Corporation Ltd' },
  { en: 'Bharatgas', hi: 'भारतगैस', company: 'Bharat Petroleum Corporation Ltd' },
];
const BANKS = [
  { en: 'State Bank of India', hi: 'भारतीय स्टेट बैंक', ifsc: 'SBIN', short: 'SBI' },
  { en: 'Punjab National Bank', hi: 'पंजाब नैशनल बैंक', ifsc: 'PUNB', short: 'PNB' },
  { en: 'Bank of Baroda', hi: 'बैंक ऑफ़ बड़ौदा', ifsc: 'BARB', short: 'BOB' },
  { en: 'HDFC Bank', hi: 'एचडीएफसी बैंक', ifsc: 'HDFC', short: 'HDFC' },
  { en: 'Canara Bank', hi: 'केनरा बैंक', ifsc: 'CNRB', short: 'Canara' },
  { en: 'Union Bank of India', hi: 'यूनियन बैंक ऑफ इंडिया', ifsc: 'UBIN', short: 'Union Bank' },
];
const UPI_APPS = ['PhonePe', 'Google Pay', 'Paytm', 'BHIM'];
const PAYEES = ['Gupta General Store', 'Shree Ram Medical Store', 'Bikaner Sweets', 'Raju Sabzi Wala', 'Annapurna Kirana', 'Jio Recharge', 'Sharma Dairy', 'Krishna Fruits', 'Om Sai Hardware', 'Royal Tailors', 'Balaji Petrol Pump', 'New Janta Chemist', 'Agarwal Electronics', 'Sai Milk Centre'];

/** Medicines: brand, generic, strength, kind. */
const MEDICINES = [
  ['Telma 40', 'Telmisartan', '40 mg', 'Tab'], ['Glycomet 500', 'Metformin', '500 mg', 'Tab'], ['Amlong 5', 'Amlodipine', '5 mg', 'Tab'],
  ['Dolo 650', 'Paracetamol', '650 mg', 'Tab'], ['Pan 40', 'Pantoprazole', '40 mg', 'Tab'], ['Atorva 10', 'Atorvastatin', '10 mg', 'Tab'],
  ['Amaryl 1', 'Glimepiride', '1 mg', 'Tab'], ['Azithral 500', 'Azithromycin', '500 mg', 'Tab'], ['Cetzine 10', 'Cetirizine', '10 mg', 'Tab'],
  ['Uprise D3 60K', 'Cholecalciferol', '60000 IU', 'Cap'], ['Ecosprin 75', 'Aspirin', '75 mg', 'Tab'], ['Thyronorm 50', 'Thyroxine Sodium', '50 mcg', 'Tab'],
  ['Shelcal 500', 'Calcium Carbonate', '500 mg', 'Tab'], ['Becosules', 'Vitamin B Complex', '', 'Cap'], ['Benadryl', 'Diphenhydramine', '', 'Syrup'],
  ['Augmentin 625', 'Amoxycillin and Clavulanate', '625 mg', 'Tab'], ['Montair LC', 'Montelukast and Levocetirizine', '10 mg', 'Tab'], ['Rosuvas 10', 'Rosuvastatin', '10 mg', 'Tab'],
];
const PHARMA = ['Glenmark Pharmaceuticals Ltd', 'USV Pvt Ltd', 'Micro Labs Ltd', 'Sun Pharmaceutical Ind Ltd', 'Cipla Ltd', 'Alkem Laboratories Ltd', 'Abbott Healthcare Pvt Ltd', 'Torrent Pharmaceuticals Ltd'];
const DOCTORS = [['A. K. Srivastava', 'MBBS, MD (Medicine)'], ['Neelam Gupta', 'MBBS, DGO'], ['R. P. Singh', 'MBBS, MS (Ortho)'], ['S. Khan', 'MBBS, MD (Paediatrics)'], ['Vandana Joshi', 'MBBS, DNB (Family Medicine)'], ['M. L. Verma', 'MBBS, DM (Cardiology)']];
const CLINICS = ['City Hospital', 'Apollo Clinic', 'Sharma Nursing Home', 'Jeevan Jyoti Hospital', 'Sanjivani Health Centre', 'Life Care Polyclinic'];
const LABS = ['Dr Lal PathLabs', 'Thyrocare', 'SRL Diagnostics', 'Metropolis Healthcare', 'Pathkind Labs'];
const LAB_TESTS = [
  ['Complete Blood Count', ['Haemoglobin 12.8 g/dL', 'Total Leucocyte Count 7,400 /cumm', 'Platelet Count 2.4 lakh/cumm']],
  ['Lipid Profile', ['Total Cholesterol 212 mg/dL', 'Triglycerides 168 mg/dL', 'HDL Cholesterol 41 mg/dL', 'LDL Cholesterol 137 mg/dL']],
  ['HbA1c', ['HbA1c 7.4 %', 'Estimated Average Glucose 166 mg/dL']],
  ['Thyroid Profile', ['T3 1.12 ng/mL', 'T4 8.4 ug/dL', 'TSH 5.82 uIU/mL']],
  ['Blood Sugar Fasting', ['Glucose Fasting 126 mg/dL']],
  ['Vitamin D', ['25 OH Vitamin D 14.2 ng/mL']],
];
const COMPANIES = ['Shree Cement Pvt Ltd', 'Sunrise Textiles Pvt Ltd', 'Bharat Engineering Works', 'Maruti Logistics Pvt Ltd', 'Annapurna Foods Pvt Ltd'];
const TRAINS = [['12302', 'Howrah Rajdhani', 'NEW DELHI (NDLS)', 'HOWRAH JN (HWH)'], ['12004', 'Lucknow Shatabdi', 'NEW DELHI (NDLS)', 'LUCKNOW NR (LKO)'], ['12560', 'Shivganga Express', 'NEW DELHI (NDLS)', 'BANARAS (BSBS)'], ['12956', 'Jaipur Mumbai SF Express', 'JAIPUR (JP)', 'MUMBAI CENTRAL (MMCT)'], ['12392', 'Shramjeevi Express', 'NEW DELHI (NDLS)', 'RAJGIR (RGD)']];
const FLIGHTS = [['IndiGo', '6E 2134', 'DEL', 'BOM'], ['Air India', 'AI 433', 'DEL', 'LKO'], ['Akasa Air', 'QP 1305', 'BOM', 'JAI']];
const SHOPS = ['Gupta General Store', 'Shree Ram Medical Store', 'Bikaner Sweets & Namkeen', 'Annapurna Bhojnalaya', 'Om Sai Mobile Repairing', 'Royal Tailors', 'Balaji Kirana Store', 'Krishna Dairy', 'New Fashion Point', 'Maa Durga Electricals'];
const SHOPS_HI = ['गुप्ता जनरल स्टोर', 'श्री राम मेडिकल स्टोर', 'बीकानेर स्वीट्स', 'अन्नपूर्णा भोजनालय', 'ओम साई मोबाइल रिपेयरिंग', 'रॉयल टेलर्स', 'बालाजी किराना स्टोर', 'कृष्णा डेयरी', 'माँ दुर्गा इलेक्ट्रिकल्स', 'शिव शक्ति हार्डवेयर'];

const CHAT_LINES = [
  'Kal 5 baje milte hain', 'Ok beta', 'Happy birthday beta 🎂', 'Khana kha liya?', 'Ghar kab aa rahe ho', 'Doctor ne kya bola',
  'Photo bhejo', 'Good morning ji 🙏', 'Jai Shri Krishna',
  'Meeting is at 4 pm tomorrow', 'Please send the document', 'Reached safely', 'Train late hai 2 ghante', 'Fees jama karni hai kal tak', 'Shaadi ka card aaya hai', 'Dhyan rakhna apna', 'Call me when free',
  'आज खाना क्या बना है', 'मम्मी का फोन आया था', 'कल मंदिर चलेंगे', 'बहुत अच्छी फोटो है', 'जन्मदिन की बधाई',
  'Sabzi le aana aate hue', 'Recharge khatam ho gaya', 'Bank band hai aaj', 'OTP mat batana kisi ko', 'Kitne baje aaoge',
];
const NEWS = [
  'Monsoon to arrive in Kerala by June 1, says IMD', 'Sensex rises 400 points as banks gain', 'मौसम विभाग ने अगले तीन दिन बारिश की चेतावनी दी',
  'India wins series 3-1 against Australia', 'Petrol prices unchanged for the fifth day', 'सरकार ने किसानों के लिए नई योजना की घोषणा की',
  'School holidays extended due to cold wave', 'New metro line to open next month', 'गेहूं की खरीद 15 अप्रैल से शुरू होगी',
  'RBI keeps repo rate unchanged', 'Heatwave alert in north India', 'रेलवे ने त्योहारों के लिए विशेष ट्रेनें चलाईं',
];
const QUOTES = [
  'सुप्रभात आपका दिन शुभ हो', 'Good Morning Have a nice day', 'जीवन में खुश रहना सबसे बड़ी दौलत है', 'Good Night Sweet Dreams',
  'Har din ek naya mauka hai', 'माता पिता की सेवा ही सच्ची पूजा है', 'Smile is the best medicine', 'शुभ रात्रि',
  'Jai Mata Di', 'ॐ नमः शिवाय', 'Radhe Radhe', 'Waheguru Ji Ka Khalsa',
];
const PRODUCTS = [
  ['Tata Salt', 'Vacuum Evaporated Iodised Salt 1 kg'], ['Aashirvaad Atta', 'Whole Wheat Flour 5 kg'], ['Fortune Soyabean Oil', 'Refined Soyabean Oil 1 L'],
  ['Parle-G', 'Original Gluco Biscuits'], ['Amul Butter', 'Pasteurised Butter 500 g'], ['Surf Excel', 'Easy Wash Detergent Powder 1 kg'],
  ['Dettol', 'Antiseptic Liquid 250 ml'], ['Horlicks', 'Health and Nutrition Drink 500 g'],
];
const NOTICES = [
  ['Society Notice', 'Water supply will remain suspended on Sunday from 10 am to 4 pm due to tank cleaning'],
  ['सूचना', 'सभी सदस्यों से निवेदन है कि रखरखाव शुल्क 10 तारीख तक जमा करें'],
  ['School Notice', 'Parent teacher meeting will be held on Saturday at 9 am'],
  ['Notice', 'Lift will be under maintenance on Monday'],
  ['आवश्यक सूचना', 'कल बिजली की आपूर्ति सुबह 9 बजे से दोपहर 2 बजे तक बंद रहेगी'],
];

/**
 * Photos without text, as ML Kit's image labeler describes them (its English
 * labels), with the words a person would search for each. The device bench
 * uses real photos instead; this is the desk stand-in.
 */
const LABEL_SETS = [
  { labels: ['Smile', 'Selfie', 'Fun'], theme: 'selfie' }, { labels: ['Dog', 'Pet'], theme: 'dog' }, { labels: ['Cat', 'Pet'], theme: 'cat' },
  { labels: ['Food', 'Cuisine', 'Dish'], theme: 'food' }, { labels: ['Temple', 'Building'], theme: 'temple' }, { labels: ['Flower', 'Plant', 'Petal'], theme: 'flower' },
  { labels: ['Car', 'Vehicle', 'Wheel'], theme: 'car' }, { labels: ['Cake', 'Dessert', 'Event'], theme: 'cake' }, { labels: ['Sky', 'Cloud'], theme: 'sky' },
  { labels: ['Tree', 'Plant'], theme: 'tree' }, { labels: ['Bird'], theme: 'bird' }, { labels: ['Beach', 'Sea'], theme: 'beach' },
  { labels: ['Baby', 'Smile'], theme: 'baby' }, { labels: ['Bicycle', 'Wheel'], theme: 'bicycle' }, { labels: ['Mountain', 'Sky'], theme: 'mountain' },
  { labels: ['Lighting', 'Event'], theme: 'lights' }, { labels: ['Crowd', 'Event'], theme: 'crowd' }, { labels: ['Jacket', 'Smile'], theme: 'person' },
];

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_HI = ['जनवरी', 'फरवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];

/** Festival days (the day itself, IST) for festival photos and greetings. */
const FESTIVAL_DAYS = {
  diwali: ['2023-11-12', '2024-11-01', '2025-10-20'],
  holi: ['2023-03-08', '2024-03-25', '2025-03-14', '2026-03-04'],
  rakhi: ['2023-08-30', '2024-08-19', '2025-08-09'],
  eid: ['2023-04-22', '2024-04-11', '2025-03-31', '2026-03-20'],
};

/** Words nothing in the gallery says: a search for them should find nothing. */
const ABSENT_WORDS = ['giraffe', 'submarine', 'volcano', 'snowboard', 'saxophone', 'kangaroo', 'igloo', 'telescope', 'pineapple', 'violin', 'पनडुब्बी', 'ज्वालामुखी', 'जिराफ़', 'हिमपात', 'दूरबीन'];

module.exports = {
  PEOPLE, SURNAMES, CITIES, AREAS, POWER, WATER, GAS, BANKS, UPI_APPS, PAYEES, MEDICINES, PHARMA, DOCTORS, CLINICS, LABS, LAB_TESTS,
  COMPANIES, TRAINS, FLIGHTS, SHOPS, SHOPS_HI, CHAT_LINES, NEWS, QUOTES, PRODUCTS, NOTICES, LABEL_SETS, MONTHS_EN, MONTHS_HI,
  FESTIVAL_DAYS, ABSENT_WORDS,
};

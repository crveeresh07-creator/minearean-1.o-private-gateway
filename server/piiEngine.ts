/**
 * Indian PII Detection, Classification, Consistent Masking, and Safe Local Reinsertion Engine
 * Designed for DPDP Act 2023 Compliance (India)
 *
 * Combines:
 * 1. Verhoeff-validated Aadhaar, PAN, GSTIN, Voter ID (EPIC), Passport, IFSC, UPI, Card, Vehicle recognizers
 * 2. Contextual NER & Indian Name Gazetteer (English + code-mixed Devanagari / Kannada)
 * 3. Address & Location entity recognizer
 * 4. Deterministic placeholder consistency across documents & requests
 * 5. Safe local reinsertion that handles paraphrasing, reordering, and dropped tags
 */

import { PRESIDIO_EXTENDED_RULES } from './presidioDatasets';

export interface DetectedEntity {
  entity_type: string;
  value: string;
  start: number;
  end: number;
  score: number;
  method: string;
}

export interface MaskingResult {
  sanitizedText: string;
  tokenMapping: Record<string, string>;
  entityCounts: Record<string, number>;
  detectedEntities: DetectedEntity[];
}

// Verhoeff checksum tables for UIDAI Aadhaar validation
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];

export function validateVerhoeff(numStr: string): boolean {
  const digits = numStr.replace(/\D/g, '').split('').map(Number);
  if (digits.length !== 12) return false;
  let c = 0;
  const reversed = [...digits].reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]];
  }
  return c === 0;
}

// Common Indian First Names & Surnames Gazetteer for unlabelled NER detection
const INDIAN_FIRST_NAMES = new Set([
  'rahul', 'priya', 'amit', 'sneha', 'rohan', 'ananya', 'vikram', 'kavita', 'suresh', 'ramesh',
  'lakshmi', 'karthik', 'arjun', 'deepak', 'pooja', 'neha', 'rajesh', 'sanjay', 'meera', 'divya',
  'mohammed', 'irfan', 'fatima', 'ayesha', 'gurpreet', 'harpreet', 'manpreet', 'siddharth', 'nikhil',
  'aditya', 'aarav', 'ishaan', 'kiran', 'prakash', 'venkatesh', 'srinivas', 'subramanian', 'manjunath',
  'ganesh', 'shiva', 'varun', 'tarun', 'nitin', 'ashok', 'sunita', 'anita', 'rekha', 'geeta', 'swati',
  'shreya', 'ritu', 'manish', 'gaurav', 'abhishek', 'vivek', 'rakesh', 'pankaj', 'yogesh', 'harish',
  'naveen', 'pradeep', 'mahesh', 'dinesh', 'anil', 'sunil', 'vinod', 'ajay', 'vijay', 'sanjeev',
  'rajeev', 'arvind', 'kishore', 'mohan', 'gopal', 'krishna', 'raghav', 'madhav', 'nandini', 'pallavi',
  'rashmi', 'bhavna', 'shweta', 'preeti', 'komal', 'tanvi', 'riya', 'diya', 'aisha', 'zoya', 'farhan',
  'salman', 'imran', 'tariq', 'sameer', 'nadeem', 'wasim', 'karan', 'kabir', 'dev', 'yash', 'tejas',
  'pranav', 'rishabh', 'akash', 'vikas', 'tushar', 'sahil', 'kunal', 'mayank', 'chetan', 'hemant',
  'umesh', 'bharat', 'chandan', 'darshan', 'girish', 'jagdish', 'lokesh', 'mukesh', 'naresh', 'paresh',
  'satish', 'nandakumar', 'veeresh', 'basavaraj', 'shankar', 'narayan', 'radha', 'seema', 'asha',
  'kalyani', 'gayatri', 'bhagyashree', 'sowmya', 'vidya', 'padma', 'rohit', 'mohit', 'sumit', 'ankit',
  'nitish', 'harsh', 'shubham', 'aditi', 'anjali', 'archana', 'deepa', 'ishita', 'jyoti', 'kaveri',
  'madhuri', 'nisha', 'parvati', 'revathi', 'sangeeta', 'sarita', 'uma', 'vandana', 'vasudha',
  'arun', 'ashwin', 'bala', 'chandru', 'devaraj', 'gautam', 'govind', 'hari', 'jagadish', 'jayant',
  'kamal', 'kapil', 'krishnamurthy', 'madhu', 'manoj', 'murali', 'nagaraj', 'narendra', 'naveen',
  'omkar', 'pavan', 'pramod', 'prashanth', 'prem', 'raghavendra', 'rahul', 'raj', 'raja', 'rajendra',
  'ram', 'ramakrishna', 'ravi', 'ravindra', 'sachin', 'sagar', 'santosh', 'satya', 'saurabh', 'shashi',
  'shekhar', 'shyam', 'siddhartha', 'subhash', 'sudhir', 'suhas', 'suraj', 'surya', 'uday', 'venkat',
  'vignesh', 'vishal', 'vishwanath', 'yusuf', 'zaheer', 'zainab', 'kavya', 'shruthi', 'shruti', 'aparna',
  'veeresh', 'puneeth', 'shivaraj', 'rajkumar', 'rakshit', 'rishab', 'upendra', 'sudeep', 'chethan', 'santhosh',
  'spoorthi', 'rakshitha', 'sindhu', 'keerthi', 'nethra', 'sahana', 'harshitha', 'sandeep', 'sandhya',
  'priyanka', 'deepika', 'nikita', 'sakshi', 'shalini', 'shilpa', 'shobha', 'shraddha', 'simran', 'sujata',
  'supriya', 'sushma', 'vaishali', 'varsha', 'yamini', 'neeraj', 'piyush', 'vaibhav', 'utkarsh', 'srikanth'
]);

const INDIAN_SURNAMES = new Set([
  'sharma', 'verma', 'gupta', 'patel', 'singh', 'kumar', 'reddy', 'nair', 'iyer', 'iyengar',
  'kulkarni', 'joshi', 'deshmukh', 'patil', 'gowda', 'shetty', 'hegde', 'bhat', 'kamath', 'menon',
  'pillai', 'kurian', 'thomas', 'joseph', 'mathew', 'george', 'fernandes', 'banerjee', 'chatterjee',
  'mukherjee', 'das', 'bose', 'sen', 'roy', 'dutta', 'ghosh', 'mishra', 'tiwari', 'pandey', 'shukla',
  'dubey', 'tripathi', 'chauhan', 'rathore', 'rajput', 'yadav', 'jain', 'agarwal', 'bansal', 'mittal',
  'goel', 'singhal', 'kapoor', 'malhotra', 'khanna', 'bhatia', 'arora', 'sethi', 'chopra', 'mehra',
  'tandon', 'saxena', 'srivastava', 'mathur', 'rastogi', 'choudhary', 'chaudhary', 'thakur', 'solanki',
  'parmar', 'jadeja', 'mehta', 'shah', 'desai', 'parekh', 'modi', 'gandhi', 'kothari', 'zaveri',
  'naidu', 'raju', 'murthy', 'sastry', 'prasad', 'varma', 'chakraborty', 'bhattacharya', 'sengupta',
  'kaur', 'gill', 'sandhu', 'dhillon', 'sidhu', 'grewal', 'brar', 'bajaj', 'khurana', 'talwar',
  'wadhwa', 'saini', 'rana', 'negi', 'bisht', 'rawat', 'khan', 'ansari', 'siddiqui', 'qureshi',
  'sheikh', 'shaikh', 'syed', 'mirza', 'begum', 'ali', 'hussain', 'ahmed', 'krishnan', 'subramanian',
  'sundaram', 'ramachandran', 'venkataraman', 'natarajan', 'balasubramanian', 'deshpande', 'gokhale',
  'apte', 'chitale', 'phadke', 'bhave', 'kamat', 'pai', 'shenoy', 'nayak', 'acharya', 'upadhyay',
  'shastri', 'dikshit', 'trivedi', 'dwivedi', 'chaturvedi', 'bajpai', 'pathak', 'nigam', 'bhargava', 'poojary', 'rao'
]);

const KANNADA_FIRST_NAMES = new Set([
  'ರವಿ', 'ತರುಣ್', 'ರಮೇಶ್', 'ಸುರೇಶ್', 'ಮಹೇಶ್', 'ಗಣೇಶ್', 'ವೀರೇಶ್', 'ಮಂಜುನಾಥ್', 'ಬಸವರಾಜ್', 'ನಾಗರಾಜ್', 'ವೆಂಕಟೇಶ್',
  'ರಾಹುಲ್', 'ಅರ್ಜುನ್', 'ಕಿರಣ್', 'ಪ್ರಕಾಶ್', 'ರವೀಂದ್ರ', 'ರಾಜೇಶ್', 'ಸಂಜಯ್', 'ಅನಿಲ್', 'ಸುನೀಲ್', 'ಅರುಣ್', 'ನವೀನ್', 'ದೀಪಕ್',
  'ವಿನಯ್', 'ಕಾರ್ತಿಕ್', 'ಪ್ರವೀಣ್', 'ಸಂತೋಷ್', 'ಚೇತನ್', 'ದರ್ಶನ್', 'ಪುನೀತ್', 'ಸುದೀಪ್', 'ಶಿವರಾಜ್', 'ವಿವೇಕ್', 'ಅಭಿಷೇಕ್',
  'ಲಕ್ಷ್ಮಿ', 'ಪ್ರಿಯಾ', 'ಕಾವ್ಯ', 'ಅನನ್ಯ', 'ದಿವ್ಯ', 'ಸೌಮ್ಯ', 'ರಶ್ಮಿ', 'ಸ್ವಾತಿ', 'ಶ್ರುತಿ', 'ಸ್ನೇಹ', 'ಕವಿತಾ', 'ಪೂಜಾ', 'ನೇಹಾ', 'ಅಂಜಲಿ'
]);

const KANNADA_SURNAMES = new Set([
  'ಕುಮಾರ್', 'ಗೌಡ', 'ಶೆಟ್ಟಿ', 'ಹೆಗ್ಡೆ', 'ಕುಲಕರ್ಣಿ', 'ಪಾಟೀಲ್', 'ದೇಶಪಾಂಡೆ', 'ಜೋಶಿ', 'ಭಟ್', 'ಕಾಮತ್',
  'ರಾವ್', 'ಮೂರ್ತಿ', 'ನಾಯಕ್', 'ನಾಯರ್', 'ಆಚಾರ್ಯ', 'ಶರ್ಮಾ', 'ರೆಡ್ಡಿ', 'ಪೂಜಾರಿ', 'ಪೈ', 'ಶೆಣೈ', 'ದೇವಿ', 'ಬಾಬು', 'ರಾಜು'
]);

const KANNADA_STOPWORDS = new Set([
  'ಮತ್ತು', 'ಹಾಗೂ', 'ಅಥವಾ', 'ಬ್ಯಾಂಕ್', 'ಖಾತೆ', 'ನಿಯಮಿತ', 'ಶಾಖೆ', 'ಅವರ', 'ಅವರು', 'ಇವರ', 'ಇವರು',
  'ತಮ್ಮ', 'ನಮ್ಮ', 'ಎಂಬ', 'ಎಂದು', 'ಸಹ', 'ಕೂಡ', 'ಅವರಿಗೆ', 'ಇವರಿಗೆ', 'ಹೆಸರು', 'ವಿಳಾಸ', 'ಆಧಾರ್',
  'ಪ್ಯಾನ್', 'ಮೊಬೈಲ್', 'ಇಲ್ಲ', 'ತಿಳಿದಿಲ್ಲ', 'ಲಭ್ಯವಿಲ್ಲ', 'ಬಗ್ಗೆ', 'ಮೇಲೆ', 'ಕುರಿತು', 'ಮೂಲಕ', 'ಸ್ಥಳ'
]);

// Names that double as common non-person words (tech terms, country/river names) when appearing alone without a surname/label
const SINGLE_NAME_EXCLUDE = new Set([
  'ram', 'dev', 'prem', 'om', 'raj', 'bharat', 'kaveri'
]);

const NON_PERSON_WORDS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'smt', 'kumari', 'prof', 'adv', 'er',
  'bank', 'india', 'indian', 'limited', 'ltd', 'pvt', 'private', 'public', 'road', 'street', 'nagar',
  'layout', 'colony', 'sector', 'phase', 'block', 'floor', 'tower', 'apartment', 'apartments', 'plaza',
  'centre', 'center', 'hospital', 'clinic', 'insurance', 'policy', 'claim', 'loan', 'account', 'branch',
  'state', 'central', 'national', 'reserve', 'ministry', 'department', 'government', 'authority',
  'karnataka', 'maharashtra', 'delhi', 'mumbai', 'bengaluru', 'bangalore', 'chennai', 'hyderabad',
  'kolkata', 'pune', 'ahmedabad', 'jaipur', 'lucknow', 'surat', 'kochi', 'noida', 'gurugram', 'gurgaon',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'section', 'act', 'notice', 'order', 'form', 'application', 'ticket', 'support', 'customer', 'service',
  'total', 'amount', 'balance', 'credit', 'debit', 'tax', 'gst', 'income', 'finance', 'financial',
  'not', 'none', 'nil', 'na', 'unknown', 'provided', 'available', 'pending', 'verified', 'team',
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'have', 'been', 'will', 'your', 'please', 'sir', 'madam'
]);

const PAN_FOURTH_CHARS = new Set(['A', 'B', 'C', 'F', 'G', 'H', 'L', 'J', 'P', 'T']);

interface PatternRule {
  entityType: string;
  regex: RegExp;
  groupIndex: number;
  score: number;
  method: string;
  validate?: (value: string, fullText: string, start: number, end: number) => boolean;
}

function hasContextAround(text: string, start: number, end: number, keywords: RegExp, radius = 65): boolean {
  const windowStart = Math.max(0, start - radius);
  const windowEnd = Math.min(text.length, end + radius);
  return keywords.test(text.slice(windowStart, windowEnd));
}

const RULES: PatternRule[] = [
  // 1. GSTIN (15 chars) - check before PAN because GSTIN embeds a PAN!
  {
    entityType: 'GSTIN',
    regex: /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/g,
    groupIndex: 1,
    score: 0.99,
    method: 'regex+checksum-format'
  },

  // 2. Aadhaar (with explicit context or grouped 12 digits or Verhoeff-valid 12 digits)
  {
    entityType: 'AADHAAR',
    regex: /(?:Aadhaar|Aadhar|UIDAI|UID|आधार|ಆಧಾರ್)(?:\s*(?:No\.?|Number|ID|Card|ಸಂಖ್ಯೆ|संख्या|#))?[:\s#*-]*([1-9][0-9]{3}[-\s]?[0-9]{4}[-\s]?[0-9]{4})\b/gi,
    groupIndex: 1,
    score: 0.99,
    method: 'context+aadhaar'
  },
  // 2b. Bank Account Numbers (contextual - check before unlabelled Aadhaar so 12-digit Bank Acc is never misclassified)
  {
    entityType: 'BANK_ACC',
    regex: /(?:Bank[ \t]*(?:A\/C|Account|Acc\.?)|Savings[ \t]*(?:A\/C|Account|Acc\.?)|Current[ \t]*(?:A\/C|Account|Acc\.?)|Salary[ \t]*(?:A\/C|Account|Acc\.?)|Loan[ \t]*(?:A\/C|Account|Acc\.?)|Disbursement[ \t]*(?:A\/C|Account|Acc\.?)|Settlement[ \t]*(?:A\/C|Account|Acc\.?)|Account|A\/C|Acc\.?|ಬ್ಯಾಂಕ್[ \t]*ಖಾತೆ(?:\s*ಸಂಖ್ಯೆ)?|ಉಳಿತಾಯ[ \t]*ಖಾತೆ(?:\s*ಸಂಖ್ಯೆ)?|ಖಾತೆ(?:\s*ಸಂಖ್ಯೆ)?|खाता(?:\s*संख्या)?)(?:[ \t]*(?:No\.?|Number|Num|ID|#))?[:\s#*-]*([0-9][0-9 \t-]{7,20}[0-9])\b/gi,
    groupIndex: 1,
    score: 0.97,
    method: 'context+bank-account',
    validate: (val) => {
      const digits = val.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 18;
    }
  },
  {
    entityType: 'AADHAAR',
    regex: /\b([1-9][0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4})\b/g,
    groupIndex: 1,
    score: 0.97,
    method: 'aadhaar-grouped',
    validate: (val, fullText, start, end) => {
      const hasAadhaarHint = hasContextAround(fullText, start, end, /\b(?:aadhaar|aadhar|uid|uidai)\b/i, 40);
      if (!hasAadhaarHint && hasContextAround(fullText, start, end, /\b(?:card|debit|credit|visa|mastercard|rupay|bank|account|a\/c|acc|ifsc|savings|current|loan)\b/i, 35)) {
        return false;
      }
      return val.replace(/\D/g, '').length === 12;
    }
  },
  {
    entityType: 'AADHAAR',
    regex: /\b([2-9][0-9]{11})\b/g,
    groupIndex: 1,
    score: 0.95,
    method: 'aadhaar-verhoeff',
    validate: (val, fullText, start, end) => {
      const hasAadhaarHint = hasContextAround(fullText, start, end, /\b(?:aadhaar|aadhar|uid|uidai|kyc|ekyc)\b/i, 50);
      if (!hasAadhaarHint && hasContextAround(fullText, start, end, /\b(?:bank|account|a\/c|acc|ifsc|savings|current|loan)\b/i, 35)) {
        return false;
      }
      return validateVerhoeff(val) || hasAadhaarHint;
    }
  },

  // 3. PAN Card (contextual in English/Kannada/Hindi including 9-10 char forms + strict unlabelled 10-char)
  {
    entityType: 'PAN',
    regex: /(?:PAN(?:\s*(?:Card|No\.?|Number|ID|#))?|ಪ್ಯಾನ್(?:\s*(?:ಕಾರ್ಡ್|ಸಂಖ್ಯೆ))?|पैन(?:\s*(?:कार्ड|संख्या))?|स्थाई\s*खाता\s*संख्या(?:\s*\(PAN\))?)[:\s#*-]*([A-Za-z]{5}[0-9]{4}[A-Za-z]?)\b/gi,
    groupIndex: 1,
    score: 0.99,
    method: 'context+pan'
  },
  {
    entityType: 'PAN',
    regex: /\b([A-Z]{5}[0-9]{4}[A-Z]{1})\b/g,
    groupIndex: 1,
    score: 0.98,
    method: 'indian-pan-recognizer',
    validate: (val, fullText, start, end) => {
      return PAN_FOURTH_CHARS.has(val[3]) || hasContextAround(fullText, start, end, /\b(?:pan|tax|income|kyc|permanent account)\b/i, 50);
    }
  },

  // 4. IFSC Code (contextual English/Kannada/Hindi with ZWNJ/dot/markdown tolerance + standard & extended unlabelled IFSC)
  {
    entityType: 'IFSC',
    regex: /(?:I[\s.]*F[\s.]*S[\s.]*C\.?(?:[\s\/]*(?:Code|No\.?|Number))?|ಐ[\s.\u200C\u200D]*ಎಫ್[\s.\u200C\u200D]*ಎಸ್[\s.\u200C\u200D]*ಸಿ\.?(?:[\s\u200C\u200D]*(?:ಕೋಡ್|ಸಂಖ್ಯೆ))?|आई[\s.\u200C\u200D]*एफ[\s.\u200C\u200D]*एस[\s.\u200C\u200D]*सी\.?(?:[\s\u200C\u200D]*(?:कोड|संख्या))?)(?:[ \t]*\/[ \t]*(?:IFSC[ \t]*(?:Code)?|ಐಎಫ್ಎಸ್ಸಿ[ \t]*(?:ಕೋಡ್)?))?[:\s#*`"'(\[\]-]*([A-Z0-9]{8,14})\b/gi,
    groupIndex: 1,
    score: 0.99,
    method: 'context+ifsc',
    validate: (val) => /[A-Z]/i.test(val) && /[0-9]/.test(val)
  },
  {
    entityType: 'IFSC',
    regex: /\b([A-Z]{4}0[A-Z0-9]{6})\b/g,
    groupIndex: 1,
    score: 0.98,
    method: 'indian-ifsc-recognizer'
  },
  {
    entityType: 'IFSC',
    regex: /\b([A-Z]{4}[0-9]{5,7}[A-Z0-9]{0,2})\b/g,
    groupIndex: 1,
    score: 0.94,
    method: 'indian-ifsc-extended',
    validate: (val) => !/^(?:TEST|DEMO|ITEM|PAGE|PART|YEAR|CODE|FORM|DATE|CERT|BILL|INVN)/i.test(val)
  },

  // 5. Voter ID (EPIC)
  {
    entityType: 'VOTER_ID',
    regex: /(?:Voter\s*ID|EPIC(?:\s*No\.?)?|Electoral\s*ID)[:\s#*-]*([A-Z]{2,3}[0-9]{7})\b/gi,
    groupIndex: 1,
    score: 0.98,
    method: 'context+voter-id'
  },
  {
    entityType: 'VOTER_ID',
    regex: /\b([A-Z]{3}[0-9]{7})\b/g,
    groupIndex: 1,
    score: 0.92,
    method: 'indian-epic-recognizer',
    validate: (_val, fullText, start, end) => {
      return !hasContextAround(fullText, start, end, /\b(?:ifsc|order|invoice|ticket|claim|policy)\b/i, 30);
    }
  },

  // 6. Passport Number (Indian: 1 letter + 7 digits)
  {
    entityType: 'PASSPORT',
    regex: /(?:Passport(?:\s*(?:No\.?|Number|#))?)[:\s#*-]*([A-Z][0-9]{7})\b/gi,
    groupIndex: 1,
    score: 0.98,
    method: 'context+passport'
  },
  {
    entityType: 'PASSPORT',
    regex: /\b([A-PR-WY][1-9][0-9]{6})\b/g,
    groupIndex: 1,
    score: 0.9,
    method: 'indian-passport-recognizer',
    validate: (_val, fullText, start, end) => {
      return hasContextAround(fullText, start, end, /\b(?:passport|travel|visa|kyc|immigration)\b/i, 60);
    }
  },

  // 7. Email Address
  {
    entityType: 'EMAIL',
    regex: /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10})\b/g,
    groupIndex: 1,
    score: 0.99,
    method: 'presidio-email'
  },

  // 8. UPI ID
  {
    entityType: 'UPI_ID',
    regex: /\b([a-zA-Z0-9._-]{2,}@(?:oksbi|okaxis|okicici|okhdfcbank|ybl|paytm|ibl|upi|axl|sbi|hdfcbank|icici|apl|pingpay|fbl))\b/gi,
    groupIndex: 1,
    score: 0.97,
    method: 'indian-upi-recognizer'
  },

  // 9. Credit / Debit Card Number (16 digits grouped)
  {
    entityType: 'CARD_NO',
    regex: /\b([3-6][0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4}[-\s][0-9]{4})\b/g,
    groupIndex: 1,
    score: 0.96,
    method: 'card-pattern'
  },

  // 10. Indian Mobile & Phone Numbers (contextual Phno/Phone/Mobile first, then unlabelled)
  {
    entityType: 'PHONE',
    regex: /(?:Ph\.?[ \t]*No\.?|Phno|Phone(?:[ \t]*(?:No\.?|Number))?|Mobile(?:[ \t]*(?:No\.?|Number))?|Mob\.?|Tel(?:[ \t]*(?:No\.?))?|Telephone|Contact(?:[ \t]*(?:No\.?|Number|Mobile|Phone))?|WhatsApp|मोबाइल(?:[ \t]*नंबर)?|ಫೋನ್(?:[ \t]*ಸಂಖ್ಯೆ)?|ದೂರವಾಣಿ(?:[ \t]*ಸಂಖ್ಯೆ)?|ಮೊಬೈಲ್(?:[ \t]*ಸಂಖ್ಯೆ)?)[:\s#*-]*((?:\+?91[-\s]?|0)?[6-9][0-9]{4}[-\s]?[0-9]{5})\b/gi,
    groupIndex: 1,
    score: 0.99,
    method: 'context+phone'
  },
  {
    entityType: 'PHONE',
    regex: /(?<!\d)((?:\+?91[-\s]?|0)?[6-9][0-9]{4}[-\s]?[0-9]{5})(?!\d)/g,
    groupIndex: 1,
    score: 0.97,
    method: 'indian-phone-recognizer',
    validate: (val, fullText, start, _end) => {
      const digits = val.replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 11 || digits.length === 12) {
        const prefixWindow = fullText.slice(Math.max(0, start - 22), start);
        if (/\b(?:account|a\/c|policy|claim|loan|ticket|ref)\b/i.test(prefixWindow) && !val.startsWith('+91') && !val.includes('-')) {
          return false;
        }
        return true;
      }
      return false;
    }
  },

  // (Contextual Bank Account rule is evaluated above unlabelled Aadhaar rules)

  // 12. Vehicle Registration (Indian format e.g. KA-01-AB-1234, MH 12 DE 4567)
  {
    entityType: 'VEHICLE_REG',
    regex: /\b([A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}[-\s]?[0-9]{4})\b/g,
    groupIndex: 1,
    score: 0.91,
    method: 'indian-rto-recognizer',
    validate: (_val, fullText, start, end) => {
      return hasContextAround(fullText, start, end, /\b(?:vehicle|car|bike|motor|reg|registration|chassis|accident|insurance|rto)\b/i, 60);
    }
  },

  // 13. Date of Birth (contextual)
  {
    entityType: 'DOB',
    regex: /(?:DOB|D\.O\.B\.?|Date\s*of\s*Birth|Born\s*(?:on)?|जन्म\s*तिथि|ಹುಟ್ಟಿದ\s*ದಿನಾಂಕ)[:\s#*-]*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+[0-9]{4})\b/gi,
    groupIndex: 1,
    score: 0.95,
    method: 'context+dob'
  },

  // 14. Street / Residential Address (labelled)
  {
    entityType: 'ADDRESS',
    regex: /(?:Residential\s*Address|Permanent\s*Address|Correspondence\s*Address|Current\s*Address|Mailing\s*Address|Billing\s*Address|Home\s*Address|Address|पता|ವಿಳಾಸ)[:\s*-]+([^\n|]{8,180})/gi,
    groupIndex: 1,
    score: 0.93,
    method: 'context+address',
    validate: (val) => {
      const trimmed = val.trim();
      if (trimmed.length < 8) return false;
      // Avoid masking simple section titles or single words
      return /[0-9,]/.test(trimmed) || /\b(?:road|street|st|nagar|layout|colony|floor|flat|house|plot|sector|block|cross|main|lane|avenue|marg|vihar|enclave|puram|bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune|kolkata|india)\b/i.test(trimmed);
    }
  },

  // 15. Unlabelled Indian Street / Flat Address
  {
    entityType: 'ADDRESS',
    regex: /\b((?:Flat|House|Door|Plot|H\.?\s*No\.?|D\.?\s*No\.?|#)[ \t]*[A-Za-z0-9\/-]+(?:,[ \t]*(?:[A-Za-z0-9 \t'-]|\.(?=\S)){2,40}){1,5}(?:[-\s,]+[1-9][0-9]{5})?)/gi,
    groupIndex: 1,
    score: 0.89,
    method: 'ner-address-structure',
    validate: (val) => val.trim().length >= 12
  },
  {
    entityType: 'ADDRESS',
    regex: /\b([0-9]{1,4}(?:st|nd|rd|th|[A-Za-z])?(?:\/[0-9A-Za-z-]+)?,?[ \t]+[A-Za-z0-9 \t'-]{2,40}\b(?:Road|Street|St\.?|Nagar|Layout|Colony|Sector|Phase|Block|Cross|Main|Lane|Avenue|Marg|Vihar|Enclave|Puram|Extension|Ext\.?)\b(?:,[ \t]*(?:[A-Za-z0-9 \t'-]|\.(?=\S)){2,35}){0,4}(?:[-\s,]+[1-9][0-9]{5})?)/gi,
    groupIndex: 1,
    score: 0.88,
    method: 'ner-street-address',
    validate: (val) => val.trim().length >= 12
  },

  // 16. PIN Code (contextual or in address context)
  {
    entityType: 'PINCODE',
    regex: /(?:PIN(?:\s*Code)?|Postal\s*Code|Zip)[:\s-]*([1-9][0-9]{5})\b/gi,
    groupIndex: 1,
    score: 0.95,
    method: 'context+pincode'
  },
  {
    entityType: 'PINCODE',
    regex: /\b([1-9][0-9]{5})\b/g,
    groupIndex: 1,
    score: 0.86,
    method: 'indian-pincode',
    validate: (_val, fullText, start, end) => {
      return hasContextAround(fullText, start, end, /\b(?:india|karnataka|maharashtra|delhi|tamil|kerala|telangana|gujarat|rajasthan|bengal|bengaluru|bangalore|mumbai|chennai|hyderabad|pune|kolkata|address|nagar|road|pin|city|state)\b/i, 65);
    }
  },

  // 17. Person Names (English & Kannada Honorifics, Bilingual Contextual Labels, Indic & English Gazetteer NER)
  {
    entityType: 'PERSON',
    regex: /(?:Mr\.|Mrs\.|Ms\.|Miss|Dr\.|Shri|Smt\.|Kumari|Prof\.|Adv\.|Er\.)[ \t]+((?:[A-Z][a-z]+|[A-Z]\.)(?:[ \t]+[A-Z][a-z]+|[ \t]+[A-Z]\.?(?=[ \t\r\n]|$|[,\)])){0,3})/g,
    groupIndex: 1,
    score: 0.96,
    method: 'honorific+ner',
    validate: (val) => {
      const parts = val.trim().split(/\s+/);
      return parts.length >= 1 && !NON_PERSON_WORDS.has(parts[0].toLowerCase());
    }
  },
  // Kannada honorifics: ಶ್ರೀ, ಶ್ರೀಮತಿ, ಕುಮಾರಿ, ಡಾ., ಪ್ರೊ.
  {
    entityType: 'PERSON',
    regex: /(?:ಶ್ರೀಮತಿ|ಶ್ರೀ|ಕುಮಾರಿ|ಡಾ\.|ಪ್ರೊ\.)[ \t]+((?!(?:ಮತ್ತು|ಹಾಗೂ|ಅಥವಾ|ಅವರ|ಅವರು|ಇವರ|ಇವರು|ಶ್ರೀಮತಿ|ಶ್ರೀ|ಕುಮಾರಿ|ಬ್ಯಾಂಕ್|ಖಾತೆ|ಹೆಸರು|ವಿಳಾಸ|ಆಧಾರ್|ಪ್ಯಾನ್|ಮೊಬೈಲ್)(?:[ \t\r\n.,]|$))[\u0C80-\u0CFF]+(?:[ \t]+(?!(?:ಮತ್ತು|ಹಾಗೂ|ಅಥವಾ|ಅವರ|ಅವರು|ಇವರ|ಇವರು|ಶ್ರೀಮತಿ|ಶ್ರೀ|ಕುಮಾರಿ|ಬ್ಯಾಂಕ್|ಖಾತೆ|ಹೆಸರು|ವಿಳಾಸ|ಆಧಾರ್|ಪ್ಯಾನ್|ಮೊಬೈಲ್)(?:[ \t\r\n.,]|$))[\u0C80-\u0CFF]+){0,3})/gu,
    groupIndex: 1,
    score: 0.96,
    method: 'kannada-honorific+ner',
    validate: (val) => {
      const parts = val.trim().split(/\s+/);
      return parts.length >= 1 && !parts.some(p => KANNADA_STOPWORDS.has(p));
    }
  },
  // English or bilingual labelled English names (e.g. "Full Name: Ramesh Kumar", "Name: ravi kumar", "Name: tarun", "ಹೆಸರು / Name: Ramesh Kumar")
  {
    entityType: 'PERSON',
    regex: /(?:(?:ಪೂರ್ಣ[ \t]+ಹೆಸರು|ಖಾತೆದಾರರ[ \t]+ಹೆಸರು|ಗ್ರಾಹಕರ[ \t]+ಹೆಸರು|ಹೆಸರು|नाम|आवेदक|ग्राहक)[ \t]*\/[ \t]*)?(?:Applicant(?:[ \t]*Name)?|Customer(?:[ \t]*Name)?|Borrower(?:[ \t]*Name)?|Policyholder(?:[ \t]*Name)?|Insured(?:[ \t]*Name)?|Claimant(?:[ \t]*Name)?|Nominee(?:[ \t]*Name)?|Account[ \t]+Holder(?:[ \t]*Name)?|Beneficiary|Payee|Full[ \t]+Name|Name|Father(?:'s)?[ \t]+Name|Mother(?:'s)?[ \t]+Name|Spouse[ \t]+Name|S\/o|D\/o|W\/o|C\/o|Signed[ \t]+by|Dear|ಪೂರ್ಣ[ \t]+ಹೆಸರು|ಖಾತೆದಾರರ[ \t]+ಹೆಸರು|ಖಾತೆದಾರರು|ಗ್ರಾಹಕರ[ \t]+ಹೆಸರು|ಗ್ರಾಹಕರು|ಅರ್ಜಿದಾರರು|ಹೆಸರು)[ \t]*[:\-|][ \t*]*(?:[\u0C80-\u0CFF\u0900-\u097F]+(?:[ \t]+[\u0C80-\u0CFF\u0900-\u097F]+){0,3}[ \t]*[\(\/][ \t]*)?((?:[A-Za-z][a-z]+|[A-Z]{2,15}|[A-Z]\.)(?:[ \t]+[A-Za-z][a-z]+|[ \t]+[A-Z]{2,15}|[ \t]+[A-Z]\.?(?=[ \t\r\n]|$|[,\)\/*])){0,3})/g,
    groupIndex: 1,
    score: 0.95,
    method: 'context+person-ner',
    validate: (val) => {
      const words = val.trim().split(/\s+/);
      if (words.length < 1 || words[0].length < 2) return false;
      if (words.every(w => w === w.toUpperCase()) && words.length === 1 && words[0].length <= 3) return false;
      return words.every(w => !NON_PERSON_WORDS.has(w.toLowerCase()));
    }
  },
  // Kannada & Devanagari labelled names (with Kannada, Hindi, English, or bilingual labels, plus dual-script parenthetical form)
  {
    entityType: 'PERSON',
    regex: /(?:ಪೂರ್ಣ[ \t]+ಹೆಸರು|ಖಾತೆದಾರರ[ \t]+ಹೆಸರು|ಖಾತೆದಾರರು|ಗ್ರಾಹಕರ[ \t]+ಹೆಸರು|ಗ್ರಾಹಕರು|ಅರ್ಜಿದಾರರು|ಹೆಸರು|नाम|आवेदक|ग्राहक|Full[ \t]+Name|Customer[ \t]+Name|Applicant[ \t]+Name|Account[ \t]+Holder(?:[ \t]+Name)?|Name)(?:[ \t]*\/[ \t]*(?:[A-Za-z ]+|[\u0C80-\u0CFF\u0900-\u097F ]+))?[ \t]*[:\-|][ \t*]*(?:[A-Za-z. ]+[ \t]*[\(\/][ \t]*)?((?!(?:ಮತ್ತು|ಹಾಗೂ|ಅಥವಾ|ಅವರ|ಅವರು|ಇಲ್ಲ|ತಿಳಿದಿಲ್ಲ|ಲಭ್ಯವಿಲ್ಲ)(?:[ \t\r\n.,*]|$))[\u0C80-\u0CFF\u0900-\u097F]+(?:[ \t]+(?!(?:ಮತ್ತು|ಹಾಗೂ|ಅಥವಾ|ಅವರ|ಅವರು|ಬ್ಯಾಂಕ್|ಖಾತೆ)(?:[ \t\r\n.,*]|$))[\u0C80-\u0CFF\u0900-\u097F]+){0,3})/gu,
    groupIndex: 1,
    score: 0.95,
    method: 'indic-ner',
    validate: (val) => {
      const words = val.trim().split(/\s+/);
      return words.length >= 1 && words[0].length >= 2 && !words.some(w => KANNADA_STOPWORDS.has(w));
    }
  },
  // Unlabelled Kannada Name Gazetteer NER (e.g. "ರಮೇಶ್ ಕುಮಾರ್", "ರವಿ ಕುಮಾರ್" anywhere in prose)
  {
    entityType: 'PERSON',
    regex: /([\u0C80-\u0CFF]{2,18}[ \t]+(?!(?:ಮತ್ತು|ಹಾಗೂ|ಅಥವಾ|ಅವರ|ಅವರು|ಇವರ|ಇವರು|ತಮ್ಮ|ಬ್ಯಾಂಕ್|ಖಾತೆ|ನಿಯಮಿತ|ಶಾಖೆ)(?:[ \t\r\n.,]|$))[\u0C80-\u0CFF]{2,20}(?:[ \t]+(?!(?:ಮತ್ತು|ಹಾಗೂ|ಅಥವಾ|ಅವರ|ಅವರು|ಇವರ|ಇವರು|ತಮ್ಮ|ಬ್ಯಾಂಕ್|ಖಾತೆ|ನಿಯಮಿತ|ಶಾಖೆ)(?:[ \t\r\n.,]|$))[\u0C80-\u0CFF]{2,15})?)/gu,
    groupIndex: 1,
    score: 0.91,
    method: 'kannada-gazetteer-ner',
    validate: (val) => {
      const parts = val.trim().split(/\s+/);
      if (parts.length < 2) return false;
      if (parts.some(p => KANNADA_STOPWORDS.has(p))) return false;
      return KANNADA_FIRST_NAMES.has(parts[0]) || KANNADA_SURNAMES.has(parts[parts.length - 1]);
    }
  },
  // Unlabelled Indian 3-Word Name Gazetteer NER (e.g. "Rajesh Kumar Sharma")
  {
    entityType: 'PERSON',
    regex: /\b([A-Za-z]{3,15}[ \t]+[A-Za-z]{2,18}[ \t]+[A-Za-z]{2,15})\b/g,
    groupIndex: 1,
    score: 0.91,
    method: 'gazetteer-ner-3',
    validate: (val) => {
      const parts = val.trim().split(/\s+/);
      if (parts.length !== 3) return false;
      const lowerParts = parts.map(p => p.toLowerCase());
      if (lowerParts.some(w => NON_PERSON_WORDS.has(w))) return false;
      const allCapitalized = parts.every(p => /^[A-Z][a-z]+$/.test(p));
      const firstMatch = INDIAN_FIRST_NAMES.has(lowerParts[0]);
      const midMatch = INDIAN_FIRST_NAMES.has(lowerParts[1]) || INDIAN_SURNAMES.has(lowerParts[1]);
      const lastMatch = INDIAN_SURNAMES.has(lowerParts[2]);
      if (allCapitalized) {
        return firstMatch && (midMatch || lastMatch);
      }
      return firstMatch && midMatch && lastMatch;
    }
  },
  // Unlabelled Indian 2-Word Name Gazetteer NER (supports Title Case "Ravi Kumar" and lowercase "ravi kumar")
  {
    entityType: 'PERSON',
    regex: /\b([A-Za-z]{3,15}[ \t]+[A-Za-z]{2,18})\b/g,
    groupIndex: 1,
    score: 0.9,
    method: 'gazetteer-ner',
    validate: (val) => {
      const parts = val.trim().split(/\s+/);
      if (parts.length !== 2) return false;
      const lowerParts = parts.map(p => p.toLowerCase());
      if (lowerParts.some(w => NON_PERSON_WORDS.has(w))) return false;
      const allCapitalized = parts.every(p => /^[A-Z][a-z]+$/.test(p));
      const firstMatch = INDIAN_FIRST_NAMES.has(lowerParts[0]);
      const lastMatch = INDIAN_SURNAMES.has(lowerParts[1]);
      if (allCapitalized) {
        return firstMatch || lastMatch;
      }
      // For lowercase / mixed case (e.g. "ravi kumar"), require strong dual-name signal to avoid English false positives
      return firstMatch && lastMatch;
    }
  },
  // Unlabelled Single-Word Unambiguous Indian & Kannada Names (e.g. "tarun", "Tarun", "ravi", "ತರುಣ್", "ರವಿ")
  {
    entityType: 'PERSON',
    regex: /\b([A-Za-z]{4,18})\b/g,
    groupIndex: 1,
    score: 0.87,
    method: 'single-name-ner',
    validate: (val, fullText, start, end) => {
      const lower = val.toLowerCase();
      if (!INDIAN_FIRST_NAMES.has(lower) || SINGLE_NAME_EXCLUDE.has(lower) || NON_PERSON_WORDS.has(lower)) {
        return false;
      }
      // Avoid matching inside email/domain segments if adjacent to @ or .
      const prevChar = start > 0 ? fullText[start - 1] : '';
      const nextChar = end < fullText.length ? fullText[end] : '';
      if (prevChar === '@' || nextChar === '@' || prevChar === '.' || nextChar === '.') {
        return false;
      }
      return true;
    }
  },
  {
    entityType: 'PERSON',
    regex: /([\u0C80-\u0CFF]{2,18})/gu,
    groupIndex: 1,
    score: 0.87,
    method: 'kannada-single-name-ner',
    validate: (val) => KANNADA_FIRST_NAMES.has(val.trim())
  }
];

function computeGroupSpan(match: RegExpExecArray, groupIndex: number): { value: string; start: number; end: number } | null {
  const fullMatch = match[0];
  const captured = match[groupIndex];
  if (!captured) return null;

  const trimmed = captured.trim();
  if (!trimmed) return null;

  const relOffset = fullMatch.indexOf(captured);
  if (relOffset === -1) return null;

  const leadingTrim = captured.length - captured.trimStart().length;
  const start = match.index + relOffset + leadingTrim;
  const end = start + trimmed.length;
  return { value: trimmed, start, end };
}

export function detectEntities(text: string): DetectedEntity[] {
  const detected: DetectedEntity[] = [];
  const allRules = [...RULES, ...PRESIDIO_EXTENDED_RULES];

  for (const rule of allRules) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null) {
      const span = computeGroupSpan(match, rule.groupIndex);
      if (!span) continue;

      if (rule.validate && !rule.validate(span.value, text, span.start, span.end)) {
        // Rewind global regex past only the first word of a failed multi-word span so overlapping subsequent names (e.g. "verify ravi kumar") aren't skipped
        if (rule.regex.global) {
          const nextSpace = span.value.search(/\s/);
          if (nextSpace > 0) {
            rule.regex.lastIndex = span.start + nextSpace;
          }
        }
        continue;
      }

      // Skip overlaps with higher-priority already-detected entities
      const overlaps = detected.some(
        d => (span.start >= d.start && span.start < d.end) ||
             (span.end > d.start && span.end <= d.end) ||
             (span.start <= d.start && span.end >= d.end)
      );
      if (overlaps) continue;

      detected.push({
        entity_type: rule.entityType,
        value: span.value,
        start: span.start,
        end: span.end,
        score: rule.score,
        method: rule.method
      });
    }
  }

  detected.sort((a, b) => a.start - b.start);
  return detected;
}

function normalizeForConsistency(entityType: string, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (entityType === 'AADHAAR' || entityType === 'PHONE' || entityType === 'BANK_ACC' || entityType === 'CARD_NO') {
    return trimmed.replace(/[\s-]/g, '');
  }
  return trimmed.toLowerCase();
}

export interface BatchMaskContext {
  reverseMap: Map<string, string>; // `${entityType}:${normalizedVal}` -> token
  tokenMapping: Record<string, string>; // token -> original raw value
  entityCounters: Record<string, number>;
}

export function createBatchMaskContext(): BatchMaskContext {
  return {
    reverseMap: new Map<string, string>(),
    tokenMapping: {},
    entityCounters: {}
  };
}

export function maskText(
  text: string,
  detected?: DetectedEntity[],
  sharedContext?: BatchMaskContext
): MaskingResult {
  const entities = detected ?? detectEntities(text);
  const ctx = sharedContext ?? createBatchMaskContext();
  const entityCounts: Record<string, number> = {};

  // First assign tokens in forward document order so numbering (<SAFEHOLDER_PERSON_1>, <SAFEHOLDER_PERSON_2>) is natural!
  const assignedTokens: Array<{ entity: DetectedEntity; token: string }> = [];
  for (const ent of entities) {
    const etype = ent.entity_type;
    entityCounts[etype] = (entityCounts[etype] || 0) + 1;

    const normKey = `${etype}:${normalizeForConsistency(etype, ent.value)}`;
    let token = ctx.reverseMap.get(normKey);
    if (!token) {
      ctx.entityCounters[etype] = (ctx.entityCounters[etype] || 0) + 1;
      token = `<SAFEHOLDER_${etype}_${ctx.entityCounters[etype]}>`;
      ctx.reverseMap.set(normKey, token);
      ctx.tokenMapping[token] = ent.value;
    }
    assignedTokens.push({ entity: ent, token });
  }

  // Replace from end to start using UTF-16 string slicing so indices match JS RegExp indices accurately
  const sortedDesc = [...assignedTokens].sort((a, b) => b.entity.start - a.entity.start);
  let sanitizedText = text;
  for (const { entity, token } of sortedDesc) {
    sanitizedText =
      sanitizedText.slice(0, entity.start) +
      token +
      sanitizedText.slice(entity.end);
  }

  // Build document-local mapping (only tokens present in this document)
  const docTokenMapping: Record<string, string> = {};
  for (const { token } of assignedTokens) {
    docTokenMapping[token] = ctx.tokenMapping[token];
  }

  return {
    sanitizedText,
    tokenMapping: docTokenMapping,
    entityCounts,
    detectedEntities: entities
  };
}

/**
 * Residual Sanitization Sweep (Mask Instead of Block)
 * Ensures any remaining unmasked occurrences of already-detected values or
 * unstructured high-risk patterns (PAN, GSTIN, Aadhaar, Email, US SSN) are
 * replaced with SafeHolder tokens outside existing <SAFEHOLDER_...> tags.
 */
export function redactResidualPII(
  sanitizedText: string,
  docTokenMapping: Record<string, string>,
  entityCounts: Record<string, number>,
  sharedContext?: BatchMaskContext
): { sanitizedText: string; tokenMapping: Record<string, string>; entityCounts: Record<string, number> } {
  const ctx = sharedContext ?? createBatchMaskContext();
  // Seed ctx with existing docTokenMapping if a fresh context was created
  for (const [tok, val] of Object.entries(docTokenMapping)) {
    if (!ctx.tokenMapping[tok]) {
      ctx.tokenMapping[tok] = val;
      const m = tok.match(/^<SAFEHOLDER_([A-Z0-9_]+)_(\d+)>$/);
      if (m) {
        const etype = m[1];
        const idx = parseInt(m[2], 10);
        ctx.entityCounters[etype] = Math.max(ctx.entityCounters[etype] || 0, idx);
        ctx.reverseMap.set(`${etype}:${normalizeForConsistency(etype, val)}`, tok);
      }
    }
  }

  const replaceOutsideTags = (input: string, regex: RegExp, replacer: (m: string) => string): string => {
    const segs = input.split(/(<SAFEHOLDER_[A-Z0-9_]+_\d+>)/g);
    for (let i = 0; i < segs.length; i += 2) {
      segs[i] = segs[i].replace(regex, replacer);
    }
    return segs.join('');
  };

  const getOrAssignToken = (etype: string, rawVal: string): string => {
    const normKey = `${etype}:${normalizeForConsistency(etype, rawVal)}`;
    let token = ctx.reverseMap.get(normKey);
    if (!token) {
      ctx.entityCounters[etype] = (ctx.entityCounters[etype] || 0) + 1;
      token = `<SAFEHOLDER_${etype}_${ctx.entityCounters[etype]}>`;
      ctx.reverseMap.set(normKey, token);
      ctx.tokenMapping[token] = rawVal;
    }
    docTokenMapping[token] = ctx.tokenMapping[token];
    entityCounts[etype] = (entityCounts[etype] || 0) + 1;
    return token;
  };

  // Pass A: High-risk regex patterns that Leak Check independently enforces
  const residualRules: Array<{ entityType: string; regex: RegExp }> = [
    { entityType: 'GSTIN', regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g },
    { entityType: 'PAN', regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g },
    { entityType: 'IFSC', regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
    { entityType: 'IFSC', regex: /\b[A-Z]{4}[0-9]{5,7}[A-Z0-9]{0,2}\b/g },
    { entityType: 'AADHAAR', regex: /\b[2-9][0-9]{3}[-\s][0-9]{4}[-\s][0-9]{4}\b/g },
    { entityType: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10}\b/g },
    { entityType: 'US_SSN', regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g }
  ];

  let out = sanitizedText;
  for (const rule of residualRules) {
    out = replaceOutsideTags(out, rule.regex, (matched) => getOrAssignToken(rule.entityType, matched));
  }

  // Pass B: Re-mask any residual occurrences of already-captured sensitive values
  const existingEntries = Object.entries(docTokenMapping)
    .filter(([tok, val]) => !tok.startsWith('<SAFEHOLDER_PINCODE_') && val.trim().length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [tok, rawVal] of existingEntries) {
    const clean = rawVal.trim();
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (clean.length >= 5) {
      out = replaceOutsideTags(out, new RegExp(escaped, 'gi'), () => tok);
    } else {
      out = replaceOutsideTags(out, new RegExp(escaped, 'g'), () => tok);
    }

    // Digit-normalized match for formatted/unformatted 10+ digit IDs
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length >= 10) {
      const flexibleDigits = digitsOnly.split('').join('[\\s-]*');
      out = replaceOutsideTags(out, new RegExp(`(?<!\\d)${flexibleDigits}(?!\\d)`, 'g'), () => tok);
    }
  }

  return {
    sanitizedText: out,
    tokenMapping: docTokenMapping,
    entityCounts
  };
}

export function maskAndSanitize(
  text: string,
  sharedContext?: BatchMaskContext
): MaskingResult {
  const ctx = sharedContext ?? createBatchMaskContext();
  const detected = detectEntities(text);
  const initial = maskText(text, detected, ctx);
  const residual = redactResidualPII(
    initial.sanitizedText,
    { ...initial.tokenMapping },
    { ...initial.entityCounts },
    ctx
  );
  return {
    sanitizedText: residual.sanitizedText,
    tokenMapping: residual.tokenMapping,
    entityCounts: residual.entityCounts,
    detectedEntities: detected
  };
}

/**
 * Safe Local Reinsertion
 * - Restores valid, verified placeholders back to original values.
 * - Handles case variations and accidental spaces inside angle brackets (< person_1 >).
 * - Safely ignores missing/dropped placeholders or unknown/hallucinated tags.
 */
export function restoreText(aiResponse: string, tokenMapping: Record<string, string>): string {
  if (!aiResponse) return '';
  let restored = aiResponse;

  // Sort tokens by length descending to prevent partial matches (though _1 vs _10 is delimited by >)
  const entries = Object.entries(tokenMapping).sort((a, b) => b[0].length - a[0].length);

  for (const [token, rawVal] of entries) {
    const inner = token.replace(/^<|>$/g, '');
    const escapedInner = inner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match exact <TOKEN> or variants with optional spaces/case differences like < person_1 >
    const flexiblePattern = new RegExp(`<\\s*${escapedInner}\\s*>`, 'gi');
    restored = restored.replace(flexiblePattern, () => rawVal);
  }

  return restored;
}

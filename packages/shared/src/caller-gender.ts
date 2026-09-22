/**
 * Caller (prospect) gender — not the agent's voice gender.
 * Verbs in the caller's own first-person Hinglish beat names.
 * Unisex / unknown names stay unknown; never ask "are you male or female".
 */

export type CallerGender = 'male' | 'female' | 'unknown';

const HOON = String.raw`(?:hoon|hun|hu|hūn)`;

/** Names used by both girls and boys, or too easy to STT-mangle. Do not guess. */
const UNISEX_FIRST_NAMES = new Set(
  [
    'shubham',
    'shubhan',
    'shuman',
    'suman',
    'sooman',
    'kiran',
    'kamal',
    'jyoti',
    'jooti',
    'nikki',
    'honey',
    'lucky',
    'bobby',
    'robin',
    'jordan',
    'alex',
    'sam',
    'sandy',
    'rishi',
    'dev',
    'ashu',
    'chintu',
    'chinty',
  ].map((n) => n.toLowerCase()),
);

const MALE_FIRST_NAMES = new Set(
  [
    'rahul',
    'amit',
    'rohit',
    'vikram',
    'raj',
    'ravi',
    'suresh',
    'ramesh',
    'anil',
    'sunil',
    'vijay',
    'ajay',
    'sanjay',
    'manish',
    'vikas',
    'akash',
    'aakash',
    'arjun',
    'aditya',
    'karan',
    'gaurav',
    'mohit',
    'deepak',
    'dinesh',
    'harish',
    'naresh',
    'mahesh',
    'yogesh',
    'sandeep',
    'pradeep',
    'varun',
    'abhishek',
    'sachin',
    'ankit',
    'ankur',
    'vivek',
    'nikhil',
    'harsh',
    'kunal',
    'pankaj',
    'nilesh',
    'imran',
    'ahmed',
    'ahmad',
    'arun',
    'nitin',
    'pranav',
    'sahil',
    'yash',
    'aman',
    'gopal',
    'krishna',
  ].map((n) => n.toLowerCase()),
);

const FEMALE_FIRST_NAMES = new Set(
  [
    'priya',
    'neha',
    'anjali',
    'pooja',
    'puja',
    'anita',
    'sunita',
    'rekha',
    'meena',
    'kavita',
    'deepa',
    'nisha',
    'rani',
    'lata',
    'sita',
    'geeta',
    'gita',
    'aisha',
    'aarti',
    'arti',
    'shruti',
    'shreya',
    'ananya',
    'ishita',
    'riya',
    'diya',
    'aditi',
    'swati',
    'payal',
    'sapna',
    'sonam',
    'kajal',
    'komal',
    'preeti',
    'priti',
    'seema',
    'reena',
    'rina',
    'divya',
    'shweta',
    'sweta',
    'meera',
    'mira',
    'fatima',
    'zara',
    'sara',
    'sarah',
    'maya',
    'naina',
    'isha',
    'sneha',
    'tanvi',
    'vaishali',
    'pallavi',
  ].map((n) => n.toLowerCase()),
);

const FEMALE_FIRST_PERSON = new RegExp(
  String.raw`(?:` +
    String.raw`\b(?:karti|karati|chahti|chahati)\s+${HOON}\b` +
    String.raw`|\b(?:karungi|bataungi|chahungi|jaungi|aaungi|dungi|sakungi)\b` +
    String.raw`|\b(?:bol|bata|kar|samajh|dekh|sun)\s+r(?:ehi|ahi)\s+${HOON}\b` +
    String.raw`|\bkar sakti\s+${HOON}\b` +
    String.raw`|\b(?:main|mein)\s+samajh\s+gayi\b` +
    String.raw`|करती\s*(हूँ|हूं|हुँ)` +
    String.raw`|चाहती\s*(हूँ|हूं|हुँ)` +
    String.raw`)`,
  'i',
);

const MALE_FIRST_PERSON = new RegExp(
  String.raw`(?:` +
    String.raw`\b(?:karta|karata|chahta|chahata|chata|chate)\s+${HOON}\b` +
    String.raw`|\b(?:karunga|bataunga|chahunga|jaunga|aaunga|dunga|sakunga)\b` +
    String.raw`|\b(?:bol|bata|kar|samajh|dekh|sun)\s+raha\s+${HOON}\b` +
    String.raw`|\bkar sakta\s+${HOON}\b` +
    String.raw`|\b(?:main|mein)\s+samajh\s+gaya\b` +
    String.raw`|करता\s*(हूँ|हूं|हुँ)` +
    String.raw`|चाहता\s*(हूँ|हूं|हुँ)` +
    String.raw`)`,
  'i',
);

export function normalizePersonFirstName(raw?: string | null): string {
  const first =
    (raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z\u0900-\u097f\s'-]/gi, ' ')
      .replace(/\b(ji|sir|madam|maam|mam|mr|mrs|ms|miss)\b/gi, ' ')
      .trim()
      .split(/\s+/)
      .find(Boolean) ?? '';
  return first;
}

export function genderFromFirstPersonVerbs(text?: string | null): CallerGender {
  const t = (text ?? '').trim();
  if (!t) return 'unknown';
  const female = FEMALE_FIRST_PERSON.test(t);
  const male = MALE_FIRST_PERSON.test(t);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return 'unknown';
}

/** Name-only guess. Unisex and unknown spellings stay unknown. */
export function genderFromGivenName(name?: string | null): CallerGender {
  const first = normalizePersonFirstName(name);
  if (!first) return 'unknown';
  if (UNISEX_FIRST_NAMES.has(first)) return 'unknown';
  if (FEMALE_FIRST_NAMES.has(first)) return 'female';
  if (MALE_FIRST_NAMES.has(first)) return 'male';
  return 'unknown';
}

/**
 * Combine this-turn speech, a known name, and last inferred gender.
 * Speech always wins. Unisex names never promote unknown → male/female.
 */
export function inferCallerGender(input: {
  spokenText?: string | null;
  name?: string | null;
  previous?: CallerGender | null;
}): CallerGender {
  const fromSpeech = genderFromFirstPersonVerbs(input.spokenText);
  if (fromSpeech !== 'unknown') return fromSpeech;
  if (input.previous === 'male' || input.previous === 'female') return input.previous;
  return genderFromGivenName(input.name);
}

export function buildCallerGenderSystemNote(
  gender: CallerGender,
  name?: string | null,
): string {
  const who = name?.trim() ? `"${name.trim()}"` : 'the caller';
  if (gender === 'female') {
    return (
      `[SYSTEM: ${who} is speaking as female (first-person Hinglish, or a clearly female name). ` +
      `Address as ${who.replace(/^"|"$/g, '')} ji / aap. Do not say sir. Do not announce gender. ` +
      `Never ask if they are male or female.]`
    );
  }
  if (gender === 'male') {
    return (
      `[SYSTEM: ${who} is speaking as male (first-person Hinglish, or a clearly male name). ` +
      `Address as ${who.replace(/^"|"$/g, '')} ji / aap. Do not say madam. Do not announce gender. ` +
      `Never ask if they are male or female.]`
    );
  }
  return (
    `[SYSTEM: Caller gender is unknown` +
    (name?.trim() ? ` (name ${name.trim()} can be used by girls or boys, or is unclear)` : '') +
    `. Address as ` +
    (name?.trim() ? `${name.trim()} ji / aap` : 'aap') +
    `. Do NOT assume sir/madam. Never ask if they are male or female. ` +
    `If they use first-person Hinglish (karti/karta hoon, jaungi/jaunga), follow that.]`
  );
}

export function buildCallerGenderPromptLine(name?: string | null): string {
  const gender = genderFromGivenName(name);
  const label = name?.trim() || 'the caller';
  if (gender === 'unknown') {
    return (
      `- Gender of ${label}: unknown. Address as ${label} ji / aap. ` +
      `Do not guess sir/madam from this name. Never ask their gender. ` +
      `If they say karti hoon / jaungi treat as female; karta hoon / jaunga as male.`
    );
  }
  if (gender === 'female') {
    return (
      `- Name ${label} is typically female — you may address naturally, still prefer ${label} ji / aap. ` +
      `If they use masculine first-person verbs, switch. Never ask their gender.`
    );
  }
  return (
    `- Name ${label} is typically male — you may address naturally, still prefer ${label} ji / aap. ` +
    `If they use feminine first-person verbs, switch. Never ask their gender.`
  );
}

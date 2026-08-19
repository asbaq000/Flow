/**
 * Deterministic Arabic-script Urdu → Roman Urdu transliteration.
 *
 * There is no free service that turns spoken Urdu directly into Roman script,
 * so the pipeline is: transcribe with a multilingual speech model (which
 * outputs Urdu in its native script, same as it would for any language), then
 * convert that script to Latin letters here.
 *
 * Be honest about what this is: a character-level mapping, not a trained
 * transliteration model. Urdu script omits short vowels — "کیا" is written
 * with the letters ک-ی-ا (roughly k-i-a) but a fluent reader supplies the
 * missing sound to get "kya". This function cannot recover that; it renders
 * the letters it can see. Output is readable, not always the spelling a
 * person would choose by hand.
 */

// Two- and three-letter combinations must be matched before single letters,
// since ھ ("do-chashmi he") marks aspiration on the letter before it rather
// than standing for a sound of its own — بھ is "bh", not "b" + "h".
const DIGRAPHS: [string, string][] = [
  ['بھ', 'bh'], ['پھ', 'ph'], ['تھ', 'th'], ['ٹھ', 'th'], ['دھ', 'dh'],
  ['ڈھ', 'dh'], ['کھ', 'kh'], ['گھ', 'gh'], ['چھ', 'chh'], ['جھ', 'jh'],
  ['رھ', 'rh'], ['لھ', 'lh'], ['نھ', 'nh'], ['مھ', 'mh'],
];

const LETTERS: Record<string, string> = {
  // Long vowels / vowel carriers
  'آ': 'aa', 'ا': 'a', 'و': 'o', 'ی': 'i', 'ے': 'e', 'ئ': 'i', 'ء': '',
  // Consonants
  'ب': 'b', 'پ': 'p', 'ت': 't', 'ٹ': 't', 'ث': 's', 'ج': 'j', 'چ': 'ch',
  'ح': 'h', 'خ': 'kh', 'د': 'd', 'ڈ': 'd', 'ذ': 'z', 'ر': 'r', 'ڑ': 'r',
  'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'z', 'ط': 't',
  'ظ': 'z', 'ع': '', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ک': 'k', 'گ': 'g',
  'ل': 'l', 'م': 'm', 'ن': 'n', 'ں': 'n', 'ہ': 'h', 'ھ': 'h', 'ۃ': 'h',
  // Digits
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  // Punctuation
  '،': ',', '؟': '?', '؛': ';',
};

/** True if the text contains Arabic-script letters (covers Urdu, and Arabic itself). */
export function hasArabicScript(text: string): boolean {
  return /[؀-ۿݐ-ݿ]/.test(text);
}

/**
 * Converts Arabic-script Urdu to Roman letters. Characters outside the Urdu
 * block — Latin text, digits, punctuation, whitespace — pass through
 * untouched, so a sentence that mixes an English word into spoken Urdu keeps
 * that word as-is rather than mangling it.
 */
export function urduToRoman(text: string): string {
  let out = text;
  for (const [from, to] of DIGRAPHS) out = out.split(from).join(to);

  let result = '';
  for (const ch of out) {
    result += ch in LETTERS ? LETTERS[ch] : ch;
  }

  // Collapse whitespace left behind by dropped letters (ء and ع often map to '').
  return result.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Given raw model output and its detected language, returns what should be
 * stored as the transcript: Roman Urdu when the source is Urdu script,
 * unchanged otherwise (English, or anything already in Latin script).
 */
export function toStoredTranscript(rawText: string, detectedLang: string | null): string {
  if (detectedLang === 'ur' || hasArabicScript(rawText)) {
    return urduToRoman(rawText);
  }
  return rawText.trim();
}

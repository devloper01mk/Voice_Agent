/**
 * Hangup is only these words. A payment question, a date, or "ok" is not a goodbye.
 * The model must not infer that the caller is finished.
 */
export function callerAskedToEndCall(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/\b(thank you|thanks|thankyou|dhanyavaad|dhanyavad|धन्यवाद)\b/.test(t)) return true;
  if (/\b(goodbye|good bye|bye|बाय)\b/.test(t)) return true;
  if (/\b(wrong number|galat number|गलत नंबर)\b/.test(t)) return true;
  if (/do not call|don't call|dobara\s+(mat|nahi)\s+call|call mat karna/.test(t)) return true;
  if (/^(bas|bus|बस)[\s!.।]*$/.test(t)) return true;
  if (/\b(bas|bus)\s+(ho gaya|ho gayi|karo|itna hi|chhodo|rehne do)\b/.test(t)) return true;
  return false;
}

import { normalizeGlobalCategory, type GlobalLearningCategory } from './brain-mutation.js';

export function parseLearningCategoryFromBullet(bullet: string): GlobalLearningCategory | null {
  const match = bullet.match(/^\s*-\s*\[([\w_]+)\]/i);
  if (!match?.[1]) return null;
  return normalizeGlobalCategory(match[1]);
}

/** Infer which learning categories are relevant to the caller/prospect context. */
export function inferLearningCategoriesFromText(text: string): GlobalLearningCategory[] {
  const t = text.toLowerCase();
  const cats = new Set<GlobalLearningCategory>();

  if (/\b(zoho|hubspot|salesforce|competitor|compare|vs\b|versus)\b/.test(t)) {
    cats.add('competitor');
  }
  if (/\b(mehnga|mehnga|price|pricing|budget|cost|expensive|afford)\b/.test(t)) {
    cats.add('objection');
    cats.add('pricing');
  }
  if (/\b(excel|spreadsheet|manual|paper)\b/.test(t)) {
    cats.add('objection');
    cats.add('situation');
  }
  if (/\b(grocery|kirana|retail|shop|store|outlet|mobile shop|laptop)\b/.test(t)) {
    cats.add('vertical');
    cats.add('qualification');
    cats.add('faq');
  }
  if (/\b(whatsapp|sms|message|offer|follow[- ]?up|reminder)\b/.test(t)) {
    cats.add('situation');
    cats.add('faq');
    cats.add('closing');
  }
  if (/\b(referral|review|repeat customer|loyalty)\b/.test(t)) {
    cats.add('situation');
    cats.add('discovery');
  }
  if (/\b(busy|later|callback|call back|baad mein)\b/.test(t)) {
    cats.add('closing');
    cats.add('reengage');
  }
  if (/\b(not interested|no need|walk[- ]?in only|fit nahi)\b/.test(t)) {
    cats.add('exit');
    cats.add('qualification');
  }
  if (/\b(frustrated|frustrate|angry|annoyed|irritated|upset|gussa|naraz)\b/.test(t)) {
    cats.add('situation');
    cats.add('approach');
    cats.add('objection');
  }
  if (/\b(confused|samajh nahi|didn'?t understand|clear nahi|simple language|normal language|seedha|knowledge nahi)\b|नॉलेज|नॉर्मल\s*लैंग्वेज|समझ\s*नहीं/i.test(t)) {
    cats.add('faq');
    cats.add('discovery');
    cats.add('approach');
  }
  if (/\b(hurry|jaldi|short me|one minute|time nahi)\b/.test(t)) {
    cats.add('situation');
    cats.add('reengage');
    cats.add('closing');
  }
  if (/\b(kya|what|how|feature|integration|gst|invoice)\b/.test(t)) {
    cats.add('faq');
    cats.add('discovery');
  }

  if (cats.size === 0) {
    return ['situation', 'faq', 'objection', 'qualification', 'vertical'];
  }
  return [...cats];
}

export function inferSituationalSignalsFromText(text: string): string[] {
  const t = text.toLowerCase();
  const signals = new Set<string>();

  if (/\b(frustrated|frustrate|angry|annoyed|irritated|upset|gussa|naraz)\b/.test(t)) {
    signals.add('frustrated_customer');
  }
  if (/\b(busy|meeting|driving|later|callback|call back|baad mein|time nahi)\b/.test(t)) {
    signals.add('busy_or_in_hurry');
  }
  if (/\b(mehnga|price|pricing|budget|cost|expensive|afford)\b/.test(t)) {
    signals.add('price_sensitive');
  }
  if (/\b(confused|samajh nahi|didn'?t understand|clear nahi|simple language|normal language|seedha|knowledge nahi)\b|नॉलेज|नॉर्मल\s*लैंग्वेज|समझ\s*नहीं/i.test(t)) {
    signals.add('confused_needs_clarity');
  }
  if (/\b(not interested|no need|walk[- ]?in only|fit nahi)\b/.test(t)) {
    signals.add('low_fit_or_low_intent');
  }
  return [...signals];
}

export function buildGlobalLearningRetrievalQuery(opts: {
  productName: string;
  prospectName?: string | null;
  prospectFacts?: string | null;
  productSummary?: string | null;
  callerStyle?: string | null;
  situationalSignals?: string[];
}): string {
  const inferredSignals = inferSituationalSignalsFromText(
    [opts.prospectFacts, opts.productSummary, opts.callerStyle].filter(Boolean).join('\n'),
  );
  const mergedSignals = [...new Set([...(opts.situationalSignals ?? []), ...inferredSignals])];
  const parts = [
    opts.productName,
    opts.prospectName?.trim(),
    opts.prospectFacts?.trim(),
    opts.callerStyle ? `Caller style: ${opts.callerStyle.trim()}` : undefined,
    mergedSignals.length > 0 ? `Situation signals: ${mergedSignals.join(', ')}` : undefined,
    opts.productSummary?.trim()?.slice(0, 500),
  ].filter(Boolean);
  return parts.join('\n');
}

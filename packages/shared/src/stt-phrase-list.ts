/** Email dictation tokens — added early so the 100-phrase cap does not drop them. */
const EMAIL_STT_PHRASES = [
  'at the rate',
  'dot com',
  'dot co in',
  'dot ac in',
  'gmail',
  'gmail.com',
  'yahoo',
  'yahoo.com',
  'hotmail',
  'hotmail.com',
  'outlook',
  'outlook.com',
  'icloud',
  'icloud.com',
  'rediffmail',
  'googlemail',
  'letter by letter',
  'double',
  'triple',
  'period',
  'underscore',
  'dash',
  'hyphen',
  'plus',
  'ay',
  'bee',
  'see',
  'dee',
  'ee',
  'eff',
  'gee',
  'aitch',
  'haitch',
  'eye',
  'jay',
  'kay',
  'ell',
  'em',
  'en',
  'oh',
  'pee',
  'cue',
  'are',
  'ess',
  'tee',
  'you',
  'vee',
  'double you',
  'double v',
  'ex',
  'why',
  'zee',
  'zed',
  'mail id',
  'email',
  'डॉट',
  'एट',
  'अंडरस्कोर',
  'जीमेल',
  'याहू',
  'bas',
  'ho gaya',
  'A for apple',
  'B for ball',
];

const COMMON_STT_PHRASES = [
  'features',
  'compare',
  'demo',
  'pricing',
  'Zoho',
  'HubSpot',
  'CRM',
];

/** Car-sales terms — only when the agent product is automotive. */
const CAR_STT_PHRASES = [
  'SUV',
  'एसयूवी',
  'सेडान',
  'sedan',
  'SUV देख रहा हूँ',
  'sedan देख रहा हूँ',
  'मैं सेडान देख रहा हूँ',
  'test drive',
  'on-road price',
  'ex-showroom',
  'mileage',
  'horsepower',
  'bhp',
  'torque',
  'Newton metre',
  'Nm',
  'kerb weight',
  'weight',
  'sunroof',
  'automatic',
  'manual',
  'automatic gearbox',
  'automatic transmission',
  'manual gearbox',
  'मैं सेडान',
];

/** VW / competitor names — only when the agent product is Volkswagen. */
const VW_STT_PHRASES = [
  'Volkswagen',
  'Virtus',
  'Velocity',
  'Velosta',
  'Vertice',
  'Virtas',
  'Wirtus',
  'Taigun',
  'Tayron',
  'Polo',
  'Tiguan',
  'Golf GTI',
  'T-Roc',
  'Hyundai',
  'Verna',
  'Elantra',
  'Creta',
  'Veloster',
  'City',
  'Slavia',
  'Kushaq',
  'Seltos',
  'Maruti',
  'Honda',
  'Skoda',
];

export function isVolkswagenProduct(productName: string): boolean {
  const product = productName.toLowerCase();
  return product.includes('volkswagen') || /\bvw\b/.test(product);
}

export function isAutomotiveProduct(productName: string): boolean {
  if (isVolkswagenProduct(productName)) return true;
  return /\b(car|cars|auto|automotive|motors?|vehicle|vehicles)\b/i.test(productName);
}

export function assembleSttPhraseList(
  productName: string,
  extraPhrases: string[] = [],
): string[] {
  const phrases = new Set<string>();

  const product = productName.trim();
  if (product) {
    phrases.add(product);
    const productSlug = product.toLowerCase().replace(/\s+/g, '');
    if (productSlug) phrases.add(productSlug);
  }

  if (isAutomotiveProduct(product)) {
    for (const phrase of CAR_STT_PHRASES) {
      phrases.add(phrase);
    }
  }

  if (isVolkswagenProduct(product)) {
    for (const phrase of VW_STT_PHRASES) {
      phrases.add(phrase);
    }
  }

  for (const phrase of EMAIL_STT_PHRASES) {
    phrases.add(phrase);
  }

  for (const phrase of extraPhrases) {
    const trimmed = phrase.trim();
    if (trimmed.length >= 2) phrases.add(trimmed);
  }

  for (const phrase of COMMON_STT_PHRASES) {
    phrases.add(phrase);
  }

  return [...phrases].filter((p) => p.length >= 2).slice(0, 100);
}


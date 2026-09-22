/** G.711 μ-law (PCMU) helpers for Acefone 8 kHz telephony audio. */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

export function decodeMulawByte(byte: number): number {
  byte = ~byte & 0xff;
  const sign = byte & 0x80;
  const exponent = (byte >> 4) & 0x07;
  const mantissa = byte & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign !== 0 ? -sample : sample;
}

export function encodeMulawSample(sample: number): number {
  let pcm = sample;
  const sign = pcm < 0 ? 0x80 : 0;
  if (pcm < 0) pcm = -pcm;
  if (pcm > MULAW_CLIP) pcm = MULAW_CLIP;
  pcm += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; exponent--) {
    expMask >>= 1;
  }

  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

export function mulawToPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    out.writeInt16LE(decodeMulawByte(mulaw[i]!), i * 2);
  }
  return out;
}

export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const sampleCount = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = encodeMulawSample(pcm.readInt16LE(i * 2));
  }
  return out;
}

/** Upsample 8 kHz mono PCM16 → 24 kHz with linear interpolation. */
export function upsample8kTo24k(pcm8k: Buffer): Buffer {
  const samples = pcm8k.length / 2;
  if (samples === 0) return Buffer.alloc(0);
  const out = Buffer.alloc(samples * 6);
  for (let i = 0; i < samples; i++) {
    const s = pcm8k.readInt16LE(i * 2);
    const next = i + 1 < samples ? pcm8k.readInt16LE((i + 1) * 2) : s;
    const mid1 = Math.round(s + (next - s) / 3);
    const mid2 = Math.round(s + ((next - s) * 2) / 3);
    out.writeInt16LE(s, i * 6);
    out.writeInt16LE(mid1, i * 6 + 2);
    out.writeInt16LE(mid2, i * 6 + 4);
  }
  return out;
}

/** Upsample 8 kHz mono PCM16 → 16 kHz with linear interpolation. */
export function upsample8kTo16k(pcm8k: Buffer): Buffer {
  const samples = pcm8k.length / 2;
  if (samples === 0) return Buffer.alloc(0);
  const out = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    const s = pcm8k.readInt16LE(i * 2);
    const next = i + 1 < samples ? pcm8k.readInt16LE((i + 1) * 2) : s;
    const mid = (s + next) >> 1;
    out.writeInt16LE(s, i * 4);
    out.writeInt16LE(mid, i * 4 + 2);
  }
  return out;
}

/** Downsample mono PCM16 to 8 kHz. */
export function downsampleTo8k(pcm: Buffer, inputRate: number): Buffer {
  if (inputRate === 8000) return pcm;
  const ratio = inputRate / 8000;
  const inSamples = pcm.length / 2;
  const outSamples = Math.floor(inSamples / ratio);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const src = Math.min(inSamples - 1, Math.floor(i * ratio));
    out.writeInt16LE(pcm.readInt16LE(src * 2), i * 2);
  }
  return out;
}

/** Pad mulaw buffer to a multiple of chunkBytes (Acefone: 160). */
export function padMulawToChunks(mulaw: Buffer, chunkBytes = 160): Buffer {
  if (mulaw.length === 0) return Buffer.alloc(chunkBytes, 0xff);
  const rem = mulaw.length % chunkBytes;
  if (rem === 0) return mulaw;
  const pad = Buffer.alloc(chunkBytes - rem, 0xff);
  return Buffer.concat([mulaw, pad]);
}

export function chunkMulaw(mulaw: Buffer, chunkBytes = 160): Buffer[] {
  const padded = padMulawToChunks(mulaw, chunkBytes);
  const chunks: Buffer[] = [];
  for (let i = 0; i < padded.length; i += chunkBytes) {
    chunks.push(padded.subarray(i, i + chunkBytes));
  }
  return chunks;
}

import {
  BackgroundVoiceCancellation,
  NoiseCancellation,
} from '@livekit/noise-cancellation-node';
import type { NoiseCancellationOptions } from '@livekit/rtc-node';

export function resolveNoiseCancellation(): NoiseCancellationOptions | undefined {
  const mode = (process.env.NOISE_CANCELLATION ?? 'bvc').toLowerCase();
  if (mode === 'off') return undefined;
  if (mode === 'nc') return NoiseCancellation();
  return BackgroundVoiceCancellation();
}

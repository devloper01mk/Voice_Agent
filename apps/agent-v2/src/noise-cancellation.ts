import {
  BackgroundVoiceCancellation,
  NoiseCancellation,
  TelephonyBackgroundVoiceCancellation,
} from '@livekit/noise-cancellation-node';
import type { NoiseCancellationOptions } from '@livekit/rtc-node';

/**
 * LiveKit recommends Telephony BVC for SIP/PSTN; browser BVC for Simulator WebRTC.
 * Do not also enable Krisp on the SIP trunk when agent-side NC is on.
 */
export function resolveNoiseCancellation(opts?: {
  telephony?: boolean;
}): NoiseCancellationOptions | undefined {
  const mode = (process.env.NOISE_CANCELLATION ?? '').toLowerCase().trim();
  if (mode === 'off') return undefined;
  if (mode === 'nc') return NoiseCancellation();
  if (mode === 'bvc-web') return BackgroundVoiceCancellation();
  if (mode === 'bvc-telephony') return TelephonyBackgroundVoiceCancellation();
  // Default: telephony-tuned on SIP; browser BVC for Simulator.
  return opts?.telephony
    ? TelephonyBackgroundVoiceCancellation()
    : BackgroundVoiceCancellation();
}

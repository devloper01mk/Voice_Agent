import type { RealtimeS2sSessionConfig } from '@vsa/shared';

function formatTurnDetection(td: RealtimeS2sSessionConfig['turnDetection']): string {
  if (td.type === 'server_vad') {
    return `${td.label} (threshold ${td.threshold}, prefix ${td.prefixPaddingMs} ms, silence ${td.silenceDurationMs} ms)`;
  }
  return `${td.label} (eagerness ${td.eagerness ?? 'medium'})`;
}

export default function RealtimeS2sMetricsPanel({
  config,
  callId,
  direction,
  agentName,
  startedAt,
}: {
  config: RealtimeS2sSessionConfig;
  callId?: string;
  direction?: 'inbound' | 'outbound';
  agentName?: string;
  startedAt?: number;
}) {
  const rows: Array<{ label: string; value: string }> = [
    {
      label: 'Pipeline',
      value: config.pipeline === 'gemini_live' ? 'Gemini Live S2S' : 'OpenAI Realtime S2S',
    },
    { label: 'Preset', value: config.source === 'simulator_force_s2s' ? 'Force S2S (budget)' : 'Studio default' },
    { label: 'Model', value: config.model },
    ...(config.languageCode
      ? [{ label: 'Speech language', value: config.languageCode }]
      : [{ label: 'User transcript model', value: config.transcriptionModel }]),
    { label: 'Max tokens', value: config.maxResponseOutputTokens === 'unlimited' ? 'Unlimited' : String(config.maxResponseOutputTokens) },
    { label: 'Voice', value: config.voice },
    {
      label: 'Noise reduction',
      value: config.noiseReduction === 'far_field'
        ? 'Far field'
        : config.noiseReduction === 'near_field'
          ? 'Near field'
          : 'Off',
    },
    { label: 'Turn detection', value: formatTurnDetection(config.turnDetection) },
    { label: 'Idle timeout', value: config.idleTimeout ? 'On' : 'Off' },
    { label: 'Modalities', value: config.modalities.join(' + ') },
  ];

  if (config.estimatedCostInrPerMin) {
    rows.push({ label: 'Est. API cost', value: `${config.estimatedCostInrPerMin}/min` });
  }
  if (agentName) rows.push({ label: 'Agent', value: agentName });
  if (callId) rows.push({ label: 'Call ID', value: callId });
  if (direction) {
    rows.push({ label: 'Direction', value: direction === 'outbound' ? 'Outgoing' : 'Incoming' });
  }
  if (startedAt) {
    rows.push({
      label: 'Started',
      value: new Date(startedAt).toLocaleTimeString(),
    });
  }

  return (
    <div className="latency-readout realtime-s2s-config" aria-label="Realtime S2S configuration">
      {rows.map(({ label, value }) => (
        <div key={label} className="latency-row">
          <span className="latency-label">{label}</span>
          <span className="latency-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

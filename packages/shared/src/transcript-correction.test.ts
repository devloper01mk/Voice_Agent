import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { applySuvSttAliases, correctTranscriptForLlm, shouldConfirmUnclearStt, sttClarifyLine } from './transcript-correction.ts';

describe('applySuvSttAliases', () => {
  it('maps TV dekh to SUV in car context', () => {
    assert.match(
      applySuvSttAliases('टीवी देख रहा हूँ', ['sedan dekh rahe hain ya SUV?']),
      /SUV/,
    );
    assert.match(applySuvSttAliases('TV dekh raha hoon', ['SUV']), /SUV/i);
  });

  it('maps यू पी dekh to SUV in car context', () => {
    assert.match(
      applySuvSttAliases('यू पी देख रहा हूँ उसके बारे में आप कुछ बताइए?', [
        'sedan ya SUV?',
      ]),
      /SUV/,
    );
    assert.match(applySuvSttAliases('UP dekh raha hoon batao', ['Volkswagen']), /SUV/i);
  });

  it('does not rewrite clear UP geography without vehicle cues', () => {
    const out = applySuvSttAliases('main Uttar Pradesh se hoon', []);
    assert.equal(/SUV/i.test(out), false);
  });

  it('maps shutdown / Shahdol to sedan when looking, on car products', () => {
    const heard =
      'and maybe माम् माम् मैं अभी शटडाउन माम् मैं अभी शहडोल माम् मैं अभी शटडाउन देख रहा हूँ';
    const out = applySuvSttAliases(heard, ['sedan ya SUV?'], 'Volkswagen India');
    assert.match(out, /sedan/i);
    assert.equal(/शटडाउन|शहडोल|shutdown/i.test(out), false);
    assert.equal(/माम्/.test(out), false);
  });

  it('maps shutdown / मेशन / gearbox STT on car products without देख', () => {
    assert.match(
      applySuvSttAliases('जी मैं तो शटडाउन था।', [], 'Volkswagen India'),
      /sedan/i,
    );
    assert.match(
      applySuvSttAliases('हाँ, मेशन चाहिए था।', [], 'Volkswagen India'),
      /sedan/i,
    );
    assert.match(
      applySuvSttAliases('आटोमेटिक पहनने का मतलब है।', [], 'Volkswagen India'),
      /automatic gearbox/i,
    );
    assert.match(
      applySuvSttAliases('इसमें जोमैटो मेन्यु और दोनों।', [], 'Volkswagen India'),
      /automatic manual/i,
    );
  });

  it('does not map TV or shutdown to car terms for CRM products', () => {
    const tv = applySuvSttAliases('TV dekh raha hoon', ['dashboard'], 'Cronberry');
    assert.equal(/SUV/i.test(tv), false);
    const shut = applySuvSttAliases('main shutdown dekh raha hoon', [], 'Cronberry');
    assert.match(shut, /shutdown/i);
    assert.equal(/\bsedan\b/i.test(shut), false);
  });
});

describe('shouldConfirmUnclearStt', () => {
  it('asks to confirm leftover shutdown when aliases did not map it', () => {
    assert.equal(shouldConfirmUnclearStt('main shutdown hoon'), true);
    assert.equal(shouldConfirmUnclearStt('sedan dekh raha hoon'), false);
  });

  it('uses a sedan/SUV clarify when the agent just asked body type', () => {
    assert.match(sttClarifyLine('Aap sedan dekh rahe hain ya SUV?'), /Sedan/);
  });
});

describe('correctTranscriptForLlm timeout', () => {
  const prevKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    mock.restoreAll();
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevKey;
  });

  it('fails open with alias-corrected text when OpenAI fetch aborts', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mock.method(globalThis, 'fetch', () =>
      Promise.reject(new DOMException('The operation was aborted', 'TimeoutError')),
    );

    const result = await correctTranscriptForLlm({
      heard: 'Velocity dekhna hai',
      confidence: 0.5,
      productName: 'Volkswagen India',
    });

    assert.equal(result.corrected, 'Virtus dekhna hai');
    assert.equal(result.wasCorrected, true);
    assert.equal(result.needsConfirmation, false);
  });
});

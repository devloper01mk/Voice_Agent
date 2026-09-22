import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSimulator2Instructions,
  compactSystemPrompt,
  compileSystemPrompt,
  emptySimulator2TurnState,
  inflectSafetyCopy,
  markBookingSaved,
  mergeSkillsConfig,
  prepareSimulator2UserTurn,
  resolveCallLlm,
  resolveSimulator2LlmModel,
  resolveSimulator2TtsEmotion,
  SIMULATOR2_DEFAULT_LLM_MODEL,
  SIMULATOR2_DEFAULT_TTS_EMOTION,
  SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS,
} from './index.js';

const sampleAgent = {
  name: 'Priya',
  greeting: 'Namaste',
  persona: 'warm advisor',
  productName: 'Acme CRM',
  voiceId: 'voice',
  voiceSpeed: 1,
  llmProvider: 'groq' as const,
  llmModel: 'llama',
  brainMarkdown: '## Cronberry\nPlans start at 499.',
  skillsConfig: mergeSkillsConfig(null),
};

describe('Simulator 2 / shared brain', () => {
  it('defaults TTS emotion to happy and LLM to gpt-5.4-mini', () => {
    assert.equal(resolveSimulator2TtsEmotion(''), SIMULATOR2_DEFAULT_TTS_EMOTION);
    assert.equal(resolveSimulator2TtsEmotion('neutral'), 'happy');
    assert.equal(SIMULATOR2_DEFAULT_LLM_MODEL, 'gpt-5.4-mini');
    assert.match(resolveSimulator2LlmModel(), /gpt-5/);
  });

  it('uses the Agent Studio LLM for live calls', () => {
    assert.deepEqual(resolveCallLlm({ llmProvider: 'gpt', llmModel: 'gpt-4o-mini' }), {
      provider: 'gpt',
      model: 'gpt-4o-mini',
    });
    assert.deepEqual(
      resolveCallLlm({ llmProvider: 'groq', llmModel: 'llama-3.3-70b-versatile' }),
      { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    );
    assert.equal(
      resolveCallLlm({ llmProvider: 'gpt', llmModel: '  ' }).model,
      SIMULATOR2_DEFAULT_LLM_MODEL,
    );
  });

  it('compiles principles, not a numbered intent playbook or confidence score', () => {
    const compiled = compileSystemPrompt(sampleAgent);
    assert.match(compiled, /How to understand the caller/);
    assert.match(compiled, /When to answer vs clarify/);
    assert.match(compiled, /materially risk/);
    assert.match(compiled, /Unseen asks are valid/);
    assert.match(compiled, /no numeric confidence score/i);
    assert.match(compiled, /## Sales & support skills/);
    assert.match(compiled, /Product Knowledge \/ Brain/);
    assert.match(compiled, /Answer-first lock/);
    assert.doesNotMatch(compiled, /## Sales and support playbooks/);
    assert.doesNotMatch(compiled, /1\. ANGRY \/ FRUSTRATED/);
    assert.doesNotMatch(compiled, /intentConfirmTemplate|features jaanna chahte hain, price, ya demo/);
    assert.doesNotMatch(compiled, /sedan → Virtus/);
  });

  it('gender-inflects last-resort safety copy for male agents', () => {
    assert.match(inflectSafetyCopy('Main disconnect kar rehi hoon', 'male'), /kar raha hoon/);
    const male = compileSystemPrompt({ ...sampleAgent, agentGender: 'male' });
    assert.match(male, /kar raha hoon/);
    assert.doesNotMatch(male, /disconnect kar rehi hoon/);
  });

  it('injects a Hinglish gender correction note after a masculine leak', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Virtus ki price kya hai?',
      lastAssistantText: 'Main check karta hun availability.',
      recentAssistantTexts: ['Main check karta hun availability.'],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
      agentGender: 'female',
    });
    assert.equal(result.kind, 'reply');
    if (result.kind === 'reply') {
      assert.match(result.userContent, /karti hoon/);
      assert.match(result.userContent, /Never karta\/chahta hun/);
    }
  });

  it('does not assume gender from unisex names like Shubham', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'price kya hai?',
      lastAssistantText: 'Shubham ji, kaunsa room dekhna hai?',
      recentAssistantTexts: ['Shubham ji, kaunsa room dekhna hai?'],
      productName: 'Nexora Stays',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
      contactName: 'Shubham',
    });
    assert.equal(result.kind, 'reply');
    if (result.kind === 'reply') {
      assert.match(result.userContent, /gender is unknown/i);
      assert.match(result.userContent, /Never ask/i);
      assert.doesNotMatch(result.userContent, /speaking as male/);
    }
  });

  it('builds outbound instructions with static brain first and no Skills short menu', () => {
    const compiled = compileSystemPrompt(sampleAgent);
    const { instructions, knownContact } = buildSimulator2Instructions({
      agent: {
        name: 'Priya',
        greeting: 'Namaste',
        productName: 'Acme CRM',
        compiledSystemPrompt: compiled,
        brainSummary: 'Cronberry plans start at 499.',
        generalKnowledgeEnabled: true,
      },
      direction: 'outbound',
      prospectName: 'Rahul',
      contactPhone: '9876543210',
      skills: mergeSkillsConfig(null),
    });

    assert.match(instructions, /Call direction: OUTBOUND/);
    assert.ok(
      instructions.indexOf('## Product Knowledge') < instructions.indexOf('## Call direction'),
      'stable product prefix should precede call-specific direction',
    );
    assert.match(instructions, /WHY you called/);
    assert.match(instructions, /never hang up/i);
    assert.match(instructions, /Opener is optional/);
    assert.doesNotMatch(instructions, /## Skills \(short\)/);
    assert.doesNotMatch(instructions, /Simulator 2.0 natural voice delivery/);
    assert.match(instructions, /Hinglish speaker grammar lock/);
    assert.match(instructions, /karti hoon/);
    assert.ok(
      instructions.trimEnd().endsWith('karunga.') || /Never say karta/.test(instructions.slice(-250)),
    );
    assert.equal(knownContact.name, 'Rahul');
    assert.equal(knownContact.phone, '9876543210');
    assert.doesNotMatch(compactSystemPrompt(compiled, 'Cronberry plans'), /## Skills \(short\)/);
  });

  it('caps oversized product knowledge without replacing principles', () => {
    const longProduct = Array.from({ length: 400 }, (_, i) => `Model ${i}: details.`).join('\n');
    const compiled = `Head\n## Product Knowledge\n${longProduct}\n## How to understand the caller\nUnseen asks are valid.\n## Voice rules\nPlain speech.`;
    const compact = compactSystemPrompt(compiled, longProduct, 1_000);
    assert.doesNotMatch(compact, /Model 150:/);
    assert.match(compact, /Additional catalog details omitted/);
    assert.match(compact, /How to understand the caller/);
    assert.doesNotMatch(compact, /## Skills \(short\)/);
    assert.equal(SIMULATOR2_PRODUCT_KNOWLEDGE_CHARS, 4_000);
    const defaultCap = compactSystemPrompt(compiled, longProduct);
    assert.ok(defaultCap.length < compiled.length);
    assert.match(defaultCap, /Additional catalog details omitted/);
  });

  it('mutes exploring turns instead of answering', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'hmmm aise hai na',
      lastAssistantText: 'Taigun city ke liye strong option hai.',
      recentAssistantTexts: ['Taigun city ke liye strong option hai.'],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'mute');
  });

  it('does not mute when the caller is looking at a category', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'SUV dekh raha tha',
      lastAssistantText: 'Aap sedan dekh rahe hain ya SUV?',
      recentAssistantTexts: ['Aap sedan dekh rahe hain ya SUV?'],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.notEqual(result.kind, 'mute');
  });

  it('maps shutdown STT to sedan on car calls instead of pitching the wrong word', async () => {
    const result = await prepareSimulator2UserTurn({
      heard:
        'and maybe माम् माम् मैं अभी शटडाउन माम् मैं अभी शहडोल माम् मैं अभी शटडाउन देख रहा हूँ',
      lastAssistantText: 'Aap sedan dekh rahe hain ya SUV?',
      recentAssistantTexts: ['Aap sedan dekh rahe hain ya SUV?'],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /sedan/i);
    assert.doesNotMatch(result.userContent, /शटडाउन|शहडोल|shutdown/i);
  });

  it('does not keep muting after exploring once the caller states interest', async () => {
    const hmm = await prepareSimulator2UserTurn({
      heard: 'dekh raha hoon',
      lastAssistantText: 'Aap sedan dekh rahe hain ya SUV?',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(hmm.kind, 'mute');
    const next = await prepareSimulator2UserTurn({
      heard: 'SUV dekh raha tha',
      lastAssistantText: 'Aap sedan dekh rahe hain ya SUV?',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: hmm.state,
    });
    assert.notEqual(next.kind, 'mute');
  });

  it('closes on thank-you after a confirmed booking instead of offering new slots', async () => {
    const state = emptySimulator2TurnState();
    state.bookingSaved = true;
    state.callFacts.facts.preferred_time = 'aaj teen baje';
    const result = await prepareSimulator2UserTurn({
      heard: 'OK, ma\'am. Thank you, ma\'am.',
      lastAssistantText:
        'Achha — showroom visit confirm ho gaya hai for aaj, Monday 17 August, around teen baje.',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state,
    });
    assert.equal(result.kind, 'say');
    if (result.kind !== 'say') return;
    assert.equal(result.then, 'hangup');
    assert.equal(result.hangupReason, 'caller_goodbye');
    assert.match(result.text, /confirm hai/i);
    assert.doesNotMatch(result.text, /full/i);
  });

  it('on not-interested thank-you without a booking, lets the LLM close without a refusal script', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'ठीक है, माम् फिर मुझे नहीं चाहिए माम्, थैंक यू।',
      lastAssistantText: 'Company-fitted option available nahi hai.',
      recentAssistantTexts: [],
      productName: 'Acme CRM',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.doesNotMatch(result.userContent, /NOT a booking/i);
    assert.doesNotMatch(result.userContent, /NEVER invent/i);
    assert.doesNotMatch(result.userContent, /BOOKING LOCKED/);
  });

  it('mixed not-interested + callback gets schedule_callback hint, not refusal close', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'ठीक है मुझे नहीं चाहिए थोड़ी देर बाद फ़ोन करेंगे',
      lastAssistantText: 'Agar chahen, main iske features ya price bhi bata deti hoon.',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /schedule_callback/);
    assert.match(result.userContent, /NOT DNC/);
    assert.doesNotMatch(result.userContent, /NEVER invent/i);
  });

  it('after barge-in, answers the new question instead of finishing the previous list', async () => {
    const state = emptySimulator2TurnState();
    state.callerInterrupted = true;
    const result = await prepareSimulator2UserTurn({
      heard: 'price',
      lastAssistantText:
        'Taigun mein Digital Cockpit, infotainment, IDA Voice Command, panoramic sunroof milte hain.',
      recentAssistantTexts: [],
      productName: 'Widget Pro',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state,
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /Caller interrupted you/);
    assert.match(result.userContent, /do not finish/i);
    assert.equal(result.state.callerInterrupted, false);
  });

  it('mutes Devanagari haan as a backchannel', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'हाँ।',
      lastAssistantText: 'Virtus Chrome das lakh sattar hazaar se start hota hai.',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'mute');
  });

  it('lets identity / why-you-called reach the LLM without wrapping', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'aapne call kyon kiya',
      lastAssistantText: 'Virtus Chrome das lakh sattar hazaar se start hota hai.',
      recentAssistantTexts: [],
      productName: 'Volkswagen India',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.doesNotMatch(result.userContent, /BUYING INTEREST/);
    assert.match(result.userContent, /NEVER call end_call/);
    assert.match(result.userContent, /IDENTITY/);
    assert.equal(result.state.offTopicStrikes, 0);
    assert.equal(result.state.wrapForced, false);
  });

  it('sends tell-me-more and buying interest to the LLM without intent labels', async () => {
    const more = await prepareSimulator2UserTurn({
      heard: 'aur bataiye mere',
      lastAssistantText: 'Chrome das lakh sattar, Sport chaudah lakh chauntis.',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(more.kind, 'reply');
    if (more.kind === 'reply') {
      assert.doesNotMatch(more.userContent, /Do NOT repeat prices/);
    }

    const buy = await prepareSimulator2UserTurn({
      heard: "OK. I'll go with sedan.",
      lastAssistantText: 'If you want an SUV, Taigun; if you want a sedan, Virtus is the main option.',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(buy.kind, 'reply');
    if (buy.kind === 'reply') {
      assert.doesNotMatch(buy.userContent, /BUYING INTEREST/);
    }
  });

  it('permission grant after opener reaches the LLM without a discovery script', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Haan Ji bolie.',
      lastAssistantText:
        'Good morning, Volkswagen India se Neha bol rahi hoon. Kya main aapse thodi der baat kar sakti hoon?',
      recentAssistantTexts: [],
      productName: 'Volkswagen',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /ONE short discovery question/);
  });

  it('low STT confidence does not force a clarify note', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'price kya hai',
      confidence: 0.4,
      lastAssistantText: 'Main madad kar sakti hoon.',
      recentAssistantTexts: [],
      productName: 'Acme CRM',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.doesNotMatch(result.userContent, /unclear/i);
    assert.doesNotMatch(result.userContent, /features, price, ya demo/i);
  });

  it('unseen product questions still reply without an intent label', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Does Cronberry integrate with WhatsApp sandbox?',
      lastAssistantText: 'Namaste, main Priya hoon.',
      recentAssistantTexts: [],
      productName: 'Acme CRM',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.doesNotMatch(result.userContent, /BUYING INTEREST|ONE short discovery|Off-topic or personal/);
  });

  it('injects product-help-first note for hotel/room questions', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Pehle bataiye kaunse rooms available hain aur kitne floors hain?',
      lastAssistantText: 'Kya main aapka naam note karun?',
      recentAssistantTexts: [],
      productName: 'Moustache Escapes',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /answer from Product Knowledge|lookup_hotel_availability/i);
    assert.match(result.userContent, /Do NOT ask for name, phone/i);
  });

  it('treats "X mein Moustache hai?" as a city existence ask (brand cue)', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Shimla mein Moustache hai?',
      lastAssistantText: 'Kaunsi city?',
      recentAssistantTexts: [],
      productName: 'Moustache Escapes',
      skills: mergeSkillsConfig({
        booking: { outcome: 'stay', templateId: 'hotel_stay', speakAs: 'hotel stay booking' },
      }),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(
      result.userContent,
      /LIVE LOOKUP already completed for Shimla|lookup_hotel_availability NOW|MUST check BOTH/i,
    );
  });

  it('gives salesperson clarify guidance for vague place words (beach / pahad)', async () => {
    for (const heard of ['beach side kuch hai', 'pahad me kahin sasta hotel']) {
      const result = await prepareSimulator2UserTurn({
        heard,
        lastAssistantText: 'Kaunsi city?',
        recentAssistantTexts: [],
        productName: 'Moustache Escapes',
        skills: mergeSkillsConfig({
          booking: { outcome: 'stay', templateId: 'hotel_stay', speakAs: 'hotel stay booking' },
        }),
        knownEmailDomains: [],
        state: emptySimulator2TurnState(),
      });
      assert.equal(result.kind, 'reply');
      if (result.kind !== 'reply') return;
      assert.doesNotMatch(result.userContent, /LIVE LOOKUP already completed/i, heard);
      assert.match(result.userContent, /vague|nearest city|2–3 city choices/i, heard);
    }
  });

  it('injects answer-first note when caller complains about funnel lock', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Madam aap ek cheez mein kyun atak gaye? Pehle jawab to de dijiye.',
      lastAssistantText: 'Kya main naam aur number le sakti hoon?',
      recentAssistantTexts: [],
      productName: 'Moustache Escapes',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /do NOT pitch booking/i);
  });

  it('does not mark bookingSaved from fake confirm speech; injects correction note', async () => {
    const result = await prepareSimulator2UserTurn({
      heard: 'Ok thank you',
      lastAssistantText:
        'Aapki booking confirm ho gayi hai 15 September ko subah gyaarah ke liye.',
      recentAssistantTexts: [],
      productName: 'Moustache Escapes',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.equal(result.state.bookingSaved, false);
    assert.equal(result.kind, 'reply');
    if (result.kind !== 'reply') return;
    assert.match(result.userContent, /NOT returned ok:true/i);
  });

  it('persists phone digits when capture is briefly inactive', async () => {
    const first = await prepareSimulator2UserTurn({
      heard: 'nine eight seven six',
      lastAssistantText: 'Apna 10 digit mobile number boliye.',
      recentAssistantTexts: ['Apna 10 digit mobile number boliye.'],
      productName: 'Acme CRM',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
    });
    assert.ok(first.state.phoneBuffer.digits.length > 0);
    const second = await prepareSimulator2UserTurn({
      heard: 'five four three two one zero',
      lastAssistantText: 'Theek hai.',
      recentAssistantTexts: ['Theek hai.'],
      productName: 'Acme CRM',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: first.state,
    });
    assert.ok(second.state.phoneBuffer.digits.length >= first.state.phoneBuffer.digits.length);
  });

  it('locks booking from the tool callback, not from a spoken guess', async () => {
    const locked = markBookingSaved(emptySimulator2TurnState(), 'kal 3 PM');
    const result = await prepareSimulator2UserTurn({
      heard: 'ok',
      lastAssistantText: 'Maine slot note kiya.',
      recentAssistantTexts: [],
      productName: 'Acme CRM',
      skills: mergeSkillsConfig(null),
      knownEmailDomains: [],
      state: emptySimulator2TurnState(),
      bookingLock: { saved: true, preferredTime: 'kal 3 PM' },
    });
    assert.equal(locked.callFacts.facts.booking, 'saved');
    assert.equal(result.state.bookingSaved, true);
    assert.equal(result.state.callFacts.facts.booking, 'saved');
  });
});

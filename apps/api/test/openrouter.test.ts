import { describe, expect, it } from 'vitest';
import { parseModels } from '../src/openrouter.js';
import { MODELS_RESPONSE } from './fixtures-openrouter.js';

describe('openrouter models', () => {
  it('classifies free/paid models, image input and prices', () => {
    const models = Object.fromEntries(parseModels(MODELS_RESPONSE).map((m) => [m.id, m]));
    expect(models['google/gemini-2.5-flash']).toMatchObject({
      free: false,
      imageInput: true,
      promptPerM: 0.3,
      completionPerM: 2.5,
      structuredOutput: true,
      tools: true,
    });
    expect(models['meta-llama/llama-3.3-70b-instruct:free']).toMatchObject({
      free: true,
      imageInput: false,
      promptPerM: 0,
    });
    expect(models['qwen/qwen2.5-vl-72b-instruct:free']).toMatchObject({
      free: true,
      imageInput: true,
    });
    // Prezzo variabile (-1): non è gratuito e il prezzo è sconosciuto.
    expect(models['openrouter/auto']).toMatchObject({ free: false, promptPerM: null });
  });

  it('rejects unexpected responses', () => {
    expect(() => parseModels({ error: 'x' })).toThrow('OPENROUTER_BAD_RESPONSE');
  });
});

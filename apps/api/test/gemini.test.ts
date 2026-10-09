import { describe, expect, it } from 'vitest';
import { parseGeminiModels } from '../src/gemini.js';

describe('parseGeminiModels', () => {
  it('keeps text generation models and estimates free tier and image input', () => {
    const models = parseGeminiModels({
      models: [
        {
          name: 'models/gemini-flash-latest',
          displayName: 'Gemini Flash Latest',
          inputTokenLimit: 1048576,
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        {
          name: 'models/gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro',
          supportedGenerationMethods: ['generateContent'],
        },
        { name: 'models/gemma-3-27b-it', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemma-3n-e4b-it', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
        {
          name: 'models/gemini-2.5-flash-preview-tts',
          supportedGenerationMethods: ['generateContent'],
        },
      ],
    });
    expect(models.map((m) => m.id)).toEqual([
      'gemini-2.5-pro',
      'gemini-flash-latest',
      'gemma-3-27b-it',
      'gemma-3n-e4b-it',
    ]);
    const byId = Object.fromEntries(models.map((m) => [m.id, m]));
    expect(byId['gemini-flash-latest']).toMatchObject({
      free: true,
      imageInput: true,
      contextLength: 1048576,
      structuredOutput: true,
    });
    expect(byId['gemini-2.5-pro']!.free).toBe(false);
    expect(byId['gemma-3-27b-it']).toMatchObject({ imageInput: true, structuredOutput: false });
    expect(byId['gemma-3n-e4b-it']!.imageInput).toBe(false);
  });
});

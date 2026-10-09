/** Estratto (ridotto) della risposta di GET https://openrouter.ai/api/v1/models. */
export const MODELS_RESPONSE = {
  data: [
    {
      id: 'google/gemini-2.5-flash',
      name: 'Google: Gemini 2.5 Flash',
      context_length: 1048576,
      architecture: {
        modality: 'text+image->text',
        input_modalities: ['text', 'image', 'file'],
        output_modalities: ['text'],
      },
      pricing: { prompt: '0.0000003', completion: '0.0000025', request: '0', image: '0.001238' },
      supported_parameters: ['tools', 'response_format', 'structured_outputs', 'temperature'],
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Meta: Llama 3.3 70B Instruct (free)',
      context_length: 131072,
      architecture: {
        modality: 'text->text',
        input_modalities: ['text'],
        output_modalities: ['text'],
      },
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['temperature'],
    },
    {
      id: 'qwen/qwen2.5-vl-72b-instruct:free',
      name: 'Qwen: Qwen2.5 VL 72B Instruct (free)',
      context_length: 32768,
      architecture: {
        modality: 'text+image->text',
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      },
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: [],
    },
    {
      id: 'openrouter/auto',
      name: 'Auto Router',
      context_length: 2000000,
      architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'] },
      pricing: { prompt: '-1', completion: '-1' },
    },
  ],
};

export function fakeOpenRouterFetch(calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get('authorization');
    if (url.endsWith('/models')) return Response.json(MODELS_RESPONSE);
    if (url.endsWith('/key')) {
      if (auth !== 'Bearer sk-or-v1-valid-key-1234')
        return new Response('{"error":{"message":"No auth"}}', { status: 401 });
      return Response.json({
        data: {
          label: 'sk-or-v1-val...234',
          usage: 1.25,
          limit: 10,
          limit_remaining: 8.75,
          is_free_tier: false,
        },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

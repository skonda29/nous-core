import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderId } from '@nous/shared';
import { ValidationError } from '@nous/shared';
import { ChatCompletionsProvider } from '../protocols/openai-api/provider.js';
import { VLLM_PROVIDER_DEFINITION } from '../providers/vllm/definition.js';
import { providerFactory } from '../providers/vllm/provider.js';

// Mirrors how the runtime builds a config from the definition —
// defaultEndpoint becomes config.endpoint at provider construction time.
const MOCK_CONFIG = {
  id: '00000000-0000-0000-0000-000000000099' as ProviderId,
  name: 'vLLM',
  type: 'text' as const,
  modelId: 'meta-llama/Llama-3.1-8B-Instruct',
  endpoint: VLLM_PROVIDER_DEFINITION.defaultEndpoint,
  isLocal: true,
  capabilities: ['text'],
};

const TRACE_ID = '00000000-0000-0000-0000-000000000002' as any;

describe('vLLM provider — definition', () => {
  it('uses the local vLLM endpoint as default', () => {
    expect(VLLM_PROVIDER_DEFINITION.defaultEndpoint).toBe('http://localhost:8000');
    expect(VLLM_PROVIDER_DEFINITION.isLocal).toBe(true);
    expect(VLLM_PROVIDER_DEFINITION.providerClass).toBe('local_text');
  });

  it('treats auth as optional but documents the VLLM_API_KEY env var', () => {
    expect(VLLM_PROVIDER_DEFINITION.auth.required).toBe(false);
    expect(VLLM_PROVIDER_DEFINITION.auth.envVar).toBe('VLLM_API_KEY');
    expect(VLLM_PROVIDER_DEFINITION.auth.purpose).toBe('api_key');
  });

  it('uses the chat-completions protocol and adapter', () => {
    expect(VLLM_PROVIDER_DEFINITION.protocol).toBe('chat-completions');
    expect(VLLM_PROVIDER_DEFINITION.adapterKey).toBe('chat-completions');
  });

  it('does not hand-author wellKnownProviderId', () => {
    expect(VLLM_PROVIDER_DEFINITION).not.toHaveProperty('wellKnownProviderId');
  });
});

describe('vLLM provider — factory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.VLLM_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.VLLM_API_KEY;
  });

  it('creates a ChatCompletionsProvider instance', () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    expect(provider).toBeInstanceOf(ChatCompletionsProvider);
  });

  it('does not throw when no API key is provided (keyless self-hosted server)', () => {
    expect(() => providerFactory.create(MOCK_CONFIG)).not.toThrow();
  });

  it('getConfig() returns the config passed to the factory', () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    expect(provider.getConfig()).toEqual(MOCK_CONFIG);
  });

  it('invoke() validates input — rejects invalid shape with ValidationError', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);

    await expect(
      provider.invoke({
        role: 'cortex-chat',
        input: { invalid: 'shape' },
        traceId: TRACE_ID,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('invoke() targets config.endpoint, not the OpenAI default', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    } as Response);

    await provider.invoke({
      role: 'cortex-chat',
      input: { prompt: 'hi' },
      traceId: TRACE_ID,
    });

    const [url] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/v1/chat/completions');
    expect(url).not.toContain('openai.com');
  });

  it('invoke() with no API key sends a Bearer no-auth placeholder header', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    } as Response);

    await provider.invoke({
      role: 'cortex-chat',
      input: { prompt: 'hi' },
      traceId: TRACE_ID,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer no-auth');
  });

  it('invoke() forwards VLLM_API_KEY as a Bearer token when set', async () => {
    process.env.VLLM_API_KEY = 'secret-token';
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'hi' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    } as Response);

    await provider.invoke({
      role: 'cortex-chat',
      input: { prompt: 'hi' },
      traceId: TRACE_ID,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-token');
  });

  it('invoke() with valid prompt returns a ModelResponse', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from vLLM' } }],
        usage: { prompt_tokens: 4, completion_tokens: 5 },
      }),
    } as Response);

    const result = await provider.invoke({
      role: 'cortex-chat',
      input: { prompt: 'Say hello' },
      traceId: TRACE_ID,
    });

    expect(result.output).toBe('Hello from vLLM');
    expect(result.providerId).toBe(MOCK_CONFIG.id);
    expect(result.usage?.inputTokens).toBe(4);
    expect(result.usage?.outputTokens).toBe(5);
  });

  it('invoke() maps a 401 response to PROVIDER_AUTH_FAILED', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as Response);

    await expect(
      provider.invoke({
        role: 'cortex-chat',
        input: { prompt: 'hi' },
        traceId: TRACE_ID,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILED' });
  });

  it('invoke() throws PROVIDER_UNAVAILABLE on a non-ok response', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal server error',
    } as Response);

    await expect(
      provider.invoke({
        role: 'cortex-chat',
        input: { prompt: 'hi' },
        traceId: TRACE_ID,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('stream() yields content chunks and a final done chunk', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          [
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
            '',
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}',
            '',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}',
            '',
            'data: [DONE]',
            '',
          ].join('\n'),
        ));
        controller.close();
      },
    });
    vi.mocked(fetch).mockResolvedValue(new Response(stream, { status: 200 }));

    const chunks: Array<{ content: string; done: boolean }> = [];
    for await (const chunk of provider.stream({
      role: 'cortex-chat',
      input: { prompt: 'Say hello' },
      traceId: TRACE_ID,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.content === 'Hello')).toBe(true);
    expect(chunks.some((c) => c.content === ' world')).toBe(true);
    expect(chunks.some((c) => c.done === true)).toBe(true);
  });
});

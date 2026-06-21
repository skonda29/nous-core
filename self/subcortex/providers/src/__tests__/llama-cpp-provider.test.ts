import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderId } from '@nous/shared';
import { NousError } from '@nous/shared';
import { ChatCompletionsProvider } from '../protocols/openai-api/provider.js';
import { LLAMA_CPP_PROVIDER_DEFINITION } from '../providers/llama-cpp/definition.js';
import { providerFactory } from '../providers/llama-cpp/provider.js';

const MOCK_CONFIG = {
  id: '00000000-0000-0000-0000-000000000099' as ProviderId,
  name: 'llama.cpp',
  type: 'text' as const,
  modelId: 'llama3.2',
  isLocal: true,
  capabilities: ['text'],
};

describe('LlamaCppProvider — definition', () => {
  it('uses local endpoint with no auth required', () => {
    expect(LLAMA_CPP_PROVIDER_DEFINITION.defaultEndpoint).toBe('http://localhost:8080');
    expect(LLAMA_CPP_PROVIDER_DEFINITION.auth.required).toBe(false);
    expect(LLAMA_CPP_PROVIDER_DEFINITION.isLocal).toBe(true);
  });

  it('uses chat-completions protocol and adapter', () => {
    expect(LLAMA_CPP_PROVIDER_DEFINITION.protocol).toBe('chat-completions');
    expect(LLAMA_CPP_PROVIDER_DEFINITION.adapterKey).toBe('chat-completions');
  });

  it('does not hand-author wellKnownProviderId', () => {
    expect(LLAMA_CPP_PROVIDER_DEFINITION).not.toHaveProperty('wellKnownProviderId');
  });
});

describe('LlamaCppProvider — factory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('creates a ChatCompletionsProvider instance', () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    expect(provider).toBeInstanceOf(ChatCompletionsProvider);
  });

  it('does not throw when no API key is provided', () => {
    expect(() => providerFactory.create(MOCK_CONFIG)).not.toThrow();
  });

  it('getConfig() returns the config passed to the factory', () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    expect(provider.getConfig()).toEqual(MOCK_CONFIG);
  });

  it('invoke() with valid prompt returns ModelResponse', async () => {
    const provider = providerFactory.create(MOCK_CONFIG);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello from llama.cpp' } }],
        usage: { prompt_tokens: 4, completion_tokens: 5 },
      }),
    } as Response);

    const result = await provider.invoke({
      role: 'cortex-chat',
      input: { prompt: 'Say hello' },
      traceId: '00000000-0000-0000-0000-000000000002' as any,
    });

    expect(result.output).toBe('Hello from llama.cpp');
    expect(result.providerId).toBe(MOCK_CONFIG.id);
    expect(result.usage?.inputTokens).toBe(4);
    expect(result.usage?.outputTokens).toBe(5);
  });

  it('invoke() throws PROVIDER_UNAVAILABLE on non-ok response', async () => {
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
        traceId: '00000000-0000-0000-0000-000000000002' as any,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

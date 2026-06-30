import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ProviderId } from '@nous/shared';
import { NousError } from '@nous/shared';
import {
  OPENROUTER_DEFAULT_ENDPOINT,
  OPENROUTER_DEFAULT_MODEL_ID,
  OPENROUTER_PROVIDER_DEFINITION,
  providerDefinition,
  providerFactory,
} from '../../providers/openrouter/index.js';
import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import { ProviderDefinitionSchema } from '../../schemas/provider-definition.js';
import { deriveBuiltInProviderId } from '../../provider-identity.js';

const MOCK_CONFIG = {
  id: deriveBuiltInProviderId('openrouter'),
  name: 'OpenRouter',
  type: 'text' as const,
  modelId: OPENROUTER_DEFAULT_MODEL_ID,
  isLocal: false,
  capabilities: ['text'],
};

describe('OpenRouter provider leaf', () => {
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    }
    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it('exposes OpenRouter-specific OpenAI-compatible metadata', () => {
    expect(providerDefinition).toBe(OPENROUTER_PROVIDER_DEFINITION);
    expect(OPENROUTER_PROVIDER_DEFINITION.vendorKey).toBe('openrouter');
    expect(OPENROUTER_PROVIDER_DEFINITION.protocol).toBe('chat-completions');
    expect(OPENROUTER_PROVIDER_DEFINITION.adapterKey).toBe('chat-completions');
    expect(OPENROUTER_PROVIDER_DEFINITION.defaultEndpoint).toBe(OPENROUTER_DEFAULT_ENDPOINT);
    expect(OPENROUTER_DEFAULT_ENDPOINT).toBe('https://openrouter.ai/api');
    expect(OPENROUTER_PROVIDER_DEFINITION.defaultModelId).toBe('openrouter/auto');
    expect(OPENROUTER_PROVIDER_DEFINITION.auth.envVar).toBe('OPENROUTER_API_KEY');
    expect(OPENROUTER_PROVIDER_DEFINITION.auth.header).toEqual({
      name: 'Authorization',
      scheme: 'bearer',
    });
    expect(OPENROUTER_PROVIDER_DEFINITION.modelListEndpoint).toBe('/v1/models');
    expect(OPENROUTER_PROVIDER_DEFINITION.modelListFormat).toBe('openai-models');
    expect(OPENROUTER_PROVIDER_DEFINITION.healthCheckEndpoint).toBe('/v1/key');
  });

  it('advertises streaming and model listing but not nativeToolUse (pending the #390 tool-use bridge)', () => {
    expect(OPENROUTER_PROVIDER_DEFINITION.capabilities?.streaming).toBe(true);
    expect(OPENROUTER_PROVIDER_DEFINITION.capabilities?.modelListing).toBe(true);
    expect('nativeToolUse' in (OPENROUTER_PROVIDER_DEFINITION.capabilities ?? {})).toBe(false);
  });

  it('does not hand-author wellKnownProviderId (derived centrally from vendorKey)', () => {
    expect('wellKnownProviderId' in OPENROUTER_PROVIDER_DEFINITION).toBe(false);
  });

  it('satisfies the shared ProviderDefinitionSchema once hydrated with a derived id', () => {
    const hydrated = {
      ...OPENROUTER_PROVIDER_DEFINITION,
      wellKnownProviderId: deriveBuiltInProviderId('openrouter') as ProviderId,
    };
    expect(() => ProviderDefinitionSchema.parse(hydrated)).not.toThrow();
  });

  it('factory builds a ChatCompletionsProvider for the openrouter vendor', () => {
    const provider = providerFactory.create(MOCK_CONFIG, { apiKey: 'test-openrouter-key' });
    expect(providerFactory.vendorKey).toBe('openrouter');
    expect(provider).toBeInstanceOf(ChatCompletionsProvider);
    expect(provider.getConfig()).toEqual(MOCK_CONFIG);
  });

  it('factory throws when no OpenRouter API key is available', () => {
    expect(() => providerFactory.create(MOCK_CONFIG, {})).toThrow(NousError);
    expect(() => providerFactory.create(MOCK_CONFIG, {})).toThrow(
      'OpenRouter API key required — set OPENROUTER_API_KEY or pass apiKey option',
    );
  });

  it('factory does not fall back to OPENAI_API_KEY when OpenRouter key is missing', () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';

    expect(() => providerFactory.create(MOCK_CONFIG, {})).toThrow(NousError);
    expect(() => providerFactory.create(MOCK_CONFIG, {})).toThrow(
      'OpenRouter API key required — set OPENROUTER_API_KEY or pass apiKey option',
    );
  });

  it('factory resolves OPENROUTER_API_KEY from the environment when options omit apiKey', () => {
    process.env.OPENROUTER_API_KEY = 'env-openrouter-key';

    const provider = providerFactory.create(MOCK_CONFIG, {});
    expect(provider).toBeInstanceOf(ChatCompletionsProvider);
    expect(provider.getConfig()).toEqual(MOCK_CONFIG);
  });
});

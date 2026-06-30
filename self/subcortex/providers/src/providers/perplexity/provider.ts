/**
 * Perplexity provider factory.
 *
 * Perplexity speaks the OpenAI Chat Completions protocol, so this leaf reuses
 * the shared `ChatCompletionsProvider`. The Perplexity endpoint flows in via
 * `config.endpoint` (hydrated from `defaultEndpoint`) and the API key is
 * resolved from `PERPLEXITY_API_KEY` by the runtime and passed through here.
 */
import { NousError } from '@nous/shared';
import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import type { ProviderFactoryModule } from '../../schemas/provider-factory.js';

export const providerFactory = {
  vendorKey: 'perplexity',
  create(config, options) {
    // Fail closed against the shared provider's OpenAI fallback.
    // `ChatCompletionsProvider` falls back to `process.env.OPENAI_API_KEY`
    // when no key is supplied; passing `undefined` here could therefore send
    // an OpenAI credential to https://api.perplexity.ai. Resolve the
    // Perplexity key explicitly and refuse to construct without it, so the
    // OpenAI fallback path is never reachable for this vendor.
    // (Shared provider/protocol credential boundary cleanup tracked in #413.)
    const apiKey = options?.apiKey ?? process.env.PERPLEXITY_API_KEY;
    if (!apiKey) {
      throw new NousError(
        'Perplexity API key required — set PERPLEXITY_API_KEY or pass the apiKey option',
        'PROVIDER_AUTH_FAILED',
        { failoverReasonCode: 'PRV-AUTH-FAILURE' },
      );
    }
    // Perplexity's OpenAI-compatible endpoint is `/chat/completions` (no `/v1`),
    // unlike OpenAI's `/v1/chat/completions`. Override the shared default.
    return new ChatCompletionsProvider(config, {
      apiKey,
      completionsPath: '/chat/completions',
    });
  },
} as const satisfies ProviderFactoryModule;

import { NousError } from '@nous/shared';
import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import type { ProviderFactoryModule } from '../../schemas/provider-factory.js';

export const providerFactory = {
  vendorKey: 'moonshot',
  create(config, options?) {
    // Fail closed: ChatCompletionsProvider falls back to OPENAI_API_KEY when no
    // key is supplied, which could send an OpenAI credential to Moonshot. Resolve
    // the Moonshot credential explicitly and never pass `undefined` downstream.
    const apiKey = options?.apiKey ?? process.env.MOONSHOT_API_KEY;
    if (!apiKey) {
      throw new NousError(
        'Moonshot API key required — set MOONSHOT_API_KEY or pass apiKey option',
        'PROVIDER_AUTH_FAILED',
        { failoverReasonCode: 'PRV-AUTH-FAILURE' },
      );
    }
    return new ChatCompletionsProvider(config, { apiKey });
  },
} as const satisfies ProviderFactoryModule;

import { NousError } from '@nous/shared';
import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import type { ProviderFactoryModule } from '../../schemas/provider-factory.js';

export const providerFactory = {
  vendorKey: 'xai',
  create(config, options?) {
    const apiKey = options?.apiKey ?? process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new NousError(
        'xAI API key required — set XAI_API_KEY or pass apiKey option',
        'PROVIDER_AUTH_FAILED',
        { failoverReasonCode: 'PRV-AUTH-FAILURE' },
      );
    }
    return new ChatCompletionsProvider(config, { apiKey });
  },
} as const satisfies ProviderFactoryModule;
import { NousError } from '@nous/shared';
import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import type { ProviderFactoryModule } from '../../schemas/provider-factory.js';
import { OPENROUTER_PROVIDER_DEFINITION } from './definition.js';

const OPENROUTER_ENV_VAR = OPENROUTER_PROVIDER_DEFINITION.auth.envVar!;

export const providerFactory = {
  vendorKey: 'openrouter',
  create(config, options) {
    const apiKey = options?.apiKey ?? process.env[OPENROUTER_ENV_VAR];
    if (!apiKey) {
      throw new NousError(
        'OpenRouter API key required — set OPENROUTER_API_KEY or pass apiKey option',
        'PROVIDER_AUTH_FAILED',
        { failoverReasonCode: 'PRV-AUTH-FAILURE' },
      );
    }
    return new ChatCompletionsProvider(config, { apiKey });
  },
} as const satisfies ProviderFactoryModule;

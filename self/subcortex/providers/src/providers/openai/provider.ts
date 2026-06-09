import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import type { ProviderFactoryModule } from '../../provider-factories.js';

export const providerFactory = {
  vendorKey: 'openai',
  create(config, options) {
    return new ChatCompletionsProvider(config, { apiKey: options?.apiKey });
  },
} as const satisfies ProviderFactoryModule;

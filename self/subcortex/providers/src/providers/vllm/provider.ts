import { ChatCompletionsProvider } from '../../protocols/openai-api/provider.js';
import type {
  ProviderFactoryCreateOptions,
  ProviderFactoryModule,
} from '../../schemas/provider-factory.js';
import type { ModelProviderConfig } from '@nous/shared';

/**
 * vLLM reuses the shared `ChatCompletionsProvider`. Because vLLM is self-hosted
 * and usually keyless, we fall back to a `no-auth` placeholder (as `llama-cpp`
 * does) so the shared provider does not reject construction. When the server is
 * started with `--api-key`, set `VLLM_API_KEY` and it is forwarded as a bearer
 * token instead.
 */
export const providerFactory = {
  vendorKey: 'vllm',
  create(config: ModelProviderConfig, options?: ProviderFactoryCreateOptions) {
    return new ChatCompletionsProvider(config, {
      apiKey: options?.apiKey ?? process.env.VLLM_API_KEY ?? 'no-auth',
    });
  },
} as const satisfies ProviderFactoryModule;

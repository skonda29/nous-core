import type { ProviderDefinitionLeaf } from '../../schemas/provider-definition.js';

/**
 * vLLM exposes an OpenAI Chat Completions-compatible API, so this leaf carries
 * only vLLM-specific metadata and reuses the shared `ChatCompletionsProvider`.
 *
 * vLLM is self-hosted, so auth is optional: when `VLLM_API_KEY` is set (i.e. the
 * server was started with `--api-key`) it is sent as a bearer token; otherwise
 * the factory falls back to a `no-auth` placeholder, mirroring the `llama-cpp`
 * leaf. `defaultEndpoint` is the OpenAI-compatible base — the shared provider
 * appends `/v1/chat/completions` and `/v1/models`.
 */
export const VLLM_PROVIDER_DEFINITION = {
  vendorKey: 'vllm',
  displayName: 'vLLM',
  providerType: 'text',
  providerClass: 'local_text',
  protocol: 'chat-completions',
  adapterKey: 'chat-completions',
  defaultEndpoint: 'http://localhost:8000',
  defaultModelId: 'meta-llama/Llama-3.1-8B-Instruct',
  auth: {
    envVar: 'VLLM_API_KEY',
    header: {
      name: 'Authorization',
      scheme: 'bearer',
    },
    required: false,
    purpose: 'api_key',
  },
  modelListEndpoint: '/v1/models',
  modelListFormat: 'openai-models',
  healthCheckEndpoint: '/v1/models',
  capabilities: {
    streaming: true,
    nativeToolUse: true,
    modelListing: true,
    healthCheck: true,
  },
  isLocal: true,
} as const satisfies ProviderDefinitionLeaf;

export { VLLM_PROVIDER_DEFINITION as providerDefinition };

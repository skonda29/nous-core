import type { 
    ProviderDefinitionLeaf 
} from '../../schemas/provider-definition.js';
import { ProviderDefinition as tProviderDefinition} from '../../provider-definitions.js';

const DEFAULT_ENDPOINT = 'https://api.x.ai/v1';
const DEFAULT_MODEL_ID = 'grok-2-1212';

export const providerDefinition = {
    vendorKey: 'xai',
    displayName: 'xAI Grok',
    providerType: 'text',
    providerClass: 'remote_text',
    protocol: 'chat-completions',
    adapterKey: 'chat-completions',
    defaultEndpoint: DEFAULT_ENDPOINT,
    defaultModelId: DEFAULT_MODEL_ID, 
    auth: {
        envVar: 'XAI_API_KEY',
        vaultKeyNamespace: 'xai',
        header: {
        name: 'Authorization',
        scheme: 'bearer',
        },
        required: true,
        purpose: 'api_key',
    },
    modelListEndpoint: '/v1/models',
    modelListFormat: 'openai-models',
    capabilities: {
        streaming: true,
        nativeToolUse: true,
        modelListing: true,
    },
    isLocal: false,
} as const satisfies ProviderDefinitionLeaf;
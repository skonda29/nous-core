import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ChatCompletionsProvider,
  PROVIDER_DEFINITIONS,
  ProviderDefinitionSchema,
  deriveBuiltInProviderId,
  resolveProviderDefinition,
  resolveProviderFactory,
} from '../../index.js';
import {
  providerAdapter,
  providerDefinition,
  providerFactory,
} from '../../providers/xai/index.js';
import type { TraceId } from '@nous/shared';
import { ADAPTER_RESOLVER } from '../../index.js';

const TRACE_ID = '550e8400-e29b-41d4-a716-446655440199' as TraceId;

describe('xAI Grok Provider Leaf Package Integration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe('Registry Registration', () => {
    it('should be registered correctly in the global PROVIDER_DEFINITIONS catalog', () => {
      const registeredDef = PROVIDER_DEFINITIONS.find(d => d.vendorKey === 'xai');
      expect(registeredDef).toBeDefined();
      expect(registeredDef).toMatchObject({
        vendorKey: 'xai',
        adapterKey: 'chat-completions',
      });
    });

    it('should be retrievable via core package resolution methods', () => {
      const resolvedDef = resolveProviderDefinition('xai' as any);
      expect(resolvedDef).toBeDefined();
      expect(resolvedDef?.vendorKey).toBe('xai');

      const resolvedFactory = resolveProviderFactory('xai' as any);
      expect(resolvedFactory).toBe(providerFactory);
    });

    it('should declare the correct target protocol adapter metadata', () => {
      expect(providerAdapter).toBeDefined();
      expect(providerAdapter.adapterKey).toBe('chat-completions');
    });
  });

  describe('Provider Leaf Definition', () => {
    it('should strictly comply with the global ProviderDefinitionSchema parsing rules when hydrated', () => {
      const registeredDef = PROVIDER_DEFINITIONS.find(d => d.vendorKey === 'xai');
      expect(registeredDef).toBeDefined();
      
      const parsed = ProviderDefinitionSchema.safeParse(registeredDef);
      expect(parsed.success).toBe(true);
    });

    it('should compute the correct runtime built-in provider ID using core utility logic', () => {
      const registeredDef = PROVIDER_DEFINITIONS.find(d => d.vendorKey === 'xai');
      const expectedId = deriveBuiltInProviderId('xai');
      
      expect(registeredDef?.wellKnownProviderId).toBe(expectedId);
      expect(registeredDef?.vendorKey).toBe('xai');
    });

    it('should strictly satisfy the auth contract for settings configuration testing', () => {
      const { auth } = providerDefinition;
      expect(auth).toBeDefined();
      expect(auth.envVar).toBe('XAI_API_KEY');
      expect(auth.vaultKeyNamespace).toBe('xai');
      expect(auth.required).toBe(true);
      expect(auth.header).toEqual({
        name: 'Authorization',
        scheme: 'bearer',
      });
    });
  });

  describe('Provider Factory Security Boundaries', () => {
    const mockFactoryConfig = {
      vendorKey: 'xai',
      model: 'grok-2-1212',
      defaultEndpoint: 'https://api.x.ai/v1',
    } as any;

    it('should successfully instantiate ChatCompletionsProvider when an explicit key option is passed', () => {
      const provider = providerFactory.create(mockFactoryConfig, {
        apiKey: 'xai-direct-token-12345',
      });
      expect(provider).toBeInstanceOf(ChatCompletionsProvider);
    });

    it('should successfully instantiate via the XAI_API_KEY environment variable when config options are missing', () => {
      vi.stubEnv('XAI_API_KEY', 'xai-env-token-67890');
      
      const provider = providerFactory.create(mockFactoryConfig);
      expect(provider).toBeInstanceOf(ChatCompletionsProvider);
    });

    it('should fail closed, throwing an explicit validation error instead of fallback creeping into OPENAI_API_KEY', () => {
      vi.stubEnv('XAI_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', 'sk-accidental-leaked-openai-key-boundary');

      expect(() => {
        providerFactory.create(mockFactoryConfig);
      }).toThrow(/xAI API key required/i);
    });
  });

  describe('Adapter Parsing', () => {
    it('parses a Grok text response', () => {
      const adapter = ADAPTER_RESOLVER.resolveAdapter(providerDefinition.adapterKey);
      const parsed = adapter.parseResponse({
        choices: [{ message: { role: 'assistant', content: 'Hello from Grok' } }],
      }, TRACE_ID);
      expect(parsed.response).toBe('Hello from Grok');
      expect(parsed.contentType).toBe('text');
    });

    it('returns text fallback on malformed output without throwing', () => {
      const adapter = ADAPTER_RESOLVER.resolveAdapter(providerDefinition.adapterKey);
      expect(() => adapter.parseResponse({ unexpected: true }, TRACE_ID)).not.toThrow();
      expect(adapter.parseResponse({ unexpected: true }, TRACE_ID).contentType).toBe('text');
    });
  });
});
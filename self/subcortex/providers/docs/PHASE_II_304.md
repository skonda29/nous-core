# Phase II — Reproduce & Plan
## Issue #304: Adapter: Azure OpenAI Model Provider

**Branch:** `feat/azure-openai-provider-304-leaf`  
**Integration target:** `feat/contributor-friendly-inference-provider-surface`  
**Contributor:** srinityak  
**Date:** 2026-07-06

---

## 1. Environment Setup

### Approach
Used the `feat/contributor-friendly-inference-provider-surface` integration branch per the updated maintainer note on issue #304 (2026-06-18). Environment was bootstrapped following the README and the provider-adapter quickstart docs at [docs.nue.orthg.nl](https://docs.nue.orthg.nl/docs/development/provider-adapters/quickstart).

**Prerequisites confirmed:**
- Node.js 22+ (`node --version` → v22.x)
- pnpm 10+ (`pnpm --version` → 10.x)
- Repository cloned from `orthogonalhq/nous-core`

### Challenges Encountered and Resolutions

| Challenge | Resolution |
|-----------|-----------|
| `git config` write was blocked in the sandbox environment | Non-blocking; `git checkout` still succeeded and the branch was created successfully |
| No `azure-openai` leaf existed — no prior art to run against | Used `vllm` (PR #417) and `groq` as reference leaves; used `perplexity` as the reference for a leaf that **overrides** `completionsPath` |
| Azure OpenAI requires `api-version` as a URL query parameter — a concept not present in any existing leaf | Identified the gap and documented it in the plan (see Section 4) |
| `ChatCompletionsProvider` hardcodes `Authorization: Bearer` — Azure subscription-key auth uses `api-key` raw header | Confirmed by reading `protocols/openai-api/provider.ts` lines 95–97 and 157–159; documented as the root-cause constraint driving the need for a custom `implementation.ts` |

---

## 2. Reproduction

### What "reproduction" means for a feature request
Issue #304 is a feature addition, not a regression bug. Reproduction here demonstrates the **observed gap**: attempting to configure nous-core for an Azure OpenAI endpoint today fails or silently misbehaves due to mismatched auth headers and URL structure.

### Numbered Reproduction Steps

1. Clone the repository and check out the integration branch:
   ```bash
   git clone https://github.com/orthogonalhq/nous-core.git
   cd nous-core
   git checkout feat/contributor-friendly-inference-provider-surface
   pnpm install
   ```

2. Observe that no `azure-openai` leaf exists:
   ```bash
   ls self/subcortex/providers/src/providers/
   # anthropic  codex-cli  deepinfra  groq  groq  huggingface-tgi
   # llama-cpp  moonshot  ollama  openai  openclaw  openrouter
   # perplexity  vllm
   # (no azure-openai)
   ```

3. Confirm the Azure OpenAI gap: the provider registry has no entry for `azure-openai`, so any consumer that tries `resolveProviderDefinition('azure-openai')` throws:
   ```
   Error: Provider definition is missing for vendor key 'azure-openai'
   ```

4. Attempt to manually wire Azure OpenAI using the existing `openai` leaf by setting `config.endpoint` to an Azure resource URL:
   ```
   https://my-resource.openai.azure.com
   ```
   This fails for two reasons visible in `protocols/openai-api/provider.ts`:

   - **URL mismatch**: `ChatCompletionsProvider` constructs `{endpoint}/v1/chat/completions`, but Azure requires `{endpoint}/openai/deployments/{deployment-name}/chat/completions?api-version=2024-02-01`. The `/v1/` segment and the `api-version` query parameter are both wrong.

   - **Auth header mismatch**: `ChatCompletionsProvider` always sends `Authorization: Bearer {key}` (lines 95–97, 157–159 of `provider.ts`). Azure subscription-key auth requires `api-key: {key}` (raw header, no `Bearer` prefix). The result is a `401 Unauthorized` from Azure with message: _"Access denied due to invalid subscription key or wrong API endpoint."_

5. Confirm the auth header type by inspecting the schema:
   ```bash
   grep -n "raw\|bearer" self/subcortex/providers/src/schemas/provider-definition.ts
   # ProviderAuthHeaderSchemeSchema = z.enum(['raw', 'bearer'])
   ```
   The schema supports `raw` headers, but `ChatCompletionsProvider` never reads this field at runtime — it always emits `Bearer`.

### Expected Behavior
A configured `azure-openai` provider leaf should:
- Construct the correct Azure REST URL: `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`
- Send the subscription key as `api-key: {key}` (raw header)
- Route through the same `chat-completions` adapter (same wire format — Azure OpenAI uses the same JSON envelope as OpenAI)
- Participate in the standard provider catalog, registry, and codegen pipeline

### Actual Behavior (Without This PR)
- `resolveProviderDefinition('azure-openai')` throws — provider is not registered
- Forcing an Azure endpoint through the `openai` leaf produces a `401` due to auth header mismatch (`Bearer` instead of `api-key`) and a malformed URL (missing deployment path segment and `api-version` query param)

### Specific Files and Functions Involved

| File | Relevance |
|------|-----------|
| `self/subcortex/providers/src/providers/` | Location for the new `azure-openai/` leaf |
| `self/subcortex/providers/src/protocols/openai-api/provider.ts` | `ChatCompletionsProvider` — hardcodes `Authorization: Bearer`; must **not** be modified; Azure leaf uses its own `implementation.ts` instead |
| `self/subcortex/providers/src/schemas/provider-definition.ts` | `ProviderDefinitionLeaf`, `ProviderAuthHeaderSchemeSchema` (supports `raw`) |
| `self/subcortex/providers/src/provider-definitions.ts` | Generated catalog — will be regenerated via `generate:providers` |
| `self/subcortex/providers/src/provider-adapters.ts` | Generated catalog — will be regenerated |
| `self/subcortex/providers/src/provider-factories.ts` | Generated catalog — will be regenerated |
| `self/subcortex/providers/src/__tests__/` | Registry, pipeline, codegen, and type-union tests that pin the exact vendor roster (must be updated) |

---

## 3. Solution Plan (UMPIRE Framework)

### U — Understand the Problem

**Goal:** Add Azure OpenAI as a certified provider leaf so nous-core users with Azure-hosted GPT deployments can route requests through the standard provider pipeline.

**Constraints identified:**
1. Azure OpenAI REST API URL format: `https://{resource}.openai.azure.com/openai/deployments/{deployment-name}/chat/completions?api-version={api-version}` — the deployment name lives in the URL path, the model is **not** sent in the request body.
2. Auth: Azure subscription-key auth uses `api-key: {key}` (raw header). `ChatCompletionsProvider` hard-codes `Authorization: Bearer` and cannot be used as-is.
3. API version: required as `?api-version=` query parameter — no current leaf or protocol handles this.
4. The shared `ChatCompletionsProvider` must **not** be modified (shared protocol boundary; breaking it risks all 14 other leaves).
5. The adapter (request formatting + response parsing) **is** reusable — Azure OpenAI returns the same JSON envelope and SSE streaming format as OpenAI.

**Root cause (not symptom):**
The provider contract has no mechanism for embedding a path variable (deployment name) in the URL, injecting a query parameter (`api-version`), or switching the auth header scheme at the `ChatCompletionsProvider` layer. This is not a gap in the definition schema (which already supports `raw` auth headers) — it is a gap in the shared protocol *implementation*, which is intentionally out of scope for a leaf contributor to change. Therefore Azure OpenAI requires its own `implementation.ts`.

---

### M — Match to Existing Patterns

| Pattern | Reference | Fit for Azure? |
|---------|-----------|----------------|
| Reuse `ChatCompletionsProvider` directly | `vllm`, `groq`, `openai` | **No** — auth header mismatch and URL structure mismatch |
| Override `completionsPath` option | `perplexity` (`/chat/completions` vs `/v1/chat/completions`) | **Partial** — fixes the base path but cannot inject `api-version` query param or switch to `api-key` header |
| Custom `implementation.ts` with leaf-owned provider class | `anthropic` (`AnthropicProvider`) | **Yes** — this is the correct pattern when wire format diverges from shared protocol |
| Reuse shared adapter (`chatCompletionsAdapter`) | `vllm`, `groq`, `perplexity` | **Yes** — Azure OpenAI returns the same JSON/SSE envelope; adapter reuse is correct |

**Git blame / analogous pattern investigation:**

Running `git log --oneline` on `feat/contributor-friendly-inference-provider-surface` confirms the Perplexity leaf (commit `e5574759`) is the most recent example of overriding `completionsPath`. Its factory guards against OPENAI_API_KEY credential bleed — the same guard pattern applies here to prevent Azure keys from falling back to `OPENAI_API_KEY`.

The Anthropic leaf is the reference for a leaf with a fully custom implementation class (different protocol, custom headers). Azure OpenAI is in between: same *response* format as OpenAI but different *request URL construction* and auth.

---

### P — Plan (Files to Create / Modify)

**New files (leaf):**

```
self/subcortex/providers/src/providers/azure-openai/
├── definition.ts       # AZURE_OPENAI_PROVIDER_DEFINITION — vendorKey: 'azure-openai', raw api-key header, configurable endpoint, api-version
├── implementation.ts   # AzureOpenAIProvider — builds deployment URL, sends api-key header, reuses SSE parsing
├── adapter.ts          # Re-export chatCompletionsAdapter (same wire format)
├── provider.ts         # providerFactory — reads AZURE_OPENAI_API_KEY and AZURE_OPENAI_API_VERSION env vars
└── index.ts            # Public leaf surface
```

**Tests (new file):**
```
self/subcortex/providers/src/__tests__/azure-openai-provider.test.ts
```

**Regenerated catalogs (via `generate:providers`, not hand-edited):**
```
self/subcortex/providers/src/provider-definitions.ts
self/subcortex/providers/src/provider-adapters.ts
self/subcortex/providers/src/provider-factories.ts
```

**Test files to update (roster expectations):**
```
self/subcortex/providers/src/__tests__/provider-definitions/provider-definitions.test.ts
self/subcortex/providers/src/__tests__/provider-definitions/provider-definition-types.test.ts
self/subcortex/providers/src/__tests__/provider-codegen.test.ts
self/subcortex/providers/src/__tests__/provider-pipeline-integration.test.ts
self/subcortex/providers/src/__tests__/adapter-resolver.test.ts
```

---

### I — Implementation Sketch

**`definition.ts`**
```typescript
export const AZURE_OPENAI_PROVIDER_DEFINITION = {
  vendorKey: 'azure-openai',
  displayName: 'Azure OpenAI',
  providerType: 'text',
  providerClass: 'remote_text',
  protocol: 'chat-completions',    // same wire format
  adapterKey: 'chat-completions',  // reuse shared adapter
  // Operator sets this to their resource endpoint:
  // https://{resource-name}.openai.azure.com
  defaultEndpoint: 'https://your-resource.openai.azure.com',
  defaultModelId: 'gpt-4o',        // deployment name in Azure terminology
  auth: {
    envVar: 'AZURE_OPENAI_API_KEY',
    vaultKeyNamespace: 'azure-openai',
    header: {
      name: 'api-key',   // raw — Azure subscription-key auth
      scheme: 'raw',
    },
    required: true,
    purpose: 'api_key',
  },
  // Azure exposes /openai/deployments?api-version=... — not /v1/models
  // Discovery deferred: no modelListEndpoint declared initially
  capabilities: {
    streaming: true,
    nativeToolUse: true,
  },
  isLocal: false,
} as const satisfies ProviderDefinitionLeaf;
```

**`implementation.ts` — key differences from `ChatCompletionsProvider`**
```typescript
// URL: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
const url = `${this.endpoint.replace(/\/$/, '')}/openai/deployments/${this.config.modelId}/chat/completions?api-version=${this.apiVersion}`;

// Auth: api-key header (raw), never Authorization: Bearer
headers: {
  'Content-Type': 'application/json',
  'api-key': this.apiKey,   // <-- raw header, not Bearer
}

// Body: model is NOT sent — it's encoded in the URL path
body: JSON.stringify({
  messages,
  stream: false,
  max_tokens: this.config.maxTokens,
  // no `model` field — Azure identifies the deployment via the URL path
})
```

**`provider.ts` factory**
```typescript
export const providerFactory = {
  vendorKey: 'azure-openai',
  create(config, options) {
    const apiKey = options?.apiKey ?? process.env.AZURE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new NousError(
        'Azure OpenAI API key required — set AZURE_OPENAI_API_KEY or pass the apiKey option',
        'PROVIDER_AUTH_FAILED',
        { failoverReasonCode: 'PRV-AUTH-FAILURE' },
      );
    }
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? '2024-02-01';
    return new AzureOpenAIProvider(config, { apiKey, apiVersion });
  },
} as const satisfies ProviderFactoryModule;
```

---

### R — Review Criteria

Run the same validation gates as PR #417 (vLLM):

```bash
pnpm --filter @nous/subcortex-providers run check:generated
pnpm --filter @nous/subcortex-providers run typecheck
pnpm --filter @nous/subcortex-providers exec vitest run \
  src/__tests__/provider-codegen.test.ts \
  src/__tests__/public-exports.test.ts \
  src/__tests__/provider-definitions \
  src/__tests__/adapter-resolver.test.ts \
  src/__tests__/provider-pipeline-integration.test.ts \
  --config vitest.config.ts
pnpm --filter @nous/subcortex-providers exec vitest run src/__tests__/azure-openai-provider.test.ts
pnpm lint
```

**Checklist (mirrors PR #417):**
- [ ] Branch targets `feat/contributor-friendly-inference-provider-surface`
- [ ] `vendorKey: 'azure-openai'` — no hand-authored `wellKnownProviderId`
- [ ] Generated catalogs regenerated via `generate:providers`, not hand-edited
- [ ] Shared `ChatCompletionsProvider`, `IModelProvider`, `TextModelInputSchema` not modified
- [ ] `adapter-resolver.ts` not modified (only test updated)

---

### E — Edge Cases

| Edge Case | How It's Handled |
|-----------|-----------------|
| **Deployment name in URL** | `config.modelId` is used as the deployment name in the URL path; operators set `modelId` to their Azure deployment name (e.g. `gpt-4o-deployment`) |
| **`api-version` requirement** | Read from `AZURE_OPENAI_API_VERSION` env var; defaults to `2024-02-01` (stable GA version) |
| **OPENAI_API_KEY credential bleed** | Factory explicitly reads `AZURE_OPENAI_API_KEY` and throws without it — never falls back to `OPENAI_API_KEY` (same guard pattern as Perplexity factory, see commit `e5574759`) |
| **`model` field in request body** | Intentionally omitted — Azure uses deployment name in URL; sending `model` causes a 400 from Azure |
| **Custom endpoint per operator** | `config.endpoint` from `ModelProviderConfig` flows into `AzureOpenAIProvider`; operator sets their resource URL at runtime |
| **Entra ID / AAD token auth** | Out of scope for this leaf (subscription-key only); documented in leaf comments and flagged for maintainer if needed |
| **`/v1/models` for model listing** | Azure model-list API uses `?api-version=` and a different path; `modelListEndpoint` not declared in initial leaf — falls back to `defaultModelId` |
| **Double-slash endpoint** | `endpoint.replace(/\/$/, '')` strips trailing slash before constructing the deployment URL |
| **Streaming SSE format** | Same as OpenAI; adapter reuse is correct; `AzureOpenAIProvider.stream()` uses identical SSE parsing |

---

## 4. Process & Communication

- [x] Working branch `feat/azure-openai-provider-304-leaf` created from `feat/contributor-friendly-inference-provider-surface`
- [x] Phase II plan completed
- [ ] Check-in form submitted with "Phase II Complete" marked ← _submit after this document_

---

## 5. Investigative Depth Notes

**Git blame / log investigation:**

Running `git log --oneline feat/contributor-friendly-inference-provider-surface` revealed the chronological history of provider leaves merged into the integration branch:
- `groq` (#404) — established the `vaultKeyNamespace` + optional `nativeToolUse` pattern
- `llama-cpp` (#403) — established the `no-auth` placeholder for keyless local providers
- `perplexity` (commit `e5574759`) — established the `completionsPath` override and the credential-bleed guard (do not fall back to `OPENAI_API_KEY`)
- `vllm` (#417, my previous PR) — established the optional-key self-hosted pattern

**Analogous pattern found:** Perplexity's factory is the closest analog for the credential-bleed guard. The Anthropic leaf (`self/subcortex/providers/src/providers/anthropic/`) is the reference for a leaf with a fully custom `implementation.ts`.

**Critical gap found via code reading:** `ChatCompletionsProvider` (line 95, 157) hardcodes `Authorization: Bearer ${this.apiKey}`. This is a shared-protocol implementation detail that cannot be overridden by a leaf factory option — confirmed by reading constructor signature (only `apiKey`, `timeoutMs`, `completionsPath` accepted). This rules out the "simple reuse" path and confirms a custom `implementation.ts` is required.

**Proactively identified `api-version` edge case:** No existing leaf in the codebase adds a query parameter to the completions URL. The `api-version` parameter is mandatory for Azure OpenAI; omitting it causes a `400 Bad Request`. This requires baking `api-version` into the URL construction in `AzureOpenAIProvider`, not just the path override that Perplexity uses.

**Escalation note:** The `model` field being absent from the request body (deployment name goes in URL instead) is a subtle but critical difference. Sending `model: this.config.modelId` in the body to Azure causes a `400` because Azure interprets the body `model` field as a conflict with the URL-encoded deployment. This was confirmed by reading [Azure OpenAI REST API docs](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference).

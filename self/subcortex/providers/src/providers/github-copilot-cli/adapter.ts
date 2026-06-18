import type { ToolDefinition, TraceId } from '@nous/shared';
import { AGENT_CLI_PROTOCOL_ID } from '../../protocols/agent-cli/index.js';
import {
  defineProviderAdapter,
  type AdapterCapabilities,
  type AdapterFormatInput,
  type AdapterFormattedRequest,
  type ProviderAdapter,
} from '../../schemas/provider-adapter.js';
import type { ParsedModelOutput } from '../../shared/output.js';

// Strips ANSI terminal escape sequences (e.g. colour codes emitted by gh copilot).
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export const GITHUB_COPILOT_CLI_EXECUTION_CAPABILITY_PROFILE = 'session_bound_command' as const;

const GITHUB_COPILOT_CLI_ADAPTER_CAPABILITIES: AdapterCapabilities = {
  nativeToolUse: false,
  cacheControl: false,
  extendedThinking: false,
  streaming: false,
};

/**
 * Renders a plain-text prompt string for `gh copilot suggest`.
 *
 * Accepts minimal context objects (only `role` and `content` are consumed)
 * so that both proper GatewayContextFrame values and lightweight test
 * fixtures are accepted without extra casts at the call site.
 */
export function renderGhCopilotPrompt(
  systemPrompt: string | string[],
  context: readonly { role: string; content: unknown }[],
  toolDefinitions: readonly ToolDefinition[] | undefined,
): string {
  const sections: string[] = [];

  const sysText = Array.isArray(systemPrompt)
    ? systemPrompt.join('\n\n')
    : systemPrompt;

  if (sysText.trim().length > 0) {
    sections.push(sysText.trim());
  }

  for (const frame of context) {
    const content =
      typeof frame.content === 'string'
        ? frame.content
        : JSON.stringify(frame.content);
    const trimmed = content.trim();
    if (trimmed.length > 0) {
      sections.push(`${frame.role}: ${trimmed}`);
    }
  }

  if (toolDefinitions && toolDefinitions.length > 0) {
    sections.push(`Available tools:\n${JSON.stringify(toolDefinitions, null, 2)}`);
  }

  return sections.join('\n\n');
}

function createGithubCopilotCliAdapter(): ProviderAdapter {
  return {
    capabilities: GITHUB_COPILOT_CLI_ADAPTER_CAPABILITIES,

    formatRequest(input: AdapterFormatInput): AdapterFormattedRequest {
      return {
        input: {
          prompt: renderGhCopilotPrompt(
            input.systemPrompt,
            input.context,
            input.toolDefinitions,
          ),
        },
      };
    },

    parseResponse(output: unknown, _traceId: TraceId): ParsedModelOutput {
      try {
        const raw =
          typeof output === 'string'
            ? output
            : output == null
              ? ''
              : String(output);
        const cleaned = raw.replace(ANSI_RE, '');
        return {
          response: cleaned,
          toolCalls: [],
          memoryCandidates: [],
          contentType: 'text',
        };
      } catch {
        return {
          response: '',
          toolCalls: [],
          memoryCandidates: [],
          contentType: 'text',
        };
      }
    },
  };
}

// Validate the module shape at import time — throws if capabilities or keys
// are mismatched. Result is used to source `adapterKey` for the export.
const _providerAdapterModule = defineProviderAdapter({
  adapterKey: 'github-copilot-cli',
  displayName: 'GitHub Copilot CLI',
  protocol: AGENT_CLI_PROTOCOL_ID,
  capabilities: GITHUB_COPILOT_CLI_ADAPTER_CAPABILITIES,
  executionCapabilityProfile: GITHUB_COPILOT_CLI_EXECUTION_CAPABILITY_PROFILE,
  create() {
    return createGithubCopilotCliAdapter();
  },
});

/**
 * Combined export — module metadata + adapter instance methods.
 *
 * Merges `adapterKey` from the validated module with the `ProviderAdapter`
 * interface (capabilities, formatRequest, parseResponse) so that both the
 * provider registry and direct test access work without extra indirection.
 */
export const providerAdapter = Object.assign(
  createGithubCopilotCliAdapter(),
  { adapterKey: _providerAdapterModule.adapterKey },
);

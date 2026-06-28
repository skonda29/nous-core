import { execFileSync, spawn } from 'node:child_process';
import { NousError, ValidationError } from '@nous/shared';
import type {
  IModelProvider,
  ModelProviderConfig,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ProviderId,
} from '@nous/shared';
import {
  createAgentCliProviderAdapter,
  normalizeAgentCliRunResult,
  type AgentCliFailure,
  type AgentCliInvocation,
  type AgentCliInvocationDefaults,
  type AgentCliRawResult,
  type AgentCliRunResult,
  type AgentCliRunner,
  type AgentCliRunnerOptions,
  type AgentCliStreamEvent,
} from '../../protocols/agent-cli/index.js';
import { TextModelInputSchema, type TextModelInput } from '../../schemas/text-model-input.js';
import {
  OPENCLAW_DEFAULT_MODEL_ID,
  OPENCLAW_DEFAULT_TIMEOUT_MS,
  OPENCLAW_MAX_TIMEOUT_MS,
  OPENCLAW_PROVIDER_DEFINITION,
} from './definition.js';

const OPENCLAW_NOUS_BIN_ENV = 'NOUS_OPENCLAW_CLI_BIN';
const OPENCLAW_BIN_ENV = 'OPENCLAW_CLI_BIN';

export interface OpenClawProviderOptions {
  readonly runner?: AgentCliRunner;
  readonly runnerOptions?: AgentCliRunnerOptions;
  readonly executable?: string;
}

/**
 * Resolves a bare command name to one or more absolute candidates (one per
 * line, `where.exe`/`which` style). Injected in tests so executable resolution
 * never shells out to the host.
 */
export type OpenClawCommandResolver = (
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv },
) => string;

export interface OpenClawProcessRunnerOptions {
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly commandResolver?: OpenClawCommandResolver;
  /** Override for `cmd.exe` (defaults to `%ComSpec%`); used only for `.cmd`/`.bat` shims. */
  readonly comspec?: string;
}

/**
 * OpenClaw's runner options extend the shared agent-cli options with a *live*
 * `AbortSignal`. The shared {@link AgentCliRunnerOptions.signal} is only a
 * pre-start snapshot (`{ aborted }`); the live signal lets the process runner
 * kill the child after it has spawned. The agent-cli adapter forwards runner
 * options verbatim, so the extra field reaches {@link createOpenClawProcessRunner}.
 */
export type OpenClawRunnerOptions = AgentCliRunnerOptions & {
  readonly abortSignal?: AbortSignal;
};

/** Literal-argv spawn plan — never a shell command string. */
export interface OpenClawSpawnPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments: boolean;
}

export const OPENCLAW_INVOCATION_DEFAULTS: AgentCliInvocationDefaults = {
  command: {
    executable: OPENCLAW_PROVIDER_DEFINITION.agentCli.command.executable,
    defaultArgs: OPENCLAW_PROVIDER_DEFINITION.agentCli.command.defaultArgs,
  },
  headless: {
    supported: OPENCLAW_PROVIDER_DEFINITION.agentCli.headless.supported,
    requiredArgs: OPENCLAW_PROVIDER_DEFINITION.agentCli.headless.requiredArgs,
    nonInteractiveEnv: OPENCLAW_PROVIDER_DEFINITION.agentCli.headless.nonInteractiveEnv,
  },
  timeout: {
    defaultMs: OPENCLAW_DEFAULT_TIMEOUT_MS,
    maxMs: OPENCLAW_MAX_TIMEOUT_MS,
  },
};

export const OPENCLAW_AGENT_ADAPTER = createAgentCliProviderAdapter({
  defaults: OPENCLAW_INVOCATION_DEFAULTS,
});

export function createOpenClawInvocationDefaults(
  executable: string = OPENCLAW_PROVIDER_DEFINITION.agentCli.command.executable,
): AgentCliInvocationDefaults {
  return {
    ...OPENCLAW_INVOCATION_DEFAULTS,
    command: {
      ...OPENCLAW_INVOCATION_DEFAULTS.command,
      executable,
    },
  };
}

export class OpenClawProvider implements IModelProvider {
  private readonly config: ModelProviderConfig;
  private readonly runner: AgentCliRunner;
  private readonly runnerOptions: AgentCliRunnerOptions | undefined;
  private readonly agentAdapter: typeof OPENCLAW_AGENT_ADAPTER;

  constructor(config: ModelProviderConfig, options?: OpenClawProviderOptions) {
    this.config = config;
    this.runner = options?.runner ?? createOpenClawProcessRunner();
    this.runnerOptions = options?.runnerOptions;
    const executable = selectOpenClawExecutable({
      explicitExecutable: options?.executable,
    });
    this.agentAdapter = createAgentCliProviderAdapter({
      defaults: createOpenClawInvocationDefaults(executable),
    });
  }

  getConfig(): ModelProviderConfig {
    return this.config;
  }

  async invoke(request: ModelRequest): Promise<ModelResponse> {
    const input = this.validateInput(request.input);
    const start = Date.now();

    const result = await this.agentAdapter.invoke(
      {
        args: this.invocationArgs(),
        input: renderTextModelInput(input),
        metadata: {
          provider: 'openclaw',
          providerId: this.config.id,
          modelId: this.config.modelId,
          traceId: request.traceId,
        },
        runnerOptions: this.mergeRunnerOptions(request),
      },
      this.runner,
    );

    if (!result.ok) {
      throw toProviderError(result.failure, result.stderr, result.stdout);
    }

    return {
      output: result.stdout.trimEnd(),
      providerId: this.config.id as ProviderId,
      usage: {
        computeMs: result.durationMs ?? Date.now() - start,
      },
      traceId: request.traceId,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const input = this.validateInput(request.input);
    let emittedContent = false;
    let finalResult: AgentCliRunResult | undefined;

    try {
      const events = this.agentAdapter.stream(
        {
          args: this.invocationArgs(),
          input: renderTextModelInput(input),
          metadata: {
            provider: 'openclaw',
            providerId: this.config.id,
            modelId: this.config.modelId,
            traceId: request.traceId,
          },
          runnerOptions: this.mergeRunnerOptions(request),
        },
        this.runner,
      );

      for await (const event of events) {
        if (event.stream === 'system') {
          finalResult = event.result;
          continue;
        }

        if (event.stream !== 'stdout' || event.text.length === 0) continue;

        emittedContent = true;
        yield { content: event.text, done: false };
      }

      if (finalResult === undefined) {
        throw new NousError(
          'OpenClaw streaming ended without a process result.',
          'PROVIDER_UNAVAILABLE',
          { provider: 'openclaw', failureKind: 'unknown' },
        );
      }

      if (!finalResult.ok) {
        throw toProviderError(finalResult.failure, finalResult.stderr, finalResult.stdout);
      }

      if (!emittedContent && finalResult.stdout.trimEnd().length > 0) {
        yield { content: finalResult.stdout.trimEnd(), done: false };
      }

      yield { content: '', done: true };
    } catch (error) {
      if (error instanceof NousError) throw error;
      throw new NousError(
        `OpenClaw streaming failed: ${error instanceof Error ? error.message : String(error)}`,
        'PROVIDER_UNAVAILABLE',
        { provider: 'openclaw', failureKind: 'unknown' },
      );
    }
  }

  private validateInput(input: unknown): TextModelInput {
    const result = TextModelInputSchema.safeParse(input);
    if (!result.success) {
      throw new ValidationError(
        'Invalid OpenClaw provider input',
        result.error.errors.map((error) => ({
          path: error.path.join('.'),
          message: error.message,
        })),
      );
    }
    return result.data;
  }

  private invocationArgs(): readonly string[] {
    if (
      this.config.modelId.length === 0 ||
      this.config.modelId === OPENCLAW_DEFAULT_MODEL_ID
    ) {
      return [];
    }
    return ['--model', this.config.modelId];
  }

  private mergeRunnerOptions(request: ModelRequest): OpenClawRunnerOptions | undefined {
    const abortSignal = request.abortSignal;
    // Keep the pre-start snapshot for the shared contract, but also forward the
    // live signal so the runner can kill the child after spawn (post-start abort).
    const signal = abortSignal
      ? { aborted: abortSignal.aborted }
      : this.runnerOptions?.signal;

    if (!signal && !abortSignal && !this.runnerOptions) {
      return undefined;
    }

    return {
      ...this.runnerOptions,
      ...(signal ? { signal } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    };
  }
}

export function selectOpenClawExecutable(
  options: {
    readonly explicitExecutable?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): string {
  const env = options.env ?? process.env;
  return options.explicitExecutable
    ?? env[OPENCLAW_NOUS_BIN_ENV]
    ?? env[OPENCLAW_BIN_ENV]
    ?? OPENCLAW_PROVIDER_DEFINITION.agentCli.command.executable;
}

export function createOpenClawProcessRunner(
  options: OpenClawProcessRunnerOptions = {},
): AgentCliRunner {
  return {
    async run(invocation, runnerOptions) {
      return normalizeAgentCliRunResult(
        await runOpenClawProcessRaw(invocation, runnerOptions, options),
      );
    },
    async *stream(invocation, runnerOptions) {
      const queue: AgentCliStreamEvent[] = [];
      let wake: (() => void) | undefined;
      let completed = false;

      const push = (event: AgentCliStreamEvent): void => {
        queue.push(event);
        wake?.();
        wake = undefined;
      };

      const waitForEvent = (): Promise<void> => {
        if (queue.length > 0 || completed) return Promise.resolve();
        return new Promise((resolve) => {
          wake = resolve;
        });
      };

      void runOpenClawProcessRaw(invocation, runnerOptions, options, (event) => {
        push(event);
      }).then((rawResult) => {
        push({ stream: 'system', result: normalizeAgentCliRunResult(rawResult) });
      }).finally(() => {
        completed = true;
        wake?.();
        wake = undefined;
      });

      while (!completed || queue.length > 0) {
        await waitForEvent();
        while (queue.length > 0) {
          yield queue.shift()!;
        }
      }
    },
  };
}

function runOpenClawProcessRaw(
  invocation: AgentCliInvocation,
  runnerOptions: OpenClawRunnerOptions | undefined,
  options: OpenClawProcessRunnerOptions,
  onTranscriptEvent?: (event: AgentCliStreamEvent) => void,
): Promise<AgentCliRawResult> {
  const startedAt = Date.now();
  const abortSignal = runnerOptions?.abortSignal;
  if (runnerOptions?.signal?.aborted || abortSignal?.aborted) {
    return Promise.resolve({
      startedAt,
      endedAt: Date.now(),
      error: new Error('Agent CLI invocation aborted before start.'),
    });
  }

  return new Promise((resolve) => {
    let child;
    try {
      const env = buildProcessEnv(invocation.command.env, runnerOptions, options);
      // Never run user-controlled args (model id, prompt-derived values) through
      // a shell: resolve the executable and pass args as a literal argv array so
      // shell metacharacters can never be interpreted (Windows command injection).
      const plan = planOpenClawSpawn(
        invocation.command.executable,
        invocation.command.args ?? [],
        { platform: options.platform, commandResolver: options.commandResolver, env, comspec: options.comspec },
      );
      child = spawn(plan.command, [...plan.args], {
        cwd: invocation.command.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
      });
    } catch (error) {
      resolve({ error, startedAt, endedAt: Date.now() });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const timeout = invocation.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, invocation.timeoutMs);

    // Live abort: once the process is running, terminate it if the caller cancels.
    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGTERM');
    };
    if (abortSignal) {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', onAbort);
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      onTranscriptEvent?.({ stream: 'stdout', text: chunk, timestamp: new Date().toISOString() });
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      onTranscriptEvent?.({ stream: 'stderr', text: chunk, timestamp: new Date().toISOString() });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, error, timedOut, startedAt, endedAt: Date.now() });
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (aborted) {
        resolve({
          stdout,
          stderr,
          signal,
          error: new Error('Agent CLI invocation aborted.'),
          startedAt,
          endedAt: Date.now(),
        });
        return;
      }
      resolve({ exitCode, signal, stdout, stderr, timedOut, startedAt, endedAt: Date.now() });
    });

    child.stdin.end(invocation.input ?? '');
  });
}

/**
 * Builds a literal-argv spawn plan. The returned `command`/`args` are always
 * passed to `spawn` with `shell: false`, so user-controlled values can never be
 * interpreted by a shell.
 *
 * - POSIX / native Windows executables: spawn the resolved path directly with
 *   the args as a literal argv array.
 * - Windows `.cmd`/`.bat` shims: Node refuses to spawn these without a shell, so
 *   they are routed through `cmd.exe /d /s /c` with every argument explicitly
 *   escaped (`windowsVerbatimArguments: true`), keeping shell metacharacters
 *   inert rather than relying on `shell: true` to join the whole command line.
 */
export function planOpenClawSpawn(
  executable: string,
  args: readonly string[],
  options: {
    readonly platform?: NodeJS.Platform;
    readonly commandResolver?: OpenClawCommandResolver;
    readonly env?: NodeJS.ProcessEnv;
    readonly comspec?: string;
  } = {},
): OpenClawSpawnPlan {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { command: executable, args: [...args], windowsVerbatimArguments: false };
  }

  const resolved = resolveWindowsExecutable(executable, options);
  if (/\.(cmd|bat)$/i.test(resolved)) {
    const comspec = options.comspec ?? process.env.ComSpec ?? 'cmd.exe';
    return {
      command: comspec,
      args: ['/d', '/s', '/c', escapeCmdArg(resolved), ...args.map(escapeCmdArg)],
      windowsVerbatimArguments: true,
    };
  }

  return { command: resolved, args: [...args], windowsVerbatimArguments: false };
}

/**
 * Resolves a bare `openclaw` command name to a concrete Windows path via
 * `where.exe`, preferring a native `.exe`/`.com` over a `.cmd`/`.bat` shim so we
 * can spawn directly without a shell whenever possible. An explicit path (one
 * that differs from the default executable) is used verbatim.
 */
function resolveWindowsExecutable(
  executable: string,
  options: {
    readonly commandResolver?: OpenClawCommandResolver;
    readonly env?: NodeJS.ProcessEnv;
  },
): string {
  if (executable !== OPENCLAW_PROVIDER_DEFINITION.agentCli.command.executable) {
    return executable;
  }

  const resolver = options.commandResolver ?? defaultCommandResolver;
  let candidates: readonly string[];
  try {
    candidates = resolver('where.exe', [executable], { env: options.env })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    candidates = [];
  }

  const nativeExecutable = candidates.find((candidate) => /\.(exe|com)$/i.test(candidate));
  return nativeExecutable ?? candidates[0] ?? executable;
}

function defaultCommandResolver(
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv },
): string {
  return execFileSync(command, [...args], { encoding: 'utf8', env: options.env });
}

/**
 * Escapes a single argument for `cmd.exe`: wraps it in double quotes (doubling
 * embedded quotes) and caret-escapes the metacharacters cmd would otherwise
 * interpret. Used only on the `.cmd`/`.bat` shim path.
 */
function escapeCmdArg(arg: string): string {
  const quoted = `"${arg.replace(/"/g, '""')}"`;
  return quoted.replace(/[()%!^"<>&|]/g, '^$&');
}

function buildProcessEnv(
  invocationEnv: Readonly<Record<string, string>> | undefined,
  runnerOptions: AgentCliRunnerOptions | undefined,
  options: OpenClawProcessRunnerOptions,
): NodeJS.ProcessEnv {
  const baseEnv = options.baseEnv ?? process.env;
  const policy = runnerOptions?.environmentPolicy;
  const env: NodeJS.ProcessEnv = {};

  if (!policy || policy.mergeStrategy === 'explicit') {
    assignDefinedEnv(env, baseEnv);
  } else if (policy.mergeStrategy === 'allowlist') {
    for (const key of policy.allowlist ?? []) {
      const value = baseEnv[key];
      if (value !== undefined && isValidEnvKey(key)) env[key] = value;
    }
  }

  assignDefinedEnv(env, policy?.env);
  assignDefinedEnv(env, invocationEnv);
  return env;
}

function assignDefinedEnv(
  target: NodeJS.ProcessEnv,
  source: Readonly<Record<string, string | undefined>> | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && isValidEnvKey(key)) {
      target[key] = value;
    }
  }
}

function isValidEnvKey(key: string): boolean {
  return key.length > 0 && !key.includes('=');
}

function renderTextModelInput(input: TextModelInput): string {
  if ('prompt' in input) {
    return input.prompt;
  }

  const sections: string[] = [];
  if (typeof input.system === 'string' && input.system.trim().length > 0) {
    sections.push(input.system.trim());
  } else if (Array.isArray(input.system) && input.system.length > 0) {
    sections.push(JSON.stringify(input.system, null, 2));
  }

  for (const message of input.messages) {
    sections.push(`${message.role}: ${renderMessageContent(message.content)}`);
  }

  if (input.tools && input.tools.length > 0) {
    sections.push(`Available tools:\n${JSON.stringify(input.tools, null, 2)}`);
  }

  return sections.join('\n\n');
}

function renderMessageContent(content: string | readonly unknown[]): string {
  return typeof content === 'string'
    ? content
    : JSON.stringify(content, null, 2);
}

function toProviderError(
  failure: AgentCliFailure | undefined,
  stderr?: string,
  stdout?: string,
): NousError {
  if (!failure) {
    return new NousError(
      'OpenClaw invocation failed.',
      'PROVIDER_UNAVAILABLE',
      { provider: 'openclaw', stderr, stdout },
    );
  }

  return new NousError(
    stderr && stderr.trim().length > 0
      ? `${failure.message} ${stderr.trim().slice(0, 500)}`
      : failure.message,
    failure.kind === 'auth' ? 'PROVIDER_ERROR' : 'PROVIDER_UNAVAILABLE',
    {
      provider: 'openclaw',
      failureKind: failure.kind,
      exitCode: failure.exitCode,
      signal: failure.signal,
      timedOut: failure.timedOut,
      stderr,
      stdout,
    },
  );
}

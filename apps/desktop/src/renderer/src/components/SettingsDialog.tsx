import {
  Bot,
  Bug,
  Cable,
  Gamepad2,
  Info,
  KeyRound,
  Puzzle,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DoctorReport, PluginInfo, SettingsPatch } from '@shared/api';
import { call } from '../api';
import { detectEngine, refreshSettings, showError, toast } from '../actions';
import { store, useStore } from '../store';
import { Modal, Spinner } from './ui';

const SECTIONS = [
  ['ai', 'AI Provider', Bot],
  ['godot', 'Godot', Gamepad2],
  ['agents', 'Agents', Users],
  ['mcp', 'MCP Server', Cable],
  ['plugins', 'Plugins', Puzzle],
  ['privacy', 'Privacy & Security', ShieldCheck],
  ['doctor', 'Doctor', Stethoscope],
  ['about', 'About', Info],
] as const;

function useSave() {
  return async (patch: SettingsPatch) => {
    try {
      store.set({ settings: await call('settings:save', patch) });
    } catch (error) {
      showError(error, 'Could not save settings');
    }
  };
}

function KeyField({ provider, envName }: { provider: 'anthropic' | 'openai'; envName: string }) {
  const settings = useStore((s) => s.settings)!;
  const state = provider === 'anthropic' ? settings.anthropic : settings.openai;
  const [value, setValue] = useState('');
  const saveKey = async (key: string | null) => {
    try {
      store.set({ settings: await call('settings:set-key', provider, key) });
      setValue('');
      toast('success', key ? 'API key saved (encrypted)' : 'API key removed');
    } catch (error) {
      showError(error, 'Could not save the key');
    }
  };
  return (
    <div className="field">
      <label>
        <KeyRound size={12} /> API key
      </label>
      {state.keySource === 'env' ? (
        <div className="hint">Using {envName} from the environment.</div>
      ) : (
        <div className="row">
          <input
            className="input mono"
            type="password"
            autoComplete="off"
            placeholder={state.hasKey ? '•••••••• (stored in the OS keychain)' : 'Paste your key'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="API key"
          />
          <button
            className="btn"
            disabled={!value.trim() || !settings.secureStorage}
            onClick={() => saveKey(value.trim())}
          >
            Save
          </button>
          {state.hasKey && (
            <button className="btn danger" onClick={() => saveKey(null)}>
              Remove
            </button>
          )}
        </div>
      )}
      <div className="hint">
        {settings.secureStorage
          ? 'Keys are encrypted with your operating system keychain and never leave this machine except to call the provider.'
          : `No secure keychain is available — set ${envName} as an environment variable instead.`}
      </div>
    </div>
  );
}

function AiSection() {
  const settings = useStore((s) => s.settings)!;
  const save = useSave();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await call('settings:test-provider'));
    } finally {
      setTesting(false);
    }
  };
  return (
    <>
      <h3>AI Provider</h3>
      <p className="section-lead">
        Bring your own provider. GameForge talks to it directly — there is no GameForge server.
      </p>
      <div className="field">
        <label htmlFor="provider">Provider</label>
        <select
          id="provider"
          className="select"
          value={settings.provider ?? ''}
          onChange={(e) => save({ provider: e.target.value || null })}
          data-testid="provider-select"
        >
          <option value="">— Select —</option>
          {settings.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
        <div className="hint">
          {settings.providers.find((p) => p.id === settings.provider)?.description}
        </div>
      </div>
      {settings.provider === 'anthropic' && (
        <>
          <KeyField provider="anthropic" envName="ANTHROPIC_API_KEY" />
          <div className="row">
            <div className="field grow">
              <label>Model</label>
              <input
                className="input mono"
                defaultValue={settings.anthropic.model}
                onBlur={(e) => save({ anthropic: { model: e.target.value.trim() } })}
              />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Effort</label>
              <select
                className="select"
                value={settings.anthropic.effort}
                onChange={(e) => save({ anthropic: { effort: e.target.value } })}
              >
                {['default', 'low', 'medium', 'high', 'xhigh', 'max'].map((effort) => (
                  <option key={effort}>{effort}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="checkbox" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={settings.anthropic.fallbacks}
              onChange={(e) => save({ anthropic: { fallbacks: e.target.checked } })}
            />
            Server-side refusal fallback (retries a declined request on Anthropic's recommended
            fallback model)
          </label>
        </>
      )}
      {settings.provider === 'openai-compatible' && (
        <>
          <KeyField provider="openai" envName="OPENAI_API_KEY" />
          <div className="field">
            <label>Base URL</label>
            <input
              className="input mono"
              defaultValue={settings.openai.baseUrl}
              onBlur={(e) => save({ openai: { baseUrl: e.target.value.trim() } })}
            />
            <div className="hint">
              OpenAI, OpenRouter, Groq, Together, LM Studio (http://localhost:1234/v1), vLLM,
              llama.cpp …
            </div>
          </div>
          <div className="field">
            <label>Model</label>
            <input
              className="input mono"
              defaultValue={settings.openai.model}
              placeholder="model id"
              onBlur={(e) => save({ openai: { model: e.target.value.trim() } })}
            />
          </div>
          <label className="checkbox" style={{ marginBottom: 14 }}>
            <input
              type="checkbox"
              checked={settings.openai.jsonMode}
              onChange={(e) => save({ openai: { jsonMode: e.target.checked } })}
            />
            Server supports JSON schema response_format
          </label>
        </>
      )}
      {settings.provider === 'ollama' && (
        <>
          <div className="field">
            <label>Ollama URL</label>
            <input
              className="input mono"
              defaultValue={settings.ollama.baseUrl}
              onBlur={(e) => save({ ollama: { baseUrl: e.target.value.trim() } })}
            />
          </div>
          <div className="field">
            <label>Model</label>
            <input
              className="input mono"
              defaultValue={settings.ollama.model}
              placeholder="e.g. a tool-capable model from `ollama list`"
              onBlur={(e) => save({ ollama: { model: e.target.value.trim() } })}
            />
            <div className="hint">
              Use a model with tool calling support for the code-writing agents.
            </div>
          </div>
        </>
      )}
      {settings.provider === 'mock' && (
        <div className="callout warn" style={{ marginBottom: 14 }}>
          The mock provider is for trying and testing GameForge. It plans games with a keyword-based
          planner and does not write code.
        </div>
      )}
      <div className="row">
        <button
          className="btn"
          onClick={() => test()}
          disabled={testing || !settings.provider}
          data-testid="test-provider"
        >
          {testing ? <Spinner /> : null} Test connection
        </button>
        {result && <span className={result.ok ? 'add' : 'del'}>{result.message}</span>}
      </div>
    </>
  );
}

function GodotSection() {
  const settings = useStore((s) => s.settings)!;
  const engine = useStore((s) => s.engine);
  const save = useSave();
  const [detecting, setDetecting] = useState(false);
  return (
    <>
      <h3>Godot</h3>
      <p className="section-lead">
        GameForge generates Godot 4.3+ projects and uses Godot to run, validate and test them. It
        never installs software for you.
      </p>
      <div className="callout" style={{ marginBottom: 14 }}>
        <Gamepad2 size={16} color={engine ? 'var(--green)' : 'var(--yellow)'} />
        <div>
          <div className="title">{engine ? `Godot ${engine.version}` : 'Godot not detected'}</div>
          <div className="mono faint" style={{ fontSize: 11.5 }}>
            {engine
              ? `${engine.executable} (via ${engine.source})`
              : 'Install Godot 4.3 or newer, then detect or select it.'}
          </div>
        </div>
      </div>
      <div className="field">
        <label>Executable</label>
        <div className="row">
          <input
            className="input mono"
            defaultValue={settings.godot.executable ?? ''}
            placeholder="auto-detect (PATH, GODOT_PATH, common locations)"
            onBlur={async (e) => {
              await save({ godot: { executable: e.target.value.trim() || null } });
              await detectEngine();
            }}
          />
          <button
            className="btn"
            onClick={async () => {
              const exe = await call('dialog:select-godot');
              if (exe) {
                await refreshSettings();
                await detectEngine();
              }
            }}
          >
            Browse
          </button>
        </div>
      </div>
      <div className="row">
        <button
          className="btn"
          onClick={async () => {
            setDetecting(true);
            await detectEngine();
            setDetecting(false);
          }}
        >
          {detecting ? <Spinner /> : null} Detect again
        </button>
        <button
          className="btn ghost"
          onClick={() => call('app:open-external', 'https://godotengine.org/download')}
        >
          Install guide (godotengine.org)
        </button>
      </div>
    </>
  );
}

function AgentsSection() {
  const settings = useStore((s) => s.settings)!;
  const save = useSave();
  return (
    <>
      <h3>Agents</h3>
      <p className="section-lead">How the agent team applies changes.</p>
      <div className="field">
        <label>Change mode</label>
        <select
          className="select"
          value={settings.agents.changeMode}
          onChange={(e) => save({ agents: { changeMode: e.target.value as 'staged' | 'direct' } })}
        >
          <option value="staged">
            Staged — review diffs before anything is written (recommended)
          </option>
          <option value="direct">Direct — write immediately, review and undo afterwards</option>
        </select>
      </div>
      <div className="field" style={{ width: 200 }}>
        <label>Max steps per agent task</label>
        <input
          className="input"
          type="number"
          min={1}
          max={200}
          defaultValue={settings.agents.maxSteps}
          onBlur={(e) => save({ agents: { maxSteps: Number(e.target.value) || 40 } })}
        />
      </div>
      <p className="hint">
        Destructive actions, Godot runs and unknown programs always ask for confirmation. Shell,
        network and system tools are blocked for agents.
      </p>
    </>
  );
}

function McpSection() {
  const settings = useStore((s) => s.settings)!;
  const save = useSave();
  const snippet = JSON.stringify(
    {
      mcpServers: {
        gameforge: { command: 'gameforge', args: ['mcp', '--project', '/path/to/your/game'] },
      },
    },
    null,
    2,
  );
  return (
    <>
      <h3>MCP Server</h3>
      <p className="section-lead">
        Let MCP clients such as Claude Desktop or Claude Code use GameForge tools on a project
        (Claude → MCP → GameForge → game). Optional and off by default.
      </p>
      <label className="checkbox" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={settings.mcp.enabled}
          onChange={(e) => save({ mcp: { enabled: e.target.checked } })}
          data-testid="mcp-enabled"
        />{' '}
        Enable the MCP server
      </label>
      <label className="checkbox" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={settings.mcp.allowWrite}
          disabled={!settings.mcp.enabled}
          onChange={(e) => save({ mcp: { allowWrite: e.target.checked } })}
        />{' '}
        Allow MCP clients to write files and run Godot
      </label>
      <div className="field">
        <label>Client configuration</label>
        <textarea className="textarea mono" readOnly value={snippet} style={{ minHeight: 140 }} />
        <div className="hint">
          Requires the gameforge CLI on your PATH (see the README). The server only sees the project
          you pass with --project.
        </div>
      </div>
    </>
  );
}

function PluginsSection() {
  const info = useStore((s) => s.info);
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  useEffect(() => {
    void call('plugins:list').then(setPlugins);
  }, []);
  return (
    <>
      <h3>Plugins</h3>
      <p className="section-lead">
        Engines, tools, AI providers and agents can be added as plugins. Third-party plugins run
        with full access to your computer — only enable plugins you trust. Changes apply after a
        restart.
      </p>
      {!plugins && <Spinner />}
      {plugins?.map((plugin) => (
        <div key={plugin.id} className="check-row">
          <Puzzle size={14} className="muted" />
          <div className="grow">
            <div>
              {plugin.name} <span className="faint">{plugin.version}</span>{' '}
              {plugin.builtin && <span className="badge">built-in</span>}
            </div>
            <div className="hint">
              {plugin.error ??
                plugin.description ??
                [
                  ...plugin.contributes.engines,
                  ...plugin.contributes.tools,
                  ...plugin.contributes.providers,
                ].join(', ')}
            </div>
          </div>
          {plugin.status === 'failed' && <span className="badge red">failed</span>}
          {!plugin.builtin && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={plugin.status !== 'disabled'}
                onChange={async (e) =>
                  setPlugins(await call('plugins:set-enabled', plugin.id, e.target.checked))
                }
              />
              Enabled
            </label>
          )}
        </div>
      ))}
      <p className="hint" style={{ marginTop: 12 }}>
        Plugin folder: <span className="mono">{info?.pluginDir}</span>
      </p>
    </>
  );
}

function DoctorSection() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState(false);
  const run = async (online: boolean) => {
    setRunning(true);
    try {
      setReport(await call('doctor:run', online));
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    void run(false);
  }, []);
  return (
    <>
      <h3>GameForge Doctor</h3>
      <p className="section-lead">
        Checks Node.js, Git, Godot, the AI provider, the environment and permissions.
      </p>
      {report?.checks.map((check) => (
        <div key={check.id} className="check-row">
          <span
            className={`status-dot ${check.status === 'ok' ? 'ok' : check.status === 'warn' ? 'warn' : check.status === 'fail' ? 'error' : ''}`}
          />
          <span style={{ width: 120 }}>{check.label}</span>
          <span className="grow faint" style={{ fontSize: 12 }}>
            {check.detail}
            {check.solution && check.status !== 'ok' && (
              <div style={{ color: 'var(--text-muted)' }}>→ {check.solution}</div>
            )}
          </span>
        </div>
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => run(false)} disabled={running}>
          {running ? <Spinner /> : null} Run again
        </button>
        <button
          className="btn"
          onClick={() => run(true)}
          disabled={running}
          title="Also contacts the AI provider"
        >
          Test online
        </button>
        {report && (
          <span className={report.ready ? 'add' : 'muted'}>
            {report.ready ? 'Everything is ready.' : 'Some checks need attention.'}
          </span>
        )}
      </div>
    </>
  );
}

function PrivacySection() {
  return (
    <>
      <h3>Privacy & Security</h3>
      <p className="section-lead">GameForge is local-first.</p>
      <ul style={{ paddingLeft: 18, lineHeight: 1.8, marginTop: 0 }}>
        <li>No analytics, no tracking, no telemetry, no account.</li>
        <li>
          Nothing is sent to XyoLua. Only your configured AI provider receives the prompts and file
          contents agents need.
        </li>
        <li>
          Agents work in a sandbox limited to the open project; .env files, SSH and other keys are
          never readable.
        </li>
        <li>
          Secrets are removed from tool output and logs, and from the environment of every process
          agents start.
        </li>
        <li>
          Commands run without a shell, with an allowlist, timeouts and output limits; risky actions
          ask you first.
        </li>
        <li>
          AI-generated code is treated as untrusted: running the game or tests executes it on your
          machine.
        </li>
        <li>GameForge never pushes to a git remote on its own.</li>
      </ul>
      <button
        className="btn"
        onClick={() =>
          call(
            'app:open-external',
            'https://github.com/xyoluastudios/xyolua-gameforge/blob/main/docs/security.md',
          )
        }
      >
        <Bug size={13} /> Read the security model
      </button>
    </>
  );
}

function AboutSection() {
  const info = useStore((s) => s.info);
  return (
    <>
      <h3>XyoLua GameForge {info?.version}</h3>
      <p className="section-lead">
        Open-source AI game development environment by XyoLua Studios. Licensed under Apache-2.0.
      </p>
      <div className="hint">
        Config: <span className="mono">{info?.configDir}</span>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            call('app:open-external', 'https://github.com/xyoluastudios/xyolua-gameforge')
          }
        >
          GitHub
        </button>
        <button
          className="btn"
          onClick={() =>
            call('app:open-external', 'https://github.com/xyoluastudios/xyolua-gameforge/issues')
          }
        >
          Report an issue
        </button>
      </div>
    </>
  );
}

export function SettingsDialog() {
  const dialog = useStore((s) => s.dialogs.settings);
  const settings = useStore((s) => s.settings);
  const [section, setSection] = useState<string>('ai');
  useEffect(() => {
    if (dialog.open) {
      setSection(dialog.section ?? 'ai');
      void refreshSettings();
    }
  }, [dialog.open, dialog.section]);
  if (!dialog.open || !settings) return null;
  const close = () => store.set((s) => ({ dialogs: { ...s.dialogs, settings: { open: false } } }));
  return (
    <Modal title="Settings" onClose={close} size="wide" testId="settings-dialog">
      <div className="settings-layout" style={{ margin: -18 }}>
        <nav className="settings-nav">
          {SECTIONS.map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === 'ai' && <AiSection />}
          {section === 'godot' && <GodotSection />}
          {section === 'agents' && <AgentsSection />}
          {section === 'mcp' && <McpSection />}
          {section === 'plugins' && <PluginsSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'doctor' && <DoctorSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </Modal>
  );
}

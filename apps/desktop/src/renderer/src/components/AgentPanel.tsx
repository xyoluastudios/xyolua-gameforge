import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDashed,
  FileDiff,
  MessageSquarePlus,
  Send,
  Square,
  Wrench,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  cancelAI,
  applyChanges,
  discardChanges,
  newChat,
  openSettings,
  reviewChanges,
  sendChat,
} from '../actions';
import { AGENT_IDS, useStore, type ChatItem } from '../store';
import { ErrorCallout, Spinner } from './ui';

const SHORT_NAMES: Record<string, string> = {
  orchestrator: 'Manager',
  'game-designer': 'Designer',
  programmer: 'Programmer',
  'level-designer': 'Levels',
  'asset-manager': 'Assets',
  'audio-designer': 'Audio',
  qa: 'QA',
};

const SUGGESTIONS_NO_PROJECT = [
  'Create a 3D horror game in an abandoned hospital',
  'Create a 2D top-down dungeon game',
];
const SUGGESTIONS = [
  'Run all tests',
  'Make the monster faster',
  'Add a stamina system for sprinting',
  'Explain the player script',
  'Fix all critical issues',
  'Analyze the project',
];

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Spinner />;
  if (status === 'done') return <CheckCircle2 size={14} color="var(--green)" />;
  if (status === 'failed') return <XCircle size={14} color="var(--red)" />;
  return <CircleDashed size={14} color="var(--text-faint)" />;
}

function ChatEntry({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return <div className="msg user">{item.text}</div>;
    case 'agent':
      return (
        <div className={`msg agent ${item.parentRunId ? 'nested' : ''}`}>
          <div className="who">
            <Bot size={13} color={item.status === 'working' ? 'var(--accent)' : undefined} />
            {item.agentName}
            {item.status === 'working' && <Spinner />}
            {item.status !== 'working' && item.status !== 'done' && (
              <span className="badge red">{item.status.replace('_', ' ')}</span>
            )}
          </div>
          {item.tools.map((tool) => (
            <div key={tool.callId} className={`tool-line ${tool.ok === false ? 'failed' : ''}`}>
              {tool.ok === undefined ? (
                <Spinner />
              ) : tool.ok ? (
                <Wrench size={11} />
              ) : (
                <XCircle size={11} />
              )}
              {tool.tool}
              {tool.detail ? <span className="ellipsis">{tool.detail}</span> : null}
            </div>
          ))}
          {item.text && <div className="body">{item.text}</div>}
        </div>
      );
    case 'step':
      return (
        <div className="step-line">
          <StepIcon status={item.status} />
          <span className="agent">{item.agent}</span>
          <span>
            {item.label}
            {item.detail && <div className="detail">{item.detail}</div>}
          </span>
        </div>
      );
    case 'notice':
      return (
        <div
          className={`callout ${item.level === 'error' ? 'error' : item.level === 'warn' ? 'warn' : item.level === 'success' ? 'success' : ''}`}
          style={{ whiteSpace: 'pre-wrap' }}
        >
          {item.text}
        </div>
      );
    case 'error':
      return <ErrorCallout error={item.error} />;
    case 'changes':
      return (
        <ChangesCard
          count={item.changes.length}
          additions={item.changes.reduce((s, c) => s + c.additions, 0)}
          deletions={item.changes.reduce((s, c) => s + c.deletions, 0)}
        />
      );
  }
}

function ChangesCard({
  count,
  additions,
  deletions,
}: {
  count: number;
  additions: number;
  deletions: number;
}) {
  const pending = useStore((s) => s.changes.length);
  return (
    <div className="card" data-testid="changes-card">
      <div className="card-title">
        <FileDiff size={14} color="var(--accent)" /> AI created changes.
      </div>
      <div className="muted" style={{ marginBottom: 8 }}>
        {count} file{count === 1 ? '' : 's'} changed · <span className="add">+{additions}</span>{' '}
        <span className="del">−{deletions}</span>
      </div>
      {pending > 0 ? (
        <div className="row">
          <button className="btn small primary" onClick={() => reviewChanges()}>
            Review Changes
          </button>
          <button className="btn small" onClick={() => applyChanges()}>
            Apply
          </button>
          <button className="btn small danger" onClick={() => discardChanges()}>
            Discard
          </button>
        </div>
      ) : (
        <div className="hint">Reviewed.</div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.busy);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.project);
  const focusChat = useStore((s) => s.focusChat);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat]);
  useEffect(() => {
    if (focusChat) input.current?.focus();
  }, [focusChat]);

  const send = async (message = text) => {
    if (!message.trim() || busy) return;
    setText('');
    await sendChat(message);
  };

  const noProvider =
    !settings ||
    settings.activeLabel === 'No AI provider' ||
    settings.activeLabel.includes('not configured');

  return (
    <aside className="agent-panel" data-testid="agent-panel">
      <div className="panel-header">
        AI Agent
        <span className="grow" />
        <button
          className="btn ghost small"
          style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}
          onClick={() => openSettings('ai')}
          title="AI provider settings"
        >
          <span
            className={`status-dot ${noProvider ? 'warn' : settings?.generative ? 'ok' : 'warn'}`}
          />
          <span className="ellipsis" style={{ maxWidth: 170 }}>
            {settings?.activeLabel ?? '…'}
          </span>
        </button>
        <button className="icon-btn" onClick={() => newChat()} title="New conversation">
          <MessageSquarePlus size={14} />
        </button>
      </div>
      <div className="agent-chips">
        {AGENT_IDS.map((id) => (
          <span key={id} className={`agent-chip ${agents[id] === 'working' ? 'working' : ''}`}>
            <span className={`status-dot ${agents[id] === 'working' ? 'busy' : ''}`} />
            {SHORT_NAMES[id]}
          </span>
        ))}
      </div>
      <div className="chat" ref={list} data-testid="chat">
        {chat.length === 0 && (
          <div className="empty" style={{ paddingTop: 40 }}>
            <Bot size={26} color="#3a4252" />
            <div style={{ color: 'var(--text-muted)' }}>
              {project
                ? 'Tell the agents what to build or fix.'
                : 'Create or open a project to start.'}
            </div>
            {noProvider && (
              <div className="callout warn" style={{ textAlign: 'left', marginTop: 8 }}>
                <AlertTriangle size={15} color="var(--yellow)" />
                <div>
                  No AI provider configured.{' '}
                  <a
                    href="#"
                    onClick={(e) => (e.preventDefault(), openSettings('ai'))}
                    style={{ color: 'var(--accent)' }}
                  >
                    Open Settings → AI Provider
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
        {chat.map((item) => (
          <ChatEntry key={item.id} item={item} />
        ))}
      </div>
      {chat.length === 0 && (
        <div className="suggestions">
          {(project ? SUGGESTIONS : SUGGESTIONS_NO_PROJECT).map((suggestion) => (
            <button key={suggestion} className="chip" onClick={() => send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <div className="chat-input">
        <div className="chat-box">
          <textarea
            ref={input}
            value={text}
            placeholder={
              project
                ? 'Ask the agents… e.g. "Make the monster faster"'
                : 'e.g. "Create a horror game"'
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            data-testid="chat-input"
          />
          <div className="row">
            <span className="hint grow">Enter to send · Shift+Enter new line</span>
            {busy ? (
              <button className="btn small danger" onClick={() => cancelAI()}>
                <Square size={12} /> Stop
              </button>
            ) : (
              <button
                className="btn small primary"
                onClick={() => send()}
                disabled={!text.trim()}
                data-testid="chat-send"
              >
                <Send size={12} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

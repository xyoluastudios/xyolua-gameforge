import {
  Bot,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Music,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { FileNode } from '@shared/api';
import { openFile, refreshTree } from '../actions';
import { AGENT_IDS, useStore } from '../store';
import { formatBytes } from './ui';

const AGENT_LABELS: Record<string, [string, string]> = {
  orchestrator: ['Project Manager', 'plans, delegates, decides when done'],
  'game-designer': ['Game Designer', 'idea → game plan'],
  programmer: ['Programmer', 'writes and fixes code'],
  'level-designer': ['Level Designer', 'rooms, spawns, zones'],
  'asset-manager': ['Asset Manager', 'assets and placeholders'],
  'audio-designer': ['Audio Designer', 'sound events, ambience'],
  qa: ['QA', 'tests and verification'],
};

export function fileIcon(path: string, size = 14) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.gd') || lower.endsWith('.gdshader'))
    return <FileCode2 size={size} color="#6cc5d9" />;
  if (lower.endsWith('.tscn') || lower.endsWith('.scn'))
    return <Clapperboard size={size} color="#e8a33a" />;
  if (lower.endsWith('.json')) return <FileJson size={size} color="#d9b53f" />;
  if (/\.(png|jpg|jpeg|svg|webp)$/.test(lower)) return <Image size={size} color="#ab86ee" />;
  if (/\.(wav|ogg|mp3)$/.test(lower)) return <Music size={size} color="#4cc38a" />;
  if (lower.endsWith('.godot') || lower.endsWith('.cfg') || lower.endsWith('.tres'))
    return <Settings2 size={size} color="#8a93a3" />;
  return <FileText size={size} color="#8a93a3" />;
}

const isTextFile = (path: string) =>
  /\.(gd|gdshader|tscn|tres|godot|json|cfg|md|txt|import|gitignore|editorconfig|csv|yml|yaml)$/i.test(
    path,
  ) || !path.includes('.');

function Section({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button className="section-title" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </button>
      {open && children}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
}: {
  node: FileNode;
  depth: number;
  activePath?: string;
}) {
  const [open, setOpen] = useState(depth < 1 && !node.name.startsWith('.'));
  if (node.type === 'directory') {
    return (
      <>
        <button
          className="tree-row"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {open ? <FolderOpen size={14} color="#8a93a3" /> : <Folder size={14} color="#8a93a3" />}
          <span className="name">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} activePath={activePath} />
          ))}
      </>
    );
  }
  return (
    <button
      className={`tree-row ${activePath === node.path ? 'active' : ''}`}
      style={{ paddingLeft: 22 + depth * 12 }}
      onClick={() => isTextFile(node.path) && openFile(node.path)}
      title={isTextFile(node.path) ? node.path : `${node.path} (binary)`}
      data-testid={`file-${node.path}`}
    >
      {fileIcon(node.path)}
      <span className="name">{node.name}</span>
    </button>
  );
}

function flatten(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((n) => (n.type === 'directory' ? flatten(n.children ?? []) : [n]));
}

function FlatList({ files, activePath }: { files: FileNode[]; activePath?: string }) {
  if (!files.length)
    return (
      <div className="faint" style={{ padding: '2px 26px 8px', fontSize: 12 }}>
        None
      </div>
    );
  return (
    <>
      {files.map((file) => (
        <button
          key={file.path}
          className={`tree-row ${activePath === file.path ? 'active' : ''}`}
          style={{ paddingLeft: 22 }}
          onClick={() => isTextFile(file.path) && openFile(file.path)}
          title={file.path}
        >
          {fileIcon(file.path)}
          <span className="name">{file.name}</span>
          <span className="meta">
            {file.path.includes('/')
              ? file.path.slice(0, file.path.lastIndexOf('/'))
              : formatBytes(file.size)}
          </span>
        </button>
      ))}
    </>
  );
}

export function Sidebar() {
  const tree = useStore((s) => s.tree);
  const project = useStore((s) => s.project);
  const agents = useStore((s) => s.agents);
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTab));
  const files = useMemo(() => flatten(tree), [tree]);
  const scenes = files.filter((f) => f.path.endsWith('.tscn'));
  const scripts = files.filter((f) => f.path.endsWith('.gd'));
  const assets = files.filter((f) =>
    /\.(png|jpg|jpeg|svg|webp|wav|ogg|mp3|glb|gltf|ttf|otf)$/i.test(f.path),
  );

  return (
    <aside className="sidebar" data-testid="sidebar">
      <div className="panel-header">
        Project
        <span className="grow" />
        {project && (
          <button className="icon-btn" onClick={() => refreshTree()} title="Refresh">
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        {!project ? (
          <div className="empty">No project open.</div>
        ) : (
          <>
            <Section title="Files" count={files.length}>
              {tree.map((node) => (
                <TreeNode key={node.path} node={node} depth={0} activePath={activeTab?.path} />
              ))}
            </Section>
            <Section title="Scenes" count={scenes.length} defaultOpen={false}>
              <FlatList files={scenes} activePath={activeTab?.path} />
            </Section>
            <Section title="Scripts" count={scripts.length} defaultOpen={false}>
              <FlatList files={scripts} activePath={activeTab?.path} />
            </Section>
            <Section title="Assets" count={assets.length} defaultOpen={false}>
              <FlatList files={assets} activePath={activeTab?.path} />
            </Section>
          </>
        )}
        <Section title="Agents" count={AGENT_IDS.length}>
          {AGENT_IDS.map((id) => (
            <div className="agent-row" key={id} data-testid={`agent-${id}`}>
              <Bot size={14} color={agents[id] === 'working' ? '#e8a33a' : '#5f6878'} />
              <div style={{ minWidth: 0 }}>
                <div>{AGENT_LABELS[id]?.[0]}</div>
                <div className="desc ellipsis">{AGENT_LABELS[id]?.[1]}</div>
              </div>
              <span className="grow" />
              <span
                className={`status-dot ${agents[id] === 'working' ? 'busy' : ''}`}
                title={agents[id]}
              />
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}

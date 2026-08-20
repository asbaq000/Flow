'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignLeft, Check, ChevronRight, Code2, GripVertical, Heading1, Heading2, Heading3,
  Image as ImageIcon, Info, List, ListOrdered, ListTodo, Minus, Plus, Quote, Trash2, Type,
} from 'lucide-react';
import type { Block, BlockType } from '@/lib/types';
import { emptyDoc } from '@/lib/types';
import { escapeHtml, sanitizeInline } from '@/lib/sanitize';
import { Popover } from './ui';

const uid = () => 'b' + Math.random().toString(36).slice(2, 10);

interface SlashItem {
  type: BlockType;
  label: string;
  hint: string;
  icon: React.ReactNode;
  keywords: string[];
}

const SLASH_ITEMS: SlashItem[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph', icon: <Type size={15} />, keywords: ['text', 'paragraph', 'plain'] },
  { type: 'heading1', label: 'Heading 1', hint: 'Big section heading', icon: <Heading1 size={15} />, keywords: ['h1', 'title', 'heading'] },
  { type: 'heading2', label: 'Heading 2', hint: 'Medium section heading', icon: <Heading2 size={15} />, keywords: ['h2', 'heading', 'subtitle'] },
  { type: 'heading3', label: 'Heading 3', hint: 'Small section heading', icon: <Heading3 size={15} />, keywords: ['h3', 'heading'] },
  { type: 'todo', label: 'To-do list', hint: 'Track with a checkbox', icon: <ListTodo size={15} />, keywords: ['todo', 'task', 'checkbox', 'check'] },
  { type: 'bulleted', label: 'Bulleted list', hint: 'A simple bullet list', icon: <List size={15} />, keywords: ['bullet', 'list', 'ul'] },
  { type: 'numbered', label: 'Numbered list', hint: 'A numbered list', icon: <ListOrdered size={15} />, keywords: ['number', 'ordered', 'ol'] },
  { type: 'toggle', label: 'Toggle list', hint: 'Hide detail behind a arrow', icon: <ChevronRight size={15} />, keywords: ['toggle', 'collapse', 'accordion'] },
  { type: 'quote', label: 'Quote', hint: 'Capture a quotation', icon: <Quote size={15} />, keywords: ['quote', 'blockquote'] },
  { type: 'callout', label: 'Callout', hint: 'Make writing stand out', icon: <Info size={15} />, keywords: ['callout', 'note', 'info', 'warning'] },
  { type: 'code', label: 'Code', hint: 'Capture a code snippet', icon: <Code2 size={15} />, keywords: ['code', 'snippet', 'pre'] },
  { type: 'divider', label: 'Divider', hint: 'Visually divide blocks', icon: <Minus size={15} />, keywords: ['divider', 'line', 'hr', 'separator'] },
  { type: 'image', label: 'Image', hint: 'Embed from a URL', icon: <ImageIcon size={15} />, keywords: ['image', 'picture', 'photo', 'img'] },
];

/** "# " and friends — typing the shortcut converts the block in place. */
const MARKDOWN_RULES: { re: RegExp; type: BlockType; checked?: boolean }[] = [
  { re: /^#\s$/, type: 'heading1' },
  { re: /^##\s$/, type: 'heading2' },
  { re: /^###\s$/, type: 'heading3' },
  { re: /^[-*+]\s$/, type: 'bulleted' },
  { re: /^1\.\s$/, type: 'numbered' },
  { re: /^\[\]\s$/, type: 'todo' },
  { re: /^\[\s?\]\s$/, type: 'todo' },
  { re: /^>\s$/, type: 'quote' },
  { re: /^```$/, type: 'code' },
  { re: /^---$/, type: 'divider' },
];

const TEXTLESS: BlockType[] = ['divider', 'image'];

export default function BlockEditor({
  value,
  onChange,
  editable = true,
  placeholder = "Describe the task. Type '/' for commands…",
}: {
  value: Block[];
  onChange: (blocks: Block[]) => void;
  editable?: boolean;
  placeholder?: string;
}) {
  const blocks = value.length ? value : emptyDoc();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ blockId: string; query: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const refs = useRef<Map<string, HTMLElement>>(new Map());

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  }, []);

  /** Place the caret at the start or end of a block after a structural change. */
  const focusBlock = useCallback((id: string, at: 'start' | 'end' = 'end') => {
    requestAnimationFrame(() => {
      const el = refs.current.get(id);
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(at === 'start');
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<Block>) => {
      onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [blocks, onChange]
  );

  const insertAfter = useCallback(
    (id: string, block?: Partial<Block>) => {
      const index = blocks.findIndex((b) => b.id === id);
      const fresh: Block = { id: uid(), type: 'paragraph', text: '', ...block };
      const next = [...blocks];
      next.splice(index + 1, 0, fresh);
      onChange(next);
      focusBlock(fresh.id, 'start');
      return fresh.id;
    },
    [blocks, onChange, focusBlock]
  );

  const removeBlock = useCallback(
    (id: string) => {
      const index = blocks.findIndex((b) => b.id === id);
      if (blocks.length === 1) {
        onChange([{ id: uid(), type: 'paragraph', text: '' }]);
        return;
      }
      const next = blocks.filter((b) => b.id !== id);
      onChange(next);
      const prev = next[Math.max(0, index - 1)];
      if (prev) focusBlock(prev.id, 'end');
    },
    [blocks, onChange, focusBlock]
  );

  const move = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const from = blocks.findIndex((b) => b.id === fromId);
      const to = blocks.findIndex((b) => b.id === toId);
      if (from < 0 || to < 0) return;
      const next = [...blocks];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next);
    },
    [blocks, onChange]
  );

  /**
   * Converts a block in place. `textOverride` lets the slash menu strip the
   * "/command" the user typed in the same state update — two sequential
   * updates would both read the same stale `blocks` and the second would win.
   */
  const turnInto = useCallback(
    (id: string, type: BlockType, textOverride?: string) => {
      const block = blocks.find((b) => b.id === id);
      if (!block) return;

      const patch: Partial<Block> = { type };
      if (textOverride !== undefined) patch.text = textOverride;
      if (TEXTLESS.includes(type)) patch.text = '';
      if (type === 'todo' && block.checked === undefined) patch.checked = false;
      if (type === 'callout' && !block.emoji) patch.emoji = '💡';
      update(id, patch);

      // The DOM node is uncontrolled, so clearing text needs an explicit wipe.
      if (TEXTLESS.includes(type)) {
        const el = refs.current.get(id);
        if (el) el.innerHTML = '';
      } else {
        focusBlock(id, 'end');
      }
    },
    [blocks, update, focusBlock]
  );

  const numbering = useMemo(() => {
    const map = new Map<string, number>();
    let run = 0;
    for (const b of blocks) {
      if (b.type === 'numbered') map.set(b.id, ++run);
      else run = 0;
    }
    return map;
  }, [blocks]);

  return (
    <div className="relative">
      {blocks.map((block) => (
        <BlockRow
          key={block.id}
          block={block}
          index={numbering.get(block.id)}
          editable={editable}
          isOnlyEmpty={blocks.length === 1 && !block.text}
          placeholder={placeholder}
          register={register}
          focused={focusId === block.id}
          dragging={dragId === block.id}
          dropTarget={overId === block.id}
          onFocus={() => setFocusId(block.id)}
          onBlur={() => setFocusId((c) => (c === block.id ? null : c))}
          onUpdate={(patch) => update(block.id, patch)}
          onEnter={(rest) => {
            const type: BlockType =
              block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo'
                ? block.type
                : 'paragraph';
            insertAfter(block.id, { type, text: rest, checked: type === 'todo' ? false : undefined });
          }}
          onBackspaceAtStart={() => {
            if (block.type !== 'paragraph') {
              turnInto(block.id, 'paragraph');
              return;
            }
            const index = blocks.findIndex((b) => b.id === block.id);
            if (index === 0) return;
            const prev = blocks[index - 1];
            const prevEl = refs.current.get(prev.id);
            const merged = (prevEl?.innerHTML ?? prev.text) + block.text;
            const next = blocks.filter((b) => b.id !== block.id);
            const at = next.findIndex((b) => b.id === prev.id);
            next[at] = { ...prev, text: merged };
            onChange(next);
            if (prevEl) prevEl.innerHTML = merged;
            focusBlock(prev.id, 'end');
          }}
          onArrow={(dir) => {
            const index = blocks.findIndex((b) => b.id === block.id);
            const target = blocks[dir === 'up' ? index - 1 : index + 1];
            if (target) focusBlock(target.id, dir === 'up' ? 'end' : 'start');
          }}
          onSlash={(query) => setSlash(query === null ? null : { blockId: block.id, query })}
          onMarkdown={(type) => turnInto(block.id, type)}
          onDelete={() => removeBlock(block.id)}
          onDuplicate={() => insertAfter(block.id, { ...block, id: uid() })}
          onTurnInto={(t) => turnInto(block.id, t)}
          onAddBelow={() => insertAfter(block.id)}
          onDragStart={() => setDragId(block.id)}
          onDragOver={() => setOverId(block.id)}
          onDrop={() => {
            if (dragId) move(dragId, block.id);
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
        />
      ))}

      {slash && editable && (
        <SlashMenu
          query={slash.query}
          anchorEl={refs.current.get(slash.blockId) ?? null}
          onPick={(type) => {
            const el = refs.current.get(slash.blockId);
            // Drop only the trailing "/query", leaving any earlier slashes alone.
            const stripped = el ? el.innerHTML.replace(/\/[^/\s<]*$/, '') : undefined;
            if (el && stripped !== undefined) el.innerHTML = stripped;
            turnInto(slash.blockId, type, stripped);
            setSlash(null);
          }}
          onClose={() => setSlash(null)}
        />
      )}

      {editable && (
        <button
          onClick={() => {
            const last = blocks[blocks.length - 1];
            if (last && !last.text && last.type === 'paragraph') {
              focusBlock(last.id, 'end');
            } else {
              insertAfter(last.id);
            }
          }}
          className="mt-1 flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-[13px] text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:opacity-100 focus:opacity-100"
        >
          <Plus size={14} /> Click to add a block
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One block                                                           */
/* ------------------------------------------------------------------ */

interface RowProps {
  block: Block;
  index?: number;
  editable: boolean;
  isOnlyEmpty: boolean;
  placeholder: string;
  focused: boolean;
  dragging: boolean;
  dropTarget: boolean;
  register: (id: string, el: HTMLElement | null) => void;
  onFocus: () => void;
  onBlur: () => void;
  onUpdate: (patch: Partial<Block>) => void;
  onEnter: (rest: string) => void;
  onBackspaceAtStart: () => void;
  onArrow: (dir: 'up' | 'down') => void;
  onSlash: (query: string | null) => void;
  onMarkdown: (type: BlockType) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onTurnInto: (type: BlockType) => void;
  onAddBelow: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function BlockRow(props: RowProps) {
  const { block, editable, register } = props;
  const ref = useRef<HTMLDivElement>(null);
  const lastHtml = useRef(block.text);

  /**
   * The editable node is uncontrolled — writing innerHTML on every keystroke
   * would destroy the caret. So text is pushed into the DOM only when the node
   * is NOT focused and has drifted from state. That covers the case where
   * changing a block's type makes React mount a brand new (empty) element:
   * without this resync, the block's text would silently disappear.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    register(block.id, el);
    if (document.activeElement !== el && el.innerHTML !== block.text) {
      el.innerHTML = block.text;
      lastHtml.current = block.text;
    }
  });

  useEffect(() => () => register(block.id, null), [block.id, register]);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeInline(el.innerHTML);
    lastHtml.current = html;
    props.onUpdate({ text: html });
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el) return;
    const plain = el.textContent ?? '';

    for (const rule of MARKDOWN_RULES) {
      if (rule.re.test(plain)) {
        el.innerHTML = '';
        props.onMarkdown(rule.type);
        return;
      }
    }

    // Open on "/" at the start of a block or after whitespace. Requiring that
    // boundary keeps the menu out of the way while typing "https://…" or "a/b".
    const slashMatch = plain.match(/(?:^|\s)\/([^/\s]*)$/);
    props.onSlash(slashMatch ? slashMatch[1] : null);

    lastHtml.current = el.innerHTML;
    props.onUpdate({ text: el.innerHTML });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const el = ref.current;
    if (!el) return;

    if (e.key === 'Enter' && !e.shiftKey && block.type !== 'code') {
      e.preventDefault();
      commit();
      // Split the block at the caret: text after the cursor moves to the new block.
      const sel = window.getSelection();
      let rest = '';
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0).cloneRange();
        range.setEndAfter(el.lastChild ?? el);
        const frag = range.cloneContents();
        const div = document.createElement('div');
        div.appendChild(frag);
        rest = sanitizeInline(div.innerHTML);
        if (rest) {
          const del = sel.getRangeAt(0).cloneRange();
          del.setEndAfter(el.lastChild ?? el);
          del.deleteContents();
          lastHtml.current = el.innerHTML;
          props.onUpdate({ text: el.innerHTML });
        }
      }
      props.onEnter(rest);
      return;
    }

    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      const atStart = sel?.isCollapsed && sel.anchorOffset === 0 && isFirstTextNode(el, sel.anchorNode);
      if (atStart) {
        e.preventDefault();
        commit();
        props.onBackspaceAtStart();
      }
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const sel = window.getSelection();
      if (!sel?.isCollapsed) return;
      const atEdge =
        e.key === 'ArrowUp'
          ? sel.anchorOffset === 0 && isFirstTextNode(el, sel.anchorNode)
          : isAtEnd(el, sel);
      if (atEdge) {
        e.preventDefault();
        commit();
        props.onArrow(e.key === 'ArrowUp' ? 'up' : 'down');
      }
      return;
    }

    if (e.key === 'Escape') props.onSlash(null);

    // Inline formatting. execCommand is deprecated but remains the only
    // reliable cross-browser way to style a contenteditable selection.
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const map: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };
      const cmd = map[e.key.toLowerCase()];
      if (cmd) {
        e.preventDefault();
        document.execCommand(cmd);
        commit();
        return;
      }
      if (e.key.toLowerCase() === 'e') {
        e.preventDefault();
        wrapSelection('code');
        commit();
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    commit();
  };

  const shared = {
    ref,
    contentEditable: editable,
    suppressContentEditableWarning: true,
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onBlur: () => {
      commit();
      props.onBlur();
    },
    onFocus: props.onFocus,
    spellCheck: true,
  };

  const showPlaceholder = props.isOnlyEmpty || (props.focused && !block.text);
  const ph =
    block.type === 'paragraph'
      ? props.isOnlyEmpty
        ? props.placeholder
        : "Type '/' for commands"
      : PLACEHOLDERS[block.type] ?? '';

  return (
    <div
      className="group relative flex items-start gap-1"
      style={{ borderTop: props.dropTarget ? '2px solid var(--accent)' : '2px solid transparent' }}
      onDragOver={(e) => {
        if (!props.dragging) e.preventDefault();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
    >
      {/* gutter */}
      {editable && (
        <div className="sticky top-0 flex shrink-0 items-center gap-1 pt-[3px]">
          <button
            onClick={props.onAddBelow}
            className="grid h-6 w-6 place-items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-active)] text-[var(--text)] shadow-sm hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
            aria-label="Add block below"
          >
            <Plus size={15} />
          </button>
          <Popover
            width={210}
            trigger={({ toggle }) => (
              <button
                onClick={toggle}
                draggable
                onDragStart={props.onDragStart}
                onDragEnd={props.onDragEnd}
                className="grid h-6 w-6 cursor-grab place-items-center rounded-md border border-[var(--border-strong)] bg-[var(--bg-active)] text-[var(--text)] shadow-sm hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] active:cursor-grabbing"
                aria-label="Block options — drag to move"
              >
                <GripVertical size={14} />
              </button>
            )}
          >
            {(close) => (
              <>
                <button
                  className="menu-item btn-danger-solid mb-1 w-full justify-center"
                  onClick={() => {
                    props.onDelete();
                    close();
                  }}
                >
                  <Trash2 size={14} /> Delete block
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    props.onDuplicate();
                    close();
                  }}
                >
                  <Plus size={14} /> Duplicate
                </button>
                <div className="my-1 border-t" />
                <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  Turn into
                </div>
                {SLASH_ITEMS.filter((i) => i.type !== 'divider').map((item) => (
                  <button
                    key={item.type}
                    className="menu-item"
                    onClick={() => {
                      props.onTurnInto(item.type);
                      close();
                    }}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {block.type === item.type && <Check size={13} />}
                  </button>
                ))}
              </>
            )}
          </Popover>
        </div>
      )}

      {/* content */}
      <div className={`min-w-0 flex-1 ${props.dragging ? 'drag-ghost' : ''}`}>
        {renderBlock(block, shared, props, showPlaceholder ? ph : '')}
      </div>
    </div>
  );
}

const PLACEHOLDERS: Partial<Record<BlockType, string>> = {
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulleted: 'List item',
  numbered: 'List item',
  todo: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Write something…',
  code: 'Code',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderBlock(block: Block, shared: any, props: RowProps, placeholder: string) {
  const ce = { ...shared, 'data-placeholder': placeholder };

  switch (block.type) {
    case 'heading1':
      return <div {...ce} className="pb-0.5 pt-4 text-[26px] font-bold leading-tight tracking-tight" />;
    case 'heading2':
      return <div {...ce} className="pb-0.5 pt-3 text-[20px] font-bold leading-tight tracking-tight" />;
    case 'heading3':
      return <div {...ce} className="pb-0.5 pt-2.5 text-[16px] font-semibold leading-tight" />;

    case 'bulleted':
      return (
        <div className="flex gap-2 py-[3px]">
          <span className="select-none pt-[7px] text-[7px] leading-none">●</span>
          <div {...ce} className="min-w-0 flex-1" />
        </div>
      );

    case 'numbered':
      return (
        <div className="flex gap-2 py-[3px]">
          <span className="min-w-[16px] select-none pt-px text-[14px] text-[var(--text-secondary)]">
            {props.index ?? 1}.
          </span>
          <div {...ce} className="min-w-0 flex-1" />
        </div>
      );

    case 'todo':
      return (
        <div className="flex gap-2 py-[3px]">
          <button
            onClick={() => props.onUpdate({ checked: !block.checked })}
            disabled={!props.editable}
            className="mt-[3px] grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[3px] border transition-colors"
            style={{
              background: block.checked ? 'var(--accent)' : 'transparent',
              borderColor: block.checked ? 'var(--accent)' : 'var(--border-strong)',
            }}
            aria-label={block.checked ? 'Mark incomplete' : 'Mark complete'}
          >
            {block.checked && <Check size={11} className="text-white" strokeWidth={3} />}
          </button>
          <div
            {...ce}
            className={`min-w-0 flex-1 ${block.checked ? 'text-[var(--text-tertiary)] line-through' : ''}`}
          />
        </div>
      );

    case 'toggle':
      return (
        <div className="py-[3px]">
          <div className="flex gap-1.5">
            <button
              onClick={() => props.onUpdate({ collapsed: !block.collapsed })}
              className="mt-[3px] grid h-[17px] w-[17px] shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              aria-label={block.collapsed ? 'Expand' : 'Collapse'}
            >
              <ChevronRight
                size={13}
                className="transition-transform"
                style={{ transform: block.collapsed ? 'none' : 'rotate(90deg)' }}
              />
            </button>
            <div {...ce} className="min-w-0 flex-1 font-medium" />
          </div>
          {!block.collapsed && (
            <div className="ml-[26px] mt-0.5 border-l pl-3 text-[13.5px] text-[var(--text-secondary)]">
              {block.children?.length ? (
                block.children.map((c) => <div key={c.id} dangerouslySetInnerHTML={{ __html: c.text }} />)
              ) : (
                <span className="text-[var(--text-tertiary)]">Empty toggle. Add blocks below it.</span>
              )}
            </div>
          )}
        </div>
      );

    case 'quote':
      return (
        <div className="my-1 border-l-[3px] pl-3" style={{ borderColor: 'var(--text)' }}>
          <div {...ce} className="italic" />
        </div>
      );

    case 'callout':
      return (
        <div
          className="my-1.5 flex gap-2.5 rounded-[4px] p-3"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
        >
          <EmojiButton emoji={block.emoji ?? '💡'} onPick={(emoji) => props.onUpdate({ emoji })} editable={props.editable} />
          <div {...ce} className="min-w-0 flex-1 pt-[1px]" />
        </div>
      );

    case 'code':
      return (
        <div className="my-1.5 overflow-hidden rounded-[4px] border" style={{ background: 'var(--bg-subtle)' }}>
          <div className="flex items-center justify-between border-b px-3 py-1">
            <input
              value={block.language ?? 'plain text'}
              onChange={(e) => props.onUpdate({ language: e.target.value })}
              disabled={!props.editable}
              className="w-32 bg-transparent text-[11.5px] text-[var(--text-secondary)] outline-none"
              aria-label="Language"
            />
            <button
              onClick={() => navigator.clipboard?.writeText(stripToText(block.text))}
              className="text-[11.5px] text-[var(--text-secondary)] hover:text-[var(--text)]"
            >
              Copy
            </button>
          </div>
          <div {...ce} className="block-code px-3 py-2.5" />
        </div>
      );

    case 'divider':
      return (
        <div className="py-2.5" contentEditable={false}>
          <hr style={{ borderColor: 'var(--border-strong)' }} />
        </div>
      );

    case 'image':
      return (
        <div className="my-1.5" contentEditable={false}>
          {block.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.url} alt={stripToText(block.text) || 'Attached image'} className="max-h-[420px] rounded-[4px] border object-contain" />
          ) : (
            <input
              className="input text-[13px]"
              placeholder="Paste an image URL and press Enter…"
              disabled={!props.editable}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const url = (e.target as HTMLInputElement).value.trim();
                if (/^https?:\/\//i.test(url)) props.onUpdate({ url });
              }}
            />
          )}
        </div>
      );

    default:
      return <div {...ce} className="py-[3px]" />;
  }
}

const EMOJIS = ['💡', '⚠️', '✅', '❌', '📌', '🔥', '📝', '🚀', '🐛', '❓', '⏰', '🎯'];

function EmojiButton({
  emoji,
  onPick,
  editable,
}: {
  emoji: string;
  onPick: (e: string) => void;
  editable: boolean;
}) {
  if (!editable) return <span className="select-none text-[16px] leading-6">{emoji}</span>;
  return (
    <Popover
      width={190}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="h-6 shrink-0 select-none rounded text-[16px] leading-6 hover:bg-[var(--bg-hover)]">
          {emoji}
        </button>
      )}
    >
      {(close) => (
        <div className="grid grid-cols-6 gap-0.5 p-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              className="grid h-8 place-items-center rounded text-[17px] hover:bg-[var(--bg-hover)]"
              onClick={() => {
                onPick(e);
                close();
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Slash menu                                                          */
/* ------------------------------------------------------------------ */

function SlashMenu({
  query,
  anchorEl,
  onPick,
  onClose,
}: {
  query: string;
  anchorEl: HTMLElement | null;
  onPick: (type: BlockType) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(
      (i) => i.label.toLowerCase().includes(q) || i.keywords.some((k) => k.startsWith(q))
    );
  }, [query]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => (c + 1) % Math.max(1, items.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => (c - 1 + items.length) % Math.max(1, items.length));
      } else if (e.key === 'Enter' && items.length) {
        e.preventDefault();
        onPick(items[cursor].type);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [items, cursor, onPick, onClose]);

  const rect = anchorEl?.getBoundingClientRect();
  if (!rect || !items.length) return null;

  const top = rect.bottom + 300 > window.innerHeight ? Math.max(8, rect.top - 296) : rect.bottom + 6;

  return (
    <div
      className="menu animate-pop scroll-thin fixed max-h-[290px] w-[290px] overflow-y-auto"
      style={{ top, left: Math.min(rect.left, window.innerWidth - 300) }}
    >
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        Basic blocks
      </div>
      {items.map((item, i) => (
        <button
          key={item.type}
          data-active={i === cursor}
          className="menu-item"
          onMouseEnter={() => setCursor(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item.type);
          }}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded border text-[var(--text-secondary)]">
            {item.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{item.label}</span>
            <span className="block truncate text-[11.5px] text-[var(--text-tertiary)]">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function isFirstTextNode(root: HTMLElement, node: Node | null): boolean {
  if (!node) return true;
  if (node === root) return true;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() === node;
}

function isAtEnd(root: HTMLElement, sel: Selection): boolean {
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(root);
  range.setStart(sel.anchorNode!, sel.anchorOffset);
  return range.toString().length === 0;
}

function wrapSelection(tag: string) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const el = document.createElement(tag);
  try {
    range.surroundContents(el);
  } catch {
    // Selection spans element boundaries — fall back to a plain replacement.
    const text = range.toString();
    range.deleteContents();
    el.textContent = text;
    range.insertNode(el);
  }
}

function stripToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

export { escapeHtml };

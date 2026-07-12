import { useState } from 'react';
import type { ConversationSummary } from '@/lib/chatHistory';
import { useDismissDetails } from '@/lib/useDismissDetails';
import { ChatIcon, PlusIcon, SidebarIcon } from './Icons';

export default function AppSidebar({
  open,
  onToggle,
  onNewChat,
  onOpenAssistant,
  conversations,
  activeConversationId,
  activeView,
  onOpenChat,
  onOpenLibrary,
  onRenameChat,
  onMoveChat,
  onDeleteChat,
  username,
  onLogout,
}: {
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onOpenAssistant: () => void;
  conversations: ConversationSummary[];
  activeConversationId: string;
  activeView: 'assistant' | 'chat' | 'library';
  onOpenChat: (id: string) => void;
  onOpenLibrary: () => void;
  onRenameChat: (id: string, title: string) => void;
  onMoveChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  username: string;
  onLogout: () => void;
}) {
  return (
    <>
      {open && <button aria-label="关闭侧栏" onClick={onToggle} className="fixed inset-0 z-30 cursor-default bg-black/25 lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col bg-[#f9f9f9] p-1.5 transition-[width,transform] duration-200 lg:static ${open ? 'w-[210px] translate-x-0' : 'w-[210px] -translate-x-full lg:w-[50px] lg:translate-x-0'}`}>
        <div className={`flex h-10 items-center justify-between ${open ? 'px-1.5' : 'px-0.5'}`}>
          <div className={`flex items-center gap-2 overflow-hidden ${open ? '' : 'lg:w-0'}`}>
            <img src="./wyd_mark_transparent.png" alt="WYD" className="h-6 w-6 shrink-0 object-contain" />
            <span className="whitespace-nowrap text-[12px] font-semibold text-[#202123]">威彦达</span>
          </div>
          <button aria-label={open ? '收起侧栏' : '展开侧栏'} onClick={onToggle} className="icon-button inline-flex shrink-0"><SidebarIcon /></button>
        </div>

        <button onClick={onNewChat} className="sidebar-item mt-1" title="新对话">
          <PlusIcon />
          <span className={open ? '' : 'lg:hidden'}>新对话</span>
        </button>

        <button
          type="button"
          onClick={onOpenAssistant}
          className={`sidebar-item mt-0.5 ${activeView === 'assistant' ? 'bg-[#ececec]' : ''}`}
          title="助理"
        >
          <AssistantIcon />
          <span className={open ? '' : 'lg:hidden'}>助理</span>
        </button>

        <button
          type="button"
          onClick={onOpenLibrary}
          className={`sidebar-item mt-0.5 ${activeView === 'library' ? 'bg-[#ececec]' : ''}`}
          title="文件库"
        >
          <LibraryIcon />
          <span className={open ? '' : 'lg:hidden'}>文件库</span>
        </button>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {(['最近', '已归档'] as const).map((group) => {
            const items = conversations.filter((conversation) => conversation.group === group);
            if (!items.length && group === '已归档') return null;
            return (
              <section key={group} className={group === '已归档' ? 'mt-3' : ''}>
                <div className={`px-2 pb-1 text-[10px] font-medium text-[#8e8ea0] ${open ? '' : 'lg:hidden'}`}>{group}</div>
                {items.length ? items.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    open={open}
                    active={activeView === 'chat' && activeConversationId === conversation.id}
                    onOpen={() => onOpenChat(conversation.id)}
                    onRename={(title) => onRenameChat(conversation.id, title)}
                    onMove={() => onMoveChat(conversation.id)}
                    onDelete={() => onDeleteChat(conversation.id)}
                  />
                )) : (
                  <div className={`px-3 py-2 text-[11px] text-[#8e8ea0] ${open ? '' : 'lg:hidden'}`}>开始对话后会显示在这里</div>
                )}
              </section>
            );
          })}
        </div>
        <div className="mt-1 border-t border-black/[0.05] pt-1">
          <button type="button" onClick={onLogout} className="sidebar-item" title={`${username} · 退出登录`}>
            <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-[#dedede] text-[9px] font-semibold text-[#555]">{username.slice(0, 1).toUpperCase()}</span>
            <span className={`min-w-0 flex-1 truncate text-left ${open ? '' : 'lg:hidden'}`}>{username}</span>
            <span className={`text-[9px] text-[#999] ${open ? '' : 'lg:hidden'}`}>退出</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function ConversationRow({ conversation, open, active, onOpen, onRename, onMove, onDelete }: {
  conversation: ConversationSummary;
  open: boolean;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const menuRef = useDismissDetails();
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const act = (action: () => void) => {
    menuRef.current!.open = false;
    action();
  };
  const submitRename = () => {
    if (draftTitle.trim()) onRename(draftTitle.trim());
    else setDraftTitle(conversation.title);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <form onSubmit={(event) => { event.preventDefault(); submitRename(); }} className="flex h-8 items-center gap-2 rounded-lg bg-white px-2 ring-1 ring-black/10">
        <ChatIcon />
        <input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} onBlur={submitRename} onKeyDown={(event) => event.key === 'Escape' && setRenaming(false)} className="min-w-0 flex-1 border-0 bg-transparent text-[11px] outline-none" aria-label="对话名称" />
      </form>
    );
  }

  return (
    <div className={`group relative flex items-center rounded-lg ${active ? 'bg-[#ececec]' : ''}`}>
      <button type="button" onClick={onOpen} className="sidebar-item min-w-0 flex-1 pr-1" title={conversation.title || '新对话'}>
        <ChatIcon />
        <span className={`truncate ${open ? '' : 'lg:hidden'}`}>{conversation.title || '新对话'}</span>
      </button>
      {open && (
        <details ref={menuRef} className="relative mr-1">
          <summary aria-label="对话操作" className="flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-[#777] opacity-0 hover:bg-black/5 group-hover:opacity-100 group-open:opacity-100 [&::-webkit-details-marker]:hidden"><MoreIcon /></summary>
          <div className="absolute right-0 top-8 z-50 w-36 rounded-xl border border-black/[0.08] bg-white p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.14)]">
            <MenuButton icon={<RenameIcon />} label="重命名" onClick={() => act(() => setRenaming(true))} />
            <MenuButton icon={<MoveIcon />} label={conversation.group === '最近' ? '移动到归档' : '移回最近'} onClick={() => act(onMove)} />
            <div className="my-1 border-t border-black/[0.06]" />
            <MenuButton icon={<TrashIcon />} label="删除" danger onClick={() => act(onDelete)} />
          </div>
        </details>
      )}
    </div>
  );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${danger ? 'text-red-600 hover:bg-red-50' : 'text-[#444] hover:bg-[#f4f4f4]'}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>;
}

function LibraryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <rect x="9.5" y="4" width="5" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 5.5 3.4-1 3.1 14.2-3.4.8L16 5.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function AssistantIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M12 3.5c.7 3.7 2.8 5.8 6.5 6.5-3.7.7-5.8 2.8-6.5 6.5-.7-3.7-2.8-5.8-6.5-6.5 3.7-.7 5.8-2.8 6.5-6.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M18.5 15.5c.25 1.4 1.1 2.25 2.5 2.5-1.4.25-2.25 1.1-2.5 2.5-.25-1.4-1.1-2.25-2.5-2.5 1.4-.25 2.25-1.1 2.5-2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function RenameIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="m4 16-.5 4 4-.5L18 9l-3-3L4 16Zm9-8 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MoveIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M4 7h6l2 2h8v10H4V7Zm4-3h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-2 4 1 14h8l1-14M10 11v6m4-6v6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

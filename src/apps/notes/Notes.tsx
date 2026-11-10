import React, { useState, useEffect, useMemo } from 'react';
import {
  StickyNote,
  Plus,
  Trash2,
  Copy,
  Check,
  FileText,
  Pin,
  Folder,
  FolderOpen,
  Search,
  BookOpen,
  Code2,
  Sparkles,
  Columns,
  Eye,
  Edit3,
  Terminal,
  CheckSquare,
  List,
  Heading,
  Bold,
  Italic,
  Share2,
  Lock,
  Tag
} from 'lucide-react';

interface NoteItem {
  id: string;
  folderId: string;
  title: string;
  body: string;
  isPinned?: boolean;
  updatedAt: string;
  dateCategory: 'Today' | 'Yesterday' | 'Previous 30 Days';
}

interface NoteFolder {
  id: string;
  name: string;
  icon: string;
  count?: number;
}

const DEFAULT_FOLDERS: NoteFolder[] = [
  { id: 'all', name: 'All Cloud Notes', icon: 'folder' },
  { id: 'deployments', name: 'Deployments & CI/CD', icon: 'terminal' },
  { id: 'snippets', name: 'Server Snippets & Bash', icon: 'code' },
  { id: 'security', name: 'Security & Access Keys', icon: 'lock' },
];

const DEFAULT_NOTES: NoteItem[] = [];

export default function Notes() {
  const [folders] = useState<NoteFolder[]>(DEFAULT_FOLDERS);
  const [activeFolderId, setActiveFolderId] = useState<string>('all');
  
  const [notes, setNotes] = useState<NoteItem[]>(() => {
    const saved = localStorage.getItem('sshdesktop_notes_studio_v2') || localStorage.getItem('clouddesk_notes_studio_v2');
    return saved ? JSON.parse(saved) : DEFAULT_NOTES;
  });
  
  const [activeNoteId, setActiveNoteId] = useState<string>(notes[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'split' | 'edit' | 'preview'>('split');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem('sshdesktop_notes_studio_v2', JSON.stringify(notes));
  }, [notes]);

  const activeNote = notes.find(n => n.id === activeNoteId) || notes[0];

  const updateBody = (newBody: string) => {
    const lines = newBody.split('\n');
    const firstNonEmpty = lines.find(l => l.trim().length > 0) || 'Untitled Note';
    const cleanTitle = firstNonEmpty.replace(/^#+\s*/, '').slice(0, 35);

    setNotes(prev =>
      prev.map(n =>
        n.id === activeNoteId
          ? {
              ...n,
              body: newBody,
              title: cleanTitle,
              updatedAt: 'Just now',
              dateCategory: 'Today'
            }
          : n
      )
    );
  };

  const createNote = () => {
    const newNote: NoteItem = {
      id: String(Date.now()),
      folderId: activeFolderId === 'all' ? 'snippets' : activeFolderId,
      title: 'New Note',
      body: '# New Note\n\nStart typing your markdown notes here...',
      isPinned: false,
      updatedAt: 'Just now',
      dateCategory: 'Today'
    };
    setNotes([newNote, ...notes]);
    setActiveNoteId(newNote.id);
  };

  const togglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNotes(prev =>
      prev.map(n => (n.id === id ? { ...n, isPinned: !n.isPinned } : n))
    );
  };

  const deleteNote = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (notes.length === 1) return;
    const remaining = notes.filter(n => n.id !== id);
    setNotes(remaining);
    if (activeNoteId === id) {
      setActiveNoteId(remaining[0].id);
    }
  };

  const copyToClipboard = () => {
    if (activeNote) {
      navigator.clipboard.writeText(activeNote.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const insertFormatting = (prefix: string, suffix: string = '') => {
    if (!activeNote) return;
    updateBody(activeNote.body + `\n${prefix}text${suffix}`);
  };

  // Filter notes by folder and search term
  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      const matchesFolder = activeFolderId === 'all' || n.folderId === activeFolderId;
      const matchesSearch =
        !searchQuery.trim() ||
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.body.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesFolder && matchesSearch;
    });
  }, [notes, activeFolderId, searchQuery]);

  const pinnedNotes = filteredNotes.filter(n => n.isPinned);
  const unpinnedNotes = filteredNotes.filter(n => !n.isPinned);

  return (
    <div className="flex h-full bg-[#181825] text-[#cdd6f4] font-sans antialiased overflow-hidden select-none">
      {/* Pane 1: Apple Sidebar Folders */}
      <div className="w-52 bg-[#14141e]/95 backdrop-blur-xl border-r border-white/[0.08] flex flex-col shrink-0">
        <div className="p-3 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <StickyNote className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-xs text-white">Apple Notes</span>
          </div>
          <button
            onClick={createNote}
            title="Create Note (⌘N)"
            className="p-1 rounded-md text-amber-400 hover:text-amber-300 hover:bg-white/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Folders List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 text-xs">
          <div className="px-2 py-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            iCloud Server Notes
          </div>
          {folders.map(f => {
            const count = f.id === 'all' ? notes.length : notes.filter(n => n.folderId === f.id).length;
            const isSelected = activeFolderId === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setActiveFolderId(f.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                  isSelected
                    ? 'bg-amber-500/20 text-amber-300 font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  {isSelected ? (
                    <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Folder className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  )}
                  <span className="truncate">{f.name}</span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pane 2: Notes List with Search */}
      <div className="w-64 bg-[#181825] border-r border-white/[0.08] flex flex-col shrink-0">
        {/* Search Header */}
        <div className="p-2.5 border-b border-white/[0.08] bg-[#11111b]/50">
          <div className="relative">
            <Search className="w-3 h-3 text-gray-500 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Search all notes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#11111b] border border-white/10 rounded-lg pl-7 pr-2.5 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/80"
            />
          </div>
        </div>

        {/* Notes Items List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {filteredNotes.length === 0 ? (
            <div className="py-16 text-center text-gray-500 text-xs px-4">
              <StickyNote className="w-8 h-8 mx-auto text-amber-500/40 mb-2" />
              <p className="font-semibold text-gray-300">No Notes</p>
              <p className="text-[11px] text-gray-600 mt-1">Click + at the top to create a note.</p>
            </div>
          ) : (
            <>
              {/* Pinned Section */}
          {pinnedNotes.length > 0 && (
            <div className="space-y-1">
              <div className="px-2 text-[10px] font-bold text-amber-400/90 uppercase tracking-wider flex items-center gap-1">
                <Pin className="w-2.5 h-2.5 fill-current" /> Pinned Notes
              </div>
              {pinnedNotes.map(note => (
                <div
                  key={note.id}
                  onClick={() => setActiveNoteId(note.id)}
                  className={`p-2.5 rounded-xl cursor-pointer transition-all group relative border ${
                    activeNoteId === note.id
                      ? 'bg-amber-500/15 border-amber-500/30 text-white shadow-sm'
                      : 'border-white/[0.03] hover:bg-white/5 text-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <h4 className="font-semibold text-xs truncate flex-1 text-white pr-2">{note.title}</h4>
                    <button
                      onClick={e => togglePin(note.id, e)}
                      title="Unpin Note"
                      className="text-amber-400 hover:text-amber-300"
                    >
                      <Pin className="w-3 h-3 fill-current" />
                    </button>
                  </div>
                  <div className="text-[11px] text-gray-400 line-clamp-2 mt-1 font-sans">
                    {note.body.replace(/[#*`>]/g, '').trim().slice(0, 90)}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500 font-mono">
                    <span>{note.updatedAt}</span>
                    <button
                      onClick={e => deleteNote(note.id, e)}
                      className="opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Standard Notes */}
          <div className="space-y-1">
            {pinnedNotes.length > 0 && (
              <div className="px-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                Notes
              </div>
            )}
            {unpinnedNotes.map(note => (
              <div
                key={note.id}
                onClick={() => setActiveNoteId(note.id)}
                className={`p-2.5 rounded-xl cursor-pointer transition-all group relative border ${
                  activeNoteId === note.id
                    ? 'bg-amber-500/15 border-amber-500/30 text-white shadow-sm'
                    : 'border-white/[0.03] hover:bg-white/5 text-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <h4 className="font-semibold text-xs truncate flex-1 text-white pr-2">{note.title}</h4>
                  <button
                    onClick={e => togglePin(note.id, e)}
                    title="Pin Note"
                    className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-amber-400 transition-opacity"
                  >
                    <Pin className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-[11px] text-gray-400 line-clamp-2 mt-1 font-sans">
                  {note.body.replace(/[#*`>]/g, '').trim().slice(0, 90)}
                </div>
                <div className="flex items-center justify-between mt-2 text-[10px] text-gray-500 font-mono">
                  <span>{note.updatedAt}</span>
                  <button
                    onClick={e => deleteNote(note.id, e)}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
            </>
          )}
        </div>
      </div>

      {/* Pane 3: Apple Note Editor & Split Markdown */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
        {/* Apple Notes Top Toolbar */}
        <div className="h-10 bg-[#1e1e2e]/90 backdrop-blur-md border-b border-white/[0.08] px-3.5 flex items-center justify-between shrink-0 overflow-x-auto no-scrollbar gap-2">
          {/* Format Quick Controls */}
          <div className="flex items-center space-x-1 shrink-0">
            <button
              onClick={() => insertFormatting('# ')}
              title="Heading 1"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <Heading className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('**', '**')}
              title="Bold"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('*', '*')}
              title="Italic"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('- [ ] ')}
              title="Checklist Item"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <CheckSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => insertFormatting('```bash\n', '\n```')}
              title="Code Block"
              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <Code2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* View Toggles & Actions */}
          <div className="flex items-center space-x-2 shrink-0">
            <div className="bg-[#11111b] p-0.5 rounded-lg border border-white/10 flex items-center">
              <button
                onClick={() => setViewMode('edit')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'edit' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-white'
                }`}
              >
                Edit
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'split' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-white'
                }`}
              >
                Split
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'preview' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:text-white'
                }`}
              >
                Preview
              </button>
            </div>

            <button
              onClick={copyToClipboard}
              className="flex items-center space-x-1.5 text-xs px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors border border-white/5"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Note Body Canvas */}
        {!activeNote ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-xs space-y-2 select-none">
            <StickyNote className="w-10 h-10 text-gray-600/50" />
            <p className="text-gray-400 font-medium">No note selected</p>
            <p className="text-gray-600 text-[11px]">Click the + button above to create a new note.</p>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
          {/* Markdown Textarea */}
          {(viewMode === 'edit' || viewMode === 'split') && (
            <div className="flex-1 flex flex-col bg-[#14141e]/50 overflow-hidden border-r border-white/[0.05]">
              <textarea
                value={activeNote?.body || ''}
                onChange={e => updateBody(e.target.value)}
                placeholder="Start typing your markdown notes..."
                spellCheck={false}
                className="flex-1 bg-transparent p-5 font-mono text-xs text-[#cdd6f4] border-none outline-none resize-none placeholder-gray-600 leading-relaxed overflow-y-auto"
              />
            </div>
          )}

          {/* Live Rendered Markdown Preview */}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div className="flex-1 overflow-y-auto p-6 bg-[#181825] prose dark:prose-invert max-w-none text-xs leading-relaxed">
              <div className="text-gray-200 whitespace-pre-wrap font-sans">
                {activeNote?.body.split('\n').map((line, idx) => {
                  if (line.startsWith('# ')) {
                    return <h1 key={idx} className="text-lg font-bold text-white mb-2 pb-1 border-b border-white/10">{line.replace('# ', '')}</h1>;
                  }
                  if (line.startsWith('## ')) {
                    return <h2 key={idx} className="text-base font-semibold text-amber-300 mt-3 mb-1">{line.replace('## ', '')}</h2>;
                  }
                  if (line.startsWith('### ')) {
                    return <h3 key={idx} className="text-sm font-semibold text-blue-300 mt-2 mb-1">{line.replace('### ', '')}</h3>;
                  }
                  if (line.startsWith('- [x]')) {
                    return <div key={idx} className="flex items-center gap-2 text-emerald-400 my-0.5"><CheckSquare className="w-3.5 h-3.5" /> <span className="line-through opacity-70">{line.replace('- [x]', '')}</span></div>;
                  }
                  if (line.startsWith('- [ ]')) {
                    return <div key={idx} className="flex items-center gap-2 text-gray-300 my-0.5"><CheckSquare className="w-3.5 h-3.5 text-gray-500" /> <span>{line.replace('- [ ]', '')}</span></div>;
                  }
                  if (line.startsWith('```')) {
                    return <div key={idx} className="text-[10px] text-gray-500 font-mono my-0.5">{line}</div>;
                  }
                  if (line.startsWith('> ')) {
                    return <blockquote key={idx} className="border-l-2 border-amber-400 pl-3 italic text-gray-400 my-2">{line.replace('> ', '')}</blockquote>;
                  }
                  return <p key={idx} className="my-1 text-gray-300">{line}</p>;
                })}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Footer Status Bar */}
        <div className="h-6 bg-[#11111b] border-t border-white/[0.08] px-4 flex items-center justify-between text-[11px] font-mono text-gray-500 shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Auto-saved to Cloud Storage
          </span>
          <div className="flex items-center space-x-3">
            <span>{activeNote?.body.split(/\s+/).filter(Boolean).length || 0} words</span>
            <span>•</span>
            <span>{activeNote?.body.length || 0} characters</span>
          </div>
        </div>
      </div>
    </div>
  );
}

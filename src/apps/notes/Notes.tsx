import React, { useState, useEffect } from 'react';
import { StickyNote, Plus, Trash2, Copy, Check, FileText, Sparkles } from 'lucide-react';

interface NoteItem {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

const DEFAULT_NOTES: NoteItem[] = [
  {
    id: '1',
    title: 'Deployment Checklist',
    body: `# Production Deployment Checklist
1. Verify git commit tag
2. Pull latest docker images:
   \`docker compose pull\`
3. Run database migrations:
   \`docker compose exec api npm run migrate\`
4. Restart background workers
5. Check health status at /health
`,
    updatedAt: 'Today at 19:20'
  },
  {
    id: '2',
    title: 'Useful SSH Snippets',
    body: `# Common Admin Commands
# Find large files > 100MB
find / -type f -size +100M -exec ls -lh {} \\;

# Check active ports
ss -tulpn | grep LISTEN

# View live system logs
journalctl -f -u nginx
`,
    updatedAt: 'Yesterday'
  }
];

export default function Notes() {
  const [notes, setNotes] = useState<NoteItem[]>(() => {
    const saved = localStorage.getItem('clouddesk_notes');
    return saved ? JSON.parse(saved) : DEFAULT_NOTES;
  });
  const [activeNoteId, setActiveNoteId] = useState<string>(notes[0]?.id || '1');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem('clouddesk_notes', JSON.stringify(notes));
  }, [notes]);

  const activeNote = notes.find(n => n.id === activeNoteId) || notes[0];

  const updateBody = (newBody: string) => {
    const title = newBody.split('\n')[0].replace(/^#+\s*/, '') || 'Untitled Note';
    setNotes(prev =>
      prev.map(n =>
        n.id === activeNoteId
          ? { ...n, body: newBody, title: title.slice(0, 30), updatedAt: 'Just now' }
          : n
      )
    );
  };

  const createNote = () => {
    const newNote: NoteItem = {
      id: String(Date.now()),
      title: 'New Scratchpad',
      body: '# New Note\n\nType your notes here...',
      updatedAt: 'Just now'
    };
    setNotes([newNote, ...notes]);
    setActiveNoteId(newNote.id);
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

  return (
    <div className="flex h-full bg-[#181825] text-[#cdd6f4]">
      {/* Notes Sidebar */}
      <div className="w-56 bg-[#1e1e2e] border-r border-white/[0.08] flex flex-col shrink-0 select-none">
        <div className="p-3 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <StickyNote className="w-4 h-4 text-amber-400" />
            <span className="font-bold text-xs text-white">Scratchpad</span>
          </div>
          <button
            onClick={createNote}
            className="p-1 hover:bg-white/10 rounded text-gray-300 hover:text-white"
            title="Create Note"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {notes.map(note => (
            <div
              key={note.id}
              onClick={() => setActiveNoteId(note.id)}
              className={`p-2.5 rounded-lg cursor-pointer transition-colors group flex items-start justify-between ${
                activeNoteId === note.id ? 'bg-[var(--accent)] text-white' : 'hover:bg-white/5 text-gray-300'
              }`}
            >
              <div className="truncate flex-1">
                <div className="font-medium text-xs truncate">{note.title}</div>
                <div className="text-[10px] opacity-70 mt-0.5">{note.updatedAt}</div>
              </div>
              {notes.length > 1 && (
                <button
                  onClick={(e) => deleteNote(note.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-white/20 p-1 rounded transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Editor Main Canvas */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
        <div className="flex items-center justify-between bg-[#11111b] border-b border-white/[0.08] px-4 py-2 shrink-0">
          <span className="text-xs text-gray-400 font-medium">{activeNote?.title}</span>
          <button
            onClick={copyToClipboard}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 rounded bg-[#1e1e2e] hover:bg-[#313244] text-gray-300 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>

        <textarea
          value={activeNote?.body || ''}
          onChange={e => updateBody(e.target.value)}
          placeholder="Markdown notes..."
          className="flex-1 bg-transparent p-4 font-mono text-xs text-[#cdd6f4] border-none outline-none resize-none placeholder-gray-600 leading-relaxed"
        />

        <div className="h-6 bg-[#11111b] border-t border-white/[0.08] px-4 flex items-center justify-between text-[11px] font-mono text-gray-500 shrink-0">
          <span>Markdown Supported</span>
          <span>{activeNote?.body.length || 0} characters</span>
        </div>
      </div>
    </div>
  );
}

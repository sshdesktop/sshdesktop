import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  Check,
  Code2,
  Sparkles,
  Command,
  FileCode,
  Tag
} from 'lucide-react';
import {
  LanguageDefinition,
  ALL_LANGUAGES,
  POPULAR_LANGUAGES,
  searchLanguages,
  getLanguageDisplayName
} from './languages';

interface LanguagePickerModalProps {
  isOpen: boolean;
  currentLanguage: string;
  onSelectLanguage: (languageId: string) => void;
  onClose: () => void;
  fileName?: string;
}

export const LanguagePickerModal: React.FC<LanguagePickerModalProps> = ({
  isOpen,
  currentLanguage,
  onSelectLanguage,
  onClose,
  fileName,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  // Categories for filter pills
  const categories = useMemo(() => [
    'All',
    'Popular',
    'Programming',
    'Web & Styles',
    'Data & Config',
    'Scripting',
    'Database',
    'Markup',
  ], []);

  // Filtered languages based on search query and category
  const filteredLanguages = useMemo(() => {
    let list = searchLanguages(query);
    if (selectedCategory !== 'All' && !query) {
      if (selectedCategory === 'Popular') {
        list = POPULAR_LANGUAGES;
      } else {
        list = list.filter(l => l.category === selectedCategory);
      }
    }
    return list;
  }, [query, selectedCategory]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredLanguages]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [selectedIndex]);

  // Keyboard navigation (Arrow keys, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1 < filteredLanguages.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 >= 0 ? prev - 1 : filteredLanguages.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredLanguages[selectedIndex]) {
        onSelectLanguage(filteredLanguages[selectedIndex].id);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 p-4 animate-in fade-in duration-100 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#181825] border border-white/15 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-100 max-h-[80vh]"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header / Title */}
        <div className="px-4 py-2.5 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Code2 className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-semibold text-white tracking-wide">
              Select Language Mode
            </span>
            {fileName && (
              <span className="text-[10px] text-gray-400 font-mono bg-white/5 px-2 py-0.5 rounded truncate max-w-[200px]">
                for {fileName}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
              Current: <strong className="text-blue-400">{getLanguageDisplayName(currentLanguage)}</strong>
            </span>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white rounded hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-white/10 bg-[#14141e]/50">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                if (e.target.value && selectedCategory !== 'All') {
                  setSelectedCategory('All');
                }
              }}
              placeholder="Search language mode (e.g. ts, python, rust, docker, sql, json)..."
              className="w-full bg-[#11111b] border border-white/15 rounded-lg pl-9 pr-16 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
            />
            <div className="absolute right-2.5 flex items-center space-x-1.5 pointer-events-none">
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">
                ↑↓
              </kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">
                ↵ Select
              </kbd>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400 text-[10px] font-mono">
                Esc
              </kbd>
            </div>
          </div>

          {/* Quick Category Filter Pills */}
          {!query && (
            <div className="flex items-center space-x-1 mt-2.5 overflow-x-auto scrollbar-none pb-0.5">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap transition-all ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white font-semibold shadow-sm'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {cat === 'Popular' && <Sparkles className="w-2.5 h-2.5 inline mr-1 text-amber-300" />}
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Language List */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 space-y-0.5 max-h-[380px] scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
        >
          {filteredLanguages.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400">
              <FileCode className="w-8 h-8 mx-auto text-gray-600 mb-2 opacity-50" />
              No matching languages found for "{query}"
            </div>
          ) : (
            filteredLanguages.map((lang, index) => {
              const isCurrent = currentLanguage.toLowerCase() === lang.id.toLowerCase();
              const isHighlighted = selectedIndex === index;

              return (
                <div
                  key={`${lang.id}-${lang.label}`}
                  onClick={() => {
                    onSelectLanguage(lang.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`px-3 py-2 rounded-lg cursor-pointer flex items-center justify-between transition-colors ${
                    isHighlighted
                      ? 'bg-blue-600/25 border border-blue-500/40 text-white'
                      : isCurrent
                      ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
                      : 'text-gray-300 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : isHighlighted
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-white/5 text-gray-400'
                      }`}
                    >
                      <Code2 className="w-3.5 h-3.5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-semibold truncate font-mono">
                          {lang.label}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">
                          ({lang.id})
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.2 rounded-full font-sans font-medium">
                            Current
                          </span>
                        )}
                      </div>
                      
                      {/* Extensions / Filenames subtitle */}
                      <div className="text-[10px] text-gray-500 font-mono truncate max-w-sm mt-0.5">
                        {lang.extensions.slice(0, 5).join(' ')}
                        {lang.extensions.length > 5 && ` +${lang.extensions.length - 5} more`}
                        {lang.filenames && ` • ${lang.filenames.join(', ')}`}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 ml-2">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">
                      {lang.category}
                    </span>
                    {isCurrent ? (
                      <Check className="w-4 h-4 text-emerald-400" />
                    ) : isHighlighted ? (
                      <span className="text-[10px] text-blue-400 font-mono">↵</span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2 bg-[#14141e] border-t border-white/10 flex items-center justify-between text-[10px] text-gray-500 font-mono">
          <span>{filteredLanguages.length} languages supported</span>
          <span>Tip: Press Ctrl+K M anytime to switch language mode</span>
        </div>
      </div>
    </div>
  );
};

// ─── VS Code Full Language Registry & Detector ────────────────────────
// Provides complete VS Code & Monaco language mode support, metadata,
// file extension resolution, and search helpers.

export interface LanguageDefinition {
  id: string; // Monaco language ID
  label: string; // User-facing display name
  extensions: string[]; // Associated file extensions with leading dot
  filenames?: string[]; // Specific whole filenames
  aliases?: string[]; // Search aliases / abbreviations
  category: 'Popular' | 'Programming' | 'Web & Styles' | 'Data & Config' | 'Scripting' | 'Markup' | 'Database' | 'Systems' | 'Other';
}

export const ALL_LANGUAGES: LanguageDefinition[] = [
  // ── Popular / Common ──────────────────────────────────────────────
  {
    id: 'typescript',
    label: 'TypeScript',
    aliases: ['ts', 'tsx'],
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    category: 'Popular',
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    aliases: ['js', 'jsx', 'node', 'es6'],
    extensions: ['.js', '.jsx', '.mjs', '.cjs', '.es6'],
    category: 'Popular',
  },
  {
    id: 'python',
    label: 'Python',
    aliases: ['py', 'python3'],
    extensions: ['.py', '.pyw', '.pyx', '.pyd', '.pyi'],
    filenames: ['Pipfile'],
    category: 'Popular',
  },
  {
    id: 'rust',
    label: 'Rust',
    aliases: ['rs', 'cargo'],
    extensions: ['.rs'],
    category: 'Popular',
  },
  {
    id: 'go',
    label: 'Go (Golang)',
    aliases: ['golang'],
    extensions: ['.go'],
    category: 'Popular',
  },
  {
    id: 'c',
    label: 'C',
    aliases: ['h'],
    extensions: ['.c', '.h'],
    category: 'Popular',
  },
  {
    id: 'cpp',
    label: 'C++',
    aliases: ['c++', 'cc', 'cxx', 'hpp'],
    extensions: ['.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.c++', '.h++'],
    category: 'Popular',
  },
  {
    id: 'csharp',
    label: 'C#',
    aliases: ['c#', 'cs', 'dotnet'],
    extensions: ['.cs', '.csx'],
    category: 'Popular',
  },
  {
    id: 'java',
    label: 'Java',
    aliases: ['jvm'],
    extensions: ['.java', '.jav', '.jar', '.class'],
    category: 'Popular',
  },
  {
    id: 'html',
    label: 'HTML',
    aliases: ['htm', 'xhtml', 'vue', 'svelte'],
    extensions: ['.html', '.htm', '.xhtml', '.vue', '.svelte'],
    category: 'Popular',
  },
  {
    id: 'css',
    label: 'CSS',
    aliases: ['stylesheet'],
    extensions: ['.css'],
    category: 'Popular',
  },
  {
    id: 'scss',
    label: 'SCSS / SASS',
    aliases: ['sass'],
    extensions: ['.scss', '.sass'],
    category: 'Web & Styles',
  },
  {
    id: 'less',
    label: 'LESS',
    extensions: ['.less'],
    category: 'Web & Styles',
  },
  {
    id: 'json',
    label: 'JSON',
    aliases: ['jsonc', 'json5'],
    extensions: ['.json', '.json5', '.jsonc', '.eslintrc', '.prettierrc', '.babelrc', '.tsconfig.json'],
    category: 'Popular',
  },
  {
    id: 'yaml',
    label: 'YAML',
    aliases: ['yml'],
    extensions: ['.yaml', '.yml'],
    filenames: ['docker-compose.yml', 'docker-compose.yaml', '.gitlab-ci.yml'],
    category: 'Popular',
  },
  {
    id: 'xml',
    label: 'XML',
    aliases: ['svg', 'xaml'],
    extensions: ['.xml', '.svg', '.xaml', '.xsd', '.wsdl', '.plist', '.pom', '.config', '.nuspec'],
    category: 'Markup',
  },
  {
    id: 'markdown',
    label: 'Markdown',
    aliases: ['md'],
    extensions: ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'],
    category: 'Popular',
  },
  {
    id: 'shell',
    label: 'Shell Script (Bash / Zsh)',
    aliases: ['bash', 'sh', 'zsh', 'fish', 'terminal'],
    extensions: ['.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.bashrc', '.zshrc', '.profile', '.bash_profile'],
    filenames: ['Makefile', 'makefile', 'GNUmakefile', '.bashrc', '.zshrc', '.profile'],
    category: 'Popular',
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    aliases: ['ps', 'pwsh', 'ps1'],
    extensions: ['.ps1', '.psm1', '.psd1', '.ps1xml'],
    category: 'Popular',
  },
  {
    id: 'sql',
    label: 'SQL',
    aliases: ['database', 'query'],
    extensions: ['.sql', '.dsql'],
    category: 'Popular',
  },
  {
    id: 'pgsql',
    label: 'PostgreSQL',
    aliases: ['postgres'],
    extensions: ['.pgsql'],
    category: 'Database',
  },
  {
    id: 'mysql',
    label: 'MySQL',
    extensions: ['.mysql'],
    category: 'Database',
  },
  {
    id: 'dockerfile',
    label: 'Dockerfile',
    aliases: ['docker', 'container'],
    extensions: ['.dockerfile'],
    filenames: ['Dockerfile', 'dockerfile', 'Containerfile', '.dockerfile'],
    category: 'Popular',
  },
  {
    id: 'php',
    label: 'PHP',
    extensions: ['.php', '.phtml', '.php4', '.php5', '.phps'],
    category: 'Popular',
  },
  {
    id: 'ruby',
    label: 'Ruby',
    aliases: ['rb', 'rails', 'gem'],
    extensions: ['.rb', '.rbw', '.rake', '.gemspec'],
    filenames: ['Gemfile', 'Rakefile', 'Capfile', 'Vagrantfile'],
    category: 'Popular',
  },
  {
    id: 'perl',
    label: 'Perl',
    aliases: ['pl'],
    extensions: ['.pl', '.pm', '.pod', '.t'],
    category: 'Scripting',
  },
  {
    id: 'lua',
    label: 'Lua',
    extensions: ['.lua'],
    category: 'Scripting',
  },
  {
    id: 'kotlin',
    label: 'Kotlin',
    aliases: ['kt', 'android'],
    extensions: ['.kt', '.kts'],
    category: 'Programming',
  },
  {
    id: 'swift',
    label: 'Swift',
    aliases: ['apple', 'ios'],
    extensions: ['.swift'],
    category: 'Programming',
  },
  {
    id: 'dart',
    label: 'Dart / Flutter',
    aliases: ['flutter'],
    extensions: ['.dart'],
    category: 'Programming',
  },
  {
    id: 'r',
    label: 'R',
    aliases: ['rmd'],
    extensions: ['.r', '.rmd', '.Rprofile'],
    category: 'Programming',
  },
  {
    id: 'scala',
    label: 'Scala',
    aliases: ['sbt'],
    extensions: ['.scala', '.sc', '.sbt'],
    category: 'Programming',
  },
  {
    id: 'clojure',
    label: 'Clojure',
    aliases: ['clj', 'edn'],
    extensions: ['.clj', '.cljs', '.cljc', '.edn'],
    category: 'Programming',
  },
  {
    id: 'elixir',
    label: 'Elixir',
    aliases: ['ex', 'phoenix'],
    extensions: ['.ex', '.exs'],
    category: 'Programming',
  },
  {
    id: 'graphql',
    label: 'GraphQL',
    aliases: ['gql', 'prisma'],
    extensions: ['.graphql', '.gql', '.prisma'],
    category: 'Web & Styles',
  },
  {
    id: 'ini',
    label: 'INI / Config / Properties',
    aliases: ['conf', 'cfg', 'properties', 'env', 'dotenv'],
    extensions: ['.ini', '.cfg', '.conf', '.properties', '.env', '.env.example', '.env.local', '.env.production', '.editorconfig', '.gitconfig'],
    filenames: ['.env', 'nginx.conf', 'apache2.conf', 'httpd.conf', '.editorconfig', '.gitconfig'],
    category: 'Data & Config',
  },
  {
    id: 'ini',
    label: 'TOML',
    aliases: ['toml', 'cargo', 'pyproject'],
    extensions: ['.toml'],
    filenames: ['Cargo.toml', 'pyproject.toml'],
    category: 'Data & Config',
  },
  {
    id: 'bat',
    label: 'Batch (CMD)',
    aliases: ['cmd', 'dos'],
    extensions: ['.bat', '.cmd'],
    category: 'Scripting',
  },
  {
    id: 'hcl',
    label: 'Terraform / HCL',
    aliases: ['terraform', 'tf'],
    extensions: ['.tf', '.tfvars', '.hcl'],
    category: 'Data & Config',
  },
  {
    id: 'bicep',
    label: 'Bicep (Azure)',
    extensions: ['.bicep'],
    category: 'Data & Config',
  },
  {
    id: 'solidity',
    label: 'Solidity (Ethereum)',
    aliases: ['sol', 'crypto', 'smartcontract'],
    extensions: ['.sol'],
    category: 'Programming',
  },
  {
    id: 'handlebars',
    label: 'Handlebars',
    aliases: ['hbs'],
    extensions: ['.handlebars', '.hbs'],
    category: 'Web & Styles',
  },
  {
    id: 'razor',
    label: 'Razor (C# HTML)',
    aliases: ['cshtml'],
    extensions: ['.cshtml', '.razor'],
    category: 'Web & Styles',
  },
  {
    id: 'coffee',
    label: 'CoffeeScript',
    aliases: ['cson'],
    extensions: ['.coffee', '.cson'],
    category: 'Programming',
  },
  {
    id: 'objective-c',
    label: 'Objective-C',
    aliases: ['objc'],
    extensions: ['.m', '.mm'],
    category: 'Programming',
  },
  {
    id: 'vb',
    label: 'Visual Basic',
    aliases: ['vba', 'vbs'],
    extensions: ['.vb', '.vbs', '.bas'],
    category: 'Programming',
  },
  {
    id: 'fsharp',
    label: 'F#',
    aliases: ['f#', 'fs'],
    extensions: ['.fs', '.fsi', '.fsx'],
    category: 'Programming',
  },
  {
    id: 'julia',
    label: 'Julia',
    aliases: ['jl'],
    extensions: ['.jl'],
    category: 'Programming',
  },
  {
    id: 'pascal',
    label: 'Pascal',
    aliases: ['delphi'],
    extensions: ['.pas', '.pp'],
    category: 'Programming',
  },
  {
    id: 'protobuf',
    label: 'Protocol Buffers',
    aliases: ['proto'],
    extensions: ['.proto'],
    category: 'Data & Config',
  },
  {
    id: 'pug',
    label: 'Pug (Jade)',
    aliases: ['jade'],
    extensions: ['.pug', '.jade'],
    category: 'Web & Styles',
  },
  {
    id: 'twig',
    label: 'Twig',
    extensions: ['.twig'],
    category: 'Web & Styles',
  },
  {
    id: 'restructuredtext',
    label: 'reStructuredText',
    aliases: ['rst'],
    extensions: ['.rst'],
    category: 'Markup',
  },
  {
    id: 'mdx',
    label: 'MDX',
    extensions: ['.mdx'],
    category: 'Markup',
  },
  {
    id: 'systemverilog',
    label: 'SystemVerilog / Verilog',
    aliases: ['verilog'],
    extensions: ['.sv', '.svh', '.v'],
    category: 'Systems',
  },
  {
    id: 'scheme',
    label: 'Scheme / Lisp',
    aliases: ['lisp'],
    extensions: ['.scm', '.ss', '.lisp', '.lsp'],
    category: 'Programming',
  },
  {
    id: 'tcl',
    label: 'Tcl',
    extensions: ['.tcl'],
    category: 'Scripting',
  },
  {
    id: 'wgsl',
    label: 'WebGPU Shading (WGSL)',
    extensions: ['.wgsl'],
    category: 'Systems',
  },
  {
    id: 'apex',
    label: 'Apex (Salesforce)',
    extensions: ['.cls', '.trigger'],
    category: 'Programming',
  },
  {
    id: 'abap',
    label: 'ABAP (SAP)',
    extensions: ['.abap'],
    category: 'Programming',
  },
  {
    id: 'azcli',
    label: 'Azure CLI',
    extensions: ['.azcli'],
    category: 'Scripting',
  },
  {
    id: 'sparql',
    label: 'SPARQL',
    extensions: ['.rq', '.sparql'],
    category: 'Database',
  },
  {
    id: 'redis',
    label: 'Redis',
    extensions: ['.redis'],
    category: 'Database',
  },
  {
    id: 'cypher',
    label: 'Cypher (Neo4j)',
    extensions: ['.cyp', '.cypher'],
    category: 'Database',
  },
  {
    id: 'liquid',
    label: 'Liquid (Shopify)',
    extensions: ['.liquid'],
    category: 'Web & Styles',
  },
  {
    id: 'typespec',
    label: 'TypeSpec (CADL)',
    extensions: ['.tsp'],
    category: 'Data & Config',
  },
  {
    id: 'plaintext',
    label: 'Plain Text',
    aliases: ['text', 'txt', 'none'],
    extensions: ['.txt', '.log', '.out', '.diff', '.patch'],
    category: 'Popular',
  },
];

// Curated Popular Languages for quick one-click shortcuts
export const POPULAR_LANGUAGES: LanguageDefinition[] = ALL_LANGUAGES.filter(
  lang => lang.category === 'Popular'
);

// ─── Detect Language by Filename / Path ──────────────────────────────
export function detectLanguage(filename: string): string {
  if (!filename) return 'plaintext';

  // Extract basename (handle paths like /etc/nginx/nginx.conf)
  const base = filename.split('/').pop()?.split('\\').pop() || filename;
  const lowerBase = base.toLowerCase();

  // 1. Check exact whole filename matches first
  for (const lang of ALL_LANGUAGES) {
    if (lang.filenames && lang.filenames.some(f => f.toLowerCase() === lowerBase)) {
      return lang.id;
    }
  }

  // 2. Specific well-known Linux / Server filenames
  if (lowerBase === 'dockerfile' || lowerBase.startsWith('dockerfile.')) return 'dockerfile';
  if (lowerBase === 'makefile' || lowerBase === 'gnumakefile') return 'shell';
  if (lowerBase.startsWith('.env')) return 'ini';
  if (lowerBase === '.gitignore' || lowerBase === '.npmignore' || lowerBase === '.dockerignore') return 'shell';
  if (lowerBase.endsWith('.conf') || lowerBase.endsWith('.cfg') || lowerBase.endsWith('.ini')) return 'ini';
  if (lowerBase === 'cargo.lock' || lowerBase === 'package-lock.json') return 'json';

  // 3. Check file extension
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = base.substring(dotIndex).toLowerCase();
    
    // Check known extensions
    for (const lang of ALL_LANGUAGES) {
      if (lang.extensions.includes(ext)) {
        return lang.id;
      }
    }
  }

  return 'plaintext';
}

// ─── Get User-Friendly Display Name ──────────────────────────────────
export function getLanguageDisplayName(languageId: string): string {
  if (!languageId) return 'Plain Text';
  const cleanId = languageId.toLowerCase().trim();

  // Look for exact id match
  const found = ALL_LANGUAGES.find(l => l.id.toLowerCase() === cleanId);
  if (found) return found.label;

  // Fallback alias lookup
  const byAlias = ALL_LANGUAGES.find(l => l.aliases?.includes(cleanId));
  if (byAlias) return byAlias.label;

  // Pretty capitalization fallback
  return cleanId.charAt(0).toUpperCase() + cleanId.slice(1);
}

// ─── Search / Filter Languages ───────────────────────────────────────
export function searchLanguages(query: string): LanguageDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_LANGUAGES;

  const results: { lang: LanguageDefinition; score: number }[] = [];

  for (const lang of ALL_LANGUAGES) {
    let score = 0;
    const labelLower = lang.label.toLowerCase();
    const idLower = lang.id.toLowerCase();

    // Exact match gets highest priority
    if (idLower === q || labelLower === q) {
      score += 100;
    } else if (labelLower.startsWith(q) || idLower.startsWith(q)) {
      score += 50;
    } else if (labelLower.includes(q) || idLower.includes(q)) {
      score += 25;
    }

    // Check aliases
    if (lang.aliases?.some(a => a.toLowerCase() === q)) {
      score += 40;
    } else if (lang.aliases?.some(a => a.toLowerCase().includes(q))) {
      score += 15;
    }

    // Check extensions (e.g. searching ".py" or "py")
    const cleanExt = q.startsWith('.') ? q : `.${q}`;
    if (lang.extensions.includes(cleanExt)) {
      score += 35;
    } else if (lang.extensions.some(e => e.includes(q))) {
      score += 10;
    }

    if (score > 0) {
      results.push({ lang, score });
    }
  }

  // Sort descending by relevance score, then alphabetical
  results.sort((a, b) => b.score - a.score || a.lang.label.localeCompare(b.lang.label));

  return results.map(r => r.lang);
}

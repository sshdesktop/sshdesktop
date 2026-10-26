import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { X, Copy, Check, Code2, Download } from 'lucide-react';
import { ApiTabState } from '../types';

interface CodeSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: ApiTabState;
}

type SnippetLang = 'curl' | 'js_fetch' | 'python_requests' | 'go' | 'rust';

const MONACO_LANG_MAP: Record<SnippetLang, { monacoLang: string; fileExt: string }> = {
  curl: { monacoLang: 'shell', fileExt: 'sh' },
  js_fetch: { monacoLang: 'javascript', fileExt: 'js' },
  python_requests: { monacoLang: 'python', fileExt: 'py' },
  go: { monacoLang: 'go', fileExt: 'go' },
  rust: { monacoLang: 'rust', fileExt: 'rs' },
};

export default function CodeSnippetModal({ isOpen, onClose, request }: CodeSnippetModalProps) {
  const [lang, setLang] = useState<SnippetLang>('curl');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const generateSnippet = (language: SnippetLang): string => {
    const url = request.url;
    const method = request.method;
    const activeHeaders = request.headers.filter(h => h.enabled && h.key.trim());

    switch (language) {
      case 'curl': {
        let cmd = `curl --request ${method} \\\n  --url '${url}'`;
        for (const h of activeHeaders) {
          cmd += ` \\\n  --header '${h.key}: ${h.value}'`;
        }
        if (request.bodyType === 'json' && request.rawBody.trim()) {
          cmd += ` \\\n  --header 'Content-Type: application/json'`;
          cmd += ` \\\n  --data '${request.rawBody.replace(/'/g, "'\\''")}'`;
        }
        return cmd;
      }
      case 'js_fetch': {
        const headersObj: Record<string, string> = {};
        for (const h of activeHeaders) {
          headersObj[h.key] = h.value;
        }
        let code = `const url = '${url}';\n`;
        code += `const options = {\n`;
        code += `  method: '${method}',\n`;
        if (Object.keys(headersObj).length > 0) {
          code += `  headers: ${JSON.stringify(headersObj, null, 2).replace(/\n/g, '\n  ')},\n`;
        }
        if (request.bodyType === 'json' && request.rawBody.trim()) {
          code += `  body: JSON.stringify(${request.rawBody.replace(/\n/g, '\n  ')})\n`;
        }
        code += `};\n\n`;
        code += `try {\n`;
        code += `  const response = await fetch(url, options);\n`;
        code += `  const data = await response.json();\n`;
        code += `  console.log(data);\n`;
        code += `} catch (error) {\n`;
        code += `  console.error(error);\n`;
        code += `}`;
        return code;
      }
      case 'python_requests': {
        let code = `import requests\n\n`;
        code += `url = "${url}"\n`;
        if (activeHeaders.length > 0) {
          code += `headers = {\n`;
          for (const h of activeHeaders) {
            code += `    "${h.key}": "${h.value}",\n`;
          }
          code += `}\n`;
        } else {
          code += `headers = {}\n`;
        }
        if (request.bodyType === 'json' && request.rawBody.trim()) {
          code += `payload = ${request.rawBody}\n`;
          code += `response = requests.${method.toLowerCase()}(url, json=payload, headers=headers)\n`;
        } else {
          code += `response = requests.${method.toLowerCase()}(url, headers=headers)\n`;
        }
        code += `print(response.status_code)\n`;
        code += `print(response.json())`;
        return code;
      }
      case 'go': {
        let code = `package main\n\nimport (\n\t"fmt"\n\t"io"\n\t"net/http"\n)\n\nfunc main() {\n`;
        code += `\turl := "${url}"\n`;
        code += `\treq, err := http.NewRequest("${method}", url, nil)\n`;
        code += `\tif err != nil {\n\t\tpanic(err)\n\t}\n\n`;
        for (const h of activeHeaders) {
          code += `\treq.Header.Add("${h.key}", "${h.value}")\n`;
        }
        code += `\n\tres, err := http.DefaultClient.Do(req)\n`;
        code += `\tif err != nil {\n\t\tpanic(err)\n\t}\n`;
        code += `\tdefer res.Body.Close()\n\n`;
        code += `\tbody, _ := io.ReadAll(res.Body)\n`;
        code += `\tfmt.Println(string(body))\n}`;
        return code;
      }
      case 'rust': {
        let code = `use reqwest::header;\n\n#[tokio::main]\nasync fn main() -> Result<(), Box<dyn std::error::Error>> {\n`;
        code += `    let client = reqwest::Client::new();\n`;
        code += `    let res = client.${method.toLowerCase()}("${url}")\n`;
        for (const h of activeHeaders) {
          code += `        .header("${h.key}", "${h.value}")\n`;
        }
        if (request.bodyType === 'json' && request.rawBody.trim()) {
          code += `        .header("Content-Type", "application/json")\n`;
          code += `        .body(r#"${request.rawBody}"#)\n`;
        }
        code += `        .send()\n        .await?;\n\n`;
        code += `    println!("Status: {}", res.status());\n`;
        code += `    println!("Body: {}", res.text().await?);\n`;
        code += `    Ok(())\n}`;
        return code;
      }
    }
  };

  const codeSnippet = generateSnippet(lang);
  const langConfig = MONACO_LANG_MAP[lang] || MONACO_LANG_MAP.curl;

  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([codeSnippet], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api_request_${lang}.${langConfig.fileExt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 select-none animate-in fade-in">
      <div 
        className="w-full max-w-2xl bg-[#1e1e2e] border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-[#181825]">
          <div className="flex items-center space-x-2">
            <Code2 className="w-4 h-4 text-blue-400" />
            <span className="font-semibold text-sm text-gray-200">Export Request Code Snippet</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Language Tabs */}
        <div className="flex items-center space-x-1 px-5 pt-3 border-b border-white/10 bg-[#14141e]/50 text-xs">
          {[
            { id: 'curl', label: 'cURL' },
            { id: 'js_fetch', label: 'JavaScript (fetch)' },
            { id: 'python_requests', label: 'Python (requests)' },
            { id: 'go', label: 'Go' },
            { id: 'rust', label: 'Rust (reqwest)' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setLang(item.id as SnippetLang)}
              className={`px-3 py-1.5 rounded-t-lg font-medium transition-colors border-b-2 ${
                lang === item.id
                  ? 'border-blue-500 text-blue-400 bg-white/5 font-semibold'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Code Block with Monaco Editor */}
        <div className="p-5 space-y-3 bg-[#11111b] relative">
          <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#0f111a] h-72 shadow-inner">
            <Editor
              height="100%"
              language={langConfig.monacoLang}
              theme="vs-dark"
              value={codeSnippet}
              options={{
                readOnly: true,
                domReadOnly: true,
                fontSize: 13,
                wordWrap: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                lineNumbers: 'on',
                bracketPairColorization: { enabled: true },
                padding: { top: 12, bottom: 12 },
              }}
              loading={
                <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">
                  Colorizing Code Snippet...
                </div>
              }
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-gray-500 font-mono">
              Ready to copy and execute in your terminal or application
            </span>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleDownload}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors border border-white/10 cursor-pointer"
                title={`Download ${langConfig.fileExt.toUpperCase()} file`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-md active:scale-95 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Snippet'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

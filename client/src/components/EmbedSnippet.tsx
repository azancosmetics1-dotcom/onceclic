import React, { useState } from 'react';
import { Copy, Check, ExternalLink, Code } from 'lucide-react';

interface EmbedSnippetProps {
  slug: string;
}

export const EmbedSnippet: React.FC<EmbedSnippetProps> = ({ slug }) => {
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const origin = window.location.origin;
  const hostedUrl = `${origin}/chat/${slug}`;

  const embedScript = `<!-- ONCEClic AI Receptionist Widget -->
<script>
  window.ONCECLIC_CONFIG = { orgSlug: "${slug}" };
</script>
<script src="${origin}/widget.js" async></script>`;

  const copyToClipboard = (text: string, type: 'script' | 'link') => {
    navigator.clipboard.writeText(text);
    if (type === 'script') {
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
      <div>
        <h3 className="text-base font-semibold text-white flex items-center space-x-2">
          <Code className="w-5 h-5 text-emerald-400" />
          <span>Website Chat Integration</span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Install the AI receptionist on your website with one simple line of code or share your public link.
        </p>
      </div>

      {/* Hosted URL */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Hosted Public Chat Link
        </label>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            readOnly
            value={hostedUrl}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-slate-300 font-mono focus:outline-none"
          />
          <button
            onClick={() => copyToClipboard(hostedUrl, 'link')}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-medium rounded-lg transition flex items-center space-x-1.5 shrink-0"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Copied' : 'Copy'}</span>
          </button>
          <a
            href={hostedUrl}
            target="_blank"
            rel="noreferrer"
            className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition"
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Script Embed */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Website Embed Snippet (Paste into HTML)
        </label>
        <div className="relative">
          <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs font-mono text-emerald-400 overflow-x-auto">
            {embedScript}
          </pre>
          <button
            onClick={() => copyToClipboard(embedScript, 'script')}
            className="absolute top-3 right-3 px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md transition flex items-center space-x-1.5 shadow"
          >
            {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedScript ? 'Copied' : 'Copy Code'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

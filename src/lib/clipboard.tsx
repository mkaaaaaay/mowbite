import {useState} from 'react';
import {tr} from './i18n';

// copies in plain http too, where navigator.clipboard isn't there
export function copyText(text: string) {
  if (navigator.clipboard) return void navigator.clipboard.writeText(text).catch(() => {});
  const t = document.createElement('textarea');
  t.value = text;
  document.body.appendChild(t);
  t.select();
  document.execCommand('copy');
  t.remove();
}

// a button that copies the text, "copied" on it for a moment
export function CopyButton({text, className}: {text: string; className?: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={() => {
        copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? tr('copied') : tr('Copy')}
    </button>
  );
}

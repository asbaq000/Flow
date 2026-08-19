/**
 * Whitelist sanitizer for block content. The editor stores inline HTML
 * (bold/italic/code/links/mentions), so anything pasted in has to be scrubbed
 * before it is persisted or re-rendered.
 */

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'CODE', 'A', 'BR', 'SPAN']);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel']),
  SPAN: new Set(['class', 'data-user-id']),
};

function isSafeHref(href: string): boolean {
  const value = href.trim().toLowerCase();
  return (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('mailto:') ||
    value.startsWith('/') ||
    value.startsWith('#')
  );
}

/** Runs in the browser only — relies on DOMParser. */
export function sanitizeInline(html: string): string {
  if (typeof window === 'undefined') return stripTags(html);

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) return '';

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // Keep the text, drop the wrapper.
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const allowed = ALLOWED_ATTRS[child.tagName] ?? new Set<string>();
      for (const attr of Array.from(child.attributes)) {
        if (!allowed.has(attr.name)) {
          child.removeAttribute(attr.name);
          continue;
        }
        if (attr.name === 'href' && !isSafeHref(attr.value)) child.removeAttribute('href');
        if (attr.name === 'class' && attr.value !== 'mention') child.removeAttribute('class');
      }
      if (child.tagName === 'A' && child.getAttribute('href')) {
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      walk(child);
    }
  };

  walk(root);
  return root.innerHTML;
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** Escapes a plain string for safe insertion into innerHTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

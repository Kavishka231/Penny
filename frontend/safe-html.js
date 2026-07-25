const HTML_ESCAPE_PATTERN = /[&<>"']/g;
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  return String(value ?? '').replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character]);
}

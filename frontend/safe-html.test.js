import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from './safe-html.js';

test('escapes malicious image markup so it is displayed as text', () => {
  const payload = '<img src=x onerror=alert(1)>';
  const rendered = `<td>${escapeHtml(payload)}</td>`;

  assert.equal(rendered, '<td>&lt;img src=x onerror=alert(1)&gt;</td>');
  assert.equal(rendered.includes('<img'), false);
  assert.equal(rendered.includes('onerror='), true);
});

test('escapes markup and attribute delimiters in user-controlled values', () => {
  const payload = `"><script>alert('xss')</script>`;
  const rendered = `<option value="${escapeHtml(payload)}">${escapeHtml(payload)}</option>`;

  assert.equal(
    rendered,
    '<option value="&quot;&gt;&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;">&quot;&gt;&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;</option>'
  );
  assert.equal(rendered.includes('<script>'), false);
});

test('preserves normal finance data while safely stringifying values', () => {
  assert.equal(escapeHtml('Fresh Mart & Cafe'), 'Fresh Mart &amp; Cafe');
  assert.equal(escapeHtml(125.5), '125.5');
  assert.equal(escapeHtml(null), '');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { markdownHtmlPlugins } from '../src/lib/markdownHtml.js';

test('Markdown renders common README HTML and removes unsafe markup', () => {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    rehypePlugins: markdownHtmlPlugins,
    children: '<p align="center"><img src="https://example.com/logo.svg" width="200" onerror="alert(1)"></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
  }));
  assert.match(html, /<p align="center">/);
  assert.match(html, /<img src="https:\/\/example\.com\/logo\.svg" width="200"/);
  assert.doesNotMatch(html, /onerror|<script|javascript:/i);
});

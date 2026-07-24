/**
 * Element picker compatible with OpenDesign's iframe message protocol.
 * Protocol reference: nexu-io/open-design apps/web/src/runtime/srcdoc.ts
 * Reviewed at upstream commit f2760fdf335775bc35cc19521e6fad2f114c3571 (Apache-2.0).
 */
export const OPEN_DESIGN_UPSTREAM_COMMIT = 'f2760fdf335775bc35cc19521e6fad2f114c3571';
const MARKER = 'data-apollo-site-inspector';

const BRIDGE = String.raw`<script ${MARKER}>
(() => {
  if (window.__apolloSiteInspector) return;
  window.__apolloSiteInspector = true;
  let enabled = false;
  let target = null;
  const overlay = document.createElement('div');
  const badge = document.createElement('div');
  Object.assign(overlay.style, { position: 'fixed', display: 'none', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid #2563eb', background: 'rgba(37,99,235,.08)', boxSizing: 'border-box' });
  Object.assign(badge.style, { position: 'absolute', left: '-2px', bottom: '100%', maxWidth: '280px', padding: '3px 6px', overflow: 'hidden', color: '#fff', background: '#2563eb', font: '11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  overlay.appendChild(badge);

  const text = (element, max = 400) => (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const label = (element) => {
    const id = element.id ? '#' + element.id : '';
    const classes = Array.from(element.classList).slice(0, 2).map((name) => '.' + name).join('');
    return (element.tagName.toLowerCase() + id + classes).slice(0, 160);
  };
  const selector = (element) => {
    const odId = element.getAttribute('data-od-id');
    if (odId && document.querySelectorAll('[data-od-id="' + CSS.escape(odId) + '"]').length === 1) return '[data-od-id="' + CSS.escape(odId) + '"]';
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    const parts = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter((item) => item.tagName === node.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
      if (node === document.body) break;
    }
    return parts.join(' > ');
  };
  const pick = (start) => {
    if (!(start instanceof Element) || start === overlay || overlay.contains(start)) return null;
    const meaningful = start.closest('a,button,input,select,textarea,label,summary,[role],[aria-label],[title],h1,h2,h3,h4,h5,h6,p,li,td,th');
    const element = meaningful && document.body.contains(meaningful) ? meaningful : start;
    return /^(SCRIPT|STYLE|TEMPLATE|META|LINK|HEAD|HTML)$/.test(element.tagName) ? null : element;
  };
  const draw = () => {
    if (!enabled || !target || !document.contains(target)) return overlay.style.display = 'none';
    const rect = target.getBoundingClientRect();
    Object.assign(overlay.style, { display: rect.width && rect.height ? 'block' : 'none', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    badge.textContent = label(target);
  };
  const setEnabled = (next) => {
    enabled = next;
    target = null;
    if (enabled) {
      if (!overlay.isConnected) document.documentElement.appendChild(overlay);
    } else {
      overlay.style.display = 'none';
    }
  };
  const snapshot = (element, clicked) => {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const result = {
      type: 'od:comment-target',
      elementId: element.getAttribute('data-od-id') || 'dom:' + selector(element),
      selector: selector(element),
      label: label(element),
      text: text(element),
      position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      htmlHint: element.outerHTML.slice(0, 1200),
      style: {
        display: computed.display,
        position: computed.position,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight,
        padding: computed.padding,
        margin: computed.margin,
        border: computed.border,
        borderRadius: computed.borderRadius,
      },
    };
    if (clicked !== element) result.clickedDescendant = { selector: selector(clicked), label: label(clicked), text: text(clicked, 160) };
    return result;
  };

  addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'od:comment-mode' || event.data.type === 'od:inspect-mode') setEnabled(event.data.enabled === true);
  });
  addEventListener('pointermove', (event) => { if (enabled) { target = pick(event.target); draw(); } }, true);
  addEventListener('scroll', draw, true);
  addEventListener('resize', draw);
  addEventListener('click', (event) => {
    if (!enabled) return;
    const raw = event.target instanceof Element ? event.target : null;
    const clicked = pick(raw);
    if (!clicked || !raw) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    parent.postMessage(snapshot(clicked, raw), '*');
    target = clicked;
    draw();
  }, true);
  addEventListener('keydown', (event) => {
    if (enabled && event.key === 'Escape') {
      event.preventDefault();
      setEnabled(false);
      parent.postMessage({ type: 'apollo:picker-cancelled' }, '*');
    }
  }, true);
  parent.postMessage({ type: 'apollo:inspector-ready' }, '*');
})();
</script>`;

export function injectSiteInspector(html: string): string {
  if (html.includes(MARKER)) return html;
  const bodyEnd = html.search(/<\/body\s*>/i);
  if (bodyEnd >= 0) return `${html.slice(0, bodyEnd)}${BRIDGE}${html.slice(bodyEnd)}`;
  const htmlEnd = html.search(/<\/html\s*>/i);
  if (htmlEnd >= 0) return `${html.slice(0, htmlEnd)}${BRIDGE}${html.slice(htmlEnd)}`;
  return `${html}${BRIDGE}`;
}

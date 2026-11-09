'use strict';
// Documentation viewer (minimal Markdown rendering).
window.VMTL_PAGE = async function () {
  const view = VMTL.view;
  view.innerHTML = VMTL.pageHead('Documentation', 'Project and system reference.') + '<div class="grid cols-2" style="grid-template-columns:260px 1fr"><div class="card" id="docList"><div class="loading"><span class="spinner"></span></div></div><div class="card pad" id="docView"><div class="dim">Select a document.</div></div></div>';
  let docs; try { docs = (await VMTL.api('/admin/documentation')).data; } catch (e) { view.querySelector('#docList').innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; return; }
  view.querySelector('#docList').innerHTML = docs.map((d) => `<a class="nav-link" data-slug="${d.slug}" style="border-radius:0"><span><div style="font-weight:600">${VMTL.esc(d.title)}</div><div class="dim" style="font-size:12px">${VMTL.esc(d.summary)}</div></span></a>`).join('');
  const open = async (slug) => {
    const panel = view.querySelector('#docView'); panel.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try { const d = (await VMTL.api(`/admin/documentation/${slug}`)).data; panel.innerHTML = md(d.content); } catch (e) { panel.innerHTML = `<div class="empty">${VMTL.esc(e.message)}</div>`; }
  };
  view.querySelectorAll('[data-slug]').forEach((a) => a.onclick = () => open(a.dataset.slug));
  if (docs.length) open(docs[0].slug);
};
// Tiny Markdown: headings, bold, lists, paragraphs (content is trusted, server-authored).
function md(src) {
  const esc = VMTL.esc;
  const lines = String(src).split('\n'); const out = []; let inList = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  for (const line of lines) {
    if (/^### /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h4>${inline(line.slice(4))}</h4>`); }
    else if (/^## /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h3>${inline(line.slice(3))}</h3>`); }
    else if (/^# /.test(line)) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h2>${inline(line.slice(2))}</h2>`); }
    else if (/^\s*[-*] /.test(line)) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(line.replace(/^\s*[-*] /, ''))}</li>`); }
    else if (line.trim() === '') { if (inList) { out.push('</ul>'); inList = false; } }
    else { if (inList) { out.push('</ul>'); inList = false; } out.push(`<p>${inline(line)}</p>`); }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const topics = ['index','windows','linux','raspberry-pi','usage','network-cameras','operations','architecture','saas','github'];
const titles = {
  de: ['Willkommen','Windows','Linux & Server','Raspberry Pi','Kameras & KI','Netzwerkkameras','Betrieb & Sicherheit','Handy & Architektur','Lokaler Betrieb & Hilfe','GitHub & Lizenz'],
  en: ['Welcome','Windows','Linux & servers','Raspberry Pi','Cameras & AI','Network cameras','Operations & security','Mobile & architecture','Local operation & help','GitHub & licensing'],
};
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function inline(text) {
  return text.split(/(`[^`]+`)/).map(part => {
    if (part.startsWith('`')) return '<code>'+escape(part.slice(1,-1))+'</code>';
    return escape(part).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, title, url) => {
      const local = /^([a-z-]+)(\.en)?\.md$/.exec(url);
      if (local && topics.includes(local[1])) return `<a href="#${local[1]}" data-topic="${local[1]}">${title}</a>`;
      if (url === '../LICENSE.md') return `<a href="/license.txt">${title}</a>`;
      if (!/^https?:\/\//.test(url)) return title;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>`;
    });
  }).join('');
}
export function renderMarkdown(markdown) {
  const result = []; let code = false, list = false, paragraph = [];
  const flush = () => { if (paragraph.length) result.push('<p>'+inline(paragraph.join(' '))+'</p>'); paragraph=[]; };
  const closeList = () => { if(list) result.push('</ul>'); list=false; };
  for (const line of markdown.replaceAll('\r','').split('\n')) {
    if (line.startsWith('```')) { flush();closeList();result.push(code?'</code></pre>':'<pre><code>');code=!code;continue; }
    if(code) { result.push(escape(line));continue; }
    if(!line.trim()) { flush();closeList();continue; }
    const image = /^!\[([^\]]+)\]\(\.\.\/public\/docs-media\/([a-z0-9-]+\.webp)\)$/.exec(line);
    if (image) {
      flush(); closeList();
      result.push(`<figure><img src="/docs-media/${image[2]}" alt="${escape(image[1])}" loading="lazy"><figcaption>${escape(image[1])}</figcaption></figure>`);
      continue;
    }
    const heading=/^(#{1,3}) (.+)$/.exec(line);
    if(heading) {flush();closeList();result.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);continue;}
    if(line.startsWith('- ')) {flush();if(!list)result.push('<ul>');list=true;result.push('<li>'+inline(line.slice(2))+'</li>');continue;}
    closeList();paragraph.push(line);
  }
  flush();closeList();if(code)result.push('</code></pre>');return result.join('\n');
}
export async function buildDocs() {
  const articles=[];
  for(const language of ['de','en']) for(const topic of topics){
    const markdown=await readFile(resolve(root,'docs',topic+(language==='en'?'.en':'')+'.md'),'utf8');
    articles.push(`<article data-language="${language}" data-document="${topic}"${language==='de'&&topic==='index'?'':' hidden'}>${renderMarkdown(markdown)}</article>`);
  }
  const navigation = topics.map((topic,index)=>`<a href="#${topic}" data-topic="${topic}" data-de="${titles.de[index]}" data-en="${titles.en[index]}">${titles.de[index]}</a>`).join('');
  const html=`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#19362f"><title>Türwache · Dokumentation</title><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/docs.css"><script src="/docs.js" defer></script></head><body><header><a class="brand" href="/docs"><img src="/icon.svg" width="32" height="32" alt="">türwache<span>.</span></a><span class="header-label" data-de="Dokumentation" data-en="Documentation">Dokumentation</span><div class="header-actions"><button type="button" data-language-button="de" aria-pressed="true">DE</button><button type="button" data-language-button="en" aria-pressed="false">EN</button><a class="back" href="/" data-de="Zur App ↗" data-en="Open app ↗">Zur App ↗</a></div></header><div class="layout"><aside><p class="eyebrow" data-de="DEIN KAMERASERVER" data-en="YOUR CAMERA SERVER">DEIN KAMERASERVER</p><nav aria-label="Documentation">${navigation}</nav><p class="version">Version 0.13.0<br><span data-de="Anleitungen · privat betreiben" data-en="Source documentation · private hosting">Anleitungen · privat betreiben</span></p></aside><main id="content">${articles.join('\n')}</main><noscript>Diese Doku nutzt JavaScript zum Seitenwechsel. Alle Anleitungen liegen auch unter docs/ im Repository. Documentation is also available as Markdown in docs/.</noscript></div></body></html>`;
  await Promise.all([
    writeFile(resolve(root,'public/docs.html'),html),
    readFile(resolve(root,'LICENSE.md'),'utf8').then(license => writeFile(resolve(root,'public/license.txt'),license)),
  ]);
  return html;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){await buildDocs();console.log(`Built ${topics.length} documentation pages in German and English.`);}

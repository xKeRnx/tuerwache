(() => {
  let language = 'de';
  try { language=localStorage.getItem('tuerwache.language')==='en'?'en':'de'; } catch {}
  const topics=[...document.querySelectorAll('nav a[data-topic]')].map(link => link.dataset.topic);
  function render() {
    const topic=topics.includes(location.hash.slice(1))?location.hash.slice(1):'index';
    document.documentElement.lang=language;
    document.title='Türwache · '+(language==='de'?'Dokumentation':'Documentation');
    for(const article of document.querySelectorAll('article[data-document]')) article.hidden=article.dataset.language!==language||article.dataset.document!==topic;
    for(const item of document.querySelectorAll('[data-de][data-en]')) item.textContent=item.dataset[language];
    for(const button of document.querySelectorAll('[data-language-button]'))button.setAttribute('aria-pressed',String(button.dataset.languageButton===language));
    for(const link of document.querySelectorAll('nav a')){if(link.dataset.topic===topic)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
    window.scrollTo(0,0);
  }
  for(const button of document.querySelectorAll('[data-language-button]'))button.addEventListener('click',()=>{language=button.dataset.languageButton;try{localStorage.setItem('tuerwache.language',language);}catch{}render();});
  window.addEventListener('hashchange',render);render();
})();

// app/shared/ui.js — 共通UIヘルパ。ページはこれと Store だけに依存する
window.UI = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g,
    m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const STATUS = { scheduled:'予定', in_progress:'対応中', submitted:'報告済', confirmed:'確認済' };
  const fmtDate = iso => { if(!iso) return '—'; const d=new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`; };
  const fmtTime = iso => { if(!iso) return ''; const d=new Date(iso);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`; };
  const fmtYen = n => n==null||n==='' ? '—' : '¥'+Number(n).toLocaleString('ja-JP');
  const statusBadge = s => `<span class="badge ${esc(s)}">${STATUS[s]||s}</span>`;
  function tabbar(active){
    const t=[['index.html','🏠','今日'],['list.html','📋','案件'],['settings.html','⚙️','設定']];
    document.body.insertAdjacentHTML('beforeend',
      `<nav class="tabbar">${t.map(([href,ic,label])=>
        `<a href="${href}" class="${label===active?'active':''}"><span class="ic">${ic}</span>${label}</a>`).join('')}</nav>`);
  }
  let toastEl;
  function toast(msg){ if(!toastEl){ toastEl=document.createElement('div');
      toastEl.className='toast'; document.body.appendChild(toastEl); }
    toastEl.textContent=msg; toastEl.classList.add('show');
    setTimeout(()=>toastEl.classList.remove('show'),2200); }
  const qs = k => new URLSearchParams(location.search).get(k);
  return { esc, fmtDate, fmtTime, fmtYen, statusBadge, tabbar, toast, qs, STATUS };
})();

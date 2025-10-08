// =========================================
// file: assets/publications.js  (REPLACE)
// =========================================
/* WHY: include Article + Review + Editorial so numbers match Scopus */
const DATA_PATH = "/data/scopus/scopus.json";   // works from any subfolder
const app = document.getElementById("pub-app");
const AUTHOR_ID = app?.dataset.authorId || "";
const ALLOWED_TYPES = ["article","review","editorial"]; // adjust if needed

function computeH(cs){ const s=cs.slice().sort((a,b)=>b-a); let h=0; for(let i=0;i<s.length;i++){ if(s[i]>=i+1) h=i+1; else break; } return h; }
function authorsText(a){ if(!Array.isArray(a)||!a.length) return ""; return a.length<=6 ? a.join(", ") : a.slice(0,5).join(", ")+", …, "+a[a.length-1]; }
function linkFor(it){ return it.doi_url || it.scopus_url || "#"; }

function renderMetrics(rows){
  const cites = rows.reduce((s,r)=>s+(Number(r.cited_by)||0),0);
  const counts = rows.map(r=>Number(r.cited_by)||0);
  document.getElementById("m-total").textContent = String(rows.length);
  document.getElementById("m-cites").textContent = String(cites);
  document.getElementById("m-h").textContent = String(computeH(counts));
}
function renderList(rows){
  const list=document.getElementById("pub-list"); list.innerHTML="";
  rows.forEach((r,idx)=>{
    const wrap=document.createElement("div");
    wrap.className=`publication-container ${idx%2?'alt-color-2':'alt-color-1'}`;
    const venueLine=`${r.year?`${r.year} – `:""}${r.venue||""}${r.volume?` ${r.volume}`:""}${r.issue?`(${r.issue})`:""}${r.pages?`, ${r.pages}`:""}`;
    wrap.innerHTML=`
      <h3>${idx+1}. <strong>${r.title||"Untitled"}</strong></h3>
      ${r.authors?.length ? `<p>${authorsText(r.authors)}</p>` : (r.first_author?`<p>${r.first_author} et al.</p>`:"")}
      <p>${venueLine}</p>
      <a href="${linkFor(r)}" class="publication-button" target="_blank" rel="noopener">Read Paper</a>
      ${typeof r.cited_by==="number" ? `<span class="cite-badge" style="margin-left:.5rem">Citations: ${r.cited_by}</span>` : ``}
    `;
    list.appendChild(wrap);
  });
  if (typeof window.hydratePublications === "function") window.hydratePublications();
}
async function boot(){
  try{
    const r = await fetch(DATA_PATH, { headers:{Accept:"application/json"} });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    let data = await r.json();
    if (AUTHOR_ID) data = data.filter(x=>x.author_id===AUTHOR_ID);
    data = data.filter(x=>{
      const t=((x.type||x.subtype||"")+"").toLowerCase();
      return ALLOWED_TYPES.some(k => t.includes(k) || (k==="article"&&t==="ar") || (k==="review"&&t==="re") || (k==="editorial"&&t==="ed"));
    });
    data.sort((a,b)=>{
      const ay=Number(a.year)||0, by=Number(b.year)||0; if(ay!==by) return by-ay;
      const am=Number(a.month)||0, bm=Number(b.month)||0; if(am!==bm) return bm-am;
      return (a.title||"").localeCompare(b.title||"");
    });
    renderMetrics(data); renderList(data);
  }catch(e){
    console.error(e);
    document.getElementById("pub-list").innerHTML=`<p style="color:#666">Could not load publications.</p>`;
  }
}
boot();

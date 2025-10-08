# =========================================
# file: tools/scopus_fetcher.py  (REPLACE)
# =========================================
from __future__ import annotations
import argparse, csv, json, os, sys, time, logging
from typing import Any, Dict, Iterable, List, Optional
import requests

# WHY: keep keys out of code
SCOPUS_API_KEYS = [k.strip() for k in os.getenv("SCOPUS_API_KEYS","").split(",") if k.strip()]
if not SCOPUS_API_KEYS:
    raise SystemExit("Set SCOPUS_API_KEYS=key1,key2 in the shell before running")

SCOPUS_SEARCH_URL = "https://api.elsevier.com/content/search/scopus"
SCOPUS_ABSTRACT_EID_URL = "https://api.elsevier.com/content/abstract/eid/{}"
FIELDS = ",".join([
  "dc:title","eid","prism:doi","citedby-count","prism:coverDate",
  "subtype","subtypeDescription","prism:publicationName","prism:volume","prism:issueIdentifier","prism:pageRange",
  "dc:creator"
])
PAGE_SIZE=25; TIMEOUT=20
SLEEP=float(os.getenv("SCOPUS_SLEEP","0.25"))
LOG_LEVEL=os.getenv("SCOPUS_LOG","INFO").upper()
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO), format="%(asctime)s %(levelname)s %(message)s")
log=logging.getLogger("scopus")

def ensure_dir(p:str)->None: os.makedirs(p, exist_ok=True)
def scopus_link(eid:str)->str: return f"https://www.scopus.com/record/display.uri?eid={eid}&origin=recordpage"
def parts(date:str)->dict:
    y=m=d=None
    if date:
        s=date.split("-")
        y=s[0] if len(s)>0 and s[0].isdigit() else None
        m=s[1].zfill(2) if len(s)>1 and s[1].isdigit() else None
        d=s[2].zfill(2) if len(s)>2 and s[2].isdigit() else None
    return {"year":y,"month":m,"day":d}

class Rotator:
    def __init__(self, keys:List[str]): self.keys, self.i = keys, 0
    def cur(self)->str: return self.keys[self.i % len(self.keys)]
    def next(self)->None: self.i = (self.i + 1) % len(self.keys)

def _req(url:str, headers:dict, params:dict, attempt:int=0)->dict:
    try:
        r=requests.get(url, headers=headers, params=params, timeout=TIMEOUT)
        if r.status_code in (401,403,429,500,502,503,504): raise requests.HTTPError(str(r.status_code))
        r.raise_for_status(); return r.json()
    except Exception:
        if attempt>=5: raise
        time.sleep(min(2**attempt, 30))
        raise

def iter_scopus(rot:Rotator, query:str)->Iterable[dict]:
    start,total=0,None
    while True:
        headers={"Accept":"application/json","X-ELS-APIKey":rot.cur()}
        params={"query":query,"field":FIELDS,"count":PAGE_SIZE,"start":start}
        try:
            data=_req(SCOPUS_SEARCH_URL, headers, params, attempt=start//PAGE_SIZE)
        except Exception:
            rot.next(); continue
        root=data.get("search-results",{})
        entries=root.get("entry",[]) or []
        if total is None:
            tr=root.get("opensearch:totalResults"); total=int(tr) if tr and str(tr).isdigit() else None
        for it in entries: yield it
        if total is None and len(entries)<PAGE_SIZE: break
        start+=PAGE_SIZE
        if total is not None and (start>=total or len(entries)==0): break
        time.sleep(SLEEP)

def fetch_details(rot:Rotator, eid:str)->List[str]:
    headers={"Accept":"application/json","X-ELS-APIKey":rot.cur()}
    params={"view":"FULL"}
    for attempt in range(4):
        try:
            j=_req(SCOPUS_ABSTRACT_EID_URL.format(eid), headers, params, attempt)
            authors=j.get("abstracts-retrieval-response",{}).get("authors",{}).get("author",[])
            if isinstance(authors, dict): authors=[authors]
            names=[]
            for a in authors:
                nm=a.get("ce:indexed-name") or a.get("preferred-name",{}).get("ce:indexed-name") or a.get("authname")
                if nm: names.append(nm)
            return names
        except Exception:
            rot.next(); time.sleep(min(2**attempt, 30))
    return []

# map for common types; fallback uses substring match on subtypeDescription
CODE_BY_NAME={"article":"ar","review":"re","editorial":"ed"}
def allowed_type(it:dict, types:List[str])->bool:
    if not types: return True
    st=(it.get("subtype") or "").lower()
    desc=(it.get("subtypeDescription") or "").lower()
    for t in types:
        t=t.lower().strip()
        if CODE_BY_NAME.get(t,"") == st: return True
        if t in desc: return True
    return False

def normalize(item:dict, authors:List[str])->dict:
    d=item.get("prism:coverDate") or ""
    p=parts(d); doi=item.get("prism:doi")
    return {
        "title": item.get("dc:title") or "",
        "eid": item.get("eid") or "",
        "scopus_url": scopus_link(item.get("eid","")),
        "doi": doi,
        "doi_url": f"https://doi.org/{doi}" if doi else None,
        "cited_by": int(item.get("citedby-count",0) or 0),
        "cover_date": d, "year": p["year"], "month": p["month"], "day": p["day"],
        "venue": item.get("prism:publicationName"),
        "type": item.get("subtypeDescription"),  # e.g., Article, Review, Editorial
        "subtype": item.get("subtype"),          # e.g., ar, re, ed
        "volume": item.get("prism:volume"),
        "issue": item.get("prism:issueIdentifier"),
        "pages": item.get("prism:pageRange"),
        "first_author": item.get("dc:creator"),
        "authors": authors,
    }

def main(argv:Optional[List[str]]=None)->int:
    ap=argparse.ArgumentParser("Fetch Scopus for authors (select types)")
    ap.add_argument("--authors-file", default="data/authors.csv", help="CSV columns: author_id,name")
    ap.add_argument("--out", default="data/scopus", help="Output dir")
    ap.add_argument("--combined", default="data/scopus/scopus.json", help="Combined JSON path")
    ap.add_argument("--details", action="store_true", help="Fetch per-item author list")
    ap.add_argument("--year", type=int, help="Optional year filter")
    ap.add_argument("--types", default="Article", help="Comma list: Article,Review,Editorial (case-insensitive). Use '*' for all.")
    args=ap.parse_args(argv)

    include_types=[] if args.types.strip()=="*" else [t.strip() for t in args.types.split(",") if t.strip()]
    ensure_dir(args.out)
    authors=[]
    with open(args.authors_file, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            aid=str(row.get("author_id","")).strip(); nm=str(row.get("name","")).strip()
            if aid and nm: authors.append((aid,nm))
    if not authors: raise SystemExit("No authors in authors.csv")

    rot=Rotator(SCOPUS_API_KEYS)
    combined=[]

    for i,(aid,nm) in enumerate(authors,1):
        log.info("Author %d/%d %s (%s)", i, len(authors), nm, aid)
        q=f"AU-ID({aid})"
        if args.year: q+=f" AND PUBYEAR IS {args.year}"
        rows=[]
        for it in iter_scopus(rot, q):
            if "error" in it: continue
            if not allowed_type(it, include_types): continue
            auths=fetch_details(rot, it.get("eid","")) if (args.details and it.get("eid")) else []
            row=normalize(it, auths)
            if args.year and row.get("year") != str(args.year): continue
            row["author_id"]=aid; row["author_name"]=nm
            rows.append(row)

        rows.sort(key=lambda r: (
            int(r["year"]) if (r.get("year") and str(r["year"]).isdigit()) else -1,
            r.get("month") or "",
            r.get("title") or ""
        ), reverse=True)

        csv_path=os.path.join(args.out, f"{nm.replace(' ','_')}{'_'+str(args.year) if args.year else ''}_articles.csv")
        with open(csv_path,"w",newline="",encoding="utf-8") as f:
            w=csv.DictWriter(f, fieldnames=["title","scopus_url","doi_url","cited_by","cover_date","venue","volume","issue","pages"])
            w.writeheader()
            for r in rows: w.writerow({k:r.get(k) for k in w.fieldnames})

        combined.extend(rows)
        log.info("Saved %d item(s) → %s", len(rows), csv_path)
        time.sleep(0.1)

    with open(args.combined,"w",encoding="utf-8") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)
    log.info("Combined JSON: %s (total %d)", args.combined, len(combined))
    return 0

if __name__=="__main__":
    try: sys.exit(main())
    except Exception as e:
        log.error("Failed: %s", e); sys.exit(1)

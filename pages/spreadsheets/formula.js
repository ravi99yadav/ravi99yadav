/* ==========================================================================
   SUBLETWORKS.COM — Spreadsheet Formula Engine (self-contained, no deps)
   Exposes SW.Formula with:
     - colToIdx / idxToCol / cellKey / parseRef  (A1 <-> {row,col})
     - evaluate(formula, getCell)  -> value | error string ("#...")
   getCell(ref) must return the already-computed value of another cell
   (number | string | ""), and is responsible for cycle detection.
   ========================================================================== */
(function(global){
  "use strict";

  function colToIdx(col){ let n=0; for(const ch of col.toUpperCase()) n = n*26 + (ch.charCodeAt(0)-64); return n-1; }
  function idxToCol(idx){ let s="", n=idx+1; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
  function cellKey(row, col){ return idxToCol(col)+(row+1); }
  function parseRef(ref){
    const m = String(ref).replace(/\$/g,"").toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if(!m) return null;
    return { col: colToIdx(m[1]), row: parseInt(m[2],10)-1 };
  }

  // ---- value helpers -------------------------------------------------------
  function isErr(v){ return typeof v==="string" && v[0]==="#"; }
  function toNum(v){
    if(typeof v==="number") return v;
    if(typeof v==="boolean") return v?1:0;
    if(v===""||v==null) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  function isNumericVal(v){
    if(typeof v==="number") return true;
    if(typeof v==="boolean") return true;
    if(v===""||v==null) return false;
    return !isNaN(Number(v));
  }
  function toBool(v){
    if(typeof v==="boolean") return v;
    if(typeof v==="number") return v!==0;
    if(v==null||v==="") return false;
    const s=String(v).toLowerCase();
    if(s==="true") return true;
    if(s==="false") return false;
    return Number(v)!==0;
  }
  function flat(args){ const out=[]; args.forEach(a=> Array.isArray(a)?a.forEach(x=>out.push(x)):out.push(a)); return out; }
  function nums(args){ return flat(args).filter(isNumericVal).map(toNum); }

  // ---- functions -----------------------------------------------------------
  const FN = {
    SUM: a=> nums(a).reduce((x,y)=>x+y,0),
    PRODUCT: a=>{ const n=nums(a); return n.length? n.reduce((x,y)=>x*y,1) : 0; },
    AVERAGE: a=>{ const n=nums(a); return n.length? n.reduce((x,y)=>x+y,0)/n.length : "#DIV/0!"; },
    MIN: a=>{ const n=nums(a); return n.length? Math.min.apply(null,n) : 0; },
    MAX: a=>{ const n=nums(a); return n.length? Math.max.apply(null,n) : 0; },
    COUNT: a=> nums(a).length,
    COUNTA: a=> flat(a).filter(v=> v!=="" && v!=null).length,
    ROUND: a=>{ const f=flat(a); const x=toNum(f[0]), d=f.length>1?toNum(f[1]):0; const p=Math.pow(10,d); return Math.round(x*p)/p; },
    ROUNDUP: a=>{ const f=flat(a); const x=toNum(f[0]), d=f.length>1?toNum(f[1]):0; const p=Math.pow(10,d); return Math.ceil(Math.abs(x)*p)/p*Math.sign(x||1); },
    ROUNDDOWN: a=>{ const f=flat(a); const x=toNum(f[0]), d=f.length>1?toNum(f[1]):0; const p=Math.pow(10,d); return Math.floor(Math.abs(x)*p)/p*Math.sign(x||1); },
    INT: a=> Math.floor(toNum(flat(a)[0])),
    ABS: a=> Math.abs(toNum(flat(a)[0])),
    SQRT: a=>{ const x=toNum(flat(a)[0]); return x<0? "#NUM!" : Math.sqrt(x); },
    POWER: a=>{ const f=flat(a); return Math.pow(toNum(f[0]), toNum(f[1])); },
    MOD: a=>{ const f=flat(a); const d=toNum(f[1]); return d===0? "#DIV/0!" : toNum(f[0])%d; },
    IF: a=> toBool(a[0]) ? (a[1]!==undefined?a[1]:true) : (a[2]!==undefined?a[2]:false),
    AND: a=> flat(a).every(toBool),
    OR: a=> flat(a).some(toBool),
    NOT: a=> !toBool(flat(a)[0]),
    LEN: a=> String(flat(a)[0]==null?"":flat(a)[0]).length,
    CONCAT: a=> flat(a).map(v=>v==null?"":v).join(""),
    CONCATENATE: a=> flat(a).map(v=>v==null?"":v).join("")
  };

  // ---- tokenizer -----------------------------------------------------------
  function tokenize(s){
    const toks=[]; let i=0;
    const RE_STR=/^"([^"]*)"/, RE_NUM=/^\d*\.?\d+(e[+-]?\d+)?/i, RE_REF=/^\$?[A-Za-z]+\$?\d+/, RE_ID=/^[A-Za-z_][A-Za-z0-9_]*/, RE_OP=/^(<=|>=|<>|[-+*/^%(),:=<>])/;
    while(i<s.length){
      const rest=s.slice(i), c=s[i];
      if(/\s/.test(c)){ i++; continue; }
      let m;
      if(m=rest.match(RE_STR)){ toks.push({t:"str",v:m[1]}); i+=m[0].length; continue; }
      if(m=rest.match(RE_NUM)){ toks.push({t:"num",v:parseFloat(m[0])}); i+=m[0].length; continue; }
      if(m=rest.match(RE_REF)){ toks.push({t:"ref",v:m[0].replace(/\$/g,"").toUpperCase()}); i+=m[0].length; continue; }
      if(m=rest.match(RE_ID)){ toks.push({t:"id",v:m[0].toUpperCase()}); i+=m[0].length; continue; }
      if(m=rest.match(RE_OP)){ toks.push({t:"op",v:m[0]}); i+=m[0].length; continue; }
      throw "#SYNTAX!";
    }
    return toks;
  }

  // ---- parser / evaluator (recursive descent) ------------------------------
  function evaluate(formula, getCell){
    let toks;
    try{ toks = tokenize(formula); }catch(e){ return typeof e==="string"?e:"#SYNTAX!"; }
    let p=0;
    const peek=()=> toks[p];
    const eat=(v)=>{ const t=toks[p]; if(!t || (v && !(t.t==="op"&&t.v===v))) throw "#SYNTAX!"; p++; return t; };

    function rangeValues(a, b){
      const ra=parseRef(a), rb=parseRef(b);
      if(!ra||!rb) throw "#REF!";
      const r1=Math.min(ra.row,rb.row), r2=Math.max(ra.row,rb.row);
      const c1=Math.min(ra.col,rb.col), c2=Math.max(ra.col,rb.col);
      const out=[];
      for(let r=r1;r<=r2;r++) for(let c=c1;c<=c2;c++){ const v=getCell(cellKey(r,c)); if(isErr(v)) throw v; out.push(v); }
      return out;
    }

    function primary(){
      const t=peek();
      if(!t) throw "#SYNTAX!";
      if(t.t==="num"){ p++; return t.v; }
      if(t.t==="str"){ p++; return t.v; }
      if(t.t==="op" && t.v==="("){ p++; const e=expr(); eat(")"); return e; }
      if(t.t==="op" && (t.v==="-"||t.v==="+")){ p++; const v=unary(); if(Array.isArray(v)) throw "#VALUE!"; return t.v==="-"? -toNum(v): toNum(v); }
      if(t.t==="ref"){
        p++;
        if(peek() && peek().t==="op" && peek().v===":"){ p++; const t2=eat(); if(t2.t!=="ref") throw "#SYNTAX!"; return rangeValues(t.v, t2.v); }
        const v=getCell(t.v); if(isErr(v)) throw v; return v;
      }
      if(t.t==="id"){
        p++;
        // boolean literals
        if(t.v==="TRUE") return true;
        if(t.v==="FALSE") return false;
        const fn=FN[t.v];
        eat("(");
        const args=[];
        if(!(peek() && peek().t==="op" && peek().v===")")){
          args.push(expr());
          while(peek() && peek().t==="op" && peek().v===","){ p++; args.push(expr()); }
        }
        eat(")");
        if(!fn) throw "#NAME?";
        const r=fn(args);
        return r;
      }
      throw "#SYNTAX!";
    }
    function power(){ let a=primary(); while(peek() && peek().t==="op" && peek().v==="%"){ p++; a=toNum(a)/100; } if(peek() && peek().t==="op" && peek().v==="^"){ p++; const b=unary(); return Math.pow(toNum(a),toNum(b)); } return a; }
    function unary(){ const t=peek(); if(t && t.t==="op" && (t.v==="-"||t.v==="+")){ p++; const v=unary(); return t.v==="-"? -toNum(v): toNum(v); } return power(); }
    function muldiv(){ let a=unary(); while(peek() && peek().t==="op" && (peek().v==="*"||peek().v==="/")){ const op=eat().v; const b=unary(); if(op==="/"){ const d=toNum(b); a = d===0? "#DIV/0!" : toNum(a)/d; if(isErr(a)) throw a; } else a=toNum(a)*toNum(b); } return a; }
    function addsub(){ let a=muldiv(); while(peek() && peek().t==="op" && (peek().v==="+"||peek().v==="-")){ const op=eat().v; const b=muldiv(); a= op==="+"? toNum(a)+toNum(b) : toNum(a)-toNum(b); } return a; }
    function comparison(){
      let a=addsub();
      const t=peek();
      if(t && t.t==="op" && ["=","<>","<",">","<=",">="].includes(t.v)){
        p++; const b=addsub();
        const na=isNumericVal(a)&&isNumericVal(b);
        const x= na? toNum(a):String(a), y= na? toNum(b):String(b);
        switch(t.v){ case"=":return x===y; case"<>":return x!==y; case"<":return x<y; case">":return x>y; case"<=":return x<=y; case">=":return x>=y; }
      }
      return a;
    }
    function expr(){ return comparison(); }

    let result;
    try{ result=expr(); if(p<toks.length) throw "#SYNTAX!"; }
    catch(e){ return typeof e==="string" && e[0]==="#" ? e : "#ERROR!"; }
    if(Array.isArray(result)) return "#VALUE!";
    if(typeof result==="number" && !isFinite(result)) return "#NUM!";
    return result;
  }

  global.SW = global.SW || {};
  global.SW.Formula = { colToIdx, idxToCol, cellKey, parseRef, evaluate, toNum, isErr };
})(window);

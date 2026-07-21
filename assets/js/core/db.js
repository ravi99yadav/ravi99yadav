/* ==========================================================================
   SUBLETWORKS.COM — Data Layer (LocalStorage adapter)
   Swap ADAPTER for a PHP+MySQL REST adapter later without touching callers:
   every call site only ever talks to SW.DB.<collection>.<verb>(...)
   ========================================================================== */
(function(global){
  "use strict";

  const STORAGE_KEY = "sw_db_v1";
  const COLLECTIONS = [
    "users","companies","masterProjects","tenders","boqItems","bids","bidItems","comments",
    "revisions","contactUnlocks","lois","workOrders","projects","ganttTasks",
    "kanbanCards","kanbanColumns","mbSheets","mbRows","raBills","raBillItems","dprs","workPlans",
    "hindrances","hindranceLibrary","eotRequests","paymentRequests","marketplaceListings","marketplaceInquiries",
    "purchaseOrders","vehicleLogs",
    "notifications","auditLogs","savedTenders","files","shares","supportTickets","settings"
  ];

  function loadRaw(){
    try{
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){ console.error("SW.DB load error", e); return null; }
  }

  function emptyStore(){
    const store = {};
    COLLECTIONS.forEach(c=> store[c] = []);
    store._meta = { seeded:false, version:1 };
    return store;
  }

  let store = loadRaw() || emptyStore();
  COLLECTIONS.forEach(c=>{ if(!Array.isArray(store[c])) store[c] = []; });

  function persist(){
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    global.dispatchEvent(new CustomEvent("sw:db:changed"));
  }

  function uid(prefix){
    return (prefix||"id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  function nowISO(){ return new Date().toISOString(); }

  function addAudit(entity, entityId, action, meta){
    store.auditLogs.push({
      id: uid("aud"), entity, entityId, action, meta: meta||{},
      userId: (global.SW && global.SW.Auth && global.SW.Auth.currentUser()) ? global.SW.Auth.currentUser().id : null,
      at: nowISO()
    });
  }

  function makeCollection(name){
    return {
      list(filterFn){
        const arr = store[name];
        return filterFn ? arr.filter(filterFn) : arr.slice();
      },
      get(id){ return store[name].find(r=>r.id===id) || null; },
      create(obj, opts){
        const rec = Object.assign({ id: uid(name.slice(0,3)), createdAt: nowISO(), updatedAt: nowISO(), archived:false, version:1 }, obj);
        store[name].push(rec);
        addAudit(name, rec.id, "create", opts&&opts.meta);
        persist();
        return rec;
      },
      update(id, patch, opts){
        const rec = store[name].find(r=>r.id===id);
        if(!rec) return null;
        Object.assign(rec, patch, { updatedAt: nowISO(), version: (rec.version||1)+1 });
        addAudit(name, id, "update", (opts&&opts.meta)||patch);
        persist();
        return rec;
      },
      remove(id){
        const idx = store[name].findIndex(r=>r.id===id);
        if(idx===-1) return false;
        store[name].splice(idx,1);
        addAudit(name, id, "delete");
        persist();
        return true;
      },
      archive(id){ return this.update(id, {archived:true}, {meta:{action:"archive"}}); },
      restore(id){ return this.update(id, {archived:false}, {meta:{action:"restore"}}); },
      duplicate(id, overrides){
        const rec = this.get(id);
        if(!rec) return null;
        const clone = Object.assign({}, rec, overrides||{}, { id: uid(name.slice(0,3)), createdAt: nowISO(), updatedAt: nowISO(), version:1, archived:false });
        store[name].push(clone);
        addAudit(name, clone.id, "duplicate", {from:id});
        persist();
        return clone;
      }
    };
  }

  const DB = { _store: store, _persist: persist, uid, nowISO, addAudit };
  COLLECTIONS.forEach(c=>{ if(c!=="settings") DB[c] = makeCollection(c); });

  // settings is a singleton bag, not a list
  DB.settings = {
    get(key, fallback){
      const row = store.settings.find(s=>s.key===key);
      return row ? row.value : fallback;
    },
    set(key, value){
      let row = store.settings.find(s=>s.key===key);
      if(row){ row.value = value; } else { store.settings.push({key,value}); }
      persist();
      return value;
    }
  };

  DB.wipeAll = function(){ store = emptyStore(); persist(); };
  DB.isSeeded = function(){ return !!store._meta.seeded; };
  DB.markSeeded = function(){ store._meta.seeded = true; persist(); };

  DB.auditFor = function(entity, entityId){
    return store.auditLogs.filter(a=>a.entity===entity && a.entityId===entityId).sort((a,b)=> new Date(b.at)-new Date(a.at));
  };

  global.SW = global.SW || {};
  global.SW.DB = DB;
})(window);

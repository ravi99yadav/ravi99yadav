/* ==========================================================================
   SUBLETWORKS.COM — Auth / Session / Role Guard
   ========================================================================== */
(function(global){
  "use strict";
  const DB = () => global.SW.DB;
  const SESSION_KEY = "sw_session_v1";

  const ROLE_HOME = {
    pm: "/pages/pm-dashboard/index.html",
    contractor: "/pages/contractor-dashboard/index.html",
    admin: "/pages/admin-dashboard/index.html"
  };

  function readSession(){
    try{
      const s = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      return s ? JSON.parse(s) : null;
    }catch(e){ return null; }
  }

  function writeSession(session, remember){
    const json = JSON.stringify(session);
    if(remember){ localStorage.setItem(SESSION_KEY, json); sessionStorage.removeItem(SESSION_KEY); }
    else { sessionStorage.setItem(SESSION_KEY, json); localStorage.removeItem(SESSION_KEY); }
  }

  const Auth = {
    currentUser(){
      const s = readSession();
      if(!s) return null;
      const u = DB().users.get(s.userId);
      return u || null;
    },
    isLoggedIn(){ return !!this.currentUser(); },

    login(identifier, password, remember){
      const users = DB().users.list();
      const user = users.find(u => (u.email===identifier || u.phone===identifier) && u.password===password);
      if(!user) return { ok:false, error:"Invalid email/phone or password." };
      if(user.status==="pending") return { ok:false, error:"Your account is pending admin approval." };
      if(user.status==="suspended") return { ok:false, error:"Your account has been suspended. Contact support." };
      writeSession({ userId:user.id, role:user.role, loginAt:new Date().toISOString() }, remember);
      DB().addAudit("users", user.id, "login");
      return { ok:true, user };
    },

    loginAsDemo(role){
      const user = DB().users.list().find(u=>u.role===role && u.isDemo);
      if(!user) return { ok:false, error:"Demo account not available." };
      writeSession({ userId:user.id, role:user.role, loginAt:new Date().toISOString() }, false);
      return { ok:true, user };
    },

    register(data){
      const exists = DB().users.list().find(u=>u.email===data.email);
      if(exists) return { ok:false, error:"An account with this email already exists." };
      const user = DB().users.create(Object.assign({
        status: data.role==="contractor" ? "pending" : "active",
        isDemo:false, avatarColor: randomColor()
      }, data));
      if(data.role==="pm" || data.role==="contractor"){
        DB().companies.create({ ownerId:user.id, name:data.companyName||(data.name+" & Co."), gst:data.gst||"", pan:data.pan||"", msme:data.msme||"", iso:data.iso||"", trades:data.trades||[], district:data.district||"", state:data.state||"" });
      }
      return { ok:true, user };
    },

    logout(){
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      location.href = rootPath("/pages/login/index.html");
    },

    requireRole(roles){
      const user = this.currentUser();
      if(!user){ location.href = rootPath("/pages/login/index.html?next="+encodeURIComponent(location.pathname)); return null; }
      if(roles && roles.length && roles.indexOf(user.role)===-1){
        location.href = rootPath(ROLE_HOME[user.role] || "/pages/login/index.html");
        return null;
      }
      return user;
    },

    homeFor(role){ return rootPath(ROLE_HOME[role] || "/pages/login/index.html"); }
  };

  function randomColor(){
    const colors = ["#5B5CEB","#00C2FF","#22C55E","#F59E0B","#EF4444","#A855F7"];
    return colors[Math.floor(Math.random()*colors.length)];
  }

  // Resolves an app-root-relative path ("/pages/...") to work whether the
  // site is served from domain root or a sub-path.
  function rootPath(p){
    if(global.SW_ROOT===undefined){
      // derive root by walking up from current script location assumption: pages are one level deep
      const depth = location.pathname.split("/pages/").length>1 ? "../../" : "./";
      global.SW_ROOT = depth;
    }
    return global.SW_ROOT + p.replace(/^\//,"");
  }

  global.SW = global.SW || {};
  global.SW.Auth = Auth;
  global.SW.rootPath = rootPath;
})(window);

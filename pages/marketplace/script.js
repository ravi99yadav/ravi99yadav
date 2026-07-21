(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor","admin"]);
  if(!rawUser) return;
  const activeKey = rawUser.role==="pm" ? "marketplace" : rawUser.role==="contractor" ? "marketplace" : "marketplace";
  const user = SW.UI.mountShell({ roles:["pm","contractor","admin"], active:activeKey });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;
  let view = "all";
  const CATEGORY_ICON = { Material:"🧱", Equipment:"🚜", Scrap:"♻️" };

  SW.Geo.bindStateDistrict(document.getElementById("fState"), document.getElementById("fDistrict"), {});
  SW.Geo.bindStateDistrict(document.getElementById("lState"), document.getElementById("lDistrict"), {});

  function feeEnabled(){ return DB.settings.get("marketplaceFeeEnabled", false); }
  function feeAmount(){ return DB.settings.get("marketplaceFee", 49); }

  function render(){
    let list = DB.marketplaceListings.list(l=>l.status==="active");
    const category = document.getElementById("fCategory").value;
    const condition = document.getElementById("fCondition").value;
    const state = document.getElementById("fState").value;
    const district = document.getElementById("fDistrict").value.trim().toLowerCase();
    const maxPrice = +document.getElementById("fMaxPrice").value||0;
    if(category) list = list.filter(l=>l.category===category);
    if(condition) list = list.filter(l=>l.condition===condition);
    if(state) list = list.filter(l=>(l.state||"")===state);
    if(district) list = list.filter(l=>(l.district||"").toLowerCase().includes(district));
    if(maxPrice) list = list.filter(l=>l.price<=maxPrice);
    if(view==="mine") list = list.filter(l=>l.sellerId===user.id);
    list.sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));

    document.getElementById("listingsGrid").innerHTML = list.length ? list.map(l=>`
      <div class="card card-hover listing-card">
        <div class="listing-photo">${CATEGORY_ICON[l.category]||"📦"}</div>
        <div class="flex justify-between items-start"><b>${U.escapeHtml(l.title)}</b><span class="badge badge-info">${l.category}</span></div>
        <div class="text-muted" style="font-size:12px">${U.escapeHtml(l.district||"")}, ${U.escapeHtml(l.state||"")} · ${U.escapeHtml(l.condition)}</div>
        <p style="font-size:13px" class="mt-2">${U.escapeHtml((l.description||"").slice(0,90))}</p>
        <div class="flex justify-between items-center mt-2"><b>${U.fmtINR(l.price)} <small class="text-muted">${U.escapeHtml(l.priceUnit||"")}</small>${l.negotiable==="yes"?' <small class="text-muted">· Negotiable</small>':''}</b><span class="text-muted" style="font-size:11px">${U.escapeHtml(l.quantity||"")}</span></div>
        <div class="listing-chips">${listingChips(l)}</div>
        <div class="text-muted mt-2" style="font-size:11.5px">${transportLine(l)}</div>
        <div class="flex gap-2 mt-3">
          <button class="btn btn-ghost btn-sm" data-details="${l.id}">Details</button>
          ${l.sellerId===user.id ? `<button class="btn btn-outline btn-sm w-full" data-remove="${l.id}">Remove Listing</button>` : `<button class="btn btn-primary btn-sm w-full" data-contact="${l.id}">Contact Seller</button>`}
        </div>
      </div>`).join("") : `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🛒</div>No listings found.</div>`;
  }

  function listingChips(l){
    const chips = [];
    if(l.gstInvoice==="yes") chips.push(`<span class="badge badge-success">GST Invoice</span>`);
    if(l.billAvail==="yes") chips.push(`<span class="badge badge-neutral">Bill Available</span>`);
    if(l.warranty && !/^(none|no|n\/a|-)$/i.test(l.warranty.trim())) chips.push(`<span class="badge badge-info">Warranty: ${U.escapeHtml(l.warranty)}</span>`);
    if(l.negotiable==="yes") chips.push(`<span class="badge badge-warning">Negotiable</span>`);
    if(l.inspection) chips.push(`<span class="badge badge-neutral">🔎 ${U.escapeHtml(l.inspection)}</span>`);
    return chips.join("");
  }
  const TRANSPORT_LABEL = { buyer:"Buyer arranges pickup", seller:"Seller delivers", negotiable:"Transport negotiable" };
  function transportLine(l){
    if(!l.transport) return "";
    let s = "🚚 " + (TRANSPORT_LABEL[l.transport]||l.transport);
    if(l.transport==="seller" && l.transportRate){
      s += ` · ₹${l.transportRate}/km`;
      if(l.freeKm) s += ` (free up to ${l.freeKm} km)`;
    }
    return s;
  }

  document.getElementById("searchBtn").addEventListener("click", render);
  document.getElementById("clearBtn").addEventListener("click", ()=>{
    U.qsa(".card input,.card select").forEach(i=>{ if(i.closest("#listingModal")||i.closest("#contactModal")) return; i.value=""; });
    SW.Geo.populateDistrictSelect(document.getElementById("fDistrict"), "", null);
    render();
  });
  U.qsa("#viewTabs button").forEach(btn=> btn.addEventListener("click", ()=>{
    U.qsa("#viewTabs button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    view = btn.dataset.view; render();
  }));

  document.getElementById("sellBtn").addEventListener("click", ()=>{ document.getElementById("listingModalTitle").textContent="Sell / List an Item"; U.openModal("listingModal"); });

  // Transport rate/km fields only make sense when the seller is doing the delivery.
  const transportSel = document.getElementById("lTransport");
  function syncTransportRate(){ document.getElementById("transportRateWrap").style.display = transportSel.value==="seller" ? "" : "none"; }
  transportSel.addEventListener("change", syncTransportRate); syncTransportRate();

  document.getElementById("listingSave").addEventListener("click", ()=>{
    const title = document.getElementById("lTitle").value.trim();
    if(!title){ U.toast("Give your listing a title.", {type:"danger"}); return; }
    const transport = document.getElementById("lTransport").value;
    DB.marketplaceListings.create({
      sellerId:user.id, sellerRole:user.role, category:document.getElementById("lCategory").value, title,
      quantity:document.getElementById("lQty").value.trim(), condition:document.getElementById("lCondition").value,
      price:+document.getElementById("lPrice").value||0, priceUnit:document.getElementById("lPriceUnit").value.trim(),
      district:document.getElementById("lDistrict").value.trim(), state:document.getElementById("lState").value.trim(),
      description:document.getElementById("lDesc").value.trim(),
      gstInvoice:document.getElementById("lGstInvoice").value, billAvail:document.getElementById("lBillAvail").value,
      negotiable:document.getElementById("lNegotiable").value, warranty:document.getElementById("lWarranty").value.trim(),
      transport, transportRate:transport==="seller"?(+document.getElementById("lTransportRate").value||0):0,
      freeKm:transport==="seller"?(+document.getElementById("lFreeKm").value||0):0,
      inspection:document.getElementById("lInspection").value, terms:document.getElementById("lTerms").value.trim(),
      status:"active"
    });
    U.closeModal("listingModal"); U.toast("Listing published!", {type:"success"}); render();
  });

  document.getElementById("listingsGrid").addEventListener("click", e=>{
    const remove = e.target.closest("[data-remove]");
    const contact = e.target.closest("[data-contact]");
    const details = e.target.closest("[data-details]");
    if(remove){ DB.marketplaceListings.update(remove.dataset.remove, {status:"removed"}); U.toast("Listing removed.", {type:"warning"}); render(); }
    if(contact) openContact(contact.dataset.contact);
    if(details) openDetails(details.dataset.details);
  });

  function drow(label, val){ return `<div class="detail-row"><span class="dr-label">${label}</span><span class="dr-val">${val}</span></div>`; }
  function openDetails(listingId){
    const l = DB.marketplaceListings.get(listingId);
    if(!l) return;
    const yn = v => v==="yes" ? "✔ Yes" : "—";
    document.getElementById("detailsModalTitle").textContent = l.title;
    document.getElementById("detailsModalBody").innerHTML = `
      <div class="flex justify-between items-center mb-2"><span class="badge badge-info">${l.category}</span><b>${U.fmtINR(l.price)} <small class="text-muted">${U.escapeHtml(l.priceUnit||"")}</small></b></div>
      ${l.description ? `<p style="font-size:13px">${U.escapeHtml(l.description)}</p>` : ""}
      ${drow("Quantity", U.escapeHtml(l.quantity||"—"))}
      ${drow("Condition", U.escapeHtml(l.condition||"—"))}
      ${drow("Location", U.escapeHtml((l.district||"—")+", "+(l.state||"")))}
      ${drow("Price Negotiable", l.negotiable==="yes"?"✔ Yes":"Fixed price")}
      ${drow("GST Invoice", yn(l.gstInvoice))}
      ${drow("Purchase Bill / Proof", yn(l.billAvail))}
      ${drow("Warranty / Guarantee", U.escapeHtml(l.warranty||"—"))}
      ${drow("Transport", U.escapeHtml(TRANSPORT_LABEL[l.transport]||"—"))}
      ${l.transport==="seller"&&l.transportRate?drow("Transport Rate", `₹${l.transportRate}/km${l.freeKm?` · free up to ${l.freeKm} km`:""}`):""}
      ${drow("Inspection", U.escapeHtml(l.inspection||"Not specified"))}
      ${l.terms ? `<div class="section-divider"><span>Terms &amp; Conditions</span></div><p style="font-size:12.5px;white-space:pre-wrap">${U.escapeHtml(l.terms)}</p>` : ""}`;
    const contactBtn = document.getElementById("detailsContactBtn");
    contactBtn.style.display = l.sellerId===user.id ? "none" : "";
    contactBtn.onclick = ()=>{ U.closeModal("detailsModal"); openContact(l.id); };
    U.openModal("detailsModal");
  }

  function openContact(listingId){
    const listing = DB.marketplaceListings.get(listingId);
    const seller = DB.users.get(listing.sellerId);
    const inquiry = DB.marketplaceInquiries.list(q=>q.listingId===listingId && q.buyerId===user.id)[0];
    const paid = inquiry ? inquiry.paid : false;
    const needsPay = feeEnabled() && !paid;
    document.getElementById("contactModalBody").innerHTML = needsPay ? `
      <div class="unlock-banner mb-4"><div><div style="font-size:13px">Connect fee to view seller contact</div><div class="unlock-price"><span class="new">₹${feeAmount()}</span></div></div></div>
      <p class="text-muted">This is a simulated payment for the demo build.</p>
      <button class="btn btn-success btn-block" id="payConnectBtn">Pay ₹${feeAmount()} &amp; View Contact</button>` : `
      <p><b>${U.escapeHtml(seller.name)}</b></p>
      <p>📞 ${U.escapeHtml(seller.phone)}<br>✉️ ${U.escapeHtml(seller.email)}</p>
      <p class="text-muted" style="font-size:12px">${feeEnabled() ? "Connect fee already paid for this listing." : "Marketplace connect fee is currently free (admin controlled)."}</p>`;
    U.openModal("contactModal");
    document.getElementById("payConnectBtn")?.addEventListener("click", ()=>{
      if(inquiry) DB.marketplaceInquiries.update(inquiry.id, {paid:true});
      else DB.marketplaceInquiries.create({ listingId, buyerId:user.id, sellerId:seller.id, paid:true, paidAt:DB.nowISO() });
      U.toast("Payment received — contact unlocked.", {type:"success"});
      openContact(listingId);
    });
  }

  render();
  SW.UI.helpSection(document.querySelector(".app-content"), "Materials Marketplace", [
    "List surplus material, equipment for rent, or scrap for sale — visible to every SubletWorks user.",
    "Buyers can filter by category, condition, location and maximum price.",
    "The connect fee (default ₹49, admin-controlled and currently "+(feeEnabled()?"enabled":"free")+") applies only when contacting a seller — you can manage this from the Admin Panel.",
    "Manage your own listings from the \"My Listings\" tab — remove them anytime once sold."
  ]);
})();

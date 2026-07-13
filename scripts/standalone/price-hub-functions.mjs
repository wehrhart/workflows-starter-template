/**
 * The Price Information render + wiring functions injected into the Abyrx Tools
 * hub script. Shared by build-artifact.mjs (fresh injection) and
 * update-artifact.mjs (surgical in-place replacement) so they never drift.
 * Ends right before `function renderKaiser() {`.
 */
export const PRICE_FUNCTIONS = `  function priceRows(res) {
    var rows = "";
    res.approved.forEach(function (p) {
      var src = '<span class="badge ok">This facility</span>';
      if (p.priceFrom) src += ' <span style="color:var(--muted);font-size:11px">price via #' +
        esc(p.priceFrom.code) + ' \\u00b7 ' + esc(p.priceFrom.name) + '</span>';
      rows += '<tr><td>' + esc(p.product) + '</td><td class="num">' + esc(p.price) +
        '</td><td>' + src + '</td></tr>';
    });
    res.systemExtras.forEach(function (p) {
      rows += '<tr><td>' + esc(p.product) + '</td><td class="num">' + esc(p.price) +
        '</td><td><span class="badge warn" style="white-space:normal">#' +
        esc(p.sourceCode) + ' \\u00b7 ' + esc(p.sourceName) + '</span></td></tr>';
    });
    return rows;
  }

  function priceResultView() {
    var res = priceResult;
    if (!res) return "";
    if (!res.found) {
      var msg = res.code
        ? "No facility with code #" + esc(res.code) + " in the snapshot."
        : "Enter a facility code to look up.";
      return '<div class="chip warn" style="margin-top:16px;display:inline-block">' + msg + '</div>';
    }
    var f = res.facility;
    var sub = esc(f.city) + ", " + esc(f.state) +
      (res.systemName ? " \\u00b7 " + esc(res.systemName) : " \\u00b7 no health system matched");
    var chips = '<span class="chip ok">' + res.approved.length + ' Use Here</span>';
    if (res.systemExtras.length) chips += '<span class="chip warn">+' + res.systemExtras.length + ' from sister facilities</span>';
    if (res.sisters.length) chips += '<span class="chip neutral">' + res.sisters.length + ' sister facilities</span>';

    var total = res.approved.length + res.systemExtras.length;
    var table = total === 0
      ? '<div class="meta" style="margin-top:16px">No products are approved at this facility or its sister facilities in the snapshot.</div>'
      : '<div class="tablewrap" style="margin-top:16px"><table><thead><tr>' +
        '<th>Product</th><th>Price</th><th>Source</th></tr></thead><tbody>' + priceRows(res) +
        '</tbody></table></div>';

    var sisters = "";
    if (res.sisters.length) {
      var items = res.sisters.map(function (s) {
        var head = '#' + esc(s.code) + ' \\u00b7 ' + esc(s.name) + ' \\u2014 ' + esc(s.city) + ', ' + esc(s.state);
        if (s.approved && s.approved.length) {
          var prods = s.approved.map(function (p) {
            return '<li>' + esc(p.product) + ' \\u2014 ' + esc(p.price) + '</li>';
          }).join("");
          return '<li style="margin:2px 0"><details><summary style="cursor:pointer">' + head +
            ' \\u00b7 ' + s.approved.length + ' approved</summary>' +
            '<ul style="margin:4px 0 6px 18px;list-style:disc">' + prods + '</ul></details></li>';
        }
        return '<li style="margin:2px 0;list-style:none">' + head + '</li>';
      }).join("");
      sisters = '<details style="margin-top:16px"><summary style="cursor:pointer;color:var(--muted);font-size:14px">' +
        'Sister facilities checked (' + res.sisters.length + ') \\u2014 verify these are the right system</summary>' +
        '<ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--muted)">' + items + '</ul></details>';
    }

    return '<div style="margin-top:20px">' +
      '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:baseline">' +
      '<div><div class="label" style="font-size:16px">' + esc(f.name) +
      ' <span style="color:var(--faint);font-weight:400;font-size:14px">#' + esc(res.code) + '</span></div>' +
      '<div class="meta">' + sub + '</div></div>' +
      '<button class="btn ghost" id="pcopy" style="padding:6px 12px;font-size:12px">' +
      (priceCopied ? "Copied \\u2713" : "Copy report") + '</button></div>' +
      '<div class="chips" style="margin-top:12px">' + chips + '</div>' +
      table + sisters + '</div>';
  }

  function renderPrice() {
    return '<div class="wrap">' +
      '<div style="margin-bottom:20px"><h1 class="page">Price Information</h1>' +
      '<p class="sub">Enter a facility code \\u2014 get every approved product and price for that facility, ' +
      'plus approvals from its sister facilities in the same health system.</p></div>' +
      '<div class="card">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
      '<input id="pcode" value="' + esc(priceInput) + '" inputmode="numeric" ' +
      'placeholder="Facility code, e.g. 6443 or FA6443" ' +
      'style="flex:1;min-width:0;border:1px solid var(--border-strong);border-radius:12px;' +
      'padding:10px 16px;font:inherit;font-size:14px;background:var(--surface-solid);color:var(--text)">' +
      '<button class="btn" id="plook">Look up</button></div>' +
      priceResultView() + '</div>' +
      '<p class="note">Snapshot of KAIRUKU as of ' + esc(P.generatedAt) + ' \\u00b7 ' + P.facilityCount +
      ' facilities. Health systems are inferred from facility names (KAIRUKU has no system field), so ' +
      'sister facilities are a best-effort match \\u2014 check the list before relying on cross-facility approvals. ' +
      'Everything runs right here in your browser.</p></div>';
  }

  function runPriceLookup() {
    priceCopied = false;
    priceResult = P.lookup(priceInput);
    render();
  }

  function wirePrice() {
    var pcode = document.getElementById("pcode");
    if (pcode) {
      pcode.oninput = function (e) { priceInput = e.target.value; };
      pcode.onkeydown = function (e) { if (e.key === "Enter") runPriceLookup(); };
      pcode.focus();
      var v = pcode.value; pcode.value = ""; pcode.value = v;
    }
    var plook = document.getElementById("plook");
    if (plook) plook.onclick = runPriceLookup;
    var pcopy = document.getElementById("pcopy");
    if (pcopy) pcopy.onclick = function () {
      if (!priceResult) return;
      var text = P.report(priceResult);
      var done = function () { priceCopied = true; render(); setTimeout(function () { priceCopied = false; render(); }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    };
  }

`;

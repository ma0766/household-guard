// The page an adult opens from the email. Words go in with textContent only; the key to talk to the house is in the link.
export const APPROVE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Say yes or no</title>
<style>body{font:18px/1.4 system-ui,sans-serif;margin:0;padding:16px;color:#1d2433;background:#f5f3ec}h1{font-size:22px;margin:0 0 12px}.card{background:#fff;border:1px solid #d9d4c7;border-radius:12px;padding:14px;margin-bottom:12px}.m{color:#5b6477;font-size:15px}button{font:inherit;min-width:64px;padding:12px 18px;margin:6px 8px 0 0;border-radius:10px;border:1px solid #1d2433;background:#1d2433;color:#fff}button.no{background:#fff;color:#1d2433}.done{color:#1b6b3a;font-weight:600}</style></head>
<body><h1>Say yes or no</h1><div id="root"><p>One moment.</p></div>
<script>
(function () {
  var root = document.getElementById('root');
  var t = new URLSearchParams(location.search).get('t') || '';
  var person = '';
  try { person = JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).sub; } catch (e) { person = ''; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function show(text, cls) { root.textContent = ''; root.appendChild(el('p', cls || '', text)); }
  function call(path, body) {
    return fetch('/phone/' + encodeURIComponent(person) + '/' + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      if (r.status === 401) throw new Error('old');
      return r.json();
    });
  }
  function decide(a, number, no, box) {
    var buttons = box.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    call(no ? 'reject' : 'approve', { approval_id: a.id, number: number }).then(function (out) {
      var good = out.status === 'approved' || out.status === 'rejected';
      if (!good) for (var j = 0; j < buttons.length; j++) buttons[j].disabled = false;
      var p = el('p', good ? 'done' : 'm', out.say || 'Done.');
      box.appendChild(p);
      if (good) for (var k = 0; k < buttons.length; k++) buttons[k].style.display = 'none';
    }, function () { show('This link is old. Ask for a new one.'); });
  }
  if (!person) { show('This link does not work.'); return; }
  call('inbox').then(function (inbox) {
    var list = inbox.approvals || [];
    root.textContent = '';
    if (!list.length) { root.appendChild(el('p', '', 'Nothing is waiting.')); return; }
    list.forEach(function (a) {
      var box = el('div', 'card');
      box.appendChild(el('div', '', a.who + ' wants: ' + a.what));
      box.appendChild(el('div', '', a.amount));
      box.appendChild(el('div', 'm', a.why));
      box.appendChild(el('p', 'm', 'Tap the number Alexa said.'));
      a.options.forEach(function (n) { var b = el('button', '', String(n)); b.setAttribute('data-testid', 'link-num-' + n); b.onclick = function () { decide(a, n, false, box); }; box.appendChild(b); });
      var no = el('button', 'no', 'No'); no.setAttribute('data-testid', 'link-no'); no.onclick = function () { decide(a, 0, true, box); }; box.appendChild(no);
      root.appendChild(box);
    });
  }, function () { show('This link is old. Ask for a new one.'); });
})();
</script></body></html>`;

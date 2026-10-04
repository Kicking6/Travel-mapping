/* diag.js — rolling diagnostic buffer for feedback capture.
   From Site Scout (web/diag.js), which ported it verbatim from the Akahu app's
   core.js (AL_DIAG). Loaded before everything else so the buffer is already
   filling when a problem happens. */
window.TA_DIAG = (function () {
  var CONSOLE_CAP = 20, NET_CAP = 10, TEXT_CAP = 400;
  var KEY = 'ta-diag';
  var state = { console: [], net: [] };

  try {
    var saved = sessionStorage.getItem(KEY);
    if (saved) state = JSON.parse(saved) || state;
  } catch (_) { /* private mode, blocked storage — carry on in memory */ }

  function persist() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }
  function push(arr, cap, entry) {
    arr.push(entry);
    while (arr.length > cap) arr.shift();
    persist();
  }
  function clip(s) { return String(s == null ? '' : s).slice(0, TEXT_CAP); }

  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      try {
        push(state.console, CONSOLE_CAP, {
          level: level,
          at: new Date().toISOString(),
          text: clip(Array.prototype.map.call(arguments, function (a) {
            if (a instanceof Error) return a.message;
            if (typeof a === 'object') { try { return JSON.stringify(a); } catch (_) { return '[object]'; } }
            return a;
          }).join(' '))
        });
      } catch (_) {}
      return original.apply(console, arguments);
    };
  });

  window.addEventListener('error', function (e) {
    push(state.console, CONSOLE_CAP, { level: 'uncaught', at: new Date().toISOString(), text: clip(e.message) });
  });
  window.addEventListener('unhandledrejection', function (e) {
    push(state.console, CONSOLE_CAP, {
      level: 'unhandled-rejection', at: new Date().toISOString(),
      text: clip(e.reason && e.reason.message ? e.reason.message : e.reason)
    });
  });

  /* Only failures and genuinely slow calls are kept — a buffer of 200 healthy
     200s would push the one that matters out of a 10-entry window. */
  var SLOW_MS = 4000;
  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = (init && init.method) || (input && input.method) || 'GET';
    var started = Date.now();
    return nativeFetch.apply(window, arguments).then(function (res) {
      var ms = Date.now() - started;
      if (!res.ok || ms > SLOW_MS) {
        push(state.net, NET_CAP, { url: clip(url), method: method, status: res.status, ms: ms, at: new Date().toISOString() });
      }
      return res;
    }).catch(function (err) {
      push(state.net, NET_CAP, {
        url: clip(url), method: method, status: 0, ms: Date.now() - started,
        error: clip(err && err.message), at: new Date().toISOString()
      });
      throw err;
    });
  };

  return {
    snapshot: function () { return { console: state.console.slice(), net: state.net.slice() }; },
    clear: function () { state = { console: [], net: [] }; persist(); }
  };
})();

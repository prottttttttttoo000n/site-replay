// Site Replay Recorder — <2KB gzipped
// Records user interactions and sends them to the backend via WebSocket or POST fallback.

(function () {
  "use strict";

  // ─── Config ───
  var SESSION_ID = crypto.randomUUID();
  var BATCH_SIZE = 50;
  var FLUSH_INTERVAL = 1000;
  var MAX_RETRY = 3;
  var MOUSE_THROTTLE = 50;
  var SCROLL_THROTTLE = 100;

  // ─── State ───
  var buffer = [];
  var ws = null;
  var sessionStartTime = Date.now();
  var retryCount = 0;
  var lastMouseMove = 0;
  var lastScroll = 0;
  var rageClicks = {};

  // ─── Helpers ───
  // NOTE: document.currentScript is only valid while this script is synchronously
  // executing. Capture the host ONCE here; re-deriving it during reconnects would
  // fall back to location.host and send events to the wrong server.
  var host = getHost();

  function getHost() {
    var script = document.currentScript;
    if (script) {
      return script.getAttribute("data-host") || script.src.replace(/^https?:\/\//, "").split("/")[0];
    }
    return location.host;
  }

  function throttle(fn, ms) {
    var last = 0;
    return function () {
      var now = Date.now();
      if (now - last >= ms) {
        last = now;
        fn.apply(null, arguments);
      }
    };
  }

  function getSelector(el) {
    if (!el) return "";
    if (el.id) return "#" + el.id;
    var parts = [];
    var current = el;
    while (current && current !== document.body) {
      var sel = current.tagName.toLowerCase();
      if (current.id) {
        sel = "#" + current.id;
        parts.unshift(sel);
        break;
      }
      if (current.className && typeof current.className === "string") {
        sel += "." + current.className.trim().split(/\s+/).join(".");
      }
      parts.unshift(sel);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function isSensitive(el) {
    var type = (el.type || "").toLowerCase();
    var name = (el.name || "").toLowerCase();
    var autocomplete = (el.autocomplete || "").toLowerCase();
    return (
      type === "password" ||
      name.indexOf("password") !== -1 ||
      name.indexOf("credit") !== -1 ||
      name.indexOf("ssn") !== -1 ||
      autocomplete.indexOf("cc-") !== -1 ||
      autocomplete.indexOf("password") !== -1
    );
  }

  function maskValue(val) {
    var masked = "";
    for (var i = 0; i < val.length; i++) masked += "*";
    return masked;
  }

  // ─── Event Capture ───
  function capture(type, data) {
    var event = { type: type, timestamp: Date.now() - sessionStartTime };
    if (data) {
      for (var key in data) {
        if (data.hasOwnProperty(key)) event[key] = data[key];
      }
    }
    buffer.push(event);
    if (buffer.length >= BATCH_SIZE) flush();
  }

  // Mouse moves (20fps)
  document.addEventListener(
    "mousemove",
    throttle(function (e) {
      capture("mousemove", { x: e.clientX, y: e.clientY });
    }, MOUSE_THROTTLE)
  );

  // Clicks + rage click detection
  document.addEventListener("click", function (e) {
    var target = e.target;
    var selector = getSelector(target);
    var text = (target.textContent || "").slice(0, 100);

    // Rage click detection (3+ clicks in 1s on same element)
    var now = Date.now();
    if (!rageClicks[selector]) rageClicks[selector] = [];
    rageClicks[selector].push(now);
    rageClicks[selector] = rageClicks[selector].filter(function (t) {
      return now - t < 1000;
    });
    if (rageClicks[selector].length >= 3) {
      capture("rageClick", { target: selector, count: rageClicks[selector].length });
      rageClicks[selector] = [];
    }

    capture("click", { target: selector, text: text, x: e.clientX, y: e.clientY });
  });

  // Scrolls (10fps)
  window.addEventListener(
    "scroll",
    throttle(function () {
      capture("scroll", { scrollX: window.scrollX, scrollY: window.scrollY });
    }, SCROLL_THROTTLE)
  );

  // Inputs (masked if sensitive)
  document.addEventListener("input", function (e) {
    var el = e.target;
    var value = isSensitive(el) ? maskValue(el.value) : el.value;
    capture("input", { target: getSelector(el), value: value });
  });

  // Resize
  window.addEventListener("resize", function () {
    capture("resize", { width: window.innerWidth, height: window.innerHeight });
  });

  // ─── DOM Snapshot ───
  function captureSnapshot() {
    try {
      var clone = document.documentElement.cloneNode(true);
      var scripts = clone.querySelectorAll("script");
      for (var i = 0; i < scripts.length; i++) {
        scripts[i].parentNode.removeChild(scripts[i]);
      }

      var head = clone.querySelector("head");
      if (!head) {
        head = document.createElement("head");
        clone.insertBefore(head, clone.firstChild);
      }

      // Resolve relative CSS/images to the original URL when replayed in an iframe.
      var base = document.createElement("base");
      base.href = location.href;
      head.insertBefore(base, head.firstChild);

      // Bridge: reports scroll sizes to the parent, applies scroll commands during replay.
      var bridge = document.createElement("script");
      bridge.textContent =
        "(function(){function h(){try{parent.postMessage({__sr:1,h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth},'*')}catch(e){}}h();window.addEventListener('load',h);setInterval(h,500);window.addEventListener('message',function(m){var d=m.data;if(d&&d.__srScroll){window.scrollTo(d.x,d.y)}})})();";
      head.appendChild(bridge);

      var html = "<!DOCTYPE html>" + clone.outerHTML;
      capture("snapshot", {
        html: html,
        url: location.href,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
    } catch (e) {
      // Snapshot is best-effort; never break recording on a serialization error.
    }
  }

  function maybeCaptureSnapshot() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", captureSnapshot, { once: true });
    } else {
      captureSnapshot();
    }
  }

  // ─── Transport ───
  function send(events) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(events));
      retryCount = 0;
    } else {
      // POST fallback (absolute URL — the page may be hosted on a different origin)
      fetch("https://" + host + "/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID, events: events }),
      }).catch(function () {
        if (retryCount < MAX_RETRY) {
          retryCount++;
          setTimeout(function () {
            send(events);
          }, 1000 * Math.pow(2, retryCount));
        }
      });
    }
  }

  function flush() {
    if (buffer.length === 0) return;
    var batch = buffer.splice(0, BATCH_SIZE);
    send(batch);
  }

  // ─── WebSocket ───
  function connect() {
    ws = new WebSocket("wss://" + host + "/ws/record?sid=" + SESSION_ID);

    ws.onopen = function () {
      retryCount = 0;
      // Send initial navigation event
      capture("navigation", {
        url: location.href,
        referrer: document.referrer,
        userAgent: navigator.userAgent,
        screenWidth: screen.width,
        screenHeight: screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      flush();
    };

    ws.onclose = function () {
      var delay = Math.min(30000, 1000 * Math.pow(2, retryCount));
      retryCount++;
      setTimeout(connect, delay);
    };

    ws.onerror = function () {
      ws.close();
    };
  }

  // ─── Init ───
  if (!window.__SITE_REPLAY_OPT_OUT) {
    maybeCaptureSnapshot();
    connect();
    setInterval(flush, FLUSH_INTERVAL);
    window.addEventListener("beforeunload", flush);
  }
})();

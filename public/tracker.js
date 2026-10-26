/*! Analytica tracker. Original implementation. */
(function () {
  "use strict";
  var w = window,
    d = document,
    n = navigator,
    tag = d.currentScript;
  if (!tag || (w.analytica && w.analytica.installed)) return;
  var site = tag.getAttribute("data-site");
  if (!site) return;
  var endpoint =
    tag.getAttribute("data-endpoint") ||
    new URL(tag.src).origin + "/v1/collect";
  var configuredMode =
    tag.getAttribute("data-mode") === "attribution"
      ? "attribution"
      : "aggregate";
  var allowLocal = tag.hasAttribute("data-allow-localhost");
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var disabled =
    (n.webdriver && !tag.hasAttribute("data-allow-automation")) ||
    (local && !allowLocal);
  var consent = configuredMode === "aggregate",
    optedOut = false;
  var vid = "",
    sid = "",
    lastInteraction = 0,
    sequence = 0,
    lastPage = "",
    first = true;
  var queue = [],
    sending = false,
    activeSince = 0;
  var cookiePrefix = "an_" + site.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  var prior = (w.analytica && w.analytica.q) || [];
  var DAY = 86400000;
  function id() {
    return crypto.randomUUID();
  }
  function cookie(name) {
    try {
      var key = cookiePrefix + "_" + name + "=";
      var found = d.cookie.split("; ").filter(function (s) {
        return s.indexOf(key) === 0;
      })[0];
      return found ? decodeURIComponent(found.slice(key.length)) : "";
    } catch (_) {
      return "";
    }
  }
  function setCookie(name, value, seconds) {
    d.cookie =
      cookiePrefix +
      "_" +
      name +
      "=" +
      encodeURIComponent(value) +
      "; Path=/; Max-Age=" +
      seconds +
      "; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }
  function erase() {
    ["vid", "sid", "interaction"].forEach(function (name) {
      setCookie(name, "", 0);
    });
    vid = "";
    sid = "";
    lastInteraction = 0;
  }
  function enabled() {
    return !disabled && !optedOut && consent;
  }
  function initialize() {
    if (configuredMode === "attribution") {
      vid = cookie("vid") || id();
      sid = cookie("sid") || id();
      lastInteraction = Number(cookie("interaction")) || 0;
    } else {
      vid = id();
      sid = id();
    }
  }
  function interaction() {
    var now = Date.now();
    if (!vid) initialize();
    if (lastInteraction && now - lastInteraction >= 1800000) {
      sid = id();
      sequence = 0;
    }
    lastInteraction = now;
    if (configuredMode === "attribution") {
      setCookie("vid", vid, 7776000);
      setCookie("sid", sid, 1800);
      setCookie("interaction", String(now), 1800);
    }
  }
  function path(value) {
    try {
      var u = new URL(value, location.href);
      // Query values and fragments never leave the page. Allow owners to suppress sensitive paths entirely.
      if (tag.hasAttribute("data-redact-path")) return "/[redacted]";
      return u.pathname.replace(/\/+$/, "") || "/";
    } catch (_) {
      return "/";
    }
  }
  function campaign() {
    var q = new URLSearchParams(location.search),
      result = {};
    [
      ["utm_source", "source"],
      ["utm_medium", "medium"],
      ["utm_campaign", "name"],
    ].forEach(function (pair) {
      var v = q.get(pair[0]);
      if (v) result[pair[1]] = v.slice(0, 100);
    });
    return result;
  }
  function referrer() {
    try {
      return new URL(d.referrer).origin;
    } catch (_) {
      return "";
    }
  }
  function scheduleSend() {
    if (sending || !queue.length || !enabled()) return;
    sending = true;
    var item = queue[0];
    fetch(endpoint, {
      method: "POST",
      body: JSON.stringify(item.event),
      headers: { "Content-Type": "text/plain" },
      keepalive: true,
      credentials: "omit",
    })
      .then(function (r) {
        if (r.status === 409 && item.resets < 1) {
          return r.json().then(function (body) {
            if (!body.resetSession) return false;
            var old = item.event.sessionId;
            sid = id();
            sequence = 0;
            item.resets++;
            queue.forEach(function (pending) {
              if (pending.event.sessionId === old)
                pending.event.sessionId = sid;
            });
            if (configuredMode === "attribution") setCookie("sid", sid, 1800);
            return "reset";
          });
        }
        if (r.status === 429 || r.status >= 500) return "retry";
        return false;
      })
      .catch(function () {
        return "retry";
      })
      .then(function (outcome) {
        sending = false;
        if (queue[0] !== item) {
          scheduleSend();
          return;
        }
        if (outcome === "reset") {
          scheduleSend();
          return;
        }
        if (
          outcome === "retry" &&
          ++item.attempts < 3 &&
          Date.now() - item.event.timestamp < DAY
        ) {
          setTimeout(
            scheduleSend,
            Math.min(30000, 1000 * Math.pow(2, item.attempts)),
          );
          return;
        }
        queue.shift();
        scheduleSend();
      });
  }
  function emit(type, extra, isInteraction) {
    if (!enabled()) return;
    if (isInteraction) interaction();
    if (!vid || !sid || queue.length >= 40) return;
    var event = {
      version: 1,
      id: id(),
      siteId: site,
      type: type,
      timestamp: Date.now(),
      sequence: ++sequence,
      visitorId: vid,
      sessionId: sid,
      mode: configuredMode,
      hostname: location.hostname,
      path: path(location.href),
    };
    Object.keys(extra || {}).forEach(function (key) {
      event[key] = extra[key];
    });
    queue.push({ event: event, attempts: 0, resets: 0 });
    scheduleSend();
  }
  function flushTime() {
    var now = Date.now();
    if (activeSince && now - lastInteraction < 1800000) {
      var duration = Math.min(60000, Math.max(0, now - activeSince));
      if (duration >= 1000) emit("engagement", { duration: duration }, false);
    }
    activeSince = enabled() && d.visibilityState === "visible" ? now : 0;
  }
  function pageview(force) {
    if (!enabled()) return;
    var current = location.pathname;
    if (!force && lastPage === current) return;
    flushTime();
    var extra = first ? { referrer: referrer(), campaign: campaign() } : {};
    lastPage = current;
    first = false;
    emit("pageview", extra, true);
    activeSince = d.visibilityState === "visible" ? Date.now() : 0;
  }
  function api(command, value) {
    if (command === "consent") {
      var granted = value === true;
      if (consent === granted) return;
      consent = granted;
      if (!granted) {
        erase();
        queue = [];
        activeSince = 0;
      } else {
        first = true;
        lastPage = "";
        pageview(true);
      }
    } else if (command === "optOut") {
      optedOut = value !== false;
      try {
        localStorage.setItem(cookiePrefix + "_optout", optedOut ? "1" : "0");
      } catch (_) {}
      if (optedOut) {
        erase();
        queue = [];
        activeSince = 0;
      } else {
        first = true;
        pageview(true);
      }
    } else if (
      command === "goal" &&
      typeof value === "string" &&
      value.trim()
    ) {
      emit("goal", { name: value.trim().slice(0, 64) }, true);
    } else if (command === "pageview") pageview(true);
  }
  api.installed = true;
  api.attribution = function () {
    if (
      !enabled() ||
      configuredMode !== "attribution" ||
      !vid ||
      Date.now() - lastInteraction >= 1800000
    )
      return null;
    return { visitorId: vid, sessionId: sid };
  };
  w.analytica = api;
  try {
    optedOut = localStorage.getItem(cookiePrefix + "_optout") === "1";
  } catch (_) {}
  if (n.globalPrivacyControl) optedOut = true;
  ["pushState", "replaceState"].forEach(function (method) {
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      queueMicrotask(function () {
        pageview(false);
      });
      return result;
    };
  });
  w.addEventListener("popstate", function () {
    pageview(false);
  });
  d.addEventListener("visibilitychange", flushTime);
  w.addEventListener("pagehide", function () {
    flushTime();
    // In-flight fetch already uses keepalive. Only beacon unsent items; event IDs make races duplicate-safe.
    if (enabled() && n.sendBeacon)
      queue.slice(sending ? 1 : 0).forEach(function (item) {
        n.sendBeacon(
          endpoint,
          new Blob([JSON.stringify(item.event)], { type: "text/plain" }),
        );
      });
  });
  d.addEventListener(
    "click",
    function (event) {
      var target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      var goal = target.closest("[data-analytica-goal]");
      if (goal) api("goal", goal.getAttribute("data-analytica-goal"));
      var link = target.closest("a[href]");
      if (link) {
        try {
          var u = new URL(link.href);
          if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname)
            emit("outbound", { name: u.origin + path(u.href) }, true);
        } catch (_) {}
      }
    },
    { passive: true },
  );
  setInterval(flushTime, 60000);
  prior.forEach(function (args) {
    api.apply(null, args);
  });
  pageview(false);
})();

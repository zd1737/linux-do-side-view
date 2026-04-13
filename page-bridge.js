const HOSTNAME = "linux.do";
const SIDEBAR_POLL_HOSTNAME = "ping.linux.do";
const SIDEBAR_REFRESH_SECTIONS_CHANNEL = "/refresh-sidebar-sections";
const PRESENCE_USERS_CLASS = "presence-users";
const SIDEVIEW_OPEN_CLASS = "ds-sideview-open";
const FAST_SIDEBAR_POLL_THRESHOLD_MS = 2_000;
const MAX_CONSECUTIVE_FAST_SIDEBAR_POLLS = 3;
const SIDEBAR_POLL_COOLDOWN_MS = 20_000;
const XHR_META_KEY = "__dsSideviewXhrMeta";
const POLL_MODE_BLOCKED = "blocked";
const POLL_MODE_PRESENCE = "presence";
const POLL_MODE_FINAL_REFRESH = "final-refresh";
const BODY_BLOCKED = Symbol("dsSideviewBodyBlocked");
const BODY_UNCHANGED = Symbol("dsSideviewBodyUnchanged");
let allowOneTrailingSidebarPoll = false;
let consecutiveFastSidebarPolls = 0;
let sidebarPollCooldownUntil = 0;

// 只在目标网站进行拦截
if (window.location.hostname === HOSTNAME) {
  if (window.top !== window) {
    // 处于 iframe（分栏侧边栏）内时，拦截侧边栏状态保存
    initSidebarSaveBridge();
    // 监听来自主页面的 SPA 导航指令
    initNavigationBridge();
  } else {
    // 处于主页面时，拦截滚动事件同步给虚拟滚动条
    initMainPageScrollBridge();
  }
}

/**
 * 初始化主页面滚动拦截桥
 * 由于分栏模式下劫持了滚动区域到 body 上，导致 SPA 内部触发的页面置顶无法正确生效
 */
function initMainPageScrollBridge() {
  if (window.__dsSideviewMainScrollBridgeInstalled) {
    return;
  }

  window.__dsSideviewMainScrollBridgeInstalled = true;

  function isSideViewOpen() {
    return document.documentElement && document.documentElement.classList.contains("ds-sideview-open");
  }

  function getVirtualScroller() {
    return document.body;
  }

  // 1. 拦截 window.scrollTo, window.scroll, window.scrollBy
  const windowMethods = ['scrollTo', 'scroll', 'scrollBy'];
  windowMethods.forEach(method => {
    const original = window[method];
    if (typeof original === 'function') {
      window[method] = function() {
        original.apply(this, arguments);
        if (isSideViewOpen()) {
          const scroller = getVirtualScroller();
          if (scroller) {
            let top, left;
            if (arguments.length === 1 && typeof arguments[0] === 'object' && arguments[0] !== null) {
              top = arguments[0].top;
              left = arguments[0].left;
            } else if (arguments.length >= 2) {
              left = arguments[0];
              top = arguments[1];
            }
            
            if (method === 'scrollBy') {
              if (top !== undefined) scroller.scrollTop += top;
              if (left !== undefined) scroller.scrollLeft += left;
            } else {
              if (top !== undefined) scroller.scrollTop = top;
              if (left !== undefined) scroller.scrollLeft = left;
            }
          }
        }
      };
    }
  });

  // 2. 拦截 Element.prototype.scrollTo, scroll, scrollBy (Discourse 可能调用 document.documentElement.scrollTo)
  const elementMethods = ['scrollTo', 'scroll', 'scrollBy'];
  elementMethods.forEach(method => {
    const original = Element.prototype[method];
    if (typeof original === 'function') {
      Element.prototype[method] = function() {
        if (isSideViewOpen() && (this === document.documentElement || this === document.scrollingElement)) {
          const scroller = getVirtualScroller();
          if (scroller) {
            original.apply(scroller, arguments);
            return;
          }
        }
        original.apply(this, arguments);
      };
    }
  });

  // 3. 拦截 document.documentElement.scrollTop 的 getter 和 setter
  try {
    const originalDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (originalDesc) {
      Object.defineProperty(document.documentElement, 'scrollTop', {
        get: function() {
          if (isSideViewOpen()) {
            const scroller = getVirtualScroller();
            if (scroller) return scroller.scrollTop;
          }
          return originalDesc.get.call(this);
        },
        set: function(val) {
          if (isSideViewOpen()) {
            const scroller = getVirtualScroller();
            if (scroller) {
              scroller.scrollTop = val;
              return;
            }
          }
          originalDesc.set.call(this, val);
        }
      });
    }
  } catch(e) {
    // 忽略无法重新定义的错误
  }

  // 4. 拦截 window.scrollY 和 window.pageYOffset 的 getter（修复可能的滚动位置监听，如无限下拉）
  ['scrollY', 'pageYOffset'].forEach(prop => {
    try {
      const originalDesc = Object.getOwnPropertyDescriptor(window, prop) || Object.getOwnPropertyDescriptor(Window.prototype, prop);
      if (originalDesc) {
        Object.defineProperty(window, prop, {
          get: function() {
            if (isSideViewOpen()) {
              const scroller = getVirtualScroller();
              if (scroller) return scroller.scrollTop;
            }
            return originalDesc.get.call(this);
          }
        });
      }
    } catch(e) {
      // 忽略无法重新定义的错误
    }
  });

  // 5. 拦截 document.documentElement 的 scrollHeight 和 clientHeight
  // 分栏模式下 html 被设为 height:100vh; overflow:hidden，导致 scrollHeight 等于视口高度
  // Discourse 的无限滚动检查 scrollTop + innerHeight >= scrollHeight 时会始终为 true，不断触发加载
  ['scrollHeight', 'clientHeight'].forEach(prop => {
    try {
      const originalDesc = Object.getOwnPropertyDescriptor(Element.prototype, prop);
      if (originalDesc) {
        Object.defineProperty(document.documentElement, prop, {
          get: function() {
            if (isSideViewOpen()) {
              const scroller = getVirtualScroller();
              if (scroller) return originalDesc.get.call(scroller);
            }
            return originalDesc.get.call(this);
          },
          configurable: true
        });
      }
    } catch(e) {
      // 忽略无法重新定义的错误
    }
  });
}

/**
 * 初始化侧边栏状态保存拦截桥
 * 主要是为了防止 iframe 中的操作修改了用户的全局侧边栏状态
 */
function initSidebarSaveBridge() {
  if (window.__dsSideviewSidebarSaveBridgeInstalled) {
    return;
  }

  window.__dsSideviewSidebarSaveBridgeInstalled = true;
  // 拦截 fetch 请求
  interceptFetch();
  // 拦截 XHR 请求
  interceptXhr();
  // 拦截 sendBeacon 请求
  interceptSendBeacon();
  // 拦截 LocalStorage 写入
  interceptLocalStorage();
}

/**
 * 拦截并屏蔽往 localStorage 写入侧边栏状态的行为
 * 由于不同环境/版本下 Discourse 可能通过不同方式操作 localStorage，这里进行了多层防御
 */
function interceptLocalStorage() {
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  // 判断是否是修改侧边栏隐藏状态的 key
  const isSidebarKey = (key) => typeof key === "string" && key.indexOf("discourse_sidebar-hidden") !== -1;

  // 1. 拦截标准 setItem
  Storage.prototype.setItem = function (key, value) {
    if (isSidebarKey(key)) {
      return;
    }
    return originalSetItem.apply(this, arguments);
  };

  // 2. 拦截标准 removeItem
  Storage.prototype.removeItem = function (key) {
    if (isSidebarKey(key)) {
      return;
    }
    return originalRemoveItem.apply(this, arguments);
  };

  // 3. 尝试拦截直接属性赋值 (例如 localStorage["discourse_sidebar-hidden"] = "true")
  try {
    const originalLocalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      get: function () {
        return new Proxy(originalLocalStorage, {
          set: function (target, prop, value) {
            if (isSidebarKey(prop)) {
              return true; // 拦截并假装成功
            }
            target[prop] = value;
            return true;
          },
          deleteProperty: function (target, prop) {
            if (isSidebarKey(prop)) {
              return true; // 拦截并假装成功
            }
            delete target[prop];
            return true;
          },
          get: function (target, prop) {
            const value = target[prop];
            // 绑定函数上下文，防止调用报错
            if (typeof value === "function") {
              return value.bind(target);
            }
            return value;
          }
        });
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    // 忽略 localStorage 无法被重新定义的错误（某些浏览器环境可能限制）
  }
}

/**
 * 拦截 fetch 请求。
 * 回复态时放行原始 poll；回复结束后再放行一次普通 poll
 * 用于刷新最新消息；只有连续异常短轮询时才进入 20 秒冷却。
 */
function interceptFetch() {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") {
    return;
  }

  window.fetch = function fetchWithSidebarSaveIsolation(input, init) {
    const request = input instanceof Request ? input : null;
    const requestMeta = {
      method: init?.method || request?.method || "GET",
      url: request?.url || String(input)
    };

    if (!isSidebarPollRequest(requestMeta)) {
      return originalFetch.apply(this, arguments);
    }

    const pollMode = getSidebarPollMode();
    if (pollMode === POLL_MODE_BLOCKED) {
      return Promise.resolve(createBlockedFetchResponse());
    }

    if (hasOwnBody(init)) {
      const nextBody = filterSidebarPollBody(init.body, pollMode);
      if (nextBody === BODY_BLOCKED) {
        return Promise.resolve(createBlockedFetchResponse());
      }

      if (nextBody === BODY_UNCHANGED) {
        if (shouldCooldownSidebarPoll(pollMode)) {
          return Promise.resolve(createBlockedFetchResponse());
        }

        return trackRealSidebarPollFetch(originalFetch.apply(this, arguments), pollMode);
      }

      if (shouldCooldownSidebarPoll(pollMode)) {
        return Promise.resolve(createBlockedFetchResponse());
      }

      return trackRealSidebarPollFetch(originalFetch.call(this, input, {
        ...init,
        body: nextBody
      }), pollMode);
    }

    if (request) {
      return rewriteFetchRequestBody(originalFetch, this, request, pollMode);
    }

    return originalFetch.apply(this, arguments);
  };
}

/**
 * 拦截 XMLHttpRequest 请求，提取请求信息并判断是否需要拦截
 */
function interceptXhr() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function openWithSidebarSaveMeta(method, url) {
    // 将请求基础信息存储在实例上，以便 send 方法中读取
    this[XHR_META_KEY] = {
      method,
      url: String(url)
    };

    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function sendWithSidebarSaveIsolation(body) {
    const meta = this[XHR_META_KEY] || {};
    const request = {
      method: meta.method,
      url: meta.url
    };

    if (!isSidebarPollRequest(request)) {
      return originalSend.apply(this, arguments);
    }

    const pollMode = getSidebarPollMode();
    if (pollMode === POLL_MODE_BLOCKED) {
      resolveBlockedXhr(this, meta.url);
      return;
    }

    const nextBody = filterSidebarPollBody(body, pollMode);
    if (nextBody === BODY_BLOCKED) {
      resolveBlockedXhr(this, meta.url);
      return;
    }

    if (shouldCooldownSidebarPoll(pollMode)) {
      resolveBlockedXhr(this, meta.url);
      return;
    }

    attachRealSidebarPollXhrTracking(this, pollMode);

    if (nextBody !== BODY_UNCHANGED) {
      return originalSend.call(this, nextBody);
    }

    return originalSend.apply(this, arguments);
  };
}

/**
 * 拦截 navigator.sendBeacon 方法
 */
function interceptSendBeacon() {
  if (typeof navigator.sendBeacon !== "function") {
    return;
  }

  const originalSendBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function sendBeaconWithSidebarSaveIsolation(url, data) {
    const request = {
      method: "POST", // sendBeacon 总是 POST
      url: String(url)
    };

    if (!isSidebarPollRequest(request)) {
      return originalSendBeacon(url, data);
    }

    const pollMode = getSidebarPollMode();
    if (pollMode === POLL_MODE_BLOCKED) {
      return true;
    }

    const nextData = filterSidebarPollBody(data, pollMode);
    if (nextData === BODY_BLOCKED) {
      return true;
    }

    if (shouldCooldownSidebarPoll(pollMode)) {
      return true;
    }

    if (nextData !== BODY_UNCHANGED) {
      return originalSendBeacon(url, nextData);
    }

    return originalSendBeacon(url, data);
  };
}

/**
 * 回复态时允许原始轮询，退出回复态后再放行一次普通 poll 用于刷新最新消息
 */
function getSidebarPollMode() {
  if (!isParentSideViewOpen()) {
    allowOneTrailingSidebarPoll = false;
    consecutiveFastSidebarPolls = 0;
    sidebarPollCooldownUntil = 0;
    return POLL_MODE_BLOCKED;
  }

  if (hasPresenceUsersUi()) {
    allowOneTrailingSidebarPoll = true;
    return POLL_MODE_PRESENCE;
  }

  if (allowOneTrailingSidebarPoll) {
    return POLL_MODE_FINAL_REFRESH;
  }

  return POLL_MODE_BLOCKED;
}

/**
 * 只有主页面侧边栏仍处于打开状态时，iframe 才允许继续发真实 poll
 */
function isParentSideViewOpen() {
  try {
    return Boolean(
      window.parent &&
      window.parent !== window &&
      window.parent.document &&
      window.parent.document.documentElement &&
      window.parent.document.documentElement.classList.contains(SIDEVIEW_OPEN_CLASS)
    );
  } catch {
    return false;
  }
}

/**
 * 只有连续异常短轮询时才进入冷却；final refresh 不受冷却限制
 */
function shouldCooldownSidebarPoll(pollMode) {
  return pollMode !== POLL_MODE_FINAL_REFRESH && Date.now() < sidebarPollCooldownUntil;
}

/**
 * presence-users UI 只是总开关，只有回复场景才允许进入实时轮询
 */
function hasPresenceUsersUi() {
  return document.getElementsByClassName(PRESENCE_USERS_CLASS).length > 0;
}

/**
 * 按当前轮询模式过滤 poll 请求体
 */
function filterSidebarPollBody(body, pollMode) {
  if (body == null) {
    return BODY_BLOCKED;
  }

  if (typeof body === "string") {
    const params = new URLSearchParams(body);
    const filtered = collectFilteredSidebarPollEntries(params.entries());
    if (!canSendFilteredSidebarPoll(filtered)) {
      return BODY_BLOCKED;
    }
    if (!filtered.changed) {
      return BODY_UNCHANGED;
    }

    const nextBody = new URLSearchParams();
    for (const [key, value] of filtered.entries) {
      nextBody.append(key, value);
    }
    return nextBody.toString();
  }

  if (body instanceof URLSearchParams) {
    const filtered = collectFilteredSidebarPollEntries(body.entries());
    if (!canSendFilteredSidebarPoll(filtered)) {
      return BODY_BLOCKED;
    }
    if (!filtered.changed) {
      return BODY_UNCHANGED;
    }

    const nextBody = new URLSearchParams();
    for (const [key, value] of filtered.entries) {
      nextBody.append(key, value);
    }
    return nextBody;
  }

  if (body instanceof FormData) {
    const filtered = collectFilteredSidebarPollEntries(body.entries());
    if (!canSendFilteredSidebarPoll(filtered)) {
      return BODY_BLOCKED;
    }
    if (!filtered.changed) {
      return BODY_UNCHANGED;
    }

    const nextBody = new FormData();
    for (const [key, value] of filtered.entries) {
      nextBody.append(key, value);
    }

    return nextBody;
  }

  return BODY_BLOCKED;
}

/**
 * 汇总应保留的 poll 表单项
 */
function collectFilteredSidebarPollEntries(entries) {
  const nextEntries = [];
  let changed = false;
  let hasAnyChannel = false;

  for (const [key, value] of entries) {
    if (shouldKeepSidebarPollField(key)) {
      nextEntries.push([key, value]);
      if (isPollChannelField(key)) {
        hasAnyChannel = true;
      }
    } else {
      changed = true;
    }
  }

  return {
    entries: nextEntries,
    changed,
    hasAnyChannel
  };
}

/**
 * 判定当前过滤结果是否仍然值得发真实请求
 */
function canSendFilteredSidebarPoll(filtered) {
  return filtered.hasAnyChannel;
}

/**
 * 判定指定表单项是否应该继续参与真实 poll
 */
function shouldKeepSidebarPollField(key) {
  if (!isPollChannelField(key)) {
    return true;
  }

  if (key === SIDEBAR_REFRESH_SECTIONS_CHANNEL) {
    return false;
  }

  return true;
}

/**
 * 判定表单项是否是 message-bus 频道字段
 */
function isPollChannelField(key) {
  return typeof key === "string" && key.startsWith("/");
}

/**
 * 判定是否是针对侧边栏状态的轮询请求
 */
function isSidebarPollRequest(request) {
  const absoluteUrl = getAbsoluteUrl(request?.url);
  // 必须发往指定的轮询域名
  if (!absoluteUrl || absoluteUrl.hostname !== SIDEBAR_POLL_HOSTNAME) {
    return false;
  }

  // 必须是 message-bus 的 poll 接口
  if (!/^\/message-bus\/[^/]+\/poll$/i.test(absoluteUrl.pathname)) {
    return false;
  }

  const method = String(request?.method || "GET").toUpperCase();
  if (method !== "POST") {
    return false;
  }

  return true;
}

/**
 * 判断 init 里是否显式传入了 body
 */
function hasOwnBody(init) {
  return !!init && Object.prototype.hasOwnProperty.call(init, "body");
}

/**
 * 将相对 URL 转换为绝对 URL 对象
 */
function getAbsoluteUrl(rawUrl) {
  try {
    return new URL(rawUrl, window.location.href);
  } catch {
    return null;
  }
}

/**
 * 为被拦截的 fetch 请求构造一个默认的成功响应
 */
function createBlockedFetchResponse() {
  return new Response("[]", {
    status: 200,
    statusText: "OK",
    headers: {
      "Content-Type": "application/json"
    }
  });
}

/**
 * 为被拦截的 XHR 请求模拟一个成功的响应
 */
function resolveBlockedXhr(xhr, rawUrl) {
  const responseText = "[]";
  const response = xhr.responseType === "json" ? [] : responseText;
  const responseUrl = getAbsoluteUrl(rawUrl)?.toString() || window.location.href;

  defineGetter(xhr, "readyState", 4);
  defineGetter(xhr, "status", 200);
  defineGetter(xhr, "statusText", "OK");
  defineGetter(xhr, "responseURL", responseUrl);
  defineGetter(xhr, "response", response);

  if (xhr.responseType === "" || xhr.responseType === "text") {
    defineGetter(xhr, "responseText", responseText);
  }

  xhr.getResponseHeader = function getResponseHeader(name) {
    return typeof name === "string" && name.toLowerCase() === "content-type"
      ? "application/json"
      : null;
  };

  xhr.getAllResponseHeaders = function getAllResponseHeaders() {
    return "content-type: application/json\r\n";
  };

  queueMicrotask(() => {
    xhr.dispatchEvent(new Event("readystatechange"));
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new ProgressEvent("loadend"));
  });
}

/**
 * 辅助函数：快速定义对象只读属性
 */
function defineGetter(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    get: () => value
  });
}

/**
 * 记录 fetch 轮询的实际耗时，用于识别异常短轮询
 */
function trackRealSidebarPollFetch(promise, pollMode) {
  const startedAt = Date.now();
  return Promise.resolve(promise).finally(() => {
    recordRealSidebarPollCompletion(startedAt, pollMode);
  });
}

/**
 * 记录 XHR 轮询的实际耗时，用于识别异常短轮询
 */
function attachRealSidebarPollXhrTracking(xhr, pollMode) {
  const startedAt = Date.now();
  xhr.addEventListener("loadend", () => {
    recordRealSidebarPollCompletion(startedAt, pollMode);
  }, { once: true });
}

/**
 * 根据真实 poll 的持续时间决定是否进入冷却
 */
function recordRealSidebarPollCompletion(startedAt, pollMode) {
  if (pollMode === POLL_MODE_FINAL_REFRESH) {
    allowOneTrailingSidebarPoll = false;
  }

  const duration = Date.now() - startedAt;
  if (duration >= FAST_SIDEBAR_POLL_THRESHOLD_MS) {
    consecutiveFastSidebarPolls = 0;
    sidebarPollCooldownUntil = 0;
    return;
  }

  consecutiveFastSidebarPolls += 1;
  if (consecutiveFastSidebarPolls >= MAX_CONSECUTIVE_FAST_SIDEBAR_POLLS) {
    consecutiveFastSidebarPolls = 0;
    sidebarPollCooldownUntil = Date.now() + SIDEBAR_POLL_COOLDOWN_MS;
  }
}

/**
 * 处理 fetch(Request) 这类 body 不在 init 里的请求
 */
async function rewriteFetchRequestBody(originalFetch, context, request, pollMode) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType && !contentType.includes("application/x-www-form-urlencoded")) {
    return Promise.resolve(createBlockedFetchResponse());
  }

  try {
    const bodyText = await request.clone().text();
    const nextBody = filterSidebarPollBody(bodyText, pollMode);
    if (nextBody === BODY_BLOCKED) {
      return createBlockedFetchResponse();
    }

    if (nextBody === BODY_UNCHANGED) {
      if (shouldCooldownSidebarPoll(pollMode)) {
        return createBlockedFetchResponse();
      }

      return trackRealSidebarPollFetch(originalFetch.call(context, request), pollMode);
    }

    if (shouldCooldownSidebarPoll(pollMode)) {
      return createBlockedFetchResponse();
    }

    const nextRequest = new Request(request, { body: nextBody });
    return trackRealSidebarPollFetch(originalFetch.call(context, nextRequest), pollMode);
  } catch {
    if (shouldCooldownSidebarPoll(pollMode)) {
      return createBlockedFetchResponse();
    }

    return trackRealSidebarPollFetch(originalFetch.call(context, request), pollMode);
  }
}

/**
 * 初始化导航桥接：监听主页面发来的 postMessage，使用 Discourse SPA 路由进行导航
 * 此函数运行在 iframe 内的 MAIN world，可以访问 DiscourseURL 等页面全局变量
 */
function initNavigationBridge() {
  if (window.__dsSideviewNavigationBridgeInstalled) {
    return;
  }

  window.__dsSideviewNavigationBridgeInstalled = true;

  // 监听用户交互并通知父页面，用于控制遮罩状态
  const notifyInteraction = (event) => {
    // 传递光标的屏幕X坐标（相对于视口）
    const x = event.clientX;
    window.parent.postMessage({ type: "ds-iframe-interaction", x: x }, window.location.origin);
  };
  
  window.addEventListener("mousemove", notifyInteraction, { passive: true });
  // 也监听点击和按键等交互，如果有交互，默认鼠标在右侧
  const notifyActive = () => {
    window.parent.postMessage({ type: "ds-iframe-interaction", x: window.innerWidth / 2 }, window.location.origin);
  };
  window.addEventListener("click", notifyActive, { passive: true });
  window.addEventListener("keydown", notifyActive, { passive: true });

  window.addEventListener("message", (event) => {
    // 只接受同源消息
    if (event.origin !== window.location.origin) {
      return;
    }

    const data = event.data;
    if (!data || data.type !== "ds-sideview-navigate") {
      return;
    }

    const path = data.path;
    if (typeof path !== "string" || !path.startsWith("/t/")) {
      return;
    }

    // 优先使用 DiscourseURL.routeTo
    if (window.DiscourseURL && typeof window.DiscourseURL.routeTo === "function") {
      window.DiscourseURL.routeTo(path);
      return;
    }

    // 备选：Ember 容器
    const container = window.Discourse?.__container__;
    if (container) {
      const router = container.lookup("service:router");
      if (router && typeof router.transitionTo === "function") {
        router.transitionTo(path);
        return;
      }
    }

    window.location.href = path;
  });
}
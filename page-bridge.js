const HOSTNAME = "linux.do";
const SIDEBAR_POLL_HOSTNAME = "ping.linux.do";
const XHR_META_KEY = "__dsSideviewXhrMeta";

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
 * 主要是为了防止 iframe 中的操作修改了用户的全局侧边栏状态（比如把主页面的侧边栏收起了）
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
 * 拦截 fetch 请求，如果是保存侧边栏状态的请求则直接返回成功响应
 */
function interceptFetch() {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") {
    return;
  }

  window.fetch = function fetchWithSidebarSaveBlock(input, init) {
    const request = normalizeFetchRequest(input, init);
    // 命中拦截规则则直接返回空结果（假装请求成功了）
    if (shouldBlockRequest(request)) {
      return Promise.resolve(createBlockedFetchResponse());
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

  XMLHttpRequest.prototype.send = function sendWithSidebarSaveBlock(body) {
    const meta = this[XHR_META_KEY] || {};
    const request = {
      method: meta.method,
      url: meta.url,
      body: normalizeBody(body)
    };

    // 命中拦截规则则构建虚拟成功响应并触发相关事件
    if (shouldBlockRequest(request)) {
      resolveBlockedXhr(this, meta.url);
      return;
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
  navigator.sendBeacon = function sendBeaconWithSidebarSaveBlock(url, data) {
    const request = {
      method: "POST", // sendBeacon 总是 POST
      url: String(url),
      body: normalizeBody(data)
    };

    if (shouldBlockRequest(request)) {
      return true; // 返回 true 表示数据已加入传输队列
    }

    return originalSendBeacon(url, data);
  };
}

/**
 * 判断当前请求是否需要被拦截
 */
function shouldBlockRequest(request) {
  return isSidebarPollRequest(request);
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
 * 提取并规范化 fetch 请求参数
 */
function normalizeFetchRequest(input, init) {
  const request = input instanceof Request ? input : null;

  return {
    method: init?.method || request?.method || "GET",
    url: request?.url || String(input),
    body: normalizeBody(init?.body)
  };
}

/**
 * 规范化请求体，便于后续需要时进行参数提取或校验
 */
function normalizeBody(body) {
  if (!body) {
    return "";
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof FormData) {
    return Array.from(body.entries())
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : "[binary]"}`)
      .join("&");
  }

  // Blob、ArrayBuffer 等二进制数据由于解析复杂直接忽略
  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return "";
  }

  return String(body);
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
 * 为被拦截的 fetch 请求构造一个默认的成功的 Response
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

  // 使用 Object.defineProperty 设置只读属性
  defineGetter(xhr, "readyState", 4);
  defineGetter(xhr, "status", 200);
  defineGetter(xhr, "statusText", "OK");
  defineGetter(xhr, "responseURL", responseUrl);
  defineGetter(xhr, "response", response);

  if (xhr.responseType === "" || xhr.responseType === "text") {
    defineGetter(xhr, "responseText", responseText);
  }

  // 模拟响应头方法
  xhr.getResponseHeader = function getResponseHeader(name) {
    return typeof name === "string" && name.toLowerCase() === "content-type"
      ? "application/json"
      : null;
  };

  xhr.getAllResponseHeaders = function getAllResponseHeaders() {
    return "content-type: application/json\r\n";
  };

  // 异步触发完成事件
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
 * 初始化导航桥接：监听主页面发来的 postMessage，使用 Discourse SPA 路由进行导航
 * 此函数运行在 iframe 内的 MAIN world，可以访问 DiscourseURL 等页面全局变量
 */
function initNavigationBridge() {
  if (window.__dsSideviewNavigationBridgeInstalled) {
    return;
  }

  window.__dsSideviewNavigationBridgeInstalled = true;

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
const HOSTNAME = "linux.do";
const PANEL_ID = "ds-sideview-panel";
const PANEL_TOOLBAR_ID = "ds-sideview-toolbar";
const IFRAME_ID = "ds-sideview-iframe";
const CLOSE_BUTTON_ID = "ds-sideview-close";
const CLOSE_BUTTON_ICON_CLASS = "ds-sideview-close-icon";
const CLOSE_BUTTON_LABEL_CLASS = "ds-sideview-close-label";
const RESIZE_HANDLE_ID = "ds-sideview-resize-handle";
const OPEN_CLASS = "ds-sideview-open";
const FRAME_CLASS = "ds-sideview-frame";
const RESIZING_CLASS = "ds-sideview-resizing";
const PANEL_ACTIVE_CLASS = "ds-sideview-panel-active";
const WELCOME_BANNER_TITLE_SELECTOR = ".welcome-banner__title";
const WELCOME_BANNER_TITLE_COLLAPSIBLE_CLASS = "ds-welcome-banner-title-collapsible";
const WELCOME_BANNER_TITLE_TOGGLE_CLASS = "ds-welcome-banner-title-toggle";
const WELCOME_BANNER_TITLE_CONTENT_CLASS = "ds-welcome-banner-title-content";
const WELCOME_BANNER_TITLE_COLLAPSED_ATTR = "data-ds-welcome-banner-collapsed";
const WELCOME_BANNER_TITLE_READY_ATTR = "data-ds-welcome-banner-ready";
const TOPIC_OPEN_MODE_KEY = "ds-sideview-topic-open-mode";
const TOPIC_OPEN_MODE_NORMAL = "normal";
const TOPIC_OPEN_MODE_TREE = "tree";
const TOPIC_TREE_SORT_KEY = "ds-sideview-topic-tree-sort";
const TOPIC_TREE_SORT_TOP = "top";
const TOPIC_TREE_SORT_NEW = "new";
const TOPIC_TREE_SORT_OLD = "old";
const DIM_MODE_KEY = "ds-sideview-dim-mode";
const DIM_MODE_MASK = "mask";
const DIM_MODE_TEXT = "text";

// 界面限制常量
const MIN_SPLIT_WIDTH = 1100; // 启用分栏模式的最小窗口宽度
const MIN_SIDEVIEW_WIDTH = 360; // 侧边栏最小宽度
const MIN_MAIN_WIDTH = 360; // 主视图区域最小宽度

// 版本检测相关常量
const UPDATE_CHECK_KEY = "ds-sideview-update-check";
const UPDATE_DISMISSED_KEY = "ds-sideview-update-dismissed";
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时
const GITHUB_RELEASE_API = "https://api.github.com/repos/zd1737/linux-do-side-view/releases/latest";
const GITHUB_RELEASE_URL = "https://github.com/zd1737/linux-do-side-view/releases/latest";
const UPDATE_TOAST_ID = "ds-sideview-update-toast";
const DEFAULT_SIDEVIEW_WIDTH_RATIO = 0.5; // 默认侧边栏宽度占窗口的比例
const WIDTH_STORAGE_KEY = "ds-sideview-width"; // 存储自定义宽度的 key

// 侧边栏折叠相关的常量
const SIDEBAR_EXPANDED_MIN_WIDTH = 120; // 判定 Discourse 侧边栏是否展开的最小宽度
const SIDEBAR_TOGGLE_RETRY_DELAY_MS = 150; // 查找侧边栏切换按钮的重试延迟（暂时未使用）
const SIDEBAR_TOGGLE_COOLDOWN_MS = 400; // 切换冷却时间（暂时未使用）
const SIDEBAR_TOGGLE_SELECTORS = [
  ".btn-sidebar-toggle",
  ".header-sidebar-toggle button",
  ".header-sidebar-toggle .btn",
  ".header-sidebar-toggle",
  "button[aria-label*='sidebar' i]"
];

// 全局状态变量
let scheduleFrameLayout = null; // 用于防抖和调度 iframe 内部布局的方法
let hasAttemptedSidebarCollapse = false; // 是否已经尝试过在 iframe 内折叠侧边栏
let preferredSideViewWidth = null; // 用户偏好的侧边栏宽度
let activeResize = null; // 当前拖拽调整宽度的状态
let iframeFirstLoaded = false; // iframe 是否已完成首次加载
let activeTopicStyleElement = null; // 用于高亮当前阅读话题的 style 元素

let dimOpacity = null; // 当前应用的弱化强度百分比
let dimDuration = null; // 当前应用的弱化过渡时间
let dimMode = DIM_MODE_TEXT; // 当前视觉方案：遮罩或文字融入
let topicOpenMode = TOPIC_OPEN_MODE_NORMAL; // 当前主题打开模式：普通或树形
let topicTreeSort = TOPIC_TREE_SORT_OLD; // 当前树形模式默认排序
const DIM_OPACITY_KEY = "ds-sideview-dim-opacity";
const DIM_DURATION_KEY = "ds-sideview-dim-duration";

// 初始化入口
if (window.location.hostname === HOSTNAME) {
  if (window.top === window) {
    // 运行在最顶层（主页面）
    initTopLevel();
  } else {
    // 运行在 iframe 内部
    initFrameMode();
  }
}

/**
 * 主页面初始化
 * 包含宽度加载、事件监听等
 */
function initTopLevel() {
  initStoredSideViewWidth();
  initDimSetting();
  initTopicOpenSetting();
  initWelcomeBannerCollapse();
  // 监听全局点击事件，必须在捕获阶段拦截
  document.addEventListener("click", handleDocumentClick, true);

  // 监听全局鼠标移动，以坐标判断是否位于右侧面板（取代 hover 和 iframe 内交互，解决 iframe 跨域失去 hover 的问题）
  document.addEventListener("mousemove", (event) => {
    if (!document.documentElement.classList.contains(OPEN_CLASS)) return;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    
    const panelRect = panel.getBoundingClientRect();
    const isInside = event.clientX >= panelRect.left;
    
    setPanelActiveState(isInside);
  }, { passive: true });

  // 接收来自 iframe 内部的鼠标坐标信息
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    
    if (event.data && event.data.type === "ds-iframe-interaction") {
      if (!document.documentElement.classList.contains(OPEN_CLASS)) return;
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;

      const panelRect = panel.getBoundingClientRect();
      // iframe 内部发来的坐标是相对于 iframe 视口的
      // iframe 的 left 坐标就是 panelRect.left
      // 因此 iframe 内部的 X 坐标转化为全局 X 坐标为：event.data.x + panelRect.left
      const globalX = event.data.x + panelRect.left;
      const isInside = globalX >= panelRect.left;
      
      setPanelActiveState(isInside);
    }
  });

  // 监听按键（Esc关闭侧边栏）
  window.addEventListener("keydown", handleKeydown);
  // 监听窗口大小变化调整布局
  window.addEventListener("resize", handleResize);
  // 检查新版本
  checkForUpdate();
}

/**
 * 初始化视觉弱化设置（方案、强度和过渡时间）
 */
function initDimSetting() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([DIM_OPACITY_KEY, DIM_DURATION_KEY, DIM_MODE_KEY], (result) => {
      // 获取保存的弱化强度
      if (result[DIM_OPACITY_KEY] !== undefined) {
        dimOpacity = result[DIM_OPACITY_KEY];
      } else {
        dimOpacity = getDefaultDimOpacity();
      }
      
      // 获取保存的过渡时间
      if (result[DIM_DURATION_KEY] !== undefined) {
        dimDuration = result[DIM_DURATION_KEY];
      }

      // 获取保存的视觉方案
      if (result[DIM_MODE_KEY] !== undefined) {
        dimMode = normalizeDimMode(result[DIM_MODE_KEY]);
      }
      
      applyDimClass();
    });

    // 监听设置在其他页面或 popup 中的改变
    chrome.storage.onChanged.addListener((changes, area) => {
      let changed = false;
      if (area === 'local' && changes[DIM_OPACITY_KEY]) {
        dimOpacity = changes[DIM_OPACITY_KEY].newValue;
        changed = true;
      }
      
      if (area === 'local' && changes[DIM_DURATION_KEY]) {
        dimDuration = changes[DIM_DURATION_KEY].newValue;
        changed = true;
      }

      if (area === "local" && changes[DIM_MODE_KEY]) {
        dimMode = normalizeDimMode(changes[DIM_MODE_KEY].newValue);
        changed = true;
      }
      
      if (changed) applyDimClass();
    });

    // 监听 popup 拖拽滑块发送来的实时预览消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "ds-dim-preview") {
        dimOpacity = message.value;
        applyDimClass();
      } else if (message.type === "ds-dim-duration-preview") {
        dimDuration = message.value;
        applyDimClass();
      }
    });
  } else {
    applyDimClass();
  }
}

/**
 * 初始化主题打开模式与树形排序设置
 */
function initTopicOpenSetting() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([TOPIC_OPEN_MODE_KEY, TOPIC_TREE_SORT_KEY], (result) => {
      topicOpenMode = normalizeTopicOpenMode(result[TOPIC_OPEN_MODE_KEY]);
      topicTreeSort = normalizeTopicTreeSort(result[TOPIC_TREE_SORT_KEY]);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }

      if (changes[TOPIC_OPEN_MODE_KEY]) {
        topicOpenMode = normalizeTopicOpenMode(changes[TOPIC_OPEN_MODE_KEY].newValue);
      }

      if (changes[TOPIC_TREE_SORT_KEY]) {
        topicTreeSort = normalizeTopicTreeSort(changes[TOPIC_TREE_SORT_KEY].newValue);
      }
    });
  } else {
    topicOpenMode = TOPIC_OPEN_MODE_NORMAL;
    topicTreeSort = TOPIC_TREE_SORT_OLD;
  }
}

/**
 * 应用当前视觉方案、弱化强度和过渡时间到页面 CSS 变量及类名上
 */
function applyDimClass() {
  const resolvedOpacity = Number.isFinite(dimOpacity) ? dimOpacity : getDefaultDimOpacity();
  const resolvedMode = normalizeDimMode(dimMode);

  document.documentElement.dataset.dsDimMode = resolvedMode;

  if (dimDuration !== null) {
    document.documentElement.style.setProperty('--ds-mask-duration', (dimDuration / 10).toFixed(1) + 's');
  } else {
    document.documentElement.style.removeProperty('--ds-mask-duration');
  }

  document.documentElement.style.setProperty('--ds-mask-opacity', (resolvedOpacity / 100).toString());
  document.documentElement.style.setProperty('--ds-text-blend-strength', (resolvedOpacity / 100).toFixed(3));

  if (resolvedOpacity === 0) {
    document.documentElement.classList.remove("ds-dim-enabled");
  } else {
    document.documentElement.classList.add("ds-dim-enabled");
  }

  syncSideViewFrameVisualState();
}

/**
 * iframe 内页面初始化
 * 负责同步视觉设置、监听主页面状态，并处理 iframe 内布局
 */
function initFrameMode() {
  initDimSetting();
  initWelcomeBannerCollapse();
  document.documentElement.classList.add(FRAME_CLASS);
  window.addEventListener("message", handleFrameVisualStateMessage);

  const scheduleLayout = createRafScheduler(syncIframeLayout);
  scheduleFrameLayout = scheduleLayout;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleLayout, { once: true });
  } else {
    scheduleLayout();
  }

  window.addEventListener("load", scheduleLayout);
  
  // 由于 Discourse 是单页应用，元素可能渲染较晚，所以多次检查并调整布局
  const checkIntervals = [100, 300, 600, 1000, 2000, 3000];
  for (const ms of checkIntervals) {
    window.setTimeout(scheduleLayout, ms);
  }
}

/**
 * 初始化首页 welcome banner 标题的默认收缩/展开能力
 */
function initWelcomeBannerCollapse() {
  if (window.__dsWelcomeBannerCollapseInstalled) {
    return;
  }

  window.__dsWelcomeBannerCollapseInstalled = true;

  const scheduleSync = createRafScheduler(syncWelcomeBannerTitles);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleSync, { once: true });
  } else {
    scheduleSync();
  }

  window.addEventListener("load", scheduleSync);
  document.addEventListener("click", handleWelcomeBannerTitleClick, true);

  const observer = new MutationObserver(() => {
    scheduleSync();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

/**
 * 扫描页面中的 welcome banner 标题并补齐默认收缩态
 */
function syncWelcomeBannerTitles() {
  document.querySelectorAll(WELCOME_BANNER_TITLE_SELECTOR).forEach(prepareWelcomeBannerTitle);
}

/**
 * 为 welcome banner 标题设置可折叠交互
 */
function prepareWelcomeBannerTitle(title) {
  if (!(title instanceof HTMLElement) || title.hasAttribute(WELCOME_BANNER_TITLE_READY_ATTR)) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = WELCOME_BANNER_TITLE_TOGGLE_CLASS;

  const content = document.createElement("div");
  content.className = WELCOME_BANNER_TITLE_CONTENT_CLASS;

  while (title.firstChild) {
    content.appendChild(title.firstChild);
  }

  title.setAttribute(WELCOME_BANNER_TITLE_READY_ATTR, "true");
  title.classList.add(WELCOME_BANNER_TITLE_COLLAPSIBLE_CLASS);
  title.append(toggle, content);
  setWelcomeBannerTitleCollapsed(title, true);
}

/**
 * 处理 welcome banner 标题区域点击，切换收缩状态
 */
function handleWelcomeBannerTitleClick(event) {
  const title = event.target instanceof Element
    ? event.target.closest(WELCOME_BANNER_TITLE_SELECTOR)
    : null;

  if (!title || !title.hasAttribute(WELCOME_BANNER_TITLE_READY_ATTR)) {
    return;
  }

  if (event.target instanceof Element && event.target.closest("a, input, textarea, select")) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  toggleWelcomeBannerTitle(title);
}

/**
 * 切换 welcome banner 标题展开状态
 */
function toggleWelcomeBannerTitle(title) {
  const isCollapsed = title.getAttribute(WELCOME_BANNER_TITLE_COLLAPSED_ATTR) !== "false";
  setWelcomeBannerTitleCollapsed(title, !isCollapsed);
}

/**
 * 更新 welcome banner 标题的收缩态属性和辅助文本
 */
function setWelcomeBannerTitleCollapsed(title, collapsed) {
  const toggle = title.querySelector(`.${WELCOME_BANNER_TITLE_TOGGLE_CLASS}`);
  const content = title.querySelector(`.${WELCOME_BANNER_TITLE_CONTENT_CLASS}`);

  title.setAttribute(WELCOME_BANNER_TITLE_COLLAPSED_ATTR, collapsed ? "true" : "false");

  if (content instanceof HTMLElement) {
    content.hidden = collapsed;
  }

  if (toggle instanceof HTMLButtonElement) {
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", collapsed ? "展开欢迎横幅标题" : "收起欢迎横幅标题");
    toggle.title = collapsed ? "展开" : "收起";
  }
}

/**
 * 处理主页面的点击事件，拦截主题链接
 */
function handleDocumentClick(event) {
  if (!shouldInterceptClick(event)) {
    return;
  }

  const link = event.target.closest("a[href]");
  // 如果没有点击链接，或者是点击了面板内部的链接，不拦截
  if (!link || link.closest(`#${PANEL_ID}`)) {
    return;
  }

  const topicUrl = getTopicUrl(link.href);
  if (!topicUrl) {
    return; // 不是符合条件的主题链接
  }

  // 阻止默认行为和冒泡
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  // 在侧边栏中打开该主题
  openSideView(topicUrl);
}

/**
 * 处理快捷键操作
 */
function handleKeydown(event) {
  if (event.key === "Escape") {
    closeSideView(); // 按 Esc 键关闭侧边视图
  }
}

/**
 * 处理窗口尺寸改变
 * 若窗口过窄则关闭侧边栏，否则重新计算合适的宽度
 */
function handleResize() {
  if (window.innerWidth < MIN_SPLIT_WIDTH) {
    closeSideView();
    return;
  }

  applySideViewWidth(preferredSideViewWidth);
}

/**
 * 判断是否应该拦截当前点击事件
 */
function shouldInterceptClick(event) {
  // 只拦截普通的左键点击
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }

  // 如果用户按住了修饰键（尝试新标签页打开等），不拦截
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }

  // 屏幕宽度过小时不启用分栏体验
  if (window.innerWidth < MIN_SPLIT_WIDTH) {
    return false;
  }

  const link = event.target.closest("a[href]");
  if (!link) {
    return false;
  }

  // 只拦截在当前窗口打开的链接 (target="_self" 或无 target)
  if (link.target && link.target.toLowerCase() !== "_self") {
    return false;
  }

  return true;
}

/**
 * 获取符合 Discourse 主题规则的 URL
 */
function getTopicUrl(rawHref) {
  let url;

  try {
    url = new URL(rawHref, window.location.href);
  } catch {
    return null;
  }

  // 必须同源
  if (url.origin !== window.location.origin) {
    return null;
  }

  const topicId = extractTopicIdFromUrl(url);
  if (!topicId) {
    return null;
  }

  return buildTopicOpenUrl(url, topicId);
}

/**
 * 打开侧边阅读面板
 */
function openSideView(url) {
  const elements = ensurePanel();
  const wasOpen = document.documentElement.classList.contains(OPEN_CLASS);

  // 在添加 OPEN_CLASS 之前获取真实的滚动高度，否则 page-bridge 拦截器会返回虚拟滚动条的值（而此时其尚未初始化，为 0）
  const initialScrollTop = !wasOpen ? getDocumentScrollTop() : 0;

  applySideViewWidth(preferredSideViewWidth);
  document.documentElement.classList.add(OPEN_CLASS);
  elements.panel.setAttribute("aria-hidden", "false");
  syncSideViewFrameVisualState();

  // 如果是从关闭状态打开的，将外部滚动条切换到主内容区域
  if (!wasOpen) {
    transferDocumentScrollToMainPane(initialScrollTop);
  }

  // 高亮当前话题
  highlightActiveTopic(url);

  // 加载目标 URL
  if (!iframeFirstLoaded) {
    // 首次加载：直接设置 iframe src
    elements.iframe.src = url;
    elements.iframe.addEventListener("load", () => {
      iframeFirstLoaded = true;
    }, { once: true });
  } else {
    // 后续导航：在 iframe 内部创建虚拟链接并触发点击，利用 Discourse SPA 路由
    navigateIframeViaClick(elements.iframe, url);
  }
}

/**
 * 通过 postMessage 通知 iframe 内的 page-bridge.js 进行 SPA 导航
 * 避免 iframe 重新加载整个页面
 */
function navigateIframeViaClick(iframe, url) {
  try {
    const iframeWin = iframe.contentWindow;
    if (!iframeWin) {
      iframe.src = url;
      return;
    }

    // 从 URL 中提取路径
    const urlObj = new URL(url);
    const pathname = urlObj.pathname + urlObj.search + urlObj.hash;

    iframeWin.postMessage({
      type: "ds-sideview-navigate",
      path: pathname
    }, window.location.origin);

  } catch (err) {
    iframe.src = url;
  }
}

/**
 * 关闭侧边阅读面板
 */
function closeSideView() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return;
  }

  const wasOpen = document.documentElement.classList.contains(OPEN_CLASS);
  const mainPaneScrollTop = wasOpen ? getMainPaneScrollTop() : 0;

  endResize(false); // 取消可能的拖拽状态
  document.documentElement.classList.remove(OPEN_CLASS);
  setPanelActiveState(false);
  panel.setAttribute("aria-hidden", "true");
  iframeFirstLoaded = false; // 重置首次加载标记

  // 恢复关闭前的滚动状态
  if (wasOpen) {
    restoreDocumentScroll(mainPaneScrollTop);
  }
}

/**
 * 高亮当前正在阅读的话题
 */
function highlightActiveTopic(topicUrl) {
  const topicId = getTopicIdFromRawUrl(topicUrl);
  if (!topicId) return;

  if (!activeTopicStyleElement) {
    activeTopicStyleElement = document.createElement("style");
    activeTopicStyleElement.id = "ds-sideview-active-topic-style";
    document.head.appendChild(activeTopicStyleElement);
  }

  // 动态注入 CSS
  activeTopicStyleElement.textContent = `
    [data-topic-id="${topicId}"] {
      background-color: var(--tertiary-low, rgba(0, 136, 204, 0.1)) !important;
    }
  `;
}

/**
 * 将设置值规范化为支持的主题打开模式
 */
function normalizeTopicOpenMode(mode) {
  return mode === TOPIC_OPEN_MODE_TREE ? TOPIC_OPEN_MODE_TREE : TOPIC_OPEN_MODE_NORMAL;
}

/**
 * 将设置值规范化为支持的树形排序
 */
function normalizeTopicTreeSort(sort) {
  if (sort === TOPIC_TREE_SORT_TOP || sort === TOPIC_TREE_SORT_NEW || sort === TOPIC_TREE_SORT_OLD) {
    return sort;
  }

  return TOPIC_TREE_SORT_OLD;
}

/**
 * 从论坛 URL 中提取 topic ID，兼容普通页与树形页
 */
function extractTopicIdFromUrl(url) {
  if (!(url instanceof URL) || url.origin !== window.location.origin) {
    return null;
  }

  let match = url.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/);
  if (match) {
    return match[1];
  }

  match = url.pathname.match(/^\/nested\/topic\/(\d+)(?:\/|$)/);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * 根据当前设置构造最终在 iframe 中打开的主题地址
 */
function buildTopicOpenUrl(sourceUrl, topicId) {
  if (topicOpenMode === TOPIC_OPEN_MODE_TREE) {
    const treeUrl = new URL(`/nested/topic/${topicId}`, window.location.origin);
    treeUrl.searchParams.set("sort", topicTreeSort);
    return treeUrl.toString();
  }

  if (sourceUrl.pathname.startsWith("/nested/topic/")) {
    return new URL(`/t/${topicId}`, window.location.origin).toString();
  }

  return sourceUrl.toString();
}

/**
 * 从原始 URL 字符串中提取 topic ID
 */
function getTopicIdFromRawUrl(rawUrl) {
  try {
    return extractTopicIdFromUrl(new URL(rawUrl, window.location.origin));
  } catch {
    return null;
  }
}

/**
 * 清除高亮
 */
function clearActiveTopic() {
  if (activeTopicStyleElement) {
    activeTopicStyleElement.textContent = "";
  }
}

/**
 * 确保 DOM 中存在侧边面板、iframe 及相关控件
 */
function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  let iframe = document.getElementById(IFRAME_ID);
  let resizeHandle = document.getElementById(RESIZE_HANDLE_ID);

  if (panel && iframe && resizeHandle) {
    return { panel, iframe, resizeHandle };
  }

  if (!panel) {
    panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.setAttribute("aria-hidden", "true");
  }

  let mainMask = document.getElementById("ds-main-mask");
  if (!mainMask) {
    mainMask = document.createElement("div");
    mainMask.id = "ds-main-mask";
    document.body.appendChild(mainMask);
  }

  let sideviewMask = document.getElementById("ds-sideview-mask");
  if (!sideviewMask) {
    sideviewMask = document.createElement("div");
    sideviewMask.id = "ds-sideview-mask";
    panel.appendChild(sideviewMask);
  }

  // 拖拽手柄
  if (!resizeHandle) {
    resizeHandle = document.createElement("div");
    resizeHandle.id = RESIZE_HANDLE_ID;
    resizeHandle.setAttribute("role", "separator");
    resizeHandle.setAttribute("aria-orientation", "vertical");
    resizeHandle.setAttribute("aria-label", "Resize side view");
    resizeHandle.addEventListener("pointerdown", startResize);
    panel.appendChild(resizeHandle);
  }

  // 侧边栏工具栏
  let toolbar = document.getElementById(PANEL_TOOLBAR_ID);
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = PANEL_TOOLBAR_ID;
    panel.appendChild(toolbar);
  }

  // 关闭按钮
  let closeButton = document.getElementById(CLOSE_BUTTON_ID);
  if (!closeButton) {
    closeButton = document.createElement("button");
    closeButton.id = CLOSE_BUTTON_ID;
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭侧边视图");
    closeButton.title = "关闭";
    closeButton.addEventListener("click", closeSideView);
  }

  syncCloseButtonContent(closeButton);

  if (closeButton.parentElement !== toolbar) {
    toolbar.appendChild(closeButton);
  }

  // 内容 iframe
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = IFRAME_ID;
    iframe.loading = "eager";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    panel.appendChild(iframe);
  }

  if (!iframe.dataset.dsVisualSyncBound) {
    iframe.addEventListener("load", syncSideViewFrameVisualState);
    iframe.dataset.dsVisualSyncBound = "true";
  }

  if (!panel.isConnected) {
    document.body.appendChild(panel);
  }

  return { panel, iframe, resizeHandle };
}

/**
 * 同步更新关闭按钮的图标及文字
 */
function syncCloseButtonContent(button) {
  if (!(button instanceof HTMLElement)) {
    return;
  }

  let icon = button.querySelector(`.${CLOSE_BUTTON_ICON_CLASS}`);
  if (!icon) {
    icon = document.createElement("span");
    icon.className = CLOSE_BUTTON_ICON_CLASS;
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    button.appendChild(icon);
  }

  let label = button.querySelector(`.${CLOSE_BUTTON_LABEL_CLASS}`);
  if (!label) {
    label = document.createElement("span");
    label.className = CLOSE_BUTTON_LABEL_CLASS;
    label.textContent = "关闭";
  }

  button.replaceChildren(icon, label);
}

/**
 * 从本地存储初始化读取保存的用户偏好宽度
 */
function initStoredSideViewWidth() {
  preferredSideViewWidth = loadStoredSideViewWidth();

  if (!Number.isFinite(preferredSideViewWidth)) {
    preferredSideViewWidth = getDefaultSideViewWidth();
  }

  applySideViewWidth(preferredSideViewWidth);
}

/**
 * 开始拖拽调整宽度
 */
function startResize(event) {
  if (event.button !== 0) {
    return; // 只响应左键拖拽
  }

  const handle = event.currentTarget;
  if (!(handle instanceof HTMLElement)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  activeResize = {
    handle,
    pointerId: event.pointerId,
    width: getCurrentSideViewWidth()
  };

  handle.setPointerCapture(event.pointerId);
  document.documentElement.classList.add(RESIZING_CLASS);
  window.addEventListener("pointermove", handleResizeDrag, true);
  window.addEventListener("pointerup", stopResize, true);
  window.addEventListener("pointercancel", stopResize, true);
}

/**
 * 拖拽过程处理，实时更新宽度
 */
function handleResizeDrag(event) {
  if (!activeResize || event.pointerId !== activeResize.pointerId) {
    return;
  }

  event.preventDefault();

  // 根据指针坐标计算目标宽度，并限制在合法范围内
  const nextWidth = clampSideViewWidth(window.innerWidth - event.clientX);
  activeResize.width = nextWidth;
  applySideViewWidth(nextWidth);
}

/**
 * 停止拖拽调整
 */
function stopResize(event) {
  if (!activeResize || event.pointerId !== activeResize.pointerId) {
    return;
  }

  event.preventDefault();
  endResize(true); // 结束并保存新的宽度
}

/**
 * 结束拖拽状态并解绑事件
 * @param {boolean} shouldPersist 是否将最新宽度写入本地存储
 */
function endResize(shouldPersist) {
  if (!activeResize) {
    return;
  }

  const { handle, pointerId, width } = activeResize;

  if (handle.hasPointerCapture(pointerId)) {
    handle.releasePointerCapture(pointerId);
  }

  activeResize = null;
  document.documentElement.classList.remove(RESIZING_CLASS);
  window.removeEventListener("pointermove", handleResizeDrag, true);
  window.removeEventListener("pointerup", stopResize, true);
  window.removeEventListener("pointercancel", stopResize, true);

  if (shouldPersist) {
    saveSideViewWidth(width);
  }

  applySideViewWidth(width);
}

/**
 * 应用并更新 CSS 变量以控制侧边栏宽度
 */
function applySideViewWidth(width) {
  const nextWidth = clampSideViewWidth(width);
  document.documentElement.style.setProperty("--ds-sideview-width", `${nextWidth}px`);
  return nextWidth;
}

/**
 * 转移页面的滚动条控制权到左侧的主面板上，避免在分栏时发生异常滚动
 */
function transferDocumentScrollToMainPane(scrollTop) {
  window.requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    setMainPaneScrollTop(scrollTop);
  });
}

/**
 * 关闭侧边栏后，恢复页面级别的原始滚动条控制
 */
function restoreDocumentScroll(scrollTop) {
  window.requestAnimationFrame(() => {
    setMainPaneScrollTop(0);
    window.scrollTo(0, scrollTop);
  });
}

/**
 * 获取当前页面全局滚动条位置
 */
function getDocumentScrollTop() {
  return Math.max(window.scrollY, document.documentElement.scrollTop, document.body?.scrollTop || 0);
}

/**
 * 获取主内容面板的滚动条位置
 */
function getMainPaneScrollTop() {
  return document.body?.scrollTop || 0;
}

/**
 * 设置主内容面板的滚动条位置
 */
function setMainPaneScrollTop(scrollTop) {
  if (!document.body) {
    return;
  }

  document.body.scrollTop = scrollTop;
}

/**
 * 获取当前实际应用的侧边栏宽度
 */
function getCurrentSideViewWidth() {
  const currentWidth = Number.parseInt(
    document.documentElement.style.getPropertyValue("--ds-sideview-width"),
    10
  );

  if (Number.isFinite(currentWidth)) {
    return currentWidth;
  }

  return clampSideViewWidth(preferredSideViewWidth);
}

/**
 * 限制宽度的有效范围（不超出窗口或最小限制）
 */
function clampSideViewWidth(width) {
  const maxWidth = Math.max(MIN_SIDEVIEW_WIDTH, window.innerWidth - MIN_MAIN_WIDTH);
  const minWidth = Math.min(MIN_SIDEVIEW_WIDTH, maxWidth);
  const fallbackWidth = Math.round(window.innerWidth * DEFAULT_SIDEVIEW_WIDTH_RATIO);
  const numericWidth = Number.isFinite(width) ? width : fallbackWidth;

  return Math.round(Math.min(Math.max(numericWidth, minWidth), maxWidth));
}

/**
 * 获取默认情况下的侧边栏占比计算宽度
 */
function getDefaultSideViewWidth() {
  return Math.round(window.innerWidth * DEFAULT_SIDEVIEW_WIDTH_RATIO);
}

/**
 * 从 localStorage 中读取存储的侧边栏宽度
 */
function loadStoredSideViewWidth() {
  try {
    const rawValue = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const width = Number.parseInt(rawValue, 10);
    return Number.isFinite(width) ? width : null;
  } catch {
    return null;
  }
}

/**
 * 将侧边栏宽度存储至 localStorage 中
 */
function saveSideViewWidth(width) {
  preferredSideViewWidth = clampSideViewWidth(width);

  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(preferredSideViewWidth));
  } catch {
    // 忽略存储失败（例如无痕模式限制等），仅保留内存中的偏好。
  }
}

/**
 * 获取默认的弱化强度
 */
function getDefaultDimOpacity() {
  return 0;
}

/**
 * 规范化视觉方案，确保只返回支持的模式值
 */
function normalizeDimMode(mode) {
  return mode === DIM_MODE_TEXT ? DIM_MODE_TEXT : DIM_MODE_MASK;
}

/**
 * 更新右侧面板是否处于交互态，并同步给 iframe
 */
function setPanelActiveState(isActive) {
  const shouldBeActive = Boolean(isActive);
  const isCurrentlyActive = document.documentElement.classList.contains(PANEL_ACTIVE_CLASS);

  if (isCurrentlyActive === shouldBeActive) {
    return;
  }

  document.documentElement.classList.toggle(PANEL_ACTIVE_CLASS, shouldBeActive);
  syncSideViewFrameVisualState();
}

/**
 * 将当前视觉方案和面板激活状态同步到侧边 iframe
 */
function syncSideViewFrameVisualState() {
  if (window.top !== window) {
    return;
  }

  const iframe = document.getElementById(IFRAME_ID);
  const iframeWindow = iframe?.contentWindow;
  if (!iframeWindow) {
    return;
  }

  iframeWindow.postMessage({
    type: "ds-sideview-visual-state",
    opacity: Number.isFinite(dimOpacity) ? dimOpacity : getDefaultDimOpacity(),
    duration: dimDuration,
    mode: normalizeDimMode(dimMode),
    panelActive: document.documentElement.classList.contains(PANEL_ACTIVE_CLASS)
  }, window.location.origin);
}

/**
 * 接收主页面发来的视觉状态消息，并更新 iframe 内的样式状态
 */
function handleFrameVisualStateMessage(event) {
  if (window.top === window || event.origin !== window.location.origin) {
    return;
  }

  const data = event.data;
  if (!data || data.type !== "ds-sideview-visual-state") {
    return;
  }

  if (data.opacity !== undefined) {
    dimOpacity = data.opacity;
  }

  if (data.duration !== undefined) {
    dimDuration = data.duration;
  }

  if (data.mode !== undefined) {
    dimMode = normalizeDimMode(data.mode);
  }

  if (typeof data.panelActive === "boolean") {
    document.documentElement.classList.toggle(PANEL_ACTIVE_CLASS, data.panelActive);
  }

  applyDimClass();
}

/**
 * iframe 中更新布局相关的 class 和状态
 */
function syncIframeLayout() {
  document.documentElement.classList.add(FRAME_CLASS);

  if (!document.body) {
    return;
  }

  document.body.classList.add(FRAME_CLASS);

  if (!hasAttemptedSidebarCollapse) {
    collapseIframeSidebar();
  }
}

/**
 * 尝试自动折叠 iframe 内部的 Discourse 侧边栏
 */
function collapseIframeSidebar() {
  const toggleButton = getSidebarToggleButton();
  if (!toggleButton) {
    // 元素尚未加载时，继续等待后续调度
    return;
  }

  // 找到按钮后，只尝试一次收起动作
  hasAttemptedSidebarCollapse = true;

  if (isSidebarExpanded()) {
    toggleButton.click();
  }
}

/**
 * 查找 Discourse 页面内的侧边栏切换按钮
 */
function getSidebarToggleButton() {
  for (const selector of SIDEBAR_TOGGLE_SELECTORS) {
    const candidates = document.querySelectorAll(selector);

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || !isElementVisible(candidate)) {
        continue;
      }

      return candidate;
    }
  }

  return null;
}

/**
 * 判断 Discourse 侧边栏目前是否是展开状态
 */
function isSidebarExpanded() {
  const toggleButton = getSidebarToggleButton();
  const ariaExpanded = toggleButton?.getAttribute("aria-expanded");
  if (ariaExpanded === "true") {
    return true;
  }

  const ariaPressed = toggleButton?.getAttribute("aria-pressed");
  if (ariaPressed === "true") {
    return true;
  }

  const sidebar = document.querySelector(".sidebar-wrapper");
  if (!(sidebar instanceof HTMLElement) || !isElementVisible(sidebar)) {
    return false;
  }

  return sidebar.getBoundingClientRect().width >= SIDEBAR_EXPANDED_MIN_WIDTH;
}

/**
 * 判断 DOM 元素是否可见
 */
function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 工具函数：创建一个基于 requestAnimationFrame 的去抖动调度器
 */
function createRafScheduler(fn) {
  let queued = false;

  return () => {
    if (queued) {
      return;
    }

    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

/**
 * 检查是否有新版本可用
 */
function checkForUpdate() {
  try {
    const lastCheck = Number(localStorage.getItem(UPDATE_CHECK_KEY) || "0");
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }
  } catch {
    return;
  }

  const currentVersion = chrome.runtime.getManifest().version;

  fetch(GITHUB_RELEASE_API, { cache: "no-cache" })
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      try {
        localStorage.setItem(UPDATE_CHECK_KEY, String(Date.now()));
      } catch {}

      if (!data || !data.tag_name) return;

      const latestVersion = data.tag_name.replace(/^v/, "");
      if (!isNewerVersion(currentVersion, latestVersion)) return;

      // 检查用户是否已关闭过该版本的提示
      try {
        if (localStorage.getItem(UPDATE_DISMISSED_KEY) === latestVersion) return;
      } catch {}

      showUpdateToast(latestVersion);
    })
    .catch(() => {});
}

/**
 * 比较版本号，判断 latest 是否比 current 更新
 */
function isNewerVersion(current, latest) {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

/**
 * 显示版本更新 Toast 通知
 */
function showUpdateToast(version) {
  if (document.getElementById(UPDATE_TOAST_ID)) return;

  const toast = document.createElement("div");
  toast.id = UPDATE_TOAST_ID;

  const text = document.createElement("a");
  text.href = GITHUB_RELEASE_URL;
  text.target = "_blank";
  text.rel = "noopener noreferrer";
  text.className = "ds-update-toast-link";
  text.textContent = `SideView 发现新版本 v${version}，点击前往下载`;

  const closeBtn = document.createElement("button");
  closeBtn.className = "ds-update-toast-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "关闭");
  closeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M13 1L1 13M1 1L13 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener("click", () => {
    toast.remove();
    try {
      localStorage.setItem(UPDATE_DISMISSED_KEY, version);
    } catch {}
  });

  toast.appendChild(text);
  toast.appendChild(closeBtn);
  document.body.appendChild(toast);

  // 8 秒后自动消失
  setTimeout(() => {
    if (toast.isConnected) toast.remove();
  }, 8000);
}

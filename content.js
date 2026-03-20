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

// 界面限制常量
const MIN_SPLIT_WIDTH = 1100; // 启用分栏模式的最小窗口宽度
const MIN_SIDEVIEW_WIDTH = 360; // 侧边栏最小宽度
const MIN_MAIN_WIDTH = 360; // 主视图区域最小宽度
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
  // 监听全局点击事件，必须在捕获阶段拦截
  document.addEventListener("click", handleDocumentClick, true);
  // 监听按键（Esc关闭侧边栏）
  window.addEventListener("keydown", handleKeydown);
  // 监听窗口大小变化调整布局
  window.addEventListener("resize", handleResize);
}

/**
 * iframe 内页面初始化
 * 主要是隐藏多余的 UI 和处理布局
 */
function initFrameMode() {
  document.documentElement.classList.add(FRAME_CLASS);

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

  // 路径必须以 /t/ 开头（Discourse 的帖子链接特征）
  if (!url.pathname.startsWith("/t/")) {
    return null;
  }

  return url.toString();
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

  // 如果是从关闭状态打开的，将外部滚动条切换到主内容区域
  if (!wasOpen) {
    transferDocumentScrollToMainPane(initialScrollTop);
  }

  // 加载目标 URL。如果是同一个 URL 则尝试替换历史记录刷新
  if (elements.iframe.src !== url) {
    elements.iframe.src = url;
  } else {
    elements.iframe.contentWindow?.location.replace(url);
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
  panel.setAttribute("aria-hidden", "true");

  // 恢复关闭前的滚动状态
  if (wasOpen) {
    restoreDocumentScroll(mainPaneScrollTop);
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

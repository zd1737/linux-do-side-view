# Linux.do SideView

给 `linux.do` 用的浏览器扩展。点击话题链接后，不离开当前列表页，而是在右侧 `iframe` 中打开帖子。

![效果展示](assets/image.png)

## 概览

- 类型：Chrome Manifest V3
- 站点：`https://linux.do/*`
- 注入：`document_start`
- 权限：`storage`
- 无构建步骤，直接加载仓库目录即可

## 当前功能

### 分栏阅读

- 只拦截同源话题链接：
  - `/t/...`
  - `/n/topic/...`
- 只处理普通左键点击，不拦截：
  - 新标签/新窗口打开
  - 组合键点击
  - 面板内部点击
  - 窄屏窗口点击
- 首次打开时直接设置 `iframe.src`。
- 后续切换话题时通过 `postMessage` 通知 iframe 内部走 Discourse SPA 路由；失败时退回整页跳转。
- 树形模式目标地址为 `/n/topic/{id}?sort={top|new|old}`。
- 当前话题会高亮左侧对应的 topic 卡片。

### 布局与交互

- 右侧固定面板，支持拖拽调宽。
- 面板宽度默认是窗口 `50%`，最小主区域和侧栏宽度都为 `360px`。
- 宽度保存到页面 `localStorage`：`ds-sideview-width`。
- 支持底部关闭按钮和 `Esc` 关闭。
- 窗口宽度小于 `1100px` 时不启用分栏；已打开面板会自动关闭。
- 关闭面板时会直接移除 `iframe`，停止其中脚本和请求。

### 滚动处理

- 主页面保持原生 document 滚动。
- 分栏开启后，主页面和 iframe 都会显示各自的假滚动条，用于拖拽滚动。
- iframe 会自动判断真实滚动容器；如果不是根节点，会隐藏该容器的原生滚动条视觉。

### iframe 隔离

- 尝试自动折叠 iframe 内的 Discourse sidebar。
- 拦截 iframe 内对 `discourse_sidebar-hidden` 的 `localStorage` 写入和删除。
- 改写发往 `ping.linux.do` 的 message-bus poll `POST` 请求，只移除 `/refresh-sidebar-sections` 频道。
- 覆盖：
  - `fetch`
  - `XMLHttpRequest`
  - `navigator.sendBeacon`

### 阅读聚焦

- 支持两种模式：
  - `text`
  - `mask`
- 设置由主页面统一控制，并同步到 iframe。
- 主页面通过面板的进入/离开、焦点变化，以及 iframe 回传的明确交互事件判断当前焦点在左侧还是右侧。

### 其他

- 支持 `welcome banner` 标题左侧热区点击展开/收起。
- 每 24 小时最多检查一次 GitHub Release，新版本会在右下角弹出提示。

## Popup 设置

- 话题打开模式：`normal` / `tree`
- 树形默认排序：`top` / `new` / `old`
- 弱化方案：`text` / `mask`
- 弱化强度：`0` 到 `100`
- 过渡时间：`0.0s` 到 `5.0s`

所有设置都存到 `chrome.storage.local`。滑块拖动时会先向当前标签页发送预览消息，再在松开后保存。

## 数据存储

### `chrome.storage.local`

- `ds-sideview-topic-open-mode`
- `ds-sideview-topic-tree-sort`
- `ds-sideview-dim-mode`
- `ds-sideview-dim-opacity`
- `ds-sideview-dim-duration`

### 页面 `localStorage`

- `ds-sideview-width`
- `ds-sideview-update-check`
- `ds-sideview-update-dismissed`

## 安装

1. 克隆或下载仓库。
2. 打开 Chromium 内核浏览器扩展管理页。
3. 开启开发者模式。
4. 选择“加载已解压的扩展程序”。
5. 选中仓库根目录。

## 打包发布

仓库自带 `.github/workflows/zip.yml`：

- tag push 时触发
- 用 tag 更新 `manifest.json` 版本号
- 生成 `linux-do-side-view-<tag>.zip`
- 创建或更新对应 GitHub Release

ZIP 会排除 `README.md`、`assets/*` 和点文件。

## 文件说明

- `manifest.json`：扩展声明
- `content.js`：分栏、面板、滚动条、设置同步、更新提示
- `page-bridge.js`：iframe 导航桥接与状态隔离
- `styles.css`：分栏布局、滚动条、弱化样式
- `popup.html` / `popup.js`：设置页

## 限制

- 只适配 `linux.do`
- 只处理 `/t/...` 和 `/n/topic/...`
- 依赖当前 Discourse DOM 结构和 sidebar 选择器
- 小于 `1100px` 的窗口不会启用分栏

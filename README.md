# Linux.do SideView

一个面向 `linux.do` 的浏览器扩展。它把 Discourse 的常规跳转式浏览改成左右分栏阅读：主页面留在左侧，点击话题链接后在右侧以内嵌 `iframe` 打开帖子，适合在列表页、推荐页和话题流里连续预览内容。

![效果展示](assets/image.png)

## 项目概览

- 扩展类型：Chrome Manifest V3
- 运行站点：`https://linux.do/*`
- 注入时机：`document_start`
- 注入范围：顶层页面和所有子 frame
- 权限：`storage`

这个仓库没有构建步骤，也没有打包依赖。源码就是扩展本体，加载目录即可运行。

## 功能清单

### 分栏阅读

- 拦截站内话题链接（路径以 `/t/` 开头）的普通左键点击。
- 在右侧固定面板中打开话题内容，左侧保持当前页面上下文不变。
- 首次打开时直接设置 `iframe.src`，后续导航优先通过 `postMessage` 调用 iframe 内的 Discourse SPA 路由，减少整页重载。
- 重新点击其他话题时会同步高亮左侧对应的 topic 卡片。

### 面板交互

- 支持点击底部悬浮关闭按钮关闭侧边栏。
- 支持按 `Esc` 关闭侧边栏。
- 支持拖拽右侧面板左边缘调整宽度。
- 自定义宽度会保存在 `localStorage` 的 `ds-sideview-width` 中。
- 当窗口宽度小于 `1100px` 时，不启用分栏拦截；如果窗口缩小到阈值以下，已打开的侧栏会自动关闭。

### 滚动与布局修正

- 分栏开启后，将主页面的滚动控制权切换到 `body`，关闭时恢复原始页面滚动位置。
- 在主页面桥接 `window.scrollTo`、`scrollBy`、`Element.prototype.scrollTo`、`document.documentElement.scrollTop`、`window.scrollY` 等接口，避免 Discourse 的 SPA 滚动逻辑失效。
- 同时修正 `document.documentElement.scrollHeight` / `clientHeight` 的读取，避免无限滚动判断异常。

### iframe 内的论坛状态隔离

- 在 iframe 页面中尝试自动折叠 Discourse 左侧 sidebar，减少重复导航占位。
- 拦截 iframe 内部对 `discourse_sidebar-hidden` 等 sidebar 状态的 `localStorage` 写入和删除。
- 条件拦截发往 `ping.linux.do` 的 message-bus poll POST 请求，包括：
  - `fetch`
  - `XMLHttpRequest`
  - `navigator.sendBeacon`
- 回复态时允许真实发送原始 poll，但会删掉 `/refresh-sidebar-sections`，避免影响主页面边栏状态。
- 当最后一个 `.presence-users` 消失后，会额外放行 1 次普通 poll，用来刷新最新消息。
- 一旦主页面点击关闭侧边 iframe，会立即禁止 iframe 内的真实 poll 请求。
- 被拦截的 poll 不再立即返回空响应，而是延迟 15 秒后再返回，避免客户端立刻高频重试。
- 如果真实 poll 连续 3 次都在 2 秒内结束，会触发 20 秒冷却；冷却期间会延迟到期后再返回空响应，防止异常持续请求。
- 所有真实发送的 poll 都会移除表单里的 `/refresh-sidebar-sections` 频道，避免 iframe 内的交互污染主页面的全局 sidebar 状态。

### 弱化方案与阅读聚焦

- 支持 `文字融入` 和 `遮罩` 两种弱化方案，可在 popup 中随时切换。
- `遮罩` 方案会在主页面和右侧面板之间切换遮罩，弱化未聚焦区域。
- `文字融入` 方案不会直接模糊字体，而是通过降低透明度，让未聚焦区域的文字和图片更融入背景。
- 主页面在 `文字融入` 方案下会弱化话题列表中的标题、摘要、标签、统计信息和缩略图。
- iframe 在 `文字融入` 方案下会弱化话题标题、`article` 正文、small action 描述、topic map 等详情内容。
- 交互判定不只依赖 `:hover`，还会结合主页面 `mousemove` 和 iframe 内部 `postMessage` 回传的交互坐标，解决 iframe 场景下 hover 丢失的问题。
- 面板关闭时会清理交互态 class，避免弱化状态残留。

### Popup 设置

扩展弹窗提供五个即时生效的设置项：

- 话题打开模式：`普通` / `树形`
- 树形默认排序：`top` / `new` / `old`（仅在话题打开模式为 `树形` 时显示）
- 弱化方案：`文字融入` / `遮罩`
- 弱化强度：`0%` 到 `100%`
- 过渡时间：`0.0s` 到 `5.0s`

实现细节：

- 五项设置都通过 `chrome.storage.local` 存储。
- 话题打开模式设为 `树形` 时，点击话题会跳转到 `/nested/topic/{topicId}?sort={sort}`，并默认使用 `old` 排序。
- 切换设置后会立即持久化，并通过页面监听同步到当前视图和 iframe。
- 拖拽滑块时会向当前标签页发送消息做实时预览。
- 默认话题打开模式为 `普通`，默认树形排序为 `old`。
- 默认方案为 `文字融入`，默认弱化强度为 `0%`，默认过渡时间为 `2.0s`。

### 版本更新提示

- 顶层页面会每 24 小时最多检查一次 GitHub Release。
- 如果发现比当前 `manifest.json` 版本更新的发布版本，会在页面右下角显示 Toast。
- 用户关闭某个版本提示后，会把该版本号写入 `localStorage`，后续不再重复提示同一版本。

## 交互规则

- 只处理同源链接。
- 只处理当前窗口打开的链接；`target` 不是 `_self` 的链接不会被拦截。
- 不拦截带有 `Ctrl`、`Cmd`、`Shift`、`Alt` 的组合点击。
- 不拦截右键、中键或其他已被页面处理过的点击事件。
- 不处理侧边面板内部自己的链接点击，避免和 iframe 内部导航冲突。

## 安装方式

### 本地加载

1. 下载或克隆此仓库。
2. 打开 Chromium 内核浏览器的扩展管理页。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”。
5. 选中仓库根目录。

### 打包安装

仓库自带 GitHub Actions 工作流 `.github/workflows/zip.yml`：

- 以 tag push 作为触发条件。
- 会将 tag 名中的可选 `v` 前缀去掉，并同步写回 `manifest.json` 的 `version`。
- 生成 `linux-do-side-view-<tag>.zip`。
- 自动创建或更新对应 GitHub Release，并上传 ZIP 附件。

ZIP 打包时会排除以下内容：

- `README.md`
- `assets/*`
- 所有点文件和点目录

## 源码结构

### `manifest.json`

- 定义 MV3 扩展元数据。
- 注册 popup 页面。
- 在 `MAIN` world 注入 `page-bridge.js`。
- 在隔离世界注入 `content.js` 和 `styles.css`。

### `content.js`

负责用户可见的主要行为：

- 顶层页面的链接拦截与分栏打开/关闭
- 右侧面板 DOM 创建
- 宽度拖拽和宽度持久化
- 左侧滚动位置切换与恢复
- topic 高亮
- popup 设置同步
- iframe 内布局整理
- 更新提示检查和 Toast 展示

### `page-bridge.js`

负责必须运行在页面主世界里的桥接逻辑：

- 顶层页面滚动 API 代理
- iframe 内 sidebar 状态写入拦截
- iframe 内 message-bus 轮询请求改写
- iframe 内与父页面之间的导航消息和交互消息同步

### `styles.css`

负责整体视觉与布局：

- 分栏状态下主页面宽度与滚动条样式
- 右侧面板、拖拽手柄、关闭按钮
- 更新提示 Toast
- 主区域与侧边区域的弱化样式（遮罩与文字融入）

### `popup.html` / `popup.js`

负责扩展弹窗设置页：

- 提供话题打开模式与树形默认排序设置
- 提供弱化方案切换、弱化强度和过渡时间设置
- 实时显示当前值
- 保存到 `chrome.storage.local`
- 向当前活动标签页发送预览消息

## 运行机制

这个扩展的核心点不是“把一个 iframe 塞进页面”，而是同时处理了 Discourse 在分栏场景下的几类副作用：

1. 点击话题后，不跳离当前页面，而是将目标帖子加载到右侧。
2. 页面滚动被重新分配到左侧主 pane，主站原有的 SPA 滚动逻辑仍尽量保持可用。
3. iframe 内部的论坛状态保存被隔离，避免侧栏开关、轮询保存等行为影响主页面。
4. 右侧面板获得交互焦点时，通过遮罩或文字融入切换强化阅读焦点，并同步到 iframe 内容区域。

## 适用场景

- 在话题列表中连续预览多个帖子
- 一边保留推荐流或搜索结果，一边右侧深入阅读
- 需要对比多个话题但不想频繁前进后退

## 已知限制

- 当前只适配 `linux.do`，没有抽象成多站点配置。
- 话题识别逻辑只针对 `/t/` 路径，不会拦截其他页面类型。
- 依赖当前 Discourse DOM 结构、全局对象和 sidebar 选择器；站点升级后可能需要调整。
- `iframe` 内导航优先使用站点当前暴露的 `DiscourseURL.routeTo` 或 Ember router；如果接口变化，会退回到 `window.location.href`。
- 弱化效果和滚动修正都基于当前页面结构实现，属于较强耦合方案，不适合直接迁移到任意 Discourse 站点。
- 移动端或窄屏场景不会启用分栏体验。

## 开发说明

- 代码为原生 JavaScript + CSS，没有构建链。
- 调试时直接修改仓库文件并在扩展管理页刷新即可。
- 如果要发版，推荐使用语义化 tag，例如 `v1.1.2`。

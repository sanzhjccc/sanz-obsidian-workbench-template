# Jupyter Editor

在 Obsidian 中阅览、编辑和运行 Jupyter Notebook（`.ipynb`）。作者：Sanz。

Jupyter Editor 将本地 Notebook 作为 Obsidian 笔记的一部分：可直接阅读 Markdown、修改单元格、选择本机 Python 环境运行代码，并将结果保存回标准 `nbformat 4` 文件。

## 优点

- **不离开 Obsidian**：Notebook、课程笔记、双链和日常知识库在同一个工作流中。
- **本机内核运行**：选择你自己的 Conda、venv 或系统 Python；变量在同一个内核会话中持续存在。
- **标准文件格式**：读取和保存标准 `.ipynb`，可以继续用 JupyterLab、VS Code 或 Colab 打开。
- **适合课程资料**：处理 D2L/Sphinx 的公式、图表、交叉引用和引用标记，也支持常规 Jupyter Notebook。
- **本地优先**：不上传 Notebook、代码或图片；执行仅使用你选择的本地 Python 解释器。

## 功能

- 原生读取和保存 Jupyter Notebook `nbformat 4`。
- 阅览 Markdown、Python 代码、文本输出、错误、HTML 表格和 PNG、JPEG、GIF、WebP、SVG 图片输出。
- 编辑 Markdown、Code、Raw 单元格。
- 新增、删除、上下移动和转换单元格类型。
- 保存时保留 Notebook 元数据与既有输出。
- 支持 `Ctrl/Cmd + S`。
- 自动发现 Conda、`.venv`、`venv` 和系统 Python。
- 可在 Notebook 顶部选择本机虚拟环境并启动、停止或中断 Jupyter 内核。
- 顶部“运行全部”按顺序执行所有非空 Code 单元格，自动跳过 Markdown 和 Raw 单元格。
- 通过所选环境的 `ipykernel` 执行 Python 代码，变量在同一内核会话中持续存在。
- 将代码结果、文本、报错、HTML 表格和图片输出写回对应 Notebook 单元格。
- 双击 Markdown 或代码单元格即可在原位置编辑；点击外部或按 `Ctrl/Cmd + Enter` 完成，按 `Esc` 取消。
- 预览模式下每个单元格都提供类型切换、上方/下方插入和删除按钮，无需先切换到整本 Notebook 编辑模式。
- 代码单元格显示 `运行中…`、`运行完成 · 用时`、`运行失败` 等状态，运行期间执行计数显示为 `[*]`。
- 运行代码时只更新当前单元格，不清空或重绘整页，避免执行过程中页面来回跳动。
- 直接读取 Notebook Markdown 引用的 vault 图片并生成内嵌 `data:` 图像，兼容 D2L 的 `../img/...` 路径，不依赖 Obsidian 对 `.ipynb` 相对资源的解析。
- 兼容 Claudian 2.1.x 的选区上下文采集：在 Markdown/代码原位编辑器中选择文字后，Claudian 可读取当前选中文本。
- 双击 Markdown 单元格后可点击“插入图片”，也可直接粘贴剪贴板截图；图片保存到 Notebook 专属 `.assets` 目录并以标准相对 Markdown 路径写入单元格。
- Notebook 顶部提供常驻“插入图片”按钮：预览状态下直接插入到最近选择或当前可见的 Markdown 单元格，编辑状态下插入到光标位置。文件选择和插入过程锁定全部滚动容器的位置。
- 顶部工具栏与正文滚动层完全分离，避免正文从工具栏上方透出；图片选择优先使用 Electron/Chromium 原生文件选择接口。
- 顶部与单元格内“插入图片”共用唯一文件选择器；编辑状态下会记录光标和选区，但文件窗口关闭后不强制重新聚焦长文本框，避免选中单元格时失焦、无响应和乱跳。
- 图片按钮在 `mousedown` 阶段锁定编辑状态并阻止焦点迁移；点击插件工具栏不会触发 Markdown 单元格的自动提交或整页重绘。
- 退出 Markdown/代码原位编辑时只重绘当前单元格，不再重绘整本 Notebook；正文滚动层禁用浏览器自动滚动锚定，避免长单元格退出时页面下滑。
- 将 D2L `:cite:` 引用渲染为作者—年份超链接，例如 `[Russell & Norvig, 2016]`；点击后通过文本片段定位到 D2L 官方参考文献页的对应条目，并支持一个标记中的多条引用。
- 自动构建 vault 内 Notebook 的交叉引用目录。
- 转换 D2L/Sphinx 标记：`eqlabel`、`eqref`、`label`、`numref`、`cite`、`begin_tab`、`end_tab` 等。

## 安装

社区插件目录发布后，在 Obsidian 中打开“设置 → 第三方插件”，搜索 **Jupyter Editor** 并安装。市场安装包已包含启动内核所需的桥接逻辑，无需额外复制 Python 脚本。

在发布审核期间，可从 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`，放入 vault 的 `.obsidian/plugins/jupyter-editor/` 后重载 Obsidian。

## 使用说明

1. 重载 Obsidian。
2. 点击任意 `.ipynb` 文件。
3. 在顶部的环境下拉框中选择本机 Python 虚拟环境。
4. 点击“启动”创建 Jupyter 内核，再点击代码单元格右上角的运行按钮。
5. 双击 Markdown 或代码内容可直接在原位置编辑；按 `Ctrl/Cmd + Enter` 完成，按 `Esc` 取消。
6. 在 Markdown 单元格中点击“插入图片”，或直接粘贴截图。图片会保存到 Notebook 同级的 `.assets` 目录。
7. 执行结果或内容修改后，点击“保存”或按 `Ctrl/Cmd + S`。

### 代码执行状态

- `[*]` 和“运行中…”：内核正在执行该单元格。
- “运行完成 · 用时”：代码成功完成。
- “运行失败”或“已中断”：可在单元格输出区域查看报错或中断结果。

### D2L 笔记

Jupyter Editor 会转换 D2L/Sphinx 标记。公式、图表、章节交叉引用和 `:cite:` 引用会按 Obsidian 阅读方式显示；引用可点击跳转到 D2L 官方参考文献页。

“重载”会重新读取磁盘内容；存在未保存修改时，插件会先请求确认。

## 隐私与安全

- 插件不会把内容发送到网络，也不包含遥测或广告。
- 为发现环境和运行代码，插件会在你点击相关按钮后调用本地 Python、Conda 和 `ipykernel`。
- 运行 Notebook 代码等同于在本机 Jupyter 中运行该代码；请只运行你信任的 Notebook。

## 限制

所选 Python 环境需要安装 `ipykernel` 与 `jupyter_client`。调用 `input()` 的交互式标准输入暂不支持。

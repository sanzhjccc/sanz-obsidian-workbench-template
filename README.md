![Sanz — 艺术科技工作台](sanz-workbench-hero-v6.png)

# Sanz Obsidian 工作台模板

一个面向持续学习、技术研究和项目复盘的中文 Obsidian 工作台。它提供清晰的知识目录、开箱即用的三栏工作区、统一视觉样式，以及工作站中使用的 13 个本地插件。

> 这是一个“干净起点”，不是作者个人知识库的副本：模板保留结构和工具，不包含任何个人笔记、项目文件、日历或对话记录。

## 你会得到什么

- **八个功能区**：从临时收集、学习路线到项目日志，各类内容有明确去处。
- **知识树首页**：打开仓库即可看到嵌入式、具身智能、Agent 开发三条主线。
- **一致的工作区**：左侧文件与搜索，中央工作区，右侧反向链接与大纲；视觉样式已启用。
- **Notebook 工作流**：可在 Obsidian 内查看、编辑并用自己的本机 Python 环境运行 `.ipynb` 文件。
- **本地优先**：不会预置第三方账号、同步服务、API Key 或机器路径。

## 目录说明

```text
00-收件箱/                 快速记录、网页摘录和未归档想法
01-嵌入式/                 嵌入式系统学习、实验与项目
02-具身智能/               视觉、控制、仿真和具身研究
03-Agent开发/              LLM、Agent、MCP、RAG 等内容
04-故障检测维修记录/       环境、设备、代码与项目故障复盘
05-工作站开发文档/         模板本身的配置、规范和维护说明
06-Skills与学习资源/       工具、技能、课程与网站索引
07-项目日志/               按日期沉淀工作进展和决策
.obsidian/                 Obsidian 配置、样式和随模板分发的插件
```

每个学习主线和索引文件都是空白入口。建议从 `00-收件箱` 开始收集，再定期移动到对应主题目录，并在相关笔记间建立 `[[双向链接]]`。

## 开始使用

### 1. 获取并打开仓库

任选一种方式取得完整目录：

```bash
git clone https://github.com/<你的 GitHub 用户名>/sanz-obsidian-workbench-template.git
```

也可以在 GitHub 页面点击 **Code → Download ZIP** 并解压。随后：

1. 安装并启动 [Obsidian](https://obsidian.md/) 桌面端。
2. 选择 **打开本地仓库**，并选中仓库根目录（含 `.obsidian` 文件夹的目录）。
3. 首次打开时，中央区域应显示“**Sanz 的知识树**”。如未显示，重启 Obsidian，或从左侧文件列表中打开任意 Markdown 文件。
4. 打开 **设置 → 外观 → CSS 代码片段**，确认 `visual-workstation` 已启用。
5. 打开 **设置 → 第三方插件**，仅在阅读并信任插件代码后启用随模板提供的插件。

> 建议用 Obsidian 桌面端打开。Jupyter Editor 需要桌面端对本机 Python 进程的支持，移动端不能运行 Notebook 内核。

### 2. 建立你的日常工作流

一个简单、可靠的用法是：

1. 所有临时信息先记入 `00-收件箱`，不要在收集阶段纠结分类。
2. 定期清空收件箱：将内容移动到一个主题目录，并补充标题、来源和链接。
3. 在 `01-嵌入式`、`02-具身智能`、`03-Agent开发` 的“学习路线”中维护你的目标和下一步。
4. 遇到问题时，在 `04-故障检测维修记录` 记录现象、原因、解决方案和复发预防。
5. 每天或每个工作节点，在 `07-项目日志` 新建 `YYYY-MM-DD-项目当日记录.md`，记录进展、决策和待办。

### 3. 推荐的笔记起步格式

创建一篇主题笔记时，可以从下面的结构开始：

```markdown
# 主题名称

## 结论

用几句话写下目前最重要的结论。

## 资料与过程

- 来源：
- 关键概念：
- 实验或实践：

## 下一步

- [ ] 下一项可执行的动作

## 关联

- [[相关笔记]]
```

## 内置功能

### Sanz 的知识树

知识树是仓库启动时的首页，展示三条技术主线：嵌入式、具身智能和 Agent 开发。它是导航入口，不会替你自动生成笔记；请在对应目录中逐步增加自己的内容和双向链接。

如首页被关闭，可使用 Obsidian 的命令面板（`Ctrl/Cmd + P`）搜索“知识树”，或重启仓库以恢复默认工作区。

### Jupyter Editor

`Jupyter Editor` 可以直接打开标准 `nbformat 4` 的 `.ipynb` 文件，保留 Markdown、代码、单元格输出和 Notebook 元数据。使用流程：

1. 在仓库中打开或新建一个 `.ipynb` 文件。
2. 在顶部环境下拉框中选择自己的 Conda、venv 或系统 Python。
3. 若环境尚未准备好，在该环境执行：

   ```bash
   python -m pip install ipykernel jupyter_client
   ```

4. 点击 **启动** 创建本机内核，再点击单元格的运行按钮；变量会在同一内核会话中保留。
5. 使用 **保存** 或 `Ctrl/Cmd + S` 写回标准 Notebook 文件；它也可继续在 JupyterLab、VS Code 或 Colab 中打开。

安全提示：运行 Notebook 代码等同于在本机执行代码。只运行自己信任的 Notebook；模板不会提供或上传任何 Python 环境。

## 随模板分发的插件

模板包含工作站当前安装的全部插件代码：`calendar`、`code-emitter`、`dataview`、`galaxy-view`、`homepage`、`jupyter-editor`、`obsidian-charts`、`obsidian-excalidraw-plugin`、`obsidian-git`、`obsidian-icon-folder`、`obsidian-kanban`、`realclaudian` 和 `sanz-knowledge-tree`。其中除 `homepage` 外的插件会写入默认启用清单；请在 **设置 → 第三方插件** 中逐项审查、信任和按需启用。

- Dataview：查询和汇总笔记中的结构化信息。
- Excalidraw：手绘图、草图和可视化思考。
- Kanban、Calendar 与 Obsidian Charts：组织任务、日记和图表。
- Obsidian Git：提交与同步 Markdown 仓库。
- Jupyter Editor、Code Emitter、Galaxy View、Icon Folder、Realclaudian、Homepage 和知识树：分别提供 Notebook、代码展示、图谱、图标、智能工作流、主页与导航能力。

为保护隐私，模板不复制任何插件的个人 `data.json` 设置；Jupyter 的 Python 路径为空，使用前请在自己的设备上重新配置。运行第三方插件或 Notebook 前，请审查其代码及权限。

## Git 同步建议

如果你希望把自己的笔记同步到私有 Git 仓库，推荐在复制出的个人仓库中操作：

```bash
git add .
git commit -m "初始化我的 Obsidian 工作台"
git remote add origin <你的私有仓库地址>
git push -u origin main
```

提交前请检查 `git status`，确保不会上传密码、令牌、客户资料或私密笔记。若同时在多台设备编辑，应先拉取远端变更、处理冲突后再推送。请根据自己的隐私要求决定是否提交 `.obsidian/workspace.json`；本模板提交它是为了提供默认布局。

## 常见问题

### 第三方插件无法加载

确认仓库根目录的 `.obsidian/community-plugins.json` 中列有插件，并在 **设置 → 第三方插件** 中完成信任与启用。更新 Obsidian 或修改插件文件后，可使用命令面板执行“重新加载应用”。

### 没有看到知识树首页

先关闭并重新打开仓库；若仍未出现，确认 `sanz-knowledge-tree` 插件已启用。也可以先打开任意 Markdown 文件继续工作，知识树只是导航视图，不影响笔记数据。

### Notebook 提示缺少依赖或内核启动失败

在你选定的 Python 环境中安装 `ipykernel` 与 `jupyter_client`，然后回到 Obsidian 重新选择该解释器。不要使用一个环境安装依赖、再在另一个环境启动内核。

### 样式看起来没有生效

打开 **设置 → 外观 → CSS 代码片段**，启用 `visual-workstation`；若清单中没有它，确认 `.obsidian/snippets/visual-workstation.css` 文件未被删除，然后重新加载 Obsidian。

## 隐私、许可与贡献

模板已移除个人笔记、Notebook、PDF、图片、Git 历史、远程地址、AI 对话、日历事件、最近文件、用户名、绝对路径及账号凭据。使用时请仍自行检查新增内容，尤其是提交到远程仓库之前。

项目采用 [MIT License](LICENSE)。欢迎通过 Issue 提出问题或建议；提交改动前请避免加入个人数据、二进制构建产物或未获授权转载的资料。

## 版本

当前版本：`v1.0.0`。发布日期：2026-09-08。

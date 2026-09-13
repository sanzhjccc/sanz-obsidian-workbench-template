'use strict';

const Obsidian = require('obsidian');
const { FileView, MarkdownRenderer, Notice, Plugin, PluginSettingTab, Setting, setIcon } = Obsidian;
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { Buffer } = require('buffer');

const VIEW_TYPE = 'jupyter-editor-view';
const DEFAULT_SETTINGS = {
    pythonPath: '',
};

// The marketplace distributes only main.js, manifest.json and styles.css.
// Keep the local Python bridge in this source file so installed copies can
// start a real Jupyter kernel without relying on an undeployed sidecar file.
const KERNEL_BRIDGE_SOURCE = "\"\"\"JSON-lines bridge between Obsidian and a real Jupyter kernel.\n\nThe bridge runs with the Python interpreter selected in Jupyter Editor. It\nstarts ipykernel through jupyter_client, forwards execution messages as JSON,\nand keeps the kernel alive so variables persist between notebook cells.\n\"\"\"\n\nfrom __future__ import annotations\n\nimport json\nimport os\nimport signal\nimport sys\nimport traceback\nfrom typing import Any, Dict\n\n\ndef emit(payload: Dict[str, Any]) -> None:\n    print(json.dumps(payload, ensure_ascii=False, default=str), flush=True)\n\n\ndef main() -> int:\n    try:\n        from jupyter_client import KernelManager\n    except Exception as exc:\n        emit(\n            {\n                \"event\": \"fatal\",\n                \"message\": \"当前 Python 环境缺少 jupyter_client 或 ipykernel\",\n                \"detail\": str(exc),\n            }\n        )\n        return 2\n\n    manager = KernelManager(kernel_name=\"python3\")\n    # Force the kernel to use this bridge's interpreter instead of a global\n    # kernelspec that may point at another virtual environment.\n    manager.kernel_spec.argv = [\n        sys.executable,\n        \"-m\",\n        \"ipykernel_launcher\",\n        \"-f\",\n        \"{connection_file}\",\n    ]\n    client = None\n\n    def interrupt_kernel(_signum: int, _frame: Any) -> None:\n        try:\n            manager.interrupt_kernel()\n            emit({\"event\": \"interrupted\"})\n        except Exception as exc:  # pragma: no cover - depends on OS signal state\n            emit({\"event\": \"bridge_error\", \"message\": f\"中断内核失败：{exc}\"})\n\n    signal.signal(signal.SIGINT, interrupt_kernel)\n\n    try:\n        manager.start_kernel(cwd=os.getcwd())\n        client = manager.client()\n        client.start_channels()\n        client.wait_for_ready(timeout=30)\n        emit(\n            {\n                \"event\": \"ready\",\n                \"python\": sys.executable,\n                \"python_version\": sys.version.split()[0],\n                \"pid\": getattr(manager.provisioner, \"pid\", None),\n            }\n        )\n\n        for raw_line in sys.stdin:\n            line = raw_line.strip()\n            if not line:\n                continue\n            try:\n                request = json.loads(line)\n            except json.JSONDecodeError as exc:\n                emit({\"event\": \"bridge_error\", \"message\": f\"无效 JSON：{exc}\"})\n                continue\n\n            action = request.get(\"action\")\n            request_id = request.get(\"id\")\n            if action == \"shutdown\":\n                emit({\"event\": \"stopping\"})\n                break\n            if action != \"execute\":\n                emit(\n                    {\n                        \"id\": request_id,\n                        \"event\": \"bridge_error\",\n                        \"message\": f\"未知操作：{action}\",\n                    }\n                )\n                continue\n\n            code = request.get(\"code\", \"\")\n            try:\n                message_id = client.execute(\n                    code,\n                    allow_stdin=False,\n                    stop_on_error=False,\n                    store_history=True,\n                )\n                execution_count = None\n                status = \"ok\"\n\n                while True:\n                    message = client.get_iopub_msg(timeout=120)\n                    parent_id = message.get(\"parent_header\", {}).get(\"msg_id\")\n                    if parent_id != message_id:\n                        continue\n                    message_type = message.get(\"header\", {}).get(\"msg_type\", \"\")\n                    content = message.get(\"content\", {})\n\n                    if message_type == \"status\" and content.get(\"execution_state\") == \"idle\":\n                        break\n                    if message_type == \"execute_input\":\n                        execution_count = content.get(\"execution_count\")\n                    if message_type == \"error\":\n                        status = \"error\"\n\n                    if message_type in {\n                        \"stream\",\n                        \"display_data\",\n                        \"execute_result\",\n                        \"update_display_data\",\n                        \"error\",\n                        \"clear_output\",\n                    }:\n                        emit(\n                            {\n                                \"id\": request_id,\n                                \"event\": \"output\",\n                                \"msg_type\": message_type,\n                                \"content\": content,\n                            }\n                        )\n\n                emit(\n                    {\n                        \"id\": request_id,\n                        \"event\": \"done\",\n                        \"status\": status,\n                        \"execution_count\": execution_count,\n                    }\n                )\n            except KeyboardInterrupt:\n                emit(\n                    {\n                        \"id\": request_id,\n                        \"event\": \"done\",\n                        \"status\": \"abort\",\n                        \"execution_count\": None,\n                    }\n                )\n            except Exception as exc:\n                emit(\n                    {\n                        \"id\": request_id,\n                        \"event\": \"done\",\n                        \"status\": \"error\",\n                        \"execution_count\": None,\n                        \"message\": str(exc),\n                        \"traceback\": traceback.format_exc(),\n                    }\n                )\n    except Exception as exc:\n        emit(\n            {\n                \"event\": \"fatal\",\n                \"message\": f\"Jupyter 内核启动失败：{exc}\",\n                \"detail\": traceback.format_exc(),\n            }\n        )\n        return 1\n    finally:\n        if client is not None:\n            try:\n                client.stop_channels()\n            except Exception:\n                pass\n        try:\n            if manager.has_kernel:\n                manager.shutdown_kernel(now=True)\n        except Exception:\n            pass\n\n    emit({\"event\": \"stopped\"})\n    return 0\n\n\nif __name__ == \"__main__\":\n    raise SystemExit(main())\n";

const KNOWN_REFERENCES = new Map([
    ['chap_optimization', '优化算法章节'],
    ['chap_linear', '线性神经网络章节'],
    ['sec_autograd', '自动微分'],
    ['sec_prob', '概率'],
    ['sec_linear_regression', '线性回归'],
    ['sec_linear_scratch', '线性回归的从零开始实现'],
    ['sec_linear_concise', '线性回归的简洁实现'],
    ['sec_softmax', 'Softmax 回归'],
    ['sec_softmax_scratch', 'Softmax 回归的从零开始实现'],
    ['sec_softmax_concise', 'Softmax 回归的简洁实现'],
    ['subsec_broadcasting', '广播机制'],
    ['sec_fashion_mnist', '图像分类数据集'],
]);

function sourceText(source) {
    if (Array.isArray(source)) return source.join('');
    return typeof source === 'string' ? source : '';
}

function sourceLines(text) {
    if (!text) return [];
    return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function safeText(value) {
    return String(value == null ? '' : value);
}

function escapeHtml(value) {
    return safeText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function stripAnsi(value) {
    return safeText(value).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function joined(value) {
    return Array.isArray(value) ? value.join('') : safeText(value);
}

function prettifyId(id) {
    const known = KNOWN_REFERENCES.get(id);
    if (known) return known;
    return id
        .replace(/^(?:chap|sec|subsec|fig|tab|table|eq)_/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
}

function citationLabel(id) {
    const parts = safeText(id).split('.').filter(Boolean);
    const yearIndex = parts.findIndex((part) => /^\d{4}[a-z]?$/i.test(part));
    const year = yearIndex >= 0 ? parts[yearIndex] : '';
    const names = (yearIndex >= 0 ? parts.slice(0, yearIndex) : parts)
        .filter((part) => part.toLowerCase() !== 'ea');
    const hasEtAl = parts.some((part) => part.toLowerCase() === 'ea') || names.length > 2;
    let authors = names[0] || safeText(id);
    if (hasEtAl) authors = `${authors} et al.`;
    else if (names.length === 2) authors = `${names[0]} & ${names[1]}`;
    return year ? `${authors}, ${year}` : authors;
}

function citationUrl(label) {
    const references = 'https://zh.d2l.ai/chapter_references/zreferences.html';
    return `${references}#:~:text=${encodeURIComponent(label)}`;
}

function labelKind(id, forced) {
    if (forced) return forced;
    if (/^eq_/i.test(id)) return 'equation';
    if (/^fig_/i.test(id)) return 'figure';
    if (/^(?:tab|table)_/i.test(id)) return 'table';
    if (/^chap_/i.test(id)) return 'chapter';
    return 'section';
}

function headingFromMarkdown(markdown) {
    const match = sourceText(markdown).match(/^#{1,6}\s+(.+)$/m);
    return match ? match[1].replace(/[*_`]/g, '').trim() : '';
}

function pythonExecutable(environmentPath) {
    return process.platform === 'win32'
        ? path.join(environmentPath, 'python.exe')
        : path.join(environmentPath, 'bin', 'python');
}

function environmentName(pythonPath) {
    const binDirectory = path.dirname(pythonPath);
    const environmentDirectory = process.platform === 'win32'
        ? binDirectory
        : path.dirname(binDirectory);
    const name = path.basename(environmentDirectory);
    if (name === 'miniconda3' || name === 'anaconda3') return 'Conda base';
    return name || pythonPath;
}

function inspectPython(pythonPath) {
    if (!pythonPath || !fs.existsSync(pythonPath)) {
        return { available: false, reason: 'Python 可执行文件不存在' };
    }
    const probe = childProcess.spawnSync(
        pythonPath,
        [
            '-c',
            'import sys, ipykernel, jupyter_client; print(sys.version.split()[0]); print(ipykernel.__version__); print(jupyter_client.__version__)',
        ],
        { encoding: 'utf8', timeout: 8000, windowsHide: true },
    );
    if (probe.status !== 0) {
        const reason = (probe.stderr || probe.stdout || '缺少 ipykernel/jupyter_client').trim().split('\n').pop();
        return { available: false, reason };
    }
    const [pythonVersion, ipykernelVersion, clientVersion] = probe.stdout.trim().split(/\r?\n/);
    return {
        available: true,
        pythonVersion,
        ipykernelVersion,
        clientVersion,
    };
}

class NotebookDocument {
    constructor(notebook, raw) {
        this.notebook = notebook;
        this.raw = raw;
        this.dirty = false;
    }

    static parse(raw) {
        const notebook = JSON.parse(raw);
        if (!notebook || !Array.isArray(notebook.cells)) {
            throw new Error('缺少 cells 数组，不是有效的 Jupyter Notebook');
        }
        if (notebook.nbformat !== 4) {
            throw new Error(`仅支持 nbformat 4，当前文件为 nbformat ${notebook.nbformat ?? '未知'}`);
        }
        return new NotebookDocument(notebook, raw);
    }

    markDirty() {
        this.dirty = true;
    }

    serialize() {
        return `${JSON.stringify(this.notebook, null, 1)}\n`;
    }

    addCell(type, index = this.notebook.cells.length) {
        const cell = { cell_type: type, metadata: {}, source: [] };
        if (type === 'code') {
            cell.execution_count = null;
            cell.outputs = [];
        }
        this.notebook.cells.splice(index, 0, cell);
        this.markDirty();
    }

    removeCell(index) {
        this.notebook.cells.splice(index, 1);
        this.markDirty();
    }

    moveCell(index, offset) {
        const target = index + offset;
        if (target < 0 || target >= this.notebook.cells.length) return false;
        const [cell] = this.notebook.cells.splice(index, 1);
        this.notebook.cells.splice(target, 0, cell);
        this.markDirty();
        return true;
    }

    changeCellType(index, type) {
        const cell = this.notebook.cells[index];
        if (!cell || cell.cell_type === type) return;
        cell.cell_type = type;
        if (type === 'code') {
            cell.execution_count = null;
            cell.outputs = [];
        } else {
            delete cell.execution_count;
            delete cell.outputs;
        }
        this.markDirty();
    }
}

class D2LReferenceCompiler {
    constructor(catalog, filePath, notebook) {
        this.catalog = catalog;
        this.filePath = filePath;
        this.local = this.indexLocalLabels(notebook);
    }

    indexLocalLabels(notebook) {
        const labels = new Map();
        const counters = { equation: 0, figure: 0, table: 0 };
        for (const cell of notebook.cells || []) {
            if (cell.cell_type !== 'markdown') continue;
            const markdown = sourceText(cell.source);
            for (const match of markdown.matchAll(/:eqlabel:`([^`]+)`/g)) {
                const id = match[1];
                if (labels.has(id)) continue;
                counters.equation += 1;
                labels.set(id, { id, kind: 'equation', number: counters.equation });
            }
            for (const match of markdown.matchAll(/:label:`([^`]+)`/g)) {
                const id = match[1];
                if (labels.has(id)) continue;
                const kind = labelKind(id);
                if (kind === 'figure' || kind === 'table') counters[kind] += 1;
                labels.set(id, {
                    id,
                    kind,
                    number: kind === 'figure' || kind === 'table' ? counters[kind] : null,
                });
            }
        }
        return labels;
    }

    referenceText(id, forcedKind) {
        const local = this.local.get(id);
        const catalogItem = this.catalog.get(id);
        const kind = labelKind(id, local ? local.kind : (catalogItem ? catalogItem.kind : forcedKind));
        const number = local ? local.number : null;
        if (kind === 'equation') return number ? `公式（${number}）` : `公式「${prettifyId(id)}」`;
        if (kind === 'figure') return number ? `图 ${number}` : `图「${prettifyId(id)}」`;
        if (kind === 'table') return number ? `表 ${number}` : `表「${prettifyId(id)}」`;
        if (KNOWN_REFERENCES.has(id)) return KNOWN_REFERENCES.get(id);
        if (catalogItem && catalogItem.title) return catalogItem.title;
        if (kind === 'chapter') return `${prettifyId(id)}章节`;
        return prettifyId(id);
    }

    linkedReference(id, forcedKind) {
        const text = this.referenceText(id, forcedKind);
        const target = this.catalog.get(id);
        if (target && target.path && target.path !== this.filePath) {
            return `[[${target.path}|${text}]]`;
        }
        return `**${text}**`;
    }

    compile(source) {
        let markdown = sourceText(source);

        markdown = markdown.replace(/^:eqlabel:`([^`]+)`\s*$/gm, (_, id) => {
            return `<span class="je-number-label">${escapeHtml(this.referenceText(id, 'equation'))}</span>`;
        });

        markdown = markdown.replace(/^:label:`([^`]+)`\s*$/gm, (_, id) => {
            const item = this.local.get(id);
            if (item && (item.kind === 'figure' || item.kind === 'table')) {
                return `<span class="je-number-label">${escapeHtml(this.referenceText(id))}</span>`;
            }
            return '';
        });

        markdown = markdown.replace(/:eqref:`([^`]+)`/g, (_, id) => this.linkedReference(id, 'equation'));
        markdown = markdown.replace(/:numref:`([^`]+)`/g, (_, id) => this.linkedReference(id));
        markdown = markdown.replace(/:(?:ref|doc):`([^`]+)`/g, (_, id) => this.linkedReference(id));
        markdown = markdown.replace(/:cite:`([^`]+)`/g, (_, id) => {
            return id.split(/[,;]/).map((citationId) => {
                const key = citationId.trim();
                const label = citationLabel(key);
                const url = citationUrl(label);
                return `<a class="external-link je-citation" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="查看 D2L 参考文献：${escapeHtml(key)}">[${escapeHtml(label)}]</a>`;
            }).join('；');
        });
        markdown = markdown.replace(/:(?:class|func|attr|meth|mod):`([^`]+)`/g, '`$1`');
        markdown = markdown.replace(/^:begin_tab:(?:`([^`]+)`|([^\s]+))\s*$/gm, (_, quoted, plain) => {
            const tab = quoted || plain || '';
            return tab === 'toc' ? '' : `> **${tab}**`;
        });
        markdown = markdown.replace(/^:end_tab:\s*$/gm, '');
        markdown = markdown.replace(/^:(?:width|height):[^\n]*$/gm, '');

        // Remove the remaining unknown Sphinx role wrapper while retaining its content.
        markdown = markdown.replace(/:[a-zA-Z][\w-]*:`([^`]+)`/g, '$1');

        // D2L book-build annotations: keep additions, discard deletions.
        markdown = markdown.replace(/\[\*\*([\s\S]*?)\*\*\]/g, '**$1**');
        markdown = markdown.replace(/\(\*\*([\s\S]*?)\*\*\)/g, '**$1**');
        markdown = markdown.replace(/\(~~[\s\S]*?~~\)/g, '');
        return markdown;
    }
}

class OutputPresenter {
    static render(cell, host) {
        const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
        if (!outputs.length) return;
        const area = host.createDiv({ cls: 'je-outputs' });
        for (const output of outputs) this.renderOne(output, area);
    }

    static renderOne(output, host) {
        const wrap = host.createDiv({ cls: 'je-output' });
        if (output.output_type === 'stream') {
            const cls = output.name === 'stderr' ? 'je-output-text is-error' : 'je-output-text';
            wrap.createEl('pre', { cls, text: joined(output.text) });
            return;
        }
        if (output.output_type === 'error') {
            const title = [output.ename, output.evalue].filter(Boolean).join(': ');
            if (title) wrap.createDiv({ cls: 'je-error-title', text: title });
            wrap.createEl('pre', {
                cls: 'je-output-text is-error',
                text: (output.traceback || []).map(stripAnsi).join('\n'),
            });
            return;
        }
        if (output.output_type !== 'execute_result' && output.output_type !== 'display_data') return;
        const data = output.data || {};
        const imageMime = [
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'image/svg+xml',
        ].find((mime) => data[mime]);
        if (imageMime) {
            const imageData = joined(data[imageMime]);
            const src = imageMime === 'image/svg+xml'
                ? `data:${imageMime};charset=utf-8,${encodeURIComponent(imageData)}`
                : `data:${imageMime};base64,${imageData.replace(/\s+/g, '')}`;
            wrap.createEl('img', {
                cls: 'je-output-image',
                attr: {
                    alt: 'Notebook output',
                    src,
                },
            });
            return;
        }
        if (data['text/html']) {
            const html = joined(data['text/html']);
            if (typeof Obsidian.sanitizeHTMLToDom === 'function') {
                wrap.addClass('je-html-output');
                wrap.appendChild(Obsidian.sanitizeHTMLToDom(html));
            } else {
                wrap.createEl('pre', { cls: 'je-output-text', text: html });
            }
            return;
        }
        if (data['text/plain']) {
            wrap.createEl('pre', { cls: 'je-output-text', text: joined(data['text/plain']) });
        }
    }
}

class KernelSession {
    constructor(view) {
        this.view = view;
        this.process = null;
        this.reader = null;
        this.state = 'stopped';
        this.pythonPath = '';
        this.sequence = 0;
        this.pending = new Map();
        this.startPromise = null;
        this.startResolve = null;
        this.startReject = null;
        this.stderr = '';
        this.stopTimer = null;
    }

    isRunning() {
        return this.process != null && this.state !== 'stopped' && this.state !== 'failed';
    }

    setState(state, detail = '') {
        this.state = state;
        this.view.onKernelStateChanged(state, detail);
    }

    async start(pythonPath, workingDirectory) {
        if (this.isRunning() && this.pythonPath === pythonPath) return;
        if (this.startPromise && this.pythonPath === pythonPath) return this.startPromise;
        if (this.process) await this.stop(true);
        if (!pythonPath) throw new Error('请先选择一个可用的 Python 虚拟环境');
        const inspection = inspectPython(pythonPath);
        if (!inspection.available) {
            throw new Error(`该环境无法启动 Jupyter 内核：${inspection.reason}`);
        }

        this.pythonPath = pythonPath;
        this.stderr = '';
        this.setState('starting', `Python ${inspection.pythonVersion}`);
        this.startPromise = new Promise((resolve, reject) => {
            this.startResolve = resolve;
            this.startReject = reject;
        });

        const env = { ...process.env, PYTHONUNBUFFERED: '1' };
        const pythonDirectory = path.dirname(pythonPath);
        env.PATH = `${pythonDirectory}${path.delimiter}${env.PATH || ''}`;
        this.process = childProcess.spawn(pythonPath, ['-c', KERNEL_BRIDGE_SOURCE], {
            cwd: workingDirectory,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.reader = readline.createInterface({ input: this.process.stdout });
        this.reader.on('line', (line) => this.handleLine(line));
        this.process.stderr.on('data', (chunk) => {
            this.stderr += chunk.toString();
            if (this.stderr.length > 12000) this.stderr = this.stderr.slice(-12000);
        });
        this.process.on('error', (error) => this.handleFatal(error));
        this.process.on('exit', (code, signalName) => this.handleExit(code, signalName));

        const timeout = window.setTimeout(() => {
            if (this.state === 'starting') {
                this.handleFatal(new Error(`内核启动超时${this.stderr ? `：${this.stderr.trim()}` : ''}`));
                void this.stop(true);
            }
        }, 35000);

        try {
            await this.startPromise;
        } finally {
            window.clearTimeout(timeout);
            this.startPromise = null;
            this.startResolve = null;
            this.startReject = null;
        }
    }

    handleLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (_error) {
            return;
        }

        if (message.event === 'ready') {
            this.setState('idle', `Python ${message.python_version}`);
            if (this.startResolve) this.startResolve(message);
            return;
        }
        if (message.event === 'fatal') {
            this.handleFatal(new Error([message.message, message.detail].filter(Boolean).join('\n')));
            return;
        }
        if (message.event === 'interrupted') {
            this.setState('busy', '正在中断');
            return;
        }

        const request = message.id ? this.pending.get(message.id) : null;
        if (!request) return;
        if (message.event === 'output') {
            request.onOutput(message);
            return;
        }
        if (message.event === 'done') {
            this.pending.delete(message.id);
            this.setState('idle');
            request.resolve(message);
            return;
        }
        if (message.event === 'bridge_error') {
            this.pending.delete(message.id);
            this.setState('idle');
            request.reject(new Error(message.message || '内核桥接错误'));
        }
    }

    handleFatal(error) {
        if (this.startReject) this.startReject(error);
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        this.setState('failed', error.message);
    }

    handleExit(code, signalName) {
        const wasStopping = this.state === 'stopping' || this.state === 'stopped';
        this.process = null;
        if (this.reader) this.reader.close();
        this.reader = null;
        if (!wasStopping && code !== 0) {
            this.handleFatal(
                new Error(`Jupyter 内核进程退出（code=${code}, signal=${signalName || 'none'}）${this.stderr ? `\n${this.stderr.trim()}` : ''}`),
            );
        } else {
            this.setState('stopped');
        }
    }

    async execute(code, onOutput) {
        if (!this.process || this.state !== 'idle') throw new Error('Jupyter 内核尚未就绪');
        const id = `execute-${Date.now()}-${++this.sequence}`;
        this.setState('busy');
        const result = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onOutput });
        });
        this.process.stdin.write(`${JSON.stringify({ id, action: 'execute', code })}\n`);
        return result;
    }

    interrupt() {
        if (!this.process || this.state !== 'busy') return;
        this.process.kill('SIGINT');
    }

    async restart(pythonPath, workingDirectory) {
        await this.stop(true);
        await this.start(pythonPath, workingDirectory);
    }

    async stop(force = false) {
        if (!this.process) {
            this.setState('stopped');
            return;
        }
        const runningProcess = this.process;
        const wasBusy = this.state === 'busy';
        this.setState('stopping');
        if (wasBusy) runningProcess.kill('SIGINT');
        if (runningProcess.stdin.writable) {
            runningProcess.stdin.write(`${JSON.stringify({ action: 'shutdown' })}\n`);
        } else {
            runningProcess.kill('SIGTERM');
        }
        await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            runningProcess.once('exit', finish);
            this.stopTimer = window.setTimeout(() => {
                if (this.process === runningProcess) runningProcess.kill('SIGKILL');
                finish();
            }, force ? 1500 : 3000);
        });
        if (this.stopTimer) window.clearTimeout(this.stopTimer);
        this.stopTimer = null;
        this.process = null;
        this.setState('stopped');
    }
}

function fitTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(100, textarea.scrollHeight + 2)}px`;
}

class JupyterEditorView extends FileView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.document = null;
        this.mode = 'preview';
        this.paintId = 0;
        this.kernel = new KernelSession(this);
        this.runningCellIndex = null;
        this.cellRunStates = new Map();
        this.activeInlineEditor = null;
        this.selectedCellIndex = null;
        this.pendingToolbarImage = null;
        this.toolbarImagePicker = null;
        this.imageDialogOpen = false;
        this.runningAll = false;
        // Claudian uses this path when it packages a selection from a custom view.
        this.url = '';
    }

    getViewType() {
        return VIEW_TYPE;
    }

    getDisplayText() {
        return this.file ? this.file.basename : 'Jupyter Editor';
    }

    getIcon() {
        return 'notebook-tabs';
    }

    async onOpen() {
        // Claudian 2.1.x scans custom views containing an iframe/webview and
        // already knows how to read selections from their active textarea.
        // This inert marker opts Jupyter Editor into that compatibility path
        // without modifying Claudian or loading any external content.
        if (!this.containerEl.querySelector('.je-claudian-selection-bridge')) {
            const bridge = this.containerEl.createEl('iframe', {
                cls: 'je-claudian-selection-bridge',
                attr: {
                    title: 'Jupyter Editor selection compatibility bridge',
                    'aria-hidden': 'true',
                    tabindex: '-1',
                    sandbox: '',
                    hidden: 'true',
                    width: '0',
                    height: '0',
                },
            });
            bridge.hidden = true;
            bridge.style.setProperty('display', 'none', 'important');
            bridge.style.position = 'absolute';
        }
        this.registerDomEvent(this.containerEl, 'keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (this.activeInlineEditor) this.activeInlineEditor.commit();
                void this.save();
            }
        });
    }

    async onLoadFile(file) {
        try {
            this.url = file.path;
            const raw = await this.app.vault.read(file);
            this.document = NotebookDocument.parse(raw);
            await this.plugin.ensureCatalog();
            await this.paint();
        } catch (error) {
            this.showFailure(error);
        }
    }

    async onUnloadFile() {
        await this.kernel.stop(true);
        this.document = null;
        this.url = '';
    }

    async onClose() {
        await this.kernel.stop(true);
    }

    showFailure(error) {
        const content = this.containerEl.children[1];
        content.empty();
        content.addClass('je-root');
        content.createDiv({ cls: 'je-failure', text: `Notebook 打开失败：${error.message}` });
        console.error('Jupyter Editor:', error);
    }

    setDirty() {
        this.document.markDirty();
        const status = this.containerEl.querySelector('.je-status');
        const save = this.containerEl.querySelector('.je-save');
        if (status) {
            status.setText('未保存');
            status.addClass('is-dirty');
        }
        if (save) save.disabled = false;
    }

    syncDirtyUI() {
        const status = this.containerEl.querySelector('.je-status');
        const save = this.containerEl.querySelector('.je-save');
        if (status) {
            status.setText(this.document.dirty ? '未保存' : '已保存');
            status.toggleClass('is-dirty', this.document.dirty);
        }
        if (save) save.disabled = !this.document.dirty;
    }

    getWorkingDirectory() {
        const adapter = this.app.vault.adapter;
        if (typeof adapter.getFullPath === 'function') {
            return path.dirname(adapter.getFullPath(this.file.path));
        }
        return path.dirname(path.join(adapter.getBasePath(), this.file.path));
    }

    kernelStateLabel(state, detail = '') {
        const labels = {
            stopped: '内核未启动',
            starting: '内核启动中',
            idle: '内核就绪',
            busy: '内核运行中',
            stopping: '内核停止中',
            failed: '内核错误',
        };
        return detail ? `${labels[state] || state} · ${detail}` : (labels[state] || state);
    }

    onKernelStateChanged(state, detail = '') {
        const status = this.containerEl.querySelector('.je-kernel-status');
        if (status) {
            status.setText(this.kernelStateLabel(state, detail));
            status.className = `je-kernel-status is-${state}`;
            status.setAttr('title', detail || this.kernelStateLabel(state));
        }
        const start = this.containerEl.querySelector('.je-kernel-start');
        const interrupt = this.containerEl.querySelector('.je-kernel-interrupt');
        const stop = this.containerEl.querySelector('.je-kernel-stop');
        if (start) start.disabled = state !== 'stopped' && state !== 'failed';
        if (interrupt) interrupt.disabled = state !== 'busy';
        if (stop) stop.disabled = state === 'stopped' || state === 'stopping';
        this.containerEl.querySelectorAll('.je-run-cell').forEach((button) => {
            button.disabled = state === 'busy' || state === 'starting' || state === 'stopping';
        });
        const runAll = this.containerEl.querySelector('.je-run-all');
        if (runAll) runAll.disabled = this.runningAll || state === 'busy' || state === 'starting' || state === 'stopping';
    }

    async paint(options = {}) {
        if (!this.document || !this.file) return;
        const currentPaint = ++this.paintId;
        const content = this.containerEl.children[1];
        const preserveScroll = options.preserveScroll === true;
        const scrollState = preserveScroll ? this.captureScrollState() : null;
        content.empty();
        content.addClass('je-root');
        this.paintToolbar(content);
        const scrollArea = content.createDiv({ cls: 'je-scroll-area' });
        const canvas = scrollArea.createDiv({ cls: this.mode === 'edit' ? 'je-canvas is-editing' : 'je-canvas' });
        const compiler = new D2LReferenceCompiler(
            this.plugin.referenceCatalog,
            this.file.path,
            this.document.notebook,
        );
        const cells = this.document.notebook.cells;
        for (let index = 0; index < cells.length; index += 1) {
            if (currentPaint !== this.paintId) return;
            if (this.mode === 'edit') this.paintEditorCell(canvas, cells[index], index);
            else await this.paintPreviewCell(canvas, cells[index], index, compiler);
        }
        this.paintInsertBar(canvas);
        if (preserveScroll && currentPaint === this.paintId) {
            const restore = () => this.restoreScrollState(scrollState);
            restore();
            window.requestAnimationFrame(restore);
        }
    }

    paintToolbar(host) {
        const toolbar = host.createDiv({ cls: 'je-toolbar' });
        const identity = toolbar.createDiv({ cls: 'je-identity' });
        identity.createSpan({ cls: 'je-title', text: this.file.basename });
        identity.createSpan({ cls: 'je-badge', text: 'Notebook · ipynb' });
        const controls = toolbar.createDiv({ cls: 'je-toolbar-controls' });
        controls.createSpan({
            cls: this.document.dirty ? 'je-status is-dirty' : 'je-status',
            text: this.document.dirty ? '未保存' : '已保存',
        });
        const environment = controls.createEl('select', {
            cls: 'dropdown je-environment-select',
            attr: { 'aria-label': 'Python 虚拟环境', title: 'Python 虚拟环境' },
        });
        const available = this.plugin.environments.filter((item) => item.available);
        if (!available.length) {
            environment.createEl('option', { value: '', text: '没有可用内核环境' });
            environment.disabled = true;
        } else {
            for (const item of available) {
                const option = environment.createEl('option', {
                    value: item.path,
                    text: `${item.name} · Python ${item.pythonVersion}`,
                });
                option.selected = item.path === this.plugin.settings.pythonPath;
            }
        }
        environment.addEventListener('change', () => void this.changePythonEnvironment(environment.value));
        controls.createSpan({
            cls: `je-kernel-status is-${this.kernel.state}`,
            text: this.kernelStateLabel(this.kernel.state),
            attr: { title: this.kernelStateLabel(this.kernel.state) },
        });
        this.toolbarButton(
            controls,
            'circle-play',
            '启动',
            'je-kernel-start',
            this.kernel.isRunning(),
            () => void this.startKernel(),
        );
        this.toolbarButton(
            controls,
            'play',
            '运行全部',
            'je-run-all',
            this.runningAll || this.kernel.state === 'busy' || this.kernel.state === 'starting',
            () => void this.executeAllCells(),
        );
        this.toolbarButton(
            controls,
            'octagon-pause',
            '中断',
            'je-kernel-interrupt',
            this.kernel.state !== 'busy',
            () => this.kernel.interrupt(),
        );
        this.toolbarButton(
            controls,
            'circle-stop',
            '停止',
            'je-kernel-stop',
            !this.kernel.isRunning(),
            () => void this.kernel.stop(),
        );
        const imagePicker = controls.createEl('input', {
            cls: 'je-image-picker',
            attr: {
                type: 'file',
                accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml',
                tabindex: '-1',
            },
        });
        this.toolbarImagePicker = imagePicker;
        const insertImageButton = this.toolbarButton(
            controls,
            'image-plus',
            '插入图片',
            'je-insert-image',
            false,
            () => this.openToolbarImagePicker(imagePicker),
        );
        insertImageButton.addEventListener('mousedown', (event) => {
            // Keep the inline textarea and its selection alive until the file
            // picker opens. focusout runs before click and would otherwise
            // repaint the toolbar, detaching both this button and the picker.
            this.imageDialogOpen = true;
            event.preventDefault();
        });
        imagePicker.addEventListener('change', () => {
            this.imageDialogOpen = false;
            const file = imagePicker.files && imagePicker.files[0];
            if (file) void this.handleToolbarImage(file);
            imagePicker.value = '';
        });
        imagePicker.addEventListener('cancel', () => {
            this.imageDialogOpen = false;
            this.pendingToolbarImage = null;
        });
        this.toolbarButton(controls, 'save', '保存', 'mod-cta je-save', !this.document.dirty, () => void this.save());
        this.toolbarButton(controls, 'refresh-cw', '重载', '', false, () => void this.reload());
    }

    toolbarButton(host, iconName, text, extraClass, disabled, action) {
        const button = host.createEl('button', { cls: `je-button ${extraClass}`.trim() });
        const icon = button.createSpan({ cls: 'je-button-icon' });
        setIcon(icon, iconName);
        button.createSpan({ text });
        button.disabled = disabled;
        button.addEventListener('click', action);
        return button;
    }

    async paintPreviewCell(host, cell, index, compiler) {
        const source = sourceText(cell.source);
        if (cell.cell_type === 'markdown') {
            const wrap = host.createDiv({ cls: 'je-cell je-markdown' });
            wrap.dataset.cellIndex = String(index);
            this.paintPreviewCellControls(wrap, cell, index);
            wrap.setAttr('title', '双击编辑 Markdown');
            if (source.trim()) await this.renderMarkdownCell(wrap, source, compiler);
            wrap.addEventListener('click', () => {
                this.selectedCellIndex = index;
            });
            wrap.addEventListener('dblclick', (event) => {
                event.preventDefault();
                this.openInlineEditor(wrap, cell, index, 'markdown');
            });
            return;
        }
        if (cell.cell_type === 'code') {
            const runState = this.cellRunStates.get(index);
            const wrap = host.createDiv({ cls: 'je-cell je-code' });
            wrap.dataset.cellIndex = String(index);
            this.paintPreviewCellControls(wrap, cell, index);
            wrap.createDiv({
                cls: this.runningCellIndex === index ? 'je-execution-count is-running' : 'je-execution-count',
                text: this.runningCellIndex === index
                    ? '[*]'
                    : (cell.execution_count == null ? '[ ]' : `[${cell.execution_count}]`),
            });
            const codeToolbar = wrap.createDiv({ cls: 'je-code-toolbar' });
            if (runState) {
                const labels = {
                    running: '运行中…',
                    completed: `运行完成 · ${runState.elapsed.toFixed(2)}s`,
                    error: `运行失败 · ${runState.elapsed.toFixed(2)}s`,
                    interrupted: `已中断 · ${runState.elapsed.toFixed(2)}s`,
                };
                codeToolbar.createSpan({
                    cls: `je-cell-run-status is-${runState.state}`,
                    text: labels[runState.state] || runState.state,
                });
            }
            const run = codeToolbar.createEl('button', {
                cls: 'clickable-icon je-run-cell',
                attr: { 'aria-label': '运行此单元格', title: '运行此单元格' },
            });
            setIcon(run, this.runningCellIndex === index ? 'loader-circle' : 'play');
            run.disabled = this.kernel.state === 'busy' || this.kernel.state === 'starting';
            run.addEventListener('click', () => void this.executeCell(index));
            const code = wrap.createDiv({ cls: 'je-code-source' });
            code.setAttr('title', '双击编辑 Python 代码');
            if (source.trim()) {
                await MarkdownRenderer.renderMarkdown(`\`\`\`python\n${source}\n\`\`\``, code, this.file.path, this.plugin);
            }
            code.addEventListener('dblclick', (event) => {
                event.preventDefault();
                this.openInlineEditor(wrap, cell, index, 'code');
            });
            OutputPresenter.render(cell, wrap);
            return;
        }
        const wrap = host.createDiv({ cls: 'je-cell je-raw' });
        wrap.dataset.cellIndex = String(index);
        this.paintPreviewCellControls(wrap, cell, index);
        if (source.trim()) wrap.createEl('pre', { text: source });
    }

    paintPreviewCellControls(wrap, cell, index) {
        const toolbar = wrap.createDiv({ cls: 'je-preview-cell-toolbar' });
        toolbar.createSpan({ cls: 'je-cell-index', text: `单元格 ${index + 1}` });
        const selector = toolbar.createEl('select', { cls: 'dropdown je-type-select', attr: { 'aria-label': '单元格类型' } });
        for (const type of ['markdown', 'code', 'raw']) {
            const option = selector.createEl('option', { value: type, text: type });
            option.selected = cell.cell_type === type;
        }
        selector.addEventListener('mousedown', (event) => event.stopPropagation());
        selector.addEventListener('click', (event) => event.stopPropagation());
        selector.addEventListener('change', (event) => {
            event.stopPropagation();
            this.document.changeCellType(index, selector.value);
            this.setDirty();
            void this.paint({ preserveScroll: true });
        });
        const addBefore = this.iconButton(toolbar, 'plus', '在上方插入单元格', false, () => {
            this.document.addCell('markdown', index);
            this.setDirty();
            void this.paint({ preserveScroll: true });
        }, 'je-cell-manage-button');
        const addAfter = this.iconButton(toolbar, 'plus-circle', '在下方插入单元格', false, () => {
            this.document.addCell('markdown', index + 1);
            this.setDirty();
            void this.paint({ preserveScroll: true });
        }, 'je-cell-manage-button');
        const remove = this.iconButton(toolbar, 'trash-2', '删除单元格', false, () => {
            if (!window.confirm(`确定删除单元格 ${index + 1} 吗？`)) return;
            this.document.removeCell(index);
            this.setDirty();
            void this.paint({ preserveScroll: true });
        }, 'je-cell-manage-button');
        for (const button of [addBefore, addAfter, remove]) {
            button.addEventListener('mousedown', (event) => event.stopPropagation());
            button.addEventListener('click', (event) => event.stopPropagation());
        }
    }

    paintEditorCell(host, cell, index) {
        const wrap = host.createDiv({ cls: `je-editor-cell is-${cell.cell_type}` });
        wrap.dataset.cellIndex = String(index);
        const header = wrap.createDiv({ cls: 'je-cell-toolbar' });
        header.createSpan({ cls: 'je-cell-index', text: `单元格 ${index + 1}` });
        const selector = header.createEl('select', { cls: 'dropdown je-type-select' });
        for (const type of ['markdown', 'code', 'raw']) {
            const option = selector.createEl('option', { value: type, text: type });
            option.selected = cell.cell_type === type;
        }
        selector.addEventListener('change', () => {
            this.document.changeCellType(index, selector.value);
            this.setDirty();
            void this.paint();
        });
        const actions = header.createDiv({ cls: 'je-cell-actions' });
        if (cell.cell_type === 'code') {
            this.iconButton(
                actions,
                this.runningCellIndex === index ? 'loader-circle' : 'play',
                '运行此单元格',
                this.kernel.state === 'busy' || this.kernel.state === 'starting',
                () => void this.executeCell(index),
                'je-run-cell',
            );
        }
        this.iconButton(actions, 'arrow-up', '上移', index === 0, () => this.move(index, -1));
        this.iconButton(actions, 'arrow-down', '下移', index === this.document.notebook.cells.length - 1, () => this.move(index, 1));
        this.iconButton(actions, 'trash-2', '删除', false, () => {
            this.document.removeCell(index);
            this.setDirty();
            void this.paint();
        });
        const editor = wrap.createEl('textarea', {
            cls: cell.cell_type === 'code' ? 'je-source-editor is-code' : 'je-source-editor',
            attr: { spellcheck: cell.cell_type === 'markdown' ? 'true' : 'false' },
        });
        editor.value = sourceText(cell.source);
        editor.addEventListener('input', () => {
            cell.source = sourceLines(editor.value);
            fitTextarea(editor);
            this.setDirty();
        });
        window.setTimeout(() => fitTextarea(editor), 0);
        if (cell.cell_type === 'code') OutputPresenter.render(cell, wrap);
    }

    localImageTarget(reference) {
        if (!reference || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(reference)) return null;
        let decoded = reference;
        try {
            decoded = decodeURIComponent(reference);
        } catch (_error) {
            // Keep the original reference when it is not URI encoded.
        }
        const targetPath = path.posix.normalize(
            path.posix.join(path.posix.dirname(this.file.path), decoded.split(/[?#]/, 1)[0]),
        );
        const target = this.app.vault.getAbstractFileByPath(targetPath);
        return target && typeof target.extension === 'string' ? { target, targetPath } : null;
    }

    async imageDataUrl(target) {
        const extension = target.extension.toLowerCase();
        if (extension === 'svg') {
            const svg = await this.app.vault.cachedRead(target);
            return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        }
        const mimeTypes = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
        };
        const mime = mimeTypes[extension];
        if (!mime) throw new Error(`不支持的图片格式：${extension}`);
        const bytes = await this.app.vault.readBinary(target);
        return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    }

    async renderMarkdownCell(wrap, source, compiler) {
        const localImages = [];
        const markdown = compiler.compile(source).replace(
            /!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g,
            (full, alt, bracketed, plain) => {
                const resolved = this.localImageTarget(bracketed || plain);
                if (!resolved) return full;
                const slot = localImages.length;
                localImages.push({ ...resolved, alt: alt || '' });
                return `<span class="je-notebook-image je-notebook-image-${slot}"></span>`;
            },
        );
        await MarkdownRenderer.renderMarkdown(markdown, wrap, this.file.path, this.plugin);
        await Promise.all(localImages.map(async ({ target, targetPath, alt }, slot) => {
            const placeholder = wrap.querySelector(`.je-notebook-image-${slot}`);
            if (!placeholder) return;
            try {
                const image = document.createElement('img');
                image.className = 'je-markdown-image';
                image.alt = alt || target.name;
                image.src = await this.imageDataUrl(target);
                image.setAttr('data-je-vault-path', targetPath);
                placeholder.appendChild(image);
                if (alt) placeholder.createSpan({ cls: 'je-image-caption', text: alt });
            } catch (error) {
                placeholder.addClass('je-image-error');
                placeholder.setText(`图片加载失败：${targetPath}（${error.message}）`);
            }
        }));
    }

    updateRunningCellUI(index) {
        const wrap = this.containerEl.querySelector(`.je-canvas > [data-cell-index="${index}"]`);
        if (!wrap) return;
        const count = wrap.querySelector('.je-execution-count');
        if (count) {
            count.setText('[*]');
            count.addClass('is-running');
        }
        const toolbar = wrap.querySelector('.je-code-toolbar');
        const run = wrap.querySelector('.je-run-cell');
        if (toolbar) {
            let status = toolbar.querySelector('.je-cell-run-status');
            if (!status) {
                status = document.createElement('span');
                toolbar.insertBefore(status, run || null);
            }
            status.className = 'je-cell-run-status is-running';
            status.setText('运行中…');
        }
        if (run) {
            setIcon(run, 'loader-circle');
            run.disabled = true;
        }
    }

    async refreshCell(index) {
        const oldCell = this.containerEl.querySelector(`.je-canvas > [data-cell-index="${index}"]`);
        const cell = this.document.notebook.cells[index];
        if (!oldCell || !cell) {
            await this.paint({ preserveScroll: true });
            return;
        }
        const staging = document.createElement('div');
        if (this.mode === 'edit') {
            this.paintEditorCell(staging, cell, index);
        } else {
            const compiler = new D2LReferenceCompiler(
                this.plugin.referenceCatalog,
                this.file.path,
                this.document.notebook,
            );
            await this.paintPreviewCell(staging, cell, index, compiler);
        }
        const replacement = staging.firstElementChild;
        if (!replacement) return;
        const scrollState = this.captureScrollState();
        oldCell.replaceWith(replacement);
        this.restoreScrollState(scrollState);
        window.requestAnimationFrame(() => this.restoreScrollState(scrollState));
    }

    captureScrollState() {
        const positions = [];
        const content = this.containerEl.children[1];
        const primary = content.querySelector('.je-scroll-area') || content;
        let element = content.parentElement;
        while (element) {
            positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
            element = element.parentElement;
        }
        return {
            positions,
            primaryTop: primary.scrollTop,
            primaryLeft: primary.scrollLeft,
            windowX: window.scrollX,
            windowY: window.scrollY,
        };
    }

    restoreScrollState(state) {
        if (!state) return;
        const content = this.containerEl.children[1];
        const primary = content.querySelector('.je-scroll-area') || content;
        primary.scrollTop = state.primaryTop;
        primary.scrollLeft = state.primaryLeft;
        for (const position of state.positions) {
            if (!position.element.isConnected) continue;
            position.element.scrollTop = position.top;
            position.element.scrollLeft = position.left;
        }
        window.scrollTo(state.windowX, state.windowY);
    }

    iconButton(host, iconName, label, disabled, action, extraClass = '') {
        const button = host.createEl('button', {
            cls: `clickable-icon je-icon-button ${extraClass}`.trim(),
            attr: { 'aria-label': label, title: label },
        });
        setIcon(button, iconName);
        button.disabled = disabled;
        button.addEventListener('click', action);
        return button;
    }

    imageExtension(file) {
        const fromName = path.extname(file.name || '').slice(1).toLowerCase();
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(fromName)) return fromName;
        const fromType = {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
        }[file.type];
        return fromType || '';
    }

    async importImageFile(file) {
        const extension = this.imageExtension(file);
        if (!extension) throw new Error('仅支持 PNG、JPEG、GIF、WebP 和 SVG 图片');
        const assetFolderName = `${this.file.basename}.assets`;
        const assetFolder = path.posix.join(path.posix.dirname(this.file.path), assetFolderName);
        if (!this.app.vault.getAbstractFileByPath(assetFolder)) {
            await this.app.vault.createFolder(assetFolder);
        }
        const sourceName = file.name || `image.${extension}`;
        const originalStem = path.basename(sourceName, path.extname(sourceName));
        const safeStem = originalStem
            .trim()
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-') || 'image';
        let filename = `${safeStem}.${extension}`;
        let counter = 2;
        while (this.app.vault.getAbstractFileByPath(path.posix.join(assetFolder, filename))) {
            filename = `${safeStem}-${counter}.${extension}`;
            counter += 1;
        }
        const targetPath = path.posix.join(assetFolder, filename);
        await this.app.vault.createBinary(targetPath, await file.arrayBuffer());
        return {
            targetPath,
            reference: `./${assetFolderName}/${filename}`,
            alt: safeStem,
        };
    }

    async insertImageIntoEditor(editor, cell, file, selectionStart, selectionEnd, options = {}) {
        const scrollState = options.scrollState || this.captureScrollState();
        const restoreScroll = () => this.restoreScrollState(scrollState);
        try {
            const imported = await this.importImageFile(file);
            const start = typeof selectionStart === 'number' ? selectionStart : editor.selectionStart;
            const end = typeof selectionEnd === 'number' ? selectionEnd : editor.selectionEnd;
            const before = start > 0 && editor.value[start - 1] !== '\n' ? '\n' : '';
            const after = end < editor.value.length && editor.value[end] !== '\n' ? '\n' : '';
            const markdown = `${before}![${imported.alt}](<${imported.reference}>)${after}`;
            editor.setRangeText(markdown, start, end, 'end');
            cell.source = sourceLines(editor.value);
            this.setDirty();
            fitTextarea(editor);
            if (options.focusEditor !== false) editor.focus({ preventScroll: true });
            restoreScroll();
            window.requestAnimationFrame(restoreScroll);
            new Notice(`图片已插入：${imported.targetPath}`);
        } catch (error) {
            console.error('Jupyter Editor image import error:', error);
            new Notice(`图片插入失败：${error.message}`);
        }
    }

    visibleMarkdownCellIndex() {
        const content = this.containerEl.children[1];
        const viewport = (content.querySelector('.je-scroll-area') || content).getBoundingClientRect();
        if (Number.isInteger(this.selectedCellIndex)) {
            const selected = this.document.notebook.cells[this.selectedCellIndex];
            const selectedElement = this.containerEl.querySelector(
                `.je-markdown[data-cell-index="${this.selectedCellIndex}"]`,
            );
            const selectedRect = selectedElement?.getBoundingClientRect();
            if (selected?.cell_type === 'markdown'
                && selectedRect
                && selectedRect.bottom >= viewport.top
                && selectedRect.top <= viewport.bottom) {
                return this.selectedCellIndex;
            }
        }
        const center = (viewport.top + viewport.bottom) / 2;
        const candidates = [...this.containerEl.querySelectorAll('.je-markdown[data-cell-index]')]
            .map((element) => ({
                index: Number(element.dataset.cellIndex),
                distance: Math.abs((element.getBoundingClientRect().top + element.getBoundingClientRect().bottom) / 2 - center),
            }))
            .filter((item) => Number.isInteger(item.index))
            .sort((left, right) => left.distance - right.distance);
        return candidates.length ? candidates[0].index : null;
    }

    openToolbarImagePicker(picker) {
        const active = this.activeInlineEditor;
        const scrollState = this.captureScrollState();
        if (active?.type === 'markdown') {
            this.pendingToolbarImage = {
                mode: 'editor',
                index: active.index,
                editor: active.editor,
                selectionStart: active.editor.selectionStart,
                selectionEnd: active.editor.selectionEnd,
                scrollState,
            };
        } else {
            const index = this.visibleMarkdownCellIndex();
            if (!Number.isInteger(index)) {
                new Notice('当前 Notebook 中没有可插入图片的 Markdown 单元格');
                return;
            }
            this.pendingToolbarImage = { mode: 'cell', index, scrollState };
        }
        this.imageDialogOpen = true;
        const restore = () => window.setTimeout(() => {
            this.imageDialogOpen = false;
            this.restoreScrollState(scrollState);
        }, 100);
        window.addEventListener('focus', restore, { once: true });
        this.launchImagePicker(picker);
    }

    launchImagePicker(picker) {
        try {
            if (typeof picker.showPicker === 'function') {
                picker.showPicker();
                return;
            }
        } catch (_error) {
            // Fall back to click() for Electron versions without showPicker support.
        }
        picker.click();
    }

    async handleToolbarImage(file) {
        const pending = this.pendingToolbarImage;
        this.pendingToolbarImage = null;
        if (!pending) return;
        const cell = this.document.notebook.cells[pending.index];
        if (!cell || cell.cell_type !== 'markdown') return;
        if (pending.mode === 'editor' && pending.editor?.isConnected) {
            await this.insertImageIntoEditor(
                pending.editor,
                cell,
                file,
                pending.selectionStart,
                pending.selectionEnd,
                { scrollState: pending.scrollState, focusEditor: false },
            );
            this.restoreScrollState(pending.scrollState);
            window.requestAnimationFrame(() => this.restoreScrollState(pending.scrollState));
            return;
        }
        try {
            const imported = await this.importImageFile(file);
            const current = sourceText(cell.source);
            const separator = current && !current.endsWith('\n\n') ? (current.endsWith('\n') ? '\n' : '\n\n') : '';
            cell.source = sourceLines(`${current}${separator}![${imported.alt}](<${imported.reference}>)\n`);
            this.setDirty();
            await this.refreshCell(pending.index);
            this.restoreScrollState(pending.scrollState);
            window.requestAnimationFrame(() => this.restoreScrollState(pending.scrollState));
            new Notice(`图片已插入到 Markdown 单元格 ${pending.index + 1}`);
        } catch (error) {
            console.error('Jupyter Editor toolbar image import error:', error);
            this.restoreScrollState(pending.scrollState);
            new Notice(`图片插入失败：${error.message}`);
        }
    }

    openInlineEditor(wrap, cell, index, type) {
        if (this.activeInlineEditor) this.activeInlineEditor.commit();
        const original = sourceText(cell.source);
        const source = original;
        const wasDirtyBeforeEdit = this.document.dirty;
        wrap.empty();
        wrap.className = `je-inline-cell-editor is-${type}`;
        const header = wrap.createDiv({ cls: 'je-inline-editor-header' });
        header.createSpan({ text: type === 'markdown' ? `Markdown 单元格 ${index + 1}` : `Python 单元格 ${index + 1}` });
        header.createSpan({ cls: 'je-inline-editor-hint', text: 'Ctrl+Enter 完成 · Esc 取消' });
        const actions = header.createDiv({ cls: 'je-inline-editor-actions' });
        const insertImage = type === 'markdown'
            ? actions.createEl('button', { text: '插入图片', attr: { title: '选择图片，或直接在编辑框中粘贴截图' } })
            : null;
        const done = actions.createEl('button', { cls: 'mod-cta', text: '完成' });
        const cancel = actions.createEl('button', { text: '取消' });
        const editor = wrap.createEl('textarea', {
            cls: type === 'code' ? 'je-inline-editor-source is-code' : 'je-inline-editor-source',
            attr: { spellcheck: type === 'markdown' ? 'true' : 'false' },
        });
        editor.value = source;
        if (insertImage) {
            insertImage.addEventListener('click', () => {
                if (this.toolbarImagePicker) this.openToolbarImagePicker(this.toolbarImagePicker);
            });
            editor.addEventListener('paste', (event) => {
                const items = [...(event.clipboardData?.items || [])];
                const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
                const file = imageItem?.getAsFile();
                if (!file) return;
                event.preventDefault();
                void this.insertImageIntoEditor(editor, cell, file, editor.selectionStart, editor.selectionEnd);
            });
        }

        let settled = false;
        const close = (saveChanges) => {
            if (settled) return;
            settled = true;
            if (!saveChanges) {
                cell.source = sourceLines(original);
                if (!wasDirtyBeforeEdit) this.document.dirty = false;
            }
            this.activeInlineEditor = null;
            this.syncDirtyUI();
            void this.refreshCell(index);
        };
        const commit = () => close(true);
        const discard = () => close(false);
        this.activeInlineEditor = { commit, discard, index, type, editor };
        done.addEventListener('click', commit);
        cancel.addEventListener('click', discard);
        editor.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                commit();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                discard();
                return;
            }
            if (type === 'code' && event.key === 'Tab') {
                event.preventDefault();
                const start = editor.selectionStart;
                const end = editor.selectionEnd;
                editor.setRangeText('    ', start, end, 'end');
                fitTextarea(editor);
            }
        });
        wrap.addEventListener('focusout', (event) => {
            const nextTarget = event.relatedTarget;
            const toolbar = this.containerEl.querySelector('.je-toolbar');
            if (nextTarget && toolbar?.contains(nextTarget)) return;
            window.setTimeout(() => {
                const activeElement = document.activeElement;
                const interactingWithToolbar = activeElement && toolbar?.contains(activeElement);
                if (!settled
                    && !this.imageDialogOpen
                    && !interactingWithToolbar
                    && !wrap.contains(activeElement)) {
                    commit();
                }
            }, 0);
        });
        editor.addEventListener('input', () => {
            cell.source = sourceLines(editor.value);
            if (editor.value !== original) this.setDirty();
            fitTextarea(editor);
        });
        window.setTimeout(() => {
            fitTextarea(editor);
            editor.focus();
        }, 0);
    }

    paintInsertBar(host) {
        const bar = host.createDiv({ cls: 'je-insert-bar' });
        const markdown = bar.createEl('button', { text: '+ Markdown 单元格' });
        const code = bar.createEl('button', { text: '+ Code 单元格' });
        markdown.addEventListener('click', () => this.addCell('markdown'));
        code.addEventListener('click', () => this.addCell('code'));
    }

    addCell(type) {
        this.document.addCell(type);
        this.setDirty();
        void this.paint({ preserveScroll: true });
    }

    move(index, offset) {
        if (!this.document.moveCell(index, offset)) return;
        this.setDirty();
        void this.paint();
    }

    async changePythonEnvironment(pythonPath) {
        if (!pythonPath || pythonPath === this.plugin.settings.pythonPath) return;
        if (this.kernel.isRunning()) await this.kernel.stop(true);
        await this.plugin.setPythonPath(pythonPath);
        new Notice(`已选择 Python 环境：${environmentName(pythonPath)}`);
        await this.paint();
    }

    async startKernel() {
        try {
            await this.kernel.start(this.plugin.settings.pythonPath, this.getWorkingDirectory());
            new Notice(`Jupyter 内核已启动：${environmentName(this.plugin.settings.pythonPath)}`);
        } catch (error) {
            console.error('Jupyter Editor kernel start error:', error);
            new Notice(`Jupyter 内核启动失败：${error.message}`);
        }
    }

    applyKernelOutput(cell, message) {
        const content = message.content || {};
        if (message.msg_type === 'clear_output') {
            cell.outputs = [];
            return;
        }
        if (message.msg_type === 'stream') {
            const previous = cell.outputs[cell.outputs.length - 1];
            if (previous && previous.output_type === 'stream' && previous.name === content.name) {
                previous.text = joined(previous.text) + joined(content.text);
            } else {
                cell.outputs.push({ output_type: 'stream', name: content.name || 'stdout', text: content.text || '' });
            }
            return;
        }
        if (message.msg_type === 'execute_result') {
            cell.outputs.push({
                output_type: 'execute_result',
                data: content.data || {},
                metadata: content.metadata || {},
                execution_count: content.execution_count ?? null,
            });
            return;
        }
        if (message.msg_type === 'display_data' || message.msg_type === 'update_display_data') {
            cell.outputs.push({
                output_type: 'display_data',
                data: content.data || {},
                metadata: content.metadata || {},
            });
            return;
        }
        if (message.msg_type === 'error') {
            cell.outputs.push({
                output_type: 'error',
                ename: content.ename || 'Error',
                evalue: content.evalue || '',
                traceback: content.traceback || [],
            });
        }
    }

    async executeCell(index) {
        const cell = this.document.notebook.cells[index];
        if (!cell || cell.cell_type !== 'code') return;
        if (!sourceText(cell.source).trim()) {
            new Notice('当前代码单元格为空');
            return;
        }
        const startedAt = performance.now();
        this.cellRunStates.set(index, { state: 'running', elapsed: 0 });
        try {
            await this.kernel.start(this.plugin.settings.pythonPath, this.getWorkingDirectory());
            this.runningCellIndex = index;
            cell.outputs = [];
            cell.execution_count = null;
            this.updateRunningCellUI(index);
            const execution = this.kernel.execute(sourceText(cell.source), (message) => {
                this.applyKernelOutput(cell, message);
            });
            this.onKernelStateChanged('busy', `单元格 ${index + 1}`);
            const result = await execution;
            cell.execution_count = result.execution_count ?? cell.execution_count;
            const elapsed = (performance.now() - startedAt) / 1000;
            this.cellRunStates.set(index, {
                state: result.status === 'ok' ? 'completed' : (result.status === 'abort' ? 'interrupted' : 'error'),
                elapsed,
            });
        } catch (error) {
            cell.outputs = cell.outputs || [];
            cell.outputs.push({
                output_type: 'error',
                ename: 'KernelError',
                evalue: error.message,
                traceback: [],
            });
            this.cellRunStates.set(index, {
                state: 'error',
                elapsed: (performance.now() - startedAt) / 1000,
            });
            console.error('Jupyter Editor execution error:', error);
            new Notice(`代码执行失败：${error.message}`);
        } finally {
            this.runningCellIndex = null;
            this.setDirty();
            await this.refreshCell(index);
        }
    }

    async executeAllCells() {
        if (this.runningAll || !this.document) return;
        const codeIndexes = this.document.notebook.cells
            .map((cell, index) => (cell.cell_type === 'code' && sourceText(cell.source).trim() ? index : -1))
            .filter((index) => index >= 0);
        if (!codeIndexes.length) {
            new Notice('当前 Notebook 没有可运行的 Code 单元格');
            return;
        }
        this.runningAll = true;
        this.onKernelStateChanged(this.kernel.state, `准备运行 ${codeIndexes.length} 个单元格`);
        try {
            for (const index of codeIndexes) {
                await this.executeCell(index);
            }
            new Notice(`已完成运行 ${codeIndexes.length} 个 Code 单元格`);
        } finally {
            this.runningAll = false;
            this.onKernelStateChanged(this.kernel.state);
        }
    }

    async save() {
        if (!this.document || !this.file || !this.document.dirty) return;
        try {
            const serialized = this.document.serialize();
            await this.app.vault.modify(this.file, serialized);
            this.document.raw = serialized;
            this.document.dirty = false;
            await this.plugin.refreshCatalog();
            await this.paint();
            new Notice(`Notebook 已保存：${this.file.name}`);
        } catch (error) {
            console.error('Jupyter Editor save error:', error);
            new Notice(`Notebook 保存失败：${error.message}`);
        }
    }

    async reload() {
        if (!this.file) return;
        if (this.document.dirty && !window.confirm('重载会丢弃尚未保存的修改，是否继续？')) return;
        try {
            this.document = NotebookDocument.parse(await this.app.vault.read(this.file));
            await this.paint();
            new Notice(`Notebook 已重新载入：${this.file.name}`);
        } catch (error) {
            this.showFailure(error);
        }
    }
}

class JupyterEditorSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Jupyter Editor' });
        containerEl.createEl('p', {
            text: '选择用于启动 ipykernel 的本机 Python 虚拟环境。环境中必须安装 ipykernel 与 jupyter_client。',
        });

        new Setting(containerEl)
            .setName('Python 虚拟环境')
            .setDesc('插件已发现且能够启动 Jupyter 内核的环境。')
            .addDropdown((dropdown) => {
                const available = this.plugin.environments.filter((item) => item.available);
                for (const item of available) {
                    dropdown.addOption(item.path, `${item.name} · Python ${item.pythonVersion}`);
                }
                if (this.plugin.settings.pythonPath && !available.some((item) => item.path === this.plugin.settings.pythonPath)) {
                    dropdown.addOption(this.plugin.settings.pythonPath, `自定义 · ${this.plugin.settings.pythonPath}`);
                }
                dropdown.setValue(this.plugin.settings.pythonPath);
                dropdown.onChange(async (value) => {
                    await this.plugin.setPythonPath(value);
                    new Notice(`Jupyter Python 环境已更新：${environmentName(value)}`);
                });
            });

        new Setting(containerEl)
            .setName('自定义 Python 路径')
            .setDesc('例如 /home/user/miniconda3/envs/project/bin/python')
            .addText((text) => {
                text.setPlaceholder('/path/to/environment/bin/python');
                text.setValue(this.plugin.settings.pythonPath);
                text.onChange((value) => {
                    this.customPythonPath = value.trim();
                });
            })
            .addButton((button) => {
                button.setButtonText('验证并使用');
                button.onClick(async () => {
                    const candidate = this.customPythonPath || this.plugin.settings.pythonPath;
                    const inspection = inspectPython(candidate);
                    if (!inspection.available) {
                        new Notice(`Python 环境不可用：${inspection.reason}`);
                        return;
                    }
                    await this.plugin.setPythonPath(candidate);
                    await this.plugin.rescanEnvironments();
                    new Notice(`环境验证通过：Python ${inspection.pythonVersion}`);
                    this.display();
                });
            });

        new Setting(containerEl)
            .setName('重新扫描环境')
            .setDesc('扫描 Conda、.venv、venv 与系统 Python。')
            .addButton((button) => {
                button.setButtonText('立即扫描');
                button.onClick(async () => {
                    await this.plugin.rescanEnvironments();
                    new Notice(`发现 ${this.plugin.environments.filter((item) => item.available).length} 个可用内核环境`);
                    this.display();
                });
            });

        const unavailable = this.plugin.environments.filter((item) => !item.available);
        if (unavailable.length) {
            containerEl.createEl('h3', { text: '检测到但暂不可用的环境' });
            const list = containerEl.createEl('ul');
            for (const item of unavailable) {
                list.createEl('li', { text: `${item.name}：${item.reason}` });
            }
        }
    }
}

class JupyterEditorPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        await this.rescanEnvironments();
        if (!inspectPython(this.settings.pythonPath).available) {
            const fallback = this.environments.find((item) => item.available);
            if (fallback) await this.setPythonPath(fallback.path);
        }
        this.referenceCatalog = new Map();
        this.catalogPromise = null;
        this.registerView(VIEW_TYPE, (leaf) => new JupyterEditorView(leaf, this));
        this.registerExtensions(['ipynb'], VIEW_TYPE);
        this.catalogPromise = this.refreshCatalog();
        this.addSettingTab(new JupyterEditorSettingTab(this.app, this));

        this.addCommand({
            id: 'toggle-edit-preview',
            name: '切换 Notebook 编辑/预览模式',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(JupyterEditorView);
                if (!view) return false;
                if (!checking) {
                    view.mode = view.mode === 'edit' ? 'preview' : 'edit';
                    void view.paint();
                }
                return true;
            },
        });

        this.addCommand({
            id: 'save-notebook',
            name: '保存当前 Notebook',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(JupyterEditorView);
                if (!view) return false;
                if (!checking) void view.save();
                return true;
            },
        });

        this.addCommand({
            id: 'start-kernel',
            name: '启动当前 Notebook 的 Jupyter 内核',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(JupyterEditorView);
                if (!view) return false;
                if (!checking) void view.startKernel();
                return true;
            },
        });

        this.addCommand({
            id: 'restart-kernel',
            name: '重启当前 Notebook 的 Jupyter 内核',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(JupyterEditorView);
                if (!view) return false;
                if (!checking) {
                    void view.kernel.restart(this.settings.pythonPath, view.getWorkingDirectory());
                }
                return true;
            },
        });

        this.addCommand({
            id: 'interrupt-kernel',
            name: '中断当前 Notebook 的代码执行',
            checkCallback: (checking) => {
                const view = this.app.workspace.getActiveViewOfType(JupyterEditorView);
                if (!view || view.kernel.state !== 'busy') return false;
                if (!checking) view.kernel.interrupt();
                return true;
            },
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async setPythonPath(pythonPath) {
        this.settings.pythonPath = pythonPath;
        await this.saveData(this.settings);
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            if (!(leaf.view instanceof JupyterEditorView)) continue;
            if (leaf.view.kernel.isRunning()) await leaf.view.kernel.stop(true);
            await leaf.view.paint();
        }
    }

    discoverCondaEnvironments(candidates) {
        const home = os.homedir();
        const condaCandidates = process.platform === 'win32'
            ? [
                path.join(home, 'miniconda3', 'Scripts', 'conda.exe'),
                path.join(home, 'anaconda3', 'Scripts', 'conda.exe'),
            ]
            : [
                path.join(home, 'miniconda3', 'bin', 'conda'),
                path.join(home, 'anaconda3', 'bin', 'conda'),
            ];
        for (const conda of condaCandidates) {
            if (!fs.existsSync(conda)) continue;
            const result = childProcess.spawnSync(conda, ['env', 'list', '--json'], {
                encoding: 'utf8',
                timeout: 10000,
                windowsHide: true,
            });
            if (result.status !== 0) continue;
            try {
                const data = JSON.parse(result.stdout);
                for (const environment of data.envs || []) candidates.add(pythonExecutable(environment));
            } catch (_error) {
                // Ignore malformed output and continue with other discovery paths.
            }
        }
    }

    async rescanEnvironments() {
        const candidates = new Set();
        if (this.settings.pythonPath) candidates.add(this.settings.pythonPath);
        this.discoverCondaEnvironments(candidates);
        const adapter = this.app.vault.adapter;
        const vaultBase = adapter.getBasePath();
        candidates.add(pythonExecutable(path.join(vaultBase, '.venv')));
        candidates.add(pythonExecutable(path.join(vaultBase, 'venv')));
        const systemPython = childProcess.spawnSync(
            process.platform === 'win32' ? 'where' : 'which',
            [process.platform === 'win32' ? 'python' : 'python3'],
            { encoding: 'utf8', timeout: 5000, windowsHide: true },
        );
        if (systemPython.status === 0) {
            const first = systemPython.stdout.trim().split(/\r?\n/)[0];
            if (first) candidates.add(first);
        }

        this.environments = [...candidates]
            .filter(Boolean)
            .map((candidate) => ({
                path: candidate,
                name: environmentName(candidate),
                ...inspectPython(candidate),
            }))
            .sort((left, right) => {
                if (left.available !== right.available) return left.available ? -1 : 1;
                return left.name.localeCompare(right.name, 'zh-CN');
            });
        return this.environments;
    }

    async ensureCatalog() {
        if (this.catalogPromise) await this.catalogPromise;
    }

    async refreshCatalog() {
        const catalog = new Map();
        const files = this.app.vault.getFiles().filter((file) => file.extension === 'ipynb');
        for (const file of files) {
            try {
                const notebook = JSON.parse(await this.app.vault.cachedRead(file));
                let currentHeading = '';
                for (const cell of notebook.cells || []) {
                    if (cell.cell_type !== 'markdown') continue;
                    const markdown = sourceText(cell.source);
                    currentHeading = headingFromMarkdown(markdown) || currentHeading;
                    for (const match of markdown.matchAll(/:(eqlabel|label):`([^`]+)`/g)) {
                        const id = match[2];
                        catalog.set(id, {
                            kind: match[1] === 'eqlabel' ? 'equation' : labelKind(id),
                            path: file.path,
                            title: KNOWN_REFERENCES.get(id) || currentHeading || prettifyId(id),
                        });
                    }
                }
            } catch (error) {
                console.warn(`Jupyter Editor skipped ${file.path}:`, error);
            }
        }
        this.referenceCatalog = catalog;
        return catalog;
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    }
}

// Expose pure helpers for local validation without changing the Obsidian API.
JupyterEditorPlugin.__test = {
    D2LReferenceCompiler,
    KernelSession,
    NotebookDocument,
    headingFromMarkdown,
    sourceLines,
    sourceText,
};

module.exports = JupyterEditorPlugin;

const { Plugin, ItemView, Notice, TFile, Modal, setIcon } = require('obsidian');

const VIEW_TYPE = 'sanz-knowledge-tree-view';

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function sameDay(timestamp, date) {
  const value = new Date(timestamp);
  return value.getFullYear() === date.getFullYear()
    && value.getMonth() === date.getMonth()
    && value.getDate() === date.getDate();
}

function cleanExcerpt(text) {
  return text
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[#>*_`\[\]()|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function formatDateKey(date) {
  return date.getFullYear() + '-'
    + String(date.getMonth() + 1).padStart(2, '0') + '-'
    + String(date.getDate()).padStart(2, '0');
}

class CalendarEventModal extends Modal {
  constructor(app, date, value, onSave) {
    super(app);
    this.date = date;
    this.value = value || '';
    this.onSave = onSave;
  }

  onOpen() {
    this.modalEl.classList.add('sanz-calendar-modal');
    this.contentEl.empty();
    this.contentEl.appendChild(makeEl('span', 'sanz-modal-kicker', 'IMPORTANT DATE'));
    this.contentEl.appendChild(makeEl('h2', '', formatDateKey(this.date) + ' 日程标注'));
    this.contentEl.appendChild(makeEl('p', 'sanz-modal-help', '记录截止日期、里程碑、纪念日或需要提前准备的事项。'));
    const input = makeEl('textarea', 'sanz-event-input');
    input.placeholder = '例如：嵌入式项目阶段验收';
    input.value = this.value;
    this.contentEl.appendChild(input);
    const actions = makeEl('div', 'sanz-modal-actions');
    if (this.value) {
      const removeButton = makeEl('button', 'sanz-modal-remove', '删除标注');
      removeButton.addEventListener('click', () => {
        this.onSave('');
        this.close();
      });
      actions.appendChild(removeButton);
    }
    const cancelButton = makeEl('button', '', '取消');
    cancelButton.addEventListener('click', () => this.close());
    const saveButton = makeEl('button', 'mod-cta', '保存标注');
    saveButton.addEventListener('click', () => {
      this.onSave(input.value.trim());
      this.close();
    });
    actions.appendChild(cancelButton);
    actions.appendChild(saveButton);
    this.contentEl.appendChild(actions);
    window.setTimeout(() => input.focus(), 30);
  }
}

class SanzKnowledgeTreeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedPath = '';
    this.queueMode = 'all';
    this.searchQuery = '';
    this.renderTimer = null;
    this.treeMotionFrame = null;
    this.galaxyParticleFrame = null;
    this.treeResizeObserver = null;
    this.memoSaveTimer = null;
    this.calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    this.treeNodePositions = plugin.settings.treeNodePositions;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return 'Sanz 的知识树';
  }

  getIcon() {
    return 'network';
  }

  async onOpen() {
    this.registerEvent(this.app.vault.on('create', () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on('modify', () => this.scheduleRender()));
    await this.renderDashboard();
  }

  onClose() {
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    if (this.treeMotionFrame) window.cancelAnimationFrame(this.treeMotionFrame);
    if (this.galaxyParticleFrame) window.cancelAnimationFrame(this.galaxyParticleFrame);
    if (this.treeResizeObserver) this.treeResizeObserver.disconnect();
    if (this.memoSaveTimer) window.clearTimeout(this.memoSaveTimer);
  }

  scheduleRender() {
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.renderDashboard(), 350);
  }

  getCategory(path) {
    if (path.includes('01-嵌入式')) return '嵌入式';
    if (path.includes('02-具身智能')) return '具身智能';
    if (path.includes('03-Agent开发')) return 'Agent 开发';
    if (path.includes('故障检测维修')) return '故障维修';
    if (path.includes('00-收件箱')) return '收件箱';
    return '知识库';
  }

  getTaskStats(files) {
    let total = 0;
    let done = 0;
    const byTrack = {};
    files.forEach((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const items = cache && cache.listItems ? cache.listItems : [];
      items.forEach((item) => {
        if (item.task === undefined) return;
        total += 1;
        if (String(item.task).trim().toLowerCase() === 'x') done += 1;
        const category = this.getCategory(file.path);
        if (!byTrack[category]) byTrack[category] = { total: 0, done: 0 };
        byTrack[category].total += 1;
        if (String(item.task).trim().toLowerCase() === 'x') byTrack[category].done += 1;
      });
    });
    return { total: total, done: done, open: total - done, byTrack: byTrack };
  }

  getProgress(taskStats, category) {
    const group = taskStats.byTrack[category] || { total: 0, done: 0 };
    if (!group.total) return 0;
    return Math.round((group.done / group.total) * 100);
  }

  async collectData() {
    const files = this.app.vault.getMarkdownFiles();
    const now = new Date();
    const recent = files.slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
    const today = files.filter((file) => sameDay(file.stat.mtime, now));
    const inbox = files.filter((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const status = cache && cache.frontmatter ? cache.frontmatter.status : '';
      return file.path.includes('00-收件箱') || status === 'inbox';
    });
    const fault = files.filter((file) => file.path.includes('故障检测维修'));
    const taskStats = this.getTaskStats(files);
    return { files: files, recent: recent, today: today, inbox: inbox, fault: fault, taskStats: taskStats };
  }

  addIconButton(parent, icon, label, onClick, primary) {
    const button = makeEl('button', primary ? 'sanz-icon-button is-primary' : 'sanz-icon-button');
    const iconWrap = makeEl('span', 'sanz-button-icon');
    setIcon(iconWrap, icon);
    button.appendChild(iconWrap);
    if (label) button.appendChild(makeEl('span', '', label));
    this.wireFeedback(button, label || '操作');
    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  }

  addNavItem(parent, icon, label, onClick, active) {
    const item = makeEl('button', active ? 'sanz-nav-item is-active' : 'sanz-nav-item');
    const iconWrap = makeEl('span', 'sanz-nav-icon');
    setIcon(iconWrap, icon);
    item.appendChild(iconWrap);
    item.appendChild(makeEl('span', '', label));
    this.wireFeedback(item, label);
    item.addEventListener('click', () => {
      parent.querySelectorAll('.sanz-nav-item').forEach((navItem) => navItem.classList.remove('is-active'));
      item.classList.add('is-active');
      onClick();
    });
    parent.appendChild(item);
  }

  wireFeedback(element, label) {
    if (label) {
      element.setAttribute('aria-label', label);
      element.setAttribute('title', label);
    }
    element.addEventListener('pointerenter', () => element.classList.add('is-hovered'));
    element.addEventListener('pointerleave', () => {
      element.classList.remove('is-hovered');
      element.classList.remove('is-pressed');
    });
    element.addEventListener('pointerdown', (event) => {
      element.classList.add('is-pressed');
      const rect = element.getBoundingClientRect();
      const ripple = makeEl('span', 'sanz-ripple');
      ripple.style.left = (event.clientX - rect.left) + 'px';
      ripple.style.top = (event.clientY - rect.top) + 'px';
      element.appendChild(ripple);
      window.setTimeout(() => ripple.remove(), 520);
    });
    element.addEventListener('pointerup', () => element.classList.remove('is-pressed'));
    element.addEventListener('pointercancel', () => element.classList.remove('is-pressed'));
  }

  wireTreeNodeDrag(node, tree, key) {
    const savedPosition = this.treeNodePositions[key];
    let dragState = null;
    const getBounds = () => {
      const treeRect = tree.getBoundingClientRect();
      const horizontalMargin = Math.min(38, Math.max(0, (treeRect.width - node.offsetWidth) / 2));
      const topMargin = Math.min(88, Math.max(0, (treeRect.height - node.offsetHeight) / 3));
      const bottomReserve = Math.min(128, Math.max(0, (treeRect.height - node.offsetHeight) / 3));
      return {
        minLeft: horizontalMargin,
        maxLeft: Math.max(horizontalMargin, treeRect.width - node.offsetWidth - horizontalMargin),
        minTop: topMargin,
        maxTop: Math.max(topMargin, treeRect.height - node.offsetHeight - bottomReserve)
      };
    };
    const clampPosition = (left, top) => {
      const bounds = getBounds();
      const clampAxis = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
      return {
        left: clampAxis(left, bounds.minLeft, bounds.maxLeft),
        top: clampAxis(top, bounds.minTop, bounds.maxTop)
      };
    };
    const defaultPositions = {
      embedded: { x: 0.08, y: 0.52 },
      embodied: { x: 0.82, y: 0.16 },
      agent: { x: 0.82, y: 0.68 }
    };
    window.requestAnimationFrame(() => {
      if (!tree.isConnected) return;
      const bounds = getBounds();
      const normalized = savedPosition
        && Number.isFinite(savedPosition.x)
        && Number.isFinite(savedPosition.y)
        ? savedPosition
        : defaultPositions[key];
      const safe = clampPosition(
        bounds.minLeft + (bounds.maxLeft - bounds.minLeft) * normalized.x,
        bounds.minTop + (bounds.maxTop - bounds.minTop) * normalized.y
      );
      node.style.left = safe.left + 'px';
      node.style.top = safe.top + 'px';
      node.style.right = 'auto';
      node.style.bottom = 'auto';
    });

    const finishDrag = (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const wasDragged = dragState.dragged;
      dragState = null;
      node.classList.remove('is-dragging');
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      if (wasDragged) {
        const bounds = getBounds();
        const left = parseFloat(node.style.left) || bounds.minLeft;
        const top = parseFloat(node.style.top) || bounds.minTop;
        this.treeNodePositions[key] = {
          x: bounds.maxLeft === bounds.minLeft ? 0.5 : (left - bounds.minLeft) / (bounds.maxLeft - bounds.minLeft),
          y: bounds.maxTop === bounds.minTop ? 0.5 : (top - bounds.minTop) / (bounds.maxTop - bounds.minTop)
        };
        this.plugin.saveTreeNodePosition(key, this.treeNodePositions[key]);
        node.dataset.suppressClick = 'true';
        window.setTimeout(() => delete node.dataset.suppressClick, 0);
      }
    };

    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const treeRect = tree.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        grabRatioX: nodeRect.width ? (event.clientX - nodeRect.left) / nodeRect.width : 0.5,
        grabRatioY: nodeRect.height ? (event.clientY - nodeRect.top) / nodeRect.height : 0.5,
        initialLeft: nodeRect.left - treeRect.left,
        initialTop: nodeRect.top - treeRect.top,
        dragged: false
      };
      node.setPointerCapture(event.pointerId);
    });

    node.addEventListener('pointermove', (event) => {
      if (!dragState || event.pointerId !== dragState.pointerId) return;
      const treeRect = tree.getBoundingClientRect();
      const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
      if (distance > 5 && !dragState.dragged) {
        dragState.dragged = true;
        node.style.right = 'auto';
        node.style.bottom = 'auto';
        node.classList.add('is-dragging');
        dragState.grabX = dragState.grabRatioX * node.offsetWidth;
        dragState.grabY = dragState.grabRatioY * node.offsetHeight;
      }
      if (!dragState.dragged) return;
      event.preventDefault();
      const safe = clampPosition(
        event.clientX - treeRect.left - dragState.grabX,
        event.clientY - treeRect.top - dragState.grabY
      );
      node.style.left = safe.left + 'px';
      node.style.top = safe.top + 'px';
    });
    node.addEventListener('pointerup', finishDrag);
    node.addEventListener('pointercancel', finishDrag);
    node.addEventListener('click', (event) => {
      if (node.dataset.suppressClick === 'true') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
  }

  startGalaxyParticles(canvas, host) {
    if (this.galaxyParticleFrame) window.cancelAnimationFrame(this.galaxyParticleFrame);
    const context = canvas.getContext('2d');
    if (!context) return;
    let width = 0;
    let height = 0;
    let particles = [];
    let lastFrame = 0;
    const pointer = { x: 0, y: 0 };

    const rebuild = () => {
      width = Math.max(1, host.clientWidth);
      height = Math.max(1, host.clientHeight);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(110, Math.min(240, Math.round((width * height) / 2600)));
      particles = Array.from({ length: count }, (_, index) => ({
        x: Math.random() * width,
        y: Math.random() * height,
        depth: 0.18 + Math.random() * 0.82,
        radius: index % 17 === 0 ? 1.7 + Math.random() * 1.2 : 0.35 + Math.random() * 1.05,
        alpha: 0.22 + Math.random() * 0.72,
        speed: 0.025 + Math.random() * 0.12,
        phase: Math.random() * Math.PI * 2,
        tint: Math.random() > 0.72 ? (Math.random() > 0.5 ? '156,205,255' : '213,174,255') : '238,242,255'
      }));
    };

    host.addEventListener('pointermove', (event) => {
      const rect = host.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    });
    host.addEventListener('pointerleave', () => {
      pointer.x = 0;
      pointer.y = 0;
    });

    const draw = (timestamp) => {
      if (!host.isConnected) return;
      if (host.clientWidth !== width || host.clientHeight !== height) rebuild();
      if (timestamp - lastFrame >= 32) {
        lastFrame = timestamp;
        context.clearRect(0, 0, width, height);
        particles.forEach((particle) => {
          particle.y -= particle.speed * particle.depth * 5;
          particle.x += Math.sin(timestamp * 0.00012 + particle.phase) * particle.speed;
          if (particle.y < -4) {
            particle.y = height + 4;
            particle.x = Math.random() * width;
          }
          if (particle.x < -5) particle.x = width + 5;
          if (particle.x > width + 5) particle.x = -5;
          const x = particle.x + pointer.x * particle.depth * 13;
          const y = particle.y + pointer.y * particle.depth * 8;
          const twinkle = 0.58 + Math.sin(timestamp * 0.002 + particle.phase) * 0.42;
          context.beginPath();
          context.fillStyle = 'rgba(' + particle.tint + ',' + (particle.alpha * twinkle) + ')';
          context.shadowColor = 'rgba(' + particle.tint + ',.65)';
          context.shadowBlur = particle.radius > 1.5 ? 9 : 3;
          context.arc(x, y, particle.radius * particle.depth, 0, Math.PI * 2);
          context.fill();
        });
        context.shadowBlur = 0;
      }
      this.galaxyParticleFrame = window.requestAnimationFrame(draw);
    };
    rebuild();
    this.galaxyParticleFrame = window.requestAnimationFrame(draw);
  }

  renderCalendarMonth(container) {
    container.empty();
    const year = this.calendarCursor.getFullYear();
    const month = this.calendarCursor.getMonth();
    const events = this.plugin.settings.calendarEvents;
    const header = makeEl('div', 'sanz-calendar-header');
    const previous = makeEl('button', 'sanz-calendar-nav');
    setIcon(previous, 'chevron-left');
    const title = makeEl('strong', '', year + ' 年 ' + (month + 1) + ' 月');
    const controls = makeEl('div', 'sanz-calendar-controls');
    const todayButton = makeEl('button', 'sanz-calendar-today', '今天');
    const next = makeEl('button', 'sanz-calendar-nav');
    setIcon(next, 'chevron-right');
    controls.appendChild(todayButton);
    controls.appendChild(next);
    header.appendChild(previous);
    header.appendChild(title);
    header.appendChild(controls);
    container.appendChild(header);

    previous.addEventListener('click', () => {
      this.calendarCursor = new Date(year, month - 1, 1);
      this.renderCalendarMonth(container);
    });
    next.addEventListener('click', () => {
      this.calendarCursor = new Date(year, month + 1, 1);
      this.renderCalendarMonth(container);
    });
    todayButton.addEventListener('click', () => {
      const now = new Date();
      this.calendarCursor = new Date(now.getFullYear(), now.getMonth(), 1);
      this.renderCalendarMonth(container);
    });

    const grid = makeEl('div', 'sanz-calendar-grid');
    ['一', '二', '三', '四', '五', '六', '日'].forEach((day) => grid.appendChild(makeEl('span', 'sanz-calendar-weekday', day)));
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - offset);
    const todayKey = formatDateKey(new Date());
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = formatDateKey(date);
      const dayButton = makeEl('button', 'sanz-calendar-day');
      if (date.getMonth() !== month) dayButton.classList.add('is-outside');
      if (key === todayKey) dayButton.classList.add('is-today');
      if (events[key]) dayButton.classList.add('has-event');
      dayButton.appendChild(makeEl('span', '', String(date.getDate())));
      if (events[key]) {
        dayButton.appendChild(makeEl('i', 'sanz-event-dot'));
        dayButton.title = events[key];
      }
      dayButton.addEventListener('click', () => {
        new CalendarEventModal(this.app, date, events[key] || '', (value) => {
          if (value) events[key] = value;
          else delete events[key];
          this.plugin.saveWorkspaceSettings();
          this.calendarCursor = new Date(date.getFullYear(), date.getMonth(), 1);
          this.renderCalendarMonth(container);
          new Notice(value ? '已标注：' + key : '已删除日期标注');
        }).open();
      });
      grid.appendChild(dayButton);
    }
    container.appendChild(grid);
    const upcoming = Object.keys(events)
      .filter((key) => key >= todayKey)
      .sort()
      .slice(0, 3);
    const eventList = makeEl('div', 'sanz-calendar-upcoming');
    eventList.appendChild(makeEl('strong', '', '接下来的重要日期'));
    if (!upcoming.length) eventList.appendChild(makeEl('span', '', '点击日期即可添加标注'));
    upcoming.forEach((key) => {
      const row = makeEl('button', '');
      row.appendChild(makeEl('time', '', key.slice(5).replace('-', '/')));
      row.appendChild(makeEl('span', '', events[key]));
      row.addEventListener('click', () => {
        const parts = key.split('-').map(Number);
        new CalendarEventModal(this.app, new Date(parts[0], parts[1] - 1, parts[2]), events[key], (value) => {
          if (value) events[key] = value;
          else delete events[key];
          this.plugin.saveWorkspaceSettings();
          this.renderCalendarMonth(container);
        }).open();
      });
      eventList.appendChild(row);
    });
    container.appendChild(eventList);
  }

  renderUtilityPanel(parent) {
    const memo = makeEl('section', 'sanz-utility-card sanz-memo-card');
    const memoHead = makeEl('div', 'sanz-utility-head');
    const memoTitle = makeEl('div', '');
    const memoIcon = makeEl('span', 'sanz-utility-icon');
    setIcon(memoIcon, 'notebook-pen');
    memoTitle.appendChild(memoIcon);
    const memoCopy = makeEl('div', '');
    memoCopy.appendChild(makeEl('strong', '', '快速备忘录'));
    memoCopy.appendChild(makeEl('small', '', '随手记录，自动保存'));
    memoTitle.appendChild(memoCopy);
    memoHead.appendChild(memoTitle);
    const saveStatus = makeEl('span', 'sanz-memo-status', '已同步');
    memoHead.appendChild(saveStatus);
    memo.appendChild(memoHead);
    const textarea = makeEl('textarea', 'sanz-memo-input');
    textarea.placeholder = '写下今天不能忘记的事…';
    textarea.value = this.plugin.settings.memo || '';
    memo.appendChild(textarea);
    const memoFoot = makeEl('div', 'sanz-memo-foot');
    const count = makeEl('span', '', textarea.value.length + ' 字');
    const clear = makeEl('button', '', '清空');
    memoFoot.appendChild(count);
    memoFoot.appendChild(clear);
    memo.appendChild(memoFoot);
    textarea.addEventListener('input', () => {
      count.textContent = textarea.value.length + ' 字';
      saveStatus.textContent = '保存中…';
      if (this.memoSaveTimer) window.clearTimeout(this.memoSaveTimer);
      this.memoSaveTimer = window.setTimeout(() => {
        this.plugin.settings.memo = textarea.value;
        this.plugin.saveWorkspaceSettings();
        saveStatus.textContent = '已同步';
      }, 420);
    });
    clear.addEventListener('click', () => {
      textarea.value = '';
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
    });
    parent.appendChild(memo);

    const calendar = makeEl('section', 'sanz-utility-card sanz-calendar-card');
    const calendarHead = makeEl('div', 'sanz-utility-head');
    const calendarTitle = makeEl('div', '');
    const calendarIcon = makeEl('span', 'sanz-utility-icon is-violet');
    setIcon(calendarIcon, 'calendar-days');
    calendarTitle.appendChild(calendarIcon);
    const calendarCopy = makeEl('div', '');
    calendarCopy.appendChild(makeEl('strong', '', '重要日期'));
    calendarCopy.appendChild(makeEl('small', '', '点击任意日期添加标注'));
    calendarTitle.appendChild(calendarCopy);
    calendarHead.appendChild(calendarTitle);
    calendar.appendChild(calendarHead);
    const calendarBody = makeEl('div', 'sanz-calendar-body');
    calendar.appendChild(calendarBody);
    this.renderCalendarMonth(calendarBody);
    parent.appendChild(calendar);
  }

  async openPath(path) {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (abstractFile instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(abstractFile);
      return;
    }
    new Notice('尚未找到：' + path);
  }

  async openGraph() {
    const galaxyPlugin = this.app.plugins
      && this.app.plugins.plugins
      && this.app.plugins.plugins['galaxy-view'];
    const leaf = this.app.workspace.getLeaf(true);
    if (galaxyPlugin) {
      await leaf.setViewState({ type: 'galaxy-view', active: true });
    } else {
      new Notice('Galaxy View 已安装，重启 Obsidian 后即可打开星空图谱。');
      await leaf.setViewState({ type: 'graph', active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async createInboxNote() {
    const folderPath = '00-收件箱';
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
    const now = new Date();
    const stamp = now.getFullYear() + '-'
      + String(now.getMonth() + 1).padStart(2, '0') + '-'
      + String(now.getDate()).padStart(2, '0') + ' '
      + String(now.getHours()).padStart(2, '0') + '-'
      + String(now.getMinutes()).padStart(2, '0');
    const path = folderPath + '/' + stamp + ' 新笔记.md';
    const content = '---\nstatus: inbox\ncreated: ' + now.toISOString() + '\n---\n\n# ' + stamp + ' 新笔记\n\n';
    const file = await this.app.vault.create(path, content);
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  scrollMainTo(id) {
    const target = this.contentEl.querySelector('#' + id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  renderStat(parent, eyebrow, value, label, description, tone, onClick) {
    const card = makeEl('button', 'sanz-stat-card ' + tone);
    card.appendChild(makeEl('div', 'sanz-stat-eyebrow', eyebrow));
    const valueRow = makeEl('div', 'sanz-stat-value-row');
    valueRow.appendChild(makeEl('strong', 'sanz-stat-value', String(value)));
    valueRow.appendChild(makeEl('span', 'sanz-stat-unit', label));
    card.appendChild(valueRow);
    card.appendChild(makeEl('div', 'sanz-stat-description', description));
    card.appendChild(makeEl('div', 'sanz-stat-action', '点击查看 →'));
    this.wireFeedback(card, eyebrow + '：' + value + label + '。' + description + '，点击筛选查看。');
    card.addEventListener('click', onClick);
    parent.appendChild(card);
  }

  renderTrack(parent, title, subtitle, category, path, taskStats, tone) {
    const progress = this.getProgress(taskStats, category);
    const card = makeEl('button', 'sanz-track-card ' + tone);
    const top = makeEl('div', 'sanz-track-top');
    top.appendChild(makeEl('span', 'sanz-track-code', category === '嵌入式' ? 'TRACK 01' : category === '具身智能' ? 'TRACK 02' : 'TRACK 03'));
    top.appendChild(makeEl('span', 'sanz-track-percent', progress + '%'));
    card.appendChild(top);
    card.appendChild(makeEl('strong', 'sanz-track-title', title));
    card.appendChild(makeEl('span', 'sanz-track-subtitle', subtitle));
    const bar = makeEl('div', 'sanz-progress');
    const fill = makeEl('span', '');
    fill.style.width = Math.max(4, progress) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);
    this.wireFeedback(card, '打开' + title + '学习路线');
    card.addEventListener('click', () => this.openPath(path));
    parent.appendChild(card);
    return card;
  }

  renderNoteRows(parent, files, data) {
    const queueMeta = makeEl('div', 'sanz-queue-meta');
    queueMeta.appendChild(makeEl('span', '', '当前队列共 ' + files.length + ' 篇笔记'));
    if (files.length > 8) {
      const scrollHint = makeEl('span', 'sanz-queue-scroll-hint');
      const scrollIcon = makeEl('span', 'sanz-queue-scroll-icon');
      setIcon(scrollIcon, 'mouse');
      scrollHint.appendChild(scrollIcon);
      scrollHint.appendChild(makeEl('span', '', '在队列内滚动查看更多'));
      queueMeta.appendChild(scrollHint);
    }
    parent.appendChild(queueMeta);

    const list = makeEl('div', 'sanz-note-list');
    list.setAttribute('aria-label', '知识队列，共 ' + files.length + ' 篇笔记');
    if (!files.length) {
      list.appendChild(makeEl('div', 'sanz-empty', '这里还没有笔记，点击右上角新建一条。'));
    }
    files.forEach((file, index) => {
      const row = makeEl('button', 'sanz-note-row');
      row.dataset.search = (file.basename + ' ' + file.path + ' ' + this.getCategory(file.path)).toLowerCase();
      const dot = makeEl('span', 'sanz-note-dot dot-' + ((index % 3) + 1));
      const info = makeEl('span', 'sanz-note-info');
      info.appendChild(makeEl('strong', '', file.basename));
      info.appendChild(makeEl('small', '', this.getCategory(file.path) + ' · ' + file.parent.path));
      const time = makeEl('span', 'sanz-note-time', new Date(file.stat.mtime).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }));
      row.appendChild(dot);
      row.appendChild(info);
      row.appendChild(time);
      this.wireFeedback(row, '查看' + file.basename + '的详情，双击打开');
      row.addEventListener('click', () => {
        this.selectedPath = file.path;
        this.renderDetailPanel(data);
        this.contentEl.querySelectorAll('.sanz-note-row').forEach((item) => item.classList.remove('is-selected'));
        row.classList.add('is-selected');
      });
      row.addEventListener('dblclick', () => this.openPath(file.path));
      list.appendChild(row);
    });
    parent.appendChild(list);
  }

  getQueueFiles(data, mode) {
    if (mode && mode.startsWith('track:')) {
      const category = mode.slice(6);
      return data.recent.filter((file) => this.getCategory(file.path) === category);
    }
    if (mode === 'inbox') return data.inbox.slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (mode === 'today') return data.today.slice().sort((a, b) => b.stat.mtime - a.stat.mtime);
    if (mode === 'backlog') {
      return data.recent.filter((file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        const items = cache && cache.listItems ? cache.listItems : [];
        return items.some((item) => item.task !== undefined && String(item.task).trim() === '');
      });
    }
    return data.recent;
  }

  applySearch(query) {
    this.searchQuery = query.trim().toLowerCase();
    this.contentEl.querySelectorAll('.sanz-note-row').forEach((row) => {
      row.style.display = !this.searchQuery || row.dataset.search.includes(this.searchQuery) ? '' : 'none';
    });
  }

  renderSearchResults(container, query, data, input) {
    const normalized = query.trim().toLowerCase();
    container.empty();
    if (!normalized) {
      container.classList.remove('is-open');
      return;
    }

    const matches = data.files
      .filter((file) => {
        const haystack = (file.basename + ' ' + file.path + ' ' + this.getCategory(file.path)).toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 8);

    container.classList.add('is-open');
    container.appendChild(makeEl('div', 'sanz-search-results-head', matches.length ? '找到 ' + matches.length + ' 条结果' : '没有匹配的笔记'));
    matches.forEach((file) => {
      const result = makeEl('button', 'sanz-search-result');
      result.dataset.path = file.path;
      const icon = makeEl('span', 'sanz-search-result-icon');
      setIcon(icon, 'file-text');
      const info = makeEl('span', 'sanz-search-result-info');
      info.appendChild(makeEl('strong', '', file.basename));
      info.appendChild(makeEl('small', '', this.getCategory(file.path) + ' · ' + file.path));
      result.appendChild(icon);
      result.appendChild(info);
      this.wireFeedback(result, '打开笔记：' + file.basename);
      result.addEventListener('click', async () => {
        container.classList.remove('is-open');
        input.value = '';
        this.applySearch('');
        await this.openPath(file.path);
      });
      container.appendChild(result);
    });
  }

  applyQueueMode(data, mode) {
    this.queueMode = mode;
    const slot = this.contentEl.querySelector('.sanz-queue-slot');
    if (!slot) return;
    slot.empty();
    this.renderNoteRows(slot, this.getQueueFiles(data, mode), data);
    this.contentEl.querySelectorAll('.sanz-tabs button').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.mode === mode);
    });
    this.applySearch(this.searchQuery);
  }

  async renderDetailPanel(data) {
    const panel = this.contentEl.querySelector('.sanz-detail-panel');
    if (!panel) return;
    panel.empty();
    let file = data.files.find((item) => item.path === this.selectedPath);
    if (!file) file = data.recent[0];
    if (!file) {
      panel.appendChild(makeEl('div', 'sanz-empty', '暂无可显示的笔记详情。'));
      return;
    }
    this.selectedPath = file.path;
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache && cache.frontmatter ? cache.frontmatter : {};
    const raw = await this.app.vault.cachedRead(file);

    const heading = makeEl('div', 'sanz-detail-heading');
    const titleWrap = makeEl('div', '');
    titleWrap.appendChild(makeEl('span', 'sanz-section-kicker', '✦ 智能详情'));
    titleWrap.appendChild(makeEl('span', 'sanz-detail-id', 'NOTE · ' + file.stat.ctime.toString().slice(-6)));
    heading.appendChild(titleWrap);
    const searchIcon = makeEl('span', 'sanz-detail-search');
    setIcon(searchIcon, 'search');
    heading.appendChild(searchIcon);
    panel.appendChild(heading);

    panel.appendChild(makeEl('span', 'sanz-status-pill', frontmatter.status || '知识节点'));
    panel.appendChild(makeEl('h2', 'sanz-detail-title', file.basename));
    panel.appendChild(makeEl('p', 'sanz-detail-excerpt', cleanExcerpt(raw) || '这条笔记尚未填写摘要。'));

    const meta = makeEl('div', 'sanz-detail-meta');
    const rows = [
      ['所属目录', file.parent.path || '根目录'],
      ['技术领域', this.getCategory(file.path)],
      ['创建时间', new Date(file.stat.ctime).toLocaleString('zh-CN')],
      ['当前状态', frontmatter.status || '生长中']
    ];
    rows.forEach((entry) => {
      const row = makeEl('div', '');
      row.appendChild(makeEl('span', '', entry[0]));
      row.appendChild(makeEl('strong', '', entry[1]));
      meta.appendChild(row);
    });
    panel.appendChild(meta);

    const tags = makeEl('div', 'sanz-tag-list');
    [this.getCategory(file.path), '知识节点', frontmatter.status || '生长中'].forEach((tag) => tags.appendChild(makeEl('span', '', tag)));
    panel.appendChild(tags);

    const suggestion = makeEl('div', 'sanz-suggestion');
    suggestion.appendChild(makeEl('strong', '', 'AI 助手建议'));
    suggestion.appendChild(makeEl('p', '', '补充一个可验证的输出：实验记录、代码片段、架构图或下一步行动。'));
    const suggestionButton = makeEl('button', '', '查看原始笔记');
    this.wireFeedback(suggestionButton, '查看原始笔记');
    suggestionButton.addEventListener('click', () => this.openPath(file.path));
    suggestion.appendChild(suggestionButton);
    panel.appendChild(suggestion);

    const actions = makeEl('div', 'sanz-detail-actions');
    const editButton = makeEl('button', 'sanz-secondary-action', '编辑笔记');
    this.wireFeedback(editButton, '编辑笔记');
    editButton.addEventListener('click', () => this.openPath(file.path));
    const doneButton = makeEl('button', 'sanz-primary-action', '标记已读');
    this.wireFeedback(doneButton, '标记为已读');
    doneButton.addEventListener('click', async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.status = '已读';
        frontmatter.lastRead = new Date().toISOString();
      });
      new Notice('已标记为已读：' + file.basename);
      await this.renderDashboard();
    });
    actions.appendChild(editButton);
    actions.appendChild(doneButton);
    panel.appendChild(actions);
  }

  async renderDashboard() {
    const data = await this.collectData();
    if (this.treeResizeObserver) this.treeResizeObserver.disconnect();
    const root = this.contentEl;
    root.empty();
    root.addClass('sanz-workstation-root');

    const shell = makeEl('div', 'sanz-shell');
    root.appendChild(shell);

    const sidebar = makeEl('aside', 'sanz-sidebar');
    const brand = makeEl('div', 'sanz-brand');
    brand.appendChild(makeEl('span', 'sanz-brand-mark', 'S'));
    const brandText = makeEl('div', '');
    brandText.appendChild(makeEl('strong', '', 'Sanz 的知识树'));
    brandText.appendChild(makeEl('small', '', 'Knowledge OS'));
    brand.appendChild(brandText);
    sidebar.appendChild(brand);

    const nav = makeEl('nav', 'sanz-nav');
    this.addNavItem(nav, 'layout-dashboard', '知识树总览', () => this.scrollMainTo('sanz-overview'), true);
    this.addNavItem(nav, 'files', '全部笔记', () => {
      this.applyQueueMode(data, 'all');
      this.scrollMainTo('sanz-queue');
    });
    this.addNavItem(nav, 'inbox', '未处理事项', () => {
      this.applyQueueMode(data, 'inbox');
      this.scrollMainTo('sanz-queue');
    });
    this.addNavItem(nav, 'calendar-check', '今日计划', () => {
      this.applyQueueMode(data, 'today');
      this.scrollMainTo('sanz-queue');
    });
    this.addNavItem(nav, 'list-checks', '待办任务', () => {
      this.applyQueueMode(data, 'backlog');
      this.scrollMainTo('sanz-queue');
    });
    this.addNavItem(nav, 'file-plus-2', '快速记录', () => this.createInboxNote());
    this.addNavItem(nav, 'cpu', '嵌入式系统', () => this.openPath('01-嵌入式/学习路线.md'));
    this.addNavItem(nav, 'bot', '具身智能', () => this.openPath('02-具身智能/学习路线.md'));
    this.addNavItem(nav, 'sparkles', 'Agent 开发', () => this.openPath('03-Agent开发/学习路线.md'));
    this.addNavItem(nav, 'wrench', '故障检测维修', () => {
      const target = data.fault.slice().sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
      if (target) this.openPath(target.path); else new Notice('暂无故障维修记录');
    });
    this.addNavItem(nav, 'book-open', '系统开发文档', () => this.openPath('05-工作站开发文档/00-文档索引.md'));
    this.addNavItem(nav, 'library', 'Skills 与学习资源', () => this.openPath('06-Skills与学习资源/00-资源索引.md'));
    this.addNavItem(nav, 'calendar-days', '项目日志', () => this.openPath('07-项目日志/00-日志索引.md'));
    this.addNavItem(nav, 'network', '知识图谱', () => this.openGraph());
    sidebar.appendChild(nav);

    const sidebarFoot = makeEl('div', 'sanz-sidebar-foot');
    sidebarFoot.appendChild(makeEl('span', 'sanz-avatar', 'SZ'));
    const profile = makeEl('div', '');
    profile.appendChild(makeEl('strong', '', 'Sanz'));
    profile.appendChild(makeEl('small', '', '知识树维护者'));
    sidebarFoot.appendChild(profile);
    sidebar.appendChild(sidebarFoot);
    shell.appendChild(sidebar);

    const main = makeEl('main', 'sanz-main');
    main.id = 'sanz-overview';
    main.addEventListener('wheel', (event) => {
      if (event.ctrlKey || !event.deltaY) return;
      const eventTarget = event.target instanceof Element ? event.target : null;
      const nestedScroller = eventTarget ? eventTarget.closest('.sanz-search-results, .sanz-memo-input, .sanz-note-list') : null;
      if (nestedScroller && nestedScroller.scrollHeight > nestedScroller.clientHeight) {
        const canScrollUp = nestedScroller.scrollTop > 0;
        const canScrollDown = nestedScroller.scrollTop + nestedScroller.clientHeight < nestedScroller.scrollHeight - 1;
        if ((event.deltaY < 0 && canScrollUp) || (event.deltaY > 0 && canScrollDown)) return;
      }
      const multiplier = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? main.clientHeight : 1;
      const previousTop = main.scrollTop;
      main.scrollTop += event.deltaY * multiplier;
      if (main.scrollTop !== previousTop) event.preventDefault();
    }, { passive: false });
    const header = makeEl('header', 'sanz-header');
    const title = makeEl('div', 'sanz-title');
    title.appendChild(makeEl('span', 'sanz-section-kicker', 'KNOWLEDGE MANAGEMENT'));
    title.appendChild(makeEl('h1', '', 'Sanz 的知识树'));
    title.appendChild(makeEl('p', '', '嵌入式 · 具身智能 · Agent 开发'));
    header.appendChild(title);
    const tools = makeEl('div', 'sanz-tools');
    const search = makeEl('div', 'sanz-search');
    const searchIcon = makeEl('span', '');
    setIcon(searchIcon, 'search');
    const searchInput = makeEl('input', '');
    searchInput.placeholder = '搜索笔记、目录或技术领域…';
    searchInput.setAttribute('aria-label', '搜索整个知识库');
    searchInput.setAttribute('type', 'search');
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('spellcheck', 'false');
    search.appendChild(searchIcon);
    search.appendChild(searchInput);
    const searchResults = makeEl('div', 'sanz-search-results');
    search.appendChild(searchResults);
    tools.appendChild(search);
    this.addIconButton(tools, 'refresh-cw', '', () => this.renderDashboard());
    this.addIconButton(tools, 'plus', '立即记录', () => this.createInboxNote(), true);
    header.appendChild(tools);
    main.appendChild(header);

    const stats = makeEl('section', 'sanz-stats');
    this.renderStat(stats, 'TODAY / 今日更新', data.today.length, '篇笔记', '今天新建或修改过的笔记', 'tone-light', () => {
      this.applyQueueMode(data, 'today');
      this.scrollMainTo('sanz-queue');
    });
    this.renderStat(stats, 'INBOX / 待整理', data.inbox.length, '个节点', '收件箱中尚未分类的内容', 'tone-orange', () => {
      this.applyQueueMode(data, 'inbox');
      this.scrollMainTo('sanz-queue');
    });
    this.renderStat(stats, 'KNOWLEDGE / 全部笔记', data.files.length, '篇笔记', '当前知识库中的 Markdown 笔记', 'tone-blue', () => {
      this.applyQueueMode(data, 'all');
      this.scrollMainTo('sanz-queue');
    });
    this.renderStat(stats, 'TASKS / 未完成', data.taskStats.open, '个任务', '所有尚未勾选完成的任务', 'tone-purple', () => {
      this.applyQueueMode(data, 'backlog');
      this.scrollMainTo('sanz-queue');
    });
    main.appendChild(stats);

    const sectionHead = makeEl('div', 'sanz-section-head');
    sectionHead.id = 'sanz-queue';
    const sectionTitle = makeEl('div', '');
    sectionTitle.appendChild(makeEl('h2', '', '知识队列'));
    sectionTitle.appendChild(makeEl('p', '', '最近更新与等待处理的知识节点'));
    sectionHead.appendChild(sectionTitle);
    const queueTabs = makeEl('div', 'sanz-tabs');
    [
      ['all', '全部笔记'],
      ['inbox', '待整理'],
      ['today', '今日更新'],
      ['backlog', '待办']
    ].forEach((entry) => {
      const tab = makeEl('button', this.queueMode === entry[0] ? 'is-active' : '', entry[1]);
      tab.dataset.mode = entry[0];
      this.wireFeedback(tab, '筛选：' + entry[1]);
      tab.addEventListener('click', () => this.applyQueueMode(data, entry[0]));
      queueTabs.appendChild(tab);
    });
    sectionHead.appendChild(queueTabs);
    main.appendChild(sectionHead);

    const queueSlot = makeEl('div', 'sanz-queue-slot');
    main.appendChild(queueSlot);
    this.renderNoteRows(queueSlot, this.getQueueFiles(data, this.queueMode), data);

    const focusHead = makeEl('div', 'sanz-section-head sanz-focus-head');
    focusHead.id = 'sanz-focus';
    const focusTitle = makeEl('div', '');
    focusTitle.appendChild(makeEl('h2', '', '核心知识星系'));
    focusTitle.appendChild(makeEl('p', '', '三颗技术行星围绕知识中枢生长，单击筛选，拖动重排'));
    focusHead.appendChild(focusTitle);
    const galaxyButton = makeEl('button', 'sanz-galaxy-open');
    const galaxyButtonIcon = makeEl('span', '');
    setIcon(galaxyButtonIcon, 'orbit');
    galaxyButton.appendChild(galaxyButtonIcon);
    galaxyButton.appendChild(makeEl('span', '', '进入 3D 星空图谱'));
    this.wireFeedback(galaxyButton, '打开 Galaxy View 3D 知识图谱');
    galaxyButton.addEventListener('click', () => this.openGraph());
    focusHead.appendChild(galaxyButton);
    main.appendChild(focusHead);

    const focus = makeEl('section', 'sanz-focus');
    const tree = makeEl('div', 'sanz-tree-visual');
    const particleCanvas = makeEl('canvas', 'sanz-galaxy-particles');
    particleCanvas.setAttribute('aria-hidden', 'true');
    tree.appendChild(particleCanvas);
    const galaxyHeading = makeEl('div', 'sanz-galaxy-heading');
    galaxyHeading.appendChild(makeEl('strong', '', 'SANZ KNOWLEDGE GALAXY'));
    galaxyHeading.appendChild(makeEl('small', '', 'Σ 知识星系 · ' + data.files.length + ' 个节点'));
    tree.appendChild(galaxyHeading);
    const galaxyStats = makeEl('div', 'sanz-galaxy-stats');
    [
      ['知识节点', data.files.length],
      ['今日更新', data.today.length],
      ['技术星群', 3]
    ].forEach((entry) => {
      const row = makeEl('div', '');
      row.appendChild(makeEl('span', '', entry[0]));
      row.appendChild(makeEl('strong', '', String(entry[1])));
      galaxyStats.appendChild(row);
    });
    tree.appendChild(galaxyStats);
    tree.appendChild(makeEl('div', 'sanz-tree-grid'));
    tree.appendChild(makeEl('div', 'sanz-tree-orbit orbit-outer'));
    tree.appendChild(makeEl('div', 'sanz-tree-orbit orbit-mid'));
    tree.appendChild(makeEl('div', 'sanz-tree-orbit orbit-inner'));
    const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    links.setAttribute('class', 'sanz-tree-links');
    links.setAttribute('viewBox', '0 0 500 340');
    links.setAttribute('preserveAspectRatio', 'none');
    [
      ['250', '170', '105', '75', 'cyan'],
      ['250', '170', '395', '75', 'violet'],
      ['250', '170', '380', '275', 'green']
    ].forEach((values) => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', values[0]);
      line.setAttribute('y1', values[1]);
      line.setAttribute('x2', values[2]);
      line.setAttribute('y2', values[3]);
      line.setAttribute('class', 'tree-link link-' + values[4]);
      links.appendChild(line);
    });
    tree.appendChild(links);

    const treeCenter = makeEl('button', 'sanz-tree-center');
    treeCenter.appendChild(makeEl('span', 'sanz-core-icon', 'Σ'));
    treeCenter.appendChild(makeEl('strong', '', '知识恒星'));
    treeCenter.appendChild(makeEl('small', '', data.files.length + ' NODES'));
    this.wireFeedback(treeCenter, '显示全部知识节点');
    tree.appendChild(treeCenter);
    const treeStatus = makeEl('div', 'sanz-tree-status');
    treeStatus.appendChild(makeEl('span', 'sanz-status-signal'));
    treeStatus.appendChild(makeEl('span', 'sanz-status-copy', '系统在线 · 点击节点筛选知识'));
    tree.appendChild(treeStatus);

    const trackDefinitions = [
      { key: 'embedded', label: '嵌入式', category: '嵌入式', code: 'EDGE / 01', icon: 'cpu', nodeClass: 'node-1', tone: 'cyan' },
      { key: 'embodied', label: '具身智能', category: '具身智能', code: 'ROBOT / 02', icon: 'bot', nodeClass: 'node-2', tone: 'violet' },
      { key: 'agent', label: 'Agent 开发', category: 'Agent 开发', code: 'COGNITION / 03', icon: 'sparkles', nodeClass: 'node-3', tone: 'green' }
    ];
    const nodeButtons = [];
    trackDefinitions.forEach((definition) => {
      const count = data.files.filter((file) => this.getCategory(file.path) === definition.category).length;
      const node = makeEl('button', 'sanz-tree-node ' + definition.nodeClass + ' tone-' + definition.tone);
      node.dataset.track = definition.key;
      const icon = makeEl('span', 'sanz-node-icon');
      setIcon(icon, definition.icon);
      const copy = makeEl('span', 'sanz-node-copy');
      copy.appendChild(makeEl('small', '', definition.code));
      copy.appendChild(makeEl('strong', '', definition.label));
      copy.appendChild(makeEl('em', '', count + ' 篇笔记'));
      node.appendChild(icon);
      node.appendChild(copy);
      this.wireFeedback(node, '拖动调整' + definition.label + '节点，单击筛选知识');
      this.wireTreeNodeDrag(node, tree, definition.key);
      tree.appendChild(node);
      nodeButtons.push(node);
    });
    if (this.treeMotionFrame) window.cancelAnimationFrame(this.treeMotionFrame);
    let lastLinkSync = 0;
    const syncTreeLinks = (timestamp) => {
      if (!tree.isConnected) return;
      if (timestamp - lastLinkSync > 32) {
        lastLinkSync = timestamp;
        const treeRect = tree.getBoundingClientRect();
        if (!treeRect.width || !treeRect.height) {
          this.treeMotionFrame = window.requestAnimationFrame(syncTreeLinks);
          return;
        }
        const centerRect = treeCenter.getBoundingClientRect();
        const startX = ((centerRect.left + centerRect.width / 2 - treeRect.left) / treeRect.width) * 500;
        const startY = ((centerRect.top + centerRect.height / 2 - treeRect.top) / treeRect.height) * 340;
        nodeButtons.forEach((node, index) => {
          const nodeRect = node.getBoundingClientRect();
          const line = links.children[index];
          line.setAttribute('x1', String(startX));
          line.setAttribute('y1', String(startY));
          line.setAttribute('x2', String(((nodeRect.left + nodeRect.width / 2 - treeRect.left) / treeRect.width) * 500));
          line.setAttribute('y2', String(((nodeRect.top + nodeRect.height / 2 - treeRect.top) / treeRect.height) * 340));
        });
      }
      this.treeMotionFrame = window.requestAnimationFrame(syncTreeLinks);
    };
    this.treeMotionFrame = window.requestAnimationFrame(syncTreeLinks);
    focus.appendChild(tree);
    const tracks = makeEl('div', 'sanz-track-list');
    const trackCards = [
      this.renderTrack(tracks, '嵌入式系统', 'MCU · RTOS · Linux · 驱动', '嵌入式', '01-嵌入式/学习路线.md', data.taskStats, 'track-cyan'),
      this.renderTrack(tracks, '具身智能', 'ROS 2 · 感知 · 控制 · 仿真', '具身智能', '02-具身智能/学习路线.md', data.taskStats, 'track-violet'),
      this.renderTrack(tracks, 'Agent 开发', 'LLM · MCP · RAG · 评测', 'Agent 开发', '03-Agent开发/学习路线.md', data.taskStats, 'track-green')
    ];
    trackCards.forEach((card, index) => { card.dataset.track = trackDefinitions[index].key; });

    const setTreeTrack = (definition, persist) => {
      tree.dataset.activeTrack = definition ? definition.key : '';
      nodeButtons.forEach((node) => node.classList.toggle('is-active', Boolean(definition) && node.dataset.track === definition.key));
      trackCards.forEach((card) => card.classList.toggle('is-linked', Boolean(definition) && card.dataset.track === definition.key));
      if (definition) treeStatus.querySelector('.sanz-status-copy').textContent = definition.label + ' · 数据链路已锁定';
      else treeStatus.querySelector('.sanz-status-copy').textContent = '系统在线 · 点击节点筛选知识';
      if (persist && definition) {
        this.applyQueueMode(data, 'track:' + definition.category);
        new Notice('已筛选：' + definition.label);
      }
    };
    nodeButtons.forEach((node, index) => {
      const definition = trackDefinitions[index];
      node.addEventListener('pointerenter', () => setTreeTrack(definition, false));
      node.addEventListener('focus', () => setTreeTrack(definition, false));
      node.addEventListener('click', () => setTreeTrack(definition, true));
    });
    tree.addEventListener('pointerleave', () => setTreeTrack(null, false));
    treeCenter.addEventListener('click', () => {
      setTreeTrack(null, false);
      this.applyQueueMode(data, 'all');
      new Notice('已显示全部知识节点');
    });
    focus.appendChild(tracks);
    main.appendChild(focus);
    this.startGalaxyParticles(particleCanvas, tree);

    const utilityHead = makeEl('div', 'sanz-section-head sanz-utility-section-head');
    const utilityTitle = makeEl('div', '');
    utilityTitle.appendChild(makeEl('h2', '', '今日控制台'));
    utilityTitle.appendChild(makeEl('p', '', '备忘与重要日期会保存在当前知识库中'));
    utilityHead.appendChild(utilityTitle);
    main.appendChild(utilityHead);
    const utilityPanel = makeEl('div', 'sanz-utility-grid');
    this.renderUtilityPanel(utilityPanel);
    main.appendChild(utilityPanel);

    const footer = makeEl('div', 'sanz-main-footer');
    footer.appendChild(makeEl('span', '', '最后刷新 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
    footer.appendChild(makeEl('span', '', '双击队列中的笔记可直接打开'));
    main.appendChild(footer);
    shell.appendChild(main);
    if (typeof ResizeObserver !== 'undefined') {
      let observedWidth = tree.clientWidth;
      this.treeResizeObserver = new ResizeObserver(() => {
        const nextWidth = tree.clientWidth;
        if (!nextWidth || Math.abs(nextWidth - observedWidth) < 3) return;
        observedWidth = nextWidth;
        this.scheduleRender();
      });
      this.treeResizeObserver.observe(tree);
    }

    const detail = makeEl('aside', 'sanz-detail-panel');
    shell.appendChild(detail);
    await this.renderDetailPanel(data);

    searchInput.value = this.searchQuery;
    search.addEventListener('pointerdown', (event) => {
      if (event.target !== searchInput && !event.target.closest('.sanz-search-results')) searchInput.focus();
    });
    searchInput.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      searchInput.focus();
    });
    searchInput.addEventListener('click', (event) => {
      event.stopPropagation();
      searchInput.focus();
    });
    searchInput.addEventListener('input', () => {
      this.applySearch(searchInput.value);
      this.renderSearchResults(searchResults, searchInput.value, data, searchInput);
    });
    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim()) this.renderSearchResults(searchResults, searchInput.value, data, searchInput);
    });
    searchInput.addEventListener('blur', () => {
      window.setTimeout(() => searchResults.classList.remove('is-open'), 180);
    });
    searchInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') {
        searchResults.classList.remove('is-open');
        searchInput.blur();
        return;
      }
      if (event.key === 'Enter') {
        const firstResult = searchResults.querySelector('.sanz-search-result');
        if (firstResult && firstResult.dataset.path) {
          event.preventDefault();
          searchResults.classList.remove('is-open');
          await this.openPath(firstResult.dataset.path);
        }
      }
    });
  }
}

module.exports = class SanzKnowledgeTreePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({ treeNodePositions: {}, treeLayoutVersion: 5, memo: '', calendarEvents: {} }, await this.loadData());
    if (!this.settings.treeNodePositions) this.settings.treeNodePositions = {};
    if (!this.settings.calendarEvents) this.settings.calendarEvents = {};
    if (this.settings.treeLayoutVersion !== 5) {
      this.settings.treeNodePositions = {};
      this.settings.treeLayoutVersion = 5;
      await this.saveData(this.settings);
    }
    this.registerView(VIEW_TYPE, (leaf) => new SanzKnowledgeTreeView(leaf, this));
    this.addRibbonIcon('network', '打开 Sanz 的知识树', () => this.activateView());
    this.addCommand({
      id: 'open-sanz-knowledge-tree',
      name: '打开 Sanz 的知识树',
      callback: () => this.activateView()
    });
    this.app.workspace.onLayoutReady(() => this.activateView());
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  saveTreeNodePosition(key, position) {
    this.settings.treeNodePositions[key] = position;
    this.saveWorkspaceSettings();
  }

  saveWorkspaceSettings() {
    this.saveData(this.settings).catch((error) => console.error('Unable to save Sanz workspace settings', error));
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
};

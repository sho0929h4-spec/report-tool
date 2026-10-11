// app/shared/store.js — データ窓口（モック実装）。
// 計画2ではこのファイルの中身だけを Supabase+R2 実装に置き換える。画面は触らない。
(function () {
  const KEY = 'genba-mockdb-v2'; // tasks richオブジェクト化で v1 と非互換のため v2
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const seed = () => { const db = { cases: MOCK.cases, costs: MOCK.costs, rates: MOCK.rates };
    localStorage.setItem(KEY, JSON.stringify(db)); return db; };
  let db = load() || seed();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  // 写真の dataUrl は容量が大きいので localStorage に入れない（ページ遷移で消える・モック限定の割切り）
  const memPhotos = JSON.parse(JSON.stringify(MOCK.photos));
  const uid = p => p + Math.random().toString(36).slice(2, 9);
  const sortByScheduled = cs => [...cs].sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  const isToday = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
  const todayYmd = () => new Date().toISOString().slice(0, 10);

  window.Store = {
    session() { const role = localStorage.getItem('mockRole') || 'admin'; return MOCK.sessions[role]; },
    setRole(role) { localStorage.setItem('mockRole', role); },
    resetMock() { localStorage.removeItem(KEY); db = seed(); },

    async listCases() {
      const s = this.session();
      const cs = s.role === 'worker' ? db.cases.filter(c => c.assignedTo === s.userId) : db.cases;
      return sortByScheduled(cs);
    },
    async getToday() {
      const all = await this.listCases();
      const active = all.filter(c => c.status !== 'confirmed');
      const t = todayYmd();
      return {
        todays: active.filter(c => isToday(c.scheduledAt))
          .sort((a, b) => (a.scheduledAt || '').localeCompare(b.scheduledAt || '')),
        overdue: active.filter(c => c.dueDate && c.dueDate < t),
        dueToday: active.filter(c => c.dueDate === t),
        awaiting: this.session().role === 'admin' ? all.filter(c => c.status === 'submitted') : [],
      };
    },
    // 例外ファースト用: 全案件を横断して「停滞タスク」を抽出（admin の要対応欄）
    async listStalledTasks(thresholdH) {
      const th = thresholdH ?? 24;
      const now = new Date().toISOString();
      const out = [];
      for (const c of await this.listCases()) {
        for (const t of (c.tasks || [])) {
          if (t.status === 'done') continue;
          const stall = Calc.stallHours(t.updatedAt, now);
          const over = Calc.isOverdue(t.dueAt, now, t.status);
          if ((stall != null && stall >= th) || over) {
            out.push({ ...t, caseId: c.id, propertyName: c.propertyName, roomNo: c.roomNo,
              stallH: stall, overdue: over });
          }
        }
      }
      return out.sort((a, b) => (b.stallH || 0) - (a.stallH || 0));
    },
    async getCase(id) { return db.cases.find(c => c.id === id) || null; },
    async saveCase(obj) {
      if (obj.id) { const i = db.cases.findIndex(c => c.id === obj.id);
        db.cases[i] = { ...db.cases[i], ...obj }; save(); return db.cases[i]; }
      const c = { id: uid('c'), caseNo: '', propertyName: '', roomNo: '', address: '',
        scheduledAt: null, status: 'scheduled', workType: '調査', dueDate: null,
        instructions: '', tasks: [], contacts: [], estimate: null, questions: [],
        cause: '', nextActions: '',
        assignedTo: null, assignedName: '', workStartedAt: null, workEndedAt: null,
        invoiceAmount: null, report: null, createdAt: new Date().toISOString(), ...obj };
      db.cases.unshift(c); save(); return c;
    },
    async updateStatus(id, status) {
      const c = await this.getCase(id); if (!c) return null;
      c.status = status;
      if (status === 'in_progress' && !c.workStartedAt) c.workStartedAt = new Date().toISOString();
      if (status === 'submitted' && !c.workEndedAt) c.workEndedAt = new Date().toISOString();
      save(); return c;
    },
    async toggleTask(id, index) {
      const c = await this.getCase(id); if (!c || !c.tasks[index]) return null;
      const t = c.tasks[index];
      t.status = t.status === 'done' ? 'todo' : 'done';
      t.updatedAt = new Date().toISOString();
      save(); return c;
    },
    async saveTask(caseId, task) {
      const c = await this.getCase(caseId); if (!c) return null;
      c.tasks = c.tasks || [];
      if (task.id) { const i = c.tasks.findIndex(x => x.id === task.id);
        c.tasks[i] = { ...c.tasks[i], ...task, updatedAt: new Date().toISOString() }; }
      else { task.id = uid('t'); task.updatedAt = new Date().toISOString(); c.tasks.push(task); }
      save(); return task;
    },
    async listPhotos(caseId) { return memPhotos[caseId] || []; },
    async addPhoto(caseId, { dataUrl, phase, caption }) {
      const p = { id: uid('p'), phase: phase || 'before', caption: caption || '', dataUrl };
      (memPhotos[caseId] = memPhotos[caseId] || []).push(p); return p;
    },
    async deletePhoto(caseId, photoId) {
      memPhotos[caseId] = (memPhotos[caseId] || []).filter(p => p.id !== photoId);
    },
    async listCosts(caseId) { return db.costs[caseId] || []; },
    async saveCost(caseId, cost) {
      const list = (db.costs[caseId] = db.costs[caseId] || []);
      if (cost.id) { const i = list.findIndex(k => k.id === cost.id); list[i] = { ...list[i], ...cost }; }
      else { cost.id = uid('k'); list.push(cost); }
      save(); return cost;
    },
    async deleteCost(caseId, costId) {
      db.costs[caseId] = (db.costs[caseId] || []).filter(k => k.id !== costId); save();
    },
    async rates() { return db.rates; },
    async saveRates(r) { db.rates = { ...db.rates, ...r }; save(); },
    async saveReport(caseId, report) {
      const c = await this.getCase(caseId); if (!c) return null;
      c.report = report; save(); return c;
    },

    /* ---- 改訂v2差分B: 連絡先・見積・AI質問 ---- */
    async listContacts(caseId) { const c = await this.getCase(caseId); return (c && c.contacts) || []; },
    async saveContact(caseId, contact) {
      const c = await this.getCase(caseId); if (!c) return null;
      c.contacts = c.contacts || [];
      if (contact.id) { const i = c.contacts.findIndex(x => x.id === contact.id);
        c.contacts[i] = { ...c.contacts[i], ...contact }; }
      else { contact.id = uid('ct'); c.contacts.push(contact); }
      save(); return contact;
    },
    async deleteContact(caseId, contactId) {
      const c = await this.getCase(caseId); if (!c) return;
      c.contacts = (c.contacts || []).filter(x => x.id !== contactId); save();
    },
    async getEstimate(caseId) { const c = await this.getCase(caseId); return (c && c.estimate) || null; },
    async saveEstimate(caseId, est) {
      const c = await this.getCase(caseId); if (!c) return null;
      c.estimate = { ...(c.estimate || { status: 'draft', markup: 1.3, items: [] }), ...est };
      save(); return c.estimate;
    },
    async listQuestions(caseId) { const c = await this.getCase(caseId); return (c && c.questions) || []; },
    async listEscalated() {
      const out = [];
      for (const c of db.cases) {
        for (const q of (c.questions || [])) {
          if (q.escalated && !q.answer) {
            out.push({ ...q, caseId: c.id, propertyName: c.propertyName, roomNo: c.roomNo });
          }
        }
      }
      return out;
    },
    async answerQuestion(caseId, qId, text) {
      const c = await this.getCase(caseId); if (!c) return null;
      const q = (c.questions || []).find(x => x.id === qId); if (!q) return null;
      q.answer = text; q.answeredBy = this.session().name;
      q.answeredAt = new Date().toISOString();
      save(); return q;
    },
  };
})();

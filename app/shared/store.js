// app/shared/store.js — データ窓口（Supabase実装）。画面はこの窓口だけを使う。
(function () {
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  let SES = null;
  const isLogin = /login\.html$/.test(location.pathname);
  const ready = (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { if (!isLogin) location.replace('login.html'); return false; }
    const { data: p, error } = await sb.from('profiles').select('*')
      .eq('user_id', session.user.id).single();
    if (error || !p) { await sb.auth.signOut(); location.replace('login.html'); return false; }
    SES = { userId: p.user_id, name: p.display_name, role: p.role, tenantId: p.tenant_id };
    return true;
  })();

  const SEL = '*, assignee:profiles!cases_assigned_to_fkey(display_name)';
  const toCase = r => r && ({
    id: r.id, caseNo: r.case_no || '', propertyName: r.property_name, roomNo: r.room_no || '',
    address: r.address || '', scheduledAt: r.scheduled_at, status: r.status, workType: r.work_type,
    dueDate: r.due_date, instructions: r.instructions || '', tasks: r.tasks || [],
    cause: r.cause || '', nextActions: r.next_actions || '',
    assignedTo: r.assigned_to, assignedName: (r.assignee && r.assignee.display_name) || '',
    workStartedAt: r.work_started_at, workEndedAt: r.work_ended_at,
    invoiceAmount: r.invoice_amount, report: r.report, createdAt: r.created_at,
    contacts: [], estimate: null, questions: [],
  });
  const fromCase = o => {
    const m = { caseNo: 'case_no', propertyName: 'property_name', roomNo: 'room_no', address: 'address',
      scheduledAt: 'scheduled_at', status: 'status', workType: 'work_type', dueDate: 'due_date',
      instructions: 'instructions', tasks: 'tasks', cause: 'cause', nextActions: 'next_actions',
      assignedTo: 'assigned_to', workStartedAt: 'work_started_at', workEndedAt: 'work_ended_at',
      invoiceAmount: 'invoice_amount', report: 'report' };
    const out = {};
    for (const k of Object.keys(o)) if (m[k] && o[k] !== undefined) out[m[k]] = o[k];
    return out;
  };
  const isToday = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
  const todayYmd = () => new Date().toISOString().slice(0, 10);
  const die = e => { throw new Error(e.message || String(e)); };

  window.Store = {
    init() { return ready; },
    session() { return SES; },
    async logout() { await sb.auth.signOut(); location.replace('login.html'); },
    // 互換スタブ（モック時代のAPI。実機能なし）
    setRole() {}, resetMock() {},

    async listMembers() {
      await ready;
      const { data, error } = await sb.from('profiles').select('user_id, display_name, role');
      if (error) die(error);
      return data.map(p => ({ userId: p.user_id, name: p.display_name, role: p.role }));
    },
    async listCases() {
      await ready;
      let q = sb.from('cases').select(SEL).order('scheduled_at', { ascending: false, nullsFirst: false });
      if (SES.role === 'worker') q = q.eq('assigned_to', SES.userId);
      const { data, error } = await q;
      if (error) die(error);
      return data.map(toCase);
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
        awaiting: SES.role === 'admin' ? all.filter(c => c.status === 'submitted') : [],
      };
    },
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
    async getCase(id) {
      await ready;
      const { data, error } = await sb.from('cases').select(SEL).eq('id', id).maybeSingle();
      if (error) die(error);
      return toCase(data);
    },
    async saveCase(obj) {
      await ready;
      if (obj.id) {
        const { data, error } = await sb.from('cases').update(fromCase(obj))
          .eq('id', obj.id).select(SEL).single();
        if (error) die(error);
        return toCase(data);
      }
      const row = { tenant_id: SES.tenantId, created_by: SES.userId, ...fromCase(obj) };
      const { data, error } = await sb.from('cases').insert(row).select(SEL).single();
      if (error) die(error);
      return toCase(data);
    },
    async updateStatus(id, status) {
      const c = await this.getCase(id); if (!c) return null;
      const patch = { status };
      if (status === 'in_progress' && !c.workStartedAt) patch.workStartedAt = new Date().toISOString();
      if (status === 'submitted' && !c.workEndedAt) patch.workEndedAt = new Date().toISOString();
      return this.saveCase({ id, ...patch });
    },
    async toggleTask(id, index) {
      const c = await this.getCase(id); if (!c || !c.tasks[index]) return null;
      const t = c.tasks[index];
      t.status = t.status === 'done' ? 'todo' : 'done';
      t.updatedAt = new Date().toISOString();
      return this.saveCase({ id, tasks: c.tasks });
    },
    async saveTask(caseId, task) {
      const c = await this.getCase(caseId); if (!c) return null;
      const tasks = c.tasks || [];
      if (task.id) {
        const i = tasks.findIndex(x => x.id === task.id);
        tasks[i] = { ...tasks[i], ...task, updatedAt: new Date().toISOString() };
      } else {
        task.id = 't' + Math.random().toString(36).slice(2, 9);
        task.updatedAt = new Date().toISOString(); tasks.push(task);
      }
      await this.saveCase({ id: caseId, tasks });
      return task;
    },
    async saveReport(caseId, report) {
      return this.saveCase({ id: caseId, report });
    },

    // ---- 写真（Task 8 で本実装。ここでは空動作） ----
    async listPhotos() { return []; },
    async addPhoto() { throw new Error('写真アップロードは未実装（Task 8）'); },
    async deletePhoto() {},

    // ---- 後続スライス（原価・連絡・見積・AI質問）: 空スタブ ----
    async listCosts() { return []; },
    async saveCost() { return null; },
    async deleteCost() {},
    async rates() { return { defaultRate: null, byUser: {} }; },
    async saveRates() {},
    async listContacts() { return []; },
    async saveContact() { return null; },
    async deleteContact() {},
    async getEstimate() { return null; },
    async saveEstimate() { return null; },
    async listQuestions() { return []; },
    async addQuestion() { return null; },
    async listEscalated() { return []; },
    async answerQuestion() { return null; },
  };
})();

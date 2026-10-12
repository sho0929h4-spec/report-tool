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

  const SEL = '*, assignee:profiles!cases_assigned_to_fkey(display_name, phone)';
  const toCase = r => r && ({
    id: r.id, caseNo: r.case_no || '', propertyName: r.property_name, roomNo: r.room_no || '',
    address: r.address || '', scheduledAt: r.scheduled_at, status: r.status, workType: r.work_type,
    dueDate: r.due_date, instructions: r.instructions || '', tasks: r.tasks || [],
    cause: r.cause || '', nextActions: r.next_actions || '',
    assignedTo: r.assigned_to, assignedName: (r.assignee && r.assignee.display_name) || '',
    assignedPhone: (r.assignee && r.assignee.phone) || '',
    residentName: r.resident_name || '',
    workStartedAt: r.work_started_at, workEndedAt: r.work_ended_at,
    invoiceAmount: r.invoice_amount, report: r.report, createdAt: r.created_at,
    movement: r.movement || null,
    returnNote: r.return_note || null,
    shareToken: r.share_token || null,
    shareAck: r.share_ack || null,
    archivedAt: r.archived_at || null,
    contacts: [], estimate: null, questions: [],
  });
  const fromCase = o => {
    const m = { caseNo: 'case_no', propertyName: 'property_name', roomNo: 'room_no', address: 'address',
      scheduledAt: 'scheduled_at', status: 'status', workType: 'work_type', dueDate: 'due_date',
      instructions: 'instructions', tasks: 'tasks', cause: 'cause', nextActions: 'next_actions',
      assignedTo: 'assigned_to', workStartedAt: 'work_started_at', workEndedAt: 'work_ended_at',
      invoiceAmount: 'invoice_amount', report: 'report', residentName: 'resident_name',
      movement: 'movement', returnNote: 'return_note',
      shareToken: 'share_token', shareAck: 'share_ack',
      archivedAt: 'archived_at' };
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
      if (SES.role === 'worker') {
        // 自分の担当案件 + 担当未定案件
        q = q.or(`assigned_to.eq.${SES.userId},assigned_to.is.null`);
      }
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
      if (status === 'in_progress') patch.movement = null; // 作業開始で移動中表示をクリア
      if (status === 'submitted' && !c.workEndedAt) patch.workEndedAt = new Date().toISOString();
      if (status === 'submitted') patch.returnNote = null; // 差し戻しバッジをクリア
      if (status === 'confirmed') patch.returnNote = null;
      return this.saveCase({ id, ...patch });
    },
    async returnCase(caseId, note) {
      // admin専用。ガードはUI側でも行うこと
      await ready;
      const patch = {
        status: 'in_progress',
        return_note: { note, byName: SES.name, at: new Date().toISOString() },
      };
      const { data, error } = await sb.from('cases').update(patch)
        .eq('id', caseId).select(SEL).single();
      if (error) die(error);
      return toCase(data);
    },
    async setDeparture(caseId, { etaAt, recipients, delayReason, keepDepartedAt }) {
      await ready;
      let departedAt = new Date().toISOString();
      if (keepDepartedAt) {
        // 到着予定変更: 既存の departedAt を維持
        const c = await this.getCase(caseId);
        if (c && c.movement && c.movement.departedAt) departedAt = c.movement.departedAt;
      }
      const payload = {
        departedAt,
        etaAt,
        recipients,
        byName: SES.name,
        delayReason: delayReason ?? null,
      };
      const { data, error } = await sb.from('cases')
        .update({ movement: payload }).eq('id', caseId).select(SEL).single();
      if (error) die(error);
      return toCase(data);
    },
    async clearDeparture(caseId) {
      await ready;
      const { data, error } = await sb.from('cases')
        .update({ movement: null }).eq('id', caseId).select(SEL).single();
      if (error) die(error);
      return toCase(data);
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

    // ---- 写真（R2 署名URL経由） ----
    async _sign(caseId, items) {
      const { data, error } = await sb.functions.invoke('sign-photo', { body: { caseId, keys: items } });
      if (error) die(error);
      return Object.fromEntries(data.keys.map(k => [k.key, k.url]));
    },
    async _compress(blob, max, q) {
      const bmp = await createImageBitmap(blob);
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      return new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    },
    async addPhoto(caseId, { dataUrl, category, title, blurWarn }) {
      // photos.html は FileReader 済みの dataUrl を渡す。base64→Blob変換してアップロード
      await ready;
      // dataUrl を Blob に変換（圧縮の入力として使う）
      const res = await fetch(dataUrl);
      const srcBlob = await res.blob();
      const main = await this._compress(srcBlob, 1600, 0.82);
      const thumb = await this._compress(srcBlob, 320, 0.7);
      const uid = crypto.randomUUID();
      const key = `${SES.tenantId}/${caseId}/${uid}.jpg`;
      const tkey = `thumb/${SES.tenantId}/${caseId}/${uid}.jpg`;
      const urls = await this._sign(caseId, [{ key, method: 'PUT' }, { key: tkey, method: 'PUT' }]);
      for (const [k, blob] of [[key, main], [tkey, thumb]]) {
        const r = await fetch(urls[k], { method: 'PUT', body: blob,
          headers: { 'content-type': 'image/jpeg' } });
        if (!r.ok) throw new Error(`アップロード失敗 (${r.status})`);
      }
      const { data, error } = await sb.from('photos').insert({
        tenant_id: SES.tenantId, case_id: caseId, phase: null,
        check_item: category || null, caption: title || '',
        object_key: key, thumb_key: tkey, size_bytes: main.size,
      }).select('*').single();
      if (error) die(error);
      return { id: data.id, category: data.check_item, title: data.caption,
        blurWarn: !!blurWarn, dataUrl: URL.createObjectURL(thumb),
        createdAt: data.created_at };
    },
    async listPhotos(caseId) {
      await ready;
      const { data, error } = await sb.from('photos').select('*')
        .eq('case_id', caseId).order('sort_order').order('created_at');
      if (error) die(error);
      if (!data.length) return [];
      const urls = await this._sign(caseId,
        data.map(r => ({ key: r.thumb_key || r.object_key, method: 'GET' })));
      return data.map(r => ({ id: r.id, category: r.check_item, title: r.caption || '',
        blurWarn: false, dataUrl: urls[r.thumb_key || r.object_key],
        objectKey: r.object_key, createdAt: r.created_at }));
    },
    async photoUrl(caseId, objectKey) {
      const urls = await this._sign(caseId, [{ key: objectKey, method: 'GET' }]);
      return urls[objectKey];
    },
    async photoUrls(caseId, objectKeys) {
      // 原寸写真のGET署名URLを一括発行（アーカイブ用）。戻り値: { objectKey: url }
      return this._sign(caseId, objectKeys.map(k => ({ key: k, method: 'GET' })));
    },
    async deletePhoto(caseId, photoId) {
      await ready;
      const { error } = await sb.from('photos').delete().eq('id', photoId);
      if (error) die(error);
      // R2オブジェクトは残す（purge-expired が将来掃除する方針）
    },

    // ---- テナント設定 ----
    async getTenant() {
      await ready;
      const { data, error } = await sb.from('tenants').select('*').eq('id', SES.tenantId).single();
      if (error) die(error);
      return {
        id: data.id, name: data.name,
        defaultHourlyRate: data.default_hourly_rate,
        retentionMonths: data.retention_months,
        plan: data.plan,
        phone: data.phone || '',
      };
    },
    async saveTenant(patch) {
      await ready;
      const col = {};
      if (patch.defaultHourlyRate !== undefined) col.default_hourly_rate = patch.defaultHourlyRate;
      if (patch.retentionMonths !== undefined) col.retention_months = patch.retentionMonths;
      if (patch.phone !== undefined) col.phone = patch.phone;
      const { data, error } = await sb.from('tenants').update(col)
        .eq('id', SES.tenantId).select('*').single();
      if (error) die(error);
      return {
        id: data.id, name: data.name,
        defaultHourlyRate: data.default_hourly_rate,
        retentionMonths: data.retention_months,
        phone: data.phone || '',
      };
    },

    // ---- 関係者（stakeholders） ----
    async listStakeholders(caseId) {
      await ready;
      const { data, error } = await sb.from('stakeholders')
        .select('*').eq('case_id', caseId).order('created_at', { ascending: true });
      if (error) die(error);
      return (data || []).map(r => ({
        id: r.id, tenantId: r.tenant_id, caseId: r.case_id,
        role: r.role, name: r.name, email: r.email || '',
        createdAt: r.created_at,
      }));
    },
    async addStakeholder(caseId, { role, name, email }) {
      await ready;
      const { data, error } = await sb.from('stakeholders').insert({
        tenant_id: SES.tenantId, case_id: caseId,
        role, name, email: email || null,
      }).select('*').single();
      if (error) die(error);
      return { id: data.id, tenantId: data.tenant_id, caseId: data.case_id,
        role: data.role, name: data.name, email: data.email || '', createdAt: data.created_at };
    },
    async deleteStakeholder(id) {
      await ready;
      const { error } = await sb.from('stakeholders').delete().eq('id', id);
      if (error) die(error);
    },

    // ---- 進捗共有トークン発行 ----
    async issueShareToken(caseId) {
      await ready;
      const token = crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const { data, error } = await sb.from('cases')
        .update({ share_token: token }).eq('id', caseId).select(SEL).single();
      if (error) die(error);
      return toCase(data);
    },

    // ---- 職人別単価 ----
    async listRates() {
      await ready;
      const { data, error } = await sb.from('worker_rates')
        .select('user_id, hourly_rate').eq('tenant_id', SES.tenantId);
      if (error) die(error);
      const byUser = {};
      (data || []).forEach(r => { byUser[r.user_id] = r.hourly_rate; });
      return byUser;
    },
    async saveRate(userId, hourlyRate) {
      await ready;
      if (hourlyRate == null) {
        // null → 行削除（既定を使用に戻す）
        const { error } = await sb.from('worker_rates').delete().eq('user_id', userId);
        if (error) die(error);
        return;
      }
      const { error } = await sb.from('worker_rates').upsert({
        user_id: userId, tenant_id: SES.tenantId, hourly_rate: hourlyRate,
      }, { onConflict: 'user_id' });
      if (error) die(error);
    },

    // ---- 原価タブ用 rates()（case.html 互換） ----
    async rates() {
      await ready;
      const tenant = await this.getTenant();
      const byUser = await this.listRates();
      return { defaultRate: tenant.defaultHourlyRate ?? 3000, byUser };
    },
    async saveRates() {},

    // ---- 月次集計 ----
    async listMonthlyCases(year, month) {
      await ready;
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const toDate = new Date(year, month, 1); // 翌月1日
      const to = toDate.toISOString().slice(0, 10);
      const { data, error } = await sb.from('cases')
        .select('id, property_name, room_no, work_type, status, scheduled_at, invoice_amount, assigned_to, work_started_at, work_ended_at')
        .eq('tenant_id', SES.tenantId)
        .in('status', ['submitted', 'confirmed'])
        .gte('scheduled_at', from)
        .lt('scheduled_at', to)
        .order('scheduled_at', { ascending: true });
      if (error) die(error);
      return (data || []).map(r => ({
        id: r.id, propertyName: r.property_name, roomNo: r.room_no || '',
        workType: r.work_type, status: r.status, scheduledAt: r.scheduled_at,
        invoiceAmount: r.invoice_amount, assignedTo: r.assigned_to,
        workStartedAt: r.work_started_at, workEndedAt: r.work_ended_at,
      }));
    },
    async listMonthlyCosts(caseIds) {
      await ready;
      if (!caseIds || caseIds.length === 0) return {};
      const { data, error } = await sb.from('costs')
        .select('case_id, amount, is_auto')
        .in('case_id', caseIds);
      if (error) die(error);
      const byCaseId = {};
      (data || []).forEach(r => {
        if (!byCaseId[r.case_id]) byCaseId[r.case_id] = [];
        byCaseId[r.case_id].push({ amount: r.amount, isAuto: r.is_auto });
      });
      return byCaseId;
    },

    // ---- 後続スライス（連絡・見積・AI質問）: 空スタブ ----
    async listCosts(caseId) {
      await ready;
      const { data, error } = await sb.from('costs').select('*')
        .eq('case_id', caseId).order('created_at', { ascending: true });
      if (error) die(error);
      return (data || []).map(r => ({
        id: r.id, caseId: r.case_id, category: r.category, label: r.label,
        qty: r.qty, unitPrice: r.unit_price, amount: r.amount, isAuto: r.is_auto,
      }));
    },
    async saveCost(caseId, obj) {
      await ready;
      const row = {
        case_id: caseId, tenant_id: SES.tenantId,
        category: obj.category, label: obj.label || '',
        qty: obj.qty ?? null, unit_price: obj.unitPrice ?? null,
        amount: obj.amount ?? null, is_auto: obj.isAuto ?? false,
        created_by: SES.userId,
      };
      if (obj.id) {
        const { data, error } = await sb.from('costs').update(row).eq('id', obj.id).select('*').single();
        if (error) die(error);
        return { ...obj, id: data.id };
      }
      const { data, error } = await sb.from('costs').insert(row).select('*').single();
      if (error) die(error);
      return { ...obj, id: data.id };
    },
    async deleteCost(caseId, costId) {
      await ready;
      const { error } = await sb.from('costs').delete().eq('id', costId).eq('case_id', caseId);
      if (error) die(error);
    },
    async listContacts() { return []; },
    async saveContact() { return null; },
    async deleteContact() {},
    async getEstimate() { return null; },
    async saveEstimate() { return null; },
    async listQuestions() { return []; },
    async addQuestion() { return null; },
    async listEscalated() { return []; },
    async answerQuestion() { return null; },

    // ---- 現地報告 ----
    async listSiteReports(caseId) {
      await ready;
      const { data, error } = await sb.from('site_reports')
        .select('*').eq('case_id', caseId).order('created_at', { ascending: false });
      if (error) die(error);
      return (data || []).map(r => ({
        id: r.id, tenantId: r.tenant_id, caseId: r.case_id,
        kind: r.kind, items: r.items || [], note: r.note || '',
        recipients: r.recipients || [], acked: r.acked,
        createdBy: r.created_by, byName: r.by_name,
        createdAt: r.created_at,
      }));
    },
    async addSiteReport(caseId, { kind, items, note, recipients }) {
      await ready;
      const row = {
        tenant_id: SES.tenantId,
        case_id: caseId,
        kind,
        items: items || [],
        note: note || null,
        recipients: recipients || [],
        created_by: SES.userId,
        by_name: SES.name,
      };
      const { data, error } = await sb.from('site_reports').insert(row)
        .select('*').single();
      if (error) die(error);
      return {
        id: data.id, tenantId: data.tenant_id, caseId: data.case_id,
        kind: data.kind, items: data.items || [], note: data.note || '',
        recipients: data.recipients || [], acked: data.acked,
        createdBy: data.created_by, byName: data.by_name,
        createdAt: data.created_at,
      };
    },
    async listUnackedSiteReports() {
      await ready;
      const { data, error } = await sb.from('site_reports')
        .select('*, case:cases(property_name, room_no)')
        .eq('tenant_id', SES.tenantId)
        .eq('acked', false)
        .order('created_at', { ascending: false });
      if (error) die(error);
      return (data || []).map(r => ({
        id: r.id, tenantId: r.tenant_id, caseId: r.case_id,
        kind: r.kind, items: r.items || [], note: r.note || '',
        recipients: r.recipients || [], acked: r.acked,
        createdBy: r.created_by, byName: r.by_name,
        createdAt: r.created_at,
        propertyName: (r.case && r.case.property_name) || '',
        roomNo: (r.case && r.case.room_no) || '',
      }));
    },
    async ackSiteReport(id) {
      await ready;
      const { data, error } = await sb.from('site_reports')
        .update({ acked: true }).eq('id', id).select('*').single();
      if (error) die(error);
      return data;
    },

    // ---- 送信待ちメッセージ（message_drafts） ----
    async listDrafts() {
      await ready;
      const { data, error } = await sb.from('message_drafts')
        .select('*, case:cases(property_name, room_no), stakeholder:stakeholders(email)')
        .eq('tenant_id', SES.tenantId)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });
      if (error) die(error);
      return (data || []).map(r => ({
        id: r.id, tenantId: r.tenant_id, caseId: r.case_id,
        triggerType: r.trigger_type, shRole: r.sh_role, shName: r.sh_name,
        body: r.body, createdAt: r.created_at,
        stakeholderId: r.stakeholder_id, sourceId: r.source_id,
        propertyName: (r.case && r.case.property_name) || '',
        roomNo: (r.case && r.case.room_no) || '',
        shEmail: (r.stakeholder && r.stakeholder.email) || '',
      }));
    },
    async addDraft(caseId, { triggerType, shRole, shName, body, stakeholderId, sourceId }) {
      await ready;
      const row = {
        tenant_id: SES.tenantId,
        case_id: caseId,
        trigger_type: triggerType,
        sh_role: shRole,
        sh_name: shName,
        body,
        stakeholder_id: stakeholderId ?? null,
        source_id: sourceId ?? null,
      };
      const { data, error } = await sb.from('message_drafts').insert(row).select('*').single();
      if (error) {
        // unique 違反（code 23505 / HTTP 409）は握りつぶす
        if (error.code === '23505' || error.status === 409) return null;
        die(error);
      }
      return data;
    },
    async updateDraft(id, body) {
      await ready;
      const { data, error } = await sb.from('message_drafts')
        .update({ body }).eq('id', id).select('*').single();
      if (error) die(error);
      return {
        id: data.id, caseId: data.case_id, triggerType: data.trigger_type,
        shRole: data.sh_role, shName: data.sh_name, body: data.body, createdAt: data.created_at,
      };
    },
    async markDraftSent(id) {
      await ready;
      const { error } = await sb.from('message_drafts')
        .update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
      if (error) die(error);
    },
    async dismissDraft(id) {
      await ready;
      const { error } = await sb.from('message_drafts')
        .update({ status: 'dismissed' }).eq('id', id);
      if (error) die(error);
    },
    async sendDraftEmail(draftId) {
      await ready;
      const { data, error } = await sb.functions.invoke('send-email', { body: { draftId } });
      if (error) die(error);
      return data;
    },
  };
})();

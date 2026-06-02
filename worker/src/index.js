// ============================================================================
// report-api Worker — 門番 ＋ 静的配信（1Workerに同居）
//   /api/*  → 門番API（token / 管理者JWT を検証して service_role でDB/R2操作）
//   それ以外 → 静的HTML（env.ASSETS）を返す（＝同一住所、CORS不要）
//   cron     → Supabaseを1行SELECTして休止を防ぐ
// ブラウザはSupabaseを直接叩かない。全データ要求はここを通る。
// ============================================================================

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, env, url);
      } catch (e) {
        // 投げられたResponse（403等）はそのまま返す
        if (e instanceof Response) return e;
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    // 静的アセット配信
    return env.ASSETS.fetch(req);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sb(env, 'cases?select=id&limit=1'));
  },
};

// ---------------------------------------------------------------- ルーティング
async function api(req, env, url) {
  const p = url.pathname.slice(4).replace(/\/+$/, '') || '/'; // "/api" を除去
  const m = req.method;
  const t = (...defs) => defs.some(([mm, pp]) => mm === m && pp === p);

  if (p === '/ping') return json({ ok: true });

  // --- 管理者専用 ---
  if (m === 'GET' && p === '/cases') return adminCases(req, env, url);

  // --- 業者専用（SupabaseログインJWT）---
  if (m === 'GET' && p === '/vendor-estimates') return vendorEstimates(req, env);

  // --- 公開（token不要）---
  if (m === 'POST' && p === '/request')  return postRequest(req, env);
  if (m === 'POST' && p === '/register') return postRegister(req, env);

  // --- token認証 ---
  if (m === 'GET'    && p === '/case')     return getCase(req, env, url);
  if (m === 'GET'    && p === '/report')   return getReport(req, env, url);
  if (m === 'POST'   && p === '/report')   return postReport(req, env);
  if (m === 'POST'   && p === '/photo')    return postPhoto(req, env);
  if (m === 'GET'    && p === '/photo')      return getPhoto(req, env, url);
  if (m === 'DELETE' && p === '/photo')      return delPhoto(req, env, url);
  if (m === 'POST'   && p === '/photo-meta') return photoMeta(req, env);
  if (m === 'GET'    && p === '/schedule') return getSchedule(req, env, url);
  if (m === 'POST'   && p === '/schedule') return postSchedule(req, env);
  if (m === 'POST'   && p === '/estimate') return postEstimate(req, env);
  if (m === 'POST'   && p === '/followup') return postFollowup(req, env);

  return json({ error: 'not found' }, 404);
}

// ---------------------------------------------------------------- 認証（共通部品）
// token照合: cases.access_token = token の行を1件返す。無ければ 403 を投げる。
async function requireCase(env, token) {
  if (!token) throw json({ error: 'forbidden' }, 403);
  const rows = await sb(env, `cases?access_token=eq.${enc(token)}&select=id&limit=1`);
  if (!rows[0]) throw json({ error: 'forbidden' }, 403);
  return rows[0]; // { id }
}

// その報告書が token の case のものか確認。違えば 403。
async function requireOwnReport(env, caseId, reportId) {
  const rows = await sb(env, `reports?id=eq.${enc(reportId)}&case_id=eq.${caseId}&select=id&limit=1`);
  if (!rows[0]) throw json({ error: 'forbidden' }, 403);
}

// 管理者JWT検証: Authorization: Bearer <supabase access_token> を検証し、許可メールなら true。
async function requireAdmin(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) throw json({ error: 'unauthorized' }, 401);
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw json({ error: 'unauthorized' }, 401);
  const user = await r.json();
  const allowed = (env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!user.email || !allowed.includes(user.email)) throw json({ error: 'forbidden' }, 403);
  return user;
}

// 業者JWT検証: Supabaseログインのaccess_tokenを検証し、メールから vendor 行を引く。
// 該当vendorが無ければ403。{ id, name, email } を返す。
async function requireVendor(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) throw json({ error: 'unauthorized' }, 401);
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw json({ error: 'unauthorized' }, 401);
  const user = await r.json();
  if (!user.email) throw json({ error: 'unauthorized' }, 401);
  const rows = await sb(env, `vendors?email=eq.${enc(user.email)}&select=id,name,email&limit=1`);
  if (!rows[0]) throw json({ error: 'forbidden' }, 403);
  return rows[0];
}

// ---------------------------------------------------------------- token系
// GET /api/case?token : フォーム/閲覧用。property/client/vendorをネストして返す（全ページ共用の上位集合）
async function getCase(req, env, url) {
  const token = url.searchParams.get('token');
  await requireCase(env, token);
  const sel = '*,property:properties(*),client:clients(*),vendor:vendors(*)';
  const rows = await sb(env, `cases?access_token=eq.${enc(token)}&select=${enc(sel)}&limit=1`);
  return json(rows[0]);
}

// GET /api/report?token : 最新の報告書＋写真キー一覧
async function getReport(req, env, url) {
  const token = url.searchParams.get('token');
  const c = await requireCase(env, token);
  const reports = await sb(env, `reports?case_id=eq.${c.id}&select=*&order=created_at.desc`);
  const report = reports[0] || null;
  let photos = [];
  if (report) photos = await sb(env, `report_photos?report_id=eq.${report.id}&select=*&order=sort_order`);
  return json({ report, photos });
}

// POST /api/report : 報告書 作成/更新（autosave含む）。case_idはtokenから導出。
async function postReport(req, env) {
  const body = await req.json();
  const c = await requireCase(env, body.token);
  const { token, report_id, ...fields } = body;
  fields.case_id = c.id;
  let row;
  if (report_id) {
    await requireOwnReport(env, c.id, report_id);
    row = (await sb(env, `reports?id=eq.${enc(report_id)}`, 'PATCH', fields, true))[0];
  } else {
    row = (await sb(env, 'reports', 'POST', fields, true))[0];
  }
  return json({ ok: true, report: row });
}

// POST /api/photo : 写真1枚アップ（multipart）→ R2保存 + DB記録
async function postPhoto(req, env) {
  const form = await req.formData();
  const c = await requireCase(env, form.get('token'));
  const report_id = form.get('report_id');
  await requireOwnReport(env, c.id, report_id);

  const file = form.get('file');
  if (!file) return json({ error: 'no file' }, 400);

  const key = `reports/${c.id}/${report_id}/${crypto.randomUUID()}.jpg`;
  await env.BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'image/jpeg' },
  });
  const ins = await sb(env, 'report_photos', 'POST', {
    report_id,
    storage_key: key,
    storage: 'r2',
    phase: form.get('phase') || null,
    caption: form.get('caption') || null,
    sort_order: Number(form.get('sort_order') || 0),
  }, true);
  return json({ ok: true, key, photo: ins[0] });
}

// GET /api/photo?token&key : 画像バイナリ（R2非公開）。keyのcase_idがtokenと一致する時だけ。
async function getPhoto(req, env, url) {
  const token = url.searchParams.get('token');
  const key = url.searchParams.get('key');
  const c = await requireCase(env, token);
  if (!key || !key.startsWith(`reports/${c.id}/`)) throw json({ error: 'forbidden' }, 403);
  const obj = await env.BUCKET.get(key);
  if (!obj) return json({ error: 'not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

// DELETE /api/photo?token&key
async function delPhoto(req, env, url) {
  const token = url.searchParams.get('token');
  const key = url.searchParams.get('key');
  const c = await requireCase(env, token);
  if (!key || !key.startsWith(`reports/${c.id}/`)) throw json({ error: 'forbidden' }, 403);
  await env.BUCKET.delete(key);
  await sb(env, `report_photos?storage_key=eq.${enc(key)}`, 'DELETE');
  return json({ ok: true });
}

// POST /api/photo-meta : 写真のsort_order/phase/captionを更新
async function photoMeta(req, env) {
  const body = await req.json();
  const c = await requireCase(env, body.token);
  const key = body.key;
  if (!key || !key.startsWith(`reports/${c.id}/`)) throw json({ error: 'forbidden' }, 403);
  const patch = {};
  if (body.sort_order != null) patch.sort_order = body.sort_order;
  if ('phase' in body)   patch.phase = body.phase || null;
  if ('caption' in body) patch.caption = body.caption || null;
  await sb(env, `report_photos?storage_key=eq.${enc(key)}`, 'PATCH', patch);
  return json({ ok: true });
}

// GET /api/schedule?token : 案件＋既存の日程回答
async function getSchedule(req, env, url) {
  const token = url.searchParams.get('token');
  const c = await requireCase(env, token);
  const rows = await sb(env, `cases?id=eq.${c.id}&select=id,work_type,room,scheduled_date,property:properties(name,address)&limit=1`);
  const subs = await sb(env, `schedule_submissions?case_id=eq.${c.id}&select=*&order=submitted_at.desc`);
  return json({ case: rows[0], submissions: subs });
}

// POST /api/schedule : 日程回答を保存
async function postSchedule(req, env) {
  const body = await req.json();
  const c = await requireCase(env, body.token);
  const { token, ...fields } = body;
  fields.case_id = c.id;
  const row = (await sb(env, 'schedule_submissions', 'POST', fields, true))[0];
  return json({ ok: true, submission: row });
}

// POST /api/estimate : 見積＋明細を保存
async function postEstimate(req, env) {
  const body = await req.json();
  const c = await requireCase(env, body.token);
  const { token, items, ...head } = body;
  head.case_id = c.id;
  const est = (await sb(env, 'estimates', 'POST', head, true))[0];
  if (Array.isArray(items) && items.length && est?.id) {
    await sb(env, 'estimate_items', 'POST', items.map(it => ({ ...it, estimate_id: est.id })));
  }
  return json({ ok: true, estimate: est });
}

// POST /api/followup : 対応方針・見積回答時期を確定し、caseを提出済みに
async function postFollowup(req, env) {
  const body = await req.json();
  const c = await requireCase(env, body.token);
  await requireOwnReport(env, c.id, body.report_id);
  await sb(env, `reports?id=eq.${enc(body.report_id)}`, 'PATCH', {
    next_action: body.next_action,
    estimate_by: body.estimate_by,
    estimate_by_date: body.estimate_by_date,
  });
  await sb(env, `cases?id=eq.${c.id}`, 'PATCH', { status: 'submitted' });
  return json({ ok: true });
}

// ---------------------------------------------------------------- 公開系
// POST /api/request : 一般依頼フォーム（公開）→ case作成
async function postRequest(req, env) {
  const payload = await req.json();
  const row = (await sb(env, 'cases', 'POST', payload, true))[0];
  return json({ ok: true, case: row });
}

// POST /api/register : 招待リンク登録（token必須＝招待の合言葉）→ client/property/case作成
async function postRegister(req, env) {
  const body = await req.json();
  if (!env.REGISTER_TOKEN || body.token !== env.REGISTER_TOKEN) {
    throw json({ error: 'forbidden' }, 403);
  }
  const client = (await sb(env, 'clients', 'POST', body.client, true))[0];
  const prop   = (await sb(env, 'properties', 'POST', body.property, true))[0];
  const caseRow = (await sb(env, 'cases', 'POST', {
    ...body.case, client_id: client.id, property_id: prop.id,
  }, true))[0];
  return json({ ok: true, case: caseRow });
}

// ---------------------------------------------------------------- 管理者系
async function adminCases(req, env, url) {
  await requireAdmin(req, env);
  const status = url.searchParams.get('status');
  let q = 'cases?select=*&order=created_at.desc';
  if (status && status !== 'all') q += `&status=eq.${enc(status)}`;
  return json(await sb(env, q));
}

// GET /api/vendor-estimates : 自社案件の見積一覧のみ返す（vendor_idで絞り込み）
async function vendorEstimates(req, env) {
  const vendor = await requireVendor(req, env);
  const sel = 'id,submitted_at,total_amount,items,status,' +
    'cases!inner(id,work_type,room,rooms,vendor_id,property:property_id(name))';
  const q = `estimates?select=${enc(sel)}&cases.vendor_id=eq.${vendor.id}` +
    `&order=submitted_at.desc`;
  return json({ vendor, estimates: await sb(env, q) });
}

// ---------------------------------------------------------------- Supabase REST（service_role）
async function sb(env, path, method = 'GET', body, returnRow = false) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (returnRow) headers.Prefer = 'return=representation';
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw json({ error: `supabase ${r.status}: ${await r.text()}` }, 502);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// ---------------------------------------------------------------- ユーティリティ
function enc(v) { return encodeURIComponent(String(v ?? '')); }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

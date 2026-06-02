// ============================================================================
// 共有APIクライアント — 全画面はこの window.API だけを使う。
// Supabaseは直接叩かない。データは全て門番Worker(/api/*)経由。
// 住所はWorkerと同一オリジンなので相対パス /api でOK（CORS不要）。
// ============================================================================
(function () {
  const BASE = '/api';

  async function call(path, { method = 'GET', body, jwt, form } = {}) {
    const headers = {};
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    let payload;
    if (form) {
      payload = form; // FormData。Content-Typeはブラウザが自動付与
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    const ct = res.headers.get('Content-Type') || '';
    return ct.includes('application/json') ? res.json() : res;
  }

  const q = (o) => new URLSearchParams(o).toString();

  window.API = {
    // ---- token系 ----
    getCase:   (token) => call(`/case?${q({ token })}`),
    getReport: (token) => call(`/report?${q({ token })}`),
    saveReport: (token, fields, report_id) =>
      call('/report', { method: 'POST', body: { token, report_id, ...fields } }),

    // 写真: fileは圧縮済みBlobを渡す
    uploadPhoto(token, report_id, { file, phase, caption, sort_order }) {
      const fd = new FormData();
      fd.append('token', token);
      fd.append('report_id', report_id);
      if (phase)  fd.append('phase', phase);
      if (caption) fd.append('caption', caption);
      if (sort_order != null) fd.append('sort_order', sort_order);
      fd.append('file', file, 'photo.jpg');
      return call('/photo', { method: 'POST', form: fd });
    },
    photoUrl: (token, key) => `${BASE}/photo?${q({ token, key })}`,
    deletePhoto: (token, key) => call(`/photo?${q({ token, key })}`, { method: 'DELETE' }),
    updatePhotoMeta: (token, key, fields) =>
      call('/photo-meta', { method: 'POST', body: { token, key, ...fields } }),

    getSchedule:  (token) => call(`/schedule?${q({ token })}`),
    saveSchedule: (token, fields) => call('/schedule', { method: 'POST', body: { token, ...fields } }),
    saveEstimate: (token, head, items) => call('/estimate', { method: 'POST', body: { token, ...head, items } }),
    followup:     (token, fields) => call('/followup', { method: 'POST', body: { token, ...fields } }),

    // ---- 公開系 ----
    request:  (payload) => call('/request', { method: 'POST', body: payload }),
    register: (token, data) => call('/register', { method: 'POST', body: { token, ...data } }),

    // ---- 管理者系（Supabase OAuthのJWTを渡す）----
    adminCases: (jwt, status) => call(`/cases?${q({ status: status || 'all' })}`, { jwt }),

    // ---- 業者系（SupabaseログインのJWTを渡す）----
    vendorEstimates: (jwt) => call('/vendor-estimates', { jwt }),

    // ---- クライアント圧縮: 画像Fileを最大maxBytes(既定400KB)のJPEG Blobに ----
    async compress(file, maxBytes = 400 * 1024, maxDim = 1600) {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = URL.createObjectURL(file);
      });
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(img.src);

      let qy = 0.85;
      let blob = await toBlob(canvas, qy);
      while (blob.size > maxBytes && qy > 0.35) {
        qy -= 0.1;
        blob = await toBlob(canvas, qy);
      }
      return blob;
    },
  };

  function toBlob(canvas, quality) {
    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
  }
})();

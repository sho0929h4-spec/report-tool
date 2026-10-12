// app/shared/drafts.js — 送信待ちメッセージ下書きの文面生成と一括作成
// case.html の buildNotice / buildSiteReportNoticeText と文面を一致させること（一字一句変えない）

(function (root) {
  'use strict';

  // case.html progressUrl と同一ロジック
  function progressUrl(token) {
    return location.origin + location.pathname.replace(/\/app\/[^/]*$/, '/app/progress.html') + '?t=' + token;
  }

  // case.html fmtDate と同一ロジック（UI が未ロードの場合に備えて自前実装）
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // KIND_MSG は case.html と完全一致
  const KIND_MSG = {
    survey:   '追加の調査が必要と判明いたしました',
    policy:   '作業方針の変更をご提案いたします',
    arrange:  '部材・業者の手配が必要となりました',
    resident: '入居者様対応についてご相談がございます',
    other:    '現地より報告がございます',
  };

  // case.html buildNotice と文面一致
  function buildNoticeBody(kind, c) {
    const url = c.shareToken ? progressUrl(c.shareToken) : '（進捗URLを発行してください）';
    if (kind === 'workStarted') {
      const t = c.workStartedAt ? fmtTime(c.workStartedAt) : '--:--';
      return `【入場通知】${c.propertyName} ${c.roomNo}\n本日 ${t} に作業員が入場し、${c.workType}を開始しました。\n進捗は共有ページでご確認いただけます：\n${url}`;
    }
    if (kind === 'reportReady') {
      return `【報告書完成のお知らせ】${c.propertyName} ${c.roomNo}\n${c.workType}の報告書が完成しました。\n内容は共有ページよりご確認いただけます：\n${url}`;
    }
    // preVisit
    return `【作業前日のご案内】${c.propertyName} ${c.roomNo}\n明日 ${fmtDate(c.scheduledAt)} ${fmtTime(c.scheduledAt)} より「${c.workType}」を実施いたします。\n・所要時間の目安：2〜3時間\n・ご不在でも作業可能な場合は事前にご連絡ください\nご質問は共有ページから承ります：\n${url}`;
  }

  // case.html buildSiteReportNoticeText と文面一致
  function buildSiteReportBody(sr, c) {
    const items = sr.items || [];
    const itemsStr = items.length ? items.join('・') : '（なし）';
    let text = `【現地調査のご報告】${c.propertyName} ${c.roomNo}\n本日の${c.workType}にて、${KIND_MSG[sr.kind] || '報告がございます'}。\n内容: ${itemsStr}`;
    if (sr.note) text += `\n補足: ${sr.note}`;
    text += `\n進め方についてご相談させてください。`;
    return text;
  }

  // 今日のローカル日付を YYYY-MM-DD 形式で返す（new-case.html の todayStr と同一ロジック）
  function localDateStr(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // 明日の日付（YYYY-MM-DD）
  function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localDateStr(d);
  }

  /**
   * triggerType = 'reportReady' | 'preVisit': 全関係者に下書きを作成
   * triggerType = 'siteReport': site_report の recipients に含まれる role の関係者のみ
   *   sr.recipients = ['internal','manager','owner'] のうち manager/owner のみ対象
   *   sh_role の対応: manager→manager, owner→owner
   *
   * @param {string} triggerType
   * @param {object} c - case オブジェクト（Store.getCase の戻り値）
   * @param {Array}  stakeholders - Store.listStakeholders の戻り値
   * @param {object} [sr] - site_report オブジェクト（triggerType === 'siteReport' 時のみ必要）
   * @returns {Array<{sh_role, sh_name, body}>}
   */
  function buildDrafts(triggerType, c, stakeholders, sr) {
    const drafts = [];
    if (triggerType === 'preVisit' || triggerType === 'reportReady') {
      const body = buildNoticeBody(triggerType, c);
      for (const st of stakeholders) {
        drafts.push({ sh_role: st.role, sh_name: st.name, body, stakeholder_id: st.id });
      }
    } else if (triggerType === 'siteReport' && sr) {
      // manager と owner のみ。recipients が空でも関係者がいれば作成
      const targetRoles = new Set();
      if (sr.recipients && sr.recipients.includes('manager')) targetRoles.add('manager');
      if (sr.recipients && sr.recipients.includes('owner')) targetRoles.add('owner');
      // recipients に manager/owner が含まれていない場合は下書きを作らない
      const body = buildSiteReportBody(sr, c);
      for (const st of stakeholders) {
        if (targetRoles.has(st.role)) {
          drafts.push({ sh_role: st.role, sh_name: st.name, body, stakeholder_id: st.id, source_id: sr.id });
        }
      }
    }
    return drafts;
  }

  const Drafts = { buildDrafts, tomorrowStr, localDateStr, buildNoticeBody, buildSiteReportBody };
  if (typeof module !== 'undefined' && module.exports) module.exports = Drafts;
  else root.Drafts = Drafts;
})(typeof window !== 'undefined' ? window : globalThis);

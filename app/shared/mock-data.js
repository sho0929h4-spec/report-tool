// app/shared/mock-data.js — モック。計画2でこのファイルは読み込まなくなる
(function () {
  const at = (days, hm) => { const t = new Date(); t.setDate(t.getDate() + days);
    const [h, m] = (hm || '09:00').split(':'); t.setHours(+h, +m, 0, 0); return t.toISOString(); };
  const day = d => at(d, '12:00').slice(0, 10);
  const agoH = h => new Date(Date.now() - h * 3600000).toISOString();
  window.MOCK = {
    sessions: {
      admin:  { userId:'u-admin',  tenantId:'t1', name:'監督A', role:'admin'  },
      worker: { userId:'u-minami', tenantId:'t1', name:'南',    role:'worker' },
    },
    rates: { defaultRate: 3000, byUser: { 'u-minami': 3500 } },
    cases: [
      { id:'c1', caseNo:'261011-01', propertyName:'パレステュディオ目黒東', roomNo:'502',
        address:'東京都目黒区中目黒1-2-3', scheduledAt:at(0,'10:00'), status:'in_progress',
        workType:'調査', dueDate:day(3), instructions:'305号室天井の漏水。原因特定のため耐圧テスト実施。管理人に声かけしてから入室。',
        tasks:[
          { id:'t11', title:'管理人へ挨拶', assignee:'u-minami', assigneeName:'南',
            status:'done', dueAt:null, stallReason:null, updatedAt:agoH(2) },
          { id:'t12', title:'耐圧テスト（給水）', assignee:'u-minami', assigneeName:'南',
            status:'done', dueAt:null, stallReason:null, updatedAt:agoH(1.5) },
          { id:'t13', title:'耐圧テスト（給湯）', assignee:'u-minami', assigneeName:'南',
            status:'done', dueAt:null, stallReason:null, updatedAt:agoH(1) },
          { id:'t14', title:'天井開口の写真', assignee:'u-minami', assigneeName:'南',
            status:'doing', dueAt:at(0,'17:00'), stallReason:null, updatedAt:agoH(0.5) },
          { id:'t15', title:'入居者へ結果説明', assignee:'u-minami', assigneeName:'南',
            status:'todo', dueAt:at(0,'18:00'), stallReason:null, updatedAt:agoH(0.5) },
        ],
        contacts:[
          { id:'ct1', role:'kanri', roleName:'管理会社', name:'○○管理(株) 田中',
            email:'tanaka@example.com', notify:{ workStarted:true, preVisit:true, reportReady:true } },
        ],
        estimate:null,
        questions:[
          { id:'q1', q:'工事の音はどのくらい出ますか？',
            aiAnswer:'調査作業が中心のため大きな音は出ません。', escalated:false, at:agoH(3) },
          { id:'q2', q:'猫を飼っていますが大丈夫ですか？', aiAnswer:null, escalated:true, at:agoH(1) },
        ],
        cause:'', nextActions:'', assignedTo:'u-minami', assignedName:'南',
        workStartedAt:at(0,'10:05'), workEndedAt:null, invoiceAmount:null, report:null, createdAt:at(-2) },
      { id:'c2', caseNo:'261011-02', propertyName:'森ビル', roomNo:'301',
        address:'東京都港区六本木3-4-5', scheduledAt:at(0,'15:00'), status:'scheduled',
        workType:'作業報告', dueDate:day(0), instructions:'前回調査の補修作業。養生必須。',
        tasks:[
          { id:'t21', title:'養生', assignee:'u-minami', assigneeName:'南',
            status:'todo', dueAt:at(0,'16:00'), stallReason:null, updatedAt:agoH(20) },
          { id:'t22', title:'補修作業', assignee:'u-minami', assigneeName:'南',
            status:'todo', dueAt:at(0,'17:30'), stallReason:null, updatedAt:agoH(20) },
          { id:'t23', title:'作業後写真', assignee:'u-minami', assigneeName:'南',
            status:'todo', dueAt:at(0,'17:30'), stallReason:null, updatedAt:agoH(20) },
        ],
        contacts:[], estimate:null, questions:[],
        cause:'給湯管ピンホール', nextActions:'', assignedTo:'u-minami', assignedName:'南',
        workStartedAt:null, workEndedAt:null, invoiceAmount:null, report:null, createdAt:at(-3) },
      { id:'c3', caseNo:'261008-01', propertyName:'レジデンス福島', roomNo:'603',
        address:'大阪府大阪市福島区福島5-6-7', scheduledAt:at(-3,'13:00'), status:'submitted',
        workType:'調査', dueDate:day(-1), instructions:'603→503への漏水調査',
        tasks:[
          { id:'t31', title:'現地調査', assignee:'u-tanaka', assigneeName:'田中',
            status:'done', dueAt:null, stallReason:null, updatedAt:agoH(72) },
          { id:'t32', title:'報告書作成', assignee:'u-tanaka', assigneeName:'田中',
            status:'done', dueAt:null, stallReason:null, updatedAt:agoH(48) },
          { id:'t33', title:'503号室 クロス張替えの発注承認', assignee:'u-tanaka', assigneeName:'田中',
            status:'waiting_other', dueAt:at(-1,'18:00'),
            stallReason:'管理会社の承認待ち', updatedAt:agoH(26) },
        ],
        contacts:[
          { id:'ct3', role:'kanri', roleName:'管理会社', name:'福島管理(株) 佐々木',
            email:'sasaki@example.com', notify:{ workStarted:true, preVisit:false, reportReady:true } },
        ],
        estimate:{ status:'draft', markup:1.3,
          items:[ { id:'e1', label:'漏水調査 基本料金', qty:1, unit:'式', unitPrice:28000, amount:28000 } ] },
        questions:[],
        cause:'洗濯機排水ホース外れ', nextActions:'503号室の天井クロス張替え見積もり',
        assignedTo:'u-tanaka', assignedName:'田中',
        workStartedAt:at(-3,'13:00'), workEndedAt:at(-3,'15:30'), invoiceAmount:55000,
        report:{ company:'TJ株式会社', workDate:day(-3) }, createdAt:at(-5) },
      { id:'c4', caseNo:'261001-01', propertyName:'セオリー大阪ハーバー', roomNo:'302',
        address:'大阪府大阪市港区築港2-8-9', scheduledAt:at(-10,'09:00'), status:'confirmed',
        workType:'調査', dueDate:null, instructions:'',
        tasks:[], contacts:[], estimate:null, questions:[],
        cause:'ユニットバス防水切れ', nextActions:'完了',
        assignedTo:'u-minami', assignedName:'南',
        workStartedAt:at(-10,'09:00'), workEndedAt:at(-10,'11:00'), invoiceAmount:38000,
        report:{ company:'TJ株式会社', workDate:day(-10) }, createdAt:at(-12) },
      { id:'c5', caseNo:'261015-01', propertyName:'グリタァ六角橋', roomNo:'509',
        address:'神奈川県横浜市神奈川区六角橋1-10-11', scheduledAt:at(4,'11:00'), status:'scheduled',
        workType:'調査', dueDate:day(7), instructions:'410号室への漏水。まず目視調査。',
        tasks:[
          { id:'t51', title:'目視調査', assignee:'u-tanaka', assigneeName:'田中',
            status:'todo', dueAt:at(4,'12:00'), stallReason:null, updatedAt:agoH(12) },
        ],
        contacts:[], estimate:null, questions:[],
        cause:'', nextActions:'', assignedTo:'u-tanaka', assignedName:'田中',
        workStartedAt:null, workEndedAt:null, invoiceAmount:null, report:null, createdAt:at(-1) },
    ],
    costs: {
      c3: [
        { id:'k1', category:'labor', label:'作業員（田中 2.5h）', qty:2.5, unitPrice:3000, amount:7500, isAuto:true },
        { id:'k2', category:'material', label:'止水テープ等', qty:1, unitPrice:2800, amount:2800, isAuto:false },
      ],
    },
    photos: {
      c1: [
        { id:'p1', phase:'before', caption:'天井染み（対応前）', dataUrl:'' },
        { id:'p2', phase:'during', caption:'耐圧テスト中', dataUrl:'' },
      ],
    },
  };
})();

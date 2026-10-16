/**
 * TẬP ĐOÀN ABG – TRÌNH KÝ: LÕI NGHIỆP VỤ
 * Dùng chung cho máy chủ Apps Script (TrinhKyServer.gs) và bản demo trên trình duyệt (core.js).
 * Không gọi trực tiếp Sheet/Drive/Email: mọi việc bên ngoài đi qua đối tượng env.
 *
 * Lưu ý pháp lý: đây là PHÊ DUYỆT NỘI BỘ có ghi vết, KHÔNG phải chữ ký số theo Luật Giao dịch điện tử.
 */
var TK = {
  ST: { DRAFT: 'Nháp', WAIT: 'Chờ ký', FIX: 'Bổ sung', REJ: 'Từ chối', DONE: 'Hoàn tất', WD: 'Thu hồi' },
  STEP: { TODO: 'Chưa tới', WAIT: 'Chờ', SIGNED: 'Đã ký', FIX: 'Bổ sung', REJ: 'Từ chối', VOID: 'Đã hủy', SKIP: 'Bỏ qua' },
  ALL_TYPES: 'Tất cả',
  URGENCY: ['Thường', 'Khẩn'],
  UNITS: ['giờ', 'ngày'],
  MAX_STEPS: 5, MAX_WATCH: 10, PAGE: 20,
  TITLE_MAX: 200, TEXT_MAX: 1000,
  MAX_PDF_MB: 10, MAX_IMG_MB: 5, MAX_PDFS: 5, MAX_IMGS: 5,
  VN: 7 * 3600e3, // Việt Nam UTC+7, không có giờ mùa hè
  RANK: { 'Quản trị viên': 3, 'Admin': 3, 'Quản lý': 2, 'Nhân viên': 1 }
};

/* ---------- Thời hạn ký: TRỪ CHỦ NHẬT (00:00–24:00 giờ Việt Nam) ---------- */

// Cộng thời hạn (giờ/ngày) vào mốc start (ms), bỏ qua Chủ nhật. 1 ngày = 24 giờ làm việc.
function tkAddWorkingTime_(start, amount, unit) {
  var rem = Number(amount) * (unit === 'giờ' ? 3600e3 : 864e5);
  var t = Number(start) + TK.VN;
  while (rem > 0) {
    var d = new Date(t);
    var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    if (d.getUTCDay() === 0) { t = next; continue; }
    var step = Math.min(rem, next - t);
    t += step; rem -= step;
  }
  return t - TK.VN;
}

// Số ms làm việc (không tính Chủ nhật) từ a tới b. Âm nếu b trước a.
function tkWorkingMs_(a, b) {
  a = Number(a); b = Number(b);
  if (b < a) return -tkWorkingMs_(b, a);
  var t = a + TK.VN, end = b + TK.VN, total = 0;
  while (t < end) {
    var d = new Date(t);
    var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    var seg = Math.min(end, next) - t;
    if (d.getUTCDay() !== 0) total += seg;
    t += seg;
  }
  return total;
}

function tkVnParts_(ms) {
  var d = new Date(Number(ms) + TK.VN);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}
function tkZ_(n) { return (n < 10 ? '0' : '') + n; }
function tkYmd_(ms) { var p = tkVnParts_(ms); return p.y + '-' + tkZ_(p.m) + '-' + tkZ_(p.d); }
function tkFmt_(ms) {
  if (!ms) return '';
  var p = tkVnParts_(ms);
  return ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][p.dow] + ' ' + tkZ_(p.d) + '/' + tkZ_(p.m) + '/' + p.y + ' ' + tkZ_(p.h) + ':' + tkZ_(p.mi);
}
function tkDur_(ms) {
  ms = Math.abs(ms);
  var mins = Math.round(ms / 60000);
  if (mins < 60) return mins + ' phút';
  var h = Math.round(ms / 3600e3);
  if (h < 48) return h + ' giờ';
  var d = Math.floor(h / 24), r = h % 24;
  return d + ' ngày' + (r ? ' ' + r + ' giờ' : '');
}
function tkMoney_(n) { return n ? String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' đ' : ''; }

/* ---------- Lõi nghiệp vụ ----------
 * db  = { requests:[], steps:[], flows:[], types:[], staff:[], dirty:{} }
 * env = { now, log, readLog, mail, verifyPassword, checkStaged, attach, hashFile, trash, makeReceipt, fileData, nextSeq }
 */
function tkCore_(db, env) {
  var ST = TK.ST, SS = TK.STEP;
  var lc = function (s) { return String(s || '').trim().toLowerCase(); };
  var txt = function (s) { return String(s == null ? '' : s).trim(); };
  function fail(m) { throw new Error(m); }
  function dirty() { for (var i = 0; i < arguments.length; i++) db.dirty[arguments[i]] = true; }
  function rank(s) { return TK.RANK[s.role] || 1; }
  function person(email) { email = lc(email); return db.staff.filter(function (s) { return s.email === email; })[0] || null; }
  function active(email) { var s = person(email); return s && s.active ? s : null; }
  function nameOf(email) { var s = person(email); return s ? s.name : email; }
  function reqOf(id) {
    var r = db.requests.filter(function (x) { return x.id === id; })[0];
    if (!r) fail('Không tìm thấy tờ trình (có thể đã bị xóa).');
    return r;
  }
  function stepsOf(r) { return db.steps.filter(function (s) { return s.reqId === r.id; }); }
  function roundOf(r) { return stepsOf(r).reduce(function (m, s) { return Math.max(m, s.round || 1); }, 0); }
  function curSteps(r) {
    var rd = roundOf(r);
    return stepsOf(r).filter(function (s) { return (s.round || 1) === rd; }).sort(function (a, b) { return a.order - b.order; });
  }
  function curStep(r) {
    if (r.status !== ST.WAIT) return null;
    return curSteps(r).filter(function (s) { return s.status === SS.WAIT; })[0] || null;
  }
  function watchers(r) {
    return String(r.watchers || '').split(',').map(txt).filter(Boolean).map(function (x) {
      return { email: lc(x.replace(/[*#]$/, '')), kind: /\*$/.test(x) ? 'default' : /#$/.test(x) ? 'admin' : 'user' };
    });
  }
  function setWatchers(r, list) {
    r.watchers = list.map(function (w) { return w.email + (w.kind === 'default' ? '*' : w.kind === 'admin' ? '#' : ''); }).join(', ');
  }
  function isSigner(r, email) {
    return curSteps(r).some(function (s) { return s.email === email && s.status !== SS.VOID && s.status !== SS.SKIP; });
  }
  function canView(u, r) {
    if (u.isAdmin || r.submitterEmail === u.email) return true;
    if (r.status === ST.DRAFT) return false;
    if (stepsOf(r).some(function (s) { return s.email === u.email || s.prevEmail === u.email; })) return true;
    if (watchers(r).some(function (w) { return w.email === u.email; })) return true;
    return !!(u.isManager && r.dept === u.dept);
  }
  function mainPdf(r) { return r.pdfs[r.pdfs.length - 1]; }
  function findFlow(dept, type) {
    var act = db.flows.filter(function (f) { return f.status !== 'Ngừng' && f.dept === dept; });
    return act.filter(function (f) { return f.docType === type; })[0] ||
      act.filter(function (f) { return f.docType === TK.ALL_TYPES; })[0] || null;
  }
  function activeTypes() { return db.types.filter(function (t) { return t.status !== 'Ngừng'; }).map(function (t) { return t.name; }); }
  function head(r) { return '<b>' + esc(r.id + ' – ' + r.title) + '</b><br>' + esc(r.docType) + ' · ' + esc(r.dept) + (r.amount ? ' · ' + tkMoney_(r.amount) : '') + (r.urgency === 'Khẩn' ? ' · <b style="color:#c0392b">KHẨN</b>' : ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function watcherEmails(r) { return watchers(r).map(function (w) { return w.email; }); }
  function limitText(s, n, label) { s = txt(s); if (s.length > n) fail(label + ' tối đa ' + n + ' ký tự.'); return s; }

  function summary(r, now) {
    var st = curStep(r);
    var o = {
      id: r.id, title: r.title, docType: r.docType, dept: r.dept, submitterName: r.submitterName, submitterEmail: r.submitterEmail,
      amount: r.amount, urgency: r.urgency, status: r.status, curStep: r.curStep, totalSteps: r.totalSteps,
      createdAt: r.createdAt, updatedAt: r.updatedAt
    };
    if (st) { o.holderName = st.name; o.holderEmail = st.email; o.dueAt = st.dueAt; o.leftMs = tkWorkingMs_(now, st.dueAt); o.overdue = o.leftMs < 0; }
    return o;
  }

  function counts(list) {
    var c = { 'Chờ ký': 0, 'Bổ sung': 0, 'Quá hạn': 0, 'Hoàn tất': 0, 'Từ chối': 0, 'Thu hồi': 0 };
    list.forEach(function (x) { if (c[x.status] !== undefined) c[x.status]++; if (x.overdue) c['Quá hạn']++; });
    return c;
  }

  function activate(r, st, now) {
    st.status = SS.WAIT; st.startedAt = now; st.dueAt = tkAddWorkingTime_(now, st.amount, st.unit); st.lastRemind = '';
    r.curStep = st.order;
    env.mail([st.email], '[Chờ bạn ký] ' + r.id + ' – ' + r.title, [
      r.submitterName + ' trình văn bản cần bạn phê duyệt (bước ' + st.order + '/' + r.totalSteps + ').', head(r),
      'Hạn ký: <b>' + tkFmt_(st.dueAt) + '</b> (' + st.amount + ' ' + st.unit + ', không tính Chủ nhật).',
      'Mở ứng dụng → mục "Chờ tôi ký" để xem văn bản và ký.'
    ]);
  }

  // Trình (lần đầu) hoặc nộp lại: chụp luồng ký và bắt đầu từ BƯỚC 1
  function doSubmit(u, r, note, now) {
    var old = stepsOf(r), rows, rd;
    if (!old.length) {
      var fl = findFlow(r.dept, r.docType);
      if (!fl) fail('Bộ phận "' + r.dept + '" chưa có luồng ký cho loại "' + r.docType + '". Vui lòng liên hệ Quản trị viên.');
      rows = fl.steps.map(function (x) {
        var s = active(x.email);
        if (!s) fail('Người ký ' + x.email + ' trong luồng ký không còn làm việc. Vui lòng báo Quản trị viên sửa luồng.');
        return { email: s.email, name: s.name, dept: s.dept, amount: x.amount, unit: x.unit };
      });
      rd = 1;
      // người theo dõi mặc định của luồng (bỏ người trình và người ký)
      var ws = watchers(r).filter(function (w) { return w.kind !== 'default'; });
      (fl.watchers || []).forEach(function (e) {
        e = lc(e);
        if (e === r.submitterEmail || rows.some(function (x) { return x.email === e; }) || !active(e)) return;
        ws = ws.filter(function (w) { return w.email !== e; });
        ws.unshift({ email: e, kind: 'default' });
      });
      ws = ws.filter(function (w) { return !rows.some(function (x) { return x.email === w.email; }); });
      setWatchers(r, ws.slice(0, TK.MAX_WATCH));
    } else {
      rd = roundOf(r);
      rows = old.filter(function (s) { return (s.round || 1) === rd; }).sort(function (a, b) { return a.order - b.order; })
        .map(function (s) { return { email: s.email, name: s.name, dept: s.dept, amount: s.amount, unit: s.unit }; });
      rd++;
    }
    if (rows.every(function (x) { return x.email === r.submitterEmail; }))
      fail('Luồng ký chỉ có chính bạn nên không thể tự ký. Vui lòng liên hệ Quản trị viên.');
    // hủy mọi chữ ký / bước còn dở của các lượt trước
    old.forEach(function (s) { if (s.status === SS.SIGNED || s.status === SS.WAIT || s.status === SS.TODO) s.status = SS.VOID; });
    rows.forEach(function (x, i) {
      var skip = x.email === r.submitterEmail;
      db.steps.push({
        reqId: r.id, order: i + 1, email: x.email, name: x.name, dept: x.dept, amount: Number(x.amount), unit: x.unit,
        startedAt: '', dueAt: '', status: skip ? SS.SKIP : SS.TODO, at: '', onTime: '',
        comment: skip ? 'Người trình – bỏ qua' : '', sha: '', note: '', round: rd, lastRemind: '', prevEmail: ''
      });
    });
    r.totalSteps = rows.length; r.status = ST.WAIT; r.updatedAt = now;
    var first = curSteps(r).filter(function (s) { return s.status === SS.TODO; })[0];
    activate(r, first, now);
    var ws2 = watcherEmails(r);
    if (ws2.length) env.mail(ws2, '[Theo dõi] ' + r.id + ' – ' + r.title + (rd > 1 ? ' (trình lại)' : ''), [
      r.submitterName + (rd > 1 ? ' đã nộp lại tờ trình, ký lại từ bước 1.' : ' vừa trình văn bản. Bạn là người theo dõi (chỉ xem).'),
      head(r), note ? 'Ghi chú: ' + esc(note) : ''
    ]);
    dirty('requests', 'steps');
  }

  function complete(r, now) {
    r.status = ST.DONE; r.curStep = r.totalSteps; r.updatedAt = now;
    var data = receiptData(r);
    try { r.receipt = env.makeReceipt(data) || ''; } catch (e) { r.receipt = ''; }
    var signers = curSteps(r).filter(function (s) { return s.status === SS.SIGNED; }).map(function (s) { return s.email; });
    env.mail([r.submitterEmail].concat(signers, watcherEmails(r)), '[Hoàn tất] ' + r.id + ' – ' + r.title, [
      'Tờ trình đã được ký duyệt đầy đủ ' + signers.length + ' bước.', head(r),
      'SHA-256 tệp gốc: <code>' + esc(r.sha) + '</code>',
      'Lưu ý: đây là phê duyệt nội bộ, không phải chữ ký số.'
    ]);
  }

  function receiptData(r) {
    return {
      id: r.id, title: r.title, docType: r.docType, dept: r.dept, summary: r.summary, amount: r.amount ? tkMoney_(r.amount) : '',
      urgency: r.urgency, submitter: r.submitterName + ' (' + r.submitterEmail + ')', createdAt: tkFmt_(r.createdAt),
      version: r.version, file: mainPdf(r) ? mainPdf(r).name : '', sha: r.sha,
      watchers: watchers(r).map(function (w) { return nameOf(w.email); }),
      steps: curSteps(r).map(function (s) {
        return { order: s.order, name: s.name, dept: s.dept, status: s.status, at: tkFmt_(s.at), onTime: s.onTime, comment: s.comment, note: s.note };
      })
    };
  }

  function stepView(s, now) {
    var o = {
      order: s.order, name: s.name, email: s.email, dept: s.dept, amount: s.amount, unit: s.unit, status: s.status,
      startedAt: s.startedAt, dueAt: s.dueAt, at: s.at, onTime: s.onTime, comment: s.comment, note: s.note, round: s.round || 1,
      sha: s.sha ? String(s.sha).slice(0, 12) : ''
    };
    if (s.status === SS.WAIT && s.dueAt) o.leftMs = tkWorkingMs_(now, s.dueAt);
    return o;
  }

  function filterList(base, f, u) {
    f = f || {};
    var q = lc(f.q), sts = Array.isArray(f.statuses) ? f.statuses : [];
    return base.filter(function (x) {
      if (sts.length && sts.indexOf(x.status) < 0) return false;
      if (f.overdueOnly && !x.overdue) return false;
      if (f.submitter && x.submitterEmail !== lc(f.submitter)) return false;
      if (f.docType && x.docType !== f.docType) return false;
      if (f.dept && u.isAdmin && x.dept !== f.dept) return false;
      var day = tkYmd_(x.createdAt);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      if (q && (x.id + ' ' + x.title + ' ' + x.submitterName).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  var api = {
    /* Dữ liệu khởi động cho giao diện */
    bootstrap: function (u) {
      var now = env.now();
      var toSign = db.requests.filter(function (r) { var s = curStep(r); return s && s.email === u.email; });
      return {
        user: { name: u.name, email: u.email, role: u.role, dept: u.dept, isAdmin: u.isAdmin, isManager: u.isManager },
        staff: db.staff.filter(function (s) { return s.active; }).map(function (s) { return { name: s.name, email: s.email, dept: s.dept, role: s.role }; }),
        docTypes: activeTypes(),
        counts: {
          toSign: toSign.length,
          toSignOver: toSign.filter(function (r) { return tkWorkingMs_(now, curStep(r).dueAt) < 0; }).length,
          needFix: db.requests.filter(function (r) { return r.submitterEmail === u.email && r.status === ST.FIX; }).length
        },
        limits: { maxPdfMB: TK.MAX_PDF_MB, maxImgMB: TK.MAX_IMG_MB, maxPdfs: TK.MAX_PDFS, maxImgs: TK.MAX_IMGS, maxWatch: TK.MAX_WATCH, maxSteps: TK.MAX_STEPS },
        now: now
      };
    },

    /* Danh sách: box = toSign | mine | watch | dept */
    list: function (u, box, filter, offset) {
      var now = env.now(), items;
      if (box === 'toSign') items = db.requests.filter(function (r) { var s = curStep(r); return s && s.email === u.email; });
      else if (box === 'mine') items = db.requests.filter(function (r) { return r.submitterEmail === u.email; });
      else if (box === 'watch') items = db.requests.filter(function (r) { return r.status !== ST.DRAFT && watcherEmails(r).indexOf(u.email) >= 0; });
      else if (box === 'dept') {
        if (!u.isManager) fail('Chỉ Quản lý và Quản trị viên được xem tờ trình của bộ phận.');
        items = db.requests.filter(function (r) { return r.status !== ST.DRAFT && (u.isAdmin || r.dept === u.dept); });
      } else fail('Mục không hợp lệ.');
      var base = items.map(function (r) { return summary(r, now); });
      var res = filterList(base, filter, u);
      if (box === 'toSign') res.sort(function (a, b) { return (a.dueAt || 0) - (b.dueAt || 0); });
      else res.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0) || String(b.id).localeCompare(String(a.id)); });
      var off = Math.max(0, Number(offset) || 0);
      var subs = {};
      base.forEach(function (x) { subs[x.submitterEmail] = x.submitterName; });
      return {
        box: box, items: res.slice(off, off + TK.PAGE), total: res.length, all: base.length, offset: off, page: TK.PAGE,
        counts: counts(base),
        submitters: Object.keys(subs).map(function (e) { return { email: e, name: subs[e] }; }),
        depts: u.isAdmin ? base.map(function (x) { return x.dept; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort() : [],
        docTypes: db.types.map(function (t) { return t.name; })
      };
    },

    /* Chi tiết tờ trình */
    get: function (u, id) {
      var r = reqOf(id);
      if (!canView(u, r)) fail('Bạn không có quyền xem tờ trình này.');
      var now = env.now(), cs = curStep(r), mine = r.submitterEmail === u.email;
      var cur = curSteps(r), rd = roundOf(r);
      var open = r.status !== ST.DONE && r.status !== ST.REJ;
      var signedNow = cur.some(function (s) { return s.status === SS.SIGNED; });
      return {
        req: {
          id: r.id, title: r.title, docType: r.docType, dept: r.dept, summary: r.summary, amount: r.amount, urgency: r.urgency,
          needBy: r.needBy, submitterName: r.submitterName, submitterEmail: r.submitterEmail, createdAt: r.createdAt,
          updatedAt: r.updatedAt, status: r.status, curStep: r.curStep, totalSteps: r.totalSteps, linkedTask: r.linkedTask,
          version: r.version, sha: r.sha, round: rd,
          pdfs: r.pdfs.map(function (p) { return { id: p.id, name: p.name, size: p.size, v: p.v }; }),
          attachments: r.attachments.map(function (p) { return { id: p.id, name: p.name, size: p.size, kind: p.kind }; }),
          receipt: r.receipt ? { id: r.receipt.id, name: r.receipt.name } : null,
          watchers: watchers(r).map(function (w) {
            return { email: w.email, name: nameOf(w.email), kind: w.kind, canRemove: open && (u.isAdmin || (mine && w.kind === 'user')) };
          })
        },
        steps: cur.map(function (s) { return stepView(s, now); }),
        oldSteps: stepsOf(r).filter(function (s) { return (s.round || 1) < rd; })
          .sort(function (a, b) { return (b.round - a.round) || (a.order - b.order); }).map(function (s) { return stepView(s, now); }),
        receiptData: r.status === ST.DONE ? receiptData(r) : null,
        history: env.readLog(r.id),
        perms: {
          sign: !!(cs && cs.email === u.email),
          withdraw: mine && r.status === ST.WAIT && !signedNow,
          resubmit: mine && [ST.DRAFT, ST.WD, ST.FIX].indexOf(r.status) >= 0,
          addWatcher: (mine || u.isAdmin) && open,
          reassign: !!(u.isAdmin && cs),
          del: !!u.isAdmin
        },
        now: now
      };
    },

    /* Xem trước luồng ký sẽ áp dụng (người trình chỉ xem) */
    flowPreview: function (u, docType) {
      var fl = findFlow(u.dept, docType), now = env.now();
      if (!fl) return { flow: null, message: 'Bộ phận "' + u.dept + '" chưa có luồng ký cho loại này. Liên hệ Quản trị viên.' };
      var t = now;
      var steps = fl.steps.map(function (x, i) {
        var s = person(x.email), skip = lc(x.email) === u.email;
        if (!skip) t = tkAddWorkingTime_(t, x.amount, x.unit);
        return { order: i + 1, email: lc(x.email), name: s ? s.name : x.email, dept: s ? s.dept : '', role: s ? s.role : '', amount: x.amount, unit: x.unit, skip: skip, inactive: !s || !s.active };
      });
      return {
        flow: { id: fl.id, name: fl.name, docType: fl.docType, steps: steps, latest: t },
        defaultWatchers: (fl.watchers || []).filter(function (e) { return lc(e) !== u.email; }).map(function (e) { return { email: lc(e), name: nameOf(e) }; })
      };
    },

    /* Tạo tờ trình: submitNow = true để trình ngay, false = lưu nháp */
    create: function (u, d, submitNow) {
      d = d || {};
      var now = env.now();
      var title = limitText(d.title, TK.TITLE_MAX, 'Tiêu đề');
      if (!title) fail('Vui lòng nhập tiêu đề.');
      var docType = txt(d.docType);
      if (activeTypes().indexOf(docType) < 0) fail('Vui lòng chọn loại văn bản (đang dùng).');
      var summaryTxt = limitText(d.summary, TK.TEXT_MAX, 'Tóm tắt');
      var amount = Number(String(d.amount || '').replace(/[^\d]/g, '')) || '';
      if (amount && amount > 1e13) fail('Số tiền không hợp lệ.');
      var urgency = TK.URGENCY.indexOf(d.urgency) >= 0 ? d.urgency : 'Thường';
      var needBy = /^\d{4}-\d{2}-\d{2}$/.test(String(d.needBy || '')) ? d.needBy : '';
      var linked = txt(d.linkedTask).toUpperCase();
      if (linked && !/^CV-\d{1,6}$/.test(linked)) fail('Mã việc liên kết phải có dạng CV-0001.');
      if (!d.mainPdf) fail('Vui lòng chọn tệp PDF chính.');
      var dept = u.dept || 'Chưa xếp bộ phận';
      var fl = findFlow(dept, docType);
      if (submitNow && !fl) fail('Bộ phận "' + dept + '" chưa có luồng ký cho loại "' + docType + '". Vui lòng liên hệ Quản trị viên.');
      // người theo dõi
      var signerEmails = fl ? fl.steps.map(function (x) { return lc(x.email); }) : [];
      var ws = [];
      (d.watchers || []).forEach(function (e) {
        e = lc(e);
        if (!e || ws.some(function (w) { return w.email === e; })) return;
        if (e === u.email) fail('Không cần thêm chính bạn làm người theo dõi.');
        if (signerEmails.indexOf(e) >= 0) fail(nameOf(e) + ' đã nằm trong luồng ký (đã nhận thông báo).');
        if (!active(e)) fail('Người theo dõi ' + e + ' không có trong danh sách nhân sự đang làm việc.');
        ws.push({ email: e, kind: 'user' });
      });
      var defs = fl ? (fl.watchers || []).filter(function (e) { return lc(e) !== u.email && signerEmails.indexOf(lc(e)) < 0; }) : [];
      if (ws.filter(function (w) { return defs.indexOf(w.email) < 0; }).length + defs.length > TK.MAX_WATCH)
        fail('Tối đa ' + TK.MAX_WATCH + ' người theo dõi (kể cả người theo dõi mặc định).');
      // tệp
      var ids = [d.mainPdf].concat(d.attachments || []);
      var metas = env.checkStaged(u, ids);
      if (metas[0].kind !== 'pdf') fail('Tệp chính phải là PDF.');
      var ex = metas.slice(1);
      if (ex.filter(function (m) { return m.kind === 'pdf'; }).length > TK.MAX_PDFS) fail('Phụ lục tối đa ' + TK.MAX_PDFS + ' tệp PDF.');
      if (ex.filter(function (m) { return m.kind === 'img'; }).length > TK.MAX_IMGS) fail('Phụ lục tối đa ' + TK.MAX_IMGS + ' ảnh.');

      var y = tkVnParts_(now).y;
      var maxNo = db.requests.reduce(function (m, r) { var x = String(r.id).match(/^TT-(\d{4})-(\d+)$/); return x && Number(x[1]) === y ? Math.max(m, Number(x[2])) : m; }, 0);
      // số thứ tự không dùng lại kể cả khi tờ trình đã bị xóa
      var id = 'TT-' + y + '-' + String(env.nextSeq(y, maxNo)).padStart(4, '0');
      var files = env.attach(metas, id);
      var main = files[0];
      var r = {
        id: id, title: title, docType: docType, dept: dept, summary: summaryTxt, amount: amount, urgency: urgency, needBy: needBy,
        submitterName: u.name, submitterEmail: u.email, createdAt: now, status: ST.DRAFT, curStep: '', totalSteps: fl ? fl.steps.length : '',
        pdfs: [{ v: 1, id: main.id, name: main.name, size: main.size, url: main.url }], sha: env.hashFile(main.id), version: 1,
        attachments: files.slice(1), linkedTask: linked, receipt: '', updatedAt: now, watchers: ''
      };
      setWatchers(r, ws);
      db.requests.push(r);
      dirty('requests');
      env.log(id, u, 'Tạo tờ trình', title + ' · ' + docType + ' · PDF ' + main.name + ' · SHA-256 ' + r.sha.slice(0, 12) +
        (ws.length ? ' · theo dõi: ' + ws.map(function (w) { return nameOf(w.email); }).join(', ') : ''));
      if (submitNow) {
        doSubmit(u, r, '', now);
        env.log(id, u, 'Trình ký', 'Luồng ' + (fl.name || fl.id) + ': ' + curSteps(r).map(function (s) { return s.order + '. ' + s.name + (s.status === SS.SKIP ? ' (bỏ qua)' : ' – ' + s.amount + ' ' + s.unit); }).join(' → '));
      }
      return { id: id };
    },

    /* Trình nháp / nộp lại sau Thu hồi hoặc Bổ sung → ký lại từ BƯỚC 1 */
    submit: function (u, id, newPdfId, note) {
      var r = reqOf(id), now = env.now();
      if (r.submitterEmail !== u.email) fail('Chỉ người trình mới được nộp tờ trình này.');
      if ([ST.DRAFT, ST.WD, ST.FIX].indexOf(r.status) < 0) fail('Tờ trình đang "' + r.status + '", không nộp lại được.');
      note = limitText(note, TK.TEXT_MAX, 'Ghi chú');
      if (r.status === ST.FIX && !newPdfId && !note) fail('Vui lòng tải PDF đã sửa hoặc ghi rõ phần đã bổ sung.');
      var prev = r.status;
      if (newPdfId) {
        var m = env.checkStaged(u, [newPdfId]);
        if (m[0].kind !== 'pdf') fail('Tệp mới phải là PDF.');
        var f = env.attach(m, r.id + '_v' + (r.version + 1))[0];
        r.version = Number(r.version || 1) + 1;
        r.pdfs.push({ v: r.version, id: f.id, name: f.name, size: f.size, url: f.url });
        r.sha = env.hashFile(f.id);
      }
      doSubmit(u, r, note, now);
      env.log(r.id, u, prev === ST.DRAFT ? 'Trình ký' : 'Nộp lại – ký lại từ bước 1',
        (newPdfId ? 'PDF phiên bản ' + r.version + ', SHA-256 ' + r.sha.slice(0, 12) + '. ' : '') + (note ? 'Ghi chú: ' + note : '') +
        (prev !== ST.DRAFT ? ' Các chữ ký cũ chuyển "Đã hủy".' : ''));
      return { id: r.id };
    },

    /* Người trình thu hồi khi chưa ai ký */
    withdraw: function (u, id) {
      var r = reqOf(id), now = env.now();
      if (r.submitterEmail !== u.email) fail('Chỉ người trình mới được thu hồi.');
      if (r.status !== ST.WAIT) fail('Chỉ thu hồi được tờ trình đang chờ ký.');
      var cur = curSteps(r);
      if (cur.some(function (s) { return s.status === SS.SIGNED; })) fail('Đã có người ký nên không thể thu hồi.');
      var cs = curStep(r);
      cur.forEach(function (s) { if (s.status === SS.WAIT || s.status === SS.TODO) s.status = SS.VOID; });
      r.status = ST.WD; r.updatedAt = now; r.curStep = '';
      dirty('requests', 'steps');
      env.log(r.id, u, 'Thu hồi', 'Người trình thu hồi tờ trình.');
      if (cs) env.mail([cs.email], '[Đã thu hồi] ' + r.id + ' – ' + r.title, [u.name + ' đã thu hồi tờ trình này. Bạn không cần ký nữa.', head(r)]);
      return { id: r.id };
    },

    /* KÝ DUYỆT: nhập lại mật khẩu, kiểm tra SHA-256 trước khi ghi */
    sign: function (u, id, password, comment) {
      var r = reqOf(id), now = env.now(), st = curStep(r);
      if (!st || st.email !== u.email) fail('Bạn không phải người ký ở bước hiện tại của tờ trình này.');
      comment = limitText(comment, TK.TEXT_MAX, 'Ý kiến');
      env.verifyPassword(u.email, password);
      var h = env.hashFile(mainPdf(r).id);
      if (h !== r.sha) {
        env.log(r.id, u, 'Chặn ký – tệp bị thay đổi', 'SHA-256 lúc trình ' + String(r.sha).slice(0, 12) + ' ≠ hiện tại ' + String(h).slice(0, 12));
        fail('Tệp đã bị thay đổi sau khi trình (mã SHA-256 không khớp). Không thể ký. Vui lòng báo Quản trị viên.');
      }
      var late = tkWorkingMs_(st.dueAt, now);
      st.status = SS.SIGNED; st.at = now; st.comment = comment; st.sha = h;
      st.onTime = late > 60000 ? 'Trễ ' + tkDur_(late) : 'Đúng hạn';
      r.updatedAt = now;
      dirty('requests', 'steps');
      env.log(r.id, u, 'Ký duyệt bước ' + st.order, (comment ? 'Ý kiến: ' + comment + ' · ' : '') + st.onTime + ' · SHA-256 ' + h.slice(0, 12));
      var next = curSteps(r).filter(function (s) { return s.order > st.order && s.status === SS.TODO; })[0];
      if (next) activate(r, next, now);
      else { complete(r, now); env.log(r.id, u, 'Hoàn tất', 'Đã ký đủ ' + r.totalSteps + ' bước' + (r.receipt ? ', đã tạo phiếu xác nhận PDF' : '')); }
      return { id: r.id, status: r.status };
    },

    /* YÊU CẦU BỔ SUNG: bắt buộc lý do */
    requestChanges: function (u, id, reason) {
      var r = reqOf(id), now = env.now(), st = curStep(r);
      if (!st || st.email !== u.email) fail('Bạn không phải người ký ở bước hiện tại của tờ trình này.');
      reason = limitText(reason, TK.TEXT_MAX, 'Lý do');
      if (!reason) fail('Vui lòng ghi rõ cần bổ sung gì.');
      st.status = SS.FIX; st.at = now; st.comment = reason;
      r.status = ST.FIX; r.updatedAt = now;
      dirty('requests', 'steps');
      env.log(r.id, u, 'Yêu cầu bổ sung (bước ' + st.order + ')', reason);
      env.mail([r.submitterEmail].concat(watcherEmails(r)), '[Cần bổ sung] ' + r.id + ' – ' + r.title, [
        u.name + ' yêu cầu bổ sung tờ trình.', head(r), 'Lý do: ' + esc(reason),
        'Người trình mở tờ trình, tải PDF đã sửa hoặc ghi chú rồi bấm "Nộp lại". Luồng sẽ ký lại từ bước 1.'
      ]);
      return { id: r.id, status: r.status };
    },

    /* TỪ CHỐI: kết thúc hẳn, không mở lại được */
    reject: function (u, id, reason) {
      var r = reqOf(id), now = env.now(), st = curStep(r);
      if (!st || st.email !== u.email) fail('Bạn không phải người ký ở bước hiện tại của tờ trình này.');
      reason = limitText(reason, TK.TEXT_MAX, 'Lý do');
      if (!reason) fail('Vui lòng ghi lý do từ chối.');
      st.status = SS.REJ; st.at = now; st.comment = reason;
      curSteps(r).forEach(function (s) { if (s.status === SS.TODO) s.status = SS.VOID; });
      r.status = ST.REJ; r.updatedAt = now; r.curStep = st.order;
      dirty('requests', 'steps');
      env.log(r.id, u, 'Từ chối (bước ' + st.order + ')', reason);
      var signed = curSteps(r).filter(function (s) { return s.status === SS.SIGNED; }).map(function (s) { return s.email; });
      env.mail([r.submitterEmail].concat(signed, watcherEmails(r)), '[Từ chối] ' + r.id + ' – ' + r.title, [
        u.name + ' đã từ chối tờ trình. Tờ trình kết thúc, không nộp lại được; muốn trình lại vui lòng tạo tờ trình mới.',
        head(r), 'Lý do: ' + esc(reason)
      ]);
      return { id: r.id, status: r.status };
    },

    /* ỦY QUYỀN: chuyển bước của mình cho người cùng hoặc cao hơn vai trò, giữ hạn */
    delegate: function (u, id, toEmail, reason) {
      var r = reqOf(id), st = curStep(r);
      if (!st || st.email !== u.email) fail('Bạn không phải người ký ở bước hiện tại của tờ trình này.');
      reason = limitText(reason, TK.TEXT_MAX, 'Lý do');
      if (!reason) fail('Vui lòng ghi lý do ủy quyền.');
      var to = active(toEmail);
      if (!to) fail('Vui lòng chọn người nhận ủy quyền (đang làm việc).');
      if (to.email === u.email) fail('Không thể ủy quyền cho chính mình.');
      if (to.email === r.submitterEmail) fail('Không thể ủy quyền cho người trình.');
      if (rank(to) < rank(person(u.email) || u)) fail('Chỉ ủy quyền cho người cùng hoặc cao hơn vai trò của bạn.');
      if (isSigner(r, to.email)) fail(to.name + ' đã nằm trong luồng ký của tờ trình này.');
      return moveStep(u, r, st, to, 'Ủy quyền từ ' + u.name + ': ' + reason, 'Ủy quyền ký', u.name + ' ủy quyền cho bạn ký thay.');
    },

    /* QTV đổi người ký của bước đang chờ (không ký thay) */
    reassign: function (u, id, toEmail, reason) {
      if (!u.isAdmin) fail('Chỉ Quản trị viên được đổi người ký.');
      var r = reqOf(id), st = curStep(r);
      if (!st) fail('Tờ trình không có bước nào đang chờ ký.');
      reason = limitText(reason, TK.TEXT_MAX, 'Lý do');
      if (!reason) fail('Vui lòng ghi lý do đổi người ký.');
      var to = active(toEmail);
      if (!to) fail('Vui lòng chọn người ký mới (đang làm việc).');
      if (to.email === st.email) fail('Người này đang giữ bước ký.');
      if (to.email === u.email) fail('Quản trị viên không được tự nhận ký thay người khác.');
      if (to.email === r.submitterEmail) fail('Không thể giao cho người trình.');
      if (isSigner(r, to.email)) fail(to.name + ' đã nằm trong luồng ký của tờ trình này.');
      return moveStep(u, r, st, to, 'Đổi người bởi ' + u.name + ' (QTV): ' + reason, 'Đổi người ký', 'Quản trị viên giao bước ký này cho bạn.');
    },

    addWatchers: function (u, id, emails) {
      var r = reqOf(id), mine = r.submitterEmail === u.email;
      if (!mine && !u.isAdmin) fail('Chỉ người trình hoặc Quản trị viên được thêm người theo dõi.');
      if (r.status === ST.DONE || r.status === ST.REJ) fail('Tờ trình đã kết thúc, không thêm người theo dõi được.');
      var ws = watchers(r), added = [];
      (emails || []).forEach(function (e) {
        e = lc(e);
        if (!e || ws.some(function (w) { return w.email === e; })) return;
        var s = active(e);
        if (!s) fail('Không tìm thấy nhân sự ' + e + '.');
        if (e === r.submitterEmail) fail('Người trình không cần thêm vào người theo dõi.');
        if (isSigner(r, e)) fail(s.name + ' đã nằm trong luồng ký.');
        ws.push({ email: e, kind: u.isAdmin && !mine ? 'admin' : 'user' }); added.push(s);
      });
      if (!added.length) fail('Chưa chọn người theo dõi mới.');
      if (ws.length > TK.MAX_WATCH) fail('Tối đa ' + TK.MAX_WATCH + ' người theo dõi.');
      setWatchers(r, ws); r.updatedAt = env.now();
      dirty('requests');
      env.log(r.id, u, 'Thêm người theo dõi', added.map(function (s) { return s.name; }).join(', '));
      if (r.status !== ST.DRAFT) env.mail(added.map(function (s) { return s.email; }), '[Theo dõi] ' + r.id + ' – ' + r.title,
        [u.name + ' thêm bạn làm người theo dõi tờ trình (chỉ xem, nhận email khi có mốc chính).', head(r)]);
      return { id: r.id };
    },

    removeWatcher: function (u, id, email) {
      var r = reqOf(id), mine = r.submitterEmail === u.email;
      email = lc(email);
      var ws = watchers(r), w = ws.filter(function (x) { return x.email === email; })[0];
      if (!w) fail('Người này không có trong danh sách theo dõi.');
      if (r.status === ST.DONE || r.status === ST.REJ) fail('Tờ trình đã kết thúc.');
      if (!u.isAdmin && !(mine && w.kind === 'user')) fail('Bạn chỉ bỏ được người theo dõi do chính mình thêm (không bỏ được người theo dõi mặc định).');
      setWatchers(r, ws.filter(function (x) { return x.email !== email; })); r.updatedAt = env.now();
      dirty('requests');
      env.log(r.id, u, 'Bỏ người theo dõi', nameOf(email));
      return { id: r.id };
    },

    /* XÓA (chỉ QTV, mọi trạng thái kể cả đã hoàn tất): file vào Thùng rác Drive 30 ngày */
    del: function (u, id, password, reason) {
      if (!u.isAdmin) fail('Chỉ Quản trị viên được xóa tờ trình.');
      var r = reqOf(id);
      reason = limitText(reason, TK.TEXT_MAX, 'Lý do');
      if (!reason) fail('Vui lòng ghi lý do xóa.');
      env.verifyPassword(u.email, password);
      var ids = r.pdfs.map(function (p) { return p.id; }).concat(r.attachments.map(function (p) { return p.id; }));
      if (r.receipt && r.receipt.id) ids.push(r.receipt.id);
      env.trash(ids);
      var signed = stepsOf(r).filter(function (s) { return s.status === SS.SIGNED; }).map(function (s) { return s.name + ' ' + tkFmt_(s.at); });
      env.log(r.id, u, 'Xóa tờ trình', 'Tiêu đề: ' + r.title + ' · Trạng thái lúc xóa: ' + r.status + ' · Đã ký: ' + (signed.join('; ') || 'chưa ai') +
        ' · SHA-256: ' + r.sha + ' · ' + ids.length + ' tệp vào Thùng rác Drive (30 ngày) · Lý do: ' + reason);
      db.requests = db.requests.filter(function (x) { return x.id !== r.id; });
      db.steps = db.steps.filter(function (s) { return s.reqId !== r.id; });
      dirty('requests', 'steps');
      env.mail([r.submitterEmail], '[Đã xóa] ' + r.id + ' – ' + r.title, [
        'Quản trị viên ' + u.name + ' đã xóa tờ trình của bạn.', head(r), 'Lý do: ' + esc(reason)
      ]);
      return { id: r.id, deleted: true };
    },

    getFile: function (u, id, fileId) {
      var r = reqOf(id);
      if (!canView(u, r)) fail('Bạn không có quyền xem tệp này.');
      var all = r.pdfs.concat(r.attachments, r.receipt ? [r.receipt] : []);
      var f = all.filter(function (x) { return x.id === fileId; })[0];
      if (!f) fail('Tệp không thuộc tờ trình này.');
      return env.fileData(f.id, f.name);
    },

    /* ---------- Quản trị viên: luồng ký & loại văn bản ---------- */
    listFlows: function (u) {
      if (!u.isAdmin) fail('Chỉ Quản trị viên được xem thiết lập luồng ký.');
      var depts = db.staff.filter(function (s) { return s.active; }).map(function (s) { return s.dept || 'Chưa xếp bộ phận'; })
        .concat(db.flows.map(function (f) { return f.dept; }));
      return {
        flows: db.flows.map(function (f) {
          return {
            id: f.id, name: f.name, dept: f.dept, docType: f.docType, status: f.status, editedBy: f.editedBy, editedAt: f.editedAt,
            steps: f.steps.map(function (x) { var s = person(x.email); return { email: x.email, name: s ? s.name : x.email, dept: s ? s.dept : '', amount: x.amount, unit: x.unit, inactive: !s || !s.active }; }),
            watchers: (f.watchers || []).map(function (e) { return { email: e, name: nameOf(e) }; })
          };
        }),
        types: db.types.map(function (t) { return { name: t.name, status: t.status || 'Đang dùng', note: t.note || '' }; }),
        depts: depts.filter(function (d, i, a) { return d && a.indexOf(d) === i; }).sort()
      };
    },

    saveFlow: function (u, f) {
      if (!u.isAdmin) fail('Chỉ Quản trị viên được tạo hoặc sửa luồng ký.');
      f = f || {};
      var dept = txt(f.dept), type = txt(f.docType) || TK.ALL_TYPES;
      if (!dept) fail('Vui lòng chọn bộ phận.');
      if (type !== TK.ALL_TYPES && !db.types.some(function (t) { return t.name === type; })) fail('Loại văn bản không có trong danh sách.');
      var steps = (f.steps || []).map(function (x, i) {
        var s = active(x.email);
        if (!s) fail('Bước ' + (i + 1) + ': vui lòng chọn người ký đang làm việc.');
        var amt = Number(x.amount);
        if (!(amt > 0) || amt > 365) fail('Bước ' + (i + 1) + ': thời hạn phải từ 1 trở lên.');
        if (TK.UNITS.indexOf(x.unit) < 0) fail('Bước ' + (i + 1) + ': đơn vị là "giờ" hoặc "ngày".');
        return { email: s.email, amount: amt, unit: x.unit };
      });
      if (!steps.length) fail('Luồng ký cần ít nhất 1 bước.');
      if (steps.length > TK.MAX_STEPS) fail('Luồng ký tối đa ' + TK.MAX_STEPS + ' bước.');
      steps.forEach(function (x, i) { if (steps.some(function (y, j) { return j < i && y.email === x.email; })) fail('Người ký ' + nameOf(x.email) + ' bị trùng trong luồng.'); });
      var wl = [];
      (f.watchers || []).forEach(function (e) {
        e = lc(e); if (!e || wl.indexOf(e) >= 0) return;
        if (!active(e)) fail('Người theo dõi mặc định ' + e + ' không có trong nhân sự đang làm việc.');
        if (steps.some(function (x) { return x.email === e; })) fail(nameOf(e) + ' đã là người ký, không cần làm người theo dõi.');
        wl.push(e);
      });
      if (wl.length > TK.MAX_WATCH) fail('Tối đa ' + TK.MAX_WATCH + ' người theo dõi mặc định.');
      var cur = f.id ? db.flows.filter(function (x) { return x.id === f.id; })[0] : null;
      if (f.id && !cur) fail('Không tìm thấy luồng ký.');
      var status = cur ? cur.status : 'Đang dùng';
      if (status !== 'Ngừng' && db.flows.some(function (x) { return x !== cur && x.status !== 'Ngừng' && x.dept === dept && x.docType === type; }))
        fail('Bộ phận "' + dept + '" đã có luồng ĐANG DÙNG cho loại "' + type + '". Hãy sửa luồng đó hoặc tắt nó trước.');
      var now = env.now();
      if (!cur) {
        var n = db.flows.reduce(function (m, x) { var k = String(x.id).match(/(\d+)$/); return k ? Math.max(m, Number(k[1])) : m; }, 0);
        cur = { id: 'LK-' + String(n + 1).padStart(3, '0'), status: 'Đang dùng' };
        db.flows.push(cur);
      }
      cur.name = limitText(f.name, 100, 'Tên luồng') || (type === TK.ALL_TYPES ? dept + ' – mọi loại' : dept + ' – ' + type);
      cur.dept = dept; cur.docType = type; cur.steps = steps; cur.watchers = wl; cur.editedBy = u.name; cur.editedAt = now;
      dirty('flows');
      env.log(cur.id, u, f.id ? 'Sửa luồng ký' : 'Tạo luồng ký', cur.name + ': ' + steps.map(function (x, i) { return (i + 1) + '. ' + nameOf(x.email) + ' (' + x.amount + ' ' + x.unit + ')'; }).join(' → ') +
        (wl.length ? ' · theo dõi mặc định: ' + wl.map(nameOf).join(', ') : '') + ' · Chỉ áp dụng cho tờ trình mới.');
      return api.listFlows(u);
    },

    setFlowStatus: function (u, id, status) {
      if (!u.isAdmin) fail('Chỉ Quản trị viên được bật/tắt luồng ký.');
      if (['Đang dùng', 'Ngừng'].indexOf(status) < 0) fail('Trạng thái không hợp lệ.');
      var f = db.flows.filter(function (x) { return x.id === id; })[0];
      if (!f) fail('Không tìm thấy luồng ký.');
      if (status === 'Đang dùng' && db.flows.some(function (x) { return x !== f && x.status !== 'Ngừng' && x.dept === f.dept && x.docType === f.docType; }))
        fail('Đã có luồng khác đang dùng cho cùng bộ phận và loại văn bản.');
      f.status = status; f.editedBy = u.name; f.editedAt = env.now();
      dirty('flows');
      env.log(f.id, u, status === 'Ngừng' ? 'Tắt luồng ký' : 'Bật luồng ký', f.name);
      return api.listFlows(u);
    },

    saveDocType: function (u, t) {
      if (!u.isAdmin) fail('Chỉ Quản trị viên được quản lý loại văn bản.');
      t = t || {};
      var name = limitText(t.name, 100, 'Tên loại').replace(/\s+/g, ' ');
      if (!name) fail('Vui lòng nhập tên loại văn bản.');
      if (name === TK.ALL_TYPES) fail('Tên "' + TK.ALL_TYPES + '" dành riêng cho luồng áp dụng mọi loại.');
      var status = t.status === 'Ngừng' ? 'Ngừng' : 'Đang dùng';
      var cur = db.types.filter(function (x) { return lc(x.name) === lc(name); })[0];
      if (cur && t.isNew) fail('Loại "' + name + '" đã có.');
      if (!cur) { cur = { name: name }; db.types.push(cur); }
      cur.status = status; if (t.note !== undefined) cur.note = limitText(t.note, 200, 'Ghi chú');
      dirty('types');
      env.log('LOẠI VB', u, t.isNew ? 'Thêm loại văn bản' : (status === 'Ngừng' ? 'Ngừng loại văn bản' : 'Cập nhật loại văn bản'), name);
      return api.listFlows(u);
    },

    /* Nhắc quá hạn (máy chủ gọi mỗi giờ). Không nhắc Chủ nhật và trước 8h thứ Hai. */
    remind: function (now) {
      var p = tkVnParts_(now), today = tkYmd_(now);
      if (p.dow === 0 || (p.dow === 1 && p.h < 8)) return { signers: {}, admin: [] };
      var bySigner = {}, admin = [];
      db.requests.forEach(function (r) {
        var st = curStep(r);
        if (!st || !st.dueAt || now <= st.dueAt) return;
        var first = !st.lastRemind;
        if (!first && !(p.h >= 8 && tkYmd_(st.lastRemind) < today)) return;
        st.lastRemind = now;
        var item = { id: r.id, title: r.title, holder: st.name, over: tkDur_(tkWorkingMs_(st.dueAt, now)), due: tkFmt_(st.dueAt), urgent: r.urgency === 'Khẩn' };
        (bySigner[st.email] = bySigner[st.email] || []).push(item);
        admin.push(item);
      });
      if (admin.length) dirty('steps');
      return { signers: bySigner, admin: admin };
    }
  };

  function moveStep(u, r, st, to, note, action, msg) {
    st.prevEmail = st.email; st.email = to.email; st.name = to.name; st.dept = to.dept;
    st.note = note; st.lastRemind = '';
    r.updatedAt = env.now();
    dirty('requests', 'steps');
    env.log(r.id, u, action + ' (bước ' + st.order + ')', nameOf(st.prevEmail) + ' → ' + to.name + ' · ' + note + ' · Giữ hạn ' + tkFmt_(st.dueAt));
    env.mail([to.email], '[Chờ bạn ký] ' + r.id + ' – ' + r.title, [msg, head(r), esc(note), 'Hạn ký: <b>' + tkFmt_(st.dueAt) + '</b>']);
    return { id: r.id };
  }

  return api;
}

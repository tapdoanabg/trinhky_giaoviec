/* Bản chạy thử TRÌNH KÝ cho GitHub Pages.
 * Chỉ chạy khi dòng window.KV_API_URL để trống. Dữ liệu mẫu lưu trên trình duyệt người xem,
 * không gửi email thật (xem ở nút "Email mô phỏng"), không ghi Google Sheet.
 * Dùng chung lõi nghiệp vụ core.js (= src/TrinhKyCore.gs) với máy chủ thật.
 */
if (!String(window.KV_API_URL || '').trim()) {
window.KV_DEMO = true;
window.KV_TOKEN_KEY = 'abg_tk_demo_token';
(function () {
  const KEY = 'abg_tk_demo_db_v1';
  const PW = 'matkhau1';
  const lc = s => String(s || '').trim().toLowerCase();
  const ADMIN = 'Quản trị viên';
  const P = (name, email, role, dept, extra) => Object.assign({ name, email, role, dept, active: true, pw: PW }, extra || {});

  function seedStaff() {
    return [
      P('Quản trị viên', 'admin@vidu.vn', ADMIN, 'Ban Tổng giám đốc'),
      P('Hoàng Minh Đức (Giám đốc, mẫu)', 'giamdoc@vidu.vn', 'Quản lý', 'Ban Tổng giám đốc'),
      P('Lê Văn Cường (Trưởng TK, mẫu)', 'cuong@vidu.vn', 'Quản lý', 'Thiết kế'),
      P('Nguyễn Văn An (mẫu)', 'an@vidu.vn', 'Nhân viên', 'Thiết kế'),
      P('Phạm Thị Dung (mẫu)', 'dung@vidu.vn', 'Nhân viên', 'Thiết kế'),
      P('Vũ Thị Hoa (Kế toán, mẫu)', 'ketoan@vidu.vn', 'Nhân viên', 'Kế toán'),
      P('Đỗ Văn Tâm (Kế toán trưởng, mẫu)', 'ktt@vidu.vn', 'Quản lý', 'Kế toán'),
      P('Ngô Thị Lan (Trưởng MKT, mẫu)', 'lan@vidu.vn', 'Quản lý', 'Marketing'),
      P('Trần Thị Bình (mẫu)', 'binh@vidu.vn', 'Nhân viên', 'Marketing', { pw: '', temp: 'tam12345' })
    ].map(s => Object.assign(s, { isAdmin: s.role === ADMIN, isManager: s.role === ADMIN || s.role === 'Quản lý' }));
  }

  let db = null, clock = null;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { } };
  const now = () => clock || Date.now();
  const rid = () => Math.random().toString(36).slice(2, 10);
  const fakeSha = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const vnTime = ms => { const d = new Date(Number(ms) + 7 * 3600e3), z = n => String(n).padStart(2, '0'); return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()); };

  const env = {
    now,
    log: (id, u, action, detail) => db.logs.push({ t: now(), id, by: u.name, action, detail }),
    readLog: id => db.logs.filter(l => l.id === id).slice().reverse().map(l => ({ time: vnTime(l.t), by: l.by, action: l.action, detail: l.detail })),
    mail: (to, subject, lines) => { const list = (to || []).map(lc).filter((e, i, a) => e && a.indexOf(e) === i); if (list.length) db.outbox.unshift({ t: now(), to: list, subject, body: lines.filter(Boolean).join('<br>') }); db.outbox = db.outbox.slice(0, 60); },
    verifyPassword: (email, pw) => {
      const s = db.staff.find(x => x.email === lc(email)); const f = db.fails[email] || { n: 0, until: 0 };
      if (f.until > Date.now()) throw new Error('Nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau 15 phút.');
      pw = String(pw || '').trim();
      if (!s || !(pw && (pw === s.pw || pw === s.temp))) {
        f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; }
        db.fails[email] = f; save();
        throw new Error('Mật khẩu không đúng.' + (f.until > Date.now() ? ' Tài khoản bị khóa 15 phút.' : ' Còn ' + (5 - f.n) + ' lần thử.'));
      }
      delete db.fails[email];
    },
    checkStaged: (u, ids) => (ids || []).filter(Boolean).map(id => { const m = db.staged[id]; if (!m || m.email !== u.email) throw new Error('Tệp tải lên đã hết hạn, vui lòng chọn lại tệp.'); return Object.assign({ id }, m); }),
    attach: (metas, prefix) => metas.map(m => { delete db.staged[m.id]; db.hashes[m.id] = db.hashes[m.id] || fakeSha(); return { id: m.id, kind: m.kind, name: m.name, size: m.size, url: '' }; }),
    hashFile: id => db.hashes[id] || (db.hashes[id] = fakeSha()),
    trash: ids => { db.trash = (db.trash || []).concat(ids); },
    makeReceipt: d => ({ id: 'rc_' + rid(), name: 'Phieu-xac-nhan_' + d.id + '.pdf', url: '' }),
    fileData: (id, name) => ({ demo: true, message: 'Bản thử nghiệm chỉ lưu tên tệp "' + name + '". Ở bản thật, bấm vào sẽ tải tệp về.' }),
    nextSeq: (y, maxNo) => { const k = 'y' + y; db.seq[k] = Math.max(db.seq[k] || 0, maxNo) + 1; return db.seq[k]; }
  };
  const core = () => tkCore_(db, env);
  const userOf = email => { const s = db.staff.find(x => x.email === email); return { name: s.name, email: s.email, role: s.role, dept: s.dept, isAdmin: s.isAdmin, isManager: s.isManager }; };
  const stage = (email, kind, name, size) => { const id = 'up_' + rid(); db.staged[id] = { email, kind, name, size: size || 300000 }; return id; };

  // Tạo dữ liệu mẫu bằng chính lõi nghiệp vụ (tua thời gian lùi về quá khứ)
  function seed() {
    db = { staff: seedStaff(), requests: [], steps: [], flows: [], types: [], logs: [], outbox: [], staged: {}, hashes: {}, sessions: {}, fails: {}, seq: {}, mustChange: {}, dirty: {} };
    ['Đề xuất chi', 'Hợp đồng – thỏa thuận hợp tác', 'Công văn đi', 'Kế hoạch dự án', 'Báo cáo tài trợ', 'Quyết định nội bộ']
      .forEach(n => db.types.push({ name: n, status: 'Đang dùng', note: '' }));
    const H = 3600e3, t0 = Date.now();
    clock = t0 - 30 * 24 * H;
    const c = core(), A = userOf('admin@vidu.vn');
    c.saveFlow(A, { dept: 'Thiết kế', docType: 'Đề xuất chi', name: 'Thiết kế – Đề xuất chi', steps: [{ email: 'cuong@vidu.vn', amount: 1, unit: 'ngày' }, { email: 'ketoan@vidu.vn', amount: 4, unit: 'giờ' }, { email: 'giamdoc@vidu.vn', amount: 2, unit: 'ngày' }], watchers: ['ktt@vidu.vn'] });
    c.saveFlow(A, { dept: 'Thiết kế', docType: 'Tất cả', name: 'Thiết kế – các loại khác', steps: [{ email: 'cuong@vidu.vn', amount: 1, unit: 'ngày' }, { email: 'giamdoc@vidu.vn', amount: 1, unit: 'ngày' }] });
    c.saveFlow(A, { dept: 'Marketing', docType: 'Tất cả', name: 'Marketing – mọi loại', steps: [{ email: 'lan@vidu.vn', amount: 1, unit: 'ngày' }, { email: 'giamdoc@vidu.vn', amount: 1, unit: 'ngày' }] });
    const an = userOf('an@vidu.vn'), dung = userOf('dung@vidu.vn'), binh = userOf('binh@vidu.vn');
    const S = e => userOf(e);
    // 1. Hoàn tất
    clock = t0 - 9 * 24 * H;
    const r1 = c.create(an, { docType: 'Kế hoạch dự án', title: 'Kế hoạch tổ chức Hội nghị khách hàng quý IV', summary: '2 hội nghị tại Hà Nội và TP.HCM, dự kiến 300 khách mời.', mainPdf: stage(an.email, 'pdf', 'Ke-hoach-hoi-nghi-Q4.pdf', 1450000), attachments: [stage(an.email, 'img', 'Mat-bang-hoi-truong.jpg', 820000)], watchers: ['dung@vidu.vn'] }, true).id;
    clock += 5 * H; c.sign(S('cuong@vidu.vn'), r1, PW, 'Đồng ý, ưu tiên tổ chức trong tháng 11.');
    clock += 20 * H; c.sign(S('giamdoc@vidu.vn'), r1, PW, 'Duyệt.');
    // 2. Từ chối
    clock = t0 - 6 * 24 * H;
    const r2 = c.create(dung, { docType: 'Đề xuất chi', title: 'Đề xuất chi mua máy in màu A3', amount: '18.500.000', mainPdf: stage(dung.email, 'pdf', 'Bao-gia-may-in.pdf', 520000) }, true).id;
    clock += 3 * H; c.sign(S('cuong@vidu.vn'), r2, PW, '');
    clock += 2 * H; c.reject(S('ketoan@vidu.vn'), r2, 'Ngân sách quý đã hết, đề nghị dùng dịch vụ in ngoài.');
    // 3. Chờ ký bước 2, quá hạn
    clock = t0 - 3 * 24 * H;
    const r3 = c.create(an, { docType: 'Đề xuất chi', title: 'Đề xuất chi mua 2 laptop cho nhân viên mới', amount: '42.000.000', urgency: 'Thường', summary: 'Trang bị cho 2 nhân viên thiết kế mới, cấu hình đồ họa.', mainPdf: stage(an.email, 'pdf', 'De-xuat-laptop.pdf', 890000), attachments: [stage(an.email, 'pdf', 'Bao-gia-laptop.pdf', 310000)] }, true).id;
    clock += 4 * H; c.sign(S('cuong@vidu.vn'), r3, PW, 'Cần thiết, đề nghị duyệt.');
    // 4. Bổ sung
    clock = t0 - 2 * 24 * H;
    const r4 = c.create(binh, { docType: 'Công văn đi', title: 'Công văn mời đối tác dự Hội nghị khách hàng', mainPdf: stage(binh.email, 'pdf', 'Cong-van-moi-doi-tac.pdf', 640000) }, true).id;
    clock += 6 * H; c.requestChanges(S('lan@vidu.vn'), r4, 'Bổ sung chương trình chi tiết và sơ đồ chỗ ngồi.');
    // 5. Chờ ký bước 1, khẩn, mới trình
    clock = t0 - 2 * H;
    c.create(dung, { docType: 'Hợp đồng – thỏa thuận hợp tác', title: 'Thỏa thuận hợp tác đào tạo thiết kế với Trường ĐH Mỹ thuật', urgency: 'Khẩn', mainPdf: stage(dung.email, 'pdf', 'Thoa-thuan-hop-tac.pdf', 1200000), watchers: ['an@vidu.vn'] }, true);
    clock = null;
    db.outbox = [];
    db.dirty = {};
    save();
  }
  if (!db || !db.staff || !db.flows) seed();
  window.resetTkDemo = () => { seed(); };

  function auth(token) {
    const email = db.sessions[token];
    const s = email && db.staff.find(x => x.email === email && x.active);
    if (!s) throw new Error('SESSION_EXPIRED');
    if (db.mustChange[token]) throw new Error('MUST_CHANGE_PASSWORD');
    return userOf(email);
  }

  const api = {
    login(email, pw) {
      email = lc(email); pw = String(pw || '').trim();
      const s = db.staff.find(x => x.email === email && x.active);
      const temp = !!(s && s.temp && pw === s.temp);
      if (!s || !(temp || (s.pw && pw === s.pw))) throw new Error('Email hoặc mật khẩu không đúng.');
      const token = 't' + Date.now() + rid();
      db.sessions[token] = email; if (temp) db.mustChange[token] = 1; save();
      return { token, mustChange: temp };
    },
    logout(token) { delete db.sessions[token]; save(); return true; },
    changePassword(token, oldPw, newPw) {
      const email = db.sessions[token], s = email && db.staff.find(x => x.email === email);
      if (!s) throw new Error('SESSION_EXPIRED');
      const must = db.mustChange[token];
      if (!must) env.verifyPassword(email, oldPw);
      newPw = String(newPw || '').trim();
      if (newPw.length < 8) throw new Error('Mật khẩu cần tối thiểu 8 ký tự.');
      if (!/[A-Za-zÀ-ỹ]/.test(newPw) || !/\d/.test(newPw)) throw new Error('Mật khẩu cần có cả chữ và số.');
      if (newPw === s.temp || newPw === s.pw) throw new Error('Mật khẩu mới phải khác mật khẩu cũ / mật khẩu tạm.');
      s.pw = newPw; delete s.temp; delete db.mustChange[token]; save();
      return true;
    },
    tkApi(fn, token, args) {
      const u = auth(token);
      args = Array.isArray(args) ? args : [];
      if (fn === 'upload') {
        const f = args[0] || {};
        const isPdf = f.mimeType === 'application/pdf', isImg = /^image\//.test(f.mimeType || '');
        if (!isPdf && !isImg) throw new Error('"' + f.name + '" không phải ảnh hoặc PDF hợp lệ.');
        const lim = isPdf ? 10 : 5;
        if (Number(f.size) > lim * 1048576) throw new Error((isPdf ? 'Tệp PDF "' : 'Ảnh "') + f.name + '" vượt quá ' + lim + 'MB.');
        const id = stage(u.email, isPdf ? 'pdf' : 'img', f.name, Number(f.size) || 0); save();
        return { id, kind: db.staged[id].kind, name: f.name, size: db.staged[id].size };
      }
      const c = core();
      const calls = fn === 'multi' ? args : [[fn, args]];
      calls.forEach(x => { if (!Array.isArray(x) || typeof c[x[0]] !== 'function' || x[0] === 'remind') throw new Error('Chức năng trình ký không hợp lệ: ' + (x && x[0])); });
      const snapshot = JSON.stringify(db);
      let outs;
      try {
        outs = calls.map(x => { const o = c[x[0]].apply(null, [u].concat(Array.isArray(x[1]) ? x[1] : [])); if (x[0] === 'bootstrap') o.appUrl = ''; return o; });
      } catch (e) { db = JSON.parse(snapshot); throw e; } // lỗi giữa chừng: không lưu (giống máy chủ)
      db.dirty = {}; save();
      return fn === 'multi' ? outs : outs[0];
    }
  };

  function runner(ok, fail) {
    return new Proxy({}, { get(_, name) {
      if (name === 'withSuccessHandler') return f => runner(f, fail);
      if (name === 'withFailureHandler') return f => runner(ok, f);
      return (...args) => setTimeout(() => {
        try {
          if (!api[name]) throw new Error('Không có hàm ' + String(name));
          const r = JSON.parse(JSON.stringify(api[name](...JSON.parse(JSON.stringify(args)))));
          ok && ok(r);
        } catch (e) { fail && fail(e); }
      }, 150);
    } });
  }
  window.google = { script: { run: runner(null, null) } };
  window.tkDemoOutbox = () => db.outbox;
})();

(function demoUI() {
  const st = document.createElement('style');
  st.textContent = '.demo-hint{margin-top:18px;padding:12px;border-radius:10px;background:var(--brand-soft);font-size:13px;line-height:1.6}' +
    '.demo-hint code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}' +
    '.demo-hint button{all:unset;cursor:pointer;color:var(--brand);text-decoration:underline;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}' +
    '.demo-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding:8px 12px;border:1.5px dashed var(--line);border-radius:12px;font-size:13px;color:var(--muted)}' +
    '.demo-bar .btn{min-height:40px;padding:6px 12px;font-size:13px}.mail{border-top:1px solid var(--line);padding:10px 0;font-size:13.5px}.mail:first-child{border-top:0}';
  document.head.appendChild(st);
  const acc = [['admin@vidu.vn', 'Quản trị viên'], ['cuong@vidu.vn', 'Trưởng Thiết kế (ký bước 1)'], ['ketoan@vidu.vn', 'Kế toán (ký bước 2)'], ['giamdoc@vidu.vn', 'Giám đốc (ký cuối)'],
    ['an@vidu.vn', 'Nhân viên Thiết kế'], ['dung@vidu.vn', 'Nhân viên Thiết kế'], ['lan@vidu.vn', 'Trưởng Marketing'], ['ktt@vidu.vn', 'Kế toán trưởng (theo dõi)']];
  const hint = document.createElement('div');
  hint.className = 'demo-hint';
  hint.innerHTML = '<b>Bản thử nghiệm Trình ký</b> – dữ liệu mẫu trên trình duyệt này. Mật khẩu mẫu: <code>matkhau1</code><br>' +
    acc.map(a => '<button type="button" data-e="' + a[0] + '">' + a[0] + '</button> · ' + a[1]).join('<br>') +
    '<br>Thử mật khẩu tạm: <button type="button" data-e="binh@vidu.vn" data-p="tam12345">binh@vidu.vn</button> · <code>tam12345</code>' +
    '<br><span style="opacity:.85">Muốn dùng dữ liệu thật: dán link /exec vào dòng <code>window.KV_API_URL</code> trong <code>config.js</code>.</span>';
  document.querySelector('#login .login-card').appendChild(hint);
  hint.addEventListener('click', e => {
    const b = e.target.closest('button[data-e]'); if (!b) return;
    document.getElementById('l-email').value = b.dataset.e; document.getElementById('l-pw').value = b.dataset.p || 'matkhau1';
  });
  const em = document.getElementById('l-email'); if (!em.value) em.value = 'cuong@vidu.vn';
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = '<span>Bản thử nghiệm · chưa nối Google Sheet</span><span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="btn-mail">📧 Email mô phỏng</button><button class="btn" type="button" id="btn-reset">Đặt lại dữ liệu mẫu</button></span>';
  document.querySelector('main.wrap').prepend(bar);
  document.getElementById('btn-mail').addEventListener('click', () => {
    const list = window.tkDemoOutbox();
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    openSheet('<div class="sheet-head"><h2>📧 Email mô phỏng</h2><button class="btn" onclick="closeSheet()" aria-label="Đóng">✕</button></div>' +
      '<p class="hint">Bản thật gửi các email này qua Gmail của tài khoản chạy Apps Script.</p><div class="box">' +
      (list.length ? list.map(m => '<div class="mail"><b>' + esc(m.subject) + '</b><div class="hint" style="margin:2px 0">Gửi: ' + esc(m.to.join(', ')) + '</div><div>' + m.body + '</div></div>').join('') : '<p class="hint">Chưa có email nào. Hãy thử trình ký hoặc ký duyệt.</p>') + '</div>');
  });
  let ask = false;
  document.getElementById('btn-reset').addEventListener('click', function () {
    if (!ask) { ask = true; this.textContent = 'Bấm lần nữa để xóa mọi thay đổi'; return; }
    window.resetTkDemo();
    try { localStorage.removeItem('abg_tk_demo_token'); } catch (e) { }
    location.reload();
  });
})();
}

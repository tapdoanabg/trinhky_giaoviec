/* Bản chạy thử cho GitHub Pages.
 * Chỉ chạy khi CHƯA cấu hình KV_API_URL (biến kho GitHub). Khi đã cấu hình, trang dùng dữ liệu thật trên Google Sheet.
 * Dữ liệu mẫu lưu trên trình duyệt của người xem, không gửi email, không ghi vào Google Sheet.
 */
if (!String(window.KV_API_URL || '').trim()) {
window.KV_DEMO = true;
/* ===== BẢN THỬ NGHIỆM: giả lập máy chủ Apps Script ngay trong trình duyệt ===== */
(function(){
  const KEY='abg_demo_db_v1';
  const NO_DEPT='Chưa xếp bộ phận';
  const deptOf=s=>(s&&String(s.dept||'').trim())||NO_DEPT;
  window.KV_DEMO_SHRINK=true;
  const STATUSES=['Mới giao','Đang làm','Chờ duyệt','Cần sửa','Hoàn thành','Hủy'];
  const PRIORITIES=['Cao','Trung bình','Thấp'];
  const LIMITS={maxImgMB:5,maxImgs:5,maxPdfMB:10,maxPdfs:5};
  const ROLE_ADMIN='Quản trị viên';
  const FLOW={'Mới giao':['Đang làm'],'Đang làm':['Chờ duyệt'],'Cần sửa':['Đang làm','Chờ duyệt']};
  const LABEL={title:'Tên công việc',desc:'Mô tả',priority:'Ưu tiên'};
  const z=n=>String(n).padStart(2,'0');
  const ymd=d=>d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());
  const addDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return ymd(d);};
  const nowStr=()=>{const d=new Date();return ymd(d)+' '+z(d.getHours())+':'+z(d.getMinutes());};
  const vnTime=()=>{const d=new Date();return z(d.getDate())+'/'+z(d.getMonth()+1)+'/'+d.getFullYear()+' '+z(d.getHours())+':'+z(d.getMinutes());};
  const shortTime=()=>{const d=new Date();return z(d.getDate())+'/'+z(d.getMonth()+1)+' '+z(d.getHours())+':'+z(d.getMinutes());};
  const fmtVN=s=>{const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:'';};
  const lc=s=>String(s||'').trim().toLowerCase();

  function seed(){
    const admin={name:'Quản trị viên',email:'admin@vidu.vn',pw:'matkhau1',role:ROLE_ADMIN,dept:'Ban Tổng giám đốc',active:true};
    const an={name:'Nguyễn Văn An (mẫu)',email:'an@vidu.vn',pw:'matkhau1',role:'Nhân viên',dept:'Thiết kế',active:true};
    const binh={name:'Trần Thị Bình (mẫu)',email:'binh@vidu.vn',pw:'matkhau1',role:'Nhân viên',dept:'Marketing',active:true};
    const dung={name:'Phạm Thị Dung (mẫu)',email:'dung@vidu.vn',temp:'tam12345',role:'Nhân viên',dept:'Thiết kế',active:true};
    const cuong={name:'Lê Văn Cường (mẫu)',email:'cuong@vidu.vn',pw:'matkhau1',role:'Quản lý',dept:'Điều phối dự án',active:true};
    const mk=(id,title,desc,project,who,prio,ag,dl,status,prog,link,note)=>({id,title,desc,project,imageIds:[],pdfs:[],assignerName:admin.name,assignerEmail:admin.email,assigneeName:who.name,assigneeEmail:who.email,dept:who.dept,priority:prio,assignedDate:addDays(ag),deadline:addDays(dl),status,progress:prog,resultLink:link,note,updatedAt:nowStr()});
    const tasks=[
      mk('CV-0001','Thiết kế bộ nhận diện Hội nghị khách hàng 2026','Backdrop, standee và bản vuông 1080x1080 cho mạng xã hội.','Hội nghị khách hàng 2026',an,'Cao',-6,-1,'Đang làm',60,'',''),
      mk('CV-0002','Viết 4 bài giới thiệu sản phẩm mới trên fanpage','Mỗi bài 150–200 chữ, kèm gợi ý ảnh.','Ra mắt sản phẩm Q4',binh,'Trung bình',-4,3,'Chờ duyệt',90,'https://docs.google.com/document/d/vi-du','[mẫu] Đã xong 4 bài, nhờ anh/chị duyệt.'),
      mk('CV-0003','Lập danh sách 20 khách hàng doanh nghiệp tiềm năng','Tên doanh nghiệp, người liên hệ, nhu cầu, quy mô.','Phát triển thị trường',binh,'Cao',0,5,'Mới giao',0,'',''),
      mk('CV-0004','Chuẩn bị tài liệu đào tạo nhân viên mới','Slide 10 trang và tờ rơi A5.','Đào tạo nội bộ',an,'Trung bình',-10,-3,'Hoàn thành',100,'https://drive.google.com/vi-du','')
    ];
    tasks[1].pdfs=[{id:'demo_pdf_1',name:'Ke-hoach-ra-mat-san-pham.pdf',size:1887437}];
    tasks[2].pdfs=[{id:'demo_pdf_2',name:'Danh-sach-khach-hang-mau.pdf',size:356000}];
    const logs=tasks.map(t=>({time:vnTime(),id:t.id,by:admin.name,action:'Giao việc',detail:'Giao cho '+t.assigneeName+', hạn '+fmtVN(t.deadline)}));
    const projects=['Hội nghị khách hàng 2026','Ra mắt sản phẩm Q4','Phát triển thị trường','Đào tạo nội bộ','Vận hành nội bộ']
      .map(name=>({name,status:'Đang chạy',createdBy:admin.name,createdAt:fmtVN(addDays(-14))}));
    return {staff:[admin,cuong,an,dung,binh],projects,tasks,logs,images:{},staged:{},sessions:{}};
  }

  let db=null;
  try{ db=JSON.parse(localStorage.getItem(KEY)||'null'); }catch(e){}
  if(!db||!db.staff||!db.projects||!db.staged) db=seed();
  const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(db)); }catch(e){ throw new Error('Bộ nhớ trình duyệt đã đầy. Bấm "Đặt lại dữ liệu mẫu" để giải phóng.'); } };
  window.resetDemo=()=>{ db=seed(); save(); };

  function auth(token){
    if(db.mustChange&&db.mustChange[token]) throw new Error('MUST_CHANGE_PASSWORD');
    const email=db.sessions[token];
    const u=email&&db.staff.find(s=>s.email===email&&s.active);
    if(!u) throw new Error('SESSION_EXPIRED');
    const ad=u.role===ROLE_ADMIN; return Object.assign({},u,{isAdmin:ad,isManager:ad||u.role==='Quản lý'});
  }
  function log(id,u,action,detail){ db.logs.push({time:vnTime(),id,by:u.name,action,detail}); }
  function nextId(){ let m=0; db.tasks.forEach(t=>{const x=String(t.id).match(/(\d+)$/); if(x) m=Math.max(m,+x[1]);}); return 'CV-'+String(m+1).padStart(4,'0'); }

  const api={
    login(email,pw){
      email=lc(email); pw=String(pw||'').trim();
      const u=db.staff.find(s=>s.email===email&&s.active);
      const temp=!!(u&&u.temp&&pw===u.temp);
      if(!u||!(temp||(u.pw&&pw===u.pw))) throw new Error('Email hoặc mật khẩu không đúng.');
      const token='t'+Date.now()+Math.random().toString(36).slice(2);
      db.sessions[token]=email; if(temp) (db.mustChange=db.mustChange||{})[token]=1; save();
      return {token,mustChange:temp};
    },
    logout(token){ delete db.sessions[token]; save(); return true; },
    changePassword(token,oldPw,newPw){
      const email=db.sessions[token]; const u=email&&db.staff.find(s=>s.email===email);
      if(!u) throw new Error('SESSION_EXPIRED');
      const must=db.mustChange&&db.mustChange[token];
      if(!must&&String(oldPw||'').trim()!==u.pw) throw new Error('Mật khẩu hiện tại không đúng.');
      newPw=String(newPw||'').trim();
      if(newPw.length<8) throw new Error('Mật khẩu cần tối thiểu 8 ký tự.');
      if(!/[A-Za-zÀ-ỹ]/.test(newPw)||!/\d/.test(newPw)) throw new Error('Mật khẩu cần có cả chữ và số.');
      if(newPw===u.temp||newPw===u.pw) throw new Error('Mật khẩu mới phải khác mật khẩu cũ / mật khẩu tạm.');
      u.pw=newPw; delete u.temp; if(must) delete db.mustChange[token]; save();
      return true;
    },
    getData(token){
      const u=auth(token);
      let tasks=db.tasks.slice();
      if(!u.isManager) tasks=tasks.filter(t=>lc(t.assigneeEmail)===u.email);
      tasks.sort((a,b)=>String(b.id).localeCompare(String(a.id)));
      return {
        user:{name:u.name,email:u.email,role:u.role,dept:u.dept,isManager:u.isManager,isAdmin:u.isAdmin},
        tasks,
        staff:u.isManager?db.staff.filter(s=>s.active).map(s=>({name:s.name,email:s.email,dept:s.dept})):[],
        projects:db.projects.filter(p=>p.status!=='Đã đóng').map(p=>p.name),allProjects:u.isAdmin?db.projects:[],limits:LIMITS,statuses:STATUSES,priorities:PRIORITIES,today:ymd(new Date())
      };
    },
    getLog(token,id){
      const u=auth(token);
      const t=db.tasks.find(x=>x.id===id);
      if(!t) throw new Error('Không tìm thấy công việc.');
      if(!u.isManager&&lc(t.assigneeEmail)!==u.email) throw new Error('Bạn không có quyền xem việc này.');
      return db.logs.filter(l=>l.id===id).slice().reverse();
    },
    uploadFile(token,f){
      const u=auth(token);
      if(!u.isManager) throw new Error('Chỉ Quản lý mới được đính kèm tệp khi giao việc.');
      f=f||{};
      const isPdf=f.mimeType==='application/pdf', isImg=/^image\//.test(f.mimeType||'');
      if(!isPdf&&!isImg) throw new Error('"'+f.name+'" không phải ảnh hoặc PDF hợp lệ.');
      const lim=isPdf?LIMITS.maxPdfMB:LIMITS.maxImgMB;
      if(Number(f.size)>lim*1048576) throw new Error((isPdf?'Tệp PDF "':'Ảnh "')+f.name+'" vượt quá '+lim+'MB.');
      const id='up_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      db.staged[id]={email:u.email,kind:isPdf?'pdf':'img',name:f.name,size:Number(f.size)||0,data:isImg?'data:'+f.mimeType+';base64,'+f.data:''};
      save();
      return {id,kind:db.staged[id].kind,name:f.name,size:db.staged[id].size};
    },
    getFile(token,id,fid){
      const u=auth(token);
      const t=db.tasks.find(x=>x.id===id);
      if(!t) throw new Error('Không tìm thấy công việc.');
      if(!u.isManager&&lc(t.assigneeEmail)!==u.email) throw new Error('Bạn không có quyền xem tệp này.');
      throw new Error('Bản thử nghiệm chỉ lưu tên tệp PDF. Ở bản thật, bấm vào tệp để tải xuống và xem.');
    },
    getImage(token,id,fid){
      const u=auth(token);
      const t=db.tasks.find(x=>x.id===id);
      if(!t) throw new Error('Không tìm thấy công việc.');
      if(!u.isManager&&lc(t.assigneeEmail)!==u.email) throw new Error('Bạn không có quyền xem ảnh này.');
      if((t.imageIds||[]).indexOf(fid)<0||!db.images[fid]) throw new Error('Không tìm thấy ảnh.');
      return db.images[fid];
    },
    addProject(token,name){
      const u=auth(token);
      if(!u.isAdmin) throw new Error('Chỉ Quản trị viên mới được thêm dự án.');
      name=String(name||'').trim().replace(/\s+/g,' ');
      if(!name) throw new Error('Vui lòng nhập tên dự án.');
      if(name.length>100) throw new Error('Tên dự án tối đa 100 ký tự.');
      if(db.projects.some(p=>lc(p.name)===lc(name))) throw new Error('Dự án "'+name+'" đã có.');
      db.projects.push({name,status:'Đang chạy',createdBy:u.name,createdAt:fmtVN(ymd(new Date()))});
      log('DỰ ÁN',u,'Thêm dự án',name); save();
      return api.getData(token);
    },
    setProjectStatus(token,name,status){
      const u=auth(token);
      if(!u.isAdmin) throw new Error('Chỉ Quản trị viên mới được đóng hoặc mở lại dự án.');
      const p=db.projects.find(x=>x.name===name);
      if(!p) throw new Error('Không tìm thấy dự án.');
      p.status=status; log('DỰ ÁN',u,status==='Đã đóng'?'Đóng dự án':'Mở lại dự án',name); save();
      return api.getData(token);
    },
    createTask(token,d){
      const u=auth(token);
      if(!u.isManager) throw new Error('Chỉ Quản lý mới được giao việc.');
      d=d||{};
      const title=String(d.title||'').trim();
      if(!title) throw new Error('Vui lòng nhập tên công việc.');
      const project=String(d.project||'').trim();
      if(!project) throw new Error('Vui lòng chọn dự án.');
      if(!db.projects.some(p=>p.name===project&&p.status!=='Đã đóng')) throw new Error('Dự án "'+project+'" không có hoặc đã đóng.');
      if(!d.deadline) throw new Error('Vui lòng chọn hạn chót.');
      const a=db.staff.find(s=>s.email===lc(d.assigneeEmail)&&s.active);
      if(!a) throw new Error('Vui lòng chọn người nhận việc.');
      if(!d.dept) throw new Error('Vui lòng chọn bộ phận.');
      if(deptOf(a)!==String(d.dept).trim()) throw new Error(a.name+' không thuộc bộ phận "'+d.dept+'". Vui lòng chọn lại người nhận.');
      const att=(d.attachments||[]).map(sid=>{
        const m=db.staged[sid];
        if(!m||m.email!==u.email) throw new Error('Tệp đính kèm đã hết hạn, vui lòng chọn lại tệp.');
        return Object.assign({sid},m);
      });
      const nImg=att.filter(x=>x.kind==='img').length, nPdf=att.length-nImg;
      if(nImg>LIMITS.maxImgs) throw new Error('Tối đa '+LIMITS.maxImgs+' ảnh mỗi công việc.');
      if(nPdf>LIMITS.maxPdfs) throw new Error('Tối đa '+LIMITS.maxPdfs+' tệp PDF mỗi công việc.');
      const note=String(d.note||'').trim();
      const id=nextId();
      const imageIds=[], pdfs=[];
      att.forEach((m,i)=>{
        const fid=id+'_'+(i+1);
        if(m.kind==='img'){ db.images[fid]=m.data; imageIds.push(fid); }
        else pdfs.push({id:fid,name:m.name,size:m.size});
        delete db.staged[m.sid];
      });
      db.tasks.push({id,title,desc:String(d.desc||'').trim(),project,imageIds,pdfs,assignerName:u.name,assignerEmail:u.email,
        assigneeName:a.name,assigneeEmail:a.email,dept:deptOf(a),priority:d.priority||'Trung bình',assignedDate:ymd(new Date()),deadline:d.deadline,
        status:'Mới giao',progress:0,resultLink:'',note:note?'['+shortTime()+' '+u.name+'] '+note:'',updatedAt:nowStr()});
      log(id,u,'Giao việc','Giao cho '+a.name+', hạn '+fmtVN(d.deadline)+(imageIds.length?', '+imageIds.length+' ảnh':'')+(pdfs.length?', '+pdfs.length+' PDF':''));
      save();
      return api.getData(token);
    },
    updateTask(token,id,ch){
      const u=auth(token); ch=ch||{};
      const idx=db.tasks.findIndex(x=>x.id===id);
      if(idx<0) throw new Error('Không tìm thấy công việc.');
      const t=Object.assign({},db.tasks[idx]);
      const mine=lc(t.assigneeEmail)===u.email;
      if(!u.isManager&&!mine) throw new Error('Bạn không có quyền với việc này.');
      const oldStatus=t.status, note=String(ch.note||'').trim(), changes=[];
      let action='Cập nhật';
      if(u.isManager){
        if(ch.project!==undefined&&String(ch.project).trim()!==String(t.project)){
          const np=String(ch.project).trim();
          if(!np) throw new Error('Vui lòng chọn dự án.');
          if(!db.projects.some(p=>p.name===np&&p.status!=='Đã đóng')) throw new Error('Dự án "'+np+'" không có hoặc đã đóng.');
          changes.push('Dự án: '+t.project+' → '+np); t.project=np;
        }
        ['title','desc','priority'].forEach(k=>{
          if(ch[k]!==undefined&&String(ch[k]).trim()!==String(t[k])){
            if(k==='title'&&!String(ch[k]).trim()) throw new Error('Tên công việc không được để trống.');
            t[k]=String(ch[k]).trim(); changes.push(LABEL[k]+' đã sửa');
          }
        });
        if(ch.deadline&&ch.deadline!==t.deadline){ changes.push('Hạn chót: '+fmtVN(t.deadline)+' → '+fmtVN(ch.deadline)); t.deadline=ch.deadline; }
        if(ch.assigneeEmail&&lc(ch.assigneeEmail)!==lc(t.assigneeEmail)){
          const a=db.staff.find(s=>s.email===lc(ch.assigneeEmail)&&s.active);
          if(!a) throw new Error('Không tìm thấy người nhận mới.');
          changes.push('Giao lại: '+t.assigneeName+' → '+a.name);
          t.assigneeName=a.name; t.assigneeEmail=a.email; t.dept=deptOf(a); action='Giao lại';
        }
      }
      if(ch.progress!==undefined&&ch.progress!==null&&ch.progress!==''){
        const p=Math.max(0,Math.min(100,Math.round(Number(ch.progress)||0)));
        if(p!==t.progress){ changes.push('Tiến độ: '+t.progress+'% → '+p+'%'); t.progress=p; }
      }
      if(ch.resultLink!==undefined&&String(ch.resultLink).trim()!==String(t.resultLink)){
        t.resultLink=String(ch.resultLink).trim(); changes.push('Link kết quả: '+(t.resultLink||'(xóa)'));
      }
      if(ch.status&&ch.status!==t.status){
        if(STATUSES.indexOf(ch.status)<0) throw new Error('Trạng thái không hợp lệ.');
        if(!u.isManager&&(FLOW[t.status]||[]).indexOf(ch.status)<0) throw new Error('Không thể chuyển từ "'+t.status+'" sang "'+ch.status+'".');
        if(ch.status==='Chờ duyệt'&&!t.resultLink&&!note) throw new Error('Vui lòng dán link kết quả hoặc ghi chú trước khi nộp.');
        if(ch.status==='Cần sửa'&&!note) throw new Error('Vui lòng ghi rõ cần sửa gì.');
        if(ch.status==='Hoàn thành') t.progress=100;
        changes.push('Trạng thái: '+t.status+' → '+ch.status);
        action={'Đang làm':oldStatus==='Mới giao'?'Nhận việc':'Làm tiếp','Chờ duyệt':'Nộp để duyệt','Cần sửa':'Yêu cầu sửa','Hoàn thành':'Duyệt hoàn thành','Hủy':'Hủy việc','Mới giao':'Đặt lại'}[ch.status]||'Đổi trạng thái';
        t.status=ch.status;
      }
      if(note){ t.note='['+shortTime()+' '+u.name+'] '+note+(t.note?'\n'+t.note:''); changes.push('Ghi chú: '+note); }
      if(!changes.length) return api.getData(token);
      t.updatedAt=nowStr();
      db.tasks[idx]=t;
      log(id,u,action,changes.join(' | '));
      save();
      return api.getData(token);
    }
  };

  function runner(ok,fail){
    return new Proxy({},{get(_,name){
      if(name==='withSuccessHandler') return f=>runner(f,fail);
      if(name==='withFailureHandler') return f=>runner(ok,f);
      return (...args)=>setTimeout(()=>{
        try{
          if(!api[name]) throw new Error('Không có hàm '+String(name));
          const r=JSON.parse(JSON.stringify(api[name](...JSON.parse(JSON.stringify(args)))));
          ok&&ok(r);
        }catch(e){ fail&&fail(e); }
      },200);
    }});
  }
  window.google={script:{run:runner(null,null)}};
})();

(function demoUI(){
  const st=document.createElement('style');
  st.textContent='.demo-hint{margin-top:18px;padding:12px;border-radius:10px;background:var(--brand-soft);font-size:13px;line-height:1.6}'+
    '.demo-hint code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}'+
    '.demo-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding:8px 12px;border:1.5px dashed var(--line);border-radius:12px;font-size:13px;color:var(--muted)}'+
    '.demo-bar .btn{min-height:38px;padding:6px 12px;font-size:13px}';
  document.head.appendChild(st);
  const hint=document.createElement('div');
  hint.className='demo-hint';
  hint.innerHTML='<b>Bản thử nghiệm</b> với dữ liệu mẫu, lưu trên trình duyệt này.<br>'+
    'Mật khẩu mẫu: <code>matkhau1</code> cho <code>admin@vidu.vn</code> (Quản trị viên), <code>cuong@vidu.vn</code> (Quản lý), <code>an@vidu.vn</code> (Thiết kế), <code>binh@vidu.vn</code> (Marketing).<br>'+
    'Thử mật khẩu tạm: <code>dung@vidu.vn</code> · <code>tam12345</code> → phải đặt mật khẩu mới.<br>'+
    '<span style="opacity:.85">Muốn dùng dữ liệu thật: dán link /exec vào dòng <code>window.KV_API_URL</code> trong <code>config.js</code>.</span>';
  document.querySelector('.login-card').appendChild(hint);
  const em=document.getElementById('l-email'); if(!em.value) em.value='admin@vidu.vn';
  const bar=document.createElement('div');
  bar.className='demo-bar';
  bar.innerHTML='<span>Bản thử nghiệm · chưa nối Google Sheet</span><button class="btn" type="button" id="btn-reset">Đặt lại dữ liệu mẫu</button>';
  document.querySelector('main.wrap').prepend(bar);
  let ask=false;
  document.getElementById('btn-reset').addEventListener('click',function(){
    if(!ask){ ask=true; this.textContent='Bấm lần nữa để xóa mọi thay đổi'; return; }
    window.resetDemo();
    try{ localStorage.removeItem('abg_token'); }catch(e){}
    location.reload();
  });
})();
}

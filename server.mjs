import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url)),publicDir=resolve(root,'public');
const dataFile=process.env.TROYS_DATA_FILE||resolve(root,'../../work/troyssafes-data.json');
const port=Number(process.env.PORT||4173),origin=`http://127.0.0.1:${port}`;
const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,32).toString('hex')};
const verify=(p,h)=>{if(!h)return false;const [salt,digest]=h.split(':');return timingSafeEqual(scryptSync(p,salt,32),Buffer.from(digest,'hex'))};
const people=[['1001','Elena Rostova','admin','Administrator','3460e.png'],['1002','Naomi Rivera','employee','Part-time Cashier','59c58.png'],['1003','Sarah Jenkins','manager','Store Manager','97cff.png'],['1004','Marcus Vance','employee','Lead Barista','4a389.png'],['1005','Clara Zhang','employee','Store Supervisor','7f780.png'],['1006','Ethan Thorne','employee','Kitchen Staff','f5f45.png'],['2001','Alex Morgan','employee','New Employee',''],['2002','Jamie Taylor','manager','New Manager','']];
const today=new Date();const monday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-((today.getDay()+6)%7));
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const day=n=>{const d=new Date(monday);d.setDate(d.getDate()+n);return iso(d)};
let db;if(existsSync(dataFile))db=JSON.parse(readFileSync(dataFile,'utf8'));else{
 db={users:people.map(([id,name,role,job,avatar])=>({id,name,role,job,avatar,email:role==='admin'?'admin@troyssafes.test':id==='1002'?'employee@troyssafes.test':id==='1003'?'manager@troyssafes.test':name.toLowerCase().replace(' ','.')+'@troyssafes.test',password:id.startsWith('1')?(process.env.TROYS_DEMO_PASSWORD?hash(process.env.TROYS_DEMO_PASSWORD):null):null})),shifts:[],punches:[],messages:[],publishedAt:null};
 const patterns=[['1004',[0,1,3,4,5],'06:00','14:30','Morning','yellow'],['1005',[0,1,2,5,6],'08:00','16:30','Supervisor','peach'],['1006',[1,2,3,4],'10:00','18:30','Prep Shift','purple'],['1002',[0,2,3,6],'14:00','20:30','Closing','yellow'],['1003',[0,2,4],'08:00','16:00','Floor Manager','teal'],['1001',[1,3],'06:00','14:00','Administration','blue'],[null,[5,6],'06:00','14:00','Open shift','peach']];
 for(const [userId,days,start,end,label,color]of patterns)for(const d of days)db.shifts.push({id:randomBytes(8).toString('hex'),userId,date:day(d),start,end,label,color,published:true});
 for(const [i,uid]of ['1002','1004','1005','1006'].entries())for(let n=0;n<3;n++){const start=new Date(monday);start.setDate(start.getDate()-7+n);start.setHours(8+i,0,0,0);db.punches.push({id:randomBytes(8).toString('hex'),userId:uid,in:start.toISOString(),out:new Date(+start+8*3600000).toISOString(),status:n===2?'Pending':'Approved',note:'Sample time entry',breaks:[]})}
 db.messages=[{id:'welcome',from:'1003',to:'all',text:'Welcome to TroysSafes! Please check this week’s schedule and clock in when your shift starts.',at:new Date().toISOString()}];save();
}
function save(){mkdirSync(dirname(dataFile),{recursive:true});writeFileSync(dataFile+'.tmp',JSON.stringify(db,null,2));renameSync(dataFile+'.tmp',dataFile);}
const sessions=new Map(),attempts=new Map();
const safeUser=u=>{const {password,...rest}=u;return rest};
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
function reply(res,status,value,headers={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});res.end(JSON.stringify(value));}
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>20000)fail(413,'Request too large')}try{return s?JSON.parse(s):{}}catch{fail(400,'Invalid request')}}
function role(u,allowed){if(!allowed.includes(u.role))fail(403,'This page is not available for your role.')}
function active(u){return db.punches.find(p=>p.userId===u.id&&!p.out)}
function accountView(u){return {...safeUser(u),activated:!!u.password}}
function accountFields(b){
 const name=typeof b.name==='string'?b.name.trim():'',email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!name||name.length>80)fail(400,'Enter a name of up to 80 characters.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>160)fail(400,'Enter a valid email address.');
 if(!['admin','employee','manager'].includes(b.role))fail(400,'Choose Admin, Employee, or Manager.');
 return {name,email,role:b.role,job:typeof b.job==='string'?b.job.trim().slice(0,80):b.role};
}
function newSession(u,res){const token=randomBytes(32).toString('hex');sessions.set(token,{id:u.id,expires:Date.now()+12*3600000});reply(res,200,{user:safeUser(u)},{'Set-Cookie':`troys_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`})}
const server=http.createServer(async(req,res)=>{try{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'");
 if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`)fail(403,'Invalid host');
 const url=new URL(req.url,origin),path=url.pathname;
 if(!path.startsWith('/api/')){if(!['GET','HEAD'].includes(req.method))fail(405,'Method not allowed');const requested=path==='/'?'/index.html':path;const f=resolve(publicDir,'.'+decodeURIComponent(requested));if(!f.startsWith(publicDir+'\\')&&!f.startsWith(publicDir+'/'))fail(404,'Not found');let bytes;try{bytes=readFileSync(f)}catch{fail(404,'Not found')}res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'})[extname(f)]||'application/octet-stream'});res.end(bytes);return;}
 if(req.method!=='GET'&&req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))fail(403,'Invalid origin');
 const b=req.method==='GET'?{}:await body(req);
 if(path==='/api/login'&&req.method==='POST'){
  const key=req.socket.remoteAddress,a=attempts.get(key)||{n:0,at:Date.now()};if(Date.now()-a.at>60000){a.n=0;a.at=Date.now()}a.n++;attempts.set(key,a);if(a.n>30)fail(429,'Too many attempts. Try again in a minute.');
  const u=db.users.find(u=>u.id===String(b.login).trim()||u.email.toLowerCase()===String(b.login).trim().toLowerCase());if(!u||u.deletedAt||typeof b.password!=='string'||b.password.length>200||!verify(b.password,u.password))fail(401,'ID/email or password is incorrect.');newSession(u,res);return;
 }
 if(path==='/api/signup'&&req.method==='POST'){
  const u=db.users.find(u=>u.id===String(b.id).trim());if(!u||u.deletedAt)fail(400,'This ID does not match an invited user.');if(u.password)fail(409,'This ID already has an account. Please sign in.');if(typeof b.password!=='string'||b.password.length<8||b.password.length>128)fail(400,'Use a password with 8–128 characters.');if(b.password!==b.confirm)fail(400,'Passwords do not match.');u.password=hash(b.password);save();newSession(u,res);return;
 }
 const token=req.headers.cookie?.split('; ').find(x=>x.startsWith('troys_session='))?.slice(14);const session=sessions.get(token);const u=session&&session.expires>Date.now()?db.users.find(x=>x.id===session.id):null;if(!u||u.deletedAt)fail(401,'Please sign in.');
 if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);reply(res,200,{ok:true},{'Set-Cookie':'troys_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});return;}
 if(path==='/api/accounts'&&req.method==='GET'){role(u,['admin']);reply(res,200,{accounts:db.users.filter(x=>!x.deletedAt).map(accountView)});return;}
 if(path==='/api/accounts'&&req.method==='POST'){
  role(u,['admin']);const fields=accountFields(b),id=typeof b.id==='string'?b.id.trim():'';
  if(!/^\d{1,12}$/.test(id))fail(400,'User ID must contain 1–12 digits.');
  if(db.users.some(x=>x.id===id||x.email.toLowerCase()===fields.email))fail(409,'This ID or email is already used. Choose a different one.');
  const account={id,...fields,avatar:'',password:null};db.users.push(account);save();reply(res,201,{account:accountView(account)});return;
 }
 if(path==='/api/accounts/edit'&&req.method==='POST'){
  role(u,['admin']);const account=db.users.find(x=>x.id===b.id&&!x.deletedAt);if(!account)fail(404,'Account not found.');const fields=accountFields(b);
  if(account.id===u.id&&fields.role!=='admin')fail(409,'You cannot remove your own Admin role. Ask another Admin to change it.');
  if(fields.role==='manager'&&active(account))fail(409,'This user must clock out before changing to Manager.');
  if(db.users.some(x=>x.id!==account.id&&x.email.toLowerCase()===fields.email))fail(409,'This email is already used.');
  const roleChanged=account.role!==fields.role;Object.assign(account,fields);save();
  if(roleChanged)for(const [key,value]of sessions)if(value.id===account.id)sessions.delete(key);
  reply(res,200,{account:accountView(account)});return;
 }
 if(path==='/api/accounts/delete'&&req.method==='POST'){
  role(u,['admin']);const account=db.users.find(x=>x.id===b.id&&!x.deletedAt);if(!account)fail(404,'Account not found.');
  if(account.id===u.id)fail(409,'You cannot delete your own account.');
  if(active(account))fail(409,'This user must clock out before deleting their account.');
  account.deletedAt=new Date().toISOString();account.password=null;save();for(const [key,value]of sessions)if(value.id===account.id)sessions.delete(key);
  reply(res,200,{ok:true});return;
 }
 if(path==='/api/state'&&req.method==='GET'){reply(res,200,{user:safeUser(u),users:db.users.map(safeUser),...(u.role==='admin'?{accounts:db.users.filter(x=>!x.deletedAt).map(accountView)}:{}),shifts:['admin','manager'].includes(u.role)?db.shifts:db.shifts.map(s=>s.published?s:s.publishedVersion).filter(Boolean),punches:db.punches.filter(p=>u.role==='admin'||p.userId===u.id),messages:db.messages.filter(m=>m.to==='all'||m.from===u.id||m.to===u.id),publishedAt:db.publishedAt});return;}
 if(path==='/api/clock'&&req.method==='POST'){role(u,['employee','admin']);const p=active(u),now=new Date().toISOString();if(b.action==='in'){if(p)fail(409,'You are already clocked in.');db.punches.push({id:randomBytes(8).toString('hex'),userId:u.id,in:now,out:null,status:'Active',note:'',breaks:[]});}else{if(!p)fail(409,'Clock in first.');if(b.action==='out'){if(p.breaks.at(-1)&&!p.breaks.at(-1).end)p.breaks.at(-1).end=now;p.out=now;p.status='Pending';}else if(b.action==='break'){if(p.breaks.at(-1)&&!p.breaks.at(-1).end)p.breaks.at(-1).end=now;else p.breaks.push({start:now,end:null});}else if(b.action==='note'){if(typeof b.note!=='string'||b.note.length>1000)fail(400,'Note is too long.');p.note=b.note.trim();}else fail(400,'Unknown clock action');}save();reply(res,200,{ok:true});return;}
 if(path==='/api/approve'&&req.method==='POST'){role(u,['admin']);const p=db.punches.find(p=>p.id===b.id);if(!p||!p.out)fail(404,'Completed timesheet not found.');if(!['Approved','Rejected'].includes(b.status))fail(400,'Invalid status');p.status=b.status;save();reply(res,200,{ok:true});return;}
 if(path==='/api/shifts'&&req.method==='POST'){role(u,['admin','manager']);if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!Number.isFinite(Date.parse(b.date+'T12:00:00'))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end)||b.end<=b.start)fail(400,'Choose a valid date and an end time after the start time.');if(b.userId&&!db.users.some(x=>x.id===b.userId&&!x.deletedAt))fail(400,'Unknown staff member.');if(typeof b.label!=='string'||!b.label.trim()||b.label.length>60)fail(400,'Enter a shift label (up to 60 characters).');const existing=b.id?db.shifts.find(s=>s.id===b.id):null;if(b.id&&!existing)fail(404,'Shift not found');if(b.userId&&db.shifts.some(s=>s.id!==b.id&&s.userId===b.userId&&s.date===b.date&&s.start<b.end&&s.end>b.start))fail(409,'This person already has a shift that overlaps these hours.');const values={userId:b.userId||null,date:b.date,start:b.start,end:b.end,label:b.label.trim(),color:['blue','purple','yellow','peach','teal'].includes(b.color)?b.color:'blue',published:false};if(existing){if(existing.published)existing.publishedVersion={...existing};Object.assign(existing,values);}else db.shifts.push({id:randomBytes(8).toString('hex'),...values});save();reply(res,200,{ok:true});return;}
 if(path==='/api/shifts/delete'&&req.method==='POST'){role(u,['admin','manager']);const s=db.shifts.find(s=>s.id===b.id);if(!s)fail(404,'Shift not found');db.shifts=db.shifts.filter(s=>s.id!==b.id);save();reply(res,200,{ok:true});return;}
 if(path==='/api/publish'&&req.method==='POST'){role(u,['admin','manager']);for(const s of db.shifts){s.published=true;delete s.publishedVersion;}db.publishedAt=new Date().toISOString();save();reply(res,200,{ok:true});return;}
 if(path==='/api/messages'&&req.method==='POST'){if(b.to!=='all'&&!db.users.some(x=>x.id===b.to&&!x.deletedAt))fail(400,'Choose a recipient.');if(typeof b.text!=='string'||!b.text.trim()||b.text.length>2000)fail(400,'Write a message of up to 2,000 characters.');db.messages.push({id:randomBytes(8).toString('hex'),from:u.id,to:b.to,text:b.text.trim(),at:new Date().toISOString()});save();reply(res,200,{ok:true});return;}
 fail(404,'Not found');
 }catch(e){reply(res,e.code||500,{error:e.code?e.message:'Something went wrong. Please try again.'});if(!e.code)console.error(e)}});
server.listen(port,'127.0.0.1',()=>console.log(`TroysSafes local preview: ${origin}`));




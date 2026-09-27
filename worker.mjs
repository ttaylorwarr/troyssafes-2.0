import { DurableObject } from 'cloudflare:workers';
import { randomBytes, timingSafeEqual } from 'node:crypto';
const encoder=new TextEncoder();
const equal=(a,b)=>{const x=encoder.encode(a),y=encoder.encode(b);return x.length===y.length&&timingSafeEqual(x,y)};
async function derive(password,salt){const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);return Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',salt:Buffer.from(salt,'hex'),iterations:100000,hash:'SHA-256'},key,256)).toString('hex')}
async function hash(password){const salt=randomBytes(16).toString('hex');return salt+':'+await derive(password,salt)}
async function verify(password,value){if(!value)return false;const [salt,digest]=value.split(':');return equal(await derive(password,salt),digest)}
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const safeUser=u=>{const {password,inviteCode,...rest}=u;return rest};
function reply(res,status,value,headers={}){throw new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...headers}})}
export default {async fetch(request,env){const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return Response.json({error:'Invalid origin'},{status:403});return env.STAFF.get(env.STAFF.idFromName('troyssafes')).fetch(request)}};
export class StaffStore extends DurableObject {
 async fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
  const db=await this.ctx.storage.get('db')||{users:[],shifts:[],punches:[],messages:[],publishedAt:null};
  const sessions=new Map(await this.ctx.storage.get('sessions')||[]),attempts=new Map(await this.ctx.storage.get('attempts')||[]);
  for(const [key,value] of sessions)if(value.expires<Date.now())sessions.delete(key);
  for(const [key,value] of attempts)if(Date.now()-value.at>60000)attempts.delete(key);
  let dirty=false;const save=()=>{dirty=true};const res=null;
  const req={method:request.method,headers:{cookie:request.headers.get('Cookie')},socket:{remoteAddress:request.headers.get('CF-Connecting-IP')||'local'}};
  const path=new URL(request.url).pathname;
  function role(u,allowed){if(!allowed.includes(u.role))fail(403,'This page is not available for your role.')}
function active(u){return db.punches.find(p=>p.userId===u.id&&!p.out)}
function accountView(u){return {...safeUser(u),activated:!!u.password,inviteCode:u.password?undefined:u.inviteCode}}
function accountFields(b){
 const name=typeof b.name==='string'?b.name.trim():'',email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(!name||name.length>80)fail(400,'Enter a name of up to 80 characters.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>160)fail(400,'Enter a valid email address.');
 if(!['admin','employee','manager'].includes(b.role))fail(400,'Choose Admin, Employee, or Manager.');
 return {name,email,role:b.role,job:typeof b.job==='string'?b.job.trim().slice(0,80):b.role};
}
function newSession(u,res){const token=randomBytes(32).toString('hex');sessions.set(token,{id:u.id,expires:Date.now()+12*3600000});save();reply(res,200,{user:safeUser(u)},{'Set-Cookie':`troys_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`})}

  try {
   let b={};if(req.method!=='GET'){const reader=request.body?.getReader();let chunks=[],size=0;if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20000){await reader.cancel();fail(413,'Request too large')}chunks.push(value)}try{b=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{fail(400,'Invalid JSON')}if(!b||Array.isArray(b)||typeof b!=='object')fail(400,'Invalid request');}
   if(['/api/login','/api/signup','/api/setup'].includes(path)&&req.method==='POST'){const key=req.socket.remoteAddress,a=attempts.get(key)||{n:0,at:Date.now()};a.n++;attempts.set(key,a);dirty=true;if(a.n>20)fail(429,'Too many attempts. Try again in a minute.')}
   if(path==='/api/setup-status'&&req.method==='GET')reply(res,200,{needsSetup:db.users.length===0,enabled:!!this.env.SETUP_TOKEN});
   if(path==='/api/setup'&&req.method==='POST'){
    if(db.users.length)fail(409,'Setup is already complete.');
    if(!this.env.SETUP_TOKEN||typeof b.setupToken!=='string'||!equal(b.setupToken,this.env.SETUP_TOKEN))fail(403,'Setup token is incorrect or not configured.');
    const fields=accountFields({...b,role:'admin'});
    if(typeof b.id!=='string'||!/^\d{1,12}$/.test(b.id))fail(400,'Choose a numeric user ID.');
    if(typeof b.password!=='string'||b.password.length<12||b.password.length>128||b.password!==b.confirm)fail(400,'Use matching passwords of 12–128 characters.');
    const u={id:b.id,...fields,password:await hash(b.password),avatar:''};db.users.push(u);save();newSession(u,res);
   }
 if(path==='/api/login'&&req.method==='POST'){
  const u=db.users.find(u=>u.id===String(b.login).trim()||u.email.toLowerCase()===String(b.login).trim().toLowerCase());if(!u||u.deletedAt||typeof b.password!=='string'||b.password.length>200||!await verify(b.password,u.password))fail(401,'ID/email or password is incorrect.');newSession(u,res);return;
 }
 if(path==='/api/signup'&&req.method==='POST'){
  const u=db.users.find(u=>u.id===String(b.id).trim());if(!u||u.deletedAt)fail(400,'This ID does not match an invited user.');if(u.password)fail(409,'This ID already has an account. Please sign in.');if(typeof b.inviteCode!=='string'||!u.inviteCode||!equal(b.inviteCode.trim(),u.inviteCode))fail(400,'The ID or invitation code is incorrect.');if(typeof b.password!=='string'||b.password.length<8||b.password.length>128)fail(400,'Use a password with 8–128 characters.');if(b.password!==b.confirm)fail(400,'Passwords do not match.');u.password=await hash(b.password);delete u.inviteCode;save();newSession(u,res);return;
 }
 const token=req.headers.cookie?.split('; ').find(x=>x.startsWith('troys_session='))?.slice(14);const session=sessions.get(token);const u=session&&session.expires>Date.now()?db.users.find(x=>x.id===session.id):null;if(!u||u.deletedAt)fail(401,'Please sign in.');
 if(path==='/api/logout'&&req.method==='POST'){sessions.delete(token);save();reply(res,200,{ok:true},{'Set-Cookie':'troys_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});return;}
 if(path==='/api/accounts'&&req.method==='GET'){role(u,['admin']);reply(res,200,{accounts:db.users.filter(x=>!x.deletedAt).map(accountView)});return;}
 if(path==='/api/accounts'&&req.method==='POST'){
  role(u,['admin']);const fields=accountFields(b),id=typeof b.id==='string'?b.id.trim():'';
  if(!/^\d{1,12}$/.test(id))fail(400,'User ID must contain 1–12 digits.');
  if(db.users.some(x=>x.id===id||x.email.toLowerCase()===fields.email))fail(409,'This ID or email is already used. Choose a different one.');
  const account={id,...fields,avatar:'',password:null,inviteCode:randomBytes(24).toString('hex')};db.users.push(account);save();reply(res,201,{account:accountView(account)});return;
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
  }catch(e){if(e instanceof Response)return e;return Response.json({error:e.code?e.message:'Please try again.'},{status:e.code||500,headers:{'Cache-Control':'no-store'}})}
  finally{if(dirty)await this.ctx.storage.put({db,sessions:[...sessions],attempts:[...attempts]})}
 })}
}

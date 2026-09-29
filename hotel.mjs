import { randomBytes, randomInt } from 'node:crypto';
const error=(status,message)=>{throw Object.assign(new Error(message),{code:status})};
const money=v=>{if(typeof v!=='string'||!/^\d{1,7}(\.\d{1,2})?$/.test(v))error(400,'Enter a valid amount with up to two decimal places.');const n=Math.round(Number(v)*100);if(n<1||n>100000000)error(400,'Amount must be between 0.01 and 1,000,000.');return n};
const text=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
const id=()=>randomBytes(12).toString('hex');
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export async function hotel({path,method,b,u,db,storage,save}){
 if(!path.startsWith('/api/hotel/'))return;
 const owner=u.role==='owner',approver=owner||u.role==='manager';
 const h=db.hotel??={rooms:[],bookings:[],balances:{},ledger:[]};
 const requireOwner=()=>{if(!owner)error(403,'Only the Owner can do this.')};
 const ledger=(userId,delta,description,ref)=>{h.balances[userId]=(h.balances[userId]||0)+delta;h.ledger.push({id:id(),userId,delta,description,ref,by:u.id,at:new Date().toISOString()})};
 if(path.startsWith('/api/hotel/images/')&&method==='GET'){
  const key=path.split('/').at(-1);if(!/^[a-f0-9]{24}$/.test(key))error(404,'Image not found.');const image=await storage.get('room-image:'+key);if(!image)error(404,'Image not found.');return new Response(image,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/api/hotel/state'&&method==='GET')return {rooms:h.rooms.filter(r=>owner||r.available),bookings:h.bookings.filter(x=>approver||x.userId===u.id).map(x=>{const {pin,...rest}=x;return {...rest,...(x.status==='Approved'&&(approver||x.userId===u.id)?{pin}:{})}}),balance:h.balances[u.id]||0,ledger:h.ledger.filter(x=>owner||x.userId===u.id),balances:owner?h.balances:undefined,people:owner?db.users.filter(x=>!x.deletedAt).map(x=>({id:x.id,name:x.name})):undefined};
 if(method!=='POST')error(404,'Not found.');
 if(path==='/api/hotel/rooms'){
  requireOwner();const name=text(b.name,80),info=text(b.info,2000),price=money(b.price);if(!name)error(400,'Room name is required.');const existing=b.id?h.rooms.find(r=>r.id===b.id):null;if(b.id&&!existing)error(404,'Room not found.');
  if(existing&&b.version!==existing.updatedAt)error(409,'Room changed. Refresh and try again.');
  let image=existing?.image||null;
  if(b.photo){if(typeof b.photo!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(b.photo))error(400,'Upload a JPEG image.');const bytes=Buffer.from(b.photo.split(',')[1],'base64');if(bytes.length>100000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)error(400,'Image must be a JPEG under 100 KB.');image=id();await storage.put('room-image:'+image,bytes);}
  const values={name,info,price,image,available:b.available===true,updatedAt:new Date().toISOString()};if(existing)Object.assign(existing,values);else h.rooms.push({id:id(),...values});save();return {ok:true};
 }
 if(path==='/api/hotel/credit'){
  requireOwner();if(!db.users.some(x=>x.id===b.userId&&!x.deletedAt))error(400,'Choose a user.');const amount=money(b.amount),note=text(b.note,200);if(!note)error(400,'Enter a reference or reason.');if(typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(b.requestId))error(400,'Invalid request.');if(h.ledger.some(x=>x.ref===b.requestId))return {ok:true};if((h.balances[b.userId]||0)+amount>100000000)error(400,'Balance limit reached.');ledger(b.userId,amount,note,b.requestId);save();return {ok:true};
 }
 if(path==='/api/hotel/book'){
  if(typeof b.requestId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(b.requestId))error(400,'Invalid request.');const repeat=h.bookings.find(x=>x.requestId===b.requestId&&x.userId===u.id);if(repeat)return {ok:true};
  const room=h.rooms.find(r=>r.id===b.roomId&&r.available);if(!room)error(404,'Room unavailable.');if(!validDate(b.checkIn)||!validDate(b.checkOut)||b.checkIn<new Date(Date.now()-86400000).toISOString().slice(0,10))error(400,'Choose valid check-in and check-out dates.');const nights=(Date.parse(b.checkOut)-Date.parse(b.checkIn))/86400000;if(nights<1||nights>365)error(400,'Choose a stay of 1 to 365 nights.');
  const total=room.price*nights;if(b.expectedTotal!==total)error(409,'The price changed. Refresh and book again.');if(h.bookings.some(x=>x.roomId===room.id&&['Pending','Approved'].includes(x.status)&&x.checkIn<b.checkOut&&x.checkOut>b.checkIn))error(409,'This room is already reserved for those dates.');if((h.balances[u.id]||0)<total)error(400,'Not enough credit. Ask the Owner to add credit.');
  const booking={id:id(),requestId:b.requestId,userId:u.id,guestName:u.name,roomId:room.id,roomName:room.name,checkIn:b.checkIn,checkOut:b.checkOut,nights,nightlyPrice:room.price,total,status:'Pending',at:new Date().toISOString()};h.bookings.push(booking);ledger(u.id,-total,'Credit reserved: '+room.name,booking.id);save();return {ok:true};
 }
 if(path==='/api/hotel/decision'){
  const booking=h.bookings.find(x=>x.id===b.id);if(!booking)error(404,'Booking not found.');const cancel=b.action==='Cancel';if(cancel?booking.userId!==u.id:!approver)error(403,'You cannot change this booking.');if(!['Approve','Reject','Cancel'].includes(b.action))error(400,'Invalid action.');if(booking.status!=='Pending')error(409,'This booking has already been processed.');
  if(b.action==='Approve'){booking.status='Approved';const pin=String(randomInt(0,100000000)).padStart(8,'0');booking.pin=pin.slice(0,4)+'-'+pin.slice(4);}else{booking.status=cancel?'Cancelled':'Rejected';ledger(booking.userId,booking.total,'Credit returned: '+booking.roomName,booking.id);}
  booking.reviewedBy=u.id;booking.reviewedAt=new Date().toISOString();save();return {ok:true};
 }
 error(404,'Not found.');
}

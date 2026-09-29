import assert from 'node:assert/strict';
import {hotel} from '../hotel.mjs';
const db={users:[{id:'o',role:'owner',name:'Owner'},{id:'m',role:'manager',name:'Manager'},{id:'a',role:'admin',name:'Admin'},{id:'g',role:'guest',name:'Guest'},{id:'h',role:'guest',name:'Other'}]};let checks=0;const images=new Map();
const call=(who,path,b,method=b?'POST':'GET')=>hotel({path:'/api/hotel/'+path,method,b,u:db.users.find(x=>x.id===who),db,storage:{get:k=>images.get(k),put:(k,v)=>images.set(k,v)},save(){}});
const ok=(v,msg)=>{assert.ok(v,msg);checks++;console.log('PASS '+msg)};
async function denied(w,p,b,code=403){await assert.rejects(call(w,p,b),e=>e.code===code);checks++}
await denied('a','rooms',{name:'A',price:'10'});await denied('m','rooms',{name:'A',price:'10'});await denied('g','credit',{userId:'g',amount:'10'});
await call('o','rooms',{name:'Garden Room',info:'Queen bed',price:'50.00',available:true});const room=db.hotel.rooms[0];ok(room.price===5000,'price stored in cents');
await denied('o','rooms',{name:'Bad',price:'-1'},400);
await call('o','credit',{userId:'g',amount:'200.00',note:'Cash payment',requestId:'credit-request-0001'});await call('o','credit',{userId:'g',amount:'200.00',note:'Cash payment',requestId:'credit-request-0001'});ok(db.hotel.balances.g===20000,'credit retry does not duplicate');
const request={roomId:room.id,checkIn:'2027-01-01',checkOut:'2027-01-03',expectedTotal:10000,requestId:'booking-request-001'};
await denied('g','book',{...request,checkOut:'2027-01-01'},400);await denied('g','book',{...request,expectedTotal:1},409);await denied('h','book',request,400);
await call('g','book',request);await call('g','book',request);ok(db.hotel.balances.g===10000,'booking reserves credit once');const booking=db.hotel.bookings[0];
ok(!(await call('g','state')).bookings[0].pin,'no PIN before approval');ok((await call('h','state')).bookings.length===0,'other guest cannot see booking');
await denied('h','book',{...request,requestId:'booking-request-002'},409);await denied('a','decision',{id:booking.id,action:'Approve'});await denied('g','decision',{id:booking.id,action:'Approve'});
await call('m','decision',{id:booking.id,action:'Approve'});ok(/^\d{4}-\d{4}$/.test((await call('g','state')).bookings[0].pin),'approved guest sees eight-digit PIN');
await denied('m','decision',{id:booking.id,action:'Approve'},409);await denied('g','decision',{id:booking.id,action:'Cancel'},409);
const second={...request,checkIn:'2027-01-03',checkOut:'2027-01-04',expectedTotal:5000,requestId:'booking-request-003'};await call('g','book',second);const b2=db.hotel.bookings[1];await call('m','decision',{id:b2.id,action:'Reject'});ok(db.hotel.balances.g===10000,'rejection returns credit');await denied('m','decision',{id:b2.id,action:'Reject'},409);
await call('g','book',{...second,requestId:'booking-request-004'});await call('g','decision',{id:db.hotel.bookings[2].id,action:'Cancel'});ok(db.hotel.balances.g===10000,'cancellation returns credit');
await call('o','rooms',{id:room.id,version:room.updatedAt,name:room.name,price:'60',available:false});ok((await call('g','state')).rooms.length===0,'hidden room removed from listing');ok((await call('o','state')).rooms.length===1,'owner can manage hidden rooms');
ok((await call('g','state')).ledger.every(x=>x.userId==='g'),'guest credit history is private');
console.log(checks+' hotel checks passed');


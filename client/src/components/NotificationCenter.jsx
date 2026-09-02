import { useEffect,useRef,useState } from 'react';
import { Bell,CheckCheck,Info,X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

const ago=value=>{const seconds=Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return 'Just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`};

export default function NotificationCenter({className='',onTarget}){
 const nav=useNavigate(),root=useRef(null),[open,setOpen]=useState(false),[data,setData]=useState({notifications:[],unread:0}),[loading,setLoading]=useState(false);
 const load=()=>{setLoading(true);return api.get('/notifications').then(r=>setData(r.data||{notifications:[],unread:0})).catch(()=>{}).finally(()=>setLoading(false))};
 useEffect(()=>{load();const timer=setInterval(load,60000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{const close=e=>{if(root.current&&!root.current.contains(e.target))setOpen(false)};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close)},[]);
 const toggle=()=>{setOpen(x=>!x);if(!open)load()};
 const read=async item=>{if(!item.is_read)await api.patch(`/notifications/${item.id}/read`);setData(x=>({...x,unread:Math.max(0,x.unread-(item.is_read?0:1)),notifications:x.notifications.map(n=>n.id===item.id?{...n,is_read:1}:n)}));setOpen(false);if(onTarget)onTarget(item);else if(item.target_path)nav(item.target_path)};
 const readAll=async()=>{await api.post('/notifications/read-all');setData(x=>({...x,unread:0,notifications:x.notifications.map(n=>({...n,is_read:1}))}))};
 return <div className={`notification-center ${className}`} ref={root}><button className="notification-trigger" onClick={toggle} aria-label="Notifications"><Bell size={18}/>{data.unread>0&&<b>{data.unread>99?'99+':data.unread}</b>}</button>{open&&<section className="notification-panel"><header><div><strong>Notifications</strong><span>{data.unread} unread</span></div><button onClick={()=>setOpen(false)} aria-label="Close notifications"><X size={16}/></button></header>{data.unread>0&&<button className="notification-read-all" onClick={readAll}><CheckCheck size={14}/>Mark all as read</button>}<div className="notification-items">{data.notifications.map(item=><button key={item.id} className={`${item.is_read?'':'unread'} ${item.type}`} onClick={()=>read(item)}><span><Info size={15}/></span><div><strong>{item.title}</strong><p>{item.message}</p><small>{ago(item.created_at)}</small></div></button>)}{!loading&&!data.notifications.length&&<div className="notification-empty"><Bell size={22}/><span>You’re all caught up.</span></div>}{loading&&!data.notifications.length&&<div className="notification-empty">Loading…</div>}</div></section>}</div>;
}

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, MessageCircle, Phone, Printer, Search } from 'lucide-react';
import { api } from '../../lib/api';

const money=(value,currency='INR')=>new Intl.NumberFormat('en-IN',{style:'currency',currency:currency||'INR',maximumFractionDigits:2}).format(Number(value||0));

export default function FrontdeskReminders({navigate}) {
  const [data,setData]=useState({summary:{},customers:[]});
  const [filter,setFilter]=useState('all');
  const [query,setQuery]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{api.get('/collections/reminders').then(result=>setData(result.data||{})).catch(err=>setError(err.response?.data?.message||'Unable to load due reminders.'));},[]);
  const customers=useMemo(()=>(data.customers||[]).filter(item=>{
    const days=Number(item.days_until_due);
    const status=days<0?'overdue':days===0?'today':'upcoming';
    return (filter==='all'||filter===status)&&JSON.stringify(item).toLowerCase().includes(query.toLowerCase());
  }),[data,filter,query]);
  const contact=(customer,kind)=>{const phone=String(customer.phone||'').replace(/[^0-9+]/g,'');if(!phone)return; if(kind==='whatsapp'){const digits=phone.replace(/\D/g,'');const message=encodeURIComponent(`Hello ${customer.customer_name}, this is a reminder that your monthly interest payment of ${money(customer.monthly_interest_amount,customer.currency)} is due on ${customer.next_interest_date}. Thank you.`);window.open(`https://wa.me/${digits}?text=${message}`,'_blank','noopener,noreferrer');}else{window.location.href=`tel:${phone}`;}};
  const print=()=>window.print();
  return <div className="fd-reminders">
    {error&&<div className="finance-error">{error}</div>}
    <section className="fd-reminder-summary"><Summary icon={AlertTriangle} label="Overdue" value={data.summary?.overdue||0} tone="red"/><Summary icon={BellRing} label="Due today" value={data.summary?.due_today||0} tone="amber"/><Summary icon={CalendarClock} label="Next 7 days" value={data.summary?.upcoming||0} tone="blue"/></section>
    <section className="fd-reminder-card"><header><div><strong>Customer follow-up queue</strong><span>Contact customers before collecting and recording payment</span></div><button className="secondary-btn" onClick={print}><Printer size={15}/> Print list</button></header><div className="fd-reminder-toolbar"><div className="finance-page-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search customer, phone, ID or company"/></div><div className="fd-reminder-tabs">{[['all','All'],['overdue','Overdue'],['today','Due today'],['upcoming','Upcoming']].map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div></div>
      {customers.length?<div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Priority</th><th>Customer</th><th>Company</th><th>Due date</th><th>Monthly interest</th><th>Contact</th><th></th></tr></thead><tbody>{customers.map(customer=>{const days=Number(customer.days_until_due);const status=days<0?'overdue':days===0?'today':'upcoming';return <tr key={customer.id}><td><span className={`fd-reminder-status ${status}`}>{days<0?`${Math.abs(days)} days overdue`:days===0?'Due today':`In ${days} day${days===1?'':'s'}`}</span></td><td><strong>{customer.customer_name}</strong><small>{customer.id_card_number}</small></td><td>{customer.company_name}</td><td>{customer.next_interest_date}</td><td className="finance-money">{money(customer.monthly_interest_amount,customer.currency)}</td><td>{customer.phone||<span className="fd-no-contact">No phone saved</span>}</td><td><div className="fd-reminder-actions"><button disabled={!customer.phone} onClick={()=>contact(customer,'call')} title="Call customer"><Phone size={14}/></button><button disabled={!customer.phone} onClick={()=>contact(customer,'whatsapp')} title="Open WhatsApp reminder"><MessageCircle size={14}/></button><button className="primary-btn" onClick={()=>navigate('collections')}>Collect</button></div></td></tr>})}</tbody></table></div>:<div className="fd-dashboard-empty"><CheckCircle2 size={22}/><span>No customers match this reminder category.</span></div>}
    </section>
  </div>;
}

function Summary({icon:Icon,label,value,tone}){return <div className={`fd-reminder-summary-item ${tone}`}><span><Icon size={18}/></span><div><small>{label}</small><strong>{value}</strong><p>customer{Number(value)===1?'':'s'}</p></div></div>;}

import { useEffect, useState } from 'react';
import { Check, X, RefreshCw } from 'lucide-react';
import { api, getUser } from '../../lib/api';

const money=v=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(v||0));

export default function Approvals(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [rejecting,setRejecting]=useState(null);
  const [reason,setReason]=useState('');
  const [error,setError]=useState('');
  const user=getUser();
  const canApprove=['group_admin','company_admin'].includes(user?.role);

  const load=()=>{setLoading(true);api.get('/finance-approvals/pending').then(r=>setRows(r.data||[])).catch(()=>setRows([])).finally(()=>setLoading(false))};
  useEffect(()=>{load()},[]);

  const approve=async row=>{
    if(!window.confirm(`Approve ${row.description||row.category||'this transaction'}?`))return;
    try{await api.put(`/finance/${row.id}/approve`);load()}catch(e){window.alert(e.response?.data?.message||'Unable to approve.')}
  };
  const reject=async()=>{
    if(!reason.trim())return setError('Rejection reason is required.');
    try{await api.put(`/finance/${rejecting.id}/reject`,{reason:reason.trim()});setRejecting(null);setReason('');setError('');load()}
    catch(e){setError(e.response?.data?.message||'Unable to reject.')}
  };

  return <section className="finance-card" style={{padding:0,overflow:'hidden'}}>
    <div style={{padding:'15px 17px',borderBottom:'1px solid #eaecf0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <div><strong>Pending approvals</strong><div style={{fontSize:12,color:'#667085',marginTop:3}}>{rows.length} transaction{rows.length===1?'':'s'} waiting for review</div></div>
      <button className="secondary-btn" onClick={load}><RefreshCw size={15}/>Refresh</button>
    </div>
    <div style={{overflowX:'auto'}}><table className="finance-table">
      <thead><tr><th>Date</th><th>Company</th><th>Created by</th><th>Type</th><th>Description</th><th>Amount</th><th></th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td>{r.date||'—'}</td><td>{r.company_name||'—'}</td><td>{r.created_by_name||'—'}</td><td style={{textTransform:'capitalize'}}>{r.type}</td><td>{r.description||r.category||'—'}</td><td className="finance-money">{money(r.amount)}</td><td>
        {canApprove?<div className="finance-actions"><button className="finance-icon-btn" title="Approve" onClick={()=>approve(r)}><Check size={16}/></button><button className="finance-icon-btn danger" title="Reject" onClick={()=>{setRejecting(r);setReason('');setError('')}}><X size={16}/></button></div>:<span className="finance-badge pending">Pending</span>}
      </td></tr>)}</tbody>
    </table>{!loading&&!rows.length&&<div className="finance-empty">No transactions are waiting for approval.</div>}{loading&&<div className="finance-empty">Loading approvals...</div>}</div>
    {rejecting&&<div className="finance-modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setRejecting(null)}><div className="finance-modal"><p className="eyebrow">REJECT TRANSACTION</p><h2 style={{margin:'4px 0 6px'}}>Rejection reason</h2><p style={{fontSize:13,color:'#667085'}}>Explain what must be corrected before this transaction can be resubmitted.</p>{error&&<div className="finance-error">{error}</div>}<textarea maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Example: Attach the supplier invoice and correct the amount."/><div className="finance-modal-actions"><button className="secondary-btn" onClick={()=>setRejecting(null)}>Cancel</button><button className="primary-btn" onClick={reject}>Reject transaction</button></div></div></div>}
  </section>
}

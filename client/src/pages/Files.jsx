import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload, FolderPlus, Folder, FileText, Image as ImageIcon, Download, ExternalLink,
  Trash2, Pencil, ChevronRight, Home, Search, X, MoreVertical, Grid3X3,
  ShieldCheck, HardDrive, LockKeyhole, CalendarClock, Check, FileSpreadsheet,
  FileArchive, Presentation, FileCode2
} from 'lucide-react';
import { api, getPermissions, getUser } from '../lib/api';

export default function Files() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [folderId, setFolderId] = useState(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [editFile, setEditFile] = useState(null);
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const inputRef = useRef(null);

  const user = getUser();
  const permissionSet = new Set(getPermissions());
  const isGroupAdmin = user?.role === 'group_admin';
  const can = permission => isGroupAdmin || permissionSet.has(permission);

  const canUpload = can('files.upload') || can('files.manage');
  const canManage = can('files.manage');

  const currentCompany = companies.find(c => Number(c.id) === Number(companyId));
  const currentFolder = folders.find(f => Number(f.id) === Number(folderId));

  const loadCompanies = async () => {
    const r = await api.get('/company-options');
    setCompanies(r.data);
    if (r.data.length && !companyId) setCompanyId(String(r.data[0].id));
  };

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [folderRes, fileRes] = await Promise.all([
        api.get('/file-folders', { params: { company_id: companyId } }),
        api.get('/files-gallery', { params: { company_id: companyId, ...(folderId ? { folder_id: folderId } : {}) } })
      ]);
      setFolders(folderRes.data);
      setFiles(fileRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCompanies().catch(() => {}); }, []);
  useEffect(() => { load().catch(() => {}); }, [companyId, folderId]);

  useEffect(() => {
    setFolderId(null);
    setSelectedIds([]);
  }, [companyId]);

  useEffect(() => { setSelectedIds([]); }, [folderId]);

  const childFolders = useMemo(
    () => folders.filter(f => Number(f.parent_folder_id || 0) === Number(folderId || 0))
      .filter(f => f.name.toLowerCase().includes(query.toLowerCase())),
    [folders, folderId, query]
  );

  const visibleFiles = useMemo(
    () => files.filter(f =>
      (categoryFilter === 'all' || (f.category || 'General') === categoryFilter) &&
      `${f.name} ${f.category || ''} ${f.mime_type || ''}`.toLowerCase().includes(query.toLowerCase())
    ),
    [files, query, categoryFilter]
  );

  const categories = [...new Set(files.map(file => file.category || 'General'))].sort();
  const confidentialCount = files.filter(file => Number(file.confidential)).length;
  const expiringCount = files.filter(file => {
    if (!file.expiry_date) return false;
    const days = (new Date(file.expiry_date) - Date.now()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;
  const totalSize = files.reduce((sum, file) => sum + Number(file.file_size || 0), 0);

  const breadcrumb = useMemo(() => {
    const chain = [];
    let current = currentFolder;
    const guard = new Set();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      chain.unshift(current);
      current = folders.find(f => Number(f.id) === Number(current.parent_folder_id));
    }
    return chain;
  }, [folders, currentFolder]);

  const createFolder = async e => {
    e.preventDefault();
    if (!canManage) return;
    setError('');
    if (!folderName.trim()) return setError('Folder name is required.');
    try {
      await api.post('/file-folders', {
        company_id: companyId,
        parent_folder_id: folderId || null,
        name: folderName.trim()
      });
      setFolderName('');
      setFolderOpen(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to create folder.');
    }
  };

  const renameFolder = async folder => {
    if (!canManage) return;
    const name = window.prompt('Rename folder', folder.name);
    if (!name || name.trim() === folder.name) return;
    await api.put(`/file-folders/${folder.id}`, { name: name.trim() });
    await load();
  };

  const deleteFolder = async folder => {
    if (!canManage) return;
    if (!window.confirm(`Delete folder "${folder.name}"? The folder must be empty.`)) return;
    try {
      await api.delete(`/file-folders/${folder.id}`);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Unable to delete folder.');
    }
  };

  const deleteFile = async file => {
    if (!canManage) return;
    if (!window.confirm(`Delete "${file.name}" from Insight and AWS S3?`)) return;
    try {
      await api.delete(`/file-items/${file.id}`);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Unable to delete file.');
    }
  };

  const toggleSelected = id => setSelectedIds(current =>
    current.includes(id) ? current.filter(value => value !== id) : [...current, id]
  );

  const deleteSelected = async () => {
    if (!canManage || !selectedIds.length || !window.confirm(`Delete ${selectedIds.length} selected file${selectedIds.length === 1 ? '' : 's'} from Insight and AWS S3?`)) return;
    try {
      await Promise.all(selectedIds.map(id => api.delete(`/file-items/${id}`)));
      setSelectedIds([]);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Some selected files could not be deleted.');
      await load();
    }
  };

  const saveFile = async e => {
    e.preventDefault();
    if (!canManage) return;
    try {
      await api.put(`/file-items/${editFile.id}`, {
        name: editFile.name,
        folder_id: editFile.folder_id || null,
        category: editFile.category,
        expiry_date: editFile.expiry_date || null,
        confidential: Boolean(Number(editFile.confidential) || editFile.confidential === true)
      });
      setEditFile(null);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.message || 'Unable to update file.');
    }
  };

  const bytes = n => {
    const value = Number(n || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  };

  return (
    <div className="page files-page">
      <header className="files-hero">
        <div className="files-hero-icon"><HardDrive size={24}/></div>
        <div className="files-hero-copy">
          <p className="eyebrow">DOCUMENT MANAGEMENT</p>
          <h1>Files</h1>
          <p>Organize, protect and monitor company documents stored securely in AWS S3.</p>
        </div>
        <div className="files-hero-actions">
          {canManage && (
            <button className="secondary-btn" onClick={() => { setError(''); setFolderOpen(true); }}>
              <FolderPlus size={17}/>New folder
            </button>
          )}
          {canUpload && (
            <button className="primary-btn" onClick={() => setUploadOpen(true)}>
              <Upload size={17}/>Upload files
            </button>
          )}
          {!canUpload && !canManage && (
            <span className="secure"><ShieldCheck size={15}/>Read-only access</span>
          )}
        </div>
      </header>

      <section className="file-stats">
        <FileStat icon={FileText} label="Files in view" value={files.length} note="Current location" tone="blue"/>
        <FileStat icon={Folder} label="Folders" value={childFolders.length} note="Current level" tone="purple"/>
        <FileStat icon={LockKeyhole} label="Confidential" value={confidentialCount} note="Restricted documents" tone="red"/>
        <FileStat icon={CalendarClock} label="Expiring soon" value={expiringCount} note="Within 90 days" tone="amber"/>
      </section>

      <div className="files-toolbar">
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} aria-label="Company">
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <div className="files-search">
          <Search size={17}/>
          <input placeholder="Search files and folders" value={query} onChange={e => setQuery(e.target.value)}/>
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {categories.map(category => <option key={category}>{category}</option>)}
        </select>
        <span className="files-storage"><HardDrive size={14}/>{bytes(totalSize)} in this folder</span>
      </div>

      <div className="files-breadcrumbs">
        <button onClick={() => setFolderId(null)}><Home size={15}/>{currentCompany?.name || 'Files'}</button>
        {breadcrumb.map(folder => (
          <span key={folder.id}>
            <ChevronRight size={15}/>
            <button onClick={() => setFolderId(folder.id)}>{folder.name}</button>
          </span>
        ))}
      </div>

      {loading ? <div className="empty">Loading files...</div> : (
        <>
          {!!childFolders.length && (
            <section style={s.section}>
              <div style={s.sectionTitle}><Folder size={18}/><strong>Folders</strong></div>
              <div style={s.folderGrid}>
                {childFolders.map(folder => (
                  <div key={folder.id} style={s.folderCard} className="file-folder-card">
                    <button style={s.folderMain} onClick={() => setFolderId(folder.id)}>
                      <div style={s.folderIcon} className="file-folder-icon"><Folder size={27}/></div>
                      <div style={{ textAlign: 'left', minWidth: 0 }}>
                        <strong style={s.ellipsis}>{folder.name}</strong>
                        <span style={s.meta}>{folder.file_count} files · {folder.child_folders} folders</span>
                      </div>
                    </button>
                    {canManage && (
                      <div style={s.smallActions}>
                        <button style={s.iconBtn} title="Rename" onClick={() => renameFolder(folder)}><Pencil size={15}/></button>
                        <button style={s.iconDanger} title="Delete" onClick={() => deleteFolder(folder)}><Trash2 size={15}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section style={s.section}>
            <div className="file-gallery-heading" style={s.sectionTitle}><div><Grid3X3 size={18}/><strong>Files</strong><span style={s.count}>{visibleFiles.length}</span></div><span>Click a card to select · double-click to open</span></div>

            {!!selectedIds.length && <div className="file-selection-bar">
              <span><Check size={15}/><strong>{selectedIds.length}</strong> selected</span>
              <div>
                <button onClick={() => setSelectedIds(visibleFiles.map(file => file.id))}>Select all</button>
                <button onClick={() => setSelectedIds([])}>Clear</button>
                {canManage && <button className="danger" onClick={deleteSelected}><Trash2 size={14}/>Delete selected</button>}
              </div>
            </div>}

            {!visibleFiles.length ? (
              <div style={s.emptyBox}>
                <Upload size={26}/>
                <strong>No files in this folder</strong>
                <span>Upload PDFs, images, Office documents, text files or ZIP archives.</span>
                {canUpload && <button className="primary-btn" onClick={() => setUploadOpen(true)}>Upload files</button>}
              </div>
            ) : (
              <div style={s.gallery}>
                {visibleFiles.map(file => {
                  const isImage = String(file.mime_type || '').startsWith('image/');
                  const isPdf = file.mime_type === 'application/pdf';
                  const expiryDays = file.expiry_date ? Math.ceil((new Date(file.expiry_date) - Date.now()) / 86400000) : null;
                  return (
                    <article key={file.id} style={s.fileCard} className={`file-gallery-card ${selectedIds.includes(file.id) ? 'selected' : ''}`} onClick={() => toggleSelected(file.id)} onDoubleClick={() => file.preview_url && window.open(file.preview_url, '_blank', 'noopener,noreferrer')}>
                      <div style={s.preview}>
                        {isImage && file.preview_url
                          ? <img src={file.preview_url} alt={file.name} style={s.image}/>
                          : <FilePreview file={file} isPdf={isPdf}/>} 
                        <span className="file-select-check">{selectedIds.includes(file.id) ? <Check size={14}/> : null}</span>
                        {Number(file.confidential) ? <span style={s.privateBadge}>Private</span> : null}
                        {expiryDays !== null && <span className={`file-expiry-badge ${expiryDays < 0 ? 'expired' : expiryDays <= 90 ? 'soon' : ''}`}>
                          {expiryDays < 0 ? 'Expired' : expiryDays <= 90 ? `Expires in ${expiryDays}d` : 'Expiry tracked'}
                        </span>}
                      </div>

                      <div style={s.fileBody}>
                        <strong title={file.name} style={s.ellipsis}>{file.name}</strong>
                        <span style={s.meta}>{file.category || 'General'} · {bytes(file.file_size)}</span>
                        <span style={s.meta}>{file.created_at || file.updated_at}</span>

                        <div style={s.fileActions}>
                          <button style={s.iconBtn} title="Open preview" disabled={!file.preview_url} onClick={event => { event.stopPropagation(); file.preview_url && window.open(file.preview_url, '_blank', 'noopener,noreferrer'); }}>
                            <ExternalLink size={16}/>
                          </button>
                          <a style={s.iconLink} title="Download" href={file.download_url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
                            <Download size={16}/>
                          </a>
                          {canManage && (
                            <>
                              <button style={s.iconBtn} title="Edit / Move" onClick={event => { event.stopPropagation(); setEditFile({ ...file }); }}>
                                <Pencil size={16}/>
                              </button>
                              <button style={s.iconDanger} title="Delete" onClick={event => { event.stopPropagation(); deleteFile(file); }}>
                                <Trash2 size={16}/>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {uploadOpen && canUpload && (
        <UploadModal
          companyId={companyId}
          folderId={folderId}
          folderName={currentFolder?.name}
          onClose={() => setUploadOpen(false)}
          onDone={async () => { setUploadOpen(false); await load(); }}
        />
      )}

      {folderOpen && canManage && (
        <div style={s.backdrop} onMouseDown={e => e.target === e.currentTarget && setFolderOpen(false)}>
          <div style={s.modalSmall}>
            <div style={s.modalHead}>
              <div><p className="eyebrow">FILES</p><h2 style={{margin:'4px 0 0'}}>New folder</h2></div>
              <button style={s.iconBtn} onClick={() => setFolderOpen(false)}><X size={18}/></button>
            </div>
            <form onSubmit={createFolder}>
              <label style={s.label}>Folder name *
                <input style={s.input} autoFocus value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="Legal, Finance, Contracts..."/>
              </label>
              {error && <div style={s.error}>{error}</div>}
              <div style={s.modalActions}>
                <button type="button" className="secondary-btn" onClick={() => setFolderOpen(false)}>Cancel</button>
                <button className="primary-btn">Create folder</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editFile && canManage && (
        <div style={s.backdrop} onMouseDown={e => e.target === e.currentTarget && setEditFile(null)}>
          <div style={s.modalSmall}>
            <div style={s.modalHead}>
              <div><p className="eyebrow">FILE DETAILS</p><h2 style={{margin:'4px 0 0'}}>Edit file</h2></div>
              <button style={s.iconBtn} onClick={() => setEditFile(null)}><X size={18}/></button>
            </div>
            <form onSubmit={saveFile}>
              <div style={s.formGrid}>
                <label style={s.label}>Display name
                  <input style={s.input} value={editFile.name || ''} onChange={e => setEditFile({...editFile,name:e.target.value})}/>
                </label>
                <label style={s.label}>Folder
                  <select style={s.input} value={editFile.folder_id || ''} onChange={e => setEditFile({...editFile,folder_id:e.target.value})}>
                    <option value="">Root folder</option>
                    {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label style={s.label}>Category
                  <input style={s.input} value={editFile.category || ''} onChange={e => setEditFile({...editFile,category:e.target.value})}/>
                </label>
                <label style={s.label}>Expiry date
                  <input type="date" style={s.input} value={String(editFile.expiry_date || '').slice(0,10)} onChange={e => setEditFile({...editFile,expiry_date:e.target.value})}/>
                </label>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={Boolean(Number(editFile.confidential) || editFile.confidential === true)}
                    onChange={e => setEditFile({...editFile,confidential:e.target.checked})}/>
                  Confidential
                </label>
              </div>
              <div style={s.modalActions}>
                <button type="button" className="secondary-btn" onClick={() => setEditFile(null)}>Cancel</button>
                <button className="primary-btn">Update file</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function FileStat({ icon: Icon, label, value, note, tone }) {
  return <div className="file-stat"><div className={`file-stat-icon ${tone}`}><Icon size={18}/></div><span><small>{label}</small><strong>{value}</strong><em>{note}</em></span></div>;
}

function FilePreview({ file, isPdf }) {
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const spreadsheet = ['xls', 'xlsx', 'csv'].includes(extension);
  const slides = ['ppt', 'pptx'].includes(extension);
  const archive = ['zip', 'rar', '7z'].includes(extension);
  const code = ['txt', 'json', 'xml', 'html'].includes(extension);
  const Icon = spreadsheet ? FileSpreadsheet : slides ? Presentation : archive ? FileArchive : code ? FileCode2 : FileText;
  const tone = isPdf ? 'pdf' : spreadsheet ? 'sheet' : slides ? 'slides' : archive ? 'archive' : code ? 'code' : 'document';
  return <div className={`file-type-preview ${tone}`}><Icon size={43}/><strong>{extension || 'FILE'}</strong><span>{isPdf ? 'PDF document' : spreadsheet ? 'Spreadsheet' : slides ? 'Presentation' : archive ? 'Archive' : code ? 'Text document' : 'Document'}</span></div>;
}

function UploadModal({ companyId, folderId, folderName, onClose, onDone }) {
  const [selected, setSelected] = useState([]);
  const [category, setCategory] = useState('General');
  const [expiry, setExpiry] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);

  const choose = files => setSelected(Array.from(files || []));

  const upload = async e => {
    e.preventDefault();
    if (!selected.length) return setError('Select at least one file.');

    const form = new FormData();
    form.append('company_id', companyId);
    if (folderId) form.append('folder_id', folderId);
    form.append('category', category);
    if (expiry) form.append('expiry_date', expiry);
    form.append('confidential', confidential ? '1' : '0');
    selected.forEach(file => form.append('files', file));

    try {
      setUploading(true);
      setError('');
      await api.post('/files/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      await onDone();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.detail || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={s.backdrop} onMouseDown={e => e.target === e.currentTarget && !uploading && onClose()}>
      <div style={s.modal}>
        <div style={s.modalHead}>
          <div>
            <p className="eyebrow">AWS S3 UPLOAD</p>
            <h2 style={{margin:'4px 0 0'}}>Upload files</h2>
            <p style={s.meta}>{folderName ? `Folder: ${folderName}` : 'Root folder'}</p>
          </div>
          <button style={s.iconBtn} onClick={onClose}><X size={18}/></button>
        </div>

        <form onSubmit={upload}>
          <div style={s.dropzone} onClick={() => input.current?.click()}>
            <Upload size={27}/>
            <strong>Choose PDFs, images or documents</strong>
            <span>Up to 20 files at once · maximum 25 MB each</span>
            <input ref={input} hidden type="file" multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
              onChange={e => choose(e.target.files)}/>
          </div>

          {!!selected.length && (
            <div style={s.selectedList}>
              {selected.map((file, i) => <div key={`${file.name}-${i}`} style={s.selectedItem}>
                <span style={s.ellipsis}>{file.name}</span><span style={s.meta}>{(file.size/1024/1024).toFixed(2)} MB</span>
              </div>)}
            </div>
          )}

          <div style={s.formGrid}>
            <label style={s.label}>Category
              <input style={s.input} value={category} onChange={e => setCategory(e.target.value)} placeholder="Corporate, Legal, Finance..."/>
            </label>
            <label style={s.label}>Expiry date
              <input type="date" style={s.input} value={expiry} onChange={e => setExpiry(e.target.value)}/>
            </label>
            <label style={s.checkLabel}>
              <input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)}/>
              Confidential
            </label>
          </div>

          {error && <div style={s.error}>{error}</div>}

          <div style={s.modalActions}>
            <button type="button" className="secondary-btn" onClick={onClose} disabled={uploading}>Cancel</button>
            <button className="primary-btn" disabled={uploading}>{uploading ? 'Uploading to AWS...' : `Upload ${selected.length || ''} file${selected.length === 1 ? '' : 's'}`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const s = {
  headerActions:{display:'flex',gap:10,flexWrap:'wrap'},
  topbar:{display:'flex',gap:12,alignItems:'center',marginBottom:16,flexWrap:'wrap'},
  companySelect:{minHeight:42,border:'1px solid #d0d5dd',borderRadius:9,padding:'8px 12px',background:'#fff',minWidth:230},
  breadcrumbs:{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap',marginBottom:20,color:'#667085'},
  crumbWrap:{display:'flex',alignItems:'center',gap:4},
  crumb:{display:'inline-flex',alignItems:'center',gap:6,border:0,background:'transparent',cursor:'pointer',color:'#475467',padding:'4px 3px'},
  section:{marginTop:18},
  sectionTitle:{display:'flex',alignItems:'center',gap:8,marginBottom:12,color:'#344054'},
  count:{fontSize:12,background:'#f2f4f7',padding:'2px 7px',borderRadius:999,color:'#667085'},
  folderGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:12},
  folderCard:{display:'flex',alignItems:'center',justifyContent:'space-between',border:'1px solid #e4e7ec',borderRadius:12,background:'#fff',padding:10,gap:8},
  folderMain:{display:'flex',alignItems:'center',gap:11,flex:1,minWidth:0,border:0,background:'transparent',cursor:'pointer',padding:0},
  folderIcon:{width:42,height:42,borderRadius:10,display:'grid',placeItems:'center',background:'#f2f4f7',flex:'0 0 auto'},
  smallActions:{display:'flex',gap:4},
  gallery:{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:14},
  fileCard:{border:'1px solid #e4e7ec',borderRadius:14,background:'#fff',overflow:'hidden'},
  preview:{height:155,background:'#f8fafc',display:'grid',placeItems:'center',position:'relative',overflow:'hidden'},
  image:{width:'100%',height:'100%',objectFit:'cover'},
  fileIcon:{color:'#667085'},
  privateBadge:{position:'absolute',top:9,left:9,fontSize:11,padding:'4px 7px',borderRadius:999,background:'#101828',color:'#fff'},
  fileBody:{padding:12,display:'grid',gap:5},
  meta:{fontSize:12,color:'#667085',fontWeight:400},
  ellipsis:{display:'block',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',maxWidth:'100%'},
  fileActions:{display:'flex',gap:6,marginTop:8},
  iconBtn:{width:34,height:34,border:'1px solid #e4e7ec',borderRadius:8,background:'#fff',display:'grid',placeItems:'center',cursor:'pointer',color:'#344054'},
  iconLink:{width:34,height:34,border:'1px solid #e4e7ec',borderRadius:8,background:'#fff',display:'grid',placeItems:'center',color:'#344054',textDecoration:'none'},
  iconDanger:{width:34,height:34,border:'1px solid #fecdca',borderRadius:8,background:'#fff',display:'grid',placeItems:'center',cursor:'pointer',color:'#b42318'},
  emptyBox:{border:'1px dashed #d0d5dd',borderRadius:14,minHeight:220,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:'#667085',textAlign:'center',padding:24},
  backdrop:{position:'fixed',inset:0,background:'rgba(15,23,42,.42)',zIndex:1500,display:'grid',placeItems:'center',padding:18},
  modal:{width:'min(680px,100%)',maxHeight:'90vh',overflowY:'auto',background:'#fff',borderRadius:16,padding:24,boxShadow:'0 24px 80px rgba(15,23,42,.22)'},
  modalSmall:{width:'min(520px,100%)',maxHeight:'90vh',overflowY:'auto',background:'#fff',borderRadius:16,padding:24,boxShadow:'0 24px 80px rgba(15,23,42,.22)'},
  modalHead:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:20},
  dropzone:{border:'1.5px dashed #98a2b3',borderRadius:14,minHeight:170,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer',background:'#fcfcfd',textAlign:'center',padding:20,color:'#475467'},
  selectedList:{display:'grid',gap:6,maxHeight:150,overflowY:'auto',marginTop:12},
  selectedItem:{display:'flex',justifyContent:'space-between',gap:12,border:'1px solid #e4e7ec',borderRadius:8,padding:'8px 10px'},
  formGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:14,marginTop:16},
  label:{display:'grid',gap:7,fontSize:13,fontWeight:600,color:'#344054'},
  input:{width:'100%',boxSizing:'border-box',minHeight:42,border:'1px solid #d0d5dd',borderRadius:9,padding:'9px 11px',background:'#fff'},
  checkLabel:{display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:600,color:'#344054',minHeight:42},
  modalActions:{display:'flex',justifyContent:'flex-end',gap:10,marginTop:20},
  error:{marginTop:14,padding:'10px 12px',borderRadius:9,background:'#fef3f2',color:'#b42318',fontSize:13}
};

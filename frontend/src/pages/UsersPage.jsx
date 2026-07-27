// src/pages/UsersPage.jsx
import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { CheckCircle2, Edit2, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { useConfirm } from '../components/ui/ConfirmDialog'

const USER_EMPTY = { username: '', password: '', full_name: '', email: '', role_id: '', is_active: true }
const ROLE_EMPTY = { name: '', description: '', permissions: [] }

const PERMISSIONS = [
  { key: 'all', label: 'Acces total', group: 'Administration' },
  { key: 'dashboard', label: 'Tableau de bord', group: 'Principal' },
  { key: 'pos', label: 'POS', group: 'Principal' },
  { key: 'sales', label: 'Ventes', group: 'Commerce' },
  { key: 'purchases', label: 'Achats', group: 'Commerce' },
  { key: 'clients', label: 'Clients', group: 'Contacts' },
  { key: 'suppliers', label: 'Fournisseurs', group: 'Contacts' },
  { key: 'products', label: 'Produits', group: 'Catalogue' },
  { key: 'stock', label: 'Stock', group: 'Catalogue' },
  { key: 'expenses', label: 'Depenses', group: 'Finance' },
  { key: 'cash', label: 'Caisse', group: 'Finance' },
  { key: 'cash.read', label: 'Caisse: consulter', group: 'Caisse détaillée' },
  { key: 'cash.open', label: 'Caisse: ouvrir', group: 'Caisse détaillée' },
  { key: 'cash.close', label: 'Caisse: clôturer', group: 'Caisse détaillée' },
  { key: 'cash.transaction', label: 'Caisse: mouvement', group: 'Caisse détaillée' },
  { key: 'cash.adjust', label: 'Caisse: ajuster', group: 'Caisse détaillée' },
  { key: 'cash.reverse', label: 'Caisse: contre-passer', group: 'Caisse sensible' },
  { key: 'cash.approve_difference', label: 'Caisse: approuver un écart', group: 'Caisse sensible' },
  { key: 'cash.payment_without_session', label: 'Paiement espèces sans session', group: 'Caisse sensible' },
  { key: 'reports', label: 'Rapports', group: 'Finance' },
  { key: 'users', label: 'Utilisateurs', group: 'Administration' },
  { key: 'settings', label: 'Parametres', group: 'Administration' },
]

const permissionLabel = (key) => PERMISSIONS.find(p => p.key === key)?.label || key

export default function UsersPage() {
  const confirm = useConfirm()
  const [activeTab, setActiveTab] = useState('users')
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [modal, setModal] = useState(null)
  const [selected, setSelected] = useState(null)
  const [userForm, setUserForm] = useState(USER_EMPTY)
  const [roleForm, setRoleForm] = useState(ROLE_EMPTY)
  const [saving, setSaving] = useState(false)

  const permissionsByGroup = useMemo(() => {
    return PERMISSIONS.reduce((acc, permission) => {
      if (!acc[permission.group]) acc[permission.group] = []
      acc[permission.group].push(permission)
      return acc
    }, {})
  }, [])

  const load = async () => {
    const [u, r] = await Promise.all([api.get('/users'), api.get('/users/roles')])
    setUsers(u.data)
    setRoles(r.data)
  }

  useEffect(() => { load() }, [])

  const openCreateUser = () => {
    setUserForm(USER_EMPTY)
    setSelected(null)
    setModal('user')
  }

  const openEditUser = (u) => {
    setUserForm({
      username: u.username,
      full_name: u.full_name || '',
      email: u.email || '',
      role_id: u.role_id || '',
      is_active: u.is_active,
      password: '',
    })
    setSelected(u)
    setModal('user')
  }

  const openCreateRole = () => {
    setRoleForm(ROLE_EMPTY)
    setSelected(null)
    setModal('role')
  }

  const openEditRole = (role) => {
    setRoleForm({
      name: role.name || '',
      description: role.description || '',
      permissions: role.permissions || [],
    })
    setSelected(role)
    setModal('role')
  }

  const handleSaveUser = async () => {
    if (!userForm.username) return toast.error('Nom utilisateur obligatoire')
    if (!selected && !userForm.password) return toast.error('Mot de passe obligatoire')
    setSaving(true)
    try {
      const payload = { ...userForm, role_id: userForm.role_id || null }
      if (!payload.password) delete payload.password
      if (!selected) {
        await api.post('/users', payload)
        toast.success('Utilisateur cree')
      } else {
        await api.put(`/users/${selected.id}`, payload)
        toast.success('Utilisateur mis a jour')
      }
      setModal(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRole = async () => {
    if (!roleForm.name.trim()) return toast.error('Nom du role obligatoire')
    setSaving(true)
    try {
      const payload = { ...roleForm, permissions: roleForm.permissions || [] }
      if (!selected) {
        await api.post('/users/roles', payload)
        toast.success('Role cree')
      } else {
        await api.put(`/users/roles/${selected.id}`, payload)
        toast.success('Role mis a jour')
      }
      setModal(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRole = async (role) => {
    const ok = await confirm({
      title: 'Supprimer role',
      message: `Supprimer le role "${role.name}" ? Les utilisateurs lies devront recevoir un autre role.`,
      confirmText: 'Supprimer',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await api.delete(`/users/roles/${role.id}`)
      toast.success('Role supprime')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Suppression impossible')
    }
  }

  const togglePermission = (key) => {
    setRoleForm(form => {
      const current = new Set(form.permissions || [])
      if (key === 'all') {
        return { ...form, permissions: current.has('all') ? [] : ['all'] }
      }
      current.delete('all')
      if (current.has(key)) current.delete(key)
      else current.add(key)
      return { ...form, permissions: Array.from(current) }
    })
  }

  const userField = (key) => ({
    value: userForm[key] ?? '',
    onChange: e => setUserForm(f => ({ ...f, [key]: e.target.value })),
  })

  const roleField = (key) => ({
    value: roleForm[key] ?? '',
    onChange: e => setRoleForm(f => ({ ...f, [key]: e.target.value })),
  })

  const roleStats = {
    total: roles.length,
    assigned: roles.reduce((sum, role) => sum + (role.user_count || 0), 0),
    activeUsers: users.filter(u => u.is_active).length,
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestion utilisateurs</h1>
          <p className="text-muted text-sm">Utilisateurs, roles, permissions et responsabilites.</p>
        </div>
        <div className="toolbar">
          {activeTab === 'users' ? (
            <button className="btn btn-primary" onClick={openCreateUser}><Plus size={16} /> Nouvel utilisateur</button>
          ) : (
            <button className="btn btn-primary" onClick={openCreateRole}><Plus size={16} /> Nouveau role</button>
          )}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card blue"><div className="kpi-icon blue"><Users size={20} /></div><div className="kpi-value">{users.length}</div><div className="kpi-label">Utilisateurs</div></div>
        <div className="kpi-card green"><div className="kpi-icon green"><CheckCircle2 size={20} /></div><div className="kpi-value">{roleStats.activeUsers}</div><div className="kpi-label">Comptes actifs</div></div>
        <div className="kpi-card purple"><div className="kpi-icon purple"><ShieldCheck size={20} /></div><div className="kpi-value">{roleStats.total}</div><div className="kpi-label">Roles configures</div></div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>Utilisateurs</button>
        <button className={`tab ${activeTab === 'roles' ? 'active' : ''}`} onClick={() => setActiveTab('roles')}>Roles & permissions</button>
      </div>

      {activeTab === 'users' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nom utilisateur</th><th>Nom complet</th><th>Email</th><th>Role</th><th>Permissions</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><span className="font-mono text-sm">{u.username}</span></td>
                    <td>{u.full_name || '-'}</td>
                    <td className="text-muted text-sm">{u.email || '-'}</td>
                    <td><span className="badge badge-info">{u.role_name || 'Aucun role'}</span></td>
                    <td className="text-sm text-muted">{u.permissions?.includes('all') ? 'Acces total' : `${u.permissions?.length || 0} permissions`}</td>
                    <td><span className={`badge ${u.is_active ? 'badge-paid' : 'badge-cancelled'}`}>{u.is_active ? 'Actif' : 'Inactif'}</span></td>
                    <td><button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEditUser(u)} title="Modifier"><Edit2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'roles' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Role</th><th>Responsabilites</th><th>Permissions</th><th>Utilisateurs</th><th>Actions</th></tr></thead>
              <tbody>
                {roles.map(role => (
                  <tr key={role.id}>
                    <td><span className="font-semibold">{role.name}</span></td>
                    <td className="text-sm text-muted">{role.description || '-'}</td>
                    <td>
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        {(role.permissions?.includes('all') ? ['all'] : role.permissions || []).slice(0, 4).map(permission => (
                          <span key={permission} className="badge badge-info">{permissionLabel(permission)}</span>
                        ))}
                        {(role.permissions?.length || 0) > 4 && <span className="badge badge-draft">+{role.permissions.length - 4}</span>}
                      </div>
                    </td>
                    <td><span className="badge badge-draft">{role.user_count || 0}</span></td>
                    <td>
                      <div className="flex gap-2">
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEditRole(role)} title="Modifier"><Edit2 size={14} /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDeleteRole(role)} disabled={(role.user_count || 0) > 0} title="Supprimer"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'user' && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal">
            <div className="modal-header"><h2>{!selected ? 'Nouvel utilisateur' : 'Modifier utilisateur'}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button></div>
            <div className="modal-body">
              <div className="form-grid form-grid-2">
                <div className="form-group"><label className="form-label">Nom utilisateur *</label><input {...userField('username')} disabled={!!selected} placeholder="john.doe" /></div>
                <div className="form-group"><label className="form-label">Mot de passe {selected ? '(vide = inchange)' : '*'}</label><input type="password" {...userField('password')} /></div>
                <div className="form-group"><label className="form-label">Nom complet</label><input {...userField('full_name')} placeholder="Jean Dupont" /></div>
                <div className="form-group"><label className="form-label">Email</label><input {...userField('email')} type="email" /></div>
                <div className="form-group"><label className="form-label">Role</label><select value={userForm.role_id || ''} onChange={e => setUserForm(f => ({ ...f, role_id: e.target.value || null }))}><option value="">Aucun role</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
                <div className="form-group"><label className="form-label">Statut</label><select value={userForm.is_active ? '1' : '0'} onChange={e => setUserForm(f => ({ ...f, is_active: e.target.value === '1' }))}><option value="1">Actif</option><option value="0">Inactif</option></select></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSaveUser} disabled={saving}>{saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}{!selected ? 'Creer' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}

      {modal === 'role' && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className="modal modal-lg">
            <div className="modal-header"><h2>{!selected ? 'Nouveau role' : 'Modifier role'}</h2><button className="btn btn-secondary btn-sm btn-icon" onClick={() => setModal(null)}>x</button></div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label className="form-label">Nom du role *</label><input {...roleField('name')} placeholder="manager" /></div>
                  <div className="form-group"><label className="form-label">Responsabilites</label><input {...roleField('description')} placeholder="Ce que ce role doit faire" /></div>
                </div>
                <div className="form-group">
                  <label className="form-label">Permissions</label>
                  <div className="form-grid form-grid-3">
                    {Object.entries(permissionsByGroup).map(([group, items]) => (
                      <div key={group} className="card" style={{ borderRadius: 8, padding: '1rem' }}>
                        <h3 style={{ marginBottom: '.75rem' }}>{group}</h3>
                        <div className="form-grid" style={{ gap: '.5rem' }}>
                          {items.map(permission => (
                            <label key={permission.key} className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                style={{ width: 'auto' }}
                                checked={(roleForm.permissions || []).includes(permission.key)}
                                disabled={(roleForm.permissions || []).includes('all') && permission.key !== 'all'}
                                onChange={() => togglePermission(permission.key)}
                              />
                              <span>{permission.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSaveRole} disabled={saving}>{saving ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}{!selected ? 'Creer' : 'Enregistrer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

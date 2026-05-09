import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@ui/components/Button'
import { Checkbox } from '@ui/components/Checkbox'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@ui/components/DataTable'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { pillAccent } from '@ui/pillAccent'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { DeleteIcon } from 'pixel-art-icons/icons/delete'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { EyeIcon } from 'pixel-art-icons/icons/eye'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { SaveIcon } from 'pixel-art-icons/icons/save'
import {
  createCmsRole,
  createCmsUser,
  deleteCmsRole,
  deleteCmsUser,
  listCmsAuditEvents,
  listCmsRoles,
  listCmsUsers,
  updateCmsRole,
  updateCmsUser,
  type CmsAuditEvent,
  type CmsCurrentUser,
  type CmsRole,
} from '@core/persistence'
import type { CoreCapability } from '@core/capabilities'
import dialogStyles from '../../shared/dialogs/SiteCreateDialog/SiteCreateDialog.module.css'
import { AdminPageLayout } from '@admin/layouts'
import { hasCapability } from '@admin/access'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import styles from './UsersPage.module.css'

type Tab = 'users' | 'roles' | 'audit'
type UserDialogMode = 'create' | 'edit' | 'reset'
type RoleDialogMode = 'create' | 'edit' | 'view'

interface UserFormState {
  email: string
  displayName: string
  password: string
  roleId: string
  status: CmsCurrentUser['status']
}

interface RoleFormState {
  name: string
  slug: string
  description: string
  capabilities: string[]
}

interface CapabilityGroup {
  title: string
  capabilities: CoreCapability[]
}

interface RowActionMenuItem {
  label: string
  icon: ReactNode
  danger?: boolean
  onSelect: () => void
}

interface UsersPageLoadAccess {
  canManageUsers: boolean
  canReadRoleOptions: boolean
  canReadAudit: boolean
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  { title: 'Site', capabilities: ['site.read', 'site.edit'] },
  { title: 'Pages', capabilities: ['pages.edit', 'pages.publish'] },
  {
    title: 'Content',
    capabilities: [
      'content.create',
      'content.edit.own',
      'content.edit.any',
      'content.publish.own',
      'content.publish.any',
      'content.manage',
    ],
  },
  { title: 'Media', capabilities: ['media.manage'] },
  { title: 'Runtime', capabilities: ['runtime.manage'] },
  { title: 'Plugins', capabilities: ['plugins.manage'] },
  { title: 'Users & Roles', capabilities: ['users.manage', 'roles.manage'] },
  { title: 'Audit', capabilities: ['audit.read'] },
]

const emptyUserForm: UserFormState = {
  email: '',
  displayName: '',
  password: '',
  roleId: 'viewer',
  status: 'active',
}

const emptyRoleForm: RoleFormState = {
  name: '',
  slug: '',
  description: '',
  capabilities: [],
}

async function loadUsersPageData(access: UsersPageLoadAccess) {
  const [users, roles, events] = await Promise.all([
    access.canManageUsers ? listCmsUsers() : Promise.resolve([]),
    access.canReadRoleOptions ? listCmsRoles() : Promise.resolve([]),
    access.canReadAudit ? listCmsAuditEvents() : Promise.resolve([]),
  ])
  return { users, roles, events }
}

function isOwnerUser(user: CmsCurrentUser): boolean {
  return user.role.slug === 'owner'
}

function displayUserName(user: CmsCurrentUser): string {
  return user.displayName.trim() || user.email
}

function statusLabel(status: CmsCurrentUser['status']): string {
  return status === 'active' ? 'Active' : 'Suspended'
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Never'
}

function formatCapabilitySummary(capabilities: string[]): string {
  if (capabilities.length === 0) return 'No admin capabilities'
  const capabilityLabel = capabilities.length === 1 ? 'capability' : 'capabilities'
  return `${capabilities.length} ${capabilityLabel}`
}

function tabLabel(tab: Tab): string {
  return tab === 'users' ? 'Users' : tab === 'roles' ? 'Roles' : 'Audit'
}

function Badge({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={muted ? styles.badgeMuted : styles.badge}
      data-accent={pillAccent(label)}
    >
      {label}
    </span>
  )
}

function RowActionMenu({
  triggerLabel,
  menuLabel,
  disabled,
  items,
}: {
  triggerLabel: string
  menuLabel: string
  disabled: boolean
  items: RowActionMenuItem[]
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  if (items.length === 0) return null

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="xs"
        iconOnly
        disabled={disabled}
        active={open}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDownIcon size={14} aria-hidden="true" />
      </Button>
      {open && (
        <ContextMenu
          ariaLabel={menuLabel}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          side="bottom"
          align="end"
          width={176}
        >
          {items.map((item) => (
            <ContextMenuItem
              key={item.label}
              danger={item.danger}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </ContextMenuItem>
          ))}
        </ContextMenu>
      )}
    </>
  )
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function auditUserLabel(
  userId: string | null,
  usersById: Map<string, CmsCurrentUser>,
  fallback: string | null,
): string | null {
  if (!userId) return fallback
  const user = usersById.get(userId)
  return user ? displayUserName(user) : fallback ?? userId
}

function auditActor(event: CmsAuditEvent, usersById: Map<string, CmsCurrentUser>): string {
  if (!event.actorUserId) return 'by system'
  return `by ${auditUserLabel(event.actorUserId, usersById, event.actorLabel)}`
}

function auditTargetUser(event: CmsAuditEvent, usersById: Map<string, CmsCurrentUser>): string {
  return auditUserLabel(event.targetId, usersById, event.targetLabel) ?? 'Unknown user'
}

function roleName(roleId: string | null, rolesById: Map<string, CmsRole>, fallback: string | null = null): string | null {
  if (!roleId) return null
  return rolesById.get(roleId)?.name ?? fallback ?? roleId
}

function auditTargetRole(event: CmsAuditEvent, rolesById: Map<string, CmsRole>): string | null {
  if (event.targetType !== 'role') return null
  return roleName(event.targetId, rolesById, event.targetLabel ?? metadataString(event.metadata, 'name') ?? metadataString(event.metadata, 'slug'))
}

function auditTitle(event: CmsAuditEvent, usersById: Map<string, CmsCurrentUser>, rolesById: Map<string, CmsRole>): string {
  const targetUser = auditTargetUser(event, usersById)
  const role = auditTargetRole(event, rolesById)
  const email = metadataString(event.metadata, 'email')
  const pluginId = metadataString(event.metadata, 'pluginId') ?? event.targetId ?? 'Plugin'

  switch (event.action) {
    case 'login.success':
      return `${event.actorUserId ? auditUserLabel(event.actorUserId, usersById, event.actorLabel) : email ?? 'User'} logged in`
    case 'login.failure':
      return `Failed login for ${email ?? targetUser}`
    case 'logout':
      return `${event.actorUserId ? auditUserLabel(event.actorUserId, usersById, event.actorLabel) : 'User'} logged out`
    case 'user.create':
      return `${targetUser} was created`
    case 'user.update':
      return `${targetUser} was updated`
    case 'user.delete':
      return `${targetUser} was deleted`
    case 'user.suspend':
      return `${targetUser} was suspended`
    case 'password.change':
      return `Password changed for ${targetUser}`
    case 'role.create':
      return `${role ?? 'Role'} was created`
    case 'role.update':
      return `${role ?? 'Role'} was updated`
    case 'role.delete':
      return `${role ?? event.targetId ?? 'Role'} was deleted`
    case 'role.assign':
      return `${targetUser} role changed`
    case 'content.author.assign':
      return 'Content author changed'
    case 'publish':
      return 'Site was published'
    case 'plugin.install':
      return `${pluginId} was installed`
    case 'plugin.enable':
      return `${pluginId} was enabled`
    case 'plugin.disable':
      return `${pluginId} was disabled`
    case 'plugin.delete':
      return `${pluginId} was deleted`
    default:
      return event.action
  }
}

function auditDetails(event: CmsAuditEvent, rolesById: Map<string, CmsRole>): string[] {
  const details: string[] = []
  const roleId = metadataString(event.metadata, 'roleId')
  const status = metadataString(event.metadata, 'status')
  if (roleId) details.push(`Role: ${roleName(roleId, rolesById, event.metadataLabels.roleId)}`)
  if (status) details.push(`Status: ${statusLabel(status as CmsCurrentUser['status'])}`)
  if (event.ipAddress && event.ipAddress !== 'unknown') details.push(`IP: ${event.ipAddress}`)
  return details
}

export function UsersPage() {
  const currentUser = useCurrentAdminUser()
  const { runStepUp } = useStepUp()
  const unrestricted = !currentUser
  const canManageUsers = unrestricted || hasCapability(currentUser, 'users.manage')
  const canManageRoles = unrestricted || hasCapability(currentUser, 'roles.manage')
  const canReadAudit = unrestricted || hasCapability(currentUser, 'audit.read')
  const canReadRoleOptions = canManageUsers || canManageRoles
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<CmsCurrentUser[]>([])
  const [roles, setRoles] = useState<CmsRole[]>([])
  const [events, setEvents] = useState<CmsAuditEvent[]>([])
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm)
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRoleForm)
  const [userDialogMode, setUserDialogMode] = useState<UserDialogMode | null>(null)
  const [roleDialogMode, setRoleDialogMode] = useState<RoleDialogMode | null>(null)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const availableTabs = useMemo<Tab[]>(() => {
    const tabs: Tab[] = []
    if (canManageUsers) tabs.push('users')
    if (canManageRoles) tabs.push('roles')
    if (canReadAudit) tabs.push('audit')
    return tabs
  }, [canManageUsers, canManageRoles, canReadAudit])
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0] ?? 'users'

  const assignableRoleOptions = useMemo(
    () => roles
      .filter((role) => role.id !== 'owner')
      .map((role) => ({ value: role.id, label: role.name, textValue: role.name })),
    [roles],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'active', label: 'Active', textValue: 'Active' },
      { value: 'suspended', label: 'Suspended', textValue: 'Suspended' },
    ],
    [],
  )
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users])
  const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles])
  const defaultAssignableRoleId = assignableRoleOptions[0]?.value?.toString() ?? 'viewer'

  const loadAccess = useMemo<UsersPageLoadAccess>(() => ({
    canManageUsers,
    canReadRoleOptions,
    canReadAudit,
  }), [canManageUsers, canReadRoleOptions, canReadAudit])

  const applyLoadedData = useCallback((data: Awaited<ReturnType<typeof loadUsersPageData>>) => {
    const assignableRoles = data.roles.filter((role) => role.id !== 'owner')
    setUsers(data.users)
    setRoles(data.roles)
    setEvents(data.events)
    setUserForm((current) => assignableRoles.some((role) => role.id === current.roleId)
      ? current
      : { ...current, roleId: assignableRoles[0]?.id ?? 'viewer' })
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      applyLoadedData(await loadUsersPageData(loadAccess))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users')
    }
  }, [applyLoadedData, loadAccess])

  useEffect(() => {
    let cancelled = false
    void loadUsersPageData(loadAccess)
      .then((data) => {
        if (!cancelled) applyLoadedData(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load users')
      })
    return () => {
      cancelled = true
    }
  }, [applyLoadedData, loadAccess])

  function closeUserDialog() {
    setUserDialogMode(null)
    setEditingUserId(null)
    setUserForm({ ...emptyUserForm, roleId: defaultAssignableRoleId })
  }

  function openCreateUserDialog() {
    if (!canManageUsers) return
    setEditingUserId(null)
    setUserForm({ ...emptyUserForm, roleId: defaultAssignableRoleId })
    setUserDialogMode('create')
    setError(null)
  }

  function openEditUserDialog(user: CmsCurrentUser) {
    if (!canManageUsers || isOwnerUser(user)) return
    setEditingUserId(user.id)
    setUserForm({
      email: user.email,
      displayName: user.displayName,
      password: '',
      roleId: user.role.id === 'owner' ? defaultAssignableRoleId : user.role.id,
      status: user.status,
    })
    setUserDialogMode('edit')
    setError(null)
  }

  function openResetPasswordDialog(user: CmsCurrentUser) {
    if (!canManageUsers || isOwnerUser(user)) return
    setEditingUserId(user.id)
    setUserForm({
      email: user.email,
      displayName: user.displayName,
      password: '',
      roleId: user.role.id === 'owner' ? defaultAssignableRoleId : user.role.id,
      status: user.status,
    })
    setUserDialogMode('reset')
    setError(null)
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageUsers || !userDialogMode) return
    if ((userDialogMode === 'create' || userDialogMode === 'reset' || userForm.password) && userForm.password.length < 12) {
      setError('Password must be at least 12 characters')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (userDialogMode === 'reset') {
        if (!editingUserId) throw new Error('No user selected')
        await updateCmsUser(editingUserId, { password: userForm.password })
      } else if (userDialogMode === 'edit') {
        if (!editingUserId) throw new Error('No user selected')
        const user = await updateCmsUser(editingUserId, {
          email: userForm.email,
          displayName: userForm.displayName,
          roleId: userForm.roleId,
          status: userForm.status,
          ...(userForm.password ? { password: userForm.password } : {}),
        })
        setUsers((current) => current.map((candidate) => candidate.id === user.id ? user : candidate))
      } else {
        const user = await createCmsUser({
          email: userForm.email,
          displayName: userForm.displayName,
          password: userForm.password,
          roleId: userForm.roleId,
        })
        setUsers((current) => [...current, user])
      }
      closeUserDialog()
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save user')
    } finally {
      setBusy(false)
    }
  }

  async function toggleUserStatus(user: CmsCurrentUser) {
    if (!canManageUsers || isOwnerUser(user)) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateCmsUser(user.id, {
        status: user.status === 'active' ? 'suspended' : 'active',
      })
      setUsers((current) => current.map((candidate) => candidate.id === updated.id ? updated : candidate))
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update user')
    } finally {
      setBusy(false)
    }
  }

  async function removeUser(user: CmsCurrentUser) {
    if (!canManageUsers || isOwnerUser(user)) return
    setBusy(true)
    setError(null)
    try {
      // Step-up gated server-side; the runner re-prompts for password
      // when the session has no fresh window. Cancelling the dialog
      // resolves silently without surfacing an error.
      await runStepUp(() => deleteCmsUser(user.id))
      setUsers((current) => current.filter((candidate) => candidate.id !== user.id))
      void load()
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      setError(err instanceof Error ? err.message : 'Could not delete user')
    } finally {
      setBusy(false)
    }
  }

  function closeRoleDialog() {
    setRoleDialogMode(null)
    setEditingRoleId(null)
    setRoleForm(emptyRoleForm)
  }

  function openCreateRoleDialog() {
    if (!canManageRoles) return
    setRoleForm(emptyRoleForm)
    setEditingRoleId(null)
    setRoleDialogMode('create')
    setError(null)
  }

  function openViewRoleDialog(role: CmsRole) {
    if (!canManageRoles) return
    setEditingRoleId(role.id)
    setRoleForm({
      name: role.name,
      slug: role.slug,
      description: role.description,
      capabilities: role.capabilities,
    })
    setRoleDialogMode('view')
    setError(null)
  }

  function openEditRoleDialog(role: CmsRole) {
    if (!canManageRoles || role.isSystem) return
    setEditingRoleId(role.id)
    setRoleForm({
      name: role.name,
      slug: role.slug,
      description: role.description,
      capabilities: role.capabilities,
    })
    setRoleDialogMode('edit')
    setError(null)
  }

  async function handleSaveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canManageRoles || !roleDialogMode) return
    setBusy(true)
    setError(null)
    try {
      const role = roleDialogMode === 'edit' && editingRoleId
        ? await updateCmsRole(editingRoleId, roleForm)
        : await createCmsRole(roleForm)
      setRoles((current) => {
        const exists = current.some((candidate) => candidate.id === role.id)
        return exists
          ? current.map((candidate) => candidate.id === role.id ? role : candidate)
          : [...current, role]
      })
      closeRoleDialog()
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save role')
    } finally {
      setBusy(false)
    }
  }

  async function removeRole(role: CmsRole) {
    if (!canManageRoles || role.isSystem) return
    setBusy(true)
    setError(null)
    try {
      await deleteCmsRole(role.id)
      setRoles((current) => current.filter((candidate) => candidate.id !== role.id))
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete role')
    } finally {
      setBusy(false)
    }
  }

  function toggleCapability(capability: string, checked: boolean) {
    setRoleForm((current) => ({
      ...current,
      capabilities: checked
        ? [...new Set([...current.capabilities, capability])]
        : current.capabilities.filter((item) => item !== capability),
    }))
  }

  function setCapabilityGroup(group: CapabilityGroup, checked: boolean) {
    setRoleForm((current) => {
      const next = new Set(current.capabilities)
      for (const capability of group.capabilities) {
        if (checked) next.add(capability)
        else next.delete(capability)
      }
      return { ...current, capabilities: [...next] }
    })
  }

  const tabs = (
    <div role="tablist" aria-label="Users sections" className={styles.tabsRow}>
      {availableTabs.map((item) => (
        <Button
          key={item}
          type="button"
          variant={activeTab === item ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setTab(item)}
        >
          <span>{tabLabel(item)}</span>
        </Button>
      ))}
    </div>
  )

  return (
    <AdminPageLayout
      workspace="users"
      title="Users"
      titleId="users-title"
      description="Manage admin access, custom roles, and security audit events."
      tabs={tabs}
    >
      <div className={styles.body}>
            {error && <p className={styles.error} role="alert">{error}</p>}

            {activeTab === 'users' && (
              <section className={styles.section} aria-labelledby="all-users-title">
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 id="all-users-title">All Users</h2>
                    <p>{users.length} account{users.length === 1 ? '' : 's'} with admin access.</p>
                  </div>
                  {canManageUsers && (
                    <Button type="button" variant="primary" size="sm" onClick={openCreateUserDialog}>
                      <PlusIcon size={14} aria-hidden="true" />
                      <span>Create User</span>
                    </Button>
                  )}
                </div>
                {users.length > 0 ? (
                  <DataTable aria-label="Users" density="compact">
                    <DataTableHead>
                      <DataTableRow>
                        <DataTableHeader scope="col">User</DataTableHeader>
                        <DataTableHeader scope="col">Access</DataTableHeader>
                        <DataTableHeader scope="col">Last login</DataTableHeader>
                        <DataTableHeader scope="col" className={styles.actionsHeader}>Actions</DataTableHeader>
                      </DataTableRow>
                    </DataTableHead>
                    <DataTableBody>
                      {users.map((user) => {
                        const owner = isOwnerUser(user)
                        const label = displayUserName(user)
                        return (
                          <DataTableRow key={user.id} aria-label={`User ${user.email}`}>
                            <DataTableCell>
                              <div className={styles.identity}>
                                <strong>{label}</strong>
                                <span>{user.email}</span>
                              </div>
                            </DataTableCell>
                            <DataTableCell>
                              <div className={styles.badges}>
                                <Badge label={statusLabel(user.status)} />
                                <Badge label={user.role.name} />
                                {owner && <Badge label="Owner account" muted />}
                              </div>
                            </DataTableCell>
                            <DataTableCell>
                              <span className={styles.secondaryText}>{formatDateTime(user.lastLoginAt)}</span>
                            </DataTableCell>
                            <DataTableCell className={styles.actionsCell}>
                              {canManageUsers && !owner && (
                                <RowActionMenu
                                  triggerLabel={`Actions for ${label}`}
                                  menuLabel={`User actions for ${label}`}
                                  disabled={busy}
                                  items={[
                                    {
                                      label: 'Edit',
                                      icon: <EditIcon size={12} aria-hidden="true" />,
                                      onSelect: () => openEditUserDialog(user),
                                    },
                                    {
                                      label: 'Reset password',
                                      icon: <SaveIcon size={12} aria-hidden="true" />,
                                      onSelect: () => openResetPasswordDialog(user),
                                    },
                                    {
                                      label: user.status === 'active' ? 'Suspend' : 'Activate',
                                      icon: <EditIcon size={12} aria-hidden="true" />,
                                      onSelect: () => void toggleUserStatus(user),
                                    },
                                    {
                                      label: 'Delete',
                                      icon: <DeleteIcon size={12} aria-hidden="true" />,
                                      danger: true,
                                      onSelect: () => void removeUser(user),
                                    },
                                  ]}
                                />
                              )}
                            </DataTableCell>
                          </DataTableRow>
                        )
                      })}
                    </DataTableBody>
                  </DataTable>
                ) : (
                  <p className={styles.emptyState}>No users yet.</p>
                )}
              </section>
            )}

            {activeTab === 'roles' && (
              <section className={styles.section} aria-labelledby="roles-list-title">
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 id="roles-list-title">Roles</h2>
                    <p>System roles are fixed. Custom roles can be edited.</p>
                  </div>
                  {canManageRoles && (
                    <Button type="button" variant="primary" size="sm" onClick={openCreateRoleDialog}>
                      <PlusIcon size={14} aria-hidden="true" />
                      <span>Create Role</span>
                    </Button>
                  )}
                </div>
                {roles.length > 0 ? (
                  <DataTable aria-label="Roles" density="compact">
                    <DataTableHead>
                      <DataTableRow>
                        <DataTableHeader scope="col">Role</DataTableHeader>
                        <DataTableHeader scope="col">Description</DataTableHeader>
                        <DataTableHeader scope="col">Capabilities</DataTableHeader>
                        <DataTableHeader scope="col">Type</DataTableHeader>
                        <DataTableHeader scope="col" className={styles.actionsHeader}>Actions</DataTableHeader>
                      </DataTableRow>
                    </DataTableHead>
                    <DataTableBody>
                      {roles.map((role) => (
                        <DataTableRow key={role.id} aria-label={`Role ${role.name}`}>
                          <DataTableCell>
                            <strong className={styles.tableTitle}>{role.name}</strong>
                          </DataTableCell>
                          <DataTableCell>
                            <span className={styles.secondaryText}>{role.description || 'No description'}</span>
                          </DataTableCell>
                          <DataTableCell>
                            {role.capabilities.length > 0 ? (
                              <span className={styles.secondaryText}>{formatCapabilitySummary(role.capabilities)}</span>
                            ) : (
                              <Badge label="No admin capabilities" muted />
                            )}
                          </DataTableCell>
                          <DataTableCell>
                            <div className={styles.badges}>
                              <Badge label={role.isSystem ? 'System role' : 'Custom role'} muted={role.isSystem} />
                            </div>
                          </DataTableCell>
                          <DataTableCell className={styles.actionsCell}>
                            {canManageRoles && (
                              <RowActionMenu
                                triggerLabel={`Actions for ${role.name}`}
                                menuLabel={`Role actions for ${role.name}`}
                                disabled={busy}
                                items={[
                                  {
                                    label: 'View',
                                    icon: <EyeIcon size={12} aria-hidden="true" />,
                                    onSelect: () => openViewRoleDialog(role),
                                  },
                                  ...(!role.isSystem
                                    ? [
                                        {
                                          label: 'Edit',
                                          icon: <EditIcon size={12} aria-hidden="true" />,
                                          onSelect: () => openEditRoleDialog(role),
                                        },
                                        {
                                          label: 'Delete',
                                          icon: <DeleteIcon size={12} aria-hidden="true" />,
                                          danger: true,
                                          onSelect: () => void removeRole(role),
                                        },
                                      ] satisfies RowActionMenuItem[]
                                    : []),
                                ]}
                              />
                            )}
                          </DataTableCell>
                        </DataTableRow>
                      ))}
                    </DataTableBody>
                  </DataTable>
                ) : (
                  <p className={styles.emptyState}>No roles configured.</p>
                )}
              </section>
            )}

            {activeTab === 'audit' && (
              <section className={styles.section} aria-labelledby="audit-events-title">
                <div className={styles.sectionHeader}>
                  <div>
                    <h2 id="audit-events-title">Audit Events</h2>
                    <p>Security and access changes across the admin area.</p>
                  </div>
                </div>
                {events.length > 0 ? (
                  <DataTable aria-label="Audit events" density="compact">
                    <DataTableHead>
                      <DataTableRow>
                        <DataTableHeader scope="col">Event</DataTableHeader>
                        <DataTableHeader scope="col">Actor</DataTableHeader>
                        <DataTableHeader scope="col">Details</DataTableHeader>
                        <DataTableHeader scope="col">Time</DataTableHeader>
                      </DataTableRow>
                    </DataTableHead>
                    <DataTableBody>
                      {events.map((event) => (
                        <DataTableRow key={event.id}>
                          <DataTableCell>
                            <strong className={styles.auditTitle}>{auditTitle(event, usersById, rolesById)}</strong>
                          </DataTableCell>
                          <DataTableCell>
                            <span className={styles.secondaryText}>{auditActor(event, usersById)}</span>
                          </DataTableCell>
                          <DataTableCell>
                            <div className={styles.auditDetails}>
                              {auditDetails(event, rolesById).map((detail) => (
                                <Badge key={detail} label={detail} />
                              ))}
                            </div>
                          </DataTableCell>
                          <DataTableCell>
                            <span className={styles.secondaryText}>{formatDateTime(event.createdAt)}</span>
                          </DataTableCell>
                        </DataTableRow>
                      ))}
                    </DataTableBody>
                  </DataTable>
                ) : (
                  <p className={styles.emptyState}>No audit events yet.</p>
                )}
              </section>
            )}

          {canManageUsers && userDialogMode && (
            <UserDialog
              mode={userDialogMode}
              form={userForm}
              roleOptions={assignableRoleOptions}
              statusOptions={statusOptions}
              busy={busy}
              error={error}
              onChange={setUserForm}
              onClose={closeUserDialog}
              onSubmit={handleSaveUser}
            />
          )}

          {canManageRoles && roleDialogMode && (
            <RoleDialog
              mode={roleDialogMode}
              form={roleForm}
              busy={busy}
              error={error}
              onChange={setRoleForm}
              onClose={closeRoleDialog}
              onSubmit={handleSaveRole}
              onToggleCapability={toggleCapability}
              onSetCapabilityGroup={setCapabilityGroup}
            />
          )}
      </div>
    </AdminPageLayout>
  )
}

interface UserDialogProps {
  mode: UserDialogMode
  form: UserFormState
  roleOptions: Array<{ value: string | number; label: string; textValue: string }>
  statusOptions: Array<{ value: string; label: string; textValue: string }>
  busy: boolean
  error: string | null
  onChange: (form: UserFormState) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

const USER_FORM_ID = 'users-page-user-form'

function UserDialog({
  mode,
  form,
  roleOptions,
  statusOptions,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
}: UserDialogProps) {
  const title = mode === 'create' ? 'Create User' : mode === 'edit' ? 'Edit User' : 'Reset Password'
  const submitLabel = mode === 'create' ? 'Create User' : mode === 'edit' ? 'Save User' : 'Reset Password'
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            <span>Cancel</span>
          </Button>
          <Button type="submit" form={USER_FORM_ID} variant="primary" size="sm" disabled={busy}>
            {mode === 'create' ? <PlusIcon size={14} aria-hidden="true" /> : <SaveIcon size={14} aria-hidden="true" />}
            <span>{submitLabel}</span>
          </Button>
        </>
      }
    >
      <form id={USER_FORM_ID} className={dialogStyles.form} autoComplete="off" onSubmit={(event) => void onSubmit(event)}>
        {mode !== 'reset' && (
          <>
            <label className={dialogStyles.field}>
              <span className={dialogStyles.label}>Email</span>
              <Input
                value={form.email}
                type="email"
                name={mode === 'create' ? 'new-user-email-address' : 'edited-user-email-address'}
                autoComplete="off"
                data-lpignore="true"
                data-1p-ignore="true"
                required
                onChange={(event) => onChange({ ...form, email: event.currentTarget.value })}
              />
            </label>
            <label className={dialogStyles.field}>
              <span className={dialogStyles.label}>Display name</span>
              <Input
                value={form.displayName}
                name={mode === 'create' ? 'new-user-display-name' : 'edited-user-display-name'}
                autoComplete="off"
                onChange={(event) => onChange({ ...form, displayName: event.currentTarget.value })}
              />
            </label>
          </>
        )}
        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>{mode === 'create' ? 'Initial password' : 'New password'}</span>
          <Input
            value={form.password}
            type="password"
            name={mode === 'create' ? 'new-user-initial-password' : 'edited-user-new-password'}
            autoComplete="new-password"
            data-lpignore="true"
            data-1p-ignore="true"
            minLength={12}
            placeholder={mode === 'edit' ? 'Leave blank to keep current password' : undefined}
            required={mode !== 'edit'}
            onChange={(event) => onChange({ ...form, password: event.currentTarget.value })}
          />
        </label>
        {mode !== 'reset' && (
          <>
            <label className={dialogStyles.field}>
              <span className={dialogStyles.label}>Role</span>
              <Select
                value={form.roleId}
                name={mode === 'create' ? 'new-user-role' : 'edited-user-role'}
                options={roleOptions}
                onChange={(event) => onChange({ ...form, roleId: event.currentTarget.value })}
              />
            </label>
            {mode === 'edit' && (
              <label className={dialogStyles.field}>
                <span className={dialogStyles.label}>Status</span>
                <Select
                  value={form.status}
                  name="edited-user-status"
                  options={statusOptions}
                  onChange={(event) => onChange({ ...form, status: event.currentTarget.value as CmsCurrentUser['status'] })}
                />
              </label>
            )}
          </>
        )}
        {error && <p role="alert" className={dialogStyles.errorText}>{error}</p>}
      </form>
    </Dialog>
  )
}

interface RoleDialogProps {
  mode: RoleDialogMode
  form: RoleFormState
  busy: boolean
  error: string | null
  onChange: (form: RoleFormState) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onToggleCapability: (capability: string, checked: boolean) => void
  onSetCapabilityGroup: (group: CapabilityGroup, checked: boolean) => void
}

const ROLE_FORM_ID = 'users-page-role-form'

function RoleDialog({
  mode,
  form,
  busy,
  error,
  onChange,
  onClose,
  onSubmit,
  onToggleCapability,
  onSetCapabilityGroup,
}: RoleDialogProps) {
  const title = mode === 'create' ? 'Create Role' : mode === 'edit' ? 'Edit Role' : 'View Role'
  const readonly = mode === 'view'
  const selectedCapabilities = new Set(form.capabilities)
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            <span>{readonly ? 'Close' : 'Cancel'}</span>
          </Button>
          {!readonly && (
            <Button type="submit" form={ROLE_FORM_ID} variant="primary" size="sm" disabled={busy}>
              <SaveIcon size={14} aria-hidden="true" />
              <span>{mode === 'create' ? 'Create Role' : 'Save Role'}</span>
            </Button>
          )}
        </>
      }
    >
      <form id={ROLE_FORM_ID} className={dialogStyles.form} onSubmit={(event) => void onSubmit(event)}>
        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Name</span>
          <Input
            value={form.name}
            required
            disabled={readonly}
            onChange={(event) => onChange({ ...form, name: event.currentTarget.value })}
          />
        </label>
        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Slug</span>
          <Input
            value={form.slug}
            disabled={readonly}
            onChange={(event) => onChange({ ...form, slug: event.currentTarget.value })}
          />
        </label>
        <label className={dialogStyles.field}>
          <span className={dialogStyles.label}>Description</span>
          <Input
            value={form.description}
            disabled={readonly}
            onChange={(event) => onChange({ ...form, description: event.currentTarget.value })}
          />
        </label>
        <div className={styles.capabilityPicker}>
          {CAPABILITY_GROUPS.map((group) => {
            const selectedCount = group.capabilities.filter((capability) => selectedCapabilities.has(capability)).length
            return (
              <section key={group.title} className={styles.capabilityGroup}>
                <div className={styles.capabilityGroupHeader}>
                  <h3>{group.title}</h3>
                  {!readonly && (
                    <div className={styles.groupActions}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        aria-label={`Select all ${group.title} capabilities`}
                        onClick={() => onSetCapabilityGroup(group, true)}
                      >
                        <span>All</span>
                      </Button>
                      {selectedCount > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-label={`Clear ${group.title} capabilities`}
                          onClick={() => onSetCapabilityGroup(group, false)}
                        >
                          <span>Clear</span>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                <div className={styles.capabilities}>
                  {group.capabilities.map((capability) => (
                    <label key={capability}>
                      <Checkbox
                        checked={form.capabilities.includes(capability)}
                        disabled={readonly}
                        onCheckedChange={(checked) => onToggleCapability(capability, checked)}
                      />
                      <span>{capability}</span>
                    </label>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
        {error && <p role="alert" className={dialogStyles.errorText}>{error}</p>}
      </form>
    </Dialog>
  )
}

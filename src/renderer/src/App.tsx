import { useEffect, useMemo, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { FolderOpen, Loader2, LogOut, Plus, RefreshCcw, Scan } from 'lucide-react'
import { LoginForm } from './components/LoginForm'
import { supabase } from './lib/supabase'

type ScannedFile = {
  name: string
  path: string
  size: number
  extension: string
}

type ScanResult =
  | { success: true; count: number; files: ScannedFile[] }
  | { success: false; error: string }

type RowRecord = Record<string, unknown>
type ProjectListItem = {
  id: string
  project_code: string | null
  cached_brand_name: string | null
  project_uploads?: Array<{ created_at: string | null }> | null
}

type DashboardTab = 'scan' | 'plan' | 'ingest' | 'settings'

const SLOT_LABEL_KEYS = ['slot_name', 'name', 'title', 'slot_code', 'code', 'label']
const SLOT_SEQUENCE_KEYS = [
  'next_sequence_number',
  'current_sequence_number',
  'current_sequence',
  'latest_sequence',
  'last_sequence_number',
  'sequence_counter'
]

function getId(row: RowRecord): string {
  const idValue = row.id
  return typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : ''
}

function pickFirstString(row: RowRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function pickFirstNumber(row: RowRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }

  return null
}

function getProjectCode(project: ProjectListItem): string {
  return project.project_code?.trim() || '—'
}

function getProjectBrandName(project: ProjectListItem): string {
  return project.cached_brand_name?.trim() || '—'
}

function getSlotLabel(slot: RowRecord): string {
  return pickFirstString(slot, SLOT_LABEL_KEYS) ?? `Slot ${getId(slot).slice(0, 8)}`
}

function getSlotSequence(slot: RowRecord): number | null {
  return pickFirstNumber(slot, SLOT_SEQUENCE_KEYS)
}

function normalizeSlotCode(rawLabel: string): string {
  return rawLabel
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
}

async function createSlotForProject(projectId: string, slotLabel: string): Promise<string | null> {
  const slotCode = normalizeSlotCode(slotLabel)
  if (!slotCode) {
    return null
  }

  const { data, error } = await supabase.rpc('create_project_slot', {
    p_project_id: projectId,
    p_slot_name: slotLabel,
    p_slot_code: slotCode,
    p_description: null,
  })

  if (error) {
    throw error
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return getId(data as RowRecord) || null
  }

  return null
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  const [slots, setSlots] = useState<RowRecord[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)

  const [createSlotMode, setCreateSlotMode] = useState(false)
  const [newSlotLabel, setNewSlotLabel] = useState('')
  const [creatingSlot, setCreatingSlot] = useState(false)

  const [activeTab, setActiveTab] = useState<DashboardTab>('scan')

  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [driveRootPath, setDriveRootPath] = useState<string | null>(null)
  const [driveRootInput, setDriveRootInput] = useState('')
  const [driveRootLoading, setDriveRootLoading] = useState(false)
  const [driveRootSaving, setDriveRootSaving] = useState(false)
  const [driveRootMessage, setDriveRootMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => getId(project) === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const selectedSlot = useMemo(
    () => slots.find((slot) => getId(slot) === selectedSlotId) ?? null,
    [slots, selectedSlotId]
  )

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return projects

    return projects.filter((project) => {
      const code = (project.project_code ?? '').toLowerCase()
      const brand = (project.cached_brand_name ?? '').toLowerCase()
      return code.includes(query) || brand.includes(query)
    })
  }, [projects, projectSearch])

  const loadProjects = async (opts?: { keepSelection?: boolean }) => {
    setProjectsLoading(true)
    setProjectsError(null)

    const { data, error } = await supabase
      .from('projects')
      .select(
        `
          id,
          project_code,
          cached_brand_name,
          project_uploads(created_at)
        `
      )
      .not('project_status_id', 'in', '(4,5,16)')
      .order('project_code', { ascending: false })

    if (error) {
      setProjectsError(error.message)
      setProjects([])
      setSelectedProjectId(null)
      setProjectsLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as ProjectListItem[]

    setProjects(rows)
    setProjectsLoading(false)

    if (rows.length === 0) {
      setSelectedProjectId(null)
      return
    }

    if (opts?.keepSelection && selectedProjectId && rows.some((row) => getId(row) === selectedProjectId)) {
      return
    }

    setSelectedProjectId(getId(rows[0]))
  }

  const loadSlots = async (projectId: string, opts?: { keepSelection?: boolean }) => {
    setSlotsLoading(true)
    setSlotsError(null)

    const { data, error } = await supabase.from('project_slots').select('*').eq('project_id', projectId)

    if (error) {
      setSlotsError(error.message)
      setSlots([])
      setSelectedSlotId(null)
      setSlotsLoading(false)
      return
    }

    const rows = (data ?? []) as RowRecord[]

    rows.sort((a, b) => {
      const sequenceA = getSlotSequence(a)
      const sequenceB = getSlotSequence(b)

      if (sequenceA !== null && sequenceB !== null && sequenceA !== sequenceB) {
        return sequenceB - sequenceA
      }

      return getSlotLabel(a).localeCompare(getSlotLabel(b))
    })

    setSlots(rows)
    setSlotsLoading(false)

    if (rows.length === 0) {
      setSelectedSlotId(null)
      return
    }

    if (opts?.keepSelection && selectedSlotId && rows.some((row) => getId(row) === selectedSlotId)) {
      return
    }

    setSelectedSlotId(getId(rows[0]))
  }

  const handleCreateSlot = async () => {
    if (!selectedProjectId) return

    const label = newSlotLabel.trim()
    if (!label) return

    setCreatingSlot(true)
    setSlotsError(null)

    try {
      const createdSlotId = await createSlotForProject(selectedProjectId, label)

      if (!createdSlotId) {
        setSlotsError('Slot creation failed. Provide a slot name with letters or numbers so a valid slot code can be generated.')
        setCreatingSlot(false)
        return
      }

      await loadSlots(selectedProjectId, { keepSelection: false })
      setSelectedSlotId(createdSlotId)
      setNewSlotLabel('')
      setCreateSlotMode(false)
      setCreatingSlot(false)
    } catch (error: unknown) {
      const maybeCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
      const errorText =
        maybeCode === '23505'
          ? 'Slot code already exists for this project. Use a different slot name/code.'
          : error instanceof Error
            ? error.message
            : 'Unable to create slot'
      setSlotsError(errorText)
      setCreatingSlot(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, changedSession) => {
      setSession(changedSession)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    loadProjects().catch((error: unknown) => {
      setProjectsError(error instanceof Error ? error.message : 'Unknown error while fetching projects')
    })
    loadDriveRootConfig().catch((error: unknown) => {
      setDriveRootMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Unknown error while loading drive root',
      })
    })
  }, [session])

  useEffect(() => {
    if (!selectedProjectId) {
      setSlots([])
      setSelectedSlotId(null)
      return
    }

    loadSlots(selectedProjectId).catch((error: unknown) => {
      setSlotsError(error instanceof Error ? error.message : 'Unknown error while fetching project slots')
    })
  }, [selectedProjectId])

  const handleSelectFolder = async () => {
    const path = await window.api.selectFolder()
    setFolderPath(path)
    setScanResult(null)
  }

  const handleScan = async () => {
    if (!folderPath) return
    setScanning(true)
    const result = await window.api.scanFolder(folderPath)
    setScanResult(result)
    setScanning(false)
  }

  const loadDriveRootConfig = async () => {
    setDriveRootLoading(true)
    setDriveRootMessage(null)

    try {
      const config = await window.api.getDriveRootPath()
      const savedPath = config.driveRootPath
      setDriveRootPath(savedPath)
      setDriveRootInput(savedPath ?? '')
    } catch (error: unknown) {
      const errorText = error instanceof Error ? error.message : 'Failed to load drive root path'
      setDriveRootMessage({ kind: 'error', text: errorText })
    } finally {
      setDriveRootLoading(false)
    }
  }

  const handlePickDriveRoot = async () => {
    const selectedPath = await window.api.selectFolder()
    if (!selectedPath) return

    setDriveRootInput(selectedPath)
    const validation = await window.api.validateDriveRootPath(selectedPath)

    if (validation.valid && validation.normalizedPath) {
      setDriveRootMessage({ kind: 'success', text: 'Path looks valid. Save to persist it.' })
    } else {
      setDriveRootMessage({ kind: 'error', text: validation.error ?? 'Invalid drive root path.' })
    }
  }

  const handleValidateDriveRoot = async () => {
    const validation = await window.api.validateDriveRootPath(driveRootInput || null)
    if (validation.valid && validation.normalizedPath) {
      setDriveRootMessage({ kind: 'success', text: `Valid path: ${validation.normalizedPath}` })
      return
    }

    setDriveRootMessage({ kind: 'error', text: validation.error ?? 'Invalid drive root path.' })
  }

  const handleSaveDriveRoot = async () => {
    setDriveRootSaving(true)
    setDriveRootMessage(null)

    try {
      const result = await window.api.setDriveRootPath(driveRootInput || null)
      if (!result.success) {
        setDriveRootMessage({ kind: 'error', text: result.error ?? 'Failed to save drive root path.' })
        return
      }

      setDriveRootPath(result.driveRootPath)
      setDriveRootInput(result.driveRootPath ?? '')
      setDriveRootMessage({
        kind: 'success',
        text: result.driveRootPath ? 'Drive root path saved.' : 'Drive root path cleared.',
      })
    } catch (error: unknown) {
      const errorText = error instanceof Error ? error.message : 'Failed to save drive root path'
      setDriveRootMessage({ kind: 'error', text: errorText })
    } finally {
      setDriveRootSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={styles.fullScreenCenterMuted}>
        Loading...
      </div>
    )
  }

  if (!session) {
    return (
      <div style={styles.fullScreenCenterDark}>
        <div style={styles.authCard}>
          <div style={{ marginBottom: 32, textAlign: 'center' }}>
            <h1 style={{ color: 'white', fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Garuda Desktop</h1>
            <p style={{ color: '#94a3b8', fontSize: 14 }}>Sign in with your Mindframes account</p>
          </div>
          <LoginForm />
        </div>
      </div>
    )
  }

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div>
          <h2 style={styles.brand}>GARUDA</h2>
          <p style={styles.sidebarCaption}>Projects</p>

          <input
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            placeholder="Search projects"
            style={styles.searchInput}
          />

          <div style={styles.listWrap}>
            {projectsLoading ? (
              <div style={styles.mutedRow}>Loading projects...</div>
            ) : filteredProjects.length === 0 ? (
              <div style={styles.mutedRow}>{projects.length === 0 ? 'No projects found' : 'No matches'}</div>
            ) : (
              filteredProjects.map((project) => {
                const id = getId(project)
                const selected = id === selectedProjectId
                const code = getProjectCode(project)
                const brandName = getProjectBrandName(project)

                return (
                  <button
                    key={id}
                    style={selected ? styles.projectRowSelected : styles.projectRow}
                    onClick={() => setSelectedProjectId(id)}
                  >
                    <span style={styles.projectTitle}>{code}</span>
                    <span style={styles.projectSub}>{brandName}</span>
                  </button>
                )
              })
            )}
          </div>

          <div style={styles.sectionHeader}>
            <p style={styles.sidebarCaption}>Slots</p>
            <button
              onClick={() => {
                setCreateSlotMode((prev) => !prev)
                setNewSlotLabel('')
              }}
              disabled={!selectedProjectId || creatingSlot}
              style={styles.iconButton}
              title="Create slot"
            >
              <Plus size={14} />
            </button>
          </div>

          {createSlotMode && selectedProjectId && (
            <div style={styles.inlineCreatePanel}>
              <input
                value={newSlotLabel}
                onChange={(event) => setNewSlotLabel(event.target.value)}
                placeholder="Slot label"
                style={styles.createInput}
              />
              <button
                onClick={handleCreateSlot}
                disabled={creatingSlot || newSlotLabel.trim().length === 0}
                style={styles.createButton}
              >
                {creatingSlot ? 'Creating...' : 'Create'}
              </button>
            </div>
          )}

          <div style={styles.listWrap}>
            {!selectedProjectId ? (
              <div style={styles.mutedRow}>Select a project</div>
            ) : slotsLoading ? (
              <div style={styles.mutedRow}>Loading slots...</div>
            ) : slots.length === 0 ? (
              <div style={styles.mutedRow}>No slots for this project</div>
            ) : (
              slots.map((slot) => {
                const id = getId(slot)
                const selected = id === selectedSlotId
                const sequence = getSlotSequence(slot)

                return (
                  <button
                    key={id}
                    style={selected ? styles.slotRowSelected : styles.slotRow}
                    onClick={() => setSelectedSlotId(id)}
                  >
                    <span style={styles.projectTitle}>{getSlotLabel(slot)}</span>
                    <span style={styles.projectSub}>
                      {sequence !== null ? `Current sequence: ${sequence}` : 'Sequence unavailable'}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div style={styles.footer}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{session.user.email}</div>
          <button onClick={() => supabase.auth.signOut()} style={styles.signOutButton}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Upload Dashboard</h1>
            <p style={{ color: '#94a3b8', margin: 0 }}>
              {selectedProject
                ? `${getProjectCode(selectedProject)}${selectedSlot ? ` / ${getSlotLabel(selectedSlot)}` : ''}`
                : 'Select a project and slot to continue'}
            </p>
          </div>

          <button
            onClick={() => {
              loadProjects({ keepSelection: true }).catch((error: unknown) => {
                setProjectsError(error instanceof Error ? error.message : 'Unknown refresh error')
              })
              if (selectedProjectId) {
                loadSlots(selectedProjectId, { keepSelection: true }).catch((error: unknown) => {
                  setSlotsError(error instanceof Error ? error.message : 'Unknown refresh error')
                })
              }
            }}
            style={styles.refreshButton}
            title="Refresh projects and slots"
          >
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>

        {(projectsError || slotsError) && (
          <div style={styles.errorBanner}>
            {projectsError && <div>Projects: {projectsError}</div>}
            {slotsError && <div>Slots: {slotsError}</div>}
          </div>
        )}

        <div style={styles.tabBar}>
          {(['scan', 'plan', 'ingest', 'settings'] as DashboardTab[]).map((tab) => (
            <button
              key={tab}
              style={activeTab === tab ? styles.tabButtonActive : styles.tabButton}
              onClick={() => setActiveTab(tab)}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <section style={styles.panel}>
          {activeTab === 'scan' && (
            <>
              <p style={styles.tabIntro}>Select and scan a source folder. Phase 3 will expand this into hash/type planning.</p>

              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                <button onClick={handleSelectFolder} style={styles.actionButtonSecondary}>
                  <FolderOpen size={16} /> Select Folder
                </button>

                <button
                  onClick={handleScan}
                  disabled={!folderPath || scanning}
                  style={scanning ? styles.actionButtonDisabled : styles.actionButtonPrimary}
                >
                  {scanning ? <Loader2 size={16} /> : <Scan size={16} />}
                  {scanning ? 'Scanning...' : 'Scan Folder'}
                </button>
              </div>

              {folderPath && <div style={styles.pathText}>Selected: {folderPath}</div>}

              {scanResult && scanResult.success && (
                <div style={styles.resultPanel}>
                  <strong>{scanResult.count} files found</strong>
                  <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto' }}>
                    {scanResult.files.slice(0, 25).map((file, index) => (
                      <div key={`${file.path}-${index}`} style={styles.fileRow}>
                        <span>{file.name}</span>
                        <span style={{ color: '#64748b' }}>
                          {(file.size / 1024 / 1024).toFixed(2)} MB · {file.extension}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {scanResult && !scanResult.success && <div style={{ color: '#ef4444' }}>Error: {scanResult.error}</div>}
            </>
          )}

          {activeTab === 'plan' && (
            <>
              {/* TODO(Phase 4): Reserve sequence numbers and preview canonical rename mapping. */}
              <h3 style={styles.todoHeading}>Plan (Phase 4)</h3>
              <p style={styles.todoText}>Sequence reservation and rename preview will be implemented in the next ingestion phase.</p>
            </>
          )}

          {activeTab === 'ingest' && (
            <>
              {/* TODO(Phase 5/6): Execute copy + upload row writes with abort/resume journal. */}
              <h3 style={styles.todoHeading}>Ingest (Phase 5)</h3>
              <p style={styles.todoText}>File copy + `project_uploads` writes and abort/resume flow are not part of Phase 1.</p>
            </>
          )}

          {activeTab === 'settings' && (
            <>
              <h3 style={styles.todoHeading}>Drive Root Path</h3>
              <p style={styles.todoText}>
                Select your local Google Drive Stream root path. This is saved in local app config and validated before save.
              </p>

              <div style={styles.settingsBlock}>
                <label style={styles.settingsLabel}>Saved Path</label>
                <div style={styles.savedPathBox}>{driveRootPath ?? 'Not configured'}</div>
              </div>

              <div style={styles.settingsBlock}>
                <label style={styles.settingsLabel}>Drive Root</label>
                <div style={styles.settingsInputRow}>
                  <input
                    value={driveRootInput}
                    onChange={(event) => setDriveRootInput(event.target.value)}
                    placeholder="/Users/you/Library/CloudStorage/GoogleDrive-..."
                    style={styles.settingsInput}
                  />
                  <button onClick={handlePickDriveRoot} style={styles.actionButtonSecondary}>
                    <FolderOpen size={16} /> Browse
                  </button>
                </div>
                <div style={styles.settingsButtonRow}>
                  <button onClick={handleValidateDriveRoot} style={styles.actionButtonSecondary} disabled={driveRootLoading}>
                    Validate
                  </button>
                  <button onClick={handleSaveDriveRoot} style={styles.actionButtonPrimary} disabled={driveRootSaving}>
                    {driveRootSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {driveRootMessage && (
                <div style={driveRootMessage.kind === 'error' ? styles.errorBanner : styles.successBanner}>
                  {driveRootMessage.text}
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  fullScreenCenterMuted: {
    height: '100vh',
    background: '#020617',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
  },
  fullScreenCenterDark: {
    height: '100vh',
    background: '#020617',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  authCard: {
    width: '100%',
    maxWidth: 400,
    padding: 40,
    background: '#0f172a',
    borderRadius: 16,
    border: '1px solid #1e293b',
  },
  layout: {
    minHeight: '100vh',
    background: '#020617',
    color: 'white',
    display: 'flex',
  },
  sidebar: {
    width: 320,
    borderRight: '1px solid #1e293b',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 16,
    background: '#020817',
  },
  brand: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 24,
    color: '#38bdf8',
    letterSpacing: 0.8,
  },
  sidebarCaption: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
    marginTop: 0,
  },
  searchInput: {
    width: '100%',
    marginBottom: 12,
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: 'white',
    fontSize: 13,
    padding: '8px 10px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  listWrap: {
    border: '1px solid #1e293b',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 14,
    maxHeight: 230,
    overflowY: 'auto',
    background: '#0b1220',
  },
  mutedRow: {
    fontSize: 12,
    color: '#64748b',
    padding: 12,
  },
  projectRow: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderBottom: '1px solid #1e293b',
    background: 'transparent',
    color: 'white',
    cursor: 'pointer',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  projectRowSelected: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderBottom: '1px solid #1e293b',
    background: '#0f2742',
    color: 'white',
    cursor: 'pointer',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  slotRow: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderBottom: '1px solid #1e293b',
    background: 'transparent',
    color: 'white',
    cursor: 'pointer',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  slotRowSelected: {
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderBottom: '1px solid #1e293b',
    background: '#132439',
    color: 'white',
    cursor: 'pointer',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  projectTitle: {
    fontSize: 13,
    fontWeight: 600,
  },
  projectSub: {
    fontSize: 12,
    color: '#94a3b8',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    border: '1px solid #1e293b',
    background: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    width: 24,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  inlineCreatePanel: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  createInput: {
    flex: 1,
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: 'white',
    fontSize: 13,
    padding: '8px 10px',
    outline: 'none',
  },
  createButton: {
    border: 'none',
    borderRadius: 8,
    background: '#2563eb',
    color: 'white',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 10px',
    cursor: 'pointer',
  },
  footer: {
    borderTop: '1px solid #1e293b',
    paddingTop: 16,
  },
  signOutButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'none',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
  },
  main: {
    flex: 1,
    padding: 28,
    overflow: 'auto',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
  },
  refreshButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: 'white',
    borderRadius: 8,
    padding: '8px 10px',
    cursor: 'pointer',
  },
  errorBanner: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    color: '#fecaca',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 13,
    display: 'grid',
    gap: 4,
  },
  successBanner: {
    background: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    color: '#6ee7b7',
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    fontSize: 13,
  },
  tabBar: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  tabButton: {
    border: '1px solid #334155',
    background: '#0f172a',
    color: '#94a3b8',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 12px',
    cursor: 'pointer',
  },
  tabButtonActive: {
    border: '1px solid #0ea5e9',
    background: '#0c1f33',
    color: '#7dd3fc',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 12px',
    cursor: 'pointer',
  },
  panel: {
    border: '1px solid #1e293b',
    borderRadius: 12,
    background: '#0b1220',
    padding: 20,
    minHeight: 280,
  },
  tabIntro: {
    marginTop: 0,
    marginBottom: 16,
    color: '#94a3b8',
    fontSize: 13,
  },
  actionButtonSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid #1e293b',
    background: '#0f172a',
    color: 'white',
    cursor: 'pointer',
  },
  actionButtonPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#10b981',
    color: 'white',
    cursor: 'pointer',
  },
  actionButtonDisabled: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#334155',
    color: 'white',
    cursor: 'not-allowed',
  },
  pathText: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 16,
  },
  resultPanel: {
    background: '#0f172a',
    padding: 16,
    borderRadius: 12,
    border: '1px solid #1e293b',
  },
  fileRow: {
    fontSize: 13,
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    borderBottom: '1px solid #1e293b',
    opacity: 0.9,
  },
  todoHeading: {
    marginTop: 0,
    marginBottom: 8,
    fontSize: 18,
  },
  todoText: {
    margin: 0,
    color: '#94a3b8',
    fontSize: 14,
  },
  settingsBlock: {
    marginTop: 16,
  },
  settingsLabel: {
    display: 'block',
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
  },
  savedPathBox: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: '#cbd5e1',
    minHeight: 18,
    wordBreak: 'break-all',
  },
  settingsInputRow: {
    display: 'flex',
    gap: 10,
  },
  settingsInput: {
    flex: 1,
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: 'white',
    fontSize: 13,
    padding: '10px 12px',
    outline: 'none',
  },
  settingsButtonRow: {
    display: 'flex',
    gap: 10,
    marginTop: 10,
  },
}

export default App

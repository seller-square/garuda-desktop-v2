import { useEffect, useMemo, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { FolderOpen, Loader2, LogOut, Plus, RefreshCcw, Scan } from 'lucide-react'
import { LoginForm } from './components/LoginForm'
import { supabase } from './lib/supabase'

type ScannedFile = {
  name: string
  fullPath: string
  relativePath: string
  parentRelativePath: string
  size: number
  extension: string
  fileType: 'image' | 'video' | 'other'
  sha256: string
}

type FolderGroup = {
  relativePath: string
  fileCount: number
  totalBytes: number
  typeCounts: {
    image: number
    video: number
    other: number
  }
}

type IngestionPlan = {
  rootFolder: string
  scannedAt: string
  totalFiles: number
  totalBytes: number
  folderGroups: FolderGroup[]
  files: ScannedFile[]
}

type SlotMappingSummary = {
  slotId: string
  slotLabel: string
  fileCount: number
  totalBytes: number
  typeCounts: {
    image: number
    video: number
    other: number
  }
  plannedFiles: ScannedFile[]
}

type SlotNamingConfig = {
  slotId: string
  slotLabel: string
  prefix: string
  padding: number
}

type RenamePlanItem = {
  slotId: string
  slotLabel: string
  sourcePath: string
  sourceFilename: string
  oldFilename: string
  oldRelativePath: string
  plannedName: string
  plannedSequence: number
  plannedFilename: string
  sha256: string
  sizeBytes: number
}

type ExecutionPlanItem = {
  sourcePath: string
  sourceFilename: string
  plannedName: string
  destinationPath: string
  slotId: string
  slotLabel: string
  sha256: string
  sizeBytes: number
}

type ExecutionError = {
  slotId: string
  slotLabel: string
  sourcePath: string
  sourceFilename: string
  errorType: 'missing' | 'permission' | 'unreadable' | 'zero_byte' | 'hash_mismatch'
  message: string
}

type ExecutionValidation = {
  allFilesReadable: boolean
  noCriticalErrors: boolean
  executionReady: boolean
  errors: ExecutionError[]
}

type MappingValidation = {
  fileTypeMismatches: string[]
  emptySlots: string[]
  duplicateHashes: Array<{ sha256: string; paths: string[] }>
  renameCollisions: Array<{ plannedFilename: string; oldPaths: string[] }>
  invalidNames: Array<{ oldPath: string; plannedFilename: string; reason: string }>
}

type MappingPlan = {
  mappedFolderCount: number
  totalFolderCount: number
  unmappedFolders: string[]
  slotSummaries: SlotMappingSummary[]
  slotNamingConfigs: SlotNamingConfig[]
  renamePlan: RenamePlanItem[]
  validation: MappingValidation
}

type SlotNamingOverride = {
  prefix: string
  padding: number
}

type ScanResult =
  | { success: true; plan: IngestionPlan }
  | { success: false; error: string }

type RowRecord = Record<string, unknown>
type ProjectListItem = {
  id: string
  project_code: string | null
  cached_brand_name: string | null
  project_uploads?: Array<{ created_at: string | null }> | null
}

type DashboardTab = 'scan' | 'plan' | 'execution' | 'settings'

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function normalizeSlotCode(rawLabel: string): string {
  return rawLabel
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
}

function sanitizeFilenameToken(token: string): string {
  return token
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
}

function getDefaultSlotPrefix(projectCode: string, slotLabel: string): string {
  const sanitizedProjectCode = sanitizeFilenameToken(projectCode)
  const sanitizedSlotLabel = sanitizeFilenameToken(slotLabel)
  return sanitizeFilenameToken(`${sanitizedProjectCode}_${sanitizedSlotLabel}`)
}

function buildSlotNameFromFolderPath(folderRelativePath: string): string {
  if (folderRelativePath === '/') {
    return 'ROOT'
  }

  const parts = folderRelativePath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'NEW_SLOT'
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
  const [folderSlotAssignments, setFolderSlotAssignments] = useState<Record<string, string>>({})
  const [slotNamingOverrides, setSlotNamingOverrides] = useState<Record<string, SlotNamingOverride>>({})
  const [mappingMessage, setMappingMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [creatingSlotForFolder, setCreatingSlotForFolder] = useState<string | null>(null)
  const [executionRunning, setExecutionRunning] = useState(false)
  const [executionValidation, setExecutionValidation] = useState<ExecutionValidation | null>(null)

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

  const slotById = useMemo(() => {
    const index = new Map<string, RowRecord>()
    for (const slot of slots) {
      index.set(getId(slot), slot)
    }
    return index
  }, [slots])

  const mappingPlan = useMemo<MappingPlan | null>(() => {
    if (!scanResult || !scanResult.success) {
      return null
    }

    const folderToFiles = new Map<string, ScannedFile[]>()
    for (const file of scanResult.plan.files) {
      const existing = folderToFiles.get(file.parentRelativePath)
      if (existing) {
        existing.push(file)
      } else {
        folderToFiles.set(file.parentRelativePath, [file])
      }
    }

    const slotSummariesMap = new Map<string, SlotMappingSummary>()

    for (const group of scanResult.plan.folderGroups) {
      const slotId = folderSlotAssignments[group.relativePath]
      if (!slotId) continue

      const slot = slotById.get(slotId)
      if (!slot) continue

      const slotLabel = getSlotLabel(slot)
      const filesForFolder = folderToFiles.get(group.relativePath) ?? []

      const current = slotSummariesMap.get(slotId)
      if (!current) {
        slotSummariesMap.set(slotId, {
          slotId,
          slotLabel,
          fileCount: filesForFolder.length,
          totalBytes: filesForFolder.reduce((sum, file) => sum + file.size, 0),
          typeCounts: {
            image: filesForFolder.filter((file) => file.fileType === 'image').length,
            video: filesForFolder.filter((file) => file.fileType === 'video').length,
            other: filesForFolder.filter((file) => file.fileType === 'other').length
          },
          plannedFiles: [...filesForFolder]
        })
      } else {
        current.fileCount += filesForFolder.length
        current.totalBytes += filesForFolder.reduce((sum, file) => sum + file.size, 0)
        current.typeCounts.image += filesForFolder.filter((file) => file.fileType === 'image').length
        current.typeCounts.video += filesForFolder.filter((file) => file.fileType === 'video').length
        current.typeCounts.other += filesForFolder.filter((file) => file.fileType === 'other').length
        current.plannedFiles.push(...filesForFolder)
      }
    }

    const slotSummaries = Array.from(slotSummariesMap.values()).sort((a, b) => a.slotLabel.localeCompare(b.slotLabel))
    const projectCodeForPrefix = selectedProject?.project_code ?? 'PROJECT'
    const slotNamingConfigs: SlotNamingConfig[] = slotSummaries.map((summary) => {
      const override = slotNamingOverrides[summary.slotId]
      const defaultPrefix = getDefaultSlotPrefix(projectCodeForPrefix, summary.slotLabel)
      return {
        slotId: summary.slotId,
        slotLabel: summary.slotLabel,
        prefix: override?.prefix ? sanitizeFilenameToken(override.prefix) : defaultPrefix,
        padding: override?.padding ?? 4
      }
    })

    const namingConfigBySlotId = new Map<string, SlotNamingConfig>(
      slotNamingConfigs.map((config) => [config.slotId, config] as const)
    )
    const mappedFolderCount = Object.keys(folderSlotAssignments).filter((folder) =>
      scanResult.plan.folderGroups.some((group) => group.relativePath === folder)
    ).length
    const unmappedFolders = scanResult.plan.folderGroups
      .map((group) => group.relativePath)
      .filter((folder) => !folderSlotAssignments[folder])

    const fileTypeMismatches = slotSummaries
      .filter((summary) => {
        const nonZeroTypeCount = [summary.typeCounts.image, summary.typeCounts.video, summary.typeCounts.other].filter(
          (count) => count > 0
        ).length
        return nonZeroTypeCount > 1
      })
      .map((summary) => `Slot "${summary.slotLabel}" has mixed file types.`)

    const referencedSlotIds = new Set<string>(Object.values(folderSlotAssignments))
    if (selectedSlotId) {
      referencedSlotIds.add(selectedSlotId)
    }

    const emptySlots: string[] = []
    for (const slotId of referencedSlotIds) {
      const summary = slotSummariesMap.get(slotId)
      if (summary && summary.fileCount > 0) {
        continue
      }

      const slot = slotById.get(slotId)
      if (slot) {
        emptySlots.push(getSlotLabel(slot))
      }
    }

    const hashToPaths = new Map<string, string[]>()
    for (const summary of slotSummaries) {
      for (const file of summary.plannedFiles) {
        const existing = hashToPaths.get(file.sha256)
        if (existing) {
          existing.push(file.relativePath)
        } else {
          hashToPaths.set(file.sha256, [file.relativePath])
        }
      }
    }

    const duplicateHashes = Array.from(hashToPaths.entries())
      .filter(([, paths]) => paths.length > 1)
      .map(([sha256, paths]) => ({ sha256, paths }))

    const renamePlan: RenamePlanItem[] = []

    for (const summary of slotSummaries) {
      const naming = namingConfigBySlotId.get(summary.slotId)
      if (!naming) {
        continue
      }

      const files = [...summary.plannedFiles].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const plannedSequence = index + 1
        const sequenceText = String(plannedSequence).padStart(naming.padding, '0')
        const plannedName = `${naming.prefix}_${sequenceText}`
        const plannedFilename = `${plannedName}${file.extension}`

        renamePlan.push({
          slotId: summary.slotId,
          slotLabel: summary.slotLabel,
          sourcePath: file.fullPath,
          sourceFilename: file.name,
          oldFilename: file.name,
          oldRelativePath: file.relativePath,
          plannedName,
          plannedSequence,
          plannedFilename,
          sha256: file.sha256,
          sizeBytes: file.size
        })
      }
    }

    const plannedFilenameMap = new Map<string, string[]>()
    const invalidNames: Array<{ oldPath: string; plannedFilename: string; reason: string }> = []

    for (const item of renamePlan) {
      if (!item.plannedName.trim()) {
        invalidNames.push({
          oldPath: item.oldRelativePath,
          plannedFilename: item.plannedFilename,
          reason: 'Planned base name is empty.'
        })
      }

      if (/[<>:"/\\|?*\x00-\x1f]/.test(item.plannedFilename)) {
        invalidNames.push({
          oldPath: item.oldRelativePath,
          plannedFilename: item.plannedFilename,
          reason: 'Filename contains invalid characters.'
        })
      }

      if (item.plannedFilename.length > 255) {
        invalidNames.push({
          oldPath: item.oldRelativePath,
          plannedFilename: item.plannedFilename,
          reason: 'Filename is longer than 255 characters.'
        })
      }

      const existing = plannedFilenameMap.get(item.plannedFilename)
      if (existing) {
        existing.push(item.oldRelativePath)
      } else {
        plannedFilenameMap.set(item.plannedFilename, [item.oldRelativePath])
      }
    }

    const renameCollisions = Array.from(plannedFilenameMap.entries())
      .filter(([, oldPaths]) => oldPaths.length > 1)
      .map(([plannedFilename, oldPaths]) => ({ plannedFilename, oldPaths }))

    return {
      mappedFolderCount,
      totalFolderCount: scanResult.plan.folderGroups.length,
      unmappedFolders,
      slotSummaries,
      slotNamingConfigs,
      renamePlan,
      validation: {
        fileTypeMismatches,
        emptySlots,
        duplicateHashes,
        renameCollisions,
        invalidNames
      }
    }
  }, [folderSlotAssignments, scanResult, selectedProject?.project_code, selectedSlotId, slotById, slotNamingOverrides])

  const executionPlan = useMemo<ExecutionPlanItem[]>(() => {
    if (!mappingPlan || !selectedProject) {
      return []
    }

    const projectCode = selectedProject.project_code?.trim() || 'PROJECT'

    return mappingPlan.renamePlan.map((item) => ({
      sourcePath: item.sourcePath,
      sourceFilename: item.sourceFilename,
      plannedName: item.plannedFilename,
      destinationPath: `drive://${projectCode}/slot/${item.slotId}/${item.plannedFilename}`,
      slotId: item.slotId,
      slotLabel: item.slotLabel,
      sha256: item.sha256,
      sizeBytes: item.sizeBytes
    }))
  }, [mappingPlan, selectedProject])

  const executionPlanBySlot = useMemo(() => {
    const grouped = new Map<string, { slotLabel: string; items: ExecutionPlanItem[]; totalBytes: number }>()

    for (const item of executionPlan) {
      const existing = grouped.get(item.slotId)
      if (existing) {
        existing.items.push(item)
        existing.totalBytes += item.sizeBytes
      } else {
        grouped.set(item.slotId, {
          slotLabel: item.slotLabel,
          items: [item],
          totalBytes: item.sizeBytes
        })
      }
    }

    return Array.from(grouped.entries())
      .map(([slotId, group]) => ({ slotId, ...group }))
      .sort((a, b) => a.slotLabel.localeCompare(b.slotLabel))
  }, [executionPlan])

  const executionErrorsBySlot = useMemo(() => {
    if (!executionValidation) {
      return []
    }

    const grouped = new Map<string, { slotLabel: string; errors: ExecutionError[] }>()
    for (const error of executionValidation.errors) {
      const existing = grouped.get(error.slotId)
      if (existing) {
        existing.errors.push(error)
      } else {
        grouped.set(error.slotId, { slotLabel: error.slotLabel, errors: [error] })
      }
    }

    return Array.from(grouped.entries())
      .map(([slotId, group]) => ({ slotId, ...group }))
      .sort((a, b) => a.slotLabel.localeCompare(b.slotLabel))
  }, [executionValidation])

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
      setFolderSlotAssignments({})
      setSlotNamingOverrides({})
      setExecutionValidation(null)
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
    setFolderSlotAssignments({})
    setSlotNamingOverrides({})
    setMappingMessage(null)
    setExecutionValidation(null)
  }

  const handleScan = async () => {
    if (!folderPath) return
    setScanning(true)
    setScanResult(null)
    setFolderSlotAssignments({})
    setSlotNamingOverrides({})
    setMappingMessage(null)
    setExecutionValidation(null)
    const result = await window.api.scanFolder(folderPath)
    setScanResult(result)
    setScanning(false)
  }

  const handleCancelScan = async () => {
    await window.api.cancelScanFolder()
  }

  const handleAssignFolderToSlot = (folderRelativePath: string, slotId: string) => {
    setExecutionValidation(null)
    setFolderSlotAssignments((current) => {
      if (!slotId) {
        const next = { ...current }
        delete next[folderRelativePath]
        return next
      }

      return {
        ...current,
        [folderRelativePath]: slotId
      }
    })
  }

  const handleSlotPrefixOverride = (slotId: string, prefix: string) => {
    setExecutionValidation(null)
    setSlotNamingOverrides((current) => ({
      ...current,
      [slotId]: {
        prefix,
        padding: current[slotId]?.padding ?? 4
      }
    }))
  }

  const handleSlotPaddingOverride = (slotId: string, rawPadding: string) => {
    setExecutionValidation(null)
    const parsed = Number.parseInt(rawPadding, 10)
    const padding = Number.isFinite(parsed) ? Math.min(8, Math.max(1, parsed)) : 4

    setSlotNamingOverrides((current) => ({
      ...current,
      [slotId]: {
        prefix: current[slotId]?.prefix ?? '',
        padding
      }
    }))
  }

  const handleCreateSlotFromFolder = async (folderRelativePath: string) => {
    if (!selectedProjectId) return

    const slotLabel = buildSlotNameFromFolderPath(folderRelativePath)
    setCreatingSlotForFolder(folderRelativePath)
    setMappingMessage(null)
    setSlotsError(null)

    try {
      const createdSlotId = await createSlotForProject(selectedProjectId, slotLabel)
      if (!createdSlotId) {
        setMappingMessage({
          kind: 'error',
          text: `Unable to create slot for folder "${folderRelativePath}".`
        })
        return
      }

      await loadSlots(selectedProjectId, { keepSelection: true })
      setFolderSlotAssignments((current) => ({
        ...current,
        [folderRelativePath]: createdSlotId
      }))
      setMappingMessage({
        kind: 'success',
        text: `Created slot "${slotLabel}" and mapped folder "${folderRelativePath}".`
      })
    } catch (error: unknown) {
      const maybeCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
      const errorText =
        maybeCode === '23505'
          ? `Slot code for "${slotLabel}" already exists. Map this folder to an existing slot.`
          : error instanceof Error
            ? error.message
            : 'Unable to create slot from folder'
      setMappingMessage({ kind: 'error', text: errorText })
    } finally {
      setCreatingSlotForFolder(null)
    }
  }

  const handleRunExecutionDryRun = async () => {
    if (executionPlan.length === 0) {
      setExecutionValidation({
        allFilesReadable: false,
        noCriticalErrors: false,
        executionReady: false,
        errors: [
          {
            slotId: 'unmapped',
            slotLabel: 'Unmapped',
            sourcePath: '',
            sourceFilename: '',
            errorType: 'unreadable',
            message: 'No execution items. Complete folder-to-slot mapping first.'
          }
        ]
      })
      return
    }

    setExecutionRunning(true)

    try {
      const response = await window.api.dryRunStreamOpen(
        executionPlan.map((item) => ({
          sourcePath: item.sourcePath,
          expectedSizeBytes: item.sizeBytes
        }))
      )

      const itemBySourcePath = new Map<string, ExecutionPlanItem>()
      for (const item of executionPlan) {
        itemBySourcePath.set(item.sourcePath, item)
      }

      const errors: ExecutionError[] = []
      for (const result of response.results) {
        if (result.ok || !result.errorType) {
          continue
        }

        const planItem = itemBySourcePath.get(result.sourcePath)
        if (!planItem) {
          continue
        }

        errors.push({
          slotId: planItem.slotId,
          slotLabel: planItem.slotLabel,
          sourcePath: planItem.sourcePath,
          sourceFilename: planItem.sourceFilename,
          errorType: result.errorType,
          message: result.message ?? 'Dry-run validation error'
        })
      }

      const allFilesReadable = errors.length === 0
      const noCriticalErrors = errors.length === 0

      setExecutionValidation({
        allFilesReadable,
        noCriticalErrors,
        executionReady: allFilesReadable && noCriticalErrors,
        errors
      })
    } finally {
      setExecutionRunning(false)
    }
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
          {(['scan', 'plan', 'execution', 'settings'] as DashboardTab[]).map((tab) => (
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

                {scanning && (
                  <button onClick={handleCancelScan} style={styles.actionButtonDanger}>
                    Abort Scan
                  </button>
                )}
              </div>

              {folderPath && <div style={styles.pathText}>Selected: {folderPath}</div>}

              {scanResult && scanResult.success && (
                <div style={styles.resultPanel}>
                  <strong>{scanResult.plan.totalFiles} files found</strong>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>
                    Root: {scanResult.plan.rootFolder}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                    Total size: {formatBytes(scanResult.plan.totalBytes)} · Folders: {scanResult.plan.folderGroups.length}
                  </div>
                  <div style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
                    {scanResult.plan.folderGroups.map((group) => (
                      <div key={group.relativePath} style={styles.fileRow}>
                        <span>{group.relativePath}</span>
                        <span style={{ color: '#64748b' }}>
                          {group.fileCount} files · img {group.typeCounts.image} · vid {group.typeCounts.video} · other{' '}
                          {group.typeCounts.other}
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
              <h3 style={styles.todoHeading}>Folder to Slot Mapping</h3>
              <p style={styles.todoText}>
                Map scanned folders to project slots. This builds an in-memory mapping plan only. No files are moved or uploaded.
              </p>

              {!scanResult || !scanResult.success ? (
                <div style={styles.mutedPanel}>Run a scan first to build folder groups.</div>
              ) : (
                <>
                  <div style={styles.mappingGridHeader}>
                    <span>Folder Group</span>
                    <span>Files</span>
                    <span>Assign Slot</span>
                    <span>Create Slot</span>
                  </div>

                  <div style={styles.mappingGridBody}>
                    {scanResult.plan.folderGroups.map((group) => (
                      <div key={group.relativePath} style={styles.mappingGridRow}>
                        <span style={styles.mappingFolderCell}>{group.relativePath}</span>
                        <span style={styles.mappingFileCell}>
                          {group.fileCount} · img {group.typeCounts.image} · vid {group.typeCounts.video} · other{' '}
                          {group.typeCounts.other}
                        </span>
                        <select
                          value={folderSlotAssignments[group.relativePath] ?? ''}
                          onChange={(event) => handleAssignFolderToSlot(group.relativePath, event.target.value)}
                          style={styles.mappingSelect}
                        >
                          <option value="">Unmapped</option>
                          {slots.map((slot) => (
                            <option key={getId(slot)} value={getId(slot)}>
                              {getSlotLabel(slot)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleCreateSlotFromFolder(group.relativePath)}
                          disabled={!selectedProjectId || creatingSlotForFolder === group.relativePath}
                          style={styles.mappingCreateButton}
                        >
                          {creatingSlotForFolder === group.relativePath ? 'Creating...' : 'From Folder'}
                        </button>
                      </div>
                    ))}
                  </div>

                  {mappingMessage && (
                    <div style={mappingMessage.kind === 'error' ? styles.errorBanner : styles.successBanner}>
                      {mappingMessage.text}
                    </div>
                  )}

                  {mappingPlan && (
                    <div style={styles.mappingSummaryPanel}>
                      <h4 style={styles.mappingSummaryTitle}>Mapping Summary</h4>
                      <div style={styles.mappingSummaryText}>
                        Mapped folders: {mappingPlan.mappedFolderCount}/{mappingPlan.totalFolderCount}
                      </div>
                      <div style={styles.mappingSummaryText}>Slot plans: {mappingPlan.slotSummaries.length}</div>

                      {mappingPlan.unmappedFolders.length > 0 && (
                        <div style={styles.mappingWarning}>
                          Unmapped folders ({mappingPlan.unmappedFolders.length}): {mappingPlan.unmappedFolders.join(', ')}
                        </div>
                      )}

                      {mappingPlan.slotSummaries.map((summary) => (
                        <div key={summary.slotId} style={styles.mappingSlotSummaryRow}>
                          <span>{summary.slotLabel}</span>
                          <span>
                            {summary.fileCount} files · {formatBytes(summary.totalBytes)} · img {summary.typeCounts.image} ·
                            vid {summary.typeCounts.video} · other {summary.typeCounts.other}
                          </span>
                        </div>
                      ))}

                      {(mappingPlan.validation.fileTypeMismatches.length > 0 ||
                        mappingPlan.validation.emptySlots.length > 0 ||
                        mappingPlan.validation.duplicateHashes.length > 0 ||
                        mappingPlan.validation.renameCollisions.length > 0 ||
                        mappingPlan.validation.invalidNames.length > 0) && (
                        <div style={styles.mappingValidationPanel}>
                          {mappingPlan.validation.fileTypeMismatches.map((issue) => (
                            <div key={issue} style={styles.mappingWarning}>
                              {issue}
                            </div>
                          ))}

                          {mappingPlan.validation.emptySlots.map((slotLabel) => (
                            <div key={slotLabel} style={styles.mappingWarning}>
                              Slot "{slotLabel}" has no planned files.
                            </div>
                          ))}

                          {mappingPlan.validation.duplicateHashes.map((duplicate) => (
                            <div key={duplicate.sha256} style={styles.mappingWarning}>
                              Duplicate hash {duplicate.sha256.slice(0, 12)}... across: {duplicate.paths.join(', ')}
                            </div>
                          ))}

                          {mappingPlan.validation.renameCollisions.map((duplicate) => (
                            <div key={duplicate.plannedFilename} style={styles.mappingWarning}>
                              Rename collision "{duplicate.plannedFilename}" for: {duplicate.oldPaths.join(', ')}
                            </div>
                          ))}

                          {mappingPlan.validation.invalidNames.map((invalid) => (
                            <div key={`${invalid.oldPath}-${invalid.plannedFilename}`} style={styles.mappingWarning}>
                              Invalid rename "{invalid.plannedFilename}" for {invalid.oldPath}: {invalid.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {mappingPlan && mappingPlan.slotNamingConfigs.length > 0 && (
                    <div style={styles.mappingSummaryPanel}>
                      <h4 style={styles.mappingSummaryTitle}>Slot Naming Config</h4>
                      <div style={styles.namingGridHeader}>
                        <span>Slot</span>
                        <span>Prefix</span>
                        <span>Padding</span>
                      </div>
                      <div style={styles.namingGridBody}>
                        {mappingPlan.slotNamingConfigs.map((config) => (
                          <div key={config.slotId} style={styles.namingGridRow}>
                            <span style={styles.mappingFolderCell}>{config.slotLabel}</span>
                            <input
                              value={slotNamingOverrides[config.slotId]?.prefix ?? config.prefix}
                              onChange={(event) => handleSlotPrefixOverride(config.slotId, event.target.value)}
                              style={styles.namingInput}
                            />
                            <input
                              type="number"
                              min={1}
                              max={8}
                              value={slotNamingOverrides[config.slotId]?.padding ?? config.padding}
                              onChange={(event) => handleSlotPaddingOverride(config.slotId, event.target.value)}
                              style={styles.namingPaddingInput}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mappingPlan && (
                    <div style={styles.mappingSummaryPanel}>
                      <h4 style={styles.mappingSummaryTitle}>Rename Preview</h4>
                      <div style={styles.mappingSummaryText}>
                        Deterministic preview only. No filesystem changes are performed in this phase.
                      </div>
                      <div style={styles.renameGridHeader}>
                        <span>Slot</span>
                        <span>Old Filename</span>
                        <span>Planned Filename</span>
                      </div>
                      <div style={styles.renameGridBody}>
                        {mappingPlan.renamePlan.map((item) => {
                          const hasCollision = mappingPlan.validation.renameCollisions.some(
                            (collision) => collision.plannedFilename === item.plannedFilename
                          )
                          const hasInvalid = mappingPlan.validation.invalidNames.some(
                            (invalid) =>
                              invalid.oldPath === item.oldRelativePath && invalid.plannedFilename === item.plannedFilename
                          )

                          return (
                            <div key={`${item.slotId}-${item.oldRelativePath}`} style={styles.renameGridRow}>
                              <span style={styles.mappingFileCell}>{item.slotLabel}</span>
                              <span style={styles.mappingFolderCell}>{item.oldFilename}</span>
                              <span style={hasCollision || hasInvalid ? styles.renameDangerCell : styles.renameOkCell}>
                                {item.plannedFilename}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'execution' && (
            <>
              <h3 style={styles.todoHeading}>Execution (Streaming Dry Run)</h3>
              <p style={styles.todoText}>
                Files will be streamed and renamed at upload time. No local copies will be created.
              </p>

              <div style={styles.mappingSummaryPanel}>
                <div style={styles.mappingSummaryText}>Total files: {executionPlan.length}</div>
                <div style={styles.mappingSummaryText}>
                  Total size: {formatBytes(executionPlan.reduce((sum, item) => sum + item.sizeBytes, 0))}
                </div>
                <div style={styles.mappingSummaryText}>Slots: {executionPlanBySlot.length}</div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button
                  onClick={handleRunExecutionDryRun}
                  disabled={executionRunning || executionPlan.length === 0}
                  style={executionRunning || executionPlan.length === 0 ? styles.actionButtonDisabled : styles.actionButtonPrimary}
                >
                  {executionRunning ? 'Running Dry Run...' : 'Run Streaming Dry Run'}
                </button>
                <button
                  disabled={!executionValidation?.executionReady}
                  style={!executionValidation?.executionReady ? styles.actionButtonDisabled : styles.actionButtonSecondary}
                >
                  Upload Phase Disabled (Phase 6)
                </button>
              </div>

              {executionValidation && (
                <div style={executionValidation.executionReady ? styles.successBanner : styles.errorBanner}>
                  executionReady = {String(executionValidation.executionReady)} | allFilesReadable ={' '}
                  {String(executionValidation.allFilesReadable)} | noCriticalErrors = {String(executionValidation.noCriticalErrors)}
                </div>
              )}

              {executionValidation && executionValidation.errors.length > 0 && (
                <div style={styles.mappingSummaryPanel}>
                  <h4 style={styles.mappingSummaryTitle}>Execution Errors</h4>
                  {executionErrorsBySlot.map((slotGroup) => (
                    <div key={slotGroup.slotId} style={styles.executionErrorGroup}>
                      <div style={styles.executionSlotHeader}>{slotGroup.slotLabel}</div>
                      {slotGroup.errors.map((error) => (
                        <div key={`${error.slotId}-${error.sourcePath}`} style={styles.mappingWarning}>
                          {error.sourceFilename || error.sourcePath}: {error.errorType} - {error.message}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <div style={styles.mappingSummaryPanel}>
                <h4 style={styles.mappingSummaryTitle}>Execution Preview</h4>
                <div style={styles.renameGridHeader}>
                  <span>Slot</span>
                  <span>Source Filename</span>
                  <span>Planned Filename</span>
                </div>
                <div style={styles.renameGridBody}>
                  {executionPlanBySlot.map((slotGroup) => (
                    <div key={slotGroup.slotId} style={styles.executionSlotBlock}>
                      <div style={styles.executionSlotHeader}>
                        {slotGroup.slotLabel} · {slotGroup.items.length} files · {formatBytes(slotGroup.totalBytes)}
                      </div>
                      {slotGroup.items.map((item) => (
                        <div key={`${item.slotId}-${item.sourcePath}`} style={styles.renameGridRow}>
                          <span style={styles.mappingFileCell}>{item.slotLabel}</span>
                          <span style={styles.mappingFolderCell}>{item.sourceFilename}</span>
                          <span style={styles.renameOkCell}>{item.plannedName}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
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
  actionButtonDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#dc2626',
    color: 'white',
    cursor: 'pointer',
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
  mutedPanel: {
    marginTop: 16,
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: 12,
    color: '#94a3b8',
    fontSize: 13
  },
  mappingGridHeader: {
    marginTop: 16,
    display: 'grid',
    gridTemplateColumns: '2fr 1.3fr 1.4fr 120px',
    gap: 10,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 600,
    borderBottom: '1px solid #1e293b',
    paddingBottom: 8
  },
  mappingGridBody: {
    maxHeight: 320,
    overflowY: 'auto',
    display: 'grid',
    gap: 8,
    marginTop: 8
  },
  mappingGridRow: {
    display: 'grid',
    gridTemplateColumns: '2fr 1.3fr 1.4fr 120px',
    gap: 10,
    alignItems: 'center',
    borderBottom: '1px solid #1e293b',
    paddingBottom: 8
  },
  mappingFolderCell: {
    fontSize: 13,
    color: '#e2e8f0',
    wordBreak: 'break-word'
  },
  mappingFileCell: {
    fontSize: 12,
    color: '#94a3b8'
  },
  mappingSelect: {
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0f172a',
    color: 'white',
    fontSize: 12,
    padding: '8px 10px'
  },
  mappingCreateButton: {
    border: 'none',
    borderRadius: 8,
    background: '#2563eb',
    color: 'white',
    fontSize: 12,
    fontWeight: 600,
    padding: '8px 10px',
    cursor: 'pointer'
  },
  mappingSummaryPanel: {
    marginTop: 16,
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: 12,
    background: '#0f172a'
  },
  mappingSummaryTitle: {
    margin: 0,
    marginBottom: 8,
    fontSize: 15
  },
  mappingSummaryText: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 6
  },
  mappingSlotSummaryRow: {
    fontSize: 13,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    borderBottom: '1px solid #1e293b',
    padding: '6px 0'
  },
  mappingValidationPanel: {
    marginTop: 10,
    display: 'grid',
    gap: 6
  },
  mappingWarning: {
    fontSize: 12,
    color: '#fca5a5',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    borderRadius: 6,
    padding: '6px 8px'
  },
  namingGridHeader: {
    marginTop: 8,
    display: 'grid',
    gridTemplateColumns: '1.2fr 2fr 120px',
    gap: 10,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 600,
    borderBottom: '1px solid #1e293b',
    paddingBottom: 8
  },
  namingGridBody: {
    display: 'grid',
    gap: 8,
    marginTop: 8
  },
  namingGridRow: {
    display: 'grid',
    gridTemplateColumns: '1.2fr 2fr 120px',
    gap: 10,
    alignItems: 'center'
  },
  namingInput: {
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#020617',
    color: 'white',
    fontSize: 12,
    padding: '8px 10px'
  },
  namingPaddingInput: {
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#020617',
    color: 'white',
    fontSize: 12,
    padding: '8px 10px'
  },
  renameGridHeader: {
    marginTop: 8,
    display: 'grid',
    gridTemplateColumns: '1fr 1.5fr 1.8fr',
    gap: 10,
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 600,
    borderBottom: '1px solid #1e293b',
    paddingBottom: 8
  },
  renameGridBody: {
    display: 'grid',
    gap: 8,
    marginTop: 8,
    maxHeight: 360,
    overflowY: 'auto'
  },
  renameGridRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.5fr 1.8fr',
    gap: 10,
    alignItems: 'center',
    borderBottom: '1px solid #1e293b',
    paddingBottom: 8
  },
  renameOkCell: {
    fontSize: 12,
    color: '#6ee7b7'
  },
  renameDangerCell: {
    fontSize: 12,
    color: '#fca5a5'
  },
  executionSlotBlock: {
    border: '1px solid #1e293b',
    borderRadius: 8,
    padding: 8
  },
  executionSlotHeader: {
    fontSize: 12,
    fontWeight: 700,
    color: '#93c5fd',
    marginBottom: 8
  },
  executionErrorGroup: {
    display: 'grid',
    gap: 6,
    marginBottom: 10
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

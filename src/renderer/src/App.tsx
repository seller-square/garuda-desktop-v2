import { useEffect, useMemo, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { FolderOpen, Loader2, LogOut, Plus, RefreshCcw, Scan } from 'lucide-react'
import { LoginForm } from './components/LoginForm'
import { supabase } from './lib/supabase'

type ScannedFile = {
  name: string
  fullPath: string
  absolutePath: string
  filename: string
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
  root: string
  scannedAt: string
  totalFiles: number
  totalBytes: number
  totalSize: number
  folderGroups: FolderGroup[]
  folders: string[]
  files: ScannedFile[]
}

type SlotMappingSummary = {
  slotId: string
  slotLabel: string
  slotCode: string
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
  slotCode: string
  sourcePath: string
  sourceFilename: string
  oldFilename: string
  oldRelativePath: string
  plannedName: string
  plannedSequence: number
  plannedFilename: string
  sha256: string
  sizeBytes: number
  fileType: 'image' | 'video' | 'other'
}

type ExecutionPlanItem = {
  projectId: string
  sourcePath: string
  sourceFilename: string
  destinationFilename: string
  destinationPath: string
  slotId: string
  slotLabel: string
  slotCode: string
  assetKind: 'IMG' | 'VID' | 'OTHER'
  mimeType: string
  plannedSequence: number
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

type ExistingUploadRow = {
  id: string
  project_id: string
  slot_id: string | null
  sha256: string | null
  file_path: string | null
  file_size: number | null
  final_filename: string | null
  upload_stage: string | null
  completed_at: string | null
  is_source_file: boolean | null
}

type PreflightFileStatus = 'already_uploaded' | 'pending_upload' | 'missing_unreadable'
type SlotExecutionStatus = 'complete' | 'partial' | 'blocked'

type PreflightFileResult = {
  slotId: string
  slotLabel: string
  sourcePath: string
  sourceFilename: string
  sha256: string
  status: PreflightFileStatus
  reason: string | null
}

type PreflightSlotSummary = {
  slotId: string
  slotLabel: string
  totalFiles: number
  alreadyUploaded: number
  pendingUpload: number
  missingUnreadable: number
  status: SlotExecutionStatus
}

type ExecutionPreflight = {
  alreadyUploadedCount: number
  pendingUploadCount: number
  missingUnreadableCount: number
  slotSummaries: PreflightSlotSummary[]
  fileResults: PreflightFileResult[]
  hasPartialResume: boolean
}

type VerificationResultSummary = {
  checked: number
  valid: number
  invalid: number
  details: VerifyDestinationResultItem[]
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

type DashboardTab = 'scan' | 'plan' | 'execution'
type BucketCode = 'IMG' | 'VID' | 'AUD' | 'MUS' | 'TRN' | 'BTS'
type WizardStep = 1 | 2 | 3 | 4
type SlotStructureMode = 'flat' | 'subfolders'
type SlotSubfolderMode = 'auto' | 'custom'

type BucketWizardConfig = {
  structureMode: SlotStructureMode
  subfolderMode: SlotSubfolderMode
  autoPrefix: string
  autoCount: number
  includeUnsorted: boolean
  customNames: string
}

type SlotCreateInsertPlanItem = {
  bucket: BucketCode
  slotCode: string
  slotName: string
}

type SlotCreateAutoPlanItem = {
  bucket: BucketCode
  count: number
}

type SlotWizardReview = {
  insertItems: SlotCreateInsertPlanItem[]
  autoItems: SlotCreateAutoPlanItem[]
  errors: string[]
  previewByBucket: Array<{
    bucket: BucketCode
    insertItems: SlotCreateInsertPlanItem[]
    autoCount: number
  }>
}

const SLOT_LABEL_KEYS = ['slot_name', 'name', 'title', 'slot_code', 'code', 'label']
const SLOT_CODE_KEYS = ['slot_code', 'code', 'slot_name', 'name']
const SLOT_SEQUENCE_KEYS = [
  'next_sequence_number',
  'current_sequence_number',
  'current_sequence',
  'latest_sequence',
  'last_sequence_number',
  'sequence_counter'
]
const BUCKETS: Array<{ code: BucketCode; label: string }> = [
  { code: 'IMG', label: 'Images' },
  { code: 'VID', label: 'Videos' },
  { code: 'AUD', label: 'Audio' },
  { code: 'MUS', label: 'Music' },
  { code: 'TRN', label: 'Transcript' },
  { code: 'BTS', label: 'Behind the Scenes' }
]
const PRIMARY_BUCKETS: BucketCode[] = ['IMG', 'VID']
const SUPPORTING_BUCKETS: BucketCode[] = ['AUD', 'MUS', 'TRN', 'BTS']
const BUCKET_LABEL_BY_CODE: Record<BucketCode, string> = {
  IMG: 'Images',
  VID: 'Videos',
  AUD: 'Audio',
  MUS: 'Music',
  TRN: 'Transcript',
  BTS: 'Behind the Scenes'
}
const SLOT_CODE_PATTERN = /^[A-Za-z0-9_]+$/

const EMPTY_INGESTION_PLAN: IngestionPlan = {
  rootFolder: '',
  root: '',
  scannedAt: '',
  totalFiles: 0,
  totalBytes: 0,
  totalSize: 0,
  folderGroups: [],
  folders: [],
  files: []
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.dng',
  '.arw',
  '.cr2',
  '.cr3',
  '.nef',
  '.orf',
  '.rw2'
])
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.mxf',
  '.mts',
  '.m2ts',
  '.r3d',
  '.braw',
  '.prores',
  '.webm'
])

function detectFileType(extension: string): 'image' | 'video' | 'other' {
  const normalized = extension.toLowerCase()
  if (IMAGE_EXTENSIONS.has(normalized)) return 'image'
  if (VIDEO_EXTENSIONS.has(normalized)) return 'video'
  return 'other'
}

function normalizeIngestionPlan(plan: unknown): IngestionPlan {
  if (!plan || typeof plan !== 'object') {
    return EMPTY_INGESTION_PLAN
  }

  const record = plan as Record<string, unknown>
  const rawFiles = Array.isArray(record.files) ? (record.files as Array<Record<string, unknown>>) : []
  const normalizedFiles: ScannedFile[] = rawFiles
    .map((file) => {
      const relativePath = typeof file.relativePath === 'string' ? file.relativePath : ''
      const filename =
        typeof file.filename === 'string'
          ? file.filename
          : typeof file.name === 'string'
            ? file.name
            : relativePath
              ? pathBasename(relativePath)
              : ''
      const extension =
        typeof file.extension === 'string'
          ? file.extension
          : filename.includes('.')
            ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
            : ''
      const absolutePath =
        typeof file.absolutePath === 'string'
          ? file.absolutePath
          : typeof file.fullPath === 'string'
            ? file.fullPath
            : ''
      const parentRelativePath =
        typeof file.parentRelativePath === 'string'
          ? file.parentRelativePath
          : relativePath.includes('/')
            ? relativePath.split('/').slice(0, -1).join('/') || '/'
            : '/'
      const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0
      const fileType =
        file.fileType === 'image' || file.fileType === 'video' || file.fileType === 'other'
          ? file.fileType
          : detectFileType(extension)

      return {
        name: filename,
        filename,
        fullPath: absolutePath,
        absolutePath,
        relativePath,
        parentRelativePath,
        size,
        extension,
        fileType,
        sha256: typeof file.sha256 === 'string' ? file.sha256 : ''
      }
    })
    .filter((file) => file.relativePath && file.fullPath)

  const folderGroupsFromFiles = new Map<string, FolderGroup>()
  for (const file of normalizedFiles) {
    const key = file.parentRelativePath || '/'
    const existing = folderGroupsFromFiles.get(key)
    if (existing) {
      existing.fileCount += 1
      existing.totalBytes += file.size
      existing.typeCounts[file.fileType] += 1
      continue
    }

    folderGroupsFromFiles.set(key, {
      relativePath: key,
      fileCount: 1,
      totalBytes: file.size,
      typeCounts: {
        image: file.fileType === 'image' ? 1 : 0,
        video: file.fileType === 'video' ? 1 : 0,
        other: file.fileType === 'other' ? 1 : 0
      }
    })
  }

  const folderGroups = Array.from(folderGroupsFromFiles.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  const computedBytes = normalizedFiles.reduce((sum, file) => sum + file.size, 0)
  const folders = Array.isArray(record.folders)
    ? (record.folders as unknown[]).filter((folder): folder is string => typeof folder === 'string')
    : folderGroups.map((group) => group.relativePath)
  const rootFolder =
    typeof record.rootFolder === 'string'
      ? record.rootFolder
      : typeof record.root === 'string'
        ? record.root
        : ''

  return {
    rootFolder,
    root: rootFolder,
    scannedAt: typeof record.scannedAt === 'string' ? record.scannedAt : new Date().toISOString(),
    totalFiles:
      typeof record.totalFiles === 'number' && Number.isFinite(record.totalFiles) ? record.totalFiles : normalizedFiles.length,
    totalBytes:
      typeof record.totalBytes === 'number' && Number.isFinite(record.totalBytes)
        ? record.totalBytes
        : typeof record.totalSize === 'number' && Number.isFinite(record.totalSize)
          ? record.totalSize
          : computedBytes,
    totalSize:
      typeof record.totalSize === 'number' && Number.isFinite(record.totalSize)
        ? record.totalSize
        : typeof record.totalBytes === 'number' && Number.isFinite(record.totalBytes)
          ? record.totalBytes
          : computedBytes,
    folderGroups: Array.isArray(record.folderGroups) ? (record.folderGroups as FolderGroup[]) : folderGroups,
    folders,
    files: normalizedFiles
  }
}

function pathBasename(relativePath: string): string {
  const pieces = relativePath.split('/').filter(Boolean)
  return pieces[pieces.length - 1] ?? relativePath
}

function normalizeLocalPath(candidatePath: string): string {
  return candidatePath.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

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

function getSlotCode(slot: RowRecord): string {
  const value = pickFirstString(slot, SLOT_CODE_KEYS) ?? getSlotLabel(slot)
  return normalizeSlotCode(value) || 'SLOT'
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

function sanitizeSlotToken(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
}

function makeSlotCode(bucket: BucketCode, token?: string): string {
  if (!token) {
    return bucket
  }

  const cleanedToken = sanitizeSlotToken(token)
  return cleanedToken ? `${bucket}_${cleanedToken}` : bucket
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

function getMimeTypeFromExtension(extension: string): string {
  const ext = extension.toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.heic' || ext === '.heif') return 'image/heic'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.avi') return 'video/x-msvideo'
  if (ext === '.mxf') return 'application/mxf'
  return 'application/octet-stream'
}

function getFileExtensionFromName(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.')
  if (lastDotIndex < 0) {
    return ''
  }

  return filename.slice(lastDotIndex).toLowerCase()
}

function formatSupabaseError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = 'code' in error ? String(error.code) : null
    const message = 'message' in error ? String(error.message) : 'Supabase error'
    const details = 'details' in error && error.details ? String(error.details) : null
    const hint = 'hint' in error && error.hint ? String(error.hint) : null

    return [code ? `code=${code}` : null, message, details ? `details=${details}` : null, hint ? `hint=${hint}` : null]
      .filter(Boolean)
      .join(' | ')
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

async function insertProjectSlotsBulk(
  projectId: string,
  insertItems: SlotCreateInsertPlanItem[]
): Promise<RowRecord[]> {
  if (insertItems.length === 0) {
    return []
  }

  const rows = insertItems.map((item) => ({
    project_id: projectId,
    slot_code: item.slotCode,
    slot_name: item.slotName
  }))

  const { data, error } = await supabase.from('project_slots').insert(rows).select('*')
  if (error) {
    throw error
  }

  return (data ?? []) as RowRecord[]
}

async function extendSlotSeries(
  projectId: string,
  bucketCode: BucketCode,
  count: number
): Promise<RowRecord[]> {
  const { data, error } = await supabase.rpc('extend_slot_series', {
    p_project_id: projectId,
    p_bucket_code: bucketCode,
    p_count: count
  })

  if (error) {
    throw error
  }

  if (Array.isArray(data)) {
    return data as RowRecord[]
  }

  if (data && typeof data === 'object') {
    return [data as RowRecord]
  }

  return []
}

function App() {
  const defaultBucketConfig = (): BucketWizardConfig => ({
    structureMode: 'flat',
    subfolderMode: 'auto',
    autoPrefix: 'SKU',
    autoCount: 1,
    includeUnsorted: false,
    customNames: ''
  })

  const emptyBucketSelection = (): Record<BucketCode, boolean> => ({
    IMG: true,
    VID: true,
    AUD: true,
    MUS: true,
    TRN: true,
    BTS: true
  })

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
  const [slotActionMessage, setSlotActionMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [showSlotWizard, setShowSlotWizard] = useState(false)
  const [slotWizardStep, setSlotWizardStep] = useState<WizardStep>(1)
  const [bucketSelection, setBucketSelection] = useState<Record<BucketCode, boolean>>(emptyBucketSelection)
  const [imgBucketConfig, setImgBucketConfig] = useState<BucketWizardConfig>(defaultBucketConfig)
  const [vidBucketConfig, setVidBucketConfig] = useState<BucketWizardConfig>(defaultBucketConfig)
  const [vidMirrorImages, setVidMirrorImages] = useState(false)
  const [slotWizardLoading, setSlotWizardLoading] = useState(false)

  const [activeTab, setActiveTab] = useState<DashboardTab>('scan')

  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [destinationPath, setDestinationPath] = useState<string | null>(null)
  const [destinationPathWarning, setDestinationPathWarning] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult>({ success: true, plan: EMPTY_INGESTION_PLAN })
  const [scanHasRun, setScanHasRun] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [folderSlotAssignments, setFolderSlotAssignments] = useState<Record<string, string>>({})
  const [slotNamingOverrides, setSlotNamingOverrides] = useState<Record<string, SlotNamingOverride>>({})
  const [executionRunning, setExecutionRunning] = useState(false)
  const [executionValidation, setExecutionValidation] = useState<ExecutionValidation | null>(null)
  const [uploadRunning, setUploadRunning] = useState(false)
  const [uploadResultMessage, setUploadResultMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [existingUploads, setExistingUploads] = useState<ExistingUploadRow[]>([])
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [executionPreflight, setExecutionPreflight] = useState<ExecutionPreflight | null>(null)
  const [verificationRunning, setVerificationRunning] = useState(false)
  const [verificationSummary, setVerificationSummary] = useState<VerificationResultSummary | null>(null)
  const [resumeNotice, setResumeNotice] = useState<string | null>(null)
  const [autoPreflightDoneKey, setAutoPreflightDoneKey] = useState<string | null>(null)

  const selectedProject = useMemo(
    () => projects.find((project) => getId(project) === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const selectedSlot = useMemo(
    () => slots.find((slot) => getId(slot) === selectedSlotId) ?? null,
    [slots, selectedSlotId]
  )

  const selectedProjectDisplay = useMemo(() => {
    if (!selectedProject) {
      return 'No project selected'
    }

    const code = getProjectCode(selectedProject)
    const brand = getProjectBrandName(selectedProject)
    return `${code} — ${brand}`
  }, [selectedProject])

  const slotsConfigured = slots.length > 0

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

  const existingSlotCodes = useMemo(() => {
    const codes = new Set<string>()
    for (const slot of slots) {
      const code = getSlotCode(slot)
      if (code) {
        codes.add(code)
      }
    }
    return codes
  }, [slots])

  const slotWizardReview = useMemo<SlotWizardReview>(() => {
    const selectedBuckets = (Object.entries(bucketSelection) as Array<[BucketCode, boolean]>)
      .filter(([, checked]) => checked)
      .map(([bucket]) => bucket)

    const insertItems: SlotCreateInsertPlanItem[] = []
    const autoItems: SlotCreateAutoPlanItem[] = []
    const errors: string[] = []
    const plannedCodes = new Set<string>()

    const pushInsertItem = (bucket: BucketCode, slotCode: string, slotName: string) => {
      if (!SLOT_CODE_PATTERN.test(slotCode)) {
        errors.push(`Invalid slot code "${slotCode}". Allowed pattern is [A-Za-z0-9_]+.`)
        return
      }

      if (plannedCodes.has(slotCode)) {
        errors.push(`Duplicate planned slot code "${slotCode}".`)
        return
      }

      if (existingSlotCodes.has(slotCode)) {
        errors.push(`Slot code "${slotCode}" already exists in this project.`)
        return
      }

      plannedCodes.add(slotCode)
      insertItems.push({ bucket, slotCode, slotName })
    }

    for (const bucket of selectedBuckets) {
      if (bucket !== 'IMG' && bucket !== 'VID') {
        pushInsertItem(bucket, makeSlotCode(bucket), BUCKET_LABEL_BY_CODE[bucket])
        continue
      }

      const config = bucket === 'IMG' ? imgBucketConfig : vidMirrorImages ? imgBucketConfig : vidBucketConfig
      const shouldMirror = bucket === 'VID' && vidMirrorImages

      if (config.structureMode === 'flat') {
        pushInsertItem(bucket, makeSlotCode(bucket), BUCKET_LABEL_BY_CODE[bucket])
        continue
      }

      if (config.subfolderMode === 'auto') {
        const count = Math.max(1, Number(config.autoCount))
        autoItems.push({ bucket, count })

        if (config.includeUnsorted) {
          pushInsertItem(bucket, makeSlotCode(bucket, 'UNSORTED'), `${BUCKET_LABEL_BY_CODE[bucket]} UNSORTED`)
        }
        continue
      }

      const names = config.customNames
        .split(/[\n,]+/)
        .map((name) => sanitizeSlotToken(name))
        .filter(Boolean)

      if (names.length === 0) {
        errors.push(`${bucket} custom subfolders are empty.`)
        continue
      }

      for (const token of names) {
        const slotCode = makeSlotCode(bucket, token)
        const slotName = `${BUCKET_LABEL_BY_CODE[bucket]} ${token}`
        pushInsertItem(bucket, slotCode, slotName)
      }

      if (config.includeUnsorted) {
        pushInsertItem(bucket, makeSlotCode(bucket, 'UNSORTED'), `${BUCKET_LABEL_BY_CODE[bucket]} UNSORTED`)
      }

      if (shouldMirror && bucket === 'VID') {
        // no-op marker: VID uses IMG config in mirror mode.
      }
    }

    if (selectedBuckets.length === 0) {
      errors.push('Select at least one bucket.')
    }

    const previewByBucket = (BUCKETS.map((bucket) => {
      const bucketInsertItems = insertItems.filter((item) => item.bucket === bucket.code)
      const bucketAutoCount = autoItems
        .filter((item) => item.bucket === bucket.code)
        .reduce((sum, item) => sum + item.count, 0)
      return {
        bucket: bucket.code,
        insertItems: bucketInsertItems,
        autoCount: bucketAutoCount
      }
    }) as SlotWizardReview['previewByBucket']).filter((entry) => entry.insertItems.length > 0 || entry.autoCount > 0)

    return {
      insertItems,
      autoItems,
      errors,
      previewByBucket
    }
  }, [bucketSelection, existingSlotCodes, imgBucketConfig, vidBucketConfig, vidMirrorImages])

  const selectedWizardBuckets = useMemo(
    () =>
      (Object.entries(bucketSelection) as Array<[BucketCode, boolean]>)
        .filter(([, selected]) => selected)
        .map(([bucket]) => bucket),
    [bucketSelection]
  )

  const slotWizardCreateCount = useMemo(
    () => slotWizardReview.insertItems.length + slotWizardReview.autoItems.reduce((sum, item) => sum + item.count, 0),
    [slotWizardReview]
  )

  const mappingPlan = useMemo<MappingPlan | null>(() => {
    if (!scanResult.success) {
      return null
    }

    const safePlan = normalizeIngestionPlan(scanResult.plan)
    const folderToFiles = new Map<string, ScannedFile[]>()
    for (const file of safePlan.files) {
      const existing = folderToFiles.get(file.parentRelativePath)
      if (existing) {
        existing.push(file)
      } else {
        folderToFiles.set(file.parentRelativePath, [file])
      }
    }

    const slotSummariesMap = new Map<string, SlotMappingSummary>()

    for (const group of safePlan.folderGroups) {
      const slotId = folderSlotAssignments[group.relativePath]
      if (!slotId) continue

      const slot = slotById.get(slotId)
      if (!slot) continue

      const slotLabel = getSlotLabel(slot)
      const slotCode = getSlotCode(slot)
      const filesForFolder = folderToFiles.get(group.relativePath) ?? []

      const current = slotSummariesMap.get(slotId)
      if (!current) {
        slotSummariesMap.set(slotId, {
          slotId,
          slotLabel,
          slotCode,
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
      safePlan.folderGroups.some((group) => group.relativePath === folder)
    ).length
    const unmappedFolders = safePlan.folderGroups
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
          slotCode: summary.slotCode,
          sourcePath: file.fullPath,
          sourceFilename: file.name,
          oldFilename: file.name,
          oldRelativePath: file.relativePath,
          plannedName,
          plannedSequence,
          plannedFilename,
          sha256: file.sha256,
          sizeBytes: file.size,
          fileType: file.fileType
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
      totalFolderCount: safePlan.folderGroups.length,
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
      projectId: selectedProject.id,
      sourcePath: item.sourcePath,
      sourceFilename: item.sourceFilename,
      destinationFilename: item.plannedFilename,
      destinationPath: `local://${projectCode}/source/${item.fileType === 'image' ? 'IMG' : item.fileType === 'video' ? 'VID' : 'OTHER'}/${item.slotCode}/${item.plannedFilename}`,
      slotId: item.slotId,
      slotLabel: item.slotLabel,
      slotCode: item.slotCode,
      assetKind: item.fileType === 'image' ? 'IMG' : item.fileType === 'video' ? 'VID' : 'OTHER',
      mimeType: getMimeTypeFromExtension(getFileExtensionFromName(item.sourceFilename)),
      plannedSequence: item.plannedSequence,
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

  const resetSlotWizard = () => {
    setSlotWizardStep(1)
    setBucketSelection(emptyBucketSelection())
    setImgBucketConfig(defaultBucketConfig())
    setVidBucketConfig(defaultBucketConfig())
    setVidMirrorImages(false)
    setSlotWizardLoading(false)
  }

  const openSlotWizard = () => {
    resetSlotWizard()
    setSlotActionMessage(null)
    setShowSlotWizard(true)
  }

  const handleCreateSlotsFromWizard = async () => {
    if (!selectedProjectId) return

    if (slotWizardReview.errors.length > 0) {
      setSlotActionMessage({
        kind: 'error',
        text: slotWizardReview.errors.join(' ')
      })
      return
    }

    setSlotWizardLoading(true)
    setSlotsError(null)
    setSlotActionMessage(null)

    try {
      let createdRows: RowRecord[] = []

      if (slotWizardReview.insertItems.length > 0) {
        const inserted = await insertProjectSlotsBulk(selectedProjectId, slotWizardReview.insertItems)
        createdRows = createdRows.concat(inserted)
      }

      for (const autoItem of slotWizardReview.autoItems) {
        const extended = await extendSlotSeries(selectedProjectId, autoItem.bucket, autoItem.count)
        createdRows = createdRows.concat(extended)
      }

      await loadSlots(selectedProjectId, { keepSelection: true })
      const createdCount = slotWizardReview.insertItems.length + slotWizardReview.autoItems.reduce((sum, item) => sum + item.count, 0)
      setSlotActionMessage({
        kind: 'success',
        text: `Created/extended ${createdCount} slot(s).`
      })

      if (createdRows.length > 0) {
        setSelectedSlotId(getId(createdRows[0]))
      }

      setShowSlotWizard(false)
      resetSlotWizard()
    } catch (error: unknown) {
      const formattedError = formatSupabaseError(error)
      setSlotsError(formattedError)
      setSlotActionMessage({
        kind: 'error',
        text: `Unable to create slots. ${formattedError}`
      })
    } finally {
      setSlotWizardLoading(false)
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
  }, [session])

  useEffect(() => {
    if (activeTab !== 'execution') return
    if (!selectedProject || executionPlan.length === 0) return

    const key = `${selectedProject.id}:${executionPlan.length}`
    if (autoPreflightDoneKey === key) {
      return
    }

    setAutoPreflightDoneKey(key)
    handleRunExecutionPreflight().catch((error: unknown) => {
      setUploadResultMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to auto-run execution preflight.'
      })
    })
  }, [activeTab, autoPreflightDoneKey, executionPlan.length, selectedProject])

  useEffect(() => {
    if (!selectedProjectId) {
      setShowSlotWizard(false)
      resetSlotWizard()
      setSlotActionMessage(null)
      setFolderPath(null)
      setDestinationPath(null)
      setDestinationPathWarning(null)
      setScanResult({ success: true, plan: EMPTY_INGESTION_PLAN })
      setScanHasRun(false)
      setSlots([])
      setSelectedSlotId(null)
      setFolderSlotAssignments({})
      setSlotNamingOverrides({})
      setExecutionValidation(null)
      setUploadResultMessage(null)
      setExistingUploads([])
      setExecutionPreflight(null)
      setVerificationSummary(null)
      setResumeNotice(null)
      setAutoPreflightDoneKey(null)
      return
    }

    setShowSlotWizard(false)
    resetSlotWizard()
    setSlotActionMessage(null)
    setFolderPath(null)
    setDestinationPath(null)
    setDestinationPathWarning(null)
    setScanResult({ success: true, plan: EMPTY_INGESTION_PLAN })
    setScanHasRun(false)
    loadSlots(selectedProjectId).catch((error: unknown) => {
      setSlotsError(error instanceof Error ? error.message : 'Unknown error while fetching project slots')
    })
  }, [selectedProjectId])

  const handleSelectFolder = async () => {
    const path = await window.api.selectFolder()
    setFolderPath(path)
    setDestinationPath(null)
    setDestinationPathWarning(null)
    setScanResult({ success: true, plan: EMPTY_INGESTION_PLAN })
    setScanHasRun(false)
    setFolderSlotAssignments({})
    setSlotNamingOverrides({})
    setExecutionValidation(null)
    setUploadResultMessage(null)
    setExistingUploads([])
    setExecutionPreflight(null)
    setVerificationSummary(null)
    setResumeNotice(null)
    setAutoPreflightDoneKey(null)
  }

  const handleScan = async () => {
    if (!folderPath) return
    setScanning(true)
    setDestinationPath(null)
    setDestinationPathWarning(null)
    setScanResult({ success: true, plan: EMPTY_INGESTION_PLAN })
    setScanHasRun(false)
    setFolderSlotAssignments({})
    setSlotNamingOverrides({})
    setExecutionValidation(null)
    setUploadResultMessage(null)
    setExistingUploads([])
    setExecutionPreflight(null)
    setVerificationSummary(null)
    setResumeNotice(null)
    setAutoPreflightDoneKey(null)
    try {
      const result = await window.api.scanFolder(folderPath)
      if (result && typeof result === 'object' && 'success' in result) {
        if (result.success) {
          const normalizedPlan = normalizeIngestionPlan(result.plan)
          setScanResult({
            success: true,
            plan: normalizedPlan
          })

          const selectedDestination = await window.api.selectFolder()
          if (selectedDestination) {
            if (normalizeLocalPath(folderPath) === normalizeLocalPath(selectedDestination)) {
              setDestinationPath(null)
              setDestinationPathWarning('Source and destination folders cannot be the same path.')
            } else {
              setDestinationPath(selectedDestination)
            }
          } else {
            setDestinationPathWarning('Destination folder not selected yet.')
          }
        } else {
          setScanResult({
            success: false,
            error: typeof result.error === 'string' ? result.error : 'Scan failed.'
          })
        }
      } else {
        setScanResult({
          success: false,
          error: 'Scan failed: invalid response.'
        })
      }
      setScanHasRun(true)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Scan failed.'
      setScanResult({
        success: false,
        error: message
      })
      setScanHasRun(true)
    } finally {
      setScanning(false)
    }
  }

  const handleCancelScan = async () => {
    try {
      await window.api.cancelScanFolder()
    } catch (error: unknown) {
      setScanResult({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel scan.'
      })
      setScanHasRun(true)
    } finally {
      setScanning(false)
    }
  }

  const handleAssignFolderToSlot = (folderRelativePath: string, slotId: string) => {
    setExecutionValidation(null)
    setUploadResultMessage(null)
    setExecutionPreflight(null)
    setVerificationSummary(null)
    setResumeNotice(null)
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
    setUploadResultMessage(null)
    setExecutionPreflight(null)
    setVerificationSummary(null)
    setResumeNotice(null)
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
    setUploadResultMessage(null)
    setExecutionPreflight(null)
    setVerificationSummary(null)
    setResumeNotice(null)
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

  const loadExistingUploadsForProject = async (projectId: string): Promise<ExistingUploadRow[]> => {
    const { data, error } = await supabase
      .from('project_uploads')
      .select('id,project_id,slot_id,sha256,file_path,file_size,final_filename,upload_stage,completed_at,is_source_file')
      .eq('project_id', projectId)
      .eq('is_source_file', true)
      .eq('upload_stage', 'completed')

    if (error) {
      throw error
    }

    return (data ?? []) as ExistingUploadRow[]
  }

  const handleRunExecutionPreflight = async () => {
    if (!selectedProject || executionPlan.length === 0) {
      setExecutionPreflight(null)
      setResumeNotice(null)
      return
    }

    setPreflightLoading(true)
    setResumeNotice(null)

    try {
      const uploads = await loadExistingUploadsForProject(selectedProject.id)
      setExistingUploads(uploads)

      const uploadedHashes = new Set<string>()
      for (const row of uploads) {
        if (row.sha256) {
          uploadedHashes.add(row.sha256)
        }
      }

      const dryRun = await window.api.dryRunStreamOpen(
        executionPlan.map((item) => ({
          sourcePath: item.sourcePath,
          expectedSizeBytes: item.sizeBytes
        }))
      )
      const dryRunByPath = new Map<string, DryRunFileResult>()
      for (const result of dryRun.results) {
        dryRunByPath.set(result.sourcePath, result)
      }

      const fileResults: PreflightFileResult[] = executionPlan.map((item) => {
        if (uploadedHashes.has(item.sha256)) {
          return {
            slotId: item.slotId,
            slotLabel: item.slotLabel,
            sourcePath: item.sourcePath,
            sourceFilename: item.sourceFilename,
            sha256: item.sha256,
            status: 'already_uploaded',
            reason: 'Found in completed uploads by sha256.'
          }
        }

        const localCheck = dryRunByPath.get(item.sourcePath)
        if (!localCheck || !localCheck.ok) {
          return {
            slotId: item.slotId,
            slotLabel: item.slotLabel,
            sourcePath: item.sourcePath,
            sourceFilename: item.sourceFilename,
            sha256: item.sha256,
            status: 'missing_unreadable',
            reason: localCheck?.message ?? 'File is missing or unreadable.'
          }
        }

        return {
          slotId: item.slotId,
          slotLabel: item.slotLabel,
          sourcePath: item.sourcePath,
          sourceFilename: item.sourceFilename,
          sha256: item.sha256,
          status: 'pending_upload',
          reason: null
        }
      })

      const slotMap = new Map<string, PreflightSlotSummary>()
      for (const file of fileResults) {
        const existing = slotMap.get(file.slotId)
        if (!existing) {
          slotMap.set(file.slotId, {
            slotId: file.slotId,
            slotLabel: file.slotLabel,
            totalFiles: 1,
            alreadyUploaded: file.status === 'already_uploaded' ? 1 : 0,
            pendingUpload: file.status === 'pending_upload' ? 1 : 0,
            missingUnreadable: file.status === 'missing_unreadable' ? 1 : 0,
            status: 'partial'
          })
        } else {
          existing.totalFiles += 1
          if (file.status === 'already_uploaded') existing.alreadyUploaded += 1
          if (file.status === 'pending_upload') existing.pendingUpload += 1
          if (file.status === 'missing_unreadable') existing.missingUnreadable += 1
        }
      }

      const slotSummaries = Array.from(slotMap.values())
        .map((slot) => {
          if (slot.missingUnreadable > 0) {
            slot.status = 'blocked'
          } else if (slot.alreadyUploaded === slot.totalFiles) {
            slot.status = 'complete'
          } else {
            slot.status = 'partial'
          }
          return slot
        })
        .sort((a, b) => a.slotLabel.localeCompare(b.slotLabel))

      const alreadyUploadedCount = fileResults.filter((item) => item.status === 'already_uploaded').length
      const pendingUploadCount = fileResults.filter((item) => item.status === 'pending_upload').length
      const missingUnreadableCount = fileResults.filter((item) => item.status === 'missing_unreadable').length
      const hasPartialResume = alreadyUploadedCount > 0 && pendingUploadCount > 0

      setExecutionPreflight({
        alreadyUploadedCount,
        pendingUploadCount,
        missingUnreadableCount,
        slotSummaries,
        fileResults,
        hasPartialResume
      })

      if (hasPartialResume) {
        setResumeNotice('This project has partially ingested files. Resume is safe: only pending files will be uploaded.')
      }
    } catch (error: unknown) {
      setUploadResultMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to run preflight.'
      })
    } finally {
      setPreflightLoading(false)
    }
  }

  const handleRunVerification = async () => {
    if (!selectedProject) {
      return
    }

    setVerificationRunning(true)
    setVerificationSummary(null)

    try {
      const uploads = await loadExistingUploadsForProject(selectedProject.id)
      setExistingUploads(uploads)

      const verifyItems: VerifyDestinationRequestItem[] = uploads.map((row) => ({
        filePath: row.file_path ?? '',
        expectedSizeBytes: row.file_size ?? null,
        expectedFilename: row.final_filename ?? null
      }))

      const response = await window.api.verifyDestinationPaths(verifyItems)
      const valid = response.results.filter((item) => item.exists && item.filenameMatches && item.sizeMatches).length
      const invalid = response.results.length - valid

      setVerificationSummary({
        checked: response.results.length,
        valid,
        invalid,
        details: response.results
      })
    } catch (error: unknown) {
      setUploadResultMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Verification failed.'
      })
    } finally {
      setVerificationRunning(false)
    }
  }

  const handleExecuteUpload = async () => {
    if (!executionValidation?.executionReady || executionPlan.length === 0 || !selectedProject || !session) {
      return
    }

    if (!executionPreflight) {
      setUploadResultMessage({
        kind: 'error',
        text: 'Run execution preflight before streaming.'
      })
      return
    }

    if (executionPreflight.missingUnreadableCount > 0) {
      setUploadResultMessage({
        kind: 'error',
        text: 'Execution is blocked: one or more source files are missing or unreadable.'
      })
      return
    }

    setUploadRunning(true)
    setUploadResultMessage(null)

    try {
      const projectCode = selectedProject.project_code?.trim() || 'PROJECT'
      const pendingShaSet = new Set(
        executionPreflight.fileResults.filter((row) => row.status === 'pending_upload').map((row) => row.sha256)
      )
      const pendingItems = executionPlan.filter((item) => pendingShaSet.has(item.sha256))
      const response = await window.api.executeFilesystemStreamPlan({
        accessToken: session.access_token,
        items: pendingItems.map((item) => ({
          projectId: item.projectId,
          slotId: item.slotId,
          sourcePath: item.sourcePath,
          sourceFilename: item.sourceFilename,
          destinationFilename: item.destinationFilename,
          destinationPath: item.destinationPath,
          plannedSequence: item.plannedSequence,
          sha256: item.sha256,
          sizeBytes: item.sizeBytes,
          projectCode,
          slotCode: item.slotCode,
          assetKind: item.assetKind,
          mimeType: item.mimeType
        }))
      })

      if (response.success) {
        setUploadResultMessage({
          kind: 'success',
          text: `Uploaded ${response.uploadedCount} · skipped ${response.skippedCount} · failed ${response.failedCount}`
        })
        await handleRunExecutionPreflight()
        return
      }

      setUploadResultMessage({
        kind: 'error',
        text: `Uploaded ${response.uploadedCount} · skipped ${response.skippedCount} · failed ${response.failedCount}. Stopped on ${response.failedItem.destinationFilename}: ${response.error}`
      })
      await handleRunExecutionPreflight()
    } catch (error: unknown) {
      setUploadResultMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Filesystem stream execution failed.'
      })
    } finally {
      setUploadRunning(false)
    }
  }

  const handleSelectDestinationFolder = async () => {
    const selectedPath = await window.api.selectFolder()
    if (!selectedPath) return

    setDestinationPath(selectedPath)
    if (folderPath && normalizeLocalPath(folderPath) === normalizeLocalPath(selectedPath)) {
      setDestinationPath(null)
      setDestinationPathWarning('Source and destination folders cannot be the same path.')
      return
    }

    setDestinationPathWarning(null)
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
          </div>

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
                const slotCode = getSlotCode(slot)
                const slotLabel = getSlotLabel(slot)

                return (
                  <button
                    key={id}
                    style={selected ? styles.slotRowSelected : styles.slotRow}
                    onClick={() => setSelectedSlotId(id)}
                  >
                    <span style={styles.projectTitle}>{slotCode}</span>
                    <span style={styles.projectSub}>
                      {slotLabel}
                      {sequence !== null ? ` · Current sequence: ${sequence}` : ''}
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

        {selectedProjectId && slotsConfigured && !showSlotWizard && (
          <div style={styles.slotWizardLaunchRow}>
            <button onClick={openSlotWizard} disabled={slotWizardLoading} style={styles.actionButtonSecondary}>
              <Plus size={14} /> Add More Slots
            </button>
          </div>
        )}

        {!showSlotWizard && selectedProjectId && slotsConfigured && (
          <div style={styles.tabBar}>
            {(['scan', 'plan', 'execution'] as DashboardTab[]).map((tab) => (
              <button
                key={tab}
                style={activeTab === tab ? styles.tabButtonActive : styles.tabButton}
                onClick={() => setActiveTab(tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}

        <section style={styles.panel}>
          {slotActionMessage && (
            <div style={slotActionMessage.kind === 'error' ? styles.errorBannerCompact : styles.successBannerCompact}>
              {slotActionMessage.text}
            </div>
          )}

          {!selectedProjectId && <div style={styles.mutedPanel}>Select a project to begin.</div>}

          {selectedProjectId && slotsLoading && <div style={styles.mutedPanel}>Loading slots...</div>}

          {selectedProjectId && !slotsLoading && !slotsConfigured && !showSlotWizard && (
            <div style={styles.projectSetupEmptyState}>
              <div style={styles.projectSetupIcon}>+</div>
              <h3 style={styles.projectSetupTitle}>Set up ingestion slots</h3>
              <p style={styles.projectSetupText}>
                Configure slot categories for <strong>{selectedProjectDisplay}</strong> before scanning folders.
              </p>
              <button onClick={openSlotWizard} style={styles.setupPrimaryButton}>
                <Plus size={14} /> Set Up Slots
              </button>
            </div>
          )}

          {selectedProjectId && showSlotWizard && (
            <div style={styles.slotWizardPanel}>
              <h3 style={styles.slotWizardHeader}>Set Up Ingestion Slots</h3>
              <p style={styles.slotWizardProjectLine}>Project: {selectedProjectDisplay}</p>
              <p style={styles.slotDialogText}>
                Step {slotWizardStep} of 4. Build deterministic slot codes before ingestion.
              </p>

              {slotWizardStep === 1 && (
                <div style={styles.wizardSection}>
                  <div style={styles.wizardSectionTitle}>Overview</div>
                  <div style={styles.slotSetupText}>
                    This wizard creates project slots only. No scanning, renaming, copy, or upload runs here.
                  </div>
                  <div style={styles.slotSetupText}>
                    Creation paths mirror Garuda Web: flat/custom inserts + `extend_slot_series` for auto sequences.
                  </div>
                </div>
              )}

              {slotWizardStep === 2 && (
                <div style={styles.wizardSection}>
                  <div style={styles.wizardSectionTitle}>Select Slot Categories</div>

                  <div style={styles.wizardBucketGroupTitle}>Primary</div>
                  <div style={styles.bucketGrid}>
                    {PRIMARY_BUCKETS.map((bucketCode) => {
                      const bucket = BUCKETS.find((entry) => entry.code === bucketCode)
                      if (!bucket) return null

                      return (
                        <label key={bucket.code} style={styles.bucketOption}>
                          <input
                            type="checkbox"
                            checked={bucketSelection[bucket.code]}
                            onChange={(event) =>
                              setBucketSelection((current) => ({
                                ...current,
                                [bucket.code]: event.target.checked
                              }))
                            }
                          />
                          <span>{bucket.code}</span>
                          <span style={styles.projectSub}>{bucket.label}</span>
                        </label>
                      )
                    })}
                  </div>

                  <div style={styles.wizardBucketGroupTitle}>Supporting</div>
                  <div style={styles.bucketGrid}>
                    {SUPPORTING_BUCKETS.map((bucketCode) => {
                      const bucket = BUCKETS.find((entry) => entry.code === bucketCode)
                      if (!bucket) return null

                      return (
                        <label key={bucket.code} style={styles.bucketOption}>
                          <input
                            type="checkbox"
                            checked={bucketSelection[bucket.code]}
                            onChange={(event) =>
                              setBucketSelection((current) => ({
                                ...current,
                                [bucket.code]: event.target.checked
                              }))
                            }
                          />
                          <span>{bucket.code}</span>
                          <span style={styles.projectSub}>{bucket.label}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {slotWizardStep === 3 && (
                <div style={styles.wizardSection}>
                  {selectedWizardBuckets.includes('IMG') && (
                    <div style={styles.wizardBucketPanel}>
                      <div style={styles.wizardSectionTitle}>IMG configuration</div>
                      <label style={styles.settingsLabel}>Structure</label>
                      <select
                        value={imgBucketConfig.structureMode}
                        onChange={(event) =>
                          setImgBucketConfig((current) => ({
                            ...current,
                            structureMode: event.target.value as SlotStructureMode
                          }))
                        }
                        style={styles.mappingSelect}
                      >
                        <option value="flat">Flat (single IMG slot)</option>
                        <option value="subfolders">With subfolders</option>
                      </select>

                      {imgBucketConfig.structureMode === 'subfolders' && (
                        <>
                          <label style={styles.settingsLabel}>Subfolder mode</label>
                          <select
                            value={imgBucketConfig.subfolderMode}
                            onChange={(event) =>
                              setImgBucketConfig((current) => ({
                                ...current,
                                subfolderMode: event.target.value as SlotSubfolderMode
                              }))
                            }
                            style={styles.mappingSelect}
                          >
                            <option value="auto">Auto-generate series</option>
                            <option value="custom">Custom names</option>
                          </select>

                          {imgBucketConfig.subfolderMode === 'auto' ? (
                            <>
                              <label style={styles.settingsLabel}>Prefix label</label>
                              <input
                                value={imgBucketConfig.autoPrefix}
                                onChange={(event) =>
                                  setImgBucketConfig((current) => ({
                                    ...current,
                                    autoPrefix: event.target.value
                                  }))
                                }
                                placeholder="SKU"
                                style={styles.createInput}
                              />
                              <label style={styles.settingsLabel}>Count</label>
                              <input
                                type="number"
                                min={1}
                                value={imgBucketConfig.autoCount}
                                onChange={(event) =>
                                  setImgBucketConfig((current) => ({
                                    ...current,
                                    autoCount: Math.max(1, Number.parseInt(event.target.value, 10) || 1)
                                  }))
                                }
                                style={styles.createInput}
                              />
                            </>
                          ) : (
                            <>
                              <label style={styles.settingsLabel}>Custom names (comma/newline)</label>
                              <textarea
                                value={imgBucketConfig.customNames}
                                onChange={(event) =>
                                  setImgBucketConfig((current) => ({
                                    ...current,
                                    customNames: event.target.value
                                  }))
                                }
                                placeholder="SKU01, SKU02"
                                style={styles.wizardTextarea}
                              />
                            </>
                          )}

                          <label style={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={imgBucketConfig.includeUnsorted}
                              onChange={(event) =>
                                setImgBucketConfig((current) => ({
                                  ...current,
                                  includeUnsorted: event.target.checked
                                }))
                              }
                            />
                            <span>Create IMG_UNSORTED</span>
                          </label>
                        </>
                      )}
                    </div>
                  )}

                  {selectedWizardBuckets.includes('VID') && (
                    <div style={styles.wizardBucketPanel}>
                      <div style={styles.wizardSectionTitle}>VID configuration</div>
                      <label style={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={vidMirrorImages}
                          onChange={(event) => setVidMirrorImages(event.target.checked)}
                          disabled={!selectedWizardBuckets.includes('IMG')}
                        />
                        <span>Mirror Images configuration</span>
                      </label>

                      {!vidMirrorImages && (
                        <>
                          <label style={styles.settingsLabel}>Structure</label>
                          <select
                            value={vidBucketConfig.structureMode}
                            onChange={(event) =>
                              setVidBucketConfig((current) => ({
                                ...current,
                                structureMode: event.target.value as SlotStructureMode
                              }))
                            }
                            style={styles.mappingSelect}
                          >
                            <option value="flat">Flat (single VID slot)</option>
                            <option value="subfolders">With subfolders</option>
                          </select>

                          {vidBucketConfig.structureMode === 'subfolders' && (
                            <>
                              <label style={styles.settingsLabel}>Subfolder mode</label>
                              <select
                                value={vidBucketConfig.subfolderMode}
                                onChange={(event) =>
                                  setVidBucketConfig((current) => ({
                                    ...current,
                                    subfolderMode: event.target.value as SlotSubfolderMode
                                  }))
                                }
                                style={styles.mappingSelect}
                              >
                                <option value="auto">Auto-generate series</option>
                                <option value="custom">Custom names</option>
                              </select>

                              {vidBucketConfig.subfolderMode === 'auto' ? (
                                <>
                                  <label style={styles.settingsLabel}>Prefix label</label>
                                  <input
                                    value={vidBucketConfig.autoPrefix}
                                    onChange={(event) =>
                                      setVidBucketConfig((current) => ({
                                        ...current,
                                        autoPrefix: event.target.value
                                      }))
                                    }
                                    placeholder="SKU"
                                    style={styles.createInput}
                                  />
                                  <label style={styles.settingsLabel}>Count</label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={vidBucketConfig.autoCount}
                                    onChange={(event) =>
                                      setVidBucketConfig((current) => ({
                                        ...current,
                                        autoCount: Math.max(1, Number.parseInt(event.target.value, 10) || 1)
                                      }))
                                    }
                                    style={styles.createInput}
                                  />
                                </>
                              ) : (
                                <>
                                  <label style={styles.settingsLabel}>Custom names (comma/newline)</label>
                                  <textarea
                                    value={vidBucketConfig.customNames}
                                    onChange={(event) =>
                                      setVidBucketConfig((current) => ({
                                        ...current,
                                        customNames: event.target.value
                                      }))
                                    }
                                    placeholder="SKU01, SKU02"
                                    style={styles.wizardTextarea}
                                  />
                                </>
                              )}

                              <label style={styles.checkboxRow}>
                                <input
                                  type="checkbox"
                                  checked={vidBucketConfig.includeUnsorted}
                                  onChange={(event) =>
                                    setVidBucketConfig((current) => ({
                                      ...current,
                                      includeUnsorted: event.target.checked
                                    }))
                                  }
                                />
                                <span>Create VID_UNSORTED</span>
                              </label>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {selectedWizardBuckets.filter((bucket) => !PRIMARY_BUCKETS.includes(bucket)).length > 0 && (
                    <div style={styles.wizardBucketPanel}>
                      <div style={styles.wizardSectionTitle}>Supporting buckets</div>
                      <div style={styles.slotDialogText}>
                        {selectedWizardBuckets
                          .filter((bucket) => !PRIMARY_BUCKETS.includes(bucket))
                          .map((bucket) => `${bucket} (${BUCKET_LABEL_BY_CODE[bucket]})`)
                          .join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {slotWizardStep === 4 && (
                <div style={styles.wizardSection}>
                  <div style={styles.wizardSectionTitle}>Review & Confirm</div>
                  <div style={styles.slotDialogText}>Deterministic slot code plan for {selectedProjectDisplay}</div>
                  {slotWizardReview.previewByBucket.map((entry) => (
                    <div key={entry.bucket} style={styles.wizardBucketPanel}>
                      <div style={styles.projectTitle}>
                        {entry.bucket} · {BUCKET_LABEL_BY_CODE[entry.bucket]}
                      </div>
                      {entry.autoCount > 0 && (
                        <div style={styles.projectSub}>
                          Auto series: +{entry.autoCount} via `extend_slot_series` (continues bucket sequence deterministically)
                        </div>
                      )}
                      {entry.insertItems.map((item) => (
                        <div key={item.slotCode} style={styles.projectSub}>
                          {item.slotCode} ({item.slotName})
                        </div>
                      ))}
                    </div>
                  ))}

                  {slotWizardReview.errors.length > 0 && (
                    <div style={styles.errorBannerCompact}>
                      {slotWizardReview.errors.map((error) => (
                        <div key={error}>{error}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={styles.slotDialogActions}>
                <button
                  onClick={() => {
                    setShowSlotWizard(false)
                    resetSlotWizard()
                    setSlotActionMessage(null)
                  }}
                  disabled={slotWizardLoading}
                  style={styles.actionButtonSecondary}
                >
                  Cancel
                </button>
                <button
                  onClick={() => setSlotWizardStep((current) => Math.max(1, current - 1) as WizardStep)}
                  disabled={slotWizardLoading || slotWizardStep === 1}
                  style={styles.actionButtonSecondary}
                >
                  Back
                </button>
                {slotWizardStep < 4 ? (
                  <button
                    onClick={() => {
                      if (slotWizardStep === 2 && selectedWizardBuckets.length === 0) {
                        setSlotActionMessage({ kind: 'error', text: 'Select at least one bucket.' })
                        return
                      }
                      setSlotActionMessage(null)
                      setSlotWizardStep((current) => Math.min(4, current + 1) as WizardStep)
                    }}
                    disabled={slotWizardLoading}
                    style={styles.actionButtonPrimary}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={handleCreateSlotsFromWizard}
                    disabled={slotWizardLoading || slotWizardCreateCount === 0 || slotWizardReview.errors.length > 0}
                    style={
                      slotWizardLoading || slotWizardCreateCount === 0 || slotWizardReview.errors.length > 0
                        ? styles.actionButtonDisabled
                        : styles.actionButtonPrimary
                    }
                  >
                    {slotWizardLoading ? 'Creating...' : `Create ${slotWizardCreateCount} Slots`}
                  </button>
                )}
              </div>
            </div>
          )}

          {selectedProjectId && slotsConfigured && !showSlotWizard && activeTab === 'scan' && (
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
              {destinationPath && <div style={styles.pathText}>Destination: {destinationPath}</div>}
              {!destinationPath && scanHasRun && scanResult.success && (
                <div style={styles.mutedPanel}>Select a destination folder for the next execution phase.</div>
              )}

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <button
                  onClick={handleSelectDestinationFolder}
                  disabled={!scanHasRun || !scanResult.success}
                  style={!scanHasRun || !scanResult.success ? styles.actionButtonDisabled : styles.actionButtonSecondary}
                >
                  <FolderOpen size={16} /> Select Destination
                </button>
              </div>

              {destinationPathWarning && <div style={styles.errorBanner}>{destinationPathWarning}</div>}

              {!scanHasRun && (
                <div style={styles.mutedPanel}>No scan yet. Select a folder and run scan.</div>
              )}

              {scanHasRun && scanResult.success && (
                <div style={styles.resultPanel}>
                  <strong>{normalizeIngestionPlan(scanResult.plan).totalFiles} files found</strong>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>
                    Root: {normalizeIngestionPlan(scanResult.plan).rootFolder}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
                    Total size: {formatBytes(normalizeIngestionPlan(scanResult.plan).totalBytes)} · Folders:{' '}
                    {normalizeIngestionPlan(scanResult.plan).folderGroups.length}
                  </div>
                  <div style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto' }}>
                    {normalizeIngestionPlan(scanResult.plan).folderGroups.map((group) => (
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

              {scanHasRun && !scanResult.success && <div style={{ color: '#ef4444' }}>Error: {scanResult.error}</div>}
            </>
          )}

          {selectedProjectId && slotsConfigured && !showSlotWizard && activeTab === 'plan' && (
            <>
              <h3 style={styles.todoHeading}>Folder to Slot Mapping</h3>
              <p style={styles.todoText}>
                Map scanned folders to project slots. This builds an in-memory mapping plan only. No files are moved or uploaded.
              </p>

              {!scanHasRun || !scanResult.success ? (
                <div style={styles.mutedPanel}>Run a scan first to build folder groups.</div>
              ) : (
                <>
                  <div style={styles.mappingGridHeader}>
                    <span>Folder Group</span>
                    <span>Files</span>
                    <span>Assign Slot</span>
                  </div>

                  <div style={styles.mappingGridBody}>
                    {normalizeIngestionPlan(scanResult.plan).folderGroups.map((group) => (
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
                      </div>
                    ))}
                  </div>

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

          {selectedProjectId && slotsConfigured && !showSlotWizard && activeTab === 'execution' && (
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
                <div style={styles.mappingSummaryText}>Completed rows in Supabase: {existingUploads.length}</div>
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
                  onClick={() => handleRunExecutionPreflight()}
                  disabled={preflightLoading || executionPlan.length === 0}
                  style={preflightLoading || executionPlan.length === 0 ? styles.actionButtonDisabled : styles.actionButtonSecondary}
                >
                  {preflightLoading ? 'Preflight...' : 'Run Resume Preflight'}
                </button>
                <button
                  onClick={handleExecuteUpload}
                  disabled={
                    !executionValidation?.executionReady ||
                    uploadRunning ||
                    !session ||
                    !executionPreflight ||
                    executionPreflight.missingUnreadableCount > 0
                  }
                  style={
                    !executionValidation?.executionReady ||
                    uploadRunning ||
                    !session ||
                    !executionPreflight ||
                    executionPreflight.missingUnreadableCount > 0
                      ? styles.actionButtonDisabled
                      : styles.actionButtonSecondary
                  }
                >
                  {uploadRunning ? 'Streaming (Serial)...' : 'Execute Filesystem Stream'}
                </button>
                <button
                  onClick={() => handleRunVerification()}
                  disabled={verificationRunning || !selectedProject}
                  style={verificationRunning || !selectedProject ? styles.actionButtonDisabled : styles.actionButtonSecondary}
                >
                  {verificationRunning ? 'Verifying...' : 'Verify Destination'}
                </button>
              </div>

              {executionValidation && (
                <div style={executionValidation.executionReady ? styles.successBanner : styles.errorBanner}>
                  executionReady = {String(executionValidation.executionReady)} | allFilesReadable ={' '}
                  {String(executionValidation.allFilesReadable)} | noCriticalErrors = {String(executionValidation.noCriticalErrors)}
                </div>
              )}

              {uploadResultMessage && (
                <div style={uploadResultMessage.kind === 'error' ? styles.errorBanner : styles.successBanner}>
                  {uploadResultMessage.text}
                </div>
              )}

              {resumeNotice && <div style={styles.successBanner}>{resumeNotice}</div>}

              {executionPreflight && (
                <div style={styles.mappingSummaryPanel}>
                  <h4 style={styles.mappingSummaryTitle}>Resume-aware Preflight</h4>
                  <div style={styles.mappingSummaryText}>
                    already uploaded: {executionPreflight.alreadyUploadedCount} · pending: {executionPreflight.pendingUploadCount} ·
                    missing/unreadable: {executionPreflight.missingUnreadableCount}
                  </div>
                  {executionPreflight.slotSummaries.map((slot) => (
                    <div key={slot.slotId} style={styles.mappingSlotSummaryRow}>
                      <span>
                        {slot.slotLabel} · {slot.status}
                      </span>
                      <span>
                        done {slot.alreadyUploaded} · pending {slot.pendingUpload} · blocked {slot.missingUnreadable}
                      </span>
                    </div>
                  ))}
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
                          <span style={styles.renameOkCell}>{item.destinationFilename}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              {verificationSummary && (
                <div style={styles.mappingSummaryPanel}>
                  <h4 style={styles.mappingSummaryTitle}>Verification Summary</h4>
                  <div style={styles.mappingSummaryText}>
                    checked: {verificationSummary.checked} · valid: {verificationSummary.valid} · invalid:{' '}
                    {verificationSummary.invalid}
                  </div>
                  {verificationSummary.details
                    .filter((item) => !item.exists || !item.filenameMatches || !item.sizeMatches)
                    .map((item) => (
                      <div key={item.filePath} style={styles.mappingWarning}>
                        {item.filePath} :: exists={String(item.exists)} filename={String(item.filenameMatches)} size=
                        {String(item.sizeMatches)} {item.error ? `(${item.error})` : ''}
                      </div>
                    ))}
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
  slotActionButtons: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
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
  iconButtonWide: {
    border: '1px solid #1e293b',
    background: '#0f172a',
    color: '#e2e8f0',
    borderRadius: 8,
    minHeight: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: '4px 8px',
    fontSize: 11,
    gap: 4,
    whiteSpace: 'nowrap',
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
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 8,
    background: '#2563eb',
    color: 'white',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 10px',
    cursor: 'pointer',
  },
  slotSetupEmptyState: {
    border: '1px solid #1e293b',
    borderRadius: 8,
    background: '#0f172a',
    padding: 10,
    marginBottom: 12,
    display: 'grid',
    gap: 8,
  },
  slotSetupTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#e2e8f0',
  },
  slotSetupText: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 1.4,
  },
  slotDialogPanel: {
    border: '1px solid #334155',
    borderRadius: 10,
    background: '#0f172a',
    padding: 10,
    marginBottom: 12,
    display: 'grid',
    gap: 8,
  },
  slotDialogTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: '#e2e8f0',
  },
  slotDialogText: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 1.4,
  },
  slotDialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  wizardSection: {
    display: 'grid',
    gap: 8,
  },
  wizardSectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#cbd5e1',
  },
  wizardBucketGroupTitle: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: 600,
    marginTop: 6,
  },
  bucketGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  bucketOption: {
    border: '1px solid #1e293b',
    background: '#020617',
    borderRadius: 8,
    padding: 8,
    display: 'grid',
    gap: 4,
    fontSize: 12,
    color: '#e2e8f0',
  },
  wizardBucketPanel: {
    border: '1px solid #1e293b',
    borderRadius: 8,
    background: '#020617',
    padding: 8,
    display: 'grid',
    gap: 6,
  },
  wizardTextarea: {
    width: '100%',
    minHeight: 64,
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#020617',
    color: 'white',
    fontSize: 12,
    padding: '8px 10px',
    boxSizing: 'border-box',
    resize: 'vertical',
  },
  checkboxRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#cbd5e1',
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
  errorBannerCompact: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.25)',
    color: '#fecaca',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    fontSize: 12,
    display: 'grid',
    gap: 4,
  },
  successBannerCompact: {
    background: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    color: '#6ee7b7',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    fontSize: 12,
  },
  slotWizardLaunchRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: 10
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
  projectSetupEmptyState: {
    minHeight: 340,
    border: '1px solid #1e293b',
    borderRadius: 12,
    background: '#0f172a',
    display: 'grid',
    placeItems: 'center',
    textAlign: 'center',
    padding: 24,
    gap: 10,
  },
  projectSetupIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    display: 'grid',
    placeItems: 'center',
    background: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 34,
    lineHeight: 1,
    fontWeight: 500
  },
  projectSetupTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: '#e2e8f0'
  },
  projectSetupText: {
    margin: 0,
    maxWidth: 620,
    fontSize: 16,
    color: '#94a3b8',
    lineHeight: 1.5
  },
  setupPrimaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 10,
    background: '#2563eb',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
    padding: '12px 18px',
    cursor: 'pointer'
  },
  slotWizardPanel: {
    border: '1px solid #1e293b',
    borderRadius: 12,
    background: '#0f172a',
    padding: 18,
    display: 'grid',
    gap: 12
  },
  slotWizardHeader: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: '#e2e8f0'
  },
  slotWizardProjectLine: {
    margin: 0,
    fontSize: 14,
    color: '#93c5fd'
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
    gridTemplateColumns: '2fr 1.3fr 1.4fr',
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
    gridTemplateColumns: '2fr 1.3fr 1.4fr',
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
  settingsLabel: {
    display: 'block',
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 8,
  },
}

export default App

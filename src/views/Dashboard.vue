<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  db,
  auth,
  getSubmissions,
  logActivity,
  getActivityLogs,
  saveWinners,
  loadAllWinners,
  type Submission,
  type ActivityLog,
  type Winner,
} from '../services/firebase'
import { signOut, onAuthStateChanged } from 'firebase/auth'
import {
  doc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import PieChart from '../components/PieChart.vue'
import LineChart from '../components/LineChart.vue'
import BarChart from '../components/BarChart.vue'
import VueDatePicker from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'

type TabType = 'raffle-entries' | 'pick-winners' | 'insights'

// Initialize activeTab from localStorage or default to 'raffle-entries'
const getInitialTab = (): TabType => {
  const savedTab = localStorage.getItem('tk-active-tab')
  if (savedTab && ['raffle-entries', 'pick-winners', 'insights'].includes(savedTab)) {
    return savedTab as TabType
  }
  return 'raffle-entries'
}

const activeTab = ref<TabType>(getInitialTab())
const submissions = ref<Submission[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const currentPage = ref(1)
const itemsPerPage = 10
const showReceiptModal = ref(false)
const selectedReceipt = ref<{ urls: string[]; number: string; currentIndex: number }>({
  urls: [],
  number: '',
  currentIndex: 0,
})
const receiptLoading = ref(false)
const statusUpdating = ref(new Set<string>()) // Track which submissions are being updated
const showRetryButton = ref(false)
const searchTerm = ref('')
const selectedBranch = ref('')
const selectedEntryStatus = ref('')
const startDate = ref('')
const endDate = ref('')
const dateRange = ref<[Date | null, Date | null] | null>(null)

// Column visibility state - all columns visible by default
const visibleColumns = ref<Record<string, boolean>>({
  id: true,
  raffleEntries: true,
  entryStatus: true,
  fullName: true,
  mobileNumber: true,
  email: true,
  birthdate: true,
  residentialAddress: true,
  branch: true,
  dateOfPurchase: true,
  purchaseAmount: true,
  receiptNumber: true,
  receiptUpload: true,
  submittedAt: true,
})

// Prize drawing system
const grandPrizes = ref([
  { name: 'Discovery Samal', count: 2, winners: [] as Submission[] },
  { name: 'Discovery Coron', count: 2, winners: [] as Submission[] },
  { name: 'Discovery Boracay', count: 2, winners: [] as Submission[] },
  { name: 'Discovery Primea', count: 1, winners: [] as Submission[] },
  { name: 'Discovery Suites', count: 1, winners: [] as Submission[] },
])

const consolationPrizes = ref([
  { name: 'Gift Box', count: 10, winners: [] as Submission[] },
  { name: '₱1,000 Gift Certificates', count: 10, winners: [] as Submission[] },
  { name: '₱1,500 Gift Certificates', count: 10, winners: [] as Submission[] },
  { name: '₱2,000 Gift Certificates', count: 8, winners: [] as Submission[] },
])

const usedWinnerIds = ref(new Set<string>())

// Winner verification modal
const showWinnerModal = ref(false)
const selectedWinner = ref<Submission | null>(null)
const selectedPrizeName = ref('')
const drawTime = ref<Record<string, string>>({}) // Store draw time for each winner
const winnerStatus = ref<Record<string, 'confirmed' | 'rejected'>>({}) // Track winner verification status
const rejectionReasons = ref<Record<string, string>>({}) // Store rejection reasons by winner ID

const tabs = [
  {
    id: 'raffle-entries',
    label: 'Raffle Entries',
    icon: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  },
  {
    id: 'pick-winners',
    label: 'Pick Winners',
    icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
] as const

const tableColumns = [
  { label: 'ID', key: 'id' },
  { label: 'No. Of Entries', key: 'raffleEntries' },
  { label: 'Entry Status', key: 'entryStatus' },
  { label: 'Full Name', key: 'fullName' },
  { label: 'Mobile Number', key: 'mobileNumber' },
  { label: 'Email Address', key: 'email' },
  { label: 'Birthdate', key: 'birthdate' },
  { label: 'Residential Address', key: 'residentialAddress' },
  { label: 'Branch', key: 'branch' },
  { label: 'Date of Purchase', key: 'dateOfPurchase' },
  { label: 'Purchase Amount', key: 'purchaseAmount' },
  { label: 'Receipt/Invoice Number', key: 'receiptNumber' },
  { label: 'Upload Receipt', key: 'receiptUpload' },
  { label: 'Submitted at', key: 'submittedAt' },
]

const availableBranches = computed(() => {
  const branches = [...new Set(submissions.value.map((s) => s.branch).filter(Boolean))]
  return branches.sort()
})

// Filter visible columns based on user selection
const filteredTableColumns = computed(() => {
  return tableColumns.filter((column) => visibleColumns.value[column.key])
})

// Toggle column visibility
const toggleColumnVisibility = (columnKey: string) => {
  visibleColumns.value[columnKey] = !visibleColumns.value[columnKey]
}

// Toggle all columns visibility
const toggleAllColumns = (visible: boolean) => {
  Object.keys(visibleColumns.value).forEach((key) => {
    visibleColumns.value[key] = visible
  })
}

// Check if all columns are visible
const allColumnsVisible = computed(() => {
  return Object.values(visibleColumns.value).every((visible) => visible)
})

// Check if any column is visible
const hasVisibleColumns = computed(() => {
  return Object.values(visibleColumns.value).some((visible) => visible)
})

// Dropdown state
const showColumnDropdown = ref(false)

// Toggle dropdown
const toggleColumnDropdown = () => {
  showColumnDropdown.value = !showColumnDropdown.value
}

// Close dropdown
const closeColumnDropdown = () => {
  showColumnDropdown.value = false
}

// Pick Winners - Valid/Invalid entries display state
const showValidEntries = ref(false)
const showInvalidEntries = ref(false)

// Reactive key to force Pick Winners components to update
const eligibilityUpdateKey = computed(() => {
  // This will change whenever valid entries count changes, forcing reactive updates
  return `${validEntriesList.value.length}-${eligibleEntries.value.length}-${submissions.value.filter((s) => s.entryStatus).length}`
})

// Toggle valid entries display
const toggleValidEntries = () => {
  console.log(
    'Toggling valid entries from:',
    showValidEntries.value,
    'to:',
    !showValidEntries.value,
  )
  showValidEntries.value = !showValidEntries.value
}

// Toggle invalid entries display
const toggleInvalidEntries = () => {
  console.log(
    'Toggling invalid entries from:',
    showInvalidEntries.value,
    'to:',
    !showInvalidEntries.value,
  )
  showInvalidEntries.value = !showInvalidEntries.value
}

// Get valid entries list
const validEntriesList = computed(() => {
  return submissions.value.filter(
    (submission) =>
      submission.entryStatus === 'Valid' ||
      submission.entryStatus === 'Verified' ||
      submission.entryStatus === 'Approved',
  )
})

// Get invalid entries list
const invalidEntriesList = computed(() => {
  return submissions.value.filter(
    (submission) =>
      submission.entryStatus === 'Invalid' ||
      submission.entryStatus === 'Pending' ||
      !submission.entryStatus,
  )
})

// Sorting state
const sortColumn = ref<string | null>(null)
const sortDirection = ref<'asc' | 'desc'>('asc')

// Toggle sort for raffle entries column
const toggleSort = () => {
  if (sortColumn.value === 'raffleEntries') {
    // If already sorting by raffle entries, toggle direction
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    // If not sorting by raffle entries, set it as sort column
    sortColumn.value = 'raffleEntries'
    sortDirection.value = 'asc'
  }
}

// Activity Log state
const activityLogs = ref<ActivityLog[]>([])
const showActivityLogModal = ref(false)
const activityLogsLoading = ref(false)
const winnersLoading = ref(false)
const drawingWinners = ref(new Set<string>()) // Track which prizes are currently being drawn
const showRejectReasonModal = ref(false)
const rejectionReason = ref('')
const rejectionTextarea = ref<HTMLTextAreaElement | null>(null)
const rejectionInProgress = ref(false)
const loggingOut = ref(false)
const currentAdmin = ref<{ id: string; email: string; name?: string } | null>(null)

// Toast notification system
interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  duration?: number
}

const toasts = ref<Toast[]>([])

const showToast = (type: Toast['type'], title: string, message: string, duration = 5000) => {
  const id = Math.random().toString(36).substr(2, 9)
  const toast: Toast = { id, type, title, message, duration }

  // Adjust duration based on type
  if (type === 'warning' || type === 'error') {
    duration = duration === 5000 ? 8000 : duration // Longer duration for important messages
  } else if (type === 'success') {
    duration = duration === 5000 ? 4000 : duration // Shorter for success messages
  }

  toast.duration = duration
  toasts.value.push(toast)

  if (duration > 0) {
    setTimeout(() => {
      removeToast(id)
    }, duration)
  }
}

const removeToast = (id: string) => {
  const index = toasts.value.findIndex((toast) => toast.id === id)
  if (index > -1) {
    toasts.value.splice(index, 1)
  }
}

// Load activity logs
const loadActivityLogs = async () => {
  activityLogsLoading.value = true
  try {
    activityLogs.value = await getActivityLogs()
  } catch (error) {
    console.error('Failed to load activity logs:', error)
  } finally {
    activityLogsLoading.value = false
  }
}

// Toggle activity log modal
const toggleActivityLogModal = async () => {
  showActivityLogModal.value = !showActivityLogModal.value
  if (showActivityLogModal.value && activityLogs.value.length === 0) {
    await loadActivityLogs()
  }
}

const filteredSubmissions = computed(() => {
  return submissions.value.filter((submission) => {
    // Search filter
    if (searchTerm.value) {
      const search = searchTerm.value.toLowerCase()
      const matchesSearch =
        submission.fullName?.toLowerCase().includes(search) ||
        submission.email?.toLowerCase().includes(search) ||
        submission.mobileNumber?.includes(search) ||
        submission.receiptNumber?.toLowerCase().includes(search) ||
        submission.id?.toString().includes(search)

      if (!matchesSearch) return false
    }

    // Branch filter
    if (selectedBranch.value && submission.branch !== selectedBranch.value) {
      return false
    }

    // Entry Status filter
    if (selectedEntryStatus.value) {
      const isValid =
        submission.entryStatus === 'Valid' ||
        submission.entryStatus === 'Verified' ||
        submission.entryStatus === 'Approved'
      const isInvalid =
        submission.entryStatus === 'Invalid' ||
        submission.entryStatus === 'Pending' ||
        !submission.entryStatus

      if (selectedEntryStatus.value === 'Valid' && !isValid) {
        return false
      }
      if (selectedEntryStatus.value === 'Invalid' && !isInvalid) {
        return false
      }
    }

    // Date filter
    if (startDate.value || endDate.value) {
      try {
        const submissionDate = submission.submittedAt?.toDate
          ? submission.submittedAt.toDate()
          : new Date(submission.submittedAt)

        const submissionDateOnly = new Date(
          submissionDate.getFullYear(),
          submissionDate.getMonth(),
          submissionDate.getDate(),
        )

        if (startDate.value) {
          const filterStartDate = new Date(startDate.value)
          if (submissionDateOnly < filterStartDate) return false
        }

        if (endDate.value) {
          const filterEndDate = new Date(endDate.value)
          if (submissionDateOnly > filterEndDate) return false
        }
      } catch (e) {
        // If date parsing fails, include the submission
        console.warn('Date parsing failed for submission:', submission.id)
      }
    }

    return true
  })
})

const stats = computed(() => {
  // Always use unfiltered submissions for stats cards
  // Total Users (count of unique submissions/users)
  const totalUsers = submissions.value.length

  // Total Entries (sum of all raffle entries)
  const totalEntries = submissions.value.reduce((sum, s) => sum + (s.raffleEntries || 1), 0)

  // Valid Entries (sum of raffle entries from valid submissions)
  const validEntries = submissions.value
    .filter(
      (s) =>
        s.entryStatus === 'Valid' || s.entryStatus === 'Verified' || s.entryStatus === 'Approved',
    )
    .reduce((sum, s) => sum + (s.raffleEntries || 1), 0)

  // Invalid Entries (sum of raffle entries from invalid submissions)
  const invalidEntries = submissions.value
    .filter((s) => s.entryStatus === 'Invalid' || s.entryStatus === 'Pending' || !s.entryStatus)
    .reduce((sum, s) => sum + (s.raffleEntries || 1), 0)

  return {
    totalUsers,
    totalEntries,
    validEntries,
    invalidEntries,
    // Keep old properties for backwards compatibility
    total: totalEntries,
    valid: validEntries,
    invalid: invalidEntries,
  }
})

// Filtered stats for filter status display
const filteredStats = computed(() => {
  const filteredTotalUsers = sortedSubmissions.value.length
  const filteredTotalEntries = sortedSubmissions.value.reduce(
    (sum, s) => sum + (s.raffleEntries || 1),
    0,
  )

  return {
    totalUsers: filteredTotalUsers,
    totalEntries: filteredTotalEntries,
  }
})

// Sorted submissions based on sort state
const sortedSubmissions = computed(() => {
  const filtered = [...filteredSubmissions.value]

  if (sortColumn.value === 'raffleEntries') {
    return filtered.sort((a, b) => {
      const aEntries = a.raffleEntries || 1
      const bEntries = b.raffleEntries || 1

      if (sortDirection.value === 'asc') {
        return aEntries - bEntries
      } else {
        return bEntries - aEntries
      }
    })
  }

  return filtered
})

const totalPages = computed(() => Math.ceil(sortedSubmissions.value.length / itemsPerPage))

const paginatedSubmissions = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage
  const end = start + itemsPerPage
  return sortedSubmissions.value.slice(start, end).map((submission, index) => ({
    ...submission,
    displayId: (start + index + 1).toString(), // Use displayId for table display
    // Keep original id for database operations
  }))
})

const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
  }
}

const handleDateRangeChange = (newDateRange: [Date | null, Date | null] | null) => {
  if (newDateRange && newDateRange[0] && newDateRange[1]) {
    startDate.value = newDateRange[0].toISOString().split('T')[0]
    endDate.value = newDateRange[1].toISOString().split('T')[0]
  } else {
    startDate.value = ''
    endDate.value = ''
  }
  resetPagination()
}

const clearDateRange = () => {
  dateRange.value = null
  startDate.value = ''
  endDate.value = ''
  resetPagination()
}

const clearFilters = () => {
  searchTerm.value = ''
  selectedBranch.value = ''
  selectedEntryStatus.value = ''
  startDate.value = ''
  endDate.value = ''
  dateRange.value = null
  // Reset all columns to visible
  toggleAllColumns(true)
  currentPage.value = 1
}

// Reset to first page when filters change
const resetPagination = () => {
  currentPage.value = 1
  // Reset sorting when filters change
  sortColumn.value = null
  sortDirection.value = 'asc'
}

// Format date from YYYY-MM-DD to MM-DD-YYYY for display
const formatDateForDisplay = (dateStr: string): string => {
  if (!dateStr) return ''
  try {
    const [year, month, day] = dateStr.split('-')
    return `${month}-${day}-${year}`
  } catch (e) {
    return dateStr
  }
}

// Export filtered data to CSV
const exportData = () => {
  try {
    const dataToExport = sortedSubmissions.value

    if (dataToExport.length === 0) {
      alert('No data to export. Please adjust your filters or check if there are any entries.')
      return
    }

    // Define CSV headers
    const headers = [
      'ID',
      'No. Of Entries',
      'Entry Status',
      'Full Name',
      'Mobile Number',
      'Email Address',
      'Birthdate',
      'Residential Address',
      'Branch',
      'Date of Purchase',
      'Purchase Amount',
      'Receipt/Invoice Number',
      'Submitted At',
    ]

    // Convert data to CSV format
    const csvContent = [
      headers.join(','),
      ...dataToExport.map((submission) =>
        [
          `"${submission.id || ''}"`,
          `"${submission.raffleEntries || ''}"`,
          `"${submission.entryStatus || ''}"`,
          `"${submission.fullName || ''}"`,
          `"${submission.mobileNumber || ''}"`,
          `"${submission.email || ''}"`,
          `"${submission.birthdate || ''}"`,
          `"${submission.residentialAddress || ''}"`,
          `"${submission.branch || ''}"`,
          `"${submission.dateOfPurchase || ''}"`,
          `"${submission.purchaseAmount || ''}"`,
          `"${submission.receiptNumber || ''}"`,
          `"${formatValue(submission.submittedAt, 'submittedAt')}"`,
        ].join(','),
      ),
    ].join('\n')

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)

      // Generate filename with current date and filter info
      const now = new Date()
      const dateStr = now.toISOString().split('T')[0]
      let filename = `raffle-entries-${dateStr}`

      if (
        searchTerm.value ||
        selectedBranch.value ||
        selectedEntryStatus.value ||
        startDate.value ||
        endDate.value
      ) {
        filename += '-filtered'
      }

      link.setAttribute('download', `${filename}.csv`)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Show success message
      console.log(`Exported ${dataToExport.length} entries to ${filename}.csv`)
    }
  } catch (error) {
    console.error('Export failed:', error)
    alert('Export failed. Please try again.')
  }
}

const isColumnCentered = (key: string): boolean => {
  const centeredColumns = [
    'id',
    'raffleEntries',
    'mobileNumber',
    'birthdate',
    'dateOfPurchase',
    'receiptNumber',
    'submittedAt',
    'receiptUpload',
    'entryStatus',
  ]
  return centeredColumns.includes(key)
}

const getColumnWidth = (key: string): string => {
  switch (key) {
    case 'receiptNumber':
      return 'w-56'
    case 'id':
      return 'w-16'
    case 'raffleEntries':
      return 'w-20'
    case 'entryStatus':
      return 'w-80'
    case 'mobileNumber':
      return 'w-32'
    case 'birthdate':
      return 'w-28'
    case 'dateOfPurchase':
      return 'w-28'
    case 'receiptUpload':
      return 'w-36'
    case 'submittedAt':
      return 'w-36'
    default:
      return 'min-w-[120px]'
  }
}

const openReceiptModal = (receiptUrls: string | string[], receiptNumber: string) => {
  const urls = Array.isArray(receiptUrls) ? receiptUrls : [receiptUrls]
  selectedReceipt.value = { urls, number: receiptNumber, currentIndex: 0 }
  receiptLoading.value = true
  showReceiptModal.value = true
  document.addEventListener('keydown', handleReceiptKeydown)
}

const closeReceiptModal = () => {
  showReceiptModal.value = false
  selectedReceipt.value = { urls: [], number: '', currentIndex: 0 }
  receiptLoading.value = false
  document.removeEventListener('keydown', handleReceiptKeydown)
}

const nextImage = () => {
  if (selectedReceipt.value.currentIndex < selectedReceipt.value.urls.length - 1) {
    selectedReceipt.value.currentIndex++
    receiptLoading.value = true
  }
}

const previousImage = () => {
  if (selectedReceipt.value.currentIndex > 0) {
    selectedReceipt.value.currentIndex--
    receiptLoading.value = true
  }
}

const handleReceiptKeydown = (event: KeyboardEvent) => {
  if (!showReceiptModal.value || selectedReceipt.value.urls.length <= 1) return

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    previousImage()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    nextImage()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeReceiptModal()
  }
}

const toggleEntryStatus = async (submission: Submission, index: number) => {
  // Prevent multiple updates on the same submission
  if (statusUpdating.value.has(submission.id)) {
    return
  }

  const currentStatus = submission.entryStatus
  let newStatus = ''

  if (currentStatus === 'Valid' || currentStatus === 'Verified' || currentStatus === 'Approved') {
    newStatus = 'Invalid'
  } else {
    newStatus = 'Valid'
  }

  // Add to updating set
  statusUpdating.value.add(submission.id)

  try {
    // Update the status in Firebase
    const submissionRef = doc(db, 'raffle-entries-test-123', submission.id)
    await updateDoc(submissionRef, {
      entryStatus: newStatus,
    })

    // Log the activity (non-blocking)
    logActivity(
      {
        action: 'STATUS_UPDATE',
        description: `Full name: ${submission.fullName || 'Unknown'}<br>Entry status changed from ${currentStatus || 'Pending'} to ${newStatus}`,
        targetId: submission.id,
        targetName: submission.fullName || 'Unknown',
        oldValue: currentStatus,
        newValue: newStatus,
        details: {
          email: submission.email,
          mobileNumber: submission.mobileNumber,
          branch: submission.branch,
          raffleEntries: submission.raffleEntries,
        },
      },
      currentAdmin.value || undefined,
    ).catch((err) => console.warn('Activity logging failed:', err))

    // Update the local state only after successful database update
    // Find the submission in the main array and update it
    const submissionIndex = submissions.value.findIndex((s) => s.id === submission.id)
    if (submissionIndex !== -1) {
      submissions.value[submissionIndex].entryStatus = newStatus
    }

    console.log(`Updated submission ${submission.id} status to ${newStatus}`)

    // Force Vue reactivity update
    await nextTick()

    // Show success notification for status change
    if (newStatus === 'Valid') {
      showToast(
        'success',
        'Entry Approved',
        `${submission.fullName}'s entry is now eligible for prize drawing.`,
        3000,
      )
    } else {
      showToast(
        'info',
        'Entry Status Updated',
        `${submission.fullName}'s entry has been marked as invalid.`,
        3000,
      )
    }
  } catch (error) {
    console.error('Failed to update submission status:', error)
    showToast('error', 'Update Failed', 'Failed to update entry status. Please try again.', 5000)
  } finally {
    // Remove from updating set
    statusUpdating.value.delete(submission.id)
  }
}

// Chart data computed properties
const ageDistributionData = computed(() => {
  const ageRanges: Record<string, number> = {
    'Under 18': 0,
    '18–25': 0,
    '26–39': 0,
    '40–64': 0,
    '65 and older': 0,
    Unknown: 0,
    Invalid: 0,
  }

  filteredSubmissions.value.forEach((submission) => {
    if (submission.birthdate) {
      try {
        const birthDate = new Date(submission.birthdate)
        const today = new Date()
        let age = today.getFullYear() - birthDate.getFullYear()
        const monthDiff = today.getMonth() - birthDate.getMonth()

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          age--
        }

        if (age >= 0 && age <= 100) {
          if (age < 18) {
            ageRanges['Under 18']++
          } else if (age >= 18 && age <= 25) {
            ageRanges['18–25']++
          } else if (age >= 26 && age <= 39) {
            ageRanges['26–39']++
          } else if (age >= 40 && age <= 64) {
            ageRanges['40–64']++
          } else if (age >= 65) {
            ageRanges['65 and older']++
          }
        } else {
          ageRanges['Invalid']++
        }
      } catch (error) {
        ageRanges['Unknown']++
      }
    } else {
      ageRanges['Unknown']++
    }
  })

  // Show only valid age ranges (exclude Unknown and Invalid)
  const filteredRanges = Object.entries(ageRanges).filter(
    ([range]) => range !== 'Unknown' && range !== 'Invalid',
  )

  // Generate colors for each age range
  const generateColor = (index: number) => {
    const colors = [
      '#3b82f6',
      '#10b981',
      '#f59e0b',
      '#ef4444',
      '#8b5cf6',
      '#06b6d4',
      '#84cc16',
      '#f97316',
      '#ec4899',
      '#14b8a6',
      '#f472b6',
      '#a855f7',
      '#22d3ee',
      '#fb7185',
      '#34d399',
      '#fbbf24',
    ]
    return colors[index % colors.length]
  }

  const data = {
    labels: filteredRanges.map(([range]) => range),
    datasets: [
      {
        data: filteredRanges.map(([, count]) => count),
        backgroundColor: filteredRanges.map((_, index) => generateColor(index)),
        borderColor: filteredRanges.map((_, index) => {
          const color = generateColor(index)
          // Darken the border color
          return color.replace('#', '#').replace(/[0-9a-f]/g, (char) => {
            const num = parseInt(char, 16)
            return Math.max(0, num - 2).toString(16)
          })
        }),
        borderWidth: 2,
      },
    ],
  }
  console.log('Age Distribution Data:', data)
  return data
})

const branchAnalysisData = computed(() => {
  const branchCounts = filteredSubmissions.value.reduce(
    (acc: Record<string, number>, submission) => {
      const branch = submission.branch || 'Unknown'
      const entries = submission.raffleEntries || 1
      acc[branch] = (acc[branch] || 0) + entries
      return acc
    },
    {},
  )

  const sortedBranches = Object.entries(branchCounts).sort(([, a], [, b]) => b - a) // Sort by entries descending, but show all

  // Generate colors for all branches
  const generateColor = (index: number) => {
    const colors = [
      '#3b82f6',
      '#10b981',
      '#f59e0b',
      '#ef4444',
      '#8b5cf6',
      '#06b6d4',
      '#84cc16',
      '#f97316',
      '#ec4899',
      '#14b8a6',
      '#f472b6',
      '#a855f7',
      '#22d3ee',
      '#fb7185',
      '#34d399',
      '#fbbf24',
      '#f87171',
      '#a78bfa',
      '#60a5fa',
      '#34d399',
      '#fde047',
      '#fb923c',
      '#f472b6',
      '#38bdf8',
      '#4ade80',
      '#facc15',
      '#f97316',
      '#e879f9',
      '#06b6d4',
      '#22c55e',
      '#06b6d4',
      '#84cc16',
    ]
    return colors[index % colors.length]
  }

  const data = {
    labels: sortedBranches.map(([branch]) => branch),
    datasets: [
      {
        label: 'Entries by Branch',
        data: sortedBranches.map(([, count]) => count),
        backgroundColor: sortedBranches.map((_, index) => generateColor(index)),
        borderColor: sortedBranches.map((_, index) => generateColor(index)),
        borderWidth: 1,
      },
    ],
  }

  console.log('Branch Analysis Data:', data)
  console.log('Branch Counts:', branchCounts)
  console.log('Submissions:', submissions.value.length)
  return data
})

const branchRevenueData = computed(() => {
  const branchRevenue = filteredSubmissions.value.reduce(
    (acc: Record<string, number>, submission) => {
      const branch = submission.branch || 'Unknown'
      const amount = submission.purchaseAmount || 0
      acc[branch] = (acc[branch] || 0) + amount
      return acc
    },
    {},
  )

  const sortedBranches = Object.entries(branchRevenue).sort(([, a], [, b]) => b - a) // Sort by revenue descending, but show all

  // Generate colors for all branches
  const generateRevenueColor = (index: number) => {
    const colors = [
      '#10b981',
      '#059669',
      '#047857',
      '#065f46',
      '#064e3b',
      '#022c22',
      '#14532d',
      '#166534',
      '#15803d',
      '#16a34a',
      '#22c55e',
      '#4ade80',
      '#86efac',
      '#bbf7d0',
      '#dcfce7',
      '#f0fdf4',
      '#fef3c7',
      '#fde68a',
      '#fcd34d',
      '#fbbf24',
      '#f59e0b',
      '#d97706',
      '#92400e',
      '#78350f',
    ]
    return colors[index % colors.length]
  }

  const data = {
    labels: sortedBranches.map(([branch]) => branch),
    datasets: [
      {
        label: 'Revenue by Branch',
        data: sortedBranches.map(([, revenue]) => revenue),
        backgroundColor: sortedBranches.map((_, index) => generateRevenueColor(index)),
        borderColor: sortedBranches.map((_, index) => generateRevenueColor(index)),
        borderWidth: 1,
      },
    ],
  }

  console.log('Branch Revenue Data:', data)
  return data
})

const entriesPerDayData = computed(() => {
  const dayData = filteredSubmissions.value.reduce((acc: Record<string, number>, submission) => {
    if (submission.submittedAt) {
      try {
        const date = submission.submittedAt.toDate
          ? submission.submittedAt.toDate()
          : new Date(submission.submittedAt)
        const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

        if (!acc[dayKey]) {
          acc[dayKey] = 0
        }

        acc[dayKey] += submission.raffleEntries || 1
      } catch (e) {
        // Handle invalid dates
        console.warn('Invalid date for submission:', submission.submittedAt)
      }
    }
    return acc
  }, {})

  const sortedDays = Object.entries(dayData)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30) // Last 30 days

  // Define a color palette for the bars
  const barColors = [
    '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f87171', '#a78bfa', '#34d399', '#fbbf24',
    '#f472b6', '#2563eb', '#fb7185', '#22d3ee', '#facc15',
    '#e879f9', '#38bdf8', '#4ade80', '#f472b6', '#f87171',
    '#a3e635', '#f43f5e', '#fcd34d', '#818cf8', '#fca5a5',
    '#fbbf24', '#7c3aed', '#f472b6', '#f87171', '#a3e635'
  ]

  const data = {
    labels: sortedDays.map(([day]) => {
      const [year, month, dayNum] = day.split('-')
      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(dayNum))
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }),
    datasets: [
      {
        label: 'Daily Entries',
        data: sortedDays.map(([, entries]) => entries),
        backgroundColor: sortedDays.map((_, i) => barColors[i % barColors.length]),
        borderColor: sortedDays.map((_, i) => barColors[i % barColors.length]),
        borderWidth: 2,
      },
    ],
  }

  return data
})

const purchaseAmountData = computed(() => {
  const ranges: Record<string, number> = {
    '₱0 - ₱500': 0,
    '₱501 - ₱1,000': 0,
    '₱1,001 - ₱2,500': 0,
    '₱2,501 - ₱5,000': 0,
    '₱5,001+': 0,
  }

  filteredSubmissions.value.forEach((submission) => {
    const amount = submission.purchaseAmount || 0
    if (amount <= 500) ranges['₱0 - ₱500']++
    else if (amount <= 1000) ranges['₱501 - ₱1,000']++
    else if (amount <= 2500) ranges['₱1,001 - ₱2,500']++
    else if (amount <= 5000) ranges['₱2,501 - ₱5,000']++
    else ranges['₱5,001+']++
  })

  return {
    labels: Object.keys(ranges),
    datasets: [
      {
        label: 'Purchase Amount Distribution',
        data: Object.values(ranges),
        backgroundColor: [
          'rgba(239, 68, 68, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(34, 197, 94, 0.8)',
          'rgba(59, 130, 246, 0.8)',
          'rgba(139, 92, 246, 0.8)',
        ],
        borderColor: ['#dc2626', '#d97706', '#16a34a', '#2563eb', '#7c3aed'],
        borderWidth: 1,
      },
    ],
  }
})

// Entry Status Distribution Data
const entryStatusData = computed(() => {
  const statusCounts: Record<string, number> = {
    Valid: 0,
    Verified: 0,
    Approved: 0,
    Invalid: 0,
    Pending: 0,
    Unknown: 0,
  }

  filteredSubmissions.value.forEach((submission) => {
    const status = submission.entryStatus || 'Unknown'
    if (statusCounts.hasOwnProperty(status)) {
      statusCounts[status]++
    } else {
      statusCounts['Unknown']++
    }
  })

  // Filter out statuses with 0 count
  const filteredStatuses = Object.entries(statusCounts).filter(([, count]) => count > 0)

  return {
    labels: filteredStatuses.map(([status]) => status),
    datasets: [
      {
        label: 'Entry Status Distribution',
        data: filteredStatuses.map(([, count]) => count),
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)', // Green for Valid/Verified/Approved
          'rgba(34, 197, 94, 0.8)',
          'rgba(34, 197, 94, 0.8)',
          'rgba(239, 68, 68, 0.8)', // Red for Invalid
          'rgba(245, 158, 11, 0.8)', // Yellow for Pending
          'rgba(156, 163, 175, 0.8)', // Gray for Unknown
        ],
        borderColor: ['#16a34a', '#16a34a', '#16a34a', '#dc2626', '#d97706', '#9ca3af'],
        borderWidth: 1,
      },
    ],
  }
})

// Top branch computed property - shows branch with most total entries
const topBranch = computed(() => {
  const branchCounts = submissions.value.reduce((acc: Record<string, number>, submission) => {
    const branch = submission.branch || 'Unknown'
    const entries = submission.raffleEntries || 1
    acc[branch] = (acc[branch] || 0) + entries
    return acc
  }, {})

  // Find branch with highest total entries
  const sortedBranches = Object.entries(branchCounts).sort(([, a], [, b]) => b - a)
  return sortedBranches.length > 0 ? sortedBranches[0][0] : 'N/A'
})

// Top participants computed property - sorted by raffle entries descending
const topParticipants = computed(() => {
  return [...filteredSubmissions.value]
    .sort((a, b) => {
      const aEntries = a.raffleEntries || 1
      const bEntries = b.raffleEntries || 1
      // Primary sort: by raffle entries descending
      if (bEntries !== aEntries) {
        return bEntries - aEntries
      }
      // Secondary sort: by purchase amount descending
      const aPurchase = a.purchaseAmount || 0
      const bPurchase = b.purchaseAmount || 0
      return bPurchase - aPurchase
    })
    .slice(0, 5)
})

const setActiveTab = (tab: TabType) => {
  activeTab.value = tab
  // Save to localStorage for persistence across page reloads
  localStorage.setItem('tk-active-tab', tab)
}

const router = useRouter()

const handleLogout = async () => {
  loggingOut.value = true
  try {
    // Add delay to show the logout overlay (minimum 1.5 seconds)
    await Promise.all([signOut(auth), new Promise((resolve) => setTimeout(resolve, 1500))])
    console.log('User signed out')
    router.push('/')
  } catch (error) {
    console.error('Error signing out:', error)
  } finally {
    loggingOut.value = false
  }
}

const formatValue = (value: any, key: string): string => {
  if (value === null || value === undefined) return '-'

  if (key === 'submittedAt' && value) {
    try {
      const date = value.toDate ? value.toDate() : new Date(value)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
    } catch {
      return value.toString()
    }
  }

  if (key === 'purchaseAmount' && typeof value === 'number') {
    return `₱${value.toLocaleString()}`
  }

  if (key === 'receiptUpload' && value) {
    return 'View Receipt'
  }

  return value.toString()
}

const retryCount = ref(0)
const maxRetries = 3

// Load existing winners from Firebase
const loadExistingWinners = async () => {
  winnersLoading.value = true
  try {
    console.log('Loading existing winners from Firebase...')
    const allWinners = await loadAllWinners()

    // Map Firebase winners back to the local prize structure
    for (const [prizeName, winners] of Object.entries(allWinners)) {
      if (winners.length > 0) {
        // Convert Firebase winners back to Submission format with complete data
        const winnerSubmissions = winners.map((winner) => {
          // Find the complete submission data by ID
          const fullSubmission = submissions.value.find((sub) => sub.id === winner.submissionId)

          if (fullSubmission) {
            // Use the complete submission data
            return fullSubmission
          } else {
            // Fallback to partial data if submission not found
            console.warn(`Complete submission data not found for winner ${winner.submissionId}`)
            return {
              id: winner.submissionId,
              fullName: winner.fullName,
              email: winner.email,
              mobileNumber: winner.mobileNumber,
              raffleEntries: winner.raffleEntries,
              entryStatus: 'Valid',
            } as Submission
          }
        })

        // Restore draw times and winner status for existing winners
        winners.forEach((winner) => {
          if (winner.drawnAt) {
            const drawTimeStr = winner.drawnAt.toDate
              ? winner.drawnAt.toDate().toLocaleString()
              : new Date(winner.drawnAt).toLocaleString()
            drawTime.value[winner.submissionId] = drawTimeStr
          }

          // Restore winner status
          if (winner.status) {
            winnerStatus.value[winner.submissionId] = winner.status
          }

          // Restore rejection reason if it exists
          if (winner.status === 'rejected' && winner.rejectionReason) {
            rejectionReasons.value[winner.submissionId] = winner.rejectionReason
          }
        })

        // Find the matching prize in grandPrizes or consolationPrizes
        const grandPrize = grandPrizes.value.find((p) => p.name === prizeName)
        if (grandPrize) {
          grandPrize.winners = winnerSubmissions
        } else {
          const consolationPrize = consolationPrizes.value.find((p) => p.name === prizeName)
          if (consolationPrize) {
            consolationPrize.winners = winnerSubmissions
          }
        }

        console.log(`Loaded ${winners.length} existing winners for ${prizeName}`)
      }
    }

    console.log('Successfully loaded all existing winners')
  } catch (error) {
    console.error('Failed to load existing winners:', error)
    // Don't fail the app if winners can't be loaded, just log it
  } finally {
    winnersLoading.value = false
  }
}

const loadSubmissions = async () => {
  // Check network connectivity first
  if (!navigator.onLine) {
    error.value = 'No internet connection. Please check your network and try again.'
    loading.value = false
    showRetryButton.value = true
    return
  }

  const attemptFetch = async (attempt: number): Promise<void> => {
    retryCount.value = attempt - 1
    try {
      console.log(`Attempting to load submissions (attempt ${attempt}/${maxRetries})...`)
      submissions.value = await getSubmissions()
      console.log('Successfully loaded submissions:', submissions.value.length)
      retryCount.value = 0
      error.value = null
      showRetryButton.value = false
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err)

      if (attempt < maxRetries) {
        console.log(`Retrying... (${attempt}/${maxRetries})`)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)) // Progressive delay
        return attemptFetch(attempt + 1)
      } else {
        // All attempts exhausted
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
        const errorCode = (err as any)?.code

        console.error('All retry attempts failed:', {
          error: err,
          message: errorMessage,
          code: errorCode,
          attempts: maxRetries,
        })

        if (errorCode === 'permission-denied') {
          error.value = 'Permission denied. Please check Firestore security rules.'
        } else if (errorCode === 'unavailable') {
          error.value =
            'Firebase service is temporarily unavailable. Please try again in a few moments.'
        } else if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
          error.value =
            'Unable to connect to the database. This might be due to network issues or firewall restrictions. Please check your internet connection and try again.'
        } else if (errorMessage.includes('timeout')) {
          error.value =
            'Connection timeout. The database is taking too long to respond. Please try again.'
        } else if (errorMessage.includes('CORS')) {
          error.value = 'Cross-origin request blocked. Please contact system administrator.'
        } else {
          error.value = `Connection failed after ${maxRetries} attempts. Please check your internet connection or contact support if the problem persists.`
        }

        retryCount.value = maxRetries
        showRetryButton.value = true
        throw err
      }
    }
  }

  try {
    loading.value = true
    await attemptFetch(1)
  } finally {
    loading.value = false
  }
}

const refreshData = async () => {
  retryCount.value = 0
  await loadSubmissions()
}

// Prize drawing computed properties
const isAnyPrizeDrawn = computed(() => {
  return (
    grandPrizes.value.some((p) => p.winners.length > 0) ||
    consolationPrizes.value.some((p) => p.winners.length > 0)
  )
})

const totalGrandWinners = computed(() => {
  return grandPrizes.value.reduce((sum, prize) => sum + prize.winners.length, 0)
})

const totalConsolationWinners = computed(() => {
  return consolationPrizes.value.reduce((sum, prize) => sum + prize.winners.length, 0)
})

// Prize drawing functions - using computed for better reactivity
const eligibleEntries = computed(() => {
  const eligible = submissions.value.filter(
    (submission) =>
      (submission.entryStatus === 'Valid' ||
        submission.entryStatus === 'Verified' ||
        submission.entryStatus === 'Approved') &&
      (submission.raffleEntries || 1) > getConfirmedWinsCount(submission.id),
  )
  console.log('Total submissions:', submissions.value.length)
  console.log(
    'Valid submissions:',
    submissions.value.filter(
      (s) =>
        s.entryStatus === 'Valid' || s.entryStatus === 'Verified' || s.entryStatus === 'Approved',
    ).length,
  )
  console.log('Eligible entries (with remaining entries after confirmed wins):', eligible.length)
  return eligible
})

// Helper function to count confirmed wins for a user
const getConfirmedWinsCount = (submissionId: string) => {
  let confirmedWins = 0

  // Count confirmed wins in grand prizes
  grandPrizes.value.forEach((prize) => {
    confirmedWins += prize.winners.filter(
      (winner) => winner.id === submissionId && winnerStatus.value[winner.id] === 'confirmed',
    ).length
  })

  // Count confirmed wins in consolation prizes
  consolationPrizes.value.forEach((prize) => {
    confirmedWins += prize.winners.filter(
      (winner) => winner.id === submissionId && winnerStatus.value[winner.id] === 'confirmed',
    ).length
  })

  return confirmedWins
}

// Backward compatibility function
const getEligibleEntries = () => eligibleEntries.value

// Watch for changes in eligible entries and log them
watch(
  eligibleEntries,
  (newEligible, oldEligible) => {
    if (oldEligible && newEligible.length !== oldEligible.length) {
      console.log(`Eligible entries changed: ${oldEligible.length} → ${newEligible.length}`)

      // Force reactive update of the pick winners tab
      nextTick(() => {
        // This ensures the UI updates after the next tick
        console.log('Pick Winners tab should now show updated eligibility')
      })
    }
  },
  { deep: true, immediate: false },
)

const drawRandomWinners = (count: number) => {
  const eligible = getEligibleEntries()
  const winners: Submission[] = []

  console.log(`Attempting to draw ${count} winners from ${eligible.length} eligible entries`)

  if (eligible.length < count) {
    console.error(`Not enough eligible entries! Available: ${eligible.length}, Needed: ${count}`)

    // Get detailed breakdown for better debugging
    const totalEntries = submissions.value.length
    const validEntries = submissions.value.filter(
      (s) =>
        s.entryStatus === 'Valid' || s.entryStatus === 'Verified' || s.entryStatus === 'Approved',
    ).length
    console.log('Entry breakdown:', {
      total: totalEntries,
      valid: validEntries,
      eligible: eligible.length,
    })

    // Show detailed error message with actionable steps
    const shortfall = count - eligible.length
    let actionMessage = ''

    if (validEntries === 0) {
      actionMessage = 'Please approve some entries in the Raffle Entries tab first.'
    } else {
      actionMessage = `You need ${shortfall} more eligible entries. Users need more raffle entries than their confirmed wins to be eligible.`
    }

    showToast(
      'warning',
      'Cannot Draw Winners',
      `Need ${count} winners but only ${eligible.length} eligible entries available. ${actionMessage}`,
      0, // Manual dismiss for important warnings
    )
    return winners
  }

  // Create a copy to avoid modifying the original array
  const availableEntries = [...eligible]

  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * availableEntries.length)
    const winner = availableEntries.splice(randomIndex, 1)[0]
    console.log(`Drawing winner ${i + 1}: ${winner.fullName} (ID: ${winner.id})`)

    // Record draw time
    const currentTime = new Date().toLocaleString()
    drawTime.value[winner.id] = currentTime

    winners.push(winner)
  }

  console.log(
    'All drawn winners:',
    winners.map((w) => `${w.fullName} (${w.id})`),
  )
  return winners
}

// Helper function to clear used winner IDs (for debugging)
const clearUsedWinnerIds = () => {
  usedWinnerIds.value.clear()
  console.log('Cleared all used winner IDs')
}

// Network status monitoring
const isOnline = ref(navigator.onLine)

const updateNetworkStatus = () => {
  isOnline.value = navigator.onLine
  if (!navigator.onLine && !error.value) {
    error.value = 'Internet connection lost. Please check your network.'
    showRetryButton.value = true
  }
}

// Listen for network status changes
window.addEventListener('online', updateNetworkStatus)
window.addEventListener('offline', updateNetworkStatus)

// Winner verification functions
const openWinnerModal = (winner: Submission, prizeName: string) => {
  selectedWinner.value = winner
  selectedPrizeName.value = prizeName
  showWinnerModal.value = true
}

const closeWinnerModal = () => {
  showWinnerModal.value = false
  selectedWinner.value = null
  selectedPrizeName.value = ''
}

const confirmationInProgress = ref(false)

const confirmWinner = async () => {
  if (!selectedWinner.value || confirmationInProgress.value) {
    return
  }

  confirmationInProgress.value = true

  try {
    winnerStatus.value[selectedWinner.value.id] = 'confirmed'

    // Update winner status in Firebase
    try {
      console.log(
        `Updating winner status to confirmed for ${selectedWinner.value.fullName} (ID: ${selectedWinner.value.id}) in prize ${selectedPrizeName.value}`,
      )
      await updateWinnerStatusInDatabase(
        selectedWinner.value.id,
        selectedPrizeName.value,
        'confirmed',
      )
      console.log(`✅ Winner ${selectedWinner.value.fullName} confirmed and updated in database`)
    } catch (error) {
      console.error('❌ Failed to update winner status in database:', error)
      alert(
        `Warning: Failed to save confirmation to database. Status is saved locally but may not persist on refresh. Error: ${error}`,
      )
    }

    // Log the activity (non-blocking)
    logActivity(
      {
        action: 'WINNER_CONFIRMATION',
        description: `Winner confirmed for ${selectedPrizeName.value}`,
        targetId: selectedWinner.value.id,
        targetName: selectedWinner.value.fullName,
        details: {
          prizeName: selectedPrizeName.value,
          email: selectedWinner.value.email,
          mobileNumber: selectedWinner.value.mobileNumber,
          status: 'confirmed',
        },
      },
      currentAdmin.value || undefined,
    ).catch((err) => console.warn('Activity logging failed:', err))

    console.log(`Winner ${selectedWinner.value.fullName} confirmed for ${selectedPrizeName.value}`)

    // Show success notification
    showToast(
      'success',
      'Winner Confirmed',
      `${selectedWinner.value.fullName} has been successfully confirmed for ${selectedPrizeName.value}.`,
      4000,
    )
  } catch (error) {
    console.error('Error confirming winner:', error)
    showToast(
      'error',
      'Confirmation Failed',
      'Unable to confirm winner status. Please check your connection and try again.',
      6000,
    )
  } finally {
    confirmationInProgress.value = false
  }

  closeWinnerModal()
}

const rejectWinner = () => {
  // Show rejection reason modal instead of immediately rejecting
  rejectionReason.value = ''
  showRejectReasonModal.value = true

  // Auto-focus the textarea after the modal is rendered
  nextTick(() => {
    rejectionTextarea.value?.focus()
  })
}

const confirmRejectWinner = async () => {
  if (!selectedWinner.value || !rejectionReason.value.trim() || rejectionInProgress.value) {
    return
  }

  rejectionInProgress.value = true

  try {
    const rejectedWinnerId = selectedWinner.value.id
    const prizeName = selectedPrizeName.value
    const reason = rejectionReason.value.trim()

    console.log(`Starting rejection process for ${selectedWinner.value.fullName}`)

    // Update status immediately in UI
    winnerStatus.value[rejectedWinnerId] = 'rejected'
    rejectionReasons.value[rejectedWinnerId] = reason

    // Update winner status in Firebase
    try {
      console.log(
        `Updating winner status to rejected for ${selectedWinner.value.fullName} (ID: ${rejectedWinnerId}) in prize ${prizeName}`,
      )
      await updateWinnerStatusInDatabase(rejectedWinnerId, prizeName, 'rejected', reason)
      console.log(`✅ Winner ${selectedWinner.value.fullName} rejected and updated in database`)
    } catch (error) {
      console.error('❌ Failed to update winner status in database:', error)
      alert(
        `Warning: Failed to save rejection to database. Status is saved locally but may not persist on refresh. Error: ${error}`,
      )
    }

    // Log the activity with rejection reason (non-blocking)
    logActivity(
      {
        action: 'WINNER_REJECTION',
        description: `Winner rejected for ${prizeName}. Reason: ${reason}`,
        targetId: rejectedWinnerId,
        targetName: selectedWinner.value.fullName,
        details: {
          prizeName: prizeName,
          email: selectedWinner.value.email,
          mobileNumber: selectedWinner.value.mobileNumber,
          status: 'rejected',
          rejectionReason: reason,
        },
      },
      currentAdmin.value || undefined,
    ).catch((err) => console.warn('Activity logging failed:', err))

    console.log(
      `Winner ${selectedWinner.value.fullName} rejected for ${prizeName}. Reason: ${reason}`,
    )

    // Show success notification
    showToast(
      'info',
      'Winner Rejected',
      `${selectedWinner.value.fullName} has been rejected for ${prizeName}. They are now eligible for other prizes.`,
      5000,
    )

    console.log('Rejection process completed, closing modals')

    // Close both modals
    closeRejectReasonModal()
    closeWinnerModal()

    // Force UI update
    await nextTick()
  } catch (error) {
    console.error('Error during winner rejection:', error)
    showToast(
      'error',
      'Rejection Failed',
      'Unable to reject winner status. Please check your connection and try again.',
      6000,
    )
  } finally {
    rejectionInProgress.value = false
  }
}

const closeRejectReasonModal = () => {
  showRejectReasonModal.value = false
  rejectionReason.value = ''
}

// Update winner status in Firebase database
const updateWinnerStatusInDatabase = async (
  winnerId: string,
  prizeName: string,
  status: 'confirmed' | 'rejected',
  rejectionReason?: string,
) => {
  try {
    // Map prize names to Firebase collection names
    const prizeCollectionMap: Record<string, string> = {
      'Discovery Samal': 'discoverySamal',
      'Discovery Coron': 'discoveryCoron',
      'Discovery Boracay': 'discoveryBoracay',
      'Discovery Primea': 'discoveryPrimea',
      'Discovery Suites': 'discoverySuites',
      'Gift Box': 'giftBox',
      '₱1,000 Gift Certificates': 'giftCert_1000',
      '��1,500 Gift Certificates': 'giftCert_1500',
      '₱2,000 Gift Certificates': 'giftCert_2000',
    }

    const collectionName = prizeCollectionMap[prizeName]
    if (!collectionName) {
      throw new Error(`Unknown prize: ${prizeName}`)
    }

    // Find the winner document in the prize collection
    const winnersRef = collection(db, collectionName)
    const q = query(winnersRef, where('submissionId', '==', winnerId))
    const querySnapshot = await getDocs(q)

    if (querySnapshot.empty) {
      const errorMsg = `No winner document found for submission ID ${winnerId} in prize ${prizeName} (collection: ${collectionName})`
      console.warn(errorMsg)
      throw new Error(errorMsg)
    }

    // Update each matching document (should be only one)
    const updatePromises = querySnapshot.docs.map((docSnapshot) => {
      const updateData: any = {
        status: status,
        verifiedAt: serverTimestamp(),
      }

      if (rejectionReason) {
        updateData.rejectionReason = rejectionReason
      }

      return updateDoc(docSnapshot.ref, updateData)
    })

    await Promise.all(updatePromises)
    console.log(
      `�� Successfully updated ${querySnapshot.docs.length} winner document(s) to status '${status}' in collection '${collectionName}' for prize '${prizeName}' (submission ID: ${winnerId})`,
    )
  } catch (error) {
    console.error('Failed to update winner status in database:', error)
    throw error
  }
}

const getWinnerStatusIcon = (winnerId: string) => {
  const status = winnerStatus.value[winnerId]
  if (status === 'confirmed') return '✓'
  if (status === 'rejected') return '✗'
  return ''
}

const hasPrizeRejections = (prizeWinners: Submission[]) => {
  return prizeWinners.some((winner) => winnerStatus.value[winner.id] === 'rejected')
}

// Get count of confirmed winners for a prize
const getConfirmedWinnersCount = (prizeWinners: Submission[]) => {
  return prizeWinners.filter((winner) => winnerStatus.value[winner.id] === 'confirmed').length
}

// Get count of how many more winners are needed for a prize
const getRemainingWinnersNeeded = (prize: any) => {
  const confirmedCount = getConfirmedWinnersCount(prize.winners)
  return Math.max(0, prize.count - confirmedCount)
}

// Check if prize drawing is complete (has enough confirmed winners)
const isPrizeComplete = (prize: any) => {
  return getRemainingWinnersNeeded(prize) === 0
}

// Check if prize has drawn all winners (regardless of confirmation status)
const isPrizeDrawingComplete = (prize: any) => {
  return prize.winners.length >= prize.count
}

// Sort winners by status: pending first, then confirmed, then rejected
const getSortedWinners = (winners: Submission[]) => {
  return [...winners].sort((a, b) => {
    const statusA = winnerStatus.value[a.id] || 'pending'
    const statusB = winnerStatus.value[b.id] || 'pending'

    // Define sort order: pending = 0, confirmed = 1, rejected = 2
    const order = { pending: 0, confirmed: 1, rejected: 2 }

    return order[statusA as keyof typeof order] - order[statusB as keyof typeof order]
  })
}

const getPrizeBackgroundClass = (
  prizeWinners: Submission[],
  prizeType: 'grand' | 'consolation',
) => {
  if (prizeWinners.length === 0) return ''

  const hasRejected = hasPrizeRejections(prizeWinners)
  const allConfirmed = prizeWinners.every((winner) => winnerStatus.value[winner.id] === 'confirmed')

  if (hasRejected) {
    return 'bg-orange-50 border-orange-200'
  } else if (allConfirmed) {
    return prizeType === 'grand' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
  } else {
    return prizeType === 'grand' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
  }
}

const drawGrandPrize = async (prizeIndex: number) => {
  const prize = grandPrizes.value[prizeIndex]

  // Don't draw if prize is complete or has pending winners that could fulfill requirement
  if (
    isPrizeComplete(prize) ||
    (prize.winners.length >= prize.count &&
      prize.winners.filter((w) => !winnerStatus.value[w.id]).length > 0)
  ) {
    return
  }

  // Check if we have enough eligible entries before starting
  const winnersNeeded = getRemainingWinnersNeeded(prize)
  const eligibleCount = eligibleEntries.value.length

  if (eligibleCount < winnersNeeded) {
    showToast(
      'warning',
      'Cannot Draw Grand Prize Winners',
      `Need ${winnersNeeded} eligible entries for ${prize.name}, but only ${eligibleCount} available. Please approve more entries or review rejected winners.`,
      0,
    )
    return
  }

  // Add to drawing set to show loading state
  drawingWinners.value.add(prize.name)

  try {
    // Draw the exact number of winners still needed based on confirmed count
    const winners = drawRandomWinners(winnersNeeded)

    if (winners.length === winnersNeeded) {
      // Show drawing animation for 2 seconds before revealing winners
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Add the new winners to existing winners (this will show them in UI)
      prize.winners.push(...winners)

      // Save updated winners to Firebase
      await saveWinners(prize.name, prize.winners)
      console.log(
        `Successfully saved ${winners.length} new winner(s) for ${prize.name} to Firebase`,
      )

      // Log the activity (non-blocking)
      logActivity(
        {
          action: 'WINNER_DRAW',
          description: `Drew ${winners.length} winner${winners.length > 1 ? 's' : ''} for Grand Prize: ${prize.name}`,
          details: {
            prizeType: 'Grand Prize',
            prizeName: prize.name,
            prizeCount: prize.count,
            winners: winners.map((w) => ({
              id: w.id,
              name: w.fullName,
              email: w.email,
              mobileNumber: w.mobileNumber,
              entries: w.raffleEntries,
            })),
          },
        },
        currentAdmin.value || undefined,
      ).catch((err) => console.warn('Activity logging failed:', err))

      console.log(`Drawn ${winnersNeeded} winner(s) for ${prize.name}:`, winners)

      // Show success notification for grand prize
      showToast(
        'success',
        'Grand Prize Winners Drawn!',
        `${winners.length} winner${winners.length > 1 ? 's' : ''} selected for ${prize.name}. Please verify each winner.`,
        6000,
      )
    }
  } catch (error) {
    console.error(`Failed to save winners for ${prize.name}:`, error)
    showToast(
      'error',
      'Database Save Failed',
      'Unable to save grand prize winners to the database. Please check your connection and try drawing again.',
      0,
    )
  } finally {
    // Remove from drawing set to allow button state to update
    drawingWinners.value.delete(prize.name)
  }
}

const drawConsolationPrize = async (prizeIndex: number) => {
  const prize = consolationPrizes.value[prizeIndex]

  // Don't draw if prize is complete or has pending winners that could fulfill requirement
  if (
    isPrizeComplete(prize) ||
    (prize.winners.length >= prize.count &&
      prize.winners.filter((w) => !winnerStatus.value[w.id]).length > 0)
  ) {
    return
  }

  // Check if we have enough eligible entries before starting
  const winnersNeeded = getRemainingWinnersNeeded(prize)
  const eligibleCount = eligibleEntries.value.length

  if (eligibleCount < winnersNeeded) {
    showToast(
      'warning',
      'Cannot Draw Consolation Winners',
      `Need ${winnersNeeded} eligible entries for ${prize.name}, but only ${eligibleCount} available. Please approve more entries or review rejected winners.`,
      0,
    )
    return
  }

  // Add to drawing set to show loading state
  drawingWinners.value.add(prize.name)

  try {
    // Draw the exact number of winners still needed based on confirmed count
    const winners = drawRandomWinners(winnersNeeded)

    if (winners.length === winnersNeeded) {
      // Show drawing animation for 2 seconds before revealing winners
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Add the new winners to existing winners (this will show them in UI)
      prize.winners.push(...winners)

      // Save updated winners to Firebase
      await saveWinners(prize.name, prize.winners)
      console.log(
        `Successfully saved ${winners.length} new winner(s) for ${prize.name} to Firebase`,
      )

      // Log the activity (non-blocking)
      logActivity(
        {
          action: 'WINNER_DRAW',
          description: `Drew ${winners.length} winner(s) for Consolation Prize: ${prize.name}`,
          details: {
            prizeType: 'Consolation Prize',
            prizeName: prize.name,
            prizeCount: prize.count,
            winners: winners.map((w) => ({
              id: w.id,
              name: w.fullName,
              email: w.email,
              mobileNumber: w.mobileNumber,
              entries: w.raffleEntries,
            })),
          },
        },
        currentAdmin.value || undefined,
      ).catch((err) => console.warn('Activity logging failed:', err))

      console.log(`Drawn ${winnersNeeded} winner(s) for ${prize.name}:`, winners)

      // Show success notification for consolation prize
      showToast(
        'success',
        'Consolation Winners Drawn!',
        `${winners.length} winner${winners.length > 1 ? 's' : ''} selected for ${prize.name}. Please verify each winner.`,
        6000,
      )
    }
  } catch (error) {
    console.error(`Failed to save winners for ${prize.name}:`, error)
    showToast(
      'error',
      'Database Save Failed',
      'Unable to save consolation prize winners to the database. Please check your connection and try drawing again.',
      0,
    )
  } finally {
    // Remove from drawing set to allow button state to update
    drawingWinners.value.delete(prize.name)
  }
}

// Handle click outside dropdown
const handleClickOutside = (event: Event) => {
  const target = event.target as Element
  if (!target.closest('.dropdown-container')) {
    closeColumnDropdown()
  }
}

onMounted(async () => {
  // Track current admin authentication state
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentAdmin.value = {
        id: user.uid,
        email: user.email || 'Unknown',
        name: user.displayName || undefined,
      }
      console.log('Current admin:', currentAdmin.value)
    } else {
      currentAdmin.value = null
    }
  })

  // Load submissions first, then load existing winners
  await loadSubmissions()

  // Load existing winners after submissions are loaded
  await loadExistingWinners()

  // Add debug functions to window for testing (development only)
  if (import.meta.env.DEV) {
    ;(window as any).clearUsedWinners = () => {
      clearUsedWinnerIds()
      showToast('info', 'Debug', 'Cleared all used winner IDs')
    }
    ;(window as any).forceUpdate = () => {
      // Force reactivity update
      submissions.value = [...submissions.value]
      showToast('info', 'Debug', 'Forced reactivity update')
    }
  }

  // Add event listener for click outside dropdown
  document.addEventListener('click', handleClickOutside)
})

// Cleanup on unmount
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="w-full min-h-screen">
    <!-- Header -->
    <header class="shadow-lg flex h-[80px] border-gray-200 bg-[#d14124]">
      <div
        class="flex pl-3 w-full sm:pl-6 items-center pr-3 justify-between mx-auto sm:pr-6 max-w-[3200px]"
      >
        <!-- Brand Logo -->
        <div class="flex items-center">
          <img
            src="/imgs/tk-white.webp"
            alt="Tapa King logo"
            class="object-cover w-full h-10 rounded-lg sm:h-12"
          />
        </div>

        <div class="flex items-center space-x-3">
          <!-- Activity Log Button -->
          <button
            @click="toggleActivityLogModal"
            class="flex items-center px-3 py-2 space-x-2 text-white transition-colors duration-200 rounded-lg hover:text-gray-200 hover:bg-red-700"
            title="View Activity Logs"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              />
            </svg>
            <span class="hidden sm:inline">Activity Log</span>
          </button>

          <!-- Logout Button -->
          <button
            @click="handleLogout"
            :disabled="loggingOut"
            class="flex items-center justify-start px-4 py-2 ml-auto space-x-2 text-white transition-colors duration-200 rounded-lg hover:text-gray-200 hover:bg-red-700 sm:justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <!-- Loading Spinner -->
            <svg v-if="loggingOut" class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <!-- Logout Icon -->
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            <span class="hidden font-medium sm:inline">{{
              loggingOut ? 'Signing out...' : 'Logout'
            }}</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="px-3 pt-10 pb-10 sm:px-6 max-w-[3200px] mx-auto">
      <!-- Tab Navigation -->
      <div class="flex flex-col mb-3 sm:block">
        <div class="flex flex-col w-full mr-auto sm:block sm:mr-0">
          <nav class="flex flex-col flex-wrap w-full gap-2 mx-auto sm:mx-0 sm:flex-row">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              @click="setActiveTab(tab.id as TabType)"
              :class="[
                'inline-flex items-center px-4  py-2.5 text-sm font-medium rounded-lg focus:outline-none focus:ring-0 focus:ring-offset-0',
                activeTab === tab.id
                  ? 'text-white shadow-md'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:text-gray-900',
              ]"
              :style="activeTab === tab.id ? { backgroundColor: '#8a2a2b' } : {}"
            >
              <svg
                class="w-4 h-4 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" :d="tab.icon" />
              </svg>
              {{ tab.label }}
            </button>
          </nav>
        </div>
      </div>

      <!-- Tab Content -->
      <div class="bg-white min-h-[500px] rounded-lg shadow-sm">
        <!-- Raffle Entries Tab -->
        <div v-if="activeTab === 'raffle-entries'" class="p-3 sm:p-6">
          <div class="flex items-start justify-between mb-6">
            <div>
              <h2 class="text-2xl font-bold text-gray-900">Raffle Entries</h2>
              <p class="mt-1 text-gray-600">Manage and view all raffle entries</p>
            </div>

            <div class="flex space-x-4 sm:space-x-6">
              <!-- Refresh Button -->
              <button
                @click="refreshData"
                :disabled="loading"
                class="flex items-center px-3 py-2 space-x-2 text-blue-600 transition-colors duration-200 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                title="Refresh data from Firebase"
              >
                <svg
                  class="w-5 h-5"
                  :class="{ 'animate-spin': loading }"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span class="hidden sm:inline">
                  {{
                    loading
                      ? retryCount > 0
                        ? `Retry ${retryCount}/${maxRetries}`
                        : 'Loading...'
                      : 'Refresh'
                  }}
                </span>
              </button>
              <button
                @click="exportData"
                class="inline-flex items-center p-2 font-medium text-white transition-all duration-200 bg-blue-600 rounded-lg shadow-sm export-btn hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                title="Export Data"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span class="hidden ml-2 sm:inline">Export Data</span>
              </button>
            </div>
          </div>

          <!-- Loading State -->
          <div v-if="loading" class="flex flex-col items-center justify-center space-y-4 h-[400px]">
            <div class="w-12 h-12 border-b-2 border-blue-600 rounded-full animate-spin"></div>
            <span class="font-medium text-gray-600">Loading submissions...</span>
          </div>

          <!-- Retry State -->
          <div v-else-if="showRetryButton" class="flex flex-col items-center justify-center py-16">
            <div class="text-center">
              <svg
                class="w-16 h-16 mx-auto mb-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v6m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 class="mb-2 text-xl font-semibold text-gray-900">Unable to Connect</h3>
              <p class="max-w-md mb-4 text-gray-600">
                {{ error || 'Failed to load data from the server.' }}
              </p>
              <div class="flex items-center justify-center mb-6 space-x-2 text-sm">
                <div
                  :class="['w-3 h-3 rounded-full', isOnline ? 'bg-green-500' : 'bg-red-500']"
                ></div>
                <span :class="isOnline ? 'text-green-600' : 'text-red-600'">
                  {{ isOnline ? 'Internet Connected' : 'No Internet Connection' }}
                </span>
              </div>
              <div class="flex justify-center space-x-4">
                <button
                  @click="refreshData"
                  class="flex items-center px-6 py-3 space-x-2 font-medium text-white transition-colors duration-200 bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  <span>Refresh Data</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Stats Cards -->
          <div v-else class="grid grid-cols-2 gap-2 mb-6 lg:grid-cols-4 sm:gap-6 sm:mb-8">
            <!-- Total Users Card -->
            <div
              class="px-3 py-2 border border-blue-200 rounded-lg bg-gradient-to-r from-blue-50 to-blue-100 sm:p-6"
            >
              <div class="flex items-center">
                <div
                  class="flex items-center justify-center p-1 bg-blue-600 rounded sm:rounded-lg sm:p-2"
                >
                  <svg
                    class="w-5 h-5 text-white sm:w-6 sm:h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                </div>
                <div class="ml-2 sm:ml-4">
                  <p class="text-xs font-medium text-blue-600 sm:text-sm">Total Users</p>
                  <p class="text-sm font-bold text-blue-900 sm:text-2xl">
                    {{ stats.totalUsers.toLocaleString() }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Total Entries Card -->
            <div
              class="px-3 py-2 border border-purple-200 rounded-lg bg-gradient-to-r from-purple-50 to-purple-100 sm:p-6"
            >
              <div class="flex items-center">
                <div
                  class="flex items-center justify-center p-1 bg-purple-600 rounded sm:rounded-lg sm:p-2"
                >
                  <svg
                    class="w-5 h-5 text-white sm:w-6 sm:h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 11H5m14 0a2 2 0 002 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                </div>
                <div class="ml-2 sm:ml-4">
                  <p class="text-xs font-medium text-purple-600 sm:text-sm">Total Entries</p>
                  <p class="text-sm font-bold text-purple-900 sm:text-2xl">
                    {{ stats.totalEntries.toLocaleString() }}
                  </p>
                </div>
              </div>
            </div>

            <div
              class="px-3 py-2 border border-green-200 rounded-lg bg-gradient-to-r from-green-50 to-green-100 sm:p-6"
            >
              <div class="flex items-center">
                <div
                  class="flex items-center justify-center p-1 bg-green-600 rounded sm:rounded-lg sm:p-2"
                >
                  <svg
                    class="w-5 h-5 text-white sm:w-6 sm:h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div class="ml-2 sm:ml-4">
                  <p class="text-xs font-medium text-green-600 sm:text-sm">Valid Entries</p>
                  <p class="text-sm font-bold text-green-900 sm:text-2xl">
                    {{ stats.validEntries.toLocaleString() }}
                  </p>
                </div>
              </div>
            </div>

            <div
              class="px-3 py-2 border border-red-200 rounded-lg bg-gradient-to-r from-red-50 to-red-100 sm:p-6"
            >
              <div class="flex items-center">
                <div
                  class="flex items-center justify-center p-1 bg-red-600 rounded sm:rounded-lg sm:p-2 sm:w-auto sm:h-auto"
                >
                  <svg
                    class="w-5 h-5 text-white sm:w-6 sm:h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <div class="ml-2 sm:ml-4">
                  <p class="text-xs font-medium text-red-600 sm:text-sm">Invalid Entries</p>
                  <p class="text-sm font-bold text-red-900 sm:text-2xl">
                    {{ stats.invalidEntries.toLocaleString() }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Search and Filters -->
          <div
            v-if="!loading && !error"
            class="p-3 mb-6 bg-white border border-gray-200 shadow-sm rounded-xl sm:p-6"
          >
            <div class="mb-4">
              <h3 class="mb-1 text-lg font-semibold text-gray-900" >Filter & Search</h3>
              <p class="text-xs text-gray-500 sm:text-sm">
                Find specific entries or narrow down your results
              </p>
            </div>

            <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-6">
              <!-- Search Bar -->
              <div class="lg:col-span-2">
                <label for="search" class="block mb-3 text-sm font-semibold text-gray-900"
                  >Search Entries</label
                >
                <div class="relative">
                  <input
                    id="search"
                    v-model="searchTerm"
                    @input="resetPagination"
                    type="text"
                    maxlength="40"
                    placeholder="Search..."
                    class="w-full py-3 pl-12 pr-4 text-gray-900 placeholder-gray-500 transition-all duration-200 border border-gray-300 bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                  />
                  <div class="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
                    <svg
                      class="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </div>
                  <div
                    v-if="searchTerm"
                    @click="
                      () => {
                        searchTerm = ''
                        resetPagination()
                      }
                    "
                    class="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer"
                  >
                    <svg
                      class="w-5 h-5 text-gray-400 hover:text-gray-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Branch Filter -->
              <div>
                <label for="branch" class="block mb-3 text-sm font-semibold text-gray-900"
                  >Branch</label
                >
                <div class="relative">
                  <select
                    id="branch"
                    v-model="selectedBranch"
                    @change="resetPagination"
                    class="w-full px-4 py-3 pr-8 text-gray-900 truncate transition-all duration-200 border border-gray-300 appearance-none cursor-pointer bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                  >
                    <option value="" class="text-gray-500">All Branches</option>
                    <option
                      v-for="branch in availableBranches"
                      :key="branch"
                      :value="branch"
                      class="text-gray-900"
                    >
                      {{ branch }}
                    </option>
                  </select>
                  <div
                    class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none"
                  >
                    <svg
                      class="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Date Range with Modern Date Picker -->
              <div>
                <label class="block mb-3 text-sm font-semibold text-gray-900">Date Range</label>
                <div class="relative">
                  <!-- Calendar icon on left -->
                  <div
                    class="absolute inset-y-0 left-0 z-10 flex items-center pl-3 pointer-events-none"
                  >
                    <svg
                      class="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>

                  <!-- Date Picker Component -->
                  <VueDatePicker
                    v-model="dateRange"
                    @update:model-value="handleDateRangeChange"
                    range
                    :enable-time-picker="false"
                    auto-apply
                    :clearable="false"
                    placeholder="Select date"
                    format="MM/dd/yyyy - MM/dd/yyyy"
                    input-class="w-full px-4 py-3 pl-10 text-gray-900 transition-all duration-200 border border-gray-300 appearance-none cursor-pointer bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                    class="w-full"
                  />

                  <!-- Custom clear button on right -->
                  <div
                    v-if="dateRange"
                    class="absolute inset-y-0 right-0 z-10 flex items-center pr-3"
                  >
                    <button
                      @click="clearDateRange"
                      class="p-1 transition-colors duration-200 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      type="button"
                    >
                      <svg
                        class="w-4 h-4 text-gray-500 hover:text-gray-700"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Entry Status Filter -->
              <div>
                <label for="entryStatus" class="block mb-3 text-sm font-semibold text-gray-900"
                  >Entry Status</label
                >
                <div class="relative">
                  <select
                    id="entryStatus"
                    v-model="selectedEntryStatus"
                    @change="resetPagination"
                    class="w-full px-4 py-3 text-gray-900 transition-all duration-200 border border-gray-300 appearance-none cursor-pointer bg-gray-50 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                  >
                    <option value="" class="text-gray-500">All</option>
                    <option value="Valid" class="text-gray-900">Valid</option>
                    <option value="Invalid" class="text-gray-900">Invalid</option>
                  </select>
                  <div
                    class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none"
                  >
                    <svg
                      class="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <!-- Table Display Filter -->
              <div class="hidden sm:block">
                <label class="block mb-3 text-sm font-semibold text-gray-900">Table Display</label>
                <div class="relative">
                  <div class="dropdown-container">
                    <button
                      type="button"
                      class="w-full px-4 py-3 text-left text-gray-900 transition-all duration-200 border cursor-pointer rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-white"
                      :class="
                        showColumnDropdown
                          ? 'border-blue-500 bg-white ring-2 ring-blue-500'
                          : 'border-gray-300 bg-gray-50'
                      "
                      @click="toggleColumnDropdown"
                    >
                      <span class="text-sm">
                        {{
                          hasVisibleColumns
                            ? `${Object.values(visibleColumns).filter(Boolean).length} columns`
                            : 'No columns'
                        }}
                      </span>
                      <div
                        class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none"
                      >
                        <svg
                          class="w-5 h-5 text-gray-400"
                          :class="{ 'rotate-180': showColumnDropdown }"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </button>

                    <!-- Dropdown Content -->
                    <div
                      v-if="showColumnDropdown"
                      class="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg"
                      @click.stop
                    >
                      <!-- Select All/None Controls -->
                      <div class="p-3 border-b border-gray-200 bg-gray-50">
                        <div class="flex items-center justify-between">
                          <label class="flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              :checked="allColumnsVisible"
                              @change="
                                toggleAllColumns(($event.target as HTMLInputElement).checked)
                              "
                              class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            <span class="ml-2 text-sm font-medium text-gray-700">Select All</span>
                          </label>
                          <button
                            @click="toggleAllColumns(false)"
                            class="text-xs text-red-600 hover:text-red-800"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>

                      <!-- Column Checkboxes -->
                      <div class="p-2">
                        <label
                          v-for="column in tableColumns"
                          :key="column.key"
                          class="flex items-center w-full px-3 py-2 rounded-md cursor-pointer hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            :checked="visibleColumns[column.key]"
                            @change="toggleColumnVisibility(column.key)"
                            class="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span class="ml-3 text-sm text-gray-700">{{ column.label }}</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Filter Status and Actions -->
            <div
              class="flex flex-col pt-6 mt-6 space-y-4 border-t border-gray-100 lg:flex-row lg:items-center lg:justify-between lg:space-y-0"
            >
              <div
                class="flex flex-col space-y-3 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4"
              >
                <div class="text-sm font-medium text-gray-900">
                  <span class="font-bold text-blue-600">{{
                    filteredStats.totalEntries.toLocaleString()
                  }}</span>
                  entries from {{ filteredStats.totalUsers.toLocaleString() }} users
                  <span
                    v-if="
                      searchTerm ||
                      selectedBranch ||
                      selectedEntryStatus ||
                      startDate ||
                      endDate ||
                      !allColumnsVisible
                    "
                    class="ml-1 text-gray-500"
                    >(filtered)</span
                  >
                </div>

                <!-- Active Filters Display -->
                <div
                  v-if="
                    searchTerm ||
                    selectedBranch ||
                    selectedEntryStatus ||
                    startDate ||
                    endDate ||
                    !allColumnsVisible
                  "
                  class="flex flex-wrap items-center gap-2"
                >
                  <div class="flex items-center space-x-2">
                    <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span class="text-xs font-medium tracking-wide text-green-700 uppercase"
                      >Active Filters:</span
                    >
                  </div>

                  <!-- Search Filter Badge -->
                  <div
                    v-if="searchTerm"
                    class="inline-flex items-center px-3 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full"
                  >
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    "{{
                      searchTerm.length > 20 ? searchTerm.substring(0, 20) + '...' : searchTerm
                    }}"
                  </div>

                  <!-- Branch Filter Badge -->
                  <div
                    v-if="selectedBranch"
                    class="inline-flex items-center px-3 py-1 text-xs font-medium text-purple-800 bg-purple-100 rounded-full"
                  >
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h10"
                      />
                    </svg>
                    {{
                      selectedBranch.length > 20
                        ? selectedBranch.substring(0, 20) + '...'
                        : selectedBranch
                    }}
                  </div>

                  <!-- Date Filter Badge -->
                  <div
                    v-if="startDate || endDate"
                    class="inline-flex items-center px-3 py-1 text-xs font-medium text-green-800 bg-green-100 rounded-full"
                  >
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    {{
                      (() => {
                        const dateText =
                          formatDateForDisplay(startDate) +
                          (startDate && endDate ? ' to ' : '') +
                          formatDateForDisplay(endDate)
                        return dateText.length > 20 ? dateText.substring(0, 20) + '...' : dateText
                      })()
                    }}
                  </div>

                  <!-- Entry Status Filter Badge -->
                  <div
                    v-if="selectedEntryStatus"
                    class="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full text-amber-800 bg-amber-100"
                  >
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    {{ selectedEntryStatus }}
                  </div>

                  <!-- Table Display Filter Badge -->
                  <div
                    v-if="!allColumnsVisible"
                    class="inline-flex items-center px-3 py-1 text-xs font-medium text-indigo-800 bg-indigo-100 rounded-full"
                  >
                    {{ Object.values(visibleColumns).filter(Boolean).length }}/{{
                      tableColumns.length
                    }}
                    columns
                  </div>

                  <!-- Clear All Button -->
                  <button
                    @click="clearFilters"
                    class="inline-flex items-center px-3 py-1 text-xs font-medium text-red-700 transition-all duration-200 border border-red-300 rounded-full bg-red-50 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  >
                    <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    Clear All
                  </button>
                </div>
              </div>

              <div class="text-xs text-gray-500 lg:text-right">
                Last updated: {{ new Date().toLocaleTimeString() }}
              </div>
            </div>
          </div>

          <!-- Entries Table -->
          <div v-if="!loading && !error" class="space-y-4">
            <!-- Mobile/Tablet Responsive Table -->
            <div class="hidden overflow-x-auto border border-gray-200 rounded-lg sm:block">
              <div class="h-auto">
                <table class="min-w-full divide-y divide-gray-200">
                  <thead class="bg-gray-50">
                    <tr>
                      <th
                        v-for="column in filteredTableColumns"
                        :key="column.key"
                        :class="[
                          'px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider',
                          isColumnCentered(column.key) ? 'text-center' : 'text-left',
                          getColumnWidth(column.key),
                        ]"
                      >
                        <div
                          v-if="column.key === 'raffleEntries'"
                          class="flex items-center justify-center space-x-1"
                        >
                          <span class="font-medium">{{ column.label }}</span>
                          <svg
                            @click="toggleSort"
                            :class="[
                              'w-6 h-6 cursor-pointer transition-colors duration-200',
                              sortColumn === 'raffleEntries'
                                ? 'text-blue-600'
                                : 'text-gray-400 hover:text-gray-600',
                            ]"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              v-if="sortColumn === 'raffleEntries' && sortDirection === 'asc'"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                            />
                            <path
                              v-else-if="sortColumn === 'raffleEntries' && sortDirection === 'desc'"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"
                            />
                            <path
                              v-else
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
                            />
                          </svg>
                        </div>
                        <span v-else class="font-medium">{{ column.label }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody class="bg-white divide-y divide-gray-200">
                    <tr v-if="paginatedSubmissions.length === 0">
                      <td
                        :colspan="filteredTableColumns.length"
                        class="px-6 py-8 text-center text-gray-500"
                      >
                        No submissions found
                      </td>
                    </tr>
                    <tr
                      v-for="(submission, index) in paginatedSubmissions"
                      :key="submission.id"
                      class="hover:bg-gray-50"
                    >
                      <td
                        v-for="column in filteredTableColumns"
                        :key="column.key"
                        :class="[
                          'px-2 sm:px-4 py-1 sm:py-2 text-sm text-gray-900',
                          isColumnCentered(column.key) ? 'text-center' : 'text-left',
                          getColumnWidth(column.key),
                        ]"
                      >
                        <button
                          v-if="column.key === 'entryStatus'"
                          @click="toggleEntryStatus(submission, index)"
                          :disabled="statusUpdating.has(submission.id)"
                          :class="[
                            'inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full border-2 hover:opacity-80 transition-all duration-200',
                            {
                              'bg-green-100 text-green-800 border-green-300 hover:bg-green-200':
                                submission[column.key] === 'Valid' ||
                                submission[column.key] === 'Verified' ||
                                submission[column.key] === 'Approved',
                              'bg-red-100 text-red-800 border-red-300 hover:bg-red-200':
                                submission[column.key] === 'Invalid' ||
                                submission[column.key] === 'Pending' ||
                                !submission[column.key],
                              'opacity-75 cursor-not-allowed': statusUpdating.has(submission.id),
                            },
                          ]"
                        >
                          <div
                            v-if="statusUpdating.has(submission.id)"
                            class="w-3 h-3 border border-current rounded-full animate-spin border-t-transparent"
                          ></div>
                          <span>{{
                            statusUpdating.has(submission.id)
                              ? 'Updating...'
                              : submission[column.key] === 'Valid' ||
                                  submission[column.key] === 'Verified' ||
                                  submission[column.key] === 'Approved'
                                ? 'Valid'
                                : 'Invalid'
                          }}</span>
                        </button>
                        <button
                          v-else-if="column.key === 'receiptUpload' && submission[column.key]"
                          @click="
                            openReceiptModal(
                              submission[column.key],
                              submission.receiptNumber || 'N/A',
                            )
                          "
                          class="px-3 py-1 text-xs font-medium text-white transition-colors duration-200 bg-blue-600 rounded-md hover:bg-blue-700"
                        >
                          View Receipt
                        </button>
                        <div
                          v-else
                          class="truncate"
                          :title="
                            formatValue(
                              column.key === 'id'
                                ? submission.displayId
                                : (submission as any)[column.key],
                              column.key,
                            )
                          "
                        >
                          {{
                            formatValue(
                              column.key === 'id'
                                ? submission.displayId
                                : (submission as any)[column.key],
                              column.key,
                            )
                          }}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Mobile Card View -->
            <div class="space-y-4 sm:hidden">
              <div v-if="paginatedSubmissions.length === 0" class="py-8 text-center text-gray-500">
                No submissions found
              </div>
              <div
                v-for="submission in paginatedSubmissions"
                :key="submission.id"
                class="p-3 space-y-2 bg-white border border-gray-200 rounded-lg"
              >
                <div class="flex items-center justify-between pb-2 border-b">
                  <span class="text-sm font-medium text-gray-500"
                    >ID #{{ submission.displayId }}</span
                  >
                  <div
                    :class="[
                      'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
                      {
                        'bg-green-100 text-green-800':
                          submission.entryStatus === 'Valid' ||
                          submission.entryStatus === 'Verified' ||
                          submission.entryStatus === 'Approved',
                        'bg-red-100 text-red-800':
                          submission.entryStatus === 'Invalid' ||
                          submission.entryStatus === 'Pending' ||
                          !submission.entryStatus,
                      },
                    ]"
                  >
                    {{
                      submission.entryStatus === 'Valid' ||
                      submission.entryStatus === 'Verified' ||
                      submission.entryStatus === 'Approved'
                        ? 'Valid'
                        : 'Invalid'
                    }}
                  </div>
                </div>
                <div class="grid grid-cols-1 gap-2 text-sm">
                  <div v-if="submission.fullName">
                    <span class="font-medium text-gray-500">Name:</span>
                    <span class="ml-2 text-gray-900">{{ submission.fullName }}</span>
                  </div>
                  <div v-if="submission.email">
                    <span class="font-medium text-gray-500">Email:</span>
                    <span class="ml-2 text-gray-900">{{ submission.email }}</span>
                  </div>
                  <div v-if="submission.mobileNumber">
                    <span class="font-medium text-gray-500">Mobile:</span>
                    <span class="ml-2 text-gray-900">{{ submission.mobileNumber }}</span>
                  </div>
                  <div v-if="submission.raffleEntries">
                    <span class="font-medium text-gray-500">No. of Entries:</span>
                    <span class="ml-2 text-gray-900">{{ submission.raffleEntries }}</span>
                  </div>
                  <div v-if="submission.receiptNumber">
                    <span class="font-medium text-gray-500">Receipt Number:</span>
                    <span class="ml-2 text-gray-900">{{ submission.receiptNumber }}</span>
                  </div>
                  <div v-if="submission.purchaseAmount">
                    <span class="font-medium text-gray-500">Amount:</span>
                    <span class="ml-2 text-gray-900">{{
                      formatValue(submission.purchaseAmount, 'purchaseAmount')
                    }}</span>
                  </div>
                  <div v-if="submission.submittedAt">
                    <span class="font-medium text-gray-500">Submitted:</span>
                    <span class="ml-2 text-gray-900">{{
                      formatValue(submission.submittedAt, 'submittedAt')
                    }}</span>
                  </div>
                  <div v-if="submission.receiptUpload" class="flex items-center gap-2">
                    <span class="font-medium text-gray-500">Receipt:</span>
                    <button
                      @click="
                        openReceiptModal(
                          submission.receiptUpload,
                          submission.receiptNumber || 'N/A',
                        )
                      "
                      class="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700"
                    >
                      View Receipt
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pagination -->
            <div
              v-if="totalPages > 1"
              class="flex items-center justify-between py-3 bg-white border-t border-gray-200"
            >
              <div class="flex items-center justify-between flex-1 sm:hidden">
                <button
                  @click="goToPage(currentPage - 1)"
                  :disabled="currentPage === 1"
                  :class="[
                    'relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50',
                    currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50',
                  ]"
                >
                  Previous
                </button>
                <div class="text-sm font-medium text-gray-700">
                  {{ (currentPage - 1) * itemsPerPage + 1 }} to
                  {{ Math.min(currentPage * itemsPerPage, filteredSubmissions.length) }}
                </div>
                <button
                  @click="goToPage(currentPage + 1)"
                  :disabled="currentPage === totalPages"
                  :class="[
                    'relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50',
                    currentPage === totalPages
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-gray-50',
                  ]"
                >
                  Next
                </button>
              </div>
              <div class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                <div>
                  <p class="text-sm text-gray-700">
                    Showing
                    <span class="font-medium">{{ (currentPage - 1) * itemsPerPage + 1 }}</span>
                    to
                    <span class="font-medium">{{
                      Math.min(currentPage * itemsPerPage, filteredSubmissions.length)
                    }}</span>
                    of
                    <span class="font-medium">{{ filteredSubmissions.length }}</span>
                    results
                  </p>
                </div>
                <div>
                  <nav
                    class="inline-flex -space-x-px rounded-md shadow-sm isolate"
                    aria-label="Pagination"
                  >
                    <button
                      @click="goToPage(currentPage - 1)"
                      :disabled="currentPage === 1"
                      :class="[
                        'relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0',
                        currentPage === 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50',
                      ]"
                    >
                      <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fill-rule="evenodd"
                          d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </button>

                    <button
                      v-for="page in Math.min(totalPages, 7)"
                      :key="page"
                      @click="goToPage(page)"
                      :class="[
                        'relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-gray-300 focus:z-20 focus:outline-offset-0',
                        currentPage === page
                          ? 'z-10 bg-blue-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600'
                          : 'text-gray-900 bg-white hover:bg-blue-50 hover:text-blue-600',
                      ]"
                    >
                      {{ page }}
                    </button>

                    <button
                      @click="goToPage(currentPage + 1)"
                      :disabled="currentPage === totalPages"
                      :class="[
                        'relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0',
                        currentPage === totalPages
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-gray-50',
                      ]"
                    >
                      <svg class="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fill-rule="evenodd"
                          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                          clip-rule="evenodd"
                        />
                      </svg>
                    </button>
                  </nav>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pick Winners Tab -->
        <div v-else-if="activeTab === 'pick-winners'" class="p-3 sm:p-6">
          <!-- Loading state for winners -->
          <div
            v-if="winnersLoading"
            class="flex flex-col items-center justify-center space-y-4 h-[400px]"
          >
            <div class="w-12 h-12 border-b-2 border-purple-600 rounded-full animate-spin"></div>
            <span class="font-medium text-gray-600">Loading existing winners from database...</span>
          </div>
          <div v-else class="max-w-6xl mx-auto">
            <div class="mb-8 text-center">
              <h2 class="mb-4 text-3xl font-bold text-gray-900">
                Tapa King's Discover the Philippines Travel Raffle Promo
              </h2>
              <p class="mb-4 text-gray-600">
                Generate winners for Grand Prizes and Consolation Prizes from verified entries
              </p>
            </div>

            <!-- Valid/Invalid Entries Display Section -->
            <div class="mb-8">
              <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <!-- Valid Entries Container (Left) -->
                <div class="bg-white border border-gray-200 rounded-lg">
                  <div class="p-4 border-b border-gray-200">
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-semibold text-green-800">Valid Entries</h3>
                      <button
                        @click.stop="toggleValidEntries"
                        :class="[
                          'px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                          showValidEntries
                            ? 'bg-green-100 text-green-800 hover:bg-green-200'
                            : 'bg-green-600 text-white hover:bg-green-700',
                        ]"
                      >
                        {{ showValidEntries ? 'Hide' : 'Show' }} ({{ validEntriesList.length }})
                      </button>
                    </div>
                  </div>
                  <div v-if="showValidEntries" class="p-4">
                    <div
                      v-if="validEntriesList.length === 0"
                      class="py-8 text-center text-gray-500"
                    >
                      No valid entries found
                    </div>
                    <div v-else class="space-y-2 overflow-y-auto max-h-96">
                      <div
                        v-for="(entry, index) in validEntriesList"
                        :key="entry.id"
                        class="flex items-center justify-between p-3 border border-green-200 rounded-lg bg-green-50"
                      >
                        <div class="flex-1">
                          <div class="font-medium text-green-900">{{ entry.fullName }}</div>
                          <div class="text-sm text-green-600">
                            Entries: {{ entry.raffleEntries || 1 }}
                          </div>
                        </div>
                        <div class="text-sm font-medium text-green-800">#{{ index + 1 }}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Invalid Entries Container (Right) -->
                <div class="bg-white border border-gray-200 rounded-lg">
                  <div class="p-4 border-b border-gray-200">
                    <div class="flex items-center justify-between">
                      <h3 class="text-lg font-semibold text-red-800">Invalid Entries</h3>
                      <button
                        @click.stop="toggleInvalidEntries"
                        :class="[
                          'px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200',
                          showInvalidEntries
                            ? 'bg-red-100 text-red-800 hover:bg-red-200'
                            : 'bg-red-600 text-white hover:bg-red-700',
                        ]"
                      >
                        {{ showInvalidEntries ? 'Hide' : 'Show' }} ({{ invalidEntriesList.length }})
                      </button>
                    </div>
                  </div>
                  <div v-if="showInvalidEntries" class="p-4">
                    <div
                      v-if="invalidEntriesList.length === 0"
                      class="py-8 text-center text-gray-500"
                    >
                      No invalid entries found
                    </div>
                    <div v-else class="space-y-2 overflow-y-auto max-h-96">
                      <div
                        v-for="(entry, index) in invalidEntriesList"
                        :key="entry.id"
                        class="flex items-center justify-between p-3 border border-red-200 rounded-lg bg-red-50"
                      >
                        <div class="flex-1">
                          <div class="font-medium text-red-900">{{ entry.fullName }}</div>
                          <div class="text-sm text-red-600">
                            Entries: {{ entry.raffleEntries || 1 }}
                          </div>
                        </div>
                        <div class="text-sm font-medium text-red-800">#{{ index + 1 }}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Modern Stats Section (Centered) -->
            <div class="flex justify-center my-8" :key="eligibilityUpdateKey">
              <div class="w-full max-w-3xl">
                <div
                  class="p-4 border border-gray-200 rounded-lg bg-gradient-to-r from-green-50 via-blue-50 to-purple-50"
                >
                  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <!-- Total Eligible Entries Card -->
                    <div
                      class="relative overflow-hidden transition-all duration-200 bg-white border border-gray-200 shadow-sm rounded-xl hover:shadow-md"
                    >
                      <div class="p-4">
                        <div class="flex items-center">
                          <div class="flex-shrink-0">
                            <div
                              class="flex items-center justify-center w-10 h-10 bg-green-100 rounded-lg"
                            >
                              <svg
                                class="w-6 h-6 text-green-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            </div>
                          </div>
                          <div class="flex-1 ml-4">
                            <p class="text-sm font-medium tracking-wide text-gray-600 uppercase">
                              Total Eligible
                            </p>
                            <p class="text-2xl font-bold text-gray-900">
                              {{ stats.validEntries.toLocaleString() }}
                            </p>
                            <p class="text-xs font-medium text-green-600">Valid Entries</p>
                          </div>
                        </div>
                      </div>
                      <div
                        class="absolute top-0 right-0 w-16 h-16 transform translate-x-6 -translate-y-6 bg-green-100 rounded-full opacity-20"
                      ></div>
                    </div>

                    <!-- Total Prizes Card -->
                    <div
                      class="relative overflow-hidden transition-all duration-200 bg-white border border-gray-200 shadow-sm rounded-xl hover:shadow-md"
                    >
                      <div class="p-4">
                        <div class="flex items-center">
                          <div class="flex-shrink-0">
                            <div
                              class="flex items-center justify-center w-10 h-10 bg-purple-100 rounded-lg"
                            >
                              <svg
                                class="w-6 h-6 text-purple-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
                                />
                              </svg>
                            </div>
                          </div>
                          <div class="flex-1 ml-4">
                            <p class="text-sm font-medium tracking-wide text-gray-600 uppercase">
                              Total Prizes
                            </p>
                            <p class="text-2xl font-bold text-gray-900">46</p>
                            <p class="text-xs font-medium text-purple-600">
                              8 Grand + 38 Consolation
                            </p>
                          </div>
                        </div>
                      </div>
                      <div
                        class="absolute top-0 right-0 w-16 h-16 transform translate-x-6 -translate-y-6 bg-purple-100 rounded-full opacity-20"
                      ></div>
                    </div>
                  </div>

                  <!-- Additional Info Bar -->
                  <div
                    class="p-3 mt-4 border rounded-lg bg-white/60 backdrop-blur-sm border-white/20"
                  >
                    <div class="flex items-center justify-center space-x-6 text-sm">
                      <div class="flex items-center space-x-2">
                        <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span class="font-medium text-gray-700"
                          >{{ validEntriesList.length }} Participants Eligible</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-8" :key="`prizes-${eligibilityUpdateKey}`">
              <!-- Consolation Prizes Section (Top) -->
              <div class="p-3 bg-white border border-gray-200 rounded-lg sm:p-6">
                <div class="flex items-center mb-6">
                  <div
                    class="flex items-center justify-center w-10 h-10 mr-4 rounded-lg bg-gradient-to-r from-blue-400 to-indigo-500"
                  >
                    <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z" />
                    </svg>
                  </div>
                  <div>
                    <h3 class="text-xl font-bold text-gray-900">Consolation Prizes</h3>
                    <p class="text-sm text-gray-600">38 Winners Total</p>
                  </div>
                </div>

                <div class="space-y-4">
                  <div
                    v-for="(prize, index) in consolationPrizes"
                    :key="'consolation-' + index"
                    class="p-4 border border-gray-200 rounded-lg"
                  >
                    <div class="flex items-center justify-between mb-3">
                      <div>
                        <div class="flex items-center gap-2">
                          <h4 class="font-semibold text-gray-900">{{ prize.name }}</h4>
                        </div>
                        <p class="text-sm text-gray-600">{{ prize.count }} Winners</p>
                      </div>
                      <button
                        @click="drawConsolationPrize(index)"
                        :disabled="
                          isPrizeComplete(prize) ||
                          (prize.winners.length >= prize.count &&
                            prize.winners.filter((w) => !winnerStatus[w.id]).length > 0) ||
                          stats.validEntries === 0 ||
                          drawingWinners.has(prize.name) ||
                          eligibleEntries.length < getRemainingWinnersNeeded(prize)
                        "
                        class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-all duration-200 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 disabled:from-gray-400 disabled:to-gray-500"
                      >
                        <svg
                          v-if="drawingWinners.has(prize.name)"
                          class="w-4 h-4 animate-spin"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        {{
                          drawingWinners.has(prize.name)
                            ? 'Drawing...'
                            : isPrizeComplete(prize)
                              ? 'Complete'
                              : prize.winners.length >= prize.count &&
                                  prize.winners.filter((w) => !winnerStatus[w.id]).length > 0
                                ? `Pending Review (${getRemainingWinnersNeeded(prize)} more needed)`
                                : eligibleEntries.length < getRemainingWinnersNeeded(prize)
                                  ? `Need ${getRemainingWinnersNeeded(prize)} (${eligibleEntries.length} available)`
                                  : getConfirmedWinnersCount(prize.winners) === 0
                                    ? `Draw ${prize.count} ${prize.count === 1 ? 'Winner' : 'Winners'}`
                                    : `Draw another ${getRemainingWinnersNeeded(prize)} ${getRemainingWinnersNeeded(prize) === 1 ? 'Winner' : 'Winners'}`
                        }}
                      </button>
                    </div>

                    <div
                      v-if="prize.winners.length > 0 && !drawingWinners.has(prize.name)"
                      :class="[
                        'border rounded-lg p-3',
                        getPrizeBackgroundClass(prize.winners, 'consolation'),
                      ]"
                    >
                      <div class="flex items-center justify-between mb-3">
                        <h5
                          :class="[
                            'text-sm font-medium',
                            hasPrizeRejections(prize.winners) ? 'text-orange-800' : 'text-blue-800',
                          ]"
                        >
                          Winners ({{ prize.winners.length }}):
                        </h5>
                        <div class="flex items-center gap-2 text-xs">
                          <span
                            v-if="
                              prize.winners.filter((w) => winnerStatus[w.id] === 'confirmed')
                                .length > 0
                            "
                            class="inline-flex items-center px-2 py-1 font-medium text-green-800 bg-green-100 rounded-full"
                          >
                            ✓
                            {{
                              prize.winners.filter((w) => winnerStatus[w.id] === 'confirmed').length
                            }}
                            Confirmed
                          </span>
                          <span
                            v-if="
                              prize.winners.filter((w) => winnerStatus[w.id] === 'rejected')
                                .length > 0
                            "
                            class="inline-flex items-center px-2 py-1 font-medium text-red-800 bg-red-100 rounded-full"
                          >
                            ✗
                            {{
                              prize.winners.filter((w) => winnerStatus[w.id] === 'rejected').length
                            }}
                            Rejected
                          </span>
                          <span
                            v-if="prize.winners.filter((w) => !winnerStatus[w.id]).length > 0"
                            class="inline-flex items-center px-2 py-1 font-medium text-yellow-800 bg-yellow-100 rounded-full"
                          >
                            ⏳ {{ prize.winners.filter((w) => !winnerStatus[w.id]).length }} Pending
                          </span>
                        </div>
                      </div>
                      <div class="grid gap-2">
                        <div
                          v-for="winner in getSortedWinners(prize.winners)"
                          :key="winner.id"
                          class="relative"
                        >
                          <button
                            @click="openWinnerModal(winner, prize.name)"
                            :class="[
                              'inline-flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-md border w-full',
                              winnerStatus[winner.id] === 'confirmed'
                                ? 'bg-green-50 text-green-800 hover:bg-green-100 border-green-200'
                                : winnerStatus[winner.id] === 'rejected'
                                  ? 'bg-red-50 text-red-800 hover:bg-red-100 border-red-200'
                                  : 'bg-yellow-50 text-yellow-800 hover:bg-yellow-100 border-yellow-200 cursor-pointer',
                            ]"
                          >
                            <div class="flex items-center gap-2">
                              <span
                                v-if="winnerStatus[winner.id] === 'confirmed'"
                                class="text-lg font-bold text-green-600"
                                >✓</span
                              >
                              <span
                                v-else-if="winnerStatus[winner.id] === 'rejected'"
                                class="text-lg font-bold text-red-600"
                                >✗</span
                              >
                              <span v-else class="text-lg font-bold text-yellow-600">⏳</span>
                              <span class="font-semibold">{{ winner.fullName }}</span>
                            </div>
                            <div class="text-right">
                              <div
                                v-if="winnerStatus[winner.id] === 'confirmed'"
                                class="text-xs font-medium tracking-wide text-green-600 uppercase"
                              >
                                Confirmed
                              </div>
                              <div
                                v-else-if="winnerStatus[winner.id] === 'rejected'"
                                class="text-xs font-medium tracking-wide text-red-600 uppercase"
                              >
                                Rejected
                              </div>
                              <div
                                v-else
                                class="text-xs font-medium tracking-wide text-yellow-600 uppercase"
                              >
                                Pending
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Grand Prizes Section (Bottom) -->
              <div class="p-3 bg-white border border-gray-200 rounded-lg sm:p-6">
                <div class="flex items-center mb-6">
                  <div
                    class="flex items-center justify-center w-10 h-10 mr-4 rounded-lg bg-gradient-to-r from-yellow-400 to-orange-500"
                  >
                    <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 class="text-xl font-bold text-gray-900">Grand Prizes</h3>
                    <p class="text-sm text-gray-600">8 Winners Total</p>
                  </div>
                </div>

                <div class="space-y-4">
                  <div
                    v-for="(prize, index) in grandPrizes"
                    :key="'grand-' + index"
                    class="p-4 border border-gray-200 rounded-lg"
                  >
                    <div class="flex items-center justify-between mb-3">
                      <div>
                        <div class="flex items-center gap-2">
                          <h4 class="font-semibold text-gray-900">{{ prize.name }}</h4>
                        </div>
                        <p class="text-sm text-gray-600">
                          {{ prize.count }} {{ prize.count === 1 ? 'Winner' : 'Winners' }}
                        </p>
                      </div>
                      <button
                        @click="drawGrandPrize(index)"
                        :disabled="
                          isPrizeComplete(prize) ||
                          (prize.winners.length >= prize.count &&
                            prize.winners.filter((w) => !winnerStatus[w.id]).length > 0) ||
                          stats.validEntries === 0 ||
                          drawingWinners.has(prize.name) ||
                          eligibleEntries.length < getRemainingWinnersNeeded(prize)
                        "
                        class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-all duration-200 rounded-lg bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:from-gray-400 disabled:to-gray-500"
                      >
                        <svg
                          v-if="drawingWinners.has(prize.name)"
                          class="w-4 h-4 animate-spin"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        {{
                          drawingWinners.has(prize.name)
                            ? 'Drawing...'
                            : isPrizeComplete(prize)
                              ? 'Complete'
                              : prize.winners.length >= prize.count &&
                                  prize.winners.filter((w) => !winnerStatus[w.id]).length > 0
                                ? `Pending Review (${getRemainingWinnersNeeded(prize)} more needed)`
                                : eligibleEntries.length < getRemainingWinnersNeeded(prize)
                                  ? `Need ${getRemainingWinnersNeeded(prize)} (${eligibleEntries.length} available)`
                                  : getConfirmedWinnersCount(prize.winners) === 0
                                    ? `Draw ${prize.count} ${prize.count === 1 ? 'Winner' : 'Winners'}`
                                    : `Draw another ${getRemainingWinnersNeeded(prize)} ${getRemainingWinnersNeeded(prize) === 1 ? 'Winner' : 'Winners'}`
                        }}
                      </button>
                    </div>

                    <div
                      v-if="prize.winners.length > 0 && !drawingWinners.has(prize.name)"
                      :class="[
                        'border rounded-lg p-3',
                        getPrizeBackgroundClass(prize.winners, 'grand'),
                      ]"
                    >
                      <div class="flex items-center justify-between mb-3">
                        <h5
                          :class="[
                            'text-sm font-medium',
                            hasPrizeRejections(prize.winners)
                              ? 'text-orange-800'
                              : 'text-green-800',
                          ]"
                        >
                          Winners:
                        </h5>
                        <div class="flex items-center gap-2 text-xs">
                          <span
                            v-if="
                              prize.winners.filter((w) => winnerStatus[w.id] === 'confirmed')
                                .length > 0
                            "
                            class="inline-flex items-center px-2 py-1 font-medium text-green-800 bg-green-100 rounded-full"
                          >
                            ✓
                            {{
                              prize.winners.filter((w) => winnerStatus[w.id] === 'confirmed').length
                            }}
                            Confirmed
                          </span>
                          <span
                            v-if="
                              prize.winners.filter((w) => winnerStatus[w.id] === 'rejected')
                                .length > 0
                            "
                            class="inline-flex items-center px-2 py-1 font-medium text-red-800 bg-red-100 rounded-full"
                          >
                            ✗
                            {{
                              prize.winners.filter((w) => winnerStatus[w.id] === 'rejected').length
                            }}
                            Rejected
                          </span>
                          <span
                            v-if="prize.winners.filter((w) => !winnerStatus[w.id]).length > 0"
                            class="inline-flex items-center px-2 py-1 font-medium text-yellow-800 bg-yellow-100 rounded-full"
                          >
                            ⏳ {{ prize.winners.filter((w) => !winnerStatus[w.id]).length }} Pending
                          </span>
                        </div>
                      </div>
                      <div class="space-y-2">
                        <div
                          v-for="winner in getSortedWinners(prize.winners)"
                          :key="winner.id"
                          class="relative"
                        >
                          <button
                            @click="openWinnerModal(winner, prize.name)"
                            :class="[
                              'inline-flex flex-col items-start gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:shadow-md border w-full',
                              winnerStatus[winner.id] === 'confirmed'
                                ? 'bg-green-50 text-green-800 hover:bg-green-100 border-green-200'
                                : winnerStatus[winner.id] === 'rejected'
                                  ? 'bg-red-50 text-red-800 hover:bg-red-100 border-red-200'
                                  : 'bg-yellow-50 text-yellow-800 hover:bg-yellow-100 border-yellow-200 cursor-pointer',
                            ]"
                          >
                            <div class="flex items-center justify-between w-full">
                              <div class="flex items-center gap-2">
                                <div class="flex items-center gap-1">
                                  <span
                                    v-if="winnerStatus[winner.id] === 'confirmed'"
                                    class="text-lg font-bold text-green-600"
                                    >✓</span
                                  >
                                  <span
                                    v-else-if="winnerStatus[winner.id] === 'rejected'"
                                    class="text-lg font-bold text-red-600"
                                    >✗</span
                                  >
                                  <span v-else class="text-lg font-bold text-yellow-600">⏳</span>
                                  <span class="font-semibold">{{ winner.fullName }}</span>
                                </div>
                              </div>
                              <div class="text-right">
                                <div
                                  v-if="winnerStatus[winner.id] === 'confirmed'"
                                  class="text-xs font-medium tracking-wide text-green-600 uppercase"
                                >
                                  Confirmed
                                </div>
                                <div
                                  v-else-if="winnerStatus[winner.id] === 'rejected'"
                                  class="text-xs font-medium tracking-wide text-red-600 uppercase"
                                >
                                  Rejected
                                </div>
                                <div
                                  v-else
                                  class="text-xs font-medium tracking-wide text-yellow-600 uppercase"
                                >
                                  Pending
                                </div>
                              </div>
                            </div>
                            <div class="w-full mt-1">
                              <div class="text-xs text-left opacity-75">
                                <span v-if="drawTime[winner.id]"
                                  >Drew: {{ drawTime[winner.id] }}</span
                                >
                                <span
                                  v-if="
                                    winnerStatus[winner.id] === 'rejected' &&
                                    rejectionReasons[winner.id]
                                  "
                                  class="block mt-1 text-red-600"
                                >
                                  Reason: {{ rejectionReasons[winner.id] }}
                                </span>
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Winner Summary -->
            <div v-if="isAnyPrizeDrawn" class="p-6 mt-8 rounded-lg bg-gray-50">
              <h3 class="mb-4 text-lg font-bold text-gray-900">Winner Summary</h3>
              <div class="grid gap-6 md:grid-cols-2">
                <div v-if="consolationPrizes.some((p) => p.winners.length > 0)">
                  <h4 class="mb-2 font-semibold text-gray-800">
                    Consolation Prize Winners ({{ totalConsolationWinners }})
                  </h4>
                  <div class="space-y-3">
                    <div
                      v-for="prize in consolationPrizes.filter((p) => p.winners.length > 0)"
                      :key="prize.name"
                      class="text-sm"
                    >
                      <span class="font-medium text-blue-700">{{ prize.name }}:</span>
                      <div class="flex flex-wrap gap-1 mt-1">
                        <button
                          v-for="winner in getSortedWinners(prize.winners)"
                          :key="winner.id"
                          @click="openWinnerModal(winner, prize.name)"
                          :class="[
                            'inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-all duration-200 hover:shadow-sm',
                            winnerStatus[winner.id] === 'confirmed'
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : winnerStatus[winner.id] === 'rejected'
                                ? 'bg-red-100 text-red-800 hover:bg-red-200'
                                : 'bg-blue-100 text-blue-800 hover:bg-blue-200 cursor-pointer',
                          ]"
                        >
                          <span v-if="getWinnerStatusIcon(winner.id)" class="text-xs font-bold">{{
                            getWinnerStatusIcon(winner.id)
                          }}</span>
                          {{ winner.fullName }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="grandPrizes.some((p) => p.winners.length > 0)">
                  <h4 class="mb-2 font-semibold text-gray-800">
                    Grand Prize Winners ({{ totalGrandWinners }})
                  </h4>
                  <div class="space-y-3">
                    <div
                      v-for="prize in grandPrizes.filter((p) => p.winners.length > 0)"
                      :key="prize.name"
                      class="text-sm"
                    >
                      <span class="font-medium text-yellow-700">{{ prize.name }}:</span>
                      <div class="flex flex-wrap gap-1 mt-1">
                        <button
                          v-for="winner in getSortedWinners(prize.winners)"
                          :key="winner.id"
                          @click="openWinnerModal(winner, prize.name)"
                          :class="[
                            'inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-all duration-200 hover:shadow-sm',
                            winnerStatus[winner.id] === 'confirmed'
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : winnerStatus[winner.id] === 'rejected'
                                ? 'bg-red-100 text-red-800 hover:bg-red-200'
                                : 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200 cursor-pointer',
                          ]"
                        >
                          <span v-if="getWinnerStatusIcon(winner.id)" class="text-xs font-bold">{{
                            getWinnerStatusIcon(winner.id)
                          }}</span>
                          {{ winner.fullName }}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Insights Tab -->
        <div v-else-if="activeTab === 'insights'" class="p-3 sm:p-6">
          <div>
            <h2 class="mb-3 text-2xl font-bold text-gray-900 sm:mb-6">Insights & Analytics</h2>

            <!-- Top Stats Row -->
            <div class="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-6 sm:gap-4 sm:mb-8">
              <div
                class="flex flex-col items-center justify-center p-3 text-center bg-white border border-gray-200 rounded-lg sm:text-center"
              >
                <div class="mb-1 text-2xl font-bold text-blue-600 sm:text-3xl">
                  {{ stats.totalUsers }}
                </div>
                <div class="text-sm text-gray-600">Total Users</div>
              </div>

              <div
                class="flex flex-col items-center justify-center p-3 text-center bg-white border border-gray-200 rounded-lg sm:text-center"
              >
                <div class="mb-1 text-2xl font-bold text-purple-600 sm:text-3xl">
                  {{ stats.totalEntries }}
                </div>
                <div class="text-sm text-gray-600">Total Entries</div>
              </div>

              <div
                class="flex flex-col items-center justify-center p-3 text-center bg-white border border-gray-200 rounded-lg sm:text-center"
              >
                <div class="mb-1 text-2xl font-bold text-green-600 sm:text-3xl">
                  {{ stats.validEntries }}
                </div>
                <div class="text-sm text-gray-600">Valid Entries</div>
              </div>

              <div
                class="flex flex-col items-center justify-center p-3 text-center bg-white border border-gray-200 rounded-lg sm:text-center"
              >
                <div class="mb-1 text-2xl font-bold text-red-600 sm:text-3xl">
                  {{ stats.invalidEntries }}
                </div>
                <div class="text-sm text-gray-600">Invalid Entries</div>
              </div>

              <div
                class="flex flex-col items-center justify-center p-3 text-center bg-white border border-gray-200 rounded-lg sm:text-center"
              >
                <div class="mb-1 text-2xl font-bold text-green-600 sm:text-3xl">
                  ₱{{
                    submissions
                      .reduce((sum, s) => sum + (s.purchaseAmount || 0), 0)
                      .toLocaleString()
                  }}
                </div>
                <div class="text-sm text-gray-600">Total Revenue</div>
              </div>

              <div
                class="flex flex-col items-center justify-center p-3 text-center bg-white border border-gray-200 rounded-lg sm:p-6 sm:block sm:text-center sm:mr-0"
              >
                <div class="px-2 mb-1 text-sm font-semibold text-gray-800 sm:text-lg">
                  {{ topBranch }}
                </div>
                <div class="text-xs text-gray-600 sm:text-sm">Top Branch</div>
              </div>
            </div>

            <!-- Charts Grid -->
            <div class="grid grid-cols-1 gap-6 mb-6 lg:grid-cols-2 sm:mb-8">
              <!-- Entries by Branch -->
              <div class="p-3 bg-white border border-gray-200 rounded-lg sm:p-6">
                <div class="mb-4">
                  <h3 class="text-lg font-semibold text-gray-900">Entries by Branch</h3>
                  <p class="mt-1 text-sm text-gray-500">
                    Distribution of raffle entries across all
                    {{ branchAnalysisData?.labels?.length || 0 }} branches
                  </p>
                </div>
                <div class="relative h-72">
                  <BarChart
                    v-if="
                      filteredSubmissions.length > 0 &&
                      branchAnalysisData &&
                      branchAnalysisData.labels &&
                      branchAnalysisData.labels.length > 0
                    "
                    :data="branchAnalysisData"
                    :height="260"
                    :width="500"
                    :key="`branch-chart-${filteredSubmissions.length}-${searchTerm}-${selectedBranch}-${startDate}-${endDate}`"
                    :options="{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          grid: { color: 'rgba(0,0,0,0.1)' },
                        },
                        x: {
                          ticks: {
                            maxRotation: 45,
                            minRotation: 0,
                            autoSkip: false,
                            maxTicksLimit: 30,
                          },
                          grid: { display: false },
                        },
                      },
                    }"
                  />
                  <div v-else class="flex items-center justify-center h-full text-gray-500">
                    <div class="text-center">
                      <svg
                        class="w-12 h-12 mx-auto mb-2 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      <p>Loading chart data...</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Revenue by Branch -->
              <div class="p-3 bg-white border border-gray-200 rounded-lg sm:p-6">
                <div class="mb-4">
                  <h3 class="text-lg font-semibold text-gray-900">Revenue by Branch</h3>
                  <p class="mt-1 text-sm text-gray-500">
                    Total purchase amounts from all
                    {{ branchRevenueData?.labels?.length || 0 }} branches
                  </p>
                </div>
                <div class="relative h-72">
                  <BarChart
                    v-if="
                      filteredSubmissions.length > 0 &&
                      branchRevenueData &&
                      branchRevenueData.labels &&
                      branchRevenueData.labels.length > 0
                    "
                    :data="branchRevenueData"
                    :height="260"
                    :width="500"
                    :key="`revenue-chart-${filteredSubmissions.length}-${searchTerm}-${selectedBranch}-${startDate}-${endDate}`"
                    :options="{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          grid: { color: 'rgba(0,0,0,0.1)' },
                          ticks: {
                            callback: function (value) {
                              return '₱' + value.toLocaleString()
                            },
                          },
                        },
                        x: {
                          ticks: {
                            maxRotation: 45,
                            minRotation: 0,
                            autoSkip: false,
                            maxTicksLimit: 30,
                          },
                          grid: { display: false },
                        },
                      },
                    }"
                  />
                  <div v-else class="flex items-center justify-center h-full text-gray-500">
                    <div class="text-center">
                      <svg
                        class="w-12 h-12 mx-auto mb-2 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      <p>Loading chart data...</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Age Distribution -->
              <div class="p-3 bg-white border border-gray-200 rounded-lg sm:p-6">
                <div class="mb-4">
                  <h3 class="text-lg font-semibold text-gray-900">Age Distribution</h3>
                  <p class="mt-1 text-sm text-gray-500">
                    Age breakdown of all {{ ageDistributionData?.labels?.length || 0 }} age groups
                  </p>
                </div>
                <div class="relative h-80">
                  <PieChart
                    v-if="
                      filteredSubmissions.length > 0 &&
                      ageDistributionData &&
                      ageDistributionData.datasets &&
                      ageDistributionData.datasets[0] &&
                      ageDistributionData.datasets[0].data.length > 0
                    "
                    :data="ageDistributionData"
                    :height="300"
                    :width="400"
                    :key="`age-chart-${filteredSubmissions.length}-${searchTerm}-${selectedBranch}-${startDate}-${endDate}`"
                    :options="{
                      responsive: true,
                      maintainAspectRatio: false,
                      layout: {
                        padding: {
                          bottom: 20,
                        },
                      },
                      plugins: {
                        legend: {
                          display: true,
                          position: 'bottom',
                          align: 'center',
                          labels: {
                            padding: 8,
                            usePointStyle: false,
                            font: {
                              size: 11,
                            },
                            boxWidth: 14,
                            boxHeight: 14,
                            generateLabels: function (chart) {
                              const data = chart.data
                              if (data.labels.length && data.datasets.length) {
                                return data.labels.map((label, i) => {
                                  const dataset = data.datasets[0]
                                  const value = dataset.data[i] as number
                                  const total = (dataset.data as number[]).reduce(
                                    (a, b) => a + b,
                                    0,
                                  )
                                  const percentage =
                                    total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
                                  return {
                                    text: `${label}: ${value} (${percentage}%)`,
                                    fillStyle: (dataset.backgroundColor as string[])[i],
                                    strokeStyle: (dataset.backgroundColor as string[])[i],
                                    pointStyle: 'rect',
                                    hidden: false,
                                    index: i,
                                  }
                                })
                              }
                              return []
                            },
                          },
                        },
                        tooltip: {
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          titleColor: '#111827',
                          bodyColor: '#374151',
                          borderColor: '#e5e7eb',
                          borderWidth: 1,
                          cornerRadius: 8,
                          displayColors: true,
                          callbacks: {
                            label: function (context) {
                              const label = context.label || ''
                              const value = context.parsed
                              const total = (context.dataset.data as number[]).reduce(
                                (a, b) => a + b,
                                0,
                              )
                              const percentage =
                                total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
                              return `${label}: ${value} (${percentage}%)`
                            },
                          },
                        },
                      },
                      elements: {
                        arc: {
                          borderWidth: 2,
                          borderColor: '#ffffff',
                        },
                      },
                    }"
                  />
                  <div v-else class="flex items-center justify-center h-full text-gray-500">
                    <div class="text-center">
                      <svg
                        class="w-12 h-12 mx-auto mb-2 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                        />
                      </svg>
                      <p>Loading chart data...</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Entries per Day -->
              <div class="p-3 bg-white border border-gray-200 rounded-lg sm:p-6">
                <h3 class="mb-1 text-lg font-semibold text-gray-900">Entries per Day</h3>
                <p class="mb-4 text-sm text-gray-600">Daily entry distribution in percentage</p>
                <div class="relative h-72">
                  <BarChart
                    v-if="
                      filteredSubmissions.length > 0 &&
                      entriesPerDayData &&
                      entriesPerDayData.labels &&
                      entriesPerDayData.labels.length > 0
                    "
                    :data="entriesPerDayData"
                    :height="260"
                    :width="500"
                    :key="`bar-chart-${filteredSubmissions.length}-${searchTerm}-${selectedBranch}-${startDate}-${endDate}`"
                  />
                  <div v-else class="flex items-center justify-center h-full text-gray-500">
                    <div class="text-center">
                      <svg
                        class="w-12 h-12 mx-auto mb-2 text-gray-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                        />
                      </svg>
                      <p>Loading chart data...</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Additional Analytics -->
            <div class="grid grid-cols-1 gap-6 mb-6 lg:grid-cols-2 sm:mb-8">
              <!-- Summary Statistics -->
              <div class="p-6 bg-white border border-gray-200 rounded-lg">
                <h3 class="mb-4 text-lg font-semibold text-gray-900">Summary Statistics</h3>
                <div class="space-y-4">
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-600">Average Entries per User:</span>
                    <span class="font-semibold text-gray-900">
                      {{ (stats.totalEntries / Math.max(stats.totalUsers, 1)).toFixed(2) }}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-600">Average Purchase Amount:</span>
                    <span class="font-semibold text-gray-900">
                      ₱{{
                        (
                          submissions.reduce((sum, s) => sum + (s.purchaseAmount || 0), 0) /
                          Math.max(stats.totalUsers, 1)
                        ).toFixed(2)
                      }}
                    </span>
                  </div>
                  <!-- <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-600">Validation Rate:</span>
                    <span class="font-semibold text-gray-900">
                      {{
                        stats.totalUsers > 0
                          ? ((stats.validEntries / stats.totalUsers) * 100).toFixed(1)
                          : 0
                      }}%
                    </span>
                  </div> -->
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-gray-600">Total Branches:</span>
                    <span class="font-semibold text-gray-900">
                      {{ availableBranches.length }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Recent Activity -->
              <div class="p-6 bg-white border border-gray-200 rounded-lg">
                <h3 class="mb-4 text-lg font-semibold text-gray-900">Recent Activity</h3>
                <div class="space-y-3">
                  <div class="flex items-center space-x-3">
                    <div class="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span class="text-sm text-gray-600">
                      {{ stats.validEntries }} valid entries processed
                    </span>
                  </div>
                  <div class="flex items-center space-x-3">
                    <div class="w-2 h-2 bg-red-500 rounded-full"></div>
                    <span class="text-sm text-gray-600">
                      {{ stats.invalidEntries }} entries need review
                    </span>
                  </div>
                  <div class="flex items-center space-x-3">
                    <div class="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span class="text-sm text-gray-600">
                      {{ submissions.length }} total submissions
                    </span>
                  </div>
                  <div class="flex items-center space-x-3">
                    <div class="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <span class="text-sm text-gray-600">
                      {{ topBranch }} is the top performing branch
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Top Participants List -->
            <div
              v-if="filteredSubmissions.length"
              class="p-6 bg-white border border-gray-200 rounded-lg"
            >
              <h3 class="mb-4 text-lg font-semibold text-gray-900">Top Participants</h3>
              <div class="space-y-3">
                <div
                  v-for="(submission, index) in topParticipants"
                  :key="submission.id"
                  class="flex items-center justify-between py-3 border-b border-gray-100 last:border-b-0"
                >
                  <div class="flex items-center space-x-3">
                    <div class="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-full">
                      <span class="text-sm font-medium text-blue-600">{{ index + 1 }}</span>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium text-gray-900 truncate sm:text-base">
                        {{ submission.fullName || 'Anonymous' }}
                      </p>
                      <p class="text-xs text-gray-500 truncate sm:text-sm">
                        {{ submission.branch || 'Unknown Branch' }}
                      </p>
                    </div>
                  </div>
                  <div class="text-right">
                    <p class="font-medium text-gray-900">
                      {{ submission.raffleEntries || 1 }} entries
                    </p>
                    <p class="text-sm text-gray-500">
                      ₱{{ (submission.purchaseAmount || 0).toLocaleString() }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Winner Information Modal -->
    <div
      v-if="showWinnerModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      @click.self="closeWinnerModal"
    >
      <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div
          class="sticky top-0 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200"
        >
          <div>
            <h3 class="text-xl font-bold text-gray-900">Winner Information</h3>
            <p class="text-sm text-gray-600">{{ selectedPrizeName }}</p>
          </div>
          <button
            @click="closeWinnerModal"
            class="text-gray-400 transition-colors duration-200 hover:text-gray-600"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div v-if="selectedWinner" class="p-6">
          <!-- Winner Status Badge -->
          <div class="flex justify-center mb-6">
            <div
              :class="[
                'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium',
                winnerStatus[selectedWinner.id] === 'confirmed'
                  ? 'bg-green-100 text-green-800'
                  : winnerStatus[selectedWinner.id] === 'rejected'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800',
              ]"
            >
              <span v-if="getWinnerStatusIcon(selectedWinner.id)" class="text-lg">{{
                getWinnerStatusIcon(selectedWinner.id)
              }}</span>
              <span>{{
                winnerStatus[selectedWinner.id] === 'confirmed'
                  ? 'Confirmed Winner'
                  : winnerStatus[selectedWinner.id] === 'rejected'
                    ? 'Rejected'
                    : 'Pending Verification'
              }}</span>
            </div>
          </div>

          <!-- Winner Details -->
          <div class="grid gap-6 md:grid-cols-2">
            <div class="space-y-4">
              <h4 class="pb-2 text-lg font-semibold text-gray-900 border-b border-gray-200">
                Personal Information
              </h4>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Full Name</label>
                <p class="font-medium text-gray-900">{{ selectedWinner.fullName || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Email</label>
                <p class="text-gray-900">{{ selectedWinner.email || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Mobile Number</label>
                <p class="text-gray-900">{{ selectedWinner.mobileNumber || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Birthdate</label>
                <p class="text-gray-900">{{ selectedWinner.birthdate || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Address</label>
                <p class="text-gray-900">{{ selectedWinner.residentialAddress || 'N/A' }}</p>
              </div>
            </div>

            <div class="space-y-4">
              <h4 class="pb-2 text-lg font-semibold text-gray-900 border-b border-gray-200">
                Entry Details
              </h4>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Branch</label>
                <p class="text-gray-900">{{ selectedWinner.branch || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700"
                  >Number of Entries</label
                >
                <p class="font-medium text-gray-900">{{ selectedWinner.raffleEntries || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Purchase Amount</label>
                <p class="text-gray-900">
                  ₱{{ selectedWinner.purchaseAmount?.toLocaleString() || 'N/A' }}
                </p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Date of Purchase</label>
                <p class="text-gray-900">{{ selectedWinner.dateOfPurchase || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Receipt Number</label>
                <p class="text-gray-900">{{ selectedWinner.receiptNumber || 'N/A' }}</p>
              </div>

              <div>
                <label class="block mb-1 text-sm font-medium text-gray-700">Draw Time</label>
                <p class="font-medium text-gray-900">{{ drawTime[selectedWinner.id] || 'N/A' }}</p>
              </div>

              <!-- Rejection Reason (only show if rejected) -->
              <div
                v-if="
                  winnerStatus[selectedWinner.id] === 'rejected' &&
                  rejectionReasons[selectedWinner.id]
                "
              >
                <label class="block mb-1 text-sm font-medium text-red-700">Rejection Reason</label>
                <div class="p-3 border border-red-200 rounded-lg bg-red-50">
                  <p class="text-sm text-red-800">{{ rejectionReasons[selectedWinner.id] }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Receipt Button -->
          <div v-if="selectedWinner.receiptUpload" class="mt-6">
            <h4 class="pb-2 mb-4 text-lg font-semibold text-gray-900 border-b border-gray-200">
              {{
                Array.isArray(selectedWinner.receiptUpload) &&
                selectedWinner.receiptUpload.length > 1
                  ? 'Receipts'
                  : 'Receipt'
              }}
            </h4>
            <div class="flex justify-center">
              <button
                @click="
                  openReceiptModal(
                    selectedWinner.receiptUpload,
                    selectedWinner.receiptNumber || 'N/A',
                  )
                "
                class="flex items-center px-6 py-3 space-x-2 font-medium text-white transition-colors duration-200 bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                <span>View Receipt</span>
              </button>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex justify-center pt-6 mt-8 space-x-4 border-t border-gray-200">
            <button
              @click="confirmWinner"
              :disabled="winnerStatus[selectedWinner.id] === 'confirmed' || confirmationInProgress"
              class="flex items-center px-6 py-3 space-x-2 font-medium text-white transition-colors duration-200 bg-green-600 rounded-lg hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed"
            >
              <svg
                v-if="confirmationInProgress"
                class="w-5 h-5 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>{{
                confirmationInProgress
                  ? 'Processing...'
                  : winnerStatus[selectedWinner.id] === 'confirmed'
                    ? 'Confirmed'
                    : 'Confirm Winner'
              }}</span>
            </button>

            <button
              @click="rejectWinner"
              :disabled="winnerStatus[selectedWinner.id] === 'rejected'"
              class="flex items-center px-6 py-3 space-x-2 font-medium text-white transition-colors duration-200 bg-red-600 rounded-lg hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span>{{
                winnerStatus[selectedWinner.id] === 'rejected' ? 'Rejected' : 'Reject Winner'
              }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Rejection Reason Modal -->
    <div
      v-if="showRejectReasonModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      @click.self="closeRejectReasonModal"
    >
      <div class="w-full max-w-md bg-white rounded-lg shadow-xl">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h3 class="text-lg font-bold text-gray-900">Reject Winner</h3>
            <p class="text-sm text-gray-600">
              {{ selectedWinner?.fullName }} - {{ selectedPrizeName }}
            </p>
          </div>
          <button
            @click="closeRejectReasonModal"
            class="text-gray-400 transition-colors duration-200 hover:text-gray-600"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div class="p-6">
          <div class="mb-4">
            <label for="rejection-reason" class="block mb-2 text-sm font-medium text-gray-700">
              Reason for Rejection <span class="text-red-500">*</span>
            </label>
            <textarea
              id="rejection-reason"
              v-model="rejectionReason"
              rows="4"
              class="w-full px-3 py-2 text-gray-900 placeholder-gray-500 bg-white border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:outline-none"
              placeholder="Please provide a reason for rejecting this winner..."
              required
              @keydown.esc="closeRejectReasonModal"
              ref="rejectionTextarea"
            ></textarea>
          </div>

          <div class="flex justify-end space-x-3">
            <button
              @click="closeRejectReasonModal"
              class="px-4 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              @click="confirmRejectWinner"
              :disabled="!rejectionReason.trim() || rejectionInProgress"
              class="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 bg-red-600 rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <svg
                v-if="rejectionInProgress"
                class="w-4 h-4 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {{ rejectionInProgress ? 'Processing...' : 'Confirm Rejection' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Receipt Modal -->
    <div
      v-if="showReceiptModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <!-- Background overlay -->
      <div
        class="fixed inset-0 transition-opacity bg-black bg-opacity-50"
        @click="closeReceiptModal"
      ></div>

      <!-- Modal panel -->
      <div
        class="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
      >
        <div class="p-4 sm:p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-sm font-semibold text-gray-900 sm:text-lg" id="modal-title">
              Receipt/Invoice Number - {{ selectedReceipt.number }}
            </h3>
            <button
              @click="closeReceiptModal"
              class="text-gray-400 transition-colors hover:text-gray-600"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div class="flex justify-center min-h-[400px] items-center relative">
            <!-- Loading Spinner -->
            <div
              v-if="receiptLoading"
              class="absolute inset-0 z-10 flex items-center justify-center"
            >
              <div class="w-8 h-8 border-b-2 border-blue-600 rounded-full animate-spin"></div>
            </div>

            <!-- Navigation buttons -->
            <button
              v-if="selectedReceipt.urls.length > 1 && selectedReceipt.currentIndex > 0"
              @click="previousImage"
              class="absolute z-20 p-2 text-white transition-all transform -translate-y-1/2 bg-black bg-opacity-50 rounded-full left-2 top-1/2 hover:bg-opacity-70"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            <button
              v-if="
                selectedReceipt.urls.length > 1 &&
                selectedReceipt.currentIndex < selectedReceipt.urls.length - 1
              "
              @click="nextImage"
              class="absolute z-20 p-2 text-white transition-all transform -translate-y-1/2 bg-black bg-opacity-50 rounded-full right-2 top-1/2 hover:bg-opacity-70"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>

            <img
              v-if="selectedReceipt.urls.length > 0"
              :src="selectedReceipt.urls[selectedReceipt.currentIndex]"
              :alt="`Receipt ${selectedReceipt.number} - Image ${selectedReceipt.currentIndex + 1}`"
              class="max-w-full max-h-[70vh] min-h-[300px] object-contain"
              @load="receiptLoading = false"
              @loadstart="receiptLoading = true"
              @error="
                receiptLoading = false
                ;($event.target as HTMLImageElement).src =
                  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMDAgNzBWMTMwTTcwIDEwMEgxMzAiIHN0cm9rZT0iIzlDQTNBRiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KPHN2Zz4K'
              "
            />

            <!-- Image thumbnails for multiple images -->
            <div
              v-if="selectedReceipt.urls.length > 1"
              class="absolute flex p-2 space-x-2 transform -translate-x-1/2 bg-black bg-opacity-50 rounded-lg bottom-4 left-1/2"
            >
              <button
                v-for="(url, index) in selectedReceipt.urls"
                :key="index"
                @click="
                  () => {
                    selectedReceipt.currentIndex = index
                    receiptLoading = true
                  }
                "
                :class="[
                  'w-3 h-3 rounded-full transition-all',
                  selectedReceipt.currentIndex === index
                    ? 'bg-white'
                    : 'bg-white bg-opacity-50 hover:bg-opacity-75',
                ]"
              ></button>
            </div>
          </div>

          <!-- Keyboard navigation hint -->
          <div
            v-if="selectedReceipt.urls.length > 1"
            class="mt-4 text-xs text-center text-gray-500"
          >
            Use ← → arrow keys to navigate between images
          </div>
        </div>
      </div>
    </div>

    <!-- Activity Log Modal -->
    <div
      v-if="showActivityLogModal"
      class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <!-- Background overlay -->
      <div
        class="fixed inset-0 transition-opacity bg-black bg-opacity-50"
        @click="showActivityLogModal = false"
      ></div>

      <!-- Modal panel -->
      <div
        class="min-h-[320px] relative bg-white rounded-t-xl sm:rounded-lg shadow-xl w-full max-w-4xl h-[90vh] sm:max-h-[90vh] overflow-hidden"
      >
        <!-- Modal header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-200 sm:p-6">
          <div class="flex items-center space-x-3">
            <div
              class="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-lg sm:w-10 sm:h-10"
            >
              <svg
                class="w-4 h-4 text-blue-600 sm:w-6 sm:h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
            </div>
            <div>
              <h2 class="text-lg font-semibold text-gray-900 sm:text-xl">Activity Log</h2>
              <p class="hidden text-sm text-gray-600 sm:block">Recent changes and activities</p>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <button
              @click="loadActivityLogs"
              :disabled="activityLogsLoading"
              class="flex items-center px-2 py-1.5 sm:px-3 sm:py-2 text-xs sm:text-sm font-medium text-blue-600 transition-colors duration-200 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              <svg
                class="w-3 h-3 sm:w-4 sm:h-4 sm:mr-2"
                :class="{ 'animate-spin': activityLogsLoading }"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span class="hidden sm:inline">Refresh</span>
            </button>
            <button @click="showActivityLogModal = false" class="text-gray-400 hover:text-gray-600">
              <svg
                class="w-5 h-5 sm:w-6 sm:h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- Modal content -->
        <div class="p-4 sm:p-6 overflow-y-auto h-[calc(90vh-80px)] sm:max-h-[calc(90vh-120px)]">
          <!-- Loading state -->
          <div v-if="activityLogsLoading" class="flex items-center justify-center min-h-full">
            <div class="text-center">
              <div
                class="w-8 h-8 mx-auto mb-4 border-b-2 border-blue-600 rounded-full animate-spin"
              ></div>
              <p class="text-gray-600">Fetching activity logs...</p>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else-if="activityLogs.length === 0" class="py-12 text-center">
            <div class="w-16 h-16 mx-auto mb-4 text-gray-400">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <h3 class="mb-2 text-lg font-medium text-gray-900">No Activities Yet</h3>
            <p class="text-gray-600">Activity logs will appear here when actions are performed.</p>
          </div>

          <!-- Activity logs list -->
          <div v-else class="space-y-3 sm:space-y-4">
            <div
              v-for="log in activityLogs"
              :key="log.id"
              class="p-3 transition-colors border border-gray-200 rounded-lg sm:p-4 hover:bg-gray-50"
            >
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between">
                <div class="flex-1">
                  <div class="flex items-center justify-between mb-2 sm:justify-start sm:space-x-2">
                    <span
                      :class="[
                        'inline-flex items-center px-2 py-1 text-xs font-medium rounded-full',
                        log.action === 'STATUS_UPDATE'
                          ? 'bg-blue-100 text-blue-800'
                          : log.action === 'WINNER_DRAW'
                            ? 'bg-purple-100 text-purple-800'
                            : log.action === 'WINNER_REJECTION'
                              ? 'bg-red-100 text-red-800'
                              : log.action === 'WINNER_CONFIRMATION'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800',
                      ]"
                    >
                      {{
                        log.action === 'STATUS_UPDATE'
                          ? 'Status Update'
                          : log.action === 'WINNER_DRAW'
                            ? 'Winner Draw'
                            : log.action === 'WINNER_REJECTION'
                              ? 'Winner Rejection'
                              : log.action === 'WINNER_CONFIRMATION'
                                ? 'Winner Confirmation'
                                : log.action
                      }}
                    </span>
                    <!-- Admin information -->
                    <div
                      v-if="log.adminName || log.adminEmail"
                      class="inline-flex items-center px-2.5 py-1 ml-2 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-medium"
                    >
                      <svg
                        class="w-3 h-3 mr-1.5 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        ></path>
                      </svg>
                      <span
                        class="truncate max-w-32 sm:max-w-48"
                        :title="log.adminName || log.adminEmail"
                      >
                        {{ log.adminName || log.adminEmail }}
                      </span>
                    </div>
                    <!-- Mobile timestamp -->
                    <div class="text-xs text-gray-500 sm:hidden">
                      <div v-if="log.timestamp">
                        <!-- Enhanced timestamp for Winner Draw on mobile -->
                        <div
                          v-if="log.action === 'WINNER_DRAW'"
                          class="bg-purple-100 px-1.5 py-0.5 rounded text-purple-800 text-xs"
                        >
                          <span class="font-medium">Drew:</span>
                          {{
                            log.timestamp.toDate
                              ? log.timestamp.toDate().toLocaleDateString()
                              : new Date(log.timestamp).toLocaleDateString()
                          }}
                        </div>
                        <!-- Enhanced timestamp for Winner Rejection on mobile -->
                        <div
                          v-else-if="log.action === 'WINNER_REJECTION'"
                          class="bg-red-100 px-1.5 py-0.5 rounded text-red-800 text-xs"
                        >
                          <span class="font-medium">Rejected:</span>
                          {{
                            log.timestamp.toDate
                              ? log.timestamp.toDate().toLocaleDateString()
                              : new Date(log.timestamp).toLocaleDateString()
                          }}
                        </div>
                        <!-- Enhanced timestamp for Winner Confirmation on mobile -->
                        <div
                          v-else-if="log.action === 'WINNER_CONFIRMATION'"
                          class="bg-green-100 px-1.5 py-0.5 rounded text-green-800 text-xs"
                        >
                          <span class="font-medium">Confirmed:</span>
                          {{
                            log.timestamp.toDate
                              ? log.timestamp.toDate().toLocaleDateString()
                              : new Date(log.timestamp).toLocaleDateString()
                          }}
                        </div>
                        <!-- Regular timestamp for other actions -->
                        <div v-else>
                          {{
                            log.timestamp.toDate
                              ? log.timestamp.toDate().toLocaleDateString()
                              : new Date(log.timestamp).toLocaleDateString()
                          }}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="mb-2 text-sm text-gray-800">
                    <!-- Enhanced display for Winner Draw actions -->
                    <div v-if="log.action === 'WINNER_DRAW' && log.details?.winners">
                      <div class="mb-2 font-semibold text-purple-900">{{ log.description }}</div>
                      <div class="p-3 border border-purple-200 rounded-lg bg-purple-50">
                        <div
                          class="mb-2 text-xs font-medium tracking-wide text-purple-800 uppercase"
                        >
                          {{ log.details.winners.length === 1 ? 'Winner' : 'Winners' }} Selected:
                        </div>
                        <div class="space-y-2">
                          <div
                            v-for="(winner, index) in log.details.winners"
                            :key="winner.id"
                            class="flex items-center justify-between p-2 bg-white border border-purple-100 rounded"
                          >
                            <div class="flex-1">
                              <div class="font-semibold text-gray-900">{{ winner.name }}</div>
                              <div class="text-xs text-gray-600">
                                {{ winner.email }} • {{ winner.mobileNumber }}
                              </div>
                              <div class="text-xs text-purple-600">
                                {{ winner.entries }}
                                {{ winner.entries === 1 ? 'entry' : 'entries' }}
                              </div>
                            </div>
                            <div class="text-xs text-right text-gray-500">
                              Winner #{{ index + 1 }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <!-- Enhanced display for Winner Rejection actions -->
                    <div v-else-if="log.action === 'WINNER_REJECTION'">
                      <div class="mb-2 font-semibold text-red-900">
                        {{
                          log.description.includes('. Reason:')
                            ? log.description.split('. Reason:')[0]
                            : log.description
                        }}
                      </div>
                      <div class="p-3 border border-red-200 rounded-lg bg-red-50">
                        <div class="mb-2 text-xs font-medium tracking-wide text-red-800 uppercase">
                          🚫 Rejected Winner Details:
                        </div>
                        <div class="p-2 mb-3 bg-white border border-red-100 rounded">
                          <div class="font-semibold text-gray-900">{{ log.targetName }}</div>
                          <div v-if="log.details" class="text-xs text-gray-600">
                            {{ log.details.email }} • {{ log.details.mobileNumber }}
                          </div>
                          <div class="text-xs font-medium text-red-600">
                            Prize: {{ log.details?.prizeName }}
                          </div>
                        </div>
                        <!-- Display rejection reason from details or extract from description -->
                        <div class="p-3 bg-red-100 border border-red-200 rounded">
                          <div
                            class="mb-2 text-xs font-medium tracking-wide text-red-800 uppercase"
                          >
                            📝 Rejection Reason:
                          </div>
                          <div
                            class="p-2 text-sm font-medium text-red-900 bg-white border border-red-300 rounded"
                          >
                            {{
                              log.details?.rejectionReason ||
                              (log.description.includes('. Reason:')
                                ? log.description.split('. Reason:')[1]
                                : 'No reason provided')
                            }}
                          </div>
                        </div>
                      </div>
                    </div>
                    <!-- Enhanced display for Winner Confirmation actions -->
                    <div v-else-if="log.action === 'WINNER_CONFIRMATION'">
                      <div class="mb-2 font-semibold text-green-900">{{ log.description }}</div>
                      <div class="p-3 border border-green-200 rounded-lg bg-green-50">
                        <div
                          class="mb-2 text-xs font-medium tracking-wide text-green-800 uppercase"
                        >
                          ✅ Confirmed Winner:
                        </div>
                        <div class="p-2 bg-white border border-green-100 rounded">
                          <div class="font-semibold text-gray-900">{{ log.targetName }}</div>
                          <div v-if="log.details" class="text-xs text-gray-600">
                            {{ log.details.email }} • {{ log.details.mobileNumber }}
                          </div>
                          <div class="text-xs font-medium text-green-600">
                            Prize: {{ log.details?.prizeName }}
                          </div>
                        </div>
                      </div>
                    </div>
                    <!-- Regular display for other actions -->
                    <div v-else>
                      <div
                        v-if="log.description.includes('Full name:')"
                        v-html="log.description"
                      ></div>
                      <div v-else>
                        <div v-if="log.targetName" class="mb-1.5">
                          Full name: <span class="font-bold">{{ log.targetName }}</span>
                        </div>
                        <div v-html="log.description"></div>
                      </div>
                    </div>
                  </div>
                  <div v-if="log.oldValue && log.newValue" class="text-xs text-gray-600">
                    <div class="flex flex-row items-center">
                      <span class="font-medium">Changed from:</span>
                      <span class="ml-1">{{ log.oldValue }}</span>
                      <span class="inline mx-2">→</span>
                      <span class="font-medium sm:ml-2">to:</span>
                      <span class="ml-1">{{ log.newValue }}</span>
                    </div>
                  </div>
                </div>
                <!-- Desktop timestamp and admin info -->
                <div class="hidden ml-4 text-xs text-right text-gray-500 sm:block">
                  <div v-if="log.timestamp">
                    <!-- Enhanced timestamp for Winner Draw -->
                    <div
                      v-if="log.action === 'WINNER_DRAW'"
                      class="px-2 py-1 text-purple-800 bg-purple-100 rounded"
                    >
                      <div class="text-xs font-medium tracking-wide uppercase">Drew Time</div>
                      <div class="font-semibold">
                        {{
                          log.timestamp.toDate
                            ? log.timestamp.toDate().toLocaleString()
                            : new Date(log.timestamp).toLocaleString()
                        }}
                      </div>
                    </div>
                    <!-- Enhanced timestamp for Winner Rejection -->
                    <div
                      v-else-if="log.action === 'WINNER_REJECTION'"
                      class="px-2 py-1 text-red-800 bg-red-100 rounded"
                    >
                      <div class="text-xs font-medium tracking-wide uppercase">Rejected</div>
                      <div class="font-semibold">
                        {{
                          log.timestamp.toDate
                            ? log.timestamp.toDate().toLocaleString()
                            : new Date(log.timestamp).toLocaleString()
                        }}
                      </div>
                    </div>
                    <!-- Enhanced timestamp for Winner Confirmation -->
                    <div
                      v-else-if="log.action === 'WINNER_CONFIRMATION'"
                      class="px-2 py-1 text-green-800 bg-green-100 rounded"
                    >
                      <div class="text-xs font-medium tracking-wide uppercase">Confirmed</div>
                      <div class="font-semibold">
                        {{
                          log.timestamp.toDate
                            ? log.timestamp.toDate().toLocaleString()
                            : new Date(log.timestamp).toLocaleString()
                        }}
                      </div>
                    </div>
                    <!-- Regular timestamp for other actions -->
                    <div v-else>
                      {{
                        log.timestamp.toDate
                          ? log.timestamp.toDate().toLocaleString()
                          : new Date(log.timestamp).toLocaleString()
                      }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Logout Overlay -->
    <div
      v-if="loggingOut"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm"
    >
      <div class="flex flex-col items-center p-8 bg-white rounded-lg shadow-xl">
        <!-- Spinner -->
        <svg class="w-12 h-12 mb-4 text-red-600 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
        <!-- Text -->
        <p class="text-lg font-semibold text-gray-800">Signing out...</p>
        <p class="text-sm text-gray-600">Please wait while we log you out</p>
      </div>
    </div>
  </div>

  <!-- Modern Toast Notifications -->
  <div v-if="toasts.length > 0" class="fixed inset-0 pointer-events-none" style="z-index: 50">
    <!-- Background overlay for important alerts -->
    <div
      v-if="toasts.some((t) => t.type === 'warning' || t.type === 'error')"
      class="fixed inset-0 pointer-events-auto bg-black/20 backdrop-blur-sm"
      @click="toasts.forEach((toast) => removeToast(toast.id))"
    ></div>

    <!-- Toast Container - Top Right for success/info, Center for warnings/errors -->
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="[
        'fixed pointer-events-auto transform transition-all duration-500 ease-out',
        toast.type === 'warning' || toast.type === 'error'
          ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
          : 'top-4 right-4 translate-x-0 translate-y-0',
      ]"
    >
      <div
        :class="[
          'max-w-md w-full mx-auto shadow-xl rounded-2xl overflow-hidden transform transition-all duration-500 ease-out',
          'animate-in slide-in-from-top-2 fade-in duration-500',
          toast.type === 'warning' || toast.type === 'error'
            ? 'bg-white border-2 scale-105 shadow-2xl'
            : 'bg-white/95 backdrop-blur-sm border',
          toast.type === 'success'
            ? 'border-green-200 bg-green-50/95'
            : toast.type === 'error'
              ? 'border-red-300'
              : toast.type === 'warning'
                ? 'border-amber-300'
                : 'border-blue-200 bg-blue-50/95',
        ]"
        :style="
          toast.type === 'warning' || toast.type === 'error'
            ? 'min-width: 420px'
            : 'min-width: 350px'
        "
      >
        <!-- Alert Header -->
        <div
          :class="[
            'px-4 py-3 border-b',
            toast.type === 'success'
              ? 'bg-green-100 border-green-200'
              : toast.type === 'error'
                ? 'bg-red-100 border-red-200'
                : toast.type === 'warning'
                  ? 'bg-amber-100 border-amber-200'
                  : 'bg-blue-100 border-blue-200',
          ]"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-2">
              <!-- Icon -->
              <div
                :class="[
                  'flex items-center justify-center w-8 h-8 rounded-full',
                  toast.type === 'success'
                    ? 'bg-green-200 text-green-700'
                    : toast.type === 'error'
                      ? 'bg-red-200 text-red-700'
                      : toast.type === 'warning'
                        ? 'bg-amber-200 text-amber-700'
                        : 'bg-blue-200 text-blue-700',
                ]"
              >
                <!-- Success Icon -->
                <svg
                  v-if="toast.type === 'success'"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
                <!-- Error Icon -->
                <svg
                  v-else-if="toast.type === 'error'"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  ></path>
                </svg>
                <!-- Warning Icon -->
                <svg
                  v-else-if="toast.type === 'warning'"
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z"
                  ></path>
                </svg>
                <!-- Info Icon -->
                <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  ></path>
                </svg>
              </div>
              <h3
                :class="[
                  'font-semibold text-sm',
                  toast.type === 'success'
                    ? 'text-green-900'
                    : toast.type === 'error'
                      ? 'text-red-900'
                      : toast.type === 'warning'
                        ? 'text-amber-900'
                        : 'text-blue-900',
                ]"
              >
                {{ toast.title }}
              </h3>
            </div>
            <button
              @click="removeToast(toast.id)"
              :class="[
                'rounded-full p-1 transition-all duration-200 hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1',
                toast.type === 'success'
                  ? 'text-green-600 hover:bg-green-200 focus:ring-green-500'
                  : toast.type === 'error'
                    ? 'text-red-600 hover:bg-red-200 focus:ring-red-500'
                    : toast.type === 'warning'
                      ? 'text-amber-600 hover:bg-amber-200 focus:ring-amber-500'
                      : 'text-blue-600 hover:bg-blue-200 focus:ring-blue-500',
              ]"
            >
              <span class="sr-only">Close</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                ></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- Alert Content -->
        <div class="p-4">
          <p
            :class="[
              'text-sm leading-relaxed',
              toast.type === 'success'
                ? 'text-green-800'
                : toast.type === 'error'
                  ? 'text-red-800'
                  : toast.type === 'warning'
                    ? 'text-amber-800'
                    : 'text-blue-800',
            ]"
          >
            {{ toast.message }}
          </p>
        </div>

        <!-- Progress bar for timed toasts -->
        <div
          v-if="toast.duration && toast.duration > 0"
          :class="[
            'h-1 transition-all ease-linear overflow-hidden',
            toast.type === 'success'
              ? 'bg-green-200'
              : toast.type === 'error'
                ? 'bg-red-200'
                : toast.type === 'warning'
                  ? 'bg-amber-200'
                  : 'bg-blue-200',
          ]"
        >
          <div
            :class="[
              'h-full transition-all ease-linear progress-bar',
              toast.type === 'success'
                ? 'bg-gradient-to-r from-green-500 to-green-600'
                : toast.type === 'error'
                  ? 'bg-gradient-to-r from-red-500 to-red-600'
                  : toast.type === 'warning'
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600',
            ]"
            :style="`animation: progress-countdown ${toast.duration}ms linear forwards;`"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Enhanced Toast animations */
@keyframes animate-in {
  0% {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  50% {
    opacity: 0.8;
    transform: translateY(-5px) scale(1.02);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes progress-countdown {
  0% {
    width: 100%;
  }
  100% {
    width: 0%;
  }
}

@keyframes pulse-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.3);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
  }
}

.animate-in {
  animation: animate-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.slide-in-from-top-2 {
  animation: animate-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.fade-in {
  animation: fade-in 0.3s ease-out forwards;
}

.progress-bar {
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

.scale-105 {
  transform: scale(1.05);
}

/* Dropdown transition styles */
.dropdown-container .rotate-180 {
  transform: rotate(180deg);
  transition: transform 0.2s ease;
}

.dropdown-container svg {
  transition: transform 0.2s ease;
}

/* Custom styles for the date picker */
:deep(.dp-custom-input),
:deep(.dp__input) {
  width: 100% !important;
  padding: 12px 16px !important;
  padding-left: 44px !important;
  padding-right: 44px !important;
  background-color: #f9fafb !important;
  border: 1px solid #d1d5db !important;
  border-radius: 12px !important;
  color: #111827 !important;
  transition: all 0.2s ease !important;
  font-size: 14px !important;
  font-family: inherit !important;
}

:deep(.dp-custom-input:focus),
:deep(.dp__input:focus) {
  background-color: #ffffff !important;
  border-color: #3b82f6 !important;
  outline: none !important;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1) !important;
}

/* Date picker placeholder color - black as requested */
:deep(.dp-custom-input::placeholder),
:deep(.dp__input::placeholder) {
  color: #000000 !important;
  font-weight: normal !important;
}

:deep(.dp__clear_icon) {
  display: none !important;
}

:deep(.dp__input_wrap) {
  width: 100% !important;
}

:deep(.dp__input_icon) {
  display: none !important;
}

:deep(.dp__main) {
  font-family: inherit;
}

:deep(.dp__menu) {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    0 4px 6px -2px rgba(0, 0, 0, 0.05);
}

:deep(.dp__cell_inner) {
  border-radius: 8px;
}

:deep(.dp__range_start),
:deep(.dp__range_end),
:deep(.dp__active_date) {
  background-color: #3b82f6 !important;
  color: white !important;
}

:deep(.dp__range_between) {
  background-color: rgba(59, 130, 246, 0.1) !important;
  color: #3b82f6 !important;
}

/* Custom select arrow */
select {
  background-image: none;
}

/* Improve text visibility */
input::placeholder {
  color: #6b7280 !important;
}

select option {
  background-color: white;
  color: #111827;
  padding: 8px;
}

/* Focus states for better accessibility */
input:focus,
select:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

/* Modern button styles */
button:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

/* Filter badge animations */
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

/* Custom scrollbar for filter area */
.filter-scroll::-webkit-scrollbar {
  height: 4px;
}

.filter-scroll::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 2px;
}

.filter-scroll::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 2px;
}

.filter-scroll::-webkit-scrollbar-thumb:hover {
  background: #94a3b8;
}

/* Export button hover effect */
.export-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
}
</style>

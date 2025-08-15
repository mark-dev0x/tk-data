import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Validate required fields (silently)
if (!firebaseConfig.projectId || !firebaseConfig.apiKey) {
  throw new Error('Firebase configuration is incomplete - check environment variables')
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

// Silent initialization check
try {
  // Validate Firebase connection without logging sensitive info
  if (!firebaseConfig.projectId) {
    throw new Error('Project ID not configured')
  }
} catch (error) {
  console.error('Firebase initialization failed')
  throw error
}

export interface Submission {
  id: string
  raffleEntries?: number
  entryStatus?: string
  fullName?: string
  mobileNumber?: string
  email?: string
  birthdate?: string
  residentialAddress?: string
  branch?: string
  dateOfPurchase?: string
  purchaseAmount?: number
  receiptNumber?: string
  receiptUpload?: string[]
  submittedAt?: any
}

export interface ActivityLog {
  id?: string
  action: string
  description: string
  targetId?: string
  targetName?: string
  oldValue?: string
  newValue?: string
  timestamp: any
  details?: any
  adminId?: string
  adminEmail?: string
  adminName?: string
}

export async function getSubmissions(): Promise<Submission[]> {
  // Check network connectivity first
  if (!navigator.onLine) {
    throw new Error('No internet connection available')
  }

  // Add timeout to Firebase calls
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Firebase request timeout after 30 seconds')), 30000)
  })

  try {
    // Test basic Firebase connectivity with a simple operation first
    console.log('Testing Firebase connection...')
    const submissionsRef = collection(db, 'raffle-entries-test-123')

    // Try without orderBy first to see if it's a permissions issue
    console.log('Getting documents...')
    const querySnapshot = await Promise.race([getDocs(submissionsRef), timeoutPromise])

    console.log(`Found ${querySnapshot.size} documents`)

    if (querySnapshot.size === 0) {
      console.warn('No documents found in submissions collection')
      return []
    }

    const submissions: Submission[] = []
    querySnapshot.forEach((doc) => {
      const data = doc.data()
      console.log(`Document:`, doc.id, data)
      submissions.push({
        id: doc.id, // Use Firebase document ID for consistency
        raffleEntries: data.raffleEntries,
        entryStatus: data.entryStatus || 'Pending',
        fullName: data.fullName,
        mobileNumber: data.mobileNumber,
        email: data.email,
        birthdate: data.birthdate,
        residentialAddress: data.residentialAddress,
        branch: data.branch,
        dateOfPurchase: data.dateOfPurchase,
        purchaseAmount: data.purchaseAmount,
        receiptNumber: data.receiptNumber,
        receiptUpload: data.receiptUpload,
        submittedAt: data.submittedAt,
      })
    })

    console.log('Successfully processed submissions:', submissions.length)
    return submissions
  } catch (error) {
    console.error('Firebase error details:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as any)?.code,
      customData: (error as any)?.customData,
      networkState: navigator.onLine ? 'online' : 'offline',
      userAgent: navigator.userAgent,
    })

    // Provide more specific error messages based on error type
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch') || error.message.includes('fetch')) {
        throw new Error(
          'Network connection failed. Please check your internet connection and try again.',
        )
      }
      if (error.message.includes('permission-denied')) {
        throw new Error('Access denied. Please check Firestore security rules.')
      }
      if (error.message.includes('timeout')) {
        throw new Error('Connection timeout. Please try again.')
      }
    }

    // Re-throw the error to be handled by the retry mechanism
    throw error
  }
}

// Activity Log Functions
export async function logActivity(
  activity: Omit<ActivityLog, 'id' | 'timestamp'>,
  adminInfo?: { id: string; email: string; name?: string },
): Promise<void> {
  try {
    // Check network connectivity first
    if (!navigator.onLine) {
      console.warn('No internet connection - skipping activity log')
      return
    }

    const activityLogRef = collection(db, 'activity_log')
    await addDoc(activityLogRef, {
      ...activity,
      timestamp: serverTimestamp(),
      adminId: adminInfo?.id,
      adminEmail: adminInfo?.email,
      adminName: adminInfo?.name || adminInfo?.email?.split('@')[0] || 'Unknown Admin',
    })
    console.log('Activity logged:', activity.action, 'by', adminInfo?.email || 'Unknown')
  } catch (error) {
    console.error('Failed to log activity:', error)
    // Don't throw error to prevent disrupting main functionality

    // Provide specific error context
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch')) {
        console.warn('Network issue - activity logging skipped')
      } else if (error.message.includes('permission-denied')) {
        console.warn('Permission denied for activity logging')
      }
    }
  }
}

export async function getActivityLogs(): Promise<ActivityLog[]> {
  try {
    // Check network connectivity first
    if (!navigator.onLine) {
      throw new Error('No internet connection available')
    }

    const activityLogRef = collection(db, 'activity_log')
    const q = query(activityLogRef, orderBy('timestamp', 'desc'))
    const querySnapshot = await getDocs(q)

    const logs: ActivityLog[] = []
    querySnapshot.forEach((doc) => {
      const data = doc.data()
      logs.push({
        id: doc.id,
        action: data.action,
        description: data.description,
        targetId: data.targetId,
        targetName: data.targetName,
        oldValue: data.oldValue,
        newValue: data.newValue,
        timestamp: data.timestamp,
        details: data.details,
        adminId: data.adminId,
        adminEmail: data.adminEmail,
        adminName: data.adminName,
      })
    })

    console.log('Activity logs loaded:', logs.length)
    return logs
  } catch (error) {
    console.error('Failed to load activity logs:', error)

    // Provide specific error context
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch')) {
        throw new Error(
          'Network connection failed. Please check your internet connection and try again.',
        )
      }
      if (error.message.includes('permission-denied')) {
        throw new Error(
          'Access denied. Please check Firestore security rules for activity_log collection.',
        )
      }
    }

    throw error
  }
}

// Winner-related interfaces and functions
export interface Winner {
  id?: string
  submissionId: string
  fullName: string
  email: string
  mobileNumber: string
  raffleEntries: number
  drawnAt: any
  status?: 'confirmed' | 'rejected'
  verifiedAt?: any
  rejectionReason?: string
}

// Map prize names to Firebase collection names
const prizeCollectionMap: Record<string, string> = {
  'Discovery Samal': 'discoverySamal',
  'Discovery Coron': 'discoveryCoron',
  'Discovery Boracay': 'discoveryBoracay',
  'Discovery Primea': 'discoveryPrimea',
  'Discovery Suites': 'discoverySuites',
  'Gift Box': 'giftBox',
  '₱1,000 Gift Certificates': 'giftCert_1000',
  '₱1,500 Gift Certificates': 'giftCert_1500',
  '₱2,000 Gift Certificates': 'giftCert_2000',
}

// Save winners to Firebase (clears existing winners first)
export async function saveWinners(prizeName: string, winners: Submission[]): Promise<void> {
  try {
    if (!navigator.onLine) {
      throw new Error('No internet connection available')
    }

    const collectionName = prizeCollectionMap[prizeName]
    if (!collectionName) {
      throw new Error(`Unknown prize: ${prizeName}`)
    }

    const winnersRef = collection(db, collectionName)

    // First, clear all existing winners for this prize
    console.log(`Clearing existing winners for ${prizeName}...`)
    const existingQuery = query(winnersRef)
    const existingSnapshot = await getDocs(existingQuery)

    // Delete all existing winner documents
    const deletePromises = existingSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref))
    await Promise.all(deletePromises)

    console.log(`Cleared ${existingSnapshot.size} existing winners for ${prizeName}`)

    // Now save the new winners
    console.log(`Saving ${winners.length} new winners for ${prizeName}...`)
    for (const winner of winners) {
      const winnerData: Omit<Winner, 'id'> = {
        submissionId: winner.id,
        fullName: winner.fullName || '',
        email: winner.email || '',
        mobileNumber: winner.mobileNumber || '',
        raffleEntries: winner.raffleEntries || 1,
        drawnAt: serverTimestamp(),
        // status is undefined when initially drawn - will be set to 'confirmed' or 'rejected' later
      }

      await addDoc(winnersRef, winnerData)
    }

    console.log(
      `Successfully saved ${winners.length} winners for ${prizeName} to collection ${collectionName}`,
    )
  } catch (error) {
    console.error(`Failed to save winners for ${prizeName}:`, error)
    throw error
  }
}

// Load winners from Firebase
export async function loadWinners(prizeName: string): Promise<Winner[]> {
  try {
    if (!navigator.onLine) {
      throw new Error('No internet connection available')
    }

    const collectionName = prizeCollectionMap[prizeName]
    if (!collectionName) {
      throw new Error(`Unknown prize: ${prizeName}`)
    }

    const winnersRef = collection(db, collectionName)
    const q = query(winnersRef, orderBy('drawnAt', 'desc'))
    const querySnapshot = await getDocs(q)

    const winners: Winner[] = []
    querySnapshot.forEach((doc) => {
      const data = doc.data()
      winners.push({
        id: doc.id,
        submissionId: data.submissionId,
        fullName: data.fullName,
        email: data.email,
        mobileNumber: data.mobileNumber,
        raffleEntries: data.raffleEntries,
        drawnAt: data.drawnAt,
        status: data.status,
        verifiedAt: data.verifiedAt,
        rejectionReason: data.rejectionReason,
      })
    })

    console.log(
      `Loaded ${winners.length} winners for ${prizeName} from collection ${collectionName}`,
    )
    return winners
  } catch (error) {
    console.error(`Failed to load winners for ${prizeName}:`, error)

    // If collection doesn't exist or no winners found, return empty array
    if (
      (error as any)?.code === 'permission-denied' ||
      (error as any)?.message?.includes('not found')
    ) {
      console.log(`No winners found for ${prizeName}, returning empty array`)
      return []
    }

    throw error
  }
}

// Clear all winners for a specific prize
export async function clearWinners(prizeName: string): Promise<void> {
  try {
    if (!navigator.onLine) {
      throw new Error('No internet connection available')
    }

    const collectionName = prizeCollectionMap[prizeName]
    if (!collectionName) {
      throw new Error(`Unknown prize: ${prizeName}`)
    }

    const winnersRef = collection(db, collectionName)
    const querySnapshot = await getDocs(winnersRef)

    // Delete all documents in the collection
    const deletePromises = querySnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref))
    await Promise.all(deletePromises)

    console.log(
      `Cleared ${querySnapshot.size} winners for ${prizeName} from collection ${collectionName}`,
    )
  } catch (error) {
    console.error(`Failed to clear winners for ${prizeName}:`, error)
    throw error
  }
}

// Load all winners for all prizes
export async function loadAllWinners(): Promise<Record<string, Winner[]>> {
  const allWinners: Record<string, Winner[]> = {}

  for (const prizeName of Object.keys(prizeCollectionMap)) {
    try {
      allWinners[prizeName] = await loadWinners(prizeName)
    } catch (error) {
      console.error(`Failed to load winners for ${prizeName}:`, error)
      allWinners[prizeName] = []
    }
  }

  return allWinners
}

// Test function to delete all winners for a specific prize
/**
 * Delete all winners for a specific prize from Firestore
 * @param prizeName The name of the prize (must match prizeCollectionMap)
 */
export async function deleteWinnersForPrize(prizeName: string): Promise<void> {
  const collectionName = prizeCollectionMap[prizeName]
  if (!collectionName) throw new Error(`Unknown prize: ${prizeName}`)
  const winnersRef = collection(db, collectionName)
  const existingSnapshot = await getDocs(query(winnersRef))
  const deletePromises = existingSnapshot.docs.map((docSnap) => deleteDoc(docSnap.ref))
  await Promise.all(deletePromises)
}

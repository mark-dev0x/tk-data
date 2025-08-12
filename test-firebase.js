// Simple Firebase connection test
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyAiFXamP_tfQfWRS2RF0fTcw_RV95rbcW0',
  authDomain: 'tk-raffle-data.firebaseapp.com',
  projectId: 'tk-raffle-data',
  storageBucket: 'tk-raffle-data.firebasestorage.app',
  messagingSenderId: '451018844608',
  appId: '1:451018844608:web:08e75f2ba36dcbcd35c025',
  measurementId: 'G-X3L3GNF25W',
}

console.log('Testing Firebase connection...')
console.log('Config:', firebaseConfig)

try {
  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)
  console.log('Firebase initialized successfully')
  console.log('Firestore instance:', db)
} catch (error) {
  console.error('Firebase initialization failed:', error)
}

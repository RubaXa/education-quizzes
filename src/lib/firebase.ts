import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

// Firebase web configuration identifies the project; it is not an admin key.
const app = initializeApp({
  apiKey: 'AIzaSyBwyDHPCu_uMIpYZJa--F5F19ibqfo0sGw',
  authDomain: 'education-9d7c6.firebaseapp.com',
  projectId: 'education-9d7c6',
  storageBucket: 'education-9d7c6.firebasestorage.app',
  messagingSenderId: '631735202698',
  appId: '1:631735202698:web:edf598314e691d1f5dce73',
})

export const db = getFirestore(app)

const firebaseConfig = {
  apiKey: "AIzaSyBLVAurkgdjN3xzlk5gm1lvfJEwnL2UpaY",
  authDomain: "together-cont.firebaseapp.com",
  projectId: "together-cont",
  storageBucket: "together-cont.firebasestorage.app",
  messagingSenderId: "589225845258",
  appId: "1:589225845258:web:a7849ddd6289dd1b4fb5f3",
  measurementId: "G-PP03ZFZ43T"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

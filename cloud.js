// Google sign-in + Firestore sync. Loaded as an ES module after app.js.
// Talks to app.js through window.App; exposes its own state on window.Cloud.
const cfg = window.FIREBASE_CONFIG;
const Cloud = (window.Cloud = { status: "unconfigured", user: null, lastSync: null, error: null });
const App = window.App;
const notify = () => App?.refreshAuth();

if (cfg && cfg.apiKey) {
  Cloud.status = "loading";
  notify();
  try {
    const V = "13.4.0";
    const [{ initializeApp }, A, F] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    ]);
    const app = initializeApp(cfg);
    const auth = A.getAuth(app);
    const db = F.getFirestore(app);
    const clientId = Math.random().toString(36).slice(2);
    let unsub = null;
    let pushTimer = null;

    const docRef = (uid) => F.doc(db, "users", uid);

    async function push() {
      if (!Cloud.user) return;
      try {
        await F.setDoc(docRef(Cloud.user.uid), {
          state: JSON.stringify(App.getState()),
          writer: clientId,
          updatedAt: F.serverTimestamp(),
          profile: { name: Cloud.user.displayName || "", email: Cloud.user.email || "", photo: Cloud.user.photoURL || "" },
          stats: App.getStats(),
        }, { merge: true });
        Cloud.lastSync = new Date();
        Cloud.error = null;
      } catch (e) {
        Cloud.error = e.message;
      }
      if (lb.joined) await pushLeaderboard();
      notify();
    }

    // ---------- leaderboard (opt-in, public-to-signed-in-users entry per user) ----------
    const lb = (Cloud.lb = { joined: false, name: "", showPhoto: true, entries: null, loading: false, error: null });
    const lbRef = (uid) => F.doc(db, "leaderboard", uid);
    const lbErr = (e) => (e.code === "permission-denied"
      ? "The leaderboard isn't enabled in the database yet (Firestore rules need updating)."
      : e.message);

    function lbPayload() {
      const s = App.getStats();
      return {
        name: lb.name.slice(0, 30),
        photo: lb.showPhoto ? (Cloud.user.photoURL || "").slice(0, 500) : "",
        memorized: s.memorized, streak: s.streak, lastActive: s.lastActive,
        week: s.week, reviews: s.reviews, updatedAt: F.serverTimestamp(),
      };
    }
    async function pushLeaderboard() {
      try {
        await F.setDoc(lbRef(Cloud.user.uid), lbPayload(), { merge: true });
        lb.error = null;
        const me = lb.entries?.find((x) => x.uid === Cloud.user.uid);
        if (me) Object.assign(me, lbPayload());
      } catch (e) {
        lb.error = lbErr(e);
      }
    }
    async function loadLeaderboardMembership(user) {
      try {
        const snap = await F.getDoc(lbRef(user.uid));
        lb.joined = snap.exists();
        if (snap.exists()) {
          lb.name = snap.data().name;
          lb.showPhoto = !!snap.data().photo || !user.photoURL;
        } else {
          lb.name = (user.displayName || "").split(" ")[0] || "Student";
        }
        lb.error = null;
      } catch (e) {
        lb.joined = false;
        lb.error = lbErr(e);
      }
    }
    Cloud.fetchLeaderboard = async () => {
      if (!Cloud.user || lb.loading) return;
      lb.loading = true;
      notify();
      try {
        const q = F.query(F.collection(db, "leaderboard"), F.orderBy("memorized", "desc"), F.limit(500));
        const res = await F.getDocs(q);
        lb.entries = res.docs.map((d) => ({ uid: d.id, ...d.data() }));
        lb.fetchedAt = new Date();
        lb.error = null;
      } catch (e) {
        lb.error = lbErr(e);
      }
      lb.loading = false;
      notify();
    };
    Cloud.joinLeaderboard = async (name, showPhoto) => {
      lb.name = name.trim().slice(0, 30) || "Student";
      lb.showPhoto = showPhoto;
      try {
        await F.setDoc(lbRef(Cloud.user.uid), { ...lbPayload(), joinedAt: F.serverTimestamp() });
        lb.joined = true;
        lb.error = null;
      } catch (e) {
        lb.error = lbErr(e);
      }
      await Cloud.fetchLeaderboard();
    };
    Cloud.updateLeaderboardProfile = async (name, showPhoto) => {
      lb.name = name.trim().slice(0, 30) || lb.name;
      lb.showPhoto = showPhoto;
      await pushLeaderboard();
      await Cloud.fetchLeaderboard();
    };
    Cloud.leaveLeaderboard = async () => {
      try {
        await F.deleteDoc(lbRef(Cloud.user.uid));
        lb.joined = false;
        lb.entries = lb.entries?.filter((x) => x.uid !== Cloud.user.uid) || null;
      } catch (e) {
        lb.error = lbErr(e);
      }
      notify();
    };
    Cloud.schedulePush = () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(push, 1200);
    };

    Cloud.signIn = async () => {
      const provider = new A.GoogleAuthProvider();
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
          return A.signInWithRedirect(auth, provider);
        }
        if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
          const msg = {
            "auth/unauthorized-domain": `This website (${location.hostname}) isn't authorized for sign-in yet. Add it under Firebase → Authentication → Settings → Authorized domains.`,
            "auth/operation-not-allowed": "Google sign-in isn't enabled yet. Enable it under Firebase → Authentication → Sign-in method → Google.",
            "auth/network-request-failed": "Network error, please check your connection and try again.",
          }[e.code] || e.message;
          Cloud.error = msg;
          alert("Sign-in failed: " + msg);
          notify();
        }
      }
    };
    Cloud.signOut = async () => {
      await push();
      await A.signOut(auth);
    };

    A.onAuthStateChanged(auth, async (user) => {
      unsub?.();
      unsub = null;
      Cloud.user = user;
      if (!user) {
        Cloud.status = "signedOut";
        Cloud.lastSync = null;
        Object.assign(lb, { joined: false, name: "", entries: null, error: null });
        return notify();
      }
      Cloud.status = "syncing";
      notify();
      await loadLeaderboardMembership(user);
      try {
        const snap = await F.getDoc(docRef(user.uid));
        if (snap.exists() && snap.data().state) App.mergeRemote(JSON.parse(snap.data().state));
        if (!snap.exists() || !snap.data().createdAt) await F.setDoc(docRef(user.uid), { createdAt: F.serverTimestamp() }, { merge: true });
        await push();
        Cloud.status = "signedIn";
        // live updates from other devices
        unsub = F.onSnapshot(docRef(user.uid), (s) => {
          const d = s.data();
          if (!d || s.metadata.hasPendingWrites || d.writer === clientId || !d.state) return;
          App.mergeRemote(JSON.parse(d.state));
          Cloud.lastSync = new Date();
          notify();
        });
      } catch (e) {
        Cloud.status = "signedIn";
        Cloud.error = e.message;
      }
      notify();
    });
  } catch (e) {
    Cloud.status = "error";
    Cloud.error = "Could not load Firebase (are you offline?) " + e.message;
    notify();
  }
} else {
  notify();
}

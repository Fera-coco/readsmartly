// app.js — ReadSmartly (Firebase 10.7.1)
import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    collection, addDoc, getDocs, query, where, setDoc,
    updateDoc, doc, deleteDoc, getDoc, Timestamp, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── STATE ──────────────────────────────────────────────────────────────────
let currentUser      = null;
let userProfile      = null;
let currentTaskId    = null;
let currentTaskTitle = null;
let addTaskModal     = null;
let sessionModal     = null;
let completionModal  = null;
let summaryModal     = null;
let reviewModal      = null;
let timerModal       = null;
let notePromptModal  = null;
let chartInstance    = null;
let timerInterval    = null;
let timerSeconds     = 0;
let timerTotalSecs   = 0;
let timerTaskId      = null;
let timerTaskTitle   = null;
let notifInterval    = null;
let voiceRecognition = null;
let voiceTranscript  = '';
let summaryTaskId    = null;
let summaryTaskTitle = null;
let timerRunningInBg = false;    // is timer active behind a closed modal?
let timerEndTimestamp= 0;        // absolute end time for background tracking
let bgTimerAnimFrame = null;
// In-app notification queue
let inAppNotifs      = [];       // { id, type, icon, title, body, time, read }

// ── BOOTSTRAP MODAL INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const g = id => document.getElementById(id);
    if (g('addTaskModal'))    addTaskModal    = new bootstrap.Modal(g('addTaskModal'));
    if (g('sessionModal'))    sessionModal    = new bootstrap.Modal(g('sessionModal'));
    if (g('completionModal')) completionModal = new bootstrap.Modal(g('completionModal'));
    if (g('summaryModal'))    summaryModal    = new bootstrap.Modal(g('summaryModal'));
    if (g('reviewModal'))     reviewModal     = new bootstrap.Modal(g('reviewModal'));
    if (g('timerModal'))      timerModal      = new bootstrap.Modal(g('timerModal'));
    if (g('notePromptModal')) notePromptModal = new bootstrap.Modal(g('notePromptModal'));
});

// ── AUTH STATE HANDLER ─────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    const page = window.location.pathname;

    // Remove login splash screen as soon as auth state is known
    if (page.includes('index.html') || page === '/' || page === '') {
        window._splashDone?.();
    }

    if (user) {
        currentUser = user;

        if (page.includes('index.html') || page === '/' || page === '') {
            const profile = await loadProfile(user.uid);
            if (profile?.onboardingDone) {
                // Already logged in — update splash and redirect
                const splashStatus = document.getElementById('splashStatus');
                if (splashStatus) splashStatus.textContent = 'Signing you in…';
                window.location.href = 'home.html';
            } else {
                window.location.href = 'onboarding.html';
            }
            return;
        }

        if (page.includes('home.html')) {
            const profile = await loadProfile(user.uid);
            if (!profile?.onboardingDone) {
                // Block dashboard access until setup is complete
                window.location.href = 'onboarding.html';
                return;
            }
            userProfile = profile;
            initDashboard();
        }
        // onboarding.html handled by its own inline script

    } else {
        if (page.includes('home.html') || page.includes('onboarding.html')) {
            window.location.href = 'index.html';
        }
    }
});

// ── LOAD PROFILE ───────────────────────────────────────────────────────────
async function loadProfile(uid) {
    try {
        const snap = await getDoc(doc(db, 'profiles', uid));
        return snap.exists() ? snap.data() : null;
    } catch (e) { console.error('Profile load error:', e); return null; }
}

// ── DASHBOARD INIT ─────────────────────────────────────────────────────────
function initDashboard() {
    const greetEl = document.getElementById('greeting');
    if (greetEl) {
        const hr   = new Date().getHours();
        const tod  = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
        greetEl.innerHTML = `${tod}, <span>${userProfile?.userName || 'reader'}</span> 👋`;
    }

    const profileBtn = document.getElementById('profileNavBtn');
    if (profileBtn) {
        const nm = userProfile?.userName || currentUser.email?.split('@')[0] || 'Me';
        profileBtn.textContent = nm.charAt(0).toUpperCase() + nm.slice(1, 8);
        profileBtn.onclick = () => openProfileModal();
    }

    document.querySelectorAll('.ai-name-placeholder').forEach(el => {
        el.textContent = userProfile?.aiName || 'AI';
    });

    // Register service worker for background push notifications
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW registration failed:', e));
    }

    // Request notification permission for timer
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Push welcome notification
    setTimeout(() => {
        const aiName = userProfile?.aiName || 'AI';
        const name   = userProfile?.userName || 'there';
        const hr = new Date().getHours();
        const tod = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
        pushInAppNotif('info', '🤖', `Good ${tod}, ${name}!`, `${aiName} is ready. Check your study plan and today's targets.`);
    }, 1500);

    loadAllData().then(() => {
        if (window._runNewFeatureChecks) window._runNewFeatureChecks();
    });
    tryRecoverTimer();
}

// ── AUTH FUNCTIONS ─────────────────────────────────────────────────────────
window.signup = async function () {
    const email    = document.getElementById('signupEmail')?.value.trim();
    const password = document.getElementById('signupPassword')?.value;
    if (!email || !password) { showError('Please fill in all fields'); return; }
    if (password.length < 6)  { showError('Password must be at least 6 characters'); return; }
    showLoading(true);
    try {
        await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) { showError(mapError(err.code)); showLoading(false); }
};

window.login = async function () {
    const email    = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    if (!email || !password) { showError('Please fill in all fields'); return; }
    showLoading(true);
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) { showError(mapError(err.code)); showLoading(false); }
};

window.logout = async function () {
    if (confirm('Log out?')) {
        localStorage.removeItem('rs_hasVisited');
        await signOut(auth);
    }
};

window.showSignup = () => window.switchTab?.('signup');
window.showLogin  = () => window.switchTab?.('login');

function showError(msg) {
    const box = document.getElementById('errorMessage');
    const txt = document.getElementById('errorText');
    if (box && txt) { txt.textContent = msg; box.style.display = 'block'; }
}
function showLoading(show) {
    const s = document.getElementById('loadingSpinner');
    if (s) s.style.display = show ? 'block' : 'none';
}
function mapError(code) {
    const map = {
        'auth/email-already-in-use': 'This email is already registered',
        'auth/invalid-email':        'Invalid email address',
        'auth/user-not-found':       'No account found with that email',
        'auth/wrong-password':       'Incorrect password',
        'auth/weak-password':        'Password must be at least 6 characters',
        'auth/invalid-credential':   'Incorrect email or password',
    };
    return map[code] || 'Something went wrong. Please try again.';
}

// ── TOAST ──────────────────────────────────────────────────────────────────
window.showToast = function (msg, html) {
    const t = document.getElementById('rsToast');
    if (!t) return;
    if (html) t.innerHTML = msg; else t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, 6000);
};

// ── CONFETTI ───────────────────────────────────────────────────────────────
function fireConfetti() {
    if (typeof confetti === 'undefined') return;
    const opts = { origin: { y: 0.7 }, colors: ['#2563EB','#F59E0B','#10B981','#0F172A'] };
    confetti({ ...opts, particleCount: 60, spread: 26, startVelocity: 55 });
    confetti({ ...opts, particleCount: 40, spread: 60 });
    confetti({ ...opts, particleCount: 70, spread: 100, decay: 0.91, scalar: 0.8 });
    confetti({ ...opts, particleCount: 20, spread: 120, startVelocity: 25, decay: 0.92 });
}

// ── ANIMATED COUNTER ───────────────────────────────────────────────────────
function animateCounter(el, target) {
    if (!el) return;
    if (!target && target !== 0) { el.textContent = '0'; return; }
    let start = null;
    const run = ts => {
        if (!start) start = ts;
        const p = Math.min((ts - start) / 900, 1);
        el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * target);
        if (p < 1) requestAnimationFrame(run);
    };
    requestAnimationFrame(run);
}

// ── PROFILE MODAL ──────────────────────────────────────────────────────────
window.openProfileModal = function() {
    const pm = document.getElementById('profileModal');
    if (!pm) return;
    if (document.getElementById('profileUserName')) document.getElementById('profileUserName').value = userProfile?.userName || '';
    if (document.getElementById('profileAiName'))   document.getElementById('profileAiName').value   = userProfile?.aiName   || '';
    if (document.getElementById('profileSpeed'))    document.getElementById('profileSpeed').value    = userProfile?.readingWPM || 200;
    new bootstrap.Modal(pm).show();
};

window.saveProfile = async function() {
    if (!currentUser) return;
    const un  = document.getElementById('profileUserName')?.value.trim() || userProfile?.userName;
    const an  = document.getElementById('profileAiName')?.value.trim()   || userProfile?.aiName;
    const wpm = parseInt(document.getElementById('profileSpeed')?.value)  || userProfile?.readingWPM || 200;
    const pph = Math.round((wpm * 60) / 250);
    try {
        await setDoc(doc(db, 'profiles', currentUser.uid), {
            ...userProfile, userName: un, aiName: an,
            readingWPM: wpm, readingSpeed: pph,
            onboardingDone: true, updatedAt: Timestamp.now(),
        });
        userProfile = { ...userProfile, userName: un, aiName: an, readingWPM: wpm, readingSpeed: pph };
        const hr  = new Date().getHours();
        const tod = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
        const greet = document.getElementById('greeting');
        if (greet) greet.innerHTML = `${tod}, <span>${un}</span> 👋`;
        const pb = document.getElementById('profileNavBtn');
        if (pb) pb.textContent = un.charAt(0).toUpperCase() + un.slice(1, 8);
        bootstrap.Modal.getInstance(document.getElementById('profileModal'))?.hide();
        window.showToast('Profile updated.');
    } catch(e) {
        console.error('Profile save error:', e);
        window.showToast('Could not save profile. Please try again.');
    }
};

// KEY FIX: set rs_editSetup flag so onboarding.html does NOT redirect away
window.goToSetup = function() {
    localStorage.setItem('rs_editSetup', '1');
    localStorage.removeItem('rs_skipOnboarding');
    bootstrap.Modal.getInstance(document.getElementById('profileModal'))?.hide();
    setTimeout(() => { window.location.href = 'onboarding.html'; }, 250);
};

// ── LOAD ALL DATA ──────────────────────────────────────────────────────────
async function loadAllData() {
    // Fetch shared data once — avoids 6+ redundant reads per dashboard load
    const [sessSnap, taskSnap] = await Promise.all([
        getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc'))),
        getDocs(query(collection(db,'tasks'),    where('userId','==',currentUser.uid), orderBy('deadline','asc'))),
    ]);
    await Promise.all([
        loadStreak(sessSnap), loadTasks(taskSnap), loadStatistics(sessSnap),
        renderCalendar(sessSnap), showAIInsights(sessSnap), showDisengagementPrediction(sessSnap),
        renderChart(sessSnap), renderSchedulePanel(taskSnap), loadNotes(),
    ]);
}

// ── STREAK ─────────────────────────────────────────────────────────────────
async function loadStreak(ss) {
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc')));
        }
        if (ss.empty) { setStreak(0); return; }
        const seen = new Set(), dates = [];
        ss.forEach(d => { const k = d.data().date.toDate().toDateString(); if (!seen.has(k)) { seen.add(k); dates.push(k); } });
        let streak = 0;
        const today = new Date(); today.setHours(0,0,0,0);
        const last  = new Date(dates[0]); last.setHours(0,0,0,0);
        if (Math.floor((today - last) / 86400000) <= 1) {
            streak = 1;
            for (let i = 1; i < dates.length; i++) {
                const cur = new Date(dates[i]); cur.setHours(0,0,0,0);
                const prev = new Date(dates[i-1]); prev.setHours(0,0,0,0);
                if (Math.floor((prev - cur) / 86400000) === 1) streak++;
                else break;
            }
        }
        setStreak(streak);
    } catch (e) { setStreak(0); }
}

function setStreak(n) {
    animateCounter(document.getElementById('streakCount'), n);
    const badge = document.getElementById('streakBadge');
    if (!badge) return;
    if      (n === 0) badge.textContent = 'Just starting';
    else if (n < 4)   badge.textContent = `${n} day streak`;
    else if (n < 7)   badge.textContent = `${n} days, building!`;
    else if (n < 14)  badge.textContent = `${n} days, on fire!`;
    else if (n < 30)  badge.textContent = `${n} days, amazing!`;
    else              badge.textContent = `${n} days, legend!`;
}

// ── CALENDAR ───────────────────────────────────────────────────────────────
async function renderCalendar(ss) {
    const cal = document.getElementById('calendar');
    if (!cal) return;
    cal.innerHTML = '';
    const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid)));
        }
        const hit = new Set();
        ss.forEach(d => hit.add(d.data().date.toDate().toDateString()));
        for (let i = 6; i >= 0; i--) {
            const date = new Date(); date.setDate(date.getDate() - i);
            const div  = document.createElement('div');
            div.className = 'cal-d';
            if (hit.has(date.toDateString())) div.classList.add('hit');
            if (i === 0) div.classList.add('now');
            div.innerHTML = `<span class="cal-dn">${date.getDate()}</span><span class="cal-dl">${DAY[date.getDay()]}</span>${hit.has(date.toDateString()) ? '<div class="cal-dot"></div>' : ''}`;
            div.title = date.toDateString();
            cal.appendChild(div);
        }
    } catch(e) { console.error('Calendar error:', e); }
}

// ── STATISTICS ─────────────────────────────────────────────────────────────
async function loadStatistics(ss) {
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid)));
        }
        let pages = 0, mins = 0, count = 0;
        ss.forEach(d => { pages += d.data().pagesRead||0; mins += d.data().duration||0; count++; });
        animateCounter(document.getElementById('totalPages'), pages);
        animateCounter(document.getElementById('totalSessions'), count);
        const speed    = mins > 0 ? Math.round((pages/mins)*60) : (userProfile?.readingSpeed || 0);
        const speedEl  = document.getElementById('readingSpeed');
        const hintEl   = document.getElementById('speedInsight');
        const aiName   = userProfile?.aiName || 'AI';
        if (speedEl) speed > 0 ? animateCounter(speedEl, speed) : (speedEl.textContent = '0');
        if (hintEl) {
            if (speed <= 0)  hintEl.textContent = `${aiName}: log a timed session to measure your pace.`;
            else if (speed<20) hintEl.textContent = `${aiName}: deep, careful reading pace.`;
            else if (speed<40) hintEl.textContent = `${aiName}: steady pace, keep going!`;
            else               hintEl.textContent = `${aiName}: fast reader, push further!`;
        }
    } catch(e) { console.error('Stats error:', e); }
}

// ── CHART ──────────────────────────────────────────────────────────────────
async function renderChart(ss) {
    const canvas = document.getElementById('pagesChart');
    if (!canvas) return;
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid)));
        }
        const labels = [], buckets = {};
        for (let i = 13; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate()-i);
            labels.push(`${d.getDate()}/${d.getMonth()+1}`);
            buckets[d.toDateString()] = 0;
        }
        ss.forEach(d => { const k = d.data().date.toDate().toDateString(); if (k in buckets) buckets[k] += d.data().pagesRead||0; });
        if (chartInstance) chartInstance.destroy();
        const ctx  = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0,0,0,200);
        grad.addColorStop(0,'rgba(37,99,235,0.18)'); grad.addColorStop(1,'rgba(37,99,235,0)');
        chartInstance = new Chart(ctx, {
            type:'line', data:{ labels, datasets:[{ label:'Pages', data:Object.values(buckets), fill:true, backgroundColor:grad, borderColor:'#2563EB', borderWidth:2, pointBackgroundColor:'#2563EB', pointRadius:3, pointHoverRadius:5, tension:0.4 }] },
            options:{ responsive:true, plugins:{ legend:{display:false}, tooltip:{ backgroundColor:'#0F172A', titleColor:'#F8FAFC', bodyColor:'#93C5FD', padding:10, cornerRadius:8, callbacks:{ label: ctx => ` ${ctx.parsed.y} pages` } } }, scales:{ x:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{color:'#94A3B8',font:{size:10}}}, y:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{color:'#94A3B8',font:{size:10},stepSize:5},beginAtZero:true} } }
        });
    } catch(e) { console.error('Chart error:', e); }
}

// ── SCHEDULE PANEL ─────────────────────────────────────────────────────────
async function renderSchedulePanel(ss) {
    const el = document.getElementById('schedulePanel');
    if (!el) return;
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'tasks'), where('userId','==',currentUser.uid), orderBy('deadline','asc')));
        }
        const hide = () => { el.style.display='none'; const l=document.getElementById('schedLbl'); if(l) l.style.display='none'; };
        if (ss.empty) { hide(); return; }
        const speed=userProfile?.readingSpeed||30, aiName=userProfile?.aiName||'AI';
        const rows=[]; let totalToday=0;
        ss.forEach(d => {
            const t=d.data(), rem=Math.max(0,(t.totalPages||0)-(t.pagesRead||0)); if(!rem) return;
            const days=t.deadline?Math.max(1,Math.ceil((t.deadline.seconds*1000-Date.now())/86400000)):30;
            const ppd=t.pagesPerDay||Math.ceil(rem/days), mins=Math.round((ppd/speed)*60);
            totalToday+=ppd; rows.push({name:t.title,ppd,mins,days,rem});
        });
        if (!rows.length) { hide(); return; }
        const totalMins=Math.round((totalToday/speed)*60);
        el.innerHTML=`
            <div class="sch-panel-header">
                <div><div class="sch-panel-title"><i class="bi bi-calendar2-week me-2"></i>Today's Study Plan</div>
                <div class="sch-panel-sub">${aiName} recommends ${totalToday} pages across ${rows.length} course${rows.length!==1?'s':''}</div></div>
                <div class="sch-panel-badge">~${totalMins} min</div>
            </div>
            ${rows.map(r=>`<div class="sch-row"><div class="sch-row-left"><div class="sch-row-name">${r.name}</div><div class="sch-row-meta">${r.rem} pages left, ${r.days} day${r.days!==1?'s':''} to exam, ~${r.mins} min today</div></div><div class="sch-row-right"><span class="sch-row-num">${r.ppd}</span><span class="sch-row-unit">pg today</span></div></div>`).join('')}
            <div class="sch-total-row"><div style="font-size:0.82rem;color:rgba(255,255,255,0.5);">Total today</div><div style="font-family:var(--font-head);font-size:1.4rem;font-weight:800;color:var(--amber);">${totalToday} <span style="font-size:0.75rem;color:rgba(255,255,255,0.4);font-family:var(--font-body);font-weight:400;">pages</span></div></div>`;
        el.style.display='block';
        const lbl=document.getElementById('schedLbl'); if(lbl) lbl.style.display='block';
    } catch(e) { console.error('Schedule panel error:', e); }
}

// ── AI INSIGHTS ────────────────────────────────────────────────────────────
async function showAIInsights(ss) {
    const el = document.getElementById('aiInsights');
    if (!el) return;
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid)));
        }
        const aiName = userProfile?.aiName || 'AI';
        const fmt    = h => `${h%12||12}${h>=12?'PM':'AM'}`;
        if (ss.size < 5) {
            el.innerHTML = `<div class="ai-card blue"><span class="ai-tag blue">🤖 ${aiName} Learning</span><p>Log at least 5 sessions so ${aiName} can detect your optimal study times.</p></div>`;
            return;
        }
        const counts = new Array(24).fill(0);
        ss.forEach(d => counts[d.data().date.toDate().getHours()]++);
        const top = counts.map((c,h)=>({h,c})).sort((a,b)=>b.c-a.c).filter(x=>x.c>0).slice(0,3).map(x=>x.h);
        while(top.length<3) top.push([9,14,20][top.length]);
        el.innerHTML = `<div class="ai-card blue"><span class="ai-tag blue">⏰ ${aiName} · Pattern Recognition</span><p>You study most consistently at <strong>${fmt(top[0])}</strong>, <strong>${fmt(top[1])}</strong>, and <strong>${fmt(top[2])}</strong>. Schedule your hardest material during these windows.</p></div>`;
    } catch(e) { console.error('AI insights error:', e); }
}

async function showDisengagementPrediction(ss) {
    const el = document.getElementById('aiPrediction');
    if (!el) return;
    const aiName = userProfile?.aiName || 'AI';
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc')));
        }
        if (ss.size < 7) { el.innerHTML=`<div class="ai-card blue"><span class="ai-tag blue">📊 ${aiName} · Trend Analysis</span><p>Keep logging. ${aiName} needs 1 week of sessions to detect engagement patterns.</p></div>`; return; }
        const now=new Date(), wk1=[],wk2=[],wk3=[];
        ss.forEach(d=>{ const ago=Math.floor((now-d.data().date.toDate())/86400000); if(ago<7) wk1.push(d); else if(ago<14) wk2.push(d); else if(ago<21) wk3.push(d); });
        const avg=(wk2.length+wk3.length)/2, change=avg>0?(wk1.length-avg)/avg:null;
        const name=userProfile?.userName?`, ${userProfile.userName}`:'';
        let msg,color;
        if (change===null){msg=`Early days${name}! Keep logging sessions — ${aiName} will start spotting trends after a couple of weeks.`;color='blue';}
        else if (change<-0.4){msg=`⚠️ ${aiName} detected a ${Math.abs(Math.round(change*100))}% activity drop this week. Try two 15-minute sessions instead of one long one${name}.`;color='amber';}
        else if(change<-0.2){msg=`📉 Slight dip this week. One session today will get you back on track${name}.`;color='amber';}
        else if(change>0.2){msg=`🚀 You're reading ${Math.round(change*100)}% more than last week${name}. Outstanding consistency!`;color='green';}
        else{msg=`Stable reading pattern${name}. ${aiName} predicts you'll maintain your streak.`;color='green';}
        el.innerHTML=`<div class="ai-card ${color}"><span class="ai-tag ${color}">📊 ${aiName} · Trend Analysis</span><p>${msg}</p></div>`;
    } catch(e) { el.innerHTML=`<div class="ai-card blue"><span class="ai-tag blue">📊 ${aiName} · Trend Analysis</span><p>Keep logging sessions to unlock AI trend analysis.</p></div>`; }
}

// ── NOTES PANEL ────────────────────────────────────────────────────────────
async function loadNotes() {
    const el = document.getElementById('notesList');
    if (!el) return;
    try {
        // No orderBy in query — sort client-side to avoid needing a composite index
        const q  = query(
            collection(db, 'summaries'),
            where('userId', '==', currentUser.uid)
        );
        const ss = await getDocs(q);
        if (ss.empty) {
            el.innerHTML = `<div class="empty-state">
                <span class="empty-icon">🗒️</span>
                <div class="empty-title">No notes yet</div>
                <div class="empty-sub">Notes are saved when you log a session or complete a task</div>
            </div>`;
            return;
        }
        // Sort newest first client-side
        const docs = ss.docs.slice().sort((a, b) =>
            (b.data().createdAt?.seconds || 0) - (a.data().createdAt?.seconds || 0)
        );
        el.innerHTML = docs.map(d => {
            const n       = d.data();
            const date    = n.createdAt?.toDate ? n.createdAt.toDate() : new Date((n.createdAt?.seconds||0)*1000);
            const dateStr = date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
            const timeStr = date.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
            const isVoice = n.type === 'voice';
            const preview = (n.content || '').slice(0, 300) + ((n.content||'').length > 300 ? '…' : '');
            return `<div class="note-entry">
                <div class="note-meta">
                    <span class="note-badge ${isVoice ? 'voice' : ''}">
                        ${isVoice ? '<i class="bi bi-mic-fill"></i> Voice' : '<i class="bi bi-pencil-fill"></i> Text'}
                    </span>
                    <span>${n.taskTitle || 'General Note'}</span>
                    <span style="margin-left:auto;">${dateStr} · ${timeStr}</span>
                </div>
                <div class="note-text">${preview.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>
            </div>`;
        }).join('');
    } catch(e) {
        console.error('loadNotes error:', e);
        el.innerHTML = `<div class="alert alert-danger" style="font-size:0.875rem;">Could not load notes. Check console for details.</div>`;
    }
}


async function loadTasks(ss) {
    const listEl = document.getElementById('taskList');
    if (!listEl) return;
    try {
        if (!ss) {
            ss = await getDocs(query(collection(db,'tasks'), where('userId','==',currentUser.uid), orderBy('deadline','asc')));
        }
        listEl.innerHTML = '';
        const countEl = document.getElementById('tasksCount');
        if (ss.empty) {
            if(countEl) countEl.textContent='0 tasks';
            listEl.innerHTML=`<div class="empty-state"><span class="empty-icon">📭</span><div class="empty-title">No tasks yet</div><div class="empty-sub">Tap the + button to add a reading task</div></div>`;
            return;
        }
        if(countEl) countEl.textContent=`${ss.size} task${ss.size!==1?'s':''}`;
        ss.forEach(d => listEl.appendChild(buildTaskCard(d.id, d.data())));
        setTimeout(() => { listEl.querySelectorAll('.prog-fill[data-w]').forEach(b => { b.style.width = b.dataset.w+'%'; }); }, 80);
    } catch(e) { console.error('loadTasks error:', e); listEl.innerHTML=`<div class="alert alert-danger" style="font-size:0.875rem;">Error loading tasks.</div>`; }
}

function buildTaskCard(id, task) {
    const div   = document.createElement('div');
    div.className = 'task-row';
    const pct   = task.totalPages > 0 ? Math.min((task.pagesRead/task.totalPages)*100, 100) : 0;
    const daysLeft = task.deadline ? Math.ceil((task.deadline.seconds*1000-Date.now())/86400000) : 999;
    const isDone  = Math.round(pct) >= 100;
    const isOver  = daysLeft < 0 && !isDone;
    let chipCls='ok', chipTxt=`${daysLeft}d left`;
    if(isDone)           { chipCls='done'; chipTxt='Complete'; }
    else if(isOver)      { chipCls='over'; chipTxt='Overdue'; }
    else if(daysLeft<=2) { chipCls='warn'; chipTxt=daysLeft===0?'Due today':`Due in ${daysLeft}d`; }
    const barCls = isDone?'done':isOver?'urgent':'';
    const esc    = s => s.replace(/'/g,"\\'").replace(/"/g,'&quot;');
    div.innerHTML=`
        <div class="d-flex justify-content-between align-items-start mb-1">
            <div class="task-name">${task.title}</div>
            <button class="btn-del" onclick="deleteTask('${id}')"><i class="bi bi-trash3"></i></button>
        </div>
        <div class="task-pages"><i class="bi bi-file-text me-1"></i>${task.pagesRead} / ${task.totalPages} pages</div>
        <div class="prog-track"><div class="prog-fill ${barCls}" data-w="${Math.round(pct)}" style="width:0%"></div></div>
        <div class="d-flex justify-content-between align-items-center">
            <span class="chip ${chipCls}"><i class="bi bi-calendar-event"></i> ${chipTxt}</span>
            <div class="d-flex gap-2 align-items-center">
                ${!isDone
                    ? `<button class="btn-read btn-timer-sm" title="Reading timer" onclick="openTimerModal('${id}','${esc(task.title)}')"><i class="bi bi-stopwatch"></i></button>
                       <button class="btn-read" onclick="startSession('${id}','${esc(task.title)}')"><i class="bi bi-play-fill"></i> Log</button>`
                    : `<button class="btn-read" style="background:var(--green);" onclick="openSummaryModal('${id}','${esc(task.title)}')"><i class="bi bi-journal-text me-1"></i>Add note</button>`
                }
            </div>
        </div>`;
    return div;
}

// ── ADD / DELETE TASK ──────────────────────────────────────────────────────
window.addTask = async function () {
    const title    = document.getElementById('taskTitle')?.value.trim();
    const pages    = parseInt(document.getElementById('taskPages')?.value);
    const deadline = document.getElementById('taskDeadline')?.value;
    if (!title)              { window.showToast('Please enter a task title'); return; }
    if (!pages || pages <= 0){ window.showToast('Please enter a valid page count'); return; }
    if (!deadline)           { window.showToast('Please select a deadline'); return; }
    try {
        await addDoc(collection(db,'tasks'), { userId:currentUser.uid, title, totalPages:pages, pagesRead:0, deadline:Timestamp.fromDate(new Date(deadline)), createdAt:Timestamp.now() });
        ['taskTitle','taskPages','taskDeadline'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        if(addTaskModal) addTaskModal.hide();
        await loadTasks(); await renderSchedulePanel();
        window.showToast('Task added!');
    } catch(e) { console.error(e); window.showToast('Error adding task. Please try again.'); }
};

window.deleteTask = async function (id) {
    if (!confirm('Delete this task?')) return;
    try { await deleteDoc(doc(db,'tasks',id)); await loadTasks(); await renderSchedulePanel(); window.showToast('Task deleted'); }
    catch(e) { window.showToast('Error deleting task'); }
};

// ── SESSION: check summaries first, show review if any ────────────────────
window.startSession = async function (taskId, taskTitle) {
    currentTaskId    = taskId;
    currentTaskTitle = taskTitle;
    try {
        const q  = query(collection(db,'summaries'), where('userId','==',currentUser.uid), where('taskId','==',taskId));
        const ss = await getDocs(q);
        if (!ss.empty) {
            const list = [];
            ss.forEach(d => list.push({ id:d.id, ...d.data() }));
            list.sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
            showReviewModal(taskId, taskTitle, list[0]);
            return;
        }
    } catch(e) { console.error('Summary check error:', e); }
    openSessionModal(taskId, taskTitle);
};

function openSessionModal(taskId, taskTitle) {
    currentTaskId    = taskId;
    currentTaskTitle = taskTitle;
    const el = document.getElementById('currentTaskTitle');
    if (el) el.textContent = taskTitle;
    const pr = document.getElementById('pagesRead');
    const sd = document.getElementById('sessionDuration');
    if (pr) pr.value = ''; if (sd) sd.value = '';
    if (sessionModal) sessionModal.show();
}

// ── REVIEW MODAL ───────────────────────────────────────────────────────────
async function showReviewModal(taskId, taskTitle, summary) {
    const el = document.getElementById('reviewModalBody');
    if (!el) { openSessionModal(taskId, taskTitle); return; }
    const aiName  = userProfile?.aiName || 'AI';
    const content = summary.content || '';

    const headerHTML = `
        <div style="background:var(--blue-lt);border:1px solid #BFDBFE;border-radius:12px;padding:1rem 1.25rem;margin-bottom:1rem;">
            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--blue);margin-bottom:0.4rem;">${aiName} · Review Check</div>
            <div style="font-size:0.85rem;font-weight:700;color:var(--navy);margin-bottom:0.35rem;">${taskTitle}</div>
            <div style="font-size:0.76rem;color:var(--slate);">Last note saved ${formatRelativeDate(summary.createdAt)}:</div>
        </div>
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0.875rem 1rem;font-size:0.875rem;color:var(--navy-2);line-height:1.6;margin-bottom:1.25rem;font-style:italic;">"${content.slice(0,280)}${content.length>280?'…':''}"</div>`;

    el.innerHTML = headerHTML + `
        <div style="font-size:0.82rem;font-weight:700;color:var(--navy);margin-bottom:0.75rem;">${aiName} is generating questions from your note…</div>
        <div style="text-align:center;padding:1rem;color:var(--slate);font-size:0.85rem;">⏳ Loading…</div>`;
    if (reviewModal) reviewModal.show();

    const questions = await generateReviewQuestions(content, taskTitle);

    el.innerHTML = headerHTML + `
        <div style="font-size:0.82rem;font-weight:700;color:var(--navy);margin-bottom:0.75rem;">Before you continue, answer these questions ${aiName} generated from your note:</div>
        ${questions.map((q,i)=>`
            <div style="margin-bottom:1rem;">
                <div style="font-size:0.85rem;color:var(--navy-2);margin-bottom:0.4rem;font-weight:500;">${i+1}. ${q}</div>
                <textarea id="rqa${i}" class="form-control" rows="2" placeholder="Type a brief answer…" style="font-size:0.85rem;"></textarea>
            </div>`).join('')}
        <div style="font-size:0.75rem;color:var(--slate);margin-top:0.5rem;">${aiName} saves your answers to reinforce long-term retention.</div>`;

    document.getElementById('reviewContinueBtn').onclick = async () => {
        const answers = questions.map((q,i) => { const a=document.getElementById(`rqa${i}`)?.value.trim(); return a?`Q: ${q}\nA: ${a}`:null; }).filter(Boolean).join('\n\n');
        if (answers) await saveTaskSummary(taskId, taskTitle, `Review answers:\n\n${answers}`, 'text');
        if (reviewModal) reviewModal.hide();
        openSessionModal(taskId, taskTitle);
    };
}

function formatRelativeDate(ts) {
    if (!ts) return 'earlier';
    const d    = ts.toDate ? ts.toDate() : new Date((ts.seconds||0)*1000);
    const diff = Math.floor((Date.now() - d) / 86400000);
    return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : `${diff} days ago`;
}

// ── LOG SESSION ────────────────────────────────────────────────────────────
window.logSession = async function () {
    const pagesRead = parseInt(document.getElementById('pagesRead')?.value);
    const duration  = parseInt(document.getElementById('sessionDuration')?.value) || 0;
    if (!pagesRead || pagesRead <= 0) { window.showToast('Please enter the pages you read'); return; }
    try {
        await addDoc(collection(db,'sessions'), { userId:currentUser.uid, taskId:currentTaskId, pagesRead, duration, date:Timestamp.now() });
        let completed = false;
        const taskSnap = await getDoc(doc(db,'tasks',currentTaskId));
        if (taskSnap.exists()) {
            const cur=taskSnap.data().pagesRead||0, total=taskSnap.data().totalPages||0, next=cur+pagesRead;
            await updateDoc(doc(db,'tasks',currentTaskId), { pagesRead: next });
            if (next>=total && cur<total) completed=true;
        }
        if (sessionModal) sessionModal.hide();
        await loadAllData();
        if (completed) {
            fireConfetti();
            summaryTaskId    = currentTaskId;
            summaryTaskTitle = currentTaskTitle;
            const msgEl = document.getElementById('completionMsg');
            const name  = userProfile?.userName ? `, ${userProfile.userName}` : '';
            if (msgEl) msgEl.textContent = `You finished "${currentTaskTitle}"${name}. Outstanding work!`;
            setTimeout(() => { if (completionModal) completionModal.show(); }, 400);
        } else {
            // Show note prompt modal instead of a dismissable toast
            showNotePrompt(pagesRead, currentTaskId, currentTaskTitle);
        }
    } catch(e) { console.error(e); window.showToast('Error saving session. Please try again.'); }
};

// Called from completion modal
window.openSummaryAfterCompletion = function() {
    if (completionModal) completionModal.hide();
    setTimeout(() => openSummaryModal(summaryTaskId, summaryTaskTitle), 300);
};

// ── NOTE PROMPT (post-session) ─────────────────────────────────────────────
function showNotePrompt(pagesRead, taskId, taskTitle) {
    summaryTaskId    = taskId;
    summaryTaskTitle = taskTitle;
    const aiName = userProfile?.aiName || 'AI';
    document.getElementById('notePromptPages').textContent = `${pagesRead} pages`;
    document.getElementById('notePromptTask').textContent  = taskTitle;
    document.getElementById('notePromptAiLabel').textContent = `🤖 ${aiName} · Why notes matter`;
    document.getElementById('notePromptNudge').style.display  = 'none';
    document.getElementById('notePromptNoBtn').style.display  = 'block';
    document.getElementById('notePromptSkipBtn').style.display = 'none';
    pushInAppNotif('info', '📚', 'Session Logged', `${pagesRead} pages logged for "${taskTitle}".`);
    setTimeout(() => { if (notePromptModal) notePromptModal.show(); }, 350);
}

window.notePromptYes = function() {
    if (notePromptModal) notePromptModal.hide();
    setTimeout(() => openSummaryModal(summaryTaskId, summaryTaskTitle), 300);
};

window.notePromptNo = async function() {
    // Show AI nudge, hide "No thanks", show "Skip anyway"
    const nudge   = document.getElementById('notePromptNudge');
    const noBtn   = document.getElementById('notePromptNoBtn');
    const skipBtn = document.getElementById('notePromptSkipBtn');
    const aiText  = document.getElementById('notePromptAiText');
    const aiName  = userProfile?.aiName || 'AI';
    if (nudge)   nudge.style.display   = 'block';
    if (noBtn)   noBtn.style.display   = 'none';
    if (skipBtn) skipBtn.style.display = 'block';
    if (aiText)  aiText.innerHTML = '<span style="opacity:0.4;">Thinking…</span>';

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                system: `You are ${aiName}, a study companion in the ReadSmartly app. You give short, warm, evidence-based reasons why saving a session note right after studying dramatically improves long-term retention. Be encouraging, specific, and keep it to 2 sentences max.`,
                messages: [{ role: 'user', content: `The student just finished reading ${document.getElementById('notePromptPages')?.textContent || 'some pages'} of "${summaryTaskTitle}". Give them one compelling reason to save a note right now instead of skipping.` }]
            })
        });
        const data = await response.json();
        const msg  = data.content?.[0]?.text || `Studies show that writing what you just read — even just 2 sentences — can double how much you remember in a week. It only takes 60 seconds.`;
        if (aiText) aiText.textContent = msg;
    } catch(e) {
        if (aiText) aiText.textContent = `Studies show that writing what you just read — even just 2 sentences — can double how much you remember in a week. It only takes 60 seconds.`;
    }
};

window.notePromptSkip = function() {
    if (notePromptModal) notePromptModal.hide();
};

// ── AI REVIEW QUESTIONS (generated from actual note content) ───────────────
async function generateReviewQuestions(noteContent, taskTitle) {
    const aiName = userProfile?.aiName || 'AI';
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1000,
                system: `You are ${aiName}, a study companion. Generate exactly 3 short, specific review questions based on the student's actual study note. Questions should test recall and understanding of what they specifically wrote — not generic questions. Return ONLY a JSON array of 3 strings, no other text.`,
                messages: [{ role: 'user', content: `Task: "${taskTitle}"\n\nStudent's note:\n${noteContent}\n\nGenerate 3 specific review questions based on this note.` }]
            })
        });
        const data = await response.json();
        const raw  = data.content?.[0]?.text || '[]';
        const clean = raw.replace(/```json|```/g, '').trim();
        return JSON.parse(clean);
    } catch(e) {
        // Fallback to generic questions if AI fails
        return [
            'What was the main idea from your last session on this topic?',
            'Which concept stood out most and why?',
            'Is there anything from your last session that still feels unclear?',
        ];
    }
}

// ── SUMMARY MODAL ──────────────────────────────────────────────────────────
window.openSummaryModal = function(taskId, taskTitle) {
    summaryTaskId    = taskId    || summaryTaskId;
    summaryTaskTitle = taskTitle || summaryTaskTitle;
    const titleEl = document.getElementById('summaryTaskName');
    if (titleEl) titleEl.textContent = summaryTaskTitle;
    switchSummaryTab('text');
    const tc = document.getElementById('summaryTextContent'); if(tc) tc.value='';
    const tr = document.getElementById('summaryRecTranscript'); if(tr) tr.textContent='Start speaking and your words will appear here';
    if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition=null; }
    voiceTranscript = '';
    const vBtn = document.getElementById('summaryVoiceBtn');
    if (vBtn) { vBtn.innerHTML='<i class="bi bi-mic-fill me-1"></i>Start Recording'; vBtn.onclick=startSummaryVoice; }
    const dot = document.getElementById('summaryRecDot'); if(dot) dot.style.display='none';
    if (summaryModal) summaryModal.show();
};

window.switchSummaryTab = function(tab) {
    switchSummaryTab(tab);
};

function switchSummaryTab(tab) {
    document.getElementById('summaryTextTab')?.classList.toggle('active', tab==='text');
    document.getElementById('summaryVoiceTab')?.classList.toggle('active', tab==='voice');
    const tp = document.getElementById('summaryTextPanel');  if(tp)  tp.style.display  = tab==='text'  ? 'block':'none';
    const vp = document.getElementById('summaryVoicePanel'); if(vp)  vp.style.display  = tab==='voice' ? 'block':'none';
}

window.startSummaryVoice = startSummaryVoice;
function startSummaryVoice() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { window.showToast('Voice notes need Chrome or Edge'); return; }
    voiceTranscript = '';
    const tr  = document.getElementById('summaryRecTranscript'); if(tr) tr.textContent='Listening…';
    const dot = document.getElementById('summaryRecDot'); if(dot) dot.style.display='inline-block';
    const vBtn = document.getElementById('summaryVoiceBtn'); if(vBtn) { vBtn.innerHTML='<i class="bi bi-stop-fill me-1"></i>Stop Recording'; vBtn.onclick=stopSummaryVoice; }
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    voiceRecognition = new SR();
    voiceRecognition.continuous=true; voiceRecognition.interimResults=true; voiceRecognition.lang='en-US';
    voiceRecognition.onresult = e => {
        let interim = '', finalPart = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalPart += e.results[i][0].transcript;
            else interim += e.results[i][0].transcript;
        }
        if (finalPart) voiceTranscript += finalPart;
        if (tr) tr.textContent = (voiceTranscript + interim) || 'Listening…';
    };
    voiceRecognition.onerror = () => { stopSummaryVoice(); window.showToast('Microphone error. Please try again.'); };
    voiceRecognition.start();
}

window.stopSummaryVoice = stopSummaryVoice;
function stopSummaryVoice() {
    if (voiceRecognition) { voiceRecognition.stop(); voiceRecognition=null; }
    const dot  = document.getElementById('summaryRecDot'); if(dot) dot.style.display='none';
    const vBtn = document.getElementById('summaryVoiceBtn'); if(vBtn) { vBtn.innerHTML='<i class="bi bi-mic-fill me-1"></i>Start Recording'; vBtn.onclick=startSummaryVoice; }
}

window.saveSummary = async function() {
    const isText = document.getElementById('summaryTextTab')?.classList.contains('active');
    let noteContent  = isText
        ? (document.getElementById('summaryTextContent')?.value.trim() || '')
        : (voiceTranscript.trim() || '');
    if (!isText) stopSummaryVoice();
    // Fallback: check displayed transcript text
    if (!noteContent && !isText) {
        const transcriptEl = document.getElementById('summaryRecTranscript');
        const transcriptTxt = transcriptEl?.textContent?.trim() || '';
        if (transcriptTxt && transcriptTxt !== 'Start speaking and your words will appear here' && transcriptTxt !== 'Listening…') {
            noteContent = transcriptTxt;
        }
    }
    if (!noteContent) {
        window.showToast(isText ? 'Please write something first.' : 'No recording found. Please try again.'); return;
    }
    // Ensure we have a valid taskId
    const tid = summaryTaskId || 'general';
    const ttitle = summaryTaskTitle || 'General Note';
    await saveTaskSummary(tid, ttitle, noteContent, isText ? 'text' : 'voice');
    if (summaryModal) summaryModal.hide();
};

async function saveTaskSummary(taskId, taskTitle, noteContent, type) {
    if (!currentUser) { window.showToast('Please log in to save notes.'); return; }
    if (!noteContent || !noteContent.trim()) { window.showToast('Nothing to save.'); return; }

    // Build the document — userId must match request.auth.uid in Firestore rules
    const noteDoc = {
        userId:    currentUser.uid,           // CRITICAL: must match auth.uid for write rule
        taskId:    taskId    || 'general',
        taskTitle: taskTitle || 'General Note',
        content:   noteContent.trim(),
        type:      type || 'text',
        createdAt: Timestamp.now(),
    };

    try {
        const docRef = await addDoc(collection(db, 'summaries'), noteDoc);
        console.log('Summary saved with ID:', docRef.id);
        window.showToast(type === 'voice' ? 'Voice note saved.' : 'Note saved.');
        pushInAppNotif('success', '📝', 'Note Saved', `${type === 'voice' ? 'Voice note' : 'Study note'} saved for "${taskTitle}".`);
        loadNotes(); // refresh the notes panel live`);
    } catch(e) {
        console.error('Summary save error:', e.code, e.message);
        if (e.code === 'permission-denied') {
            // Provide specific guidance - the rules file needs updating
            pushInAppNotif('warn', '⚠️', 'Save Failed', 'Firestore permission denied. Update rules to allow summaries writes.');
            window.showToast('Permission denied. See SETUP.md — add summaries rule to Firestore.');
        } else if (e.code === 'unavailable') {
            window.showToast('No internet connection. Your note was not saved.');
        } else {
            window.showToast('Could not save note: ' + (e.message || 'Unknown error'));
        }
    }
}

// ── READING TIMER ──────────────────────────────────────────────────────────
// Standalone timer (no task required)
window.openStandaloneTimer = function() {
    window.openTimerModal(null, 'Focus Session');
};

window.openTimerModal = function(taskId, taskTitle) {
    timerTaskId    = taskId    || null;
    timerTaskTitle = taskTitle || 'Focus Session';
    clearInterval(timerInterval); clearInterval(notifInterval); timerInterval=null;
    const tn = document.getElementById('timerTaskName'); if(tn) tn.textContent=timerTaskTitle;
    document.getElementById('timerSetup').style.display   = 'block';
    document.getElementById('timerRunning').style.display = 'none';
    const done = document.getElementById('timerDone'); if(done) done.style.display='none';
    const sel  = document.getElementById('timerDuration'); if(sel) sel.value='25';
    updateTimerPreview();
    if (timerModal) timerModal.show();
};

window.updateTimerPreview = updateTimerPreview;
function updateTimerPreview() {
    const mins = parseInt(document.getElementById('timerDuration')?.value) || 25;
    const el   = document.getElementById('timerPreviewDisplay');
    if (el) el.textContent = `${String(mins).padStart(2,'0')}:00`;
    timerTotalSecs = mins * 60;
    timerSeconds   = timerTotalSecs;
}

// ── TIMER PRESET & CUSTOM INPUT ────────────────────────────────────────────
window.setTimerPreset = function(mins) {
    // Update hidden input
    const dur = document.getElementById('timerDuration');
    if (dur) dur.value = mins;
    // Update custom fields
    const mEl = document.getElementById('timerCustomMins');
    const sEl = document.getElementById('timerCustomSecs');
    if (mEl) mEl.value = mins;
    if (sEl) sEl.value = '';
    // Update preview
    const el = document.getElementById('timerPreviewDisplay');
    if (el) el.textContent = `${String(mins).padStart(2,'0')}:00`;
    timerTotalSecs = mins * 60;
    timerSeconds   = timerTotalSecs;
    // Update active preset button
    document.querySelectorAll('.timer-preset').forEach(b => b.classList.remove('active'));
    // Mark the clicked one
    const btns = document.querySelectorAll('.timer-preset');
    btns.forEach(b => { if (b.textContent.trim() === `${mins} min`) b.classList.add('active'); });
};

window.focusCustomInput = function() {
    const el = document.getElementById('timerCustomMins');
    if (el) el.focus();
};

window.onCustomTimerInput = function() {
    const mEl = document.getElementById('timerCustomMins');
    const sEl = document.getElementById('timerCustomSecs');
    const m = parseInt(mEl?.value) || 0;
    const s = Math.min(parseInt(sEl?.value) || 0, 59);
    const total = (m * 60) + s;
    if (total < 1) return;
    timerTotalSecs = total;
    timerSeconds   = total;
    // Update hidden duration (in whole minutes for backward compat)
    const dur = document.getElementById('timerDuration');
    if (dur) dur.value = m;
    // Update preview
    const el = document.getElementById('timerPreviewDisplay');
    if (el) el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    // Deselect all presets
    document.querySelectorAll('.timer-preset').forEach(b => b.classList.remove('active'));
};

window.startTimer = function() {
    // Determine duration from custom input or preset
    const mEl = document.getElementById('timerCustomMins');
    const sEl = document.getElementById('timerCustomSecs');
    const hasCustom = mEl && (parseInt(mEl.value) > 0 || parseInt(sEl?.value) > 0);
    let totalSecs;
    if (hasCustom) {
        const m = parseInt(mEl.value) || 0;
        const s = Math.min(parseInt(sEl?.value) || 0, 59);
        totalSecs = (m * 60) + s;
    } else {
        const mins = parseInt(document.getElementById('timerDuration')?.value) || 25;
        totalSecs = mins * 60;
    }
    if (totalSecs < 5) { window.showToast('Please set a duration of at least 5 seconds.'); return; }

    timerTotalSecs = totalSecs;
    timerSeconds   = totalSecs;
    timerEndTimestamp = Date.now() + (totalSecs * 1000);
    timerRunningInBg  = false;

    // Persist to localStorage for background recovery
    localStorage.setItem('rs_timer', JSON.stringify({
        endAt: timerEndTimestamp,
        total: timerTotalSecs,
        taskId: timerTaskId || null,
        taskTitle: timerTaskTitle || 'Focus Session',
        startedAt: Date.now(),
    }));

    document.getElementById('timerSetup').style.display   = 'none';
    document.getElementById('timerRunning').style.display = 'block';
    // Footer swap
    document.getElementById('timerSetupFooter').style.display   = 'none';
    document.getElementById('timerRunningFooter').style.display = 'flex';
    document.getElementById('timerDoneFooter').style.display    = 'none';

    // Reset ring stroke
    const ring = document.getElementById('timerRing');
    if (ring) { ring.style.stroke='#2563EB'; const c=2*Math.PI*54; ring.style.strokeDasharray=c; ring.style.strokeDashoffset=0; }
    updateTimerRunningUI();

    clearInterval(timerInterval);
    timerInterval = setInterval(timerTick, 1000);
    scheduleEncouragementNotifs(Math.ceil(totalSecs / 60));
    window.showToast('Timer started. Good luck!');
};

function timerTick() {
    // Recalculate from absolute timestamp (handles tab sleep accurately)
    const remaining = Math.max(0, Math.round((timerEndTimestamp - Date.now()) / 1000));
    timerSeconds = remaining;
    updateTimerRunningUI();
    updateBgTimerBar();
    if (remaining <= 0) {
        clearInterval(timerInterval); clearInterval(notifInterval); timerInterval = null;
        localStorage.removeItem('rs_timer');
        onTimerComplete();
    }
}

// Background timer bar (pill shown when modal is closed while running)
function updateBgTimerBar() {
    const bar = document.getElementById('bgTimerBar');
    const txt = document.getElementById('bgTimerText');
    if (!bar || !txt) return;
    const m = Math.floor(timerSeconds / 60), s = timerSeconds % 60;
    txt.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} remaining`;
    if (timerRunningInBg) {
        bar.style.display = 'flex';
    }
}

window.reopenTimerModal = function() {
    timerRunningInBg = false;
    const bar = document.getElementById('bgTimerBar');
    if (bar) bar.style.display = 'none';
    if (timerModal) timerModal.show();
    // Make sure running state is visible
    const setup = document.getElementById('timerSetup');
    const run   = document.getElementById('timerRunning');
    if (setup) setup.style.display = 'none';
    if (run)   run.style.display   = 'block';
    document.getElementById('timerSetupFooter').style.display   = 'none';
    document.getElementById('timerRunningFooter').style.display = 'flex';
};

// Listen for modal close while timer is running
document.addEventListener('DOMContentLoaded', () => {
    const tmEl = document.getElementById('timerModal');
    if (tmEl) {
        tmEl.addEventListener('hide.bs.modal', () => {
            if (timerInterval !== null && timerSeconds > 0) {
                timerRunningInBg = true;
                const bar = document.getElementById('bgTimerBar');
                if (bar) bar.style.display = 'flex';
                pushInAppNotif('system', '⏱️', 'Timer Running', `${timerTaskTitle} timer continues in background.`);
            }
        });
        tmEl.addEventListener('show.bs.modal', () => {
            timerRunningInBg = false;
            const bar = document.getElementById('bgTimerBar');
            if (bar) bar.style.display = 'none';
        });
    }
});

// Recover timer on page reload if still running
function tryRecoverTimer() {
    try {
        const saved = localStorage.getItem('rs_timer');
        if (!saved) return;
        const data = JSON.parse(saved);
        const remaining = Math.round((data.endAt - Date.now()) / 1000);
        if (remaining <= 5) { localStorage.removeItem('rs_timer'); return; }
        timerTaskId       = data.taskId;
        timerTaskTitle    = data.taskTitle || 'Focus Session';
        timerTotalSecs    = data.total;
        timerSeconds      = remaining;
        timerEndTimestamp = data.endAt;
        timerRunningInBg  = true;
        clearInterval(timerInterval);
        timerInterval = setInterval(timerTick, 1000);
        updateBgTimerBar();
        const bar = document.getElementById('bgTimerBar');
        if (bar) bar.style.display = 'flex';
        const tn = document.getElementById('timerTaskName');
        if (tn) tn.textContent = timerTaskTitle;
        // Push an in-app notification about recovery
        pushInAppNotif('system', '⏱️', 'Timer Recovered', `${timerTaskTitle} — ${Math.ceil(remaining/60)} min remaining.`);
    } catch(e) { localStorage.removeItem('rs_timer'); }
}

function updateTimerRunningUI() {
    const m=Math.floor(timerSeconds/60), s=timerSeconds%60;
    const disp = document.getElementById('timerCountdown');
    if (disp) disp.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const ring = document.getElementById('timerRing');
    if (ring) {
        const c=2*Math.PI*54, prog=timerSeconds/timerTotalSecs;
        ring.style.strokeDasharray=c; ring.style.strokeDashoffset=c*(1-prog);
        if (timerSeconds<=60) ring.style.stroke='#EF4444';
    }
    const pct = (timerTotalSecs-timerSeconds)/timerTotalSecs;
    const msgEl = document.getElementById('timerEncouragement');
    if (msgEl) {
        const aiName=userProfile?.aiName||'AI', msgs=getEncouragementMessages(aiName,timerTaskTitle);
        msgEl.textContent=msgs[Math.min(Math.floor(pct*msgs.length),msgs.length-1)];
    }
}

function onTimerComplete() {
    document.getElementById('timerRunning').style.display='none';
    const done=document.getElementById('timerDone'); if(done) done.style.display='block';
    document.getElementById('timerSetupFooter').style.display  = 'none';
    document.getElementById('timerRunningFooter').style.display = 'none';
    document.getElementById('timerDoneFooter').style.display   = 'flex';
    timerRunningInBg = false;
    const bar = document.getElementById('bgTimerBar');
    if (bar) bar.style.display = 'none';
    sendNotification('ReadSmartly: Session Complete!', `Great work on "${timerTaskTitle}". Time to log your session.`, true);
    pushInAppNotif('success', '✅', 'Session Complete!', `Great work on "${timerTaskTitle}". Log your pages while they're fresh.`);
    fireConfetti();
}

function getEncouragementMessages(aiName, title) {
    return [
        `${aiName}: You are getting started. Every page counts.`,
        `${aiName}: Good rhythm. Stay focused on your reading.`,
        `${aiName}: You are doing great. Keep that momentum going.`,
        `${aiName}: Halfway there! Your brain is absorbing this.`,
        `${aiName}: Nearly done. Push through to the finish.`,
        `${aiName}: Last stretch. You have got this!`,
    ];
}

function scheduleEncouragementNotifs(totalMins) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    clearInterval(notifInterval);
    const intervalMs=Math.max(5,Math.floor(totalMins/4))*60*1000;
    let count=0;
    const aiName=userProfile?.aiName||'AI', msgs=getEncouragementMessages(aiName,timerTaskTitle);
    notifInterval = setInterval(() => {
        count++; if(count>=msgs.length-1){clearInterval(notifInterval);return;}
        sendNotification(`ReadSmartly: ${aiName} Check-in`, msgs[count], false);
    }, intervalMs);
}

function sendNotification(title, body, requireInteraction) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        // Use service worker registration if available — works when tab is in background
        if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification(title, { body, requireInteraction, tag: 'readsmartly-timer', icon: '/favicon.ico' });
            });
        } else {
            new Notification(title, { body, requireInteraction, tag: 'readsmartly-timer' });
        }
    } catch(e) {}
}

// ── IN-APP NOTIFICATION CENTER ─────────────────────────────────────────────
function pushInAppNotif(type, icon, title, body) {
    // type: 'info' | 'warn' | 'success' | 'system'
    const notif = {
        id: Date.now(),
        type, icon, title, body,
        time: new Date(),
        read: false,
    };
    inAppNotifs.unshift(notif);
    // Cap at 50 notifications
    if (inAppNotifs.length > 50) inAppNotifs = inAppNotifs.slice(0, 50);
    renderNotifPanel();
    // Animate bell
    const bell = document.getElementById('notifBellBtn');
    if (bell) { bell.style.transform = 'scale(1.2)'; setTimeout(() => bell.style.transform = '', 300); }
}

window.pushInAppNotif = pushInAppNotif;  // expose for external calls

function renderNotifPanel() {
    const list = document.getElementById('notifList');
    const badge = document.getElementById('notifBadge');
    if (!list) return;
    const unread = inAppNotifs.filter(n => !n.read).length;
    if (badge) {
        if (unread > 0) {
            badge.textContent = unread > 9 ? '9+' : unread;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
    if (inAppNotifs.length === 0) {
        list.innerHTML = `<div style="text-align:center;padding:2rem 1rem;font-size:0.85rem;color:var(--slate);"><i class="bi bi-bell-slash" style="font-size:1.75rem;display:block;margin-bottom:0.5rem;opacity:0.35;"></i>No notifications yet</div>`;
        return;
    }
    const typeClass = { warn: 'warn', success: 'success', info: 'unread', system: 'system' };
    list.innerHTML = inAppNotifs.map(n => {
        const diff = Math.floor((Date.now() - n.time) / 60000);
        const timeStr = diff < 1 ? 'Just now' : diff < 60 ? `${diff}m ago` : `${Math.floor(diff/60)}h ago`;
        const cls = n.read ? '' : (typeClass[n.type] || 'unread');
        return `<div class="notif-item ${cls}" onclick="markNotifRead(${n.id})">
            <div class="notif-icon">${n.icon}</div>
            <div style="flex:1;min-width:0;">
                <div class="notif-title">${n.title}</div>
                <div class="notif-body">${n.body}</div>
                <div class="notif-time">${timeStr}</div>
            </div>
        </div>`;
    }).join('');
}

window.toggleNotifPanel = function() {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    const isOpen = panel.style.display === 'flex';
    panel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
        // Mark all as read when opened
        inAppNotifs.forEach(n => n.read = true);
        renderNotifPanel();
    }
};

window.clearAllNotifs = function() {
    inAppNotifs = [];
    renderNotifPanel();
};

window.markNotifRead = function(id) {
    const n = inAppNotifs.find(x => x.id === id);
    if (n) { n.read = true; renderNotifPanel(); }
};

// Close panel when clicking outside
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notifPanel');
    const bell  = document.getElementById('notifBellBtn');
    if (panel && panel.style.display === 'flex' && !panel.contains(e.target) && !bell?.contains(e.target)) {
        panel.style.display = 'none';
    }
});

window.pauseTimer = function() {
    if (timerInterval) {
        clearInterval(timerInterval); timerInterval=null;
        const btn=document.getElementById('timerPauseBtn');
        if(btn){btn.innerHTML='<i class="bi bi-play-fill me-1"></i>Resume';btn.onclick=window.resumeTimer;}
    }
};
window.resumeTimer = function() {
    // Recalculate absolute end timestamp from remaining seconds, then use the tick engine
    timerEndTimestamp = Date.now() + (timerSeconds * 1000);
    timerInterval = setInterval(timerTick, 1000);
    const btn=document.getElementById('timerPauseBtn');
    if(btn){btn.innerHTML='<i class="bi bi-pause-fill me-1"></i>Pause';btn.onclick=window.pauseTimer;}
};
window.cancelTimer = function() {
    clearInterval(timerInterval); clearInterval(notifInterval);
    timerInterval = null; timerRunningInBg = false;
    localStorage.removeItem('rs_timer');
    const bar = document.getElementById('bgTimerBar');
    if (bar) bar.style.display = 'none';
    if(timerModal) timerModal.hide();
};
window.timerLogSession = function() {
    if(timerModal) timerModal.hide();
    if (timerTaskId) {
        // Open session modal for that specific task
        setTimeout(() => openSessionModal(timerTaskId, timerTaskTitle), 300);
    } else {
        // No task attached: show task list toast so user can pick one
        window.showToast('Session complete! Pick a task below to log your pages.');
    }
};

// ════════════════════════════════════════════════════════════════════════════
// SESSION 9: NEW FEATURES
// ════════════════════════════════════════════════════════════════════════════

// ── ANALYTICS HELPER ──────────────────────────────────────────────────────
async function trackEvent(event, props = {}) {
    if (!currentUser) return;
    try {
        await addDoc(collection(db, 'analytics'), {
            userId: currentUser.uid,
            event,
            props,
            ts: Timestamp.now(),
            studyType: userProfile?.studyType || null,
            pgType:    userProfile?.pgType    || null,
        });
    } catch(e) { /* analytics failure is silent */ }
}
window.trackEvent = trackEvent;

// ── POMODORO MODE ─────────────────────────────────────────────────────────
let pomodoroActive    = false;
let pomodoroCycle     = 0;   // 0-based: 0,2,4... = work; 1,3,5... = break
let pomodoroWorkMins  = 25;
let pomodoroBreakMins = 5;
let pomodoroTotalCycles = 4; // work cycles before long break

window.openPomodoroSetup = function() {
    pomodoroActive = false;
    pomodoroCycle  = 0;
    const setupEl = document.getElementById('pomSetup');
    const runEl   = document.getElementById('pomRunning');
    if (setupEl) setupEl.style.display = 'block';
    if (runEl)   runEl.style.display   = 'none';
    const pmEl = document.getElementById('pomodoroModal');
    if (pmEl) new bootstrap.Modal(pmEl).show();
    trackEvent('pomodoro_setup_opened');
};

window.startPomodoro = function() {
    pomodoroWorkMins    = parseInt(document.getElementById('pomWorkMins')?.value)  || 25;
    pomodoroBreakMins   = parseInt(document.getElementById('pomBreakMins')?.value) || 5;
    pomodoroTotalCycles = parseInt(document.getElementById('pomCycles')?.value)    || 4;
    pomodoroCycle       = 0;
    pomodoroActive      = true;
    startPomodoroCycle();
    document.getElementById('pomSetup').style.display   = 'none';
    document.getElementById('pomRunning').style.display = 'block';
    window._showPomFooter?.('Running');
    trackEvent('pomodoro_started', { workMins: pomodoroWorkMins, breakMins: pomodoroBreakMins });
};

function startPomodoroCycle() {
    const isWork     = pomodoroCycle % 2 === 0;
    const workNum    = Math.floor(pomodoroCycle / 2) + 1;
    const isLongBreak = !isWork && workNum >= pomodoroTotalCycles;
    const mins        = isWork ? pomodoroWorkMins : isLongBreak ? pomodoroBreakMins * 3 : pomodoroBreakMins;

    updatePomodoroCycleUI(isWork, workNum, isLongBreak, mins);

    // Reuse the main timer engine
    timerTotalSecs    = mins * 60;
    timerSeconds      = timerTotalSecs;
    timerEndTimestamp = Date.now() + timerTotalSecs * 1000;
    localStorage.setItem('rs_timer', JSON.stringify({
        endAt: timerEndTimestamp, total: timerTotalSecs,
        taskId: timerTaskId || null, taskTitle: timerTaskTitle || 'Pomodoro',
        startedAt: Date.now(), pomodoro: true,
    }));

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const rem = Math.max(0, Math.round((timerEndTimestamp - Date.now()) / 1000));
        timerSeconds = rem;
        updatePomTimerDisplay(rem);
        if (rem <= 0) {
            clearInterval(timerInterval); timerInterval = null;
            localStorage.removeItem('rs_timer');
            onPomodoroCycleComplete(isWork, workNum);
        }
    }, 1000);
}

function updatePomodoroCycleUI(isWork, workNum, isLongBreak, mins) {
    const label  = document.getElementById('pomCycleLabel');
    const badge  = document.getElementById('pomCycleBadge');
    const dots   = document.getElementById('pomDots');
    if (label) label.textContent = isWork ? `Work Session ${workNum}` : isLongBreak ? 'Long Break' : 'Short Break';
    if (badge) { badge.textContent = isWork ? 'Focus' : 'Rest'; badge.style.background = isWork ? '#2563EB' : '#10B981'; }
    if (dots) {
        dots.innerHTML = '';
        for (let i = 0; i < pomodoroTotalCycles; i++) {
            const d = document.createElement('div');
            d.style.cssText = `width:10px;height:10px;border-radius:50%;background:${i < Math.floor(pomodoroCycle/2) ? 'var(--amber)' : i === Math.floor(pomodoroCycle/2) && isWork ? 'var(--blue)' : 'rgba(255,255,255,0.15)'};transition:background 0.3s;`;
            dots.appendChild(d);
        }
    }
}

function updatePomTimerDisplay(rem) {
    const m = Math.floor(rem / 60), s = rem % 60;
    const el = document.getElementById('pomCountdown');
    if (el) el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const ring = document.getElementById('pomRing');
    if (ring) {
        const c = 2 * Math.PI * 54;
        ring.style.strokeDasharray  = c;
        ring.style.strokeDashoffset = c * (1 - rem / timerTotalSecs);
        ring.style.stroke = rem / timerTotalSecs < 0.25 ? '#EF4444' : pomodoroCycle % 2 === 0 ? '#2563EB' : '#10B981';
    }
}

function onPomodoroCycleComplete(wasWork, workNum) {
    const aiName = userProfile?.aiName || 'AI';
    if (wasWork) {
        sendNotification('Pomodoro: Work done!', `${aiName}: Great focus! Time for a break.`, false);
        pushInAppNotif('success', '🍅', 'Work Session Done!', `${aiName}: Session ${workNum} complete. Take a well-earned break.`);
        if (workNum >= pomodoroTotalCycles) {
            // All work cycles done — long break
            pomodoroCycle++;
            startPomodoroCycle();
        } else {
            pomodoroCycle++;
            startPomodoroCycle(); // auto-start break
        }
    } else {
        // Break done — check if all cycles complete
        const completedWork = Math.ceil(pomodoroCycle / 2);
        if (completedWork >= pomodoroTotalCycles) {
            onPomodoroComplete();
        } else {
            sendNotification('Pomodoro: Break over!', `${aiName}: Time to focus again.`, false);
            pomodoroCycle++;
            startPomodoroCycle();
        }
    }
    trackEvent('pomodoro_cycle_complete', { cycle: pomodoroCycle, wasWork });
}

function onPomodoroComplete() {
    pomodoroActive = false;
    clearInterval(timerInterval);
    const doneEl = document.getElementById('pomDone');
    const runEl  = document.getElementById('pomRunning');
    if (runEl)  runEl.style.display  = 'none';
    if (doneEl) doneEl.style.display = 'block';
    window._showPomFooter?.('Done');
    const aiName = userProfile?.aiName || 'AI';
    sendNotification('Pomodoro Complete!', `${aiName}: Incredible work. All ${pomodoroTotalCycles} sessions done!`, true);
    pushInAppNotif('success', '🍅', 'Pomodoro Complete!', `All ${pomodoroTotalCycles} work sessions done. Outstanding focus!`);
    fireConfetti();
    trackEvent('pomodoro_completed', { totalCycles: pomodoroTotalCycles });
}

window.skipPomCycle = function() {
    clearInterval(timerInterval); timerInterval = null;
    pomodoroCycle++;
    if (Math.floor(pomodoroCycle / 2) >= pomodoroTotalCycles) { onPomodoroComplete(); return; }
    startPomodoroCycle();
};

window.cancelPomodoro = function() {
    clearInterval(timerInterval); timerInterval = null;
    pomodoroActive = false;
    localStorage.removeItem('rs_timer');
    // Reset UI for next open
    const setupEl = document.getElementById('pomSetup');
    const runEl   = document.getElementById('pomRunning');
    const doneEl  = document.getElementById('pomDone');
    if (setupEl) setupEl.style.display = 'block';
    if (runEl)   runEl.style.display   = 'none';
    if (doneEl)  doneEl.style.display  = 'none';
    window._showPomFooter?.('Setup');
    const pmEl = document.getElementById('pomodoroModal');
    if (pmEl) bootstrap.Modal.getInstance(pmEl)?.hide();
    trackEvent('pomodoro_cancelled', { cyclesCompleted: Math.floor(pomodoroCycle / 2) });
};


// ── WEEKLY REVIEW ─────────────────────────────────────────────────────────
window.openWeeklyReview = async function() {
    const el = document.getElementById('weeklyReviewBody');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--slate);">Loading your week...</div>';
    const wrModal = document.getElementById('weeklyReviewModal');
    if (wrModal) new bootstrap.Modal(wrModal).show();
    trackEvent('weekly_review_opened');

    try {
        const q  = query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc'));
        const ss = await getDocs(q);
        const now   = new Date();
        const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0,0,0,0);
        const prevStart = new Date(weekStart); prevStart.setDate(prevStart.getDate() - 7);

        let thisWeekPages = 0, thisWeekMins = 0, thisWeekDays = new Set();
        let prevWeekPages = 0;
        const taskPageMap = {};
        ss.forEach(d => {
            const data = d.data();
            const date = data.date.toDate();
            if (date >= weekStart) {
                thisWeekPages += data.pagesRead || 0;
                thisWeekMins  += data.duration  || 0;
                thisWeekDays.add(date.toDateString());
                if (data.taskTitle) taskPageMap[data.taskTitle] = (taskPageMap[data.taskTitle] || 0) + (data.pagesRead || 0);
            } else if (date >= prevStart) {
                prevWeekPages += data.pagesRead || 0;
            }
        });

        const topTask    = Object.entries(taskPageMap).sort((a,b) => b[1] - a[1])[0];
        const changeText = prevWeekPages > 0
            ? (thisWeekPages > prevWeekPages ? `▲ ${Math.round(((thisWeekPages - prevWeekPages)/prevWeekPages)*100)}% vs last week` : `▼ ${Math.round(((prevWeekPages - thisWeekPages)/prevWeekPages)*100)}% vs last week`)
            : 'First week of data';
        const aiName = userProfile?.aiName || 'AI';
        const name   = userProfile?.userName || 'there';
        const changeColor = thisWeekPages >= prevWeekPages ? '#10B981' : '#EF4444';

        // Load tasks behind schedule
        const tq = query(collection(db,'tasks'), where('userId','==',currentUser.uid));
        const ts = await getDocs(tq);
        const behindTasks = [];
        ts.forEach(d => {
            const t = d.data();
            const rem   = Math.max(0, (t.totalPages||0) - (t.pagesRead||0));
            if (!rem) return;
            const days  = t.deadline ? Math.max(1, Math.ceil((t.deadline.seconds*1000 - Date.now()) / 86400000)) : 999;
            const speed = userProfile?.readingSpeed || 30;
            const needed = Math.ceil(rem / days);
            const actual = taskPageMap[t.title] ? Math.round(taskPageMap[t.title] / 7) : 0;
            if (actual < needed * 0.7) behindTasks.push({ name: t.title, needed, actual, days });
        });

        el.innerHTML = `
        <div style="background:var(--navy);border-radius:14px;padding:1.5rem;margin-bottom:1rem;color:#fff;">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.35);margin-bottom:0.35rem;">Week of ${weekStart.toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>
          <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800;margin-bottom:1.25rem;">${aiName}'s Weekly Report for ${name}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
            <div style="background:rgba(255,255,255,0.07);border-radius:10px;padding:0.9rem;text-align:center;">
              <div style="font-family:var(--font-head);font-size:2rem;font-weight:800;color:var(--amber);">${thisWeekPages}</div>
              <div style="font-size:0.65rem;color:rgba(255,255,255,0.4);text-transform:uppercase;">pages read</div>
              <div style="font-size:0.7rem;color:${changeColor};margin-top:0.25rem;">${changeText}</div>
            </div>
            <div style="background:rgba(255,255,255,0.07);border-radius:10px;padding:0.9rem;text-align:center;">
              <div style="font-family:var(--font-head);font-size:2rem;font-weight:800;color:var(--blue);">${thisWeekDays.size}</div>
              <div style="font-size:0.65rem;color:rgba(255,255,255,0.4);text-transform:uppercase;">days active</div>
              <div style="font-size:0.7rem;color:rgba(255,255,255,0.35);margin-top:0.25rem;">out of 7</div>
            </div>
            <div style="background:rgba(255,255,255,0.07);border-radius:10px;padding:0.9rem;text-align:center;">
              <div style="font-family:var(--font-head);font-size:2rem;font-weight:800;color:var(--green);">${thisWeekMins ? Math.round(thisWeekMins/60*10)/10 : 0}</div>
              <div style="font-size:0.65rem;color:rgba(255,255,255,0.4);text-transform:uppercase;">hours read</div>
            </div>
          </div>
        </div>
        ${topTask ? `<div class="ai-card green" style="margin-bottom:0.75rem;">
          <span class="ai-tag green">🏆 Top Course This Week</span>
          <p><strong>${topTask[0]}</strong> — ${topTask[1]} pages. ${aiName}: Keep that momentum going!</p>
        </div>` : ''}
        ${behindTasks.length ? `<div class="ai-card amber" style="margin-bottom:0.75rem;">
          <span class="ai-tag amber">⚠️ Behind Schedule</span>
          ${behindTasks.map(t => `<p style="margin-bottom:0.35rem;"><strong>${t.name}</strong>: need ~${t.needed} pg/day but averaging ~${t.actual} pg/day. Exam in ${t.days} day${t.days!==1?'s':''}.</p>`).join('')}
        </div>` : `<div class="ai-card green">
          <span class="ai-tag green">✅ On Track</span>
          <p>All courses are on schedule. ${aiName}: Keep up this strong week!</p>
        </div>`}
        <div style="text-align:center;padding-top:0.5rem;">
          <button class="btn-rs-ghost" style="font-size:0.8rem;gap:0.4rem;display:inline-flex;align-items:center;" onclick="exportReportPDF()">
            <i class="bi bi-file-earmark-pdf me-1"></i> Export as PDF
          </button>
        </div>`;
    } catch(e) {
        console.error('Weekly review error:', e);
        el.innerHTML = '<div style="color:var(--red);padding:1rem;">Could not load weekly review. Please try again.</div>';
    }
};


// ── MONTHLY CALENDAR (Task Completion Calendar) ───────────────────────────
window.openMonthCalendar = async function() {
    const el = document.getElementById('monthCalBody');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--slate);">Loading...</div>';
    const mcModal = document.getElementById('monthCalModal');
    if (mcModal) new bootstrap.Modal(mcModal).show();
    trackEvent('month_calendar_opened');

    try {
        const q  = query(collection(db,'sessions'), where('userId','==',currentUser.uid));
        const ss = await getDocs(q);
        const dayMap = {}; // 'YYYY-MM-DD' => pages
        ss.forEach(d => {
            const date = d.data().date.toDate();
            const key  = date.toISOString().split('T')[0];
            dayMap[key] = (dayMap[key] || 0) + (d.data().pagesRead || 0);
        });

        const now      = new Date();
        const year     = now.getFullYear();
        const month    = now.getMonth();
        const firstDay = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startWeekday = firstDay.getDay(); // 0=Sun
        const monthName = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

        const maxPages = Math.max(...Object.values(dayMap), 1);
        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

        let html = `<div style="margin-bottom:1rem;">
          <div style="font-family:var(--font-head);font-size:1rem;font-weight:700;color:var(--navy);margin-bottom:0.75rem;">${monthName}</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">
            ${dayNames.map(d => `<div style="text-align:center;font-size:0.6rem;font-weight:600;color:var(--slate);padding:0.2rem;">${d}</div>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">`;

        // Empty cells for days before month starts
        for (let i = 0; i < startWeekday; i++) html += `<div></div>`;

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const pages   = dayMap[dateStr] || 0;
            const isToday = d === now.getDate();
            const opacity = pages > 0 ? 0.2 + (pages / maxPages) * 0.8 : 0;
            const bg      = pages > 0 ? `rgba(37,99,235,${opacity.toFixed(2)})` : 'var(--bg)';
            const border  = isToday ? '2px solid var(--amber)' : '1px solid var(--border)';
            const tooltip = pages > 0 ? `${pages} pages` : 'No reading';
            html += `<div title="${dateStr}: ${tooltip}" style="aspect-ratio:1;border-radius:6px;background:${bg};border:${border};display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:default;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform=''">
              <span style="font-size:0.7rem;font-weight:${isToday?'800':'500'};color:${pages>0?'var(--navy)':'var(--slate)'};">${d}</span>
              ${pages > 0 ? `<span style="font-size:0.5rem;color:var(--slate);">${pages}p</span>` : ''}
            </div>`;
        }

        html += `</div></div>
        <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap;">
          <span style="font-size:0.72rem;color:var(--slate);">Less</span>
          ${[0.1,0.35,0.55,0.75,0.95].map(o => `<div style="width:14px;height:14px;border-radius:3px;background:rgba(37,99,235,${o});border:1px solid var(--border);"></div>`).join('')}
          <span style="font-size:0.72rem;color:var(--slate);">More</span>
          <span style="font-size:0.72rem;color:var(--slate);margin-left:0.5rem;">· Total this month: <strong>${Object.entries(dayMap).filter(([k]) => k.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)).reduce((a,[,v]) => a+v, 0)} pages</strong></span>
        </div>`;

        el.innerHTML = html;
    } catch(e) {
        el.innerHTML = '<div style="color:var(--red);">Could not load calendar.</div>';
    }
};


// ── CARRY-OVER DETECTION ──────────────────────────────────────────────────
async function checkCarryOver() {
    try {
        const sq = query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc'));
        const ss = await getDocs(sq);
        if (ss.empty) return;

        let lastDate = null;
        ss.forEach(d => { if (!lastDate) lastDate = d.data().date.toDate(); });
        const today = new Date(); today.setHours(0,0,0,0);
        const last  = new Date(lastDate); last.setHours(0,0,0,0);
        const daysMissed = Math.floor((today - last) / 86400000);
        if (daysMissed < 2) return;

        const tq = query(collection(db,'tasks'), where('userId','==',currentUser.uid));
        const ts = await getDocs(tq);
        const speed = userProfile?.readingSpeed || 30;
        let totalBehind = 0, catchUpToday = 0;
        ts.forEach(d => {
            const t   = d.data();
            const rem = Math.max(0, (t.totalPages||0) - (t.pagesRead||0));
            if (!rem) return;
            const days = t.deadline ? Math.max(1, Math.ceil((t.deadline.seconds*1000 - Date.now()) / 86400000)) : 30;
            const ppd  = Math.ceil(rem / days);
            totalBehind  += ppd * daysMissed;
            catchUpToday += ppd + Math.ceil((ppd * daysMissed) / Math.max(days, 1));
        });
        if (!catchUpToday) return;

        const aiName = userProfile?.aiName || 'AI';
        const mins   = Math.round((catchUpToday / speed) * 60);

        // Push to in-app notification bell — tapping it shows the detail
        pushInAppNotif('warn', '⚠️',
            `${daysMissed} days missed`,
            `${aiName}: You're ~${totalBehind} pages behind. Aim for ${catchUpToday} pages today (~${mins} min) to catch up.`
        );
        // Also send a browser push notification if permitted
        sendNotification(
            `ReadSmartly: ${daysMissed} days missed`,
            `${aiName}: You're ~${totalBehind} pages behind. Open the app to catch up.`,
            true
        );
        trackEvent('carryover_detected', { daysMissed, totalBehind, catchUpToday });
    } catch(e) { console.error('Carry-over check error:', e); }
}


// ── SESSION HISTORY ───────────────────────────────────────────────────────
window.openSessionHistory = async function() {
    const el = document.getElementById('historyBody');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--slate);">Loading sessions...</div>';
    const hmEl = document.getElementById('historyModal');
    if (hmEl) new bootstrap.Modal(hmEl).show();
    trackEvent('session_history_opened');

    try {
        const q  = query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc'));
        const ss = await getDocs(q);
        if (ss.empty) {
            el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--slate);">No sessions logged yet.</div>';
            return;
        }
        let totalPages = 0, totalMins = 0;
        const rows = [];
        ss.forEach(d => {
            const data = d.data();
            totalPages += data.pagesRead || 0;
            totalMins  += data.duration  || 0;
            rows.push(data);
        });
        el.innerHTML = `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:1.25rem;">
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-family:var(--font-head);font-size:1.5rem;font-weight:800;color:var(--blue);">${rows.length}</div>
              <div style="font-size:0.65rem;color:var(--slate);text-transform:uppercase;">Sessions</div>
            </div>
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-family:var(--font-head);font-size:1.5rem;font-weight:800;color:var(--amber);">${totalPages}</div>
              <div style="font-size:0.65rem;color:var(--slate);text-transform:uppercase;">Pages</div>
            </div>
            <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:0.75rem;text-align:center;">
              <div style="font-family:var(--font-head);font-size:1.5rem;font-weight:800;color:var(--green);">${totalMins ? Math.round(totalMins/60*10)/10 : 0}</div>
              <div style="font-size:0.65rem;color:var(--slate);text-transform:uppercase;">Hours</div>
            </div>
          </div>
          <div style="overflow-y:auto;max-height:340px;">
            ${rows.map(r => {
                const date = r.date.toDate();
                const dateStr = date.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
                const timeStr = date.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
                const speed   = r.duration && r.pagesRead ? Math.round((r.pagesRead / r.duration) * 60) : null;
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem 0.875rem;background:var(--bg);border:1px solid var(--border);border-radius:10px;margin-bottom:0.5rem;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-family:var(--font-head);font-size:0.85rem;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.taskTitle || 'General Session'}</div>
                    <div style="font-size:0.72rem;color:var(--slate);margin-top:0.1rem;">${dateStr} · ${timeStr}${r.duration ? ` · ${r.duration} min` : ''}</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0;margin-left:1rem;">
                    <div style="font-family:var(--font-head);font-size:1.1rem;font-weight:800;color:var(--blue);">${r.pagesRead}</div>
                    <div style="font-size:0.6rem;color:var(--slate);">pages${speed ? ` · ${speed} p/h` : ''}</div>
                  </div>
                </div>`;
            }).join('')}
          </div>`;
    } catch(e) {
        el.innerHTML = '<div style="color:var(--red);">Could not load session history.</div>';
    }
};


// ── EXPORT TO PDF ─────────────────────────────────────────────────────────
window.exportReportPDF = async function() {
    trackEvent('pdf_export_started');
    window.showToast('Preparing PDF report...');

    try {
        const sq = query(collection(db,'sessions'), where('userId','==',currentUser.uid), orderBy('date','desc'));
        const tq = query(collection(db,'tasks'),    where('userId','==',currentUser.uid));
        const [sessSnap, taskSnap] = await Promise.all([getDocs(sq), getDocs(tq)]);

        let totalPages = 0, totalMins = 0, sessionCount = 0;
        const dayMap = {}, taskMap = {};
        sessSnap.forEach(d => {
            const data = d.data();
            totalPages    += data.pagesRead || 0;
            totalMins     += data.duration  || 0;
            sessionCount++;
            const key = data.date.toDate().toISOString().split('T')[0];
            dayMap[key] = (dayMap[key] || 0) + (data.pagesRead || 0);
            if (data.taskTitle) taskMap[data.taskTitle] = (taskMap[data.taskTitle] || 0) + (data.pagesRead || 0);
        });

        const tasks = [];
        taskSnap.forEach(d => tasks.push({ id: d.id, ...d.data() }));
        const speed    = totalMins > 0 ? Math.round((totalPages / totalMins) * 60) : (userProfile?.readingSpeed || 0);
        const name     = userProfile?.userName || currentUser.email?.split('@')[0] || 'Student';
        const aiName   = userProfile?.aiName   || 'AI';
        const dateNow  = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

        // Build HTML for print
        const win = window.open('', '_blank', 'width=800,height=900');
        win.document.write(`<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>ReadSmartly Report – ${name}</title>
        <style>
          * { margin:0; padding:0; box-sizing:border-box; }
          body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #0F172A; padding: 40px 48px; font-size: 13px; line-height: 1.6; }
          h1   { font-size: 24px; font-weight: 800; color: #0F172A; margin-bottom: 4px; }
          h2   { font-size: 14px; font-weight: 700; color: #0F172A; margin: 20px 0 8px; }
          .meta { font-size: 11px; color: #64748B; margin-bottom: 20px; }
          .header-bar { border-bottom: 2px solid #2563EB; padding-bottom: 14px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; }
          .brand  { font-size: 12px; color: #2563EB; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; }
          .stats  { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 22px; }
          .stat   { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 14px; }
          .stat-val { font-size: 22px; font-weight: 800; color: #2563EB; }
          .stat-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: #64748B; }
          table   { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
          thead   { background: #0F172A; color: #fff; }
          th      { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
          td      { padding: 8px 10px; border-bottom: 1px solid #E2E8F0; font-size: 12px; }
          tr:nth-child(even) td { background: #F8FAFC; }
          .prog-wrap { background: #E2E8F0; border-radius: 4px; height: 6px; overflow: hidden; }
          .prog-fill  { background: #2563EB; height: 100%; border-radius: 4px; }
          .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #E2E8F0; font-size: 10px; color: #94A3B8; display: flex; justify-content: space-between; }
          @media print { body { padding: 24px 32px; } }
        </style></head><body>
        <div class="header-bar">
          <div><div class="brand">ReadSmartly · Study Report</div><h1>${name}</h1><div class="meta">Generated on ${dateNow} by ${aiName}</div></div>
          <div style="font-size:11px;color:#64748B;text-align:right;">Study Type: ${userProfile?.studyType || 'N/A'}<br>Member since: ${currentUser.metadata?.creationTime ? new Date(currentUser.metadata.creationTime).toLocaleDateString('en-GB') : 'N/A'}</div>
        </div>

        <h2>Overall Statistics</h2>
        <div class="stats">
          <div class="stat"><div class="stat-val">${totalPages}</div><div class="stat-lbl">Total Pages</div></div>
          <div class="stat"><div class="stat-val">${sessionCount}</div><div class="stat-lbl">Sessions</div></div>
          <div class="stat"><div class="stat-val">${totalMins ? Math.round(totalMins/60) : 0}h</div><div class="stat-lbl">Total Time</div></div>
          <div class="stat"><div class="stat-val">${speed}</div><div class="stat-lbl">Pages/Hour</div></div>
        </div>

        <h2>Task Progress</h2>
        <table>
          <thead><tr><th>Task</th><th>Progress</th><th>Pages</th><th>Deadline</th><th>Status</th></tr></thead>
          <tbody>
          ${tasks.map(t => {
              const pct  = t.totalPages > 0 ? Math.min(Math.round((t.pagesRead / t.totalPages) * 100), 100) : 0;
              const days = t.deadline ? Math.ceil((t.deadline.seconds * 1000 - Date.now()) / 86400000) : null;
              const status = pct >= 100 ? 'Complete' : days !== null && days < 0 ? 'Overdue' : days !== null && days <= 3 ? `${days}d left` : 'In Progress';
              return `<tr>
                <td>${t.title}</td>
                <td style="width:120px;"><div class="prog-wrap"><div class="prog-fill" style="width:${pct}%"></div></div><span style="font-size:10px;color:#64748B;">${pct}%</span></td>
                <td>${t.pagesRead}/${t.totalPages}</td>
                <td>${t.deadline ? new Date(t.deadline.seconds*1000).toLocaleDateString('en-GB') : '—'}</td>
                <td>${status}</td>
              </tr>`;
          }).join('')}
          </tbody>
        </table>

        <h2>Pages Per Course</h2>
        <table>
          <thead><tr><th>Course</th><th>Pages Read</th></tr></thead>
          <tbody>
          ${Object.entries(taskMap).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
          </tbody>
        </table>

        <h2>Recent Sessions (last 20)</h2>
        <table>
          <thead><tr><th>Date</th><th>Task</th><th>Pages</th><th>Duration</th></tr></thead>
          <tbody>
          ${Array.from(sessSnap.docs).slice(0, 20).map(d => {
              const r = d.data();
              const dt = r.date.toDate().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
              return `<tr><td>${dt}</td><td>${r.taskTitle || '—'}</td><td>${r.pagesRead}</td><td>${r.duration ? r.duration + ' min' : '—'}</td></tr>`;
          }).join('')}
          </tbody>
        </table>

        <div class="footer">
          <span>ReadSmartly · readsmartly.app</span>
          <span>Report generated ${dateNow}</span>
        </div>
        </body></html>`);
        win.document.close();
        setTimeout(() => { win.focus(); win.print(); }, 600);
        trackEvent('pdf_export_completed', { totalPages, sessionCount });
    } catch(e) {
        console.error('PDF export error:', e);
        window.showToast('Could not generate report. Please try again.');
    }
};


// ── SMART REMINDERS ───────────────────────────────────────────────────────
async function checkSmartReminder() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        // Single query for all sessions — use it for both "studied today" and peak-hour calc
        const hq = query(collection(db,'sessions'), where('userId','==',currentUser.uid));
        const hs = await getDocs(hq);

        const today = new Date(); today.setHours(0,0,0,0);
        let studiedToday = false;
        const counts = new Array(24).fill(0);
        hs.forEach(d => {
            const date = d.data().date.toDate();
            if (date >= today) studiedToday = true;
            counts[date.getHours()]++;
        });
        if (studiedToday) return; // Already studied today — no reminder needed
        const peakHour = counts.map((c,h)=>({h,c})).sort((a,b)=>b.c-a.c)[0]?.h ?? 20;

        const now    = new Date();
        const curHr  = now.getHours();
        const aiName = userProfile?.aiName || 'AI';
        const name   = userProfile?.userName || '';

        // Schedule a notification at peak hour if it hasn't passed today
        if (curHr < peakHour) {
            const msToPeak = new Date().setHours(peakHour, 0, 0, 0) - Date.now();
            if (msToPeak > 0 && msToPeak < 24 * 60 * 60 * 1000) {
                setTimeout(() => {
                    // Recheck — maybe they studied in the meantime
                    getDocs(query(collection(db,'sessions'), where('userId','==',currentUser.uid), where('date','>=',Timestamp.fromDate(today))))
                        .then(snap => {
                            if (snap.empty) {
                                sendNotification(
                                    `ReadSmartly: ${name ? name + ', it' : 'It'}'s your peak study time!`,
                                    `${aiName}: You study best at this hour. Open ReadSmartly and log a session.`,
                                    true
                                );
                                pushInAppNotif('info', '⏰', 'Peak Study Time!', `${aiName}: You study best at ${peakHour % 12 || 12}${peakHour >= 12 ? 'PM' : 'AM'}. No session logged yet today.`);
                            }
                        });
                }, msToPeak);
            }
        } else {
            // Peak hour already passed — send a gentle evening reminder if it's after 6pm
            if (curHr >= 18) {
                pushInAppNotif('warn', '📚', 'No Session Today Yet', `${aiName}: Day's almost done. Even 15 pages keeps your streak alive${name ? ', ' + name : ''}.`);
            }
        }
        trackEvent('smart_reminder_checked', { peakHour, studiedToday: false });
    } catch(e) { console.error('Smart reminder error:', e); }
}


// ── ONBOARDING ANALYTICS ──────────────────────────────────────────────────
window.trackOnboardingStep = function(step, data = {}) {
    trackEvent('onboarding_step', { step, ...data });
};
window.trackFunnelDrop = function(from, reason = '') {
    trackEvent('funnel_drop', { from, reason });
};


// ── HOOK NEW CHECKS INTO DASHBOARD ────────────────────────────────────────
window._runNewFeatureChecks = async function() {
    await checkCarryOver();
    checkSmartReminder();
};


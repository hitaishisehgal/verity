import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import './App.css';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5001/api',
  withCredentials: true,
});
const date = value => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeLocal = value => {
  const parsed = new Date(value);
  parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
  return parsed.toISOString().slice(0, 16);
};
const assignmentPayload = form => {
  const values = Object.fromEntries(new FormData(form));
  if (values.deadline) values.deadline = new Date(values.deadline).toISOString();
  return values;
};
const errorMessage = (error, fallback) => error.response?.data?.message || fallback;
const getSavedTheme = () => {
  const savedTheme = localStorage.getItem('verity-theme');
  return ['light', 'dark', 'system'].includes(savedTheme) ? savedTheme : 'system';
};

function ThemeControl({ theme, onChange }) {
  return <div className="theme-control" role="group" aria-label="Color theme">
    <button type="button" className={'theme-control-option ' + (theme === 'system' ? 'is-active' : '')} aria-label="Use system theme" aria-pressed={theme === 'system'} title="System theme" onClick={() => onChange('system')}>▣</button>
    <button type="button" className={'theme-control-option ' + (theme === 'light' ? 'is-active' : '')} aria-label="Use light theme" aria-pressed={theme === 'light'} title="Light theme" onClick={() => onChange('light')}>☼</button>
    <button type="button" className={'theme-control-option ' + (theme === 'dark' ? 'is-active' : '')} aria-label="Use dark theme" aria-pressed={theme === 'dark'} title="Dark theme" onClick={() => onChange('dark')}>☾</button>
  </div>;
}

function App() {
  const [user, setUser] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({ assignmentCount: 0, openAssignmentCount: 0, submissionCount: 0, toReviewCount: 0 });
  const [selected, setSelected] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [submissionFile, setSubmissionFile] = useState(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const [assignmentStudents, setAssignmentStudents] = useState([]);
  const [mySubmissions, setMySubmissions] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [profile, setProfile] = useState({ name: '', department: '', bio: '', studentId: '' });
  const [avatarUrl, setAvatarUrl] = useState('');
  const [theme, setTheme] = useState(getSavedTheme);
  const [view, setView] = useState('overview');
  const [authMode, setAuthMode] = useState('login');
  const [showLanding, setShowLanding] = useState(true);
  const [busy, setBusy] = useState(false);
  const creatingAssignment = useRef(false);
  const deletingAssignment = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => () => {
    if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  }, [avatarUrl]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'system' ? '' : theme;
    localStorage.setItem('verity-theme', theme);
  }, [theme]);

  async function loadAssignments(role = user?.role) {
    try {
      const requests = [api.get('/assignments')];
      if (role === 'PROFESSOR') requests.push(api.get('/dashboard/summary'));
      const [assignmentsResponse, summaryResponse] = await Promise.all(requests);
      setAssignments(assignmentsResponse.data.data);
      if (summaryResponse) setDashboardStats(summaryResponse.data.data);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to connect to Verity. Please try again.'));
    }
  }

  useEffect(() => {
    let active = true;
    api.get('/auth/me')
      .then(async response => {
        if (!active) return;
        setUser(response.data.data.user);
        await loadAssignments(response.data.data.user.role);
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  async function authenticate(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const response = await api.post('/auth/' + authMode, values);
      setUser(response.data.data.user);
      await loadAssignments(response.data.data.user.role);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to connect to Verity. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function openProfile() {
    setView('profile');
    setError('');
    setNotice('');
    try {
      const response = await api.get('/profile');
      const current = response.data.data.user;
      setUser(current);
      setProfile({
        name: current.name || '',
        department: current.department || '',
        bio: current.bio || '',
        studentId: current.studentId || '',
      });
      if (current.avatarUrl) {
        const image = await api.get('/profile/avatar', { responseType: 'blob' });
        setAvatarUrl(URL.createObjectURL(image.data));
      } else {
        setAvatarUrl('');
      }
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not load your profile.'));
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.put('/profile', profile);
      setUser(response.data.data.user);
      setProfile(current => ({ ...current, ...response.data.data.user }));
      setNotice('Profile saved.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not save your profile.'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!form.get('avatar')?.size) {
      setError('Choose a JPG, PNG, or WebP image first.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.post('/profile/avatar', form);
      setUser(response.data.data.user);
      const image = await api.get('/profile/avatar', { responseType: 'blob' });
      setAvatarUrl(URL.createObjectURL(image.data));
      setNotice('Profile photo updated.');
      formElement.reset();
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not upload your profile photo.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.delete('/profile/avatar');
      setUser(response.data.data.user);
      setAvatarUrl('');
      setNotice('Profile photo removed.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not remove your profile photo.'));
    } finally {
      setBusy(false);
    }
  }

  async function openSubmissions() {
    setView('submissions');
    setError('');
    try {
      const response = await api.get('/submissions');
      setMySubmissions(response.data.data);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not load your submissions.'));
    }
  }

  async function openAssignment(assignment) {
    setSelected(assignment);
    setView('assignment');
    setError('');
    setNotice('');
    setAssignmentStudents([]);
    try {
      const response = await api.get('/assignments/' + assignment._id + '/submissions');
      setSubmissions(response.data.data);
      if (user.role === 'PROFESSOR') {
        const [report, roster] = await Promise.all([
          api.get('/assignments/' + assignment._id + '/analyses'),
          api.get('/assignments/' + assignment._id + '/students'),
        ]);
        setAnalyses(report.data.data);
        setAssignmentStudents(roster.data.data);
      } else {
        setAssignmentStudents([]);
      }
    } catch (requestError) {
      setError(errorMessage(requestError, 'Unable to load this assignment.'));
    }
  }

  async function createAssignment(event) {
    event.preventDefault();
    if (creatingAssignment.current) return;
    creatingAssignment.current = true;
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await api.post('/assignments', assignmentPayload(form));
      form.reset();
      await loadAssignments();
      setNotice('Assignment created.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not create the assignment.'));
    } finally {
      creatingAssignment.current = false;
      setBusy(false);
    }
  }

  async function editAssignment(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await api.put('/assignments/' + selected._id, assignmentPayload(event.currentTarget));
      setSelected(response.data.data);
      await loadAssignments();
      setNotice('Assignment updated.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not update the assignment.'));
    } finally {
      setBusy(false);
    }
  }

  async function closeAssignment() {
    try {
      const response = await api.patch('/assignments/' + selected._id + '/close');
      setSelected(response.data.data);
      await loadAssignments();
      setNotice('Assignment closed. Students can no longer submit work.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not close the assignment.'));
    }
  }

  async function reopenAssignment() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.patch('/assignments/' + selected._id + '/reopen');
      setSelected(response.data.data);
      await loadAssignments();
      setNotice('Assignment reopened. Students can submit work again.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not reopen the assignment.'));
    } finally {
      setBusy(false);
    }
  }

  function chooseSubmissionFile(file) {
    if (!file) return;
    const extension = file.name.toLowerCase().split('.').pop();
    if (!['java', 'py'].includes(extension)) {
      setSubmissionFile(null);
      setError('Choose a Java (.java) or Python (.py) source file.');
      return;
    }
    if (file.size > 1024 * 1024) {
      setSubmissionFile(null);
      setError('Your source file must be 1 MB or smaller.');
      return;
    }
    setSubmissionFile(file);
    setError('');
  }

  async function deleteAssignment() {
    if (deletingAssignment.current || !window.confirm('Delete this assignment and permanently remove all student submissions and analysis results? This cannot be undone.')) return;
    deletingAssignment.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.delete('/assignments/' + selected._id);
      setAssignments(current => current.filter(assignment => assignment._id !== selected._id));
      setSelected(null);
      setSubmissions([]);
      setAssignmentStudents([]);
      setAnalyses([]);
      setView('overview');
      setNotice('Assignment and its submissions deleted.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Could not delete the assignment.'));
    } finally {
      deletingAssignment.current = false;
      setBusy(false);
    }
  }

  async function submitWork(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!submissionFile) {
      setError('Choose a Java or Python source file before submitting.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const upload = new FormData();
      upload.append('file', submissionFile);
      await api.post('/assignments/' + selected._id + '/submissions', upload);
      const response = await api.get('/assignments/' + selected._id + '/submissions');
      setSubmissions(response.data.data);
      setNotice('Submission uploaded.');
      form.reset();
      setSubmissionFile(null);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Upload failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function runAnalysis(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const threshold = new FormData(event.currentTarget).get('threshold');
      await api.post('/assignments/' + selected._id + '/analyze', { threshold });
      const response = await api.get('/assignments/' + selected._id + '/analyses');
      setAnalyses(response.data.data);
      setNotice('Analysis complete. Similarity is an indicator for academic review, not proof of misconduct.');
    } catch (requestError) {
      setError(errorMessage(requestError, 'Analysis failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    try {
      const response = await api.get('/assignments/' + selected._id + '/report.csv', { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'verity-report.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(errorMessage(requestError, 'Run an analysis before downloading a report.'));
    }
  }

  async function logout() {
    await api.post('/auth/logout');
    setUser(null);
    setAssignments([]);
    setSelected(null);
    setView('overview');
  }

  if (!user) {
    if (showLanding) {
      return <main className="landing-page">
        <header className="landing-nav">
          <a className="landing-brand" href="#" onClick={event => event.preventDefault()}>verity<span>.</span></a>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#for-educators">For educators</a>
            <a href="#for-students">For students</a>
          </nav>
          <div className="landing-actions">
            <ThemeControl theme={theme} onChange={setTheme} />
            <button className="landing-signin" onClick={() => { setAuthMode('login'); setShowLanding(false); }}>Sign in</button>
            <button className="landing-get-started" onClick={() => { setAuthMode('register'); setShowLanding(false); }}>Get started</button>
          </div>
        </header>
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="landing-kicker"><span /> A calmer way to review coursework</p>
            <h1>Make room for<br /><span>better questions.</span></h1>
            <p className="landing-lede">Bring programming assignments, submissions, and similarity signals into one thoughtful workspace—so educators can spend less time sorting files and more time understanding the work.</p>
            <div className="landing-cta">
              <button onClick={() => { setAuthMode('register'); setShowLanding(false); }}>Start with Verity <span aria-hidden="true">→</span></button>
              <a href="#how-it-works">Explore the approach <span aria-hidden="true">↓</span></a>
            </div>
            <div className="landing-proof"><span className="proof-mark">✓</span> Private student work <span className="proof-dot">·</span> Human-led decisions</div>
          </div>
          <div className="landing-visual" aria-label="Illustration of a course workspace with assignment and submission statuses" role="img">
            <div className="workspace-preview">
              <div className="preview-topbar">
                <div className="preview-window-dots"><i /><i /><i /></div>
                <span>VERITY / COURSE OVERVIEW</span>
                <span className="preview-term">SPRING TERM</span>
              </div>
              <div className="preview-content">
                <div className="preview-heading"><div><small>YOUR TEACHING SPACE</small><b>Good afternoon, Professor</b></div><span className="preview-date">WEEK 08</span></div>
                <div className="preview-stats">
                  <div><small>ASSIGNMENTS</small><b>04</b><span>2 currently open</span></div>
                  <div><small>SUBMISSIONS</small><b>28</b><span>Across your classes</span></div>
                  <div><small>TO REVIEW</small><b>03</b><span>Worth a closer look</span></div>
                </div>
                <div className="preview-list-head"><b>Recent coursework</b><span>View all <i>↗</i></span></div>
                <div className="preview-assignment"><span className="preview-assignment-icon icon-green">01</span><div><b>Data structures</b><small>JAVA · 18 submissions</small></div><span className="preview-pill pill-review">Review</span></div>
                <div className="preview-assignment"><span className="preview-assignment-icon icon-blue">02</span><div><b>Working with files</b><small>PYTHON · 10 submissions</small></div><span className="preview-pill pill-open">Open</span></div>
                <div className="preview-assignment"><span className="preview-assignment-icon icon-amber">03</span><div><b>Sorting methods</b><small>JAVA · Due Friday</small></div><span className="preview-pill pill-due">Due soon</span></div>
                <div className="preview-foot"><span><i /> All student submissions are private</span><span>Updated just now</span></div>
              </div>
            </div>
            <div className="preview-caption"><span>01</span><p>A workspace that keeps the work—and the people behind it—in view.</p></div>
          </div>
        </section>
        <section className="landing-principles" id="how-it-works">
          <div className="principle-intro"><span className="landing-kicker">A MORE HUMAN REVIEW PROCESS</span><h2>Signals are useful.<br />Context is essential.</h2><p>Verity helps organize the evidence. Educators bring the judgment.</p></div>
          <article className="principle-card" id="for-educators"><span className="principle-number">01 / NOTICE</span><h3>See patterns, not verdicts</h3><p>Use structural similarity to identify work that may deserve a closer, more careful look.</p></article>
          <article className="principle-card"><span className="principle-number">02 / UNDERSTAND</span><h3>Return to the assignment</h3><p>Read submissions in the context of prompts, starter code, deadlines, and student progress.</p></article>
          <article className="principle-card" id="for-students"><span className="principle-number">03 / DECIDE</span><h3>Keep people in the loop</h3><p>Every signal is a reason to ask questions—not a conclusion about a student.</p></article>
        </section>
        <footer className="landing-footer"><a className="landing-brand" href="#" onClick={event => event.preventDefault()}>verity<span>.</span></a><span>Thoughtful tools for fairer code review.</span></footer>
      </main>;
    }
    return <main className="auth">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setShowLanding(true); }}>verity<span>.</span></a>
      <section className="authbox">
        <p className="eyebrow">ACADEMIC INTEGRITY TOOL</p>
        <h1>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted">Programming assignment similarity detection</p>
        <form onSubmit={authenticate}>
          {authMode === 'register' && <label>Full name<input name="name" required placeholder="Your name" /></label>}
          <label>Email<input name="email" type="email" required placeholder="you@college.edu" /></label>
          <label>Password<input name="password" type="password" minLength="8" required placeholder="At least 8 characters" /></label>
          {authMode === 'register' && <label>Role<select name="role"><option value="STUDENT">Student</option><option value="PROFESSOR">Professor</option></select></label>}
          <button disabled={busy}>{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Register'}</button>
        </form>
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
          {authMode === 'login' ? 'Create an account' : 'Already registered? Sign in'}
        </button>
      </section>
      <p className="fine">Similarity supports academic review; it is not proof of misconduct.</p>
    </main>;
  }

  const isProfessor = user.role === 'PROFESSOR';
  const title = view === 'profile' ? 'My profile'
    : view === 'submissions' ? 'My submissions'
      : view === 'assignment' ? selected?.title
        : isProfessor ? 'Professor workspace' : 'Student workspace';

  return <div className={'layout ' + (isProfessor ? 'professor-layout' : 'student-layout')}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setView('overview'); }}>verity<span>.</span></a>
      <p className="navlabel">{isProfessor ? 'TEACHING' : 'LEARNING'}</p>
      <button className={'nav ' + (view === 'overview' ? 'active' : '')} onClick={() => setView('overview')}>
        {isProfessor ? '▦  Overview & assignments' : '▦  Available assignments'}
      </button>
      {!isProfessor && <button className={'nav ' + (view === 'submissions' ? 'active' : '')} onClick={openSubmissions}>▤  My submissions</button>}
      <button className={'nav ' + (view === 'profile' ? 'active' : '')} onClick={openProfile}>◉  My profile</button>
      <div className="sidebottom">
        {avatarUrl ? <img className="avatar" src={avatarUrl} alt="" /> : <div className="avatar">{user.name?.[0]?.toUpperCase()}</div>}
        <div className="user-summary"><b>{user.name}</b><small>{isProfessor ? 'Professor' : 'Student'}</small></div>
        <button className="link" onClick={logout}>Log out</button>
      </div>
    </aside>

    <main className="main">
      <header className="page-header">
        <div><p className="eyebrow">VERITY / {isProfessor ? 'PROFESSOR' : 'STUDENT'}</p><h1>{title}</h1></div>
        <div className="header-actions">
          <ThemeControl theme={theme} onChange={setTheme} />
          <button className="profile-shortcut" onClick={openProfile}>
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{user.name?.[0]?.toUpperCase()}</span>}
            <span className="role-label">{isProfessor ? 'Professor' : 'Student'} profile</span>
          </button>
        </div>
      </header>

      {error && <div className="notice error-notice" role="alert">{error}<button className="link" onClick={() => setError('')}>Dismiss</button></div>}
      {notice && <div className="notice success-notice" role="status">{notice}<button className="link" onClick={() => setNotice('')}>Dismiss</button></div>}

      {view === 'profile' && <section className="profile-page">
        <div className="profile-heading">
          <div className="profile-large">
            {avatarUrl ? <img src={avatarUrl} alt="Your profile" /> : <span>{user.name?.[0]?.toUpperCase()}</span>}
          </div>
          <div><p className="eyebrow">ACCOUNT SETTINGS</p><h2>{user.name}</h2><p className="muted">{isProfessor ? 'Professor' : 'Student'} · {user.email}</p></div>
        </div>
        <div className="profile-grid">
          <form className="panel profile-form" onSubmit={saveProfile}>
            <h2>Profile details</h2>
            <label>Full name<input value={profile.name} maxLength="100" required onChange={event => setProfile({ ...profile, name: event.target.value })} /></label>
            <label>Email<input value={user.email} readOnly /></label>
            <label>Department<input value={profile.department} maxLength="100" placeholder="Your department" onChange={event => setProfile({ ...profile, department: event.target.value })} /></label>
            {!isProfessor && <label>Student ID<input value={profile.studentId} maxLength="50" placeholder="Your student ID" onChange={event => setProfile({ ...profile, studentId: event.target.value })} /></label>}
            <label>About me<textarea value={profile.bio} maxLength="500" rows="4" placeholder="A short introduction" onChange={event => setProfile({ ...profile, bio: event.target.value })} /></label>
            <button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
          </form>
          <form className="panel photo-form" onSubmit={uploadAvatar}>
            <h2>Profile photo</h2>
            <p className="muted">Choose a JPG, PNG, or WebP image. Maximum size: 2 MB.</p>
            <label>Upload photo<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" required /></label>
            <button disabled={busy}>{busy ? 'Uploading…' : 'Upload photo'}</button>
            {avatarUrl && <button className="secondary" type="button" disabled={busy} onClick={removeAvatar}>
              {busy ? 'Please wait…' : 'Remove photo'}
            </button>}
          </form>
        </div>
      </section>}

      {view === 'overview' && <>
        {isProfessor
          ? <section className="professor-dashboard">
            <div className="professor-welcome">
              <span className="dashboard-kicker"><i /> YOUR TEACHING SPACE</span>
              <h2>Welcome back, {user.name.split(' ')[0]}</h2>
              <p>Here’s the latest across your programming courses.</p>
            </div>
            <div className="dashboard-stats">
              <article className="dashboard-stat">
                <span className="dashboard-stat-icon assignment-stat-icon">▤</span>
                <small>ASSIGNMENTS</small>
                <b>{dashboardStats.assignmentCount}</b>
                <span>{dashboardStats.openAssignmentCount} currently open</span>
              </article>
              <article className="dashboard-stat">
                <span className="dashboard-stat-icon submissions-stat-icon">↥</span>
                <small>SUBMISSIONS</small>
                <b>{dashboardStats.submissionCount}</b>
                <span>Received across your classes</span>
              </article>
              <article className="dashboard-stat">
                <span className="dashboard-stat-icon review-stat-icon">⌕</span>
                <small>TO REVIEW</small>
                <b>{dashboardStats.toReviewCount}</b>
                <span>{dashboardStats.toReviewCount === 1 ? 'Pair worth a closer look' : 'Pairs worth a closer look'}</span>
              </article>
            </div>
          </section>
          : <section className="welcome-strip">
            <div><p className="eyebrow">YOUR COURSEWORK</p>
              <h2>Find your assignment and submit your work</h2>
              <p className="muted">Your submissions and history are private to your account.</p>
            </div>
            <div className="summary-stat"><b>{assignments.length}</b><span>Open assignments</span></div>
          </section>}
        {isProfessor && <form className="create" onSubmit={createAssignment}>
          <h2>Create an assignment</h2>
          <div className="formgrid">
            <label>Title<input name="title" required placeholder="e.g. Sorting algorithms" /></label>
            <label>Language<select name="programmingLanguage"><option>JAVA</option><option>PYTHON</option></select></label>
            <label>Deadline<input type="datetime-local" name="deadline" required /></label>
            <label>Description<input name="description" placeholder="Instructions for students" /></label>
            <button disabled={busy}>{busy ? 'Creating…' : 'Create assignment'}</button>
          </div>
        </form>}
        <section className="assignment-section">
          <div className="section-heading"><h2>{isProfessor ? 'Recent coursework' : 'Available assignments'}</h2><span className="muted">{assignments.length} {assignments.length === 1 ? 'assignment' : 'assignments'}</span></div>
          {assignments.length === 0
            ? <div className="empty"><b>{isProfessor ? 'No assignments yet.' : 'No assignments available.'}</b><p className="muted">{isProfessor ? 'Create an assignment to get started.' : 'Your professor’s open assignments will appear here.'}</p></div>
            : <div className="table">{assignments.map(assignment => <button className="row" key={assignment._id} onClick={() => openAssignment(assignment)}>
              <div><b>{assignment.title}</b><small>{assignment.programmingLanguage} · Due {date(assignment.deadline)}</small></div>
              {isProfessor
                ? assignment.missingCount > 0 && <span className="status review">{assignment.missingCount} missed</span>
                : <span className={'status ' + (assignment.studentStatus === 'MISSED' || assignment.studentStatus === 'LATE' ? 'review' : assignment.studentStatus === 'CLOSED' ? 'closed' : 'open')}>
                  {assignment.studentStatus === 'MISSED' ? 'Missed' : assignment.studentStatus === 'LATE' ? 'Submitted late' : assignment.studentStatus === 'SUBMITTED' ? 'Submitted' : assignment.studentStatus === 'CLOSED' ? 'Closed' : 'Open'}
                </span>}
              {isProfessor && <span className={'status ' + assignment.status.toLowerCase()}>{assignment.status}</span>}
              <span className="arrow">→</span>
            </button>)}</div>}
        </section>
      </>}

      {view === 'submissions' && <section className="assignment-section">
        <p className="muted">Only you can see your submission history.</p>
        {mySubmissions.length === 0
          ? <div className="empty"><b>No submissions yet.</b><p className="muted">Your uploaded work will appear here.</p></div>
          : <div className="table">{mySubmissions.map(submission => <div className="row" key={submission._id}>
            <div><b>{submission.assignment?.title || 'Assignment'} · Version {submission.version}</b><small>{submission.originalFilename} · Submitted {date(submission.submittedAt)}</small></div>
            <span className={'status ' + (submission.isLate ? 'review' : 'open')}>{submission.isLate ? 'Late' : 'Submitted'}</span>
          </div>)}</div>}
      </section>}

      {view === 'assignment' && selected && <>
        <button className="link back" onClick={() => setView('overview')}>← Back to {isProfessor ? 'assignments' : 'available assignments'}</button>
        <section className={'detail ' + (!isProfessor ? 'student-assignment-detail' : '')}>
          <div className="assignment-description">
            <span className={'status ' + selected.status.toLowerCase()}>{selected.status}</span>
            <h2>{selected.title}</h2><p>{selected.description || 'No description provided.'}</p>
            <p className="muted">{selected.programmingLanguage} · Deadline {date(selected.deadline)}</p>
          </div>
          {isProfessor
            ? <form className="assignment-edit" onSubmit={editAssignment}>
              <label>Title<input name="title" required defaultValue={selected.title} /></label>
              <label>Language<select name="programmingLanguage" defaultValue={selected.programmingLanguage}><option>JAVA</option><option>PYTHON</option></select></label>
              <label>Deadline<input type="datetime-local" name="deadline" required defaultValue={dateTimeLocal(selected.deadline)} /></label>
              <label>Description<input name="description" defaultValue={selected.description || ''} /></label>
              <button disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
              {selected.status === 'OPEN' && <button type="button" className="close-assignment" disabled={busy} onClick={closeAssignment}>Close assignment</button>}
              {selected.status === 'CLOSED' && <button type="button" className="reopen-assignment" disabled={busy} onClick={reopenAssignment}>Reopen assignment</button>}
              <button type="button" className="delete-assignment" disabled={busy} onClick={deleteAssignment}>Delete assignment</button>
            </form>
            : selected.status === 'OPEN' && <form className="submission-form student-upload-form" onSubmit={submitWork}>
              <div className="upload-form-heading">
                <span className="dashboard-kicker"><i /> YOUR SUBMISSION</span>
                <h3>Ready when you are</h3>
                <p>Upload your work for <b>{selected.title}</b>.</p>
              </div>
              <label
                className={'student-dropzone ' + (draggingFile ? 'is-dragging' : '') + (submissionFile ? 'has-file' : '')}
                onDragOver={event => { event.preventDefault(); setDraggingFile(true); }}
                onDragLeave={event => { event.preventDefault(); setDraggingFile(false); }}
                onDrop={event => {
                  event.preventDefault();
                  setDraggingFile(false);
                  chooseSubmissionFile(event.dataTransfer.files[0]);
                }}>
                <input className="student-file-input" type="file" name="file" accept=".java,.py" onChange={event => chooseSubmissionFile(event.currentTarget.files[0])} />
                <span className="dropzone-icon" aria-hidden="true">↑</span>
                {submissionFile
                  ? <><b className="dropzone-file-name">{submissionFile.name}</b><span>{(submissionFile.size / 1024).toFixed(0)} KB · Ready to submit</span><span className="browse-file">Choose a different file</span></>
                  : <><b>Drop your source file here</b><span>or <u>click to browse</u></span><span className="dropzone-hint">One .java or .py file · Up to 1 MB</span></>}
              </label>
              <button className="student-submit-button" disabled={busy || !submissionFile}>{busy ? 'Uploading…' : 'Submit assignment'} <span aria-hidden="true">→</span></button>
            </form>}
        </section>

        {isProfessor
          ? <>
            <section className="assignment-section">
              <div className="section-heading"><h2>Student submissions</h2>
                <span className="muted">{assignmentStudents.filter(student => student.status === 'SUBMITTED' || student.status === 'LATE').length} of {assignmentStudents.length} submitted</span>
              </div>
              {assignmentStudents.length === 0
                ? <div className="empty">No student accounts are registered yet.</div>
                : <div className="table">{assignmentStudents.map(student => {
                  const submitted = student.status === 'SUBMITTED' || student.status === 'LATE';
                  const statusLabel = student.status === 'SUBMITTED' ? 'Submitted' : student.status === 'LATE' ? 'Submitted late' : student.status === 'MISSED' ? 'Missed' : student.status === 'CLOSED' ? 'Closed · not submitted' : 'Not submitted';
                  return <div className="row missed-student" key={student._id}>
                    <div><b>{student.name}</b><small>{student.email}{student.studentId ? ' · ' + student.studentId : ''}{submitted && student.submittedAt ? ' · ' + student.submissionCount + (student.submissionCount === 1 ? ' submission' : ' submissions') + ' · Latest ' + date(student.submittedAt) : ''}</small></div>
                    <span className={'status ' + (student.status === 'MISSED' || student.status === 'LATE' ? 'review' : student.status === 'CLOSED' ? 'closed' : 'open')}>{statusLabel}</span>
                  </div>;
                })}</div>}
            </section>
            <section className="review-section">
            <div className="reporthead"><h2>Analysis results</h2>
              <form onSubmit={runAnalysis}><label>Review threshold (%)<input type="number" name="threshold" defaultValue="40" min="1" max="100" /></label>
                <button disabled={busy}>{busy ? 'Analyzing…' : 'Run analysis'}</button><button type="button" className="secondary" onClick={downloadReport}>Download CSV</button>
              </form>
            </div>
            {analyses.length === 0 ? <div className="empty">No analyses have been run yet.</div> : analyses.map(report => <section className="panel" key={report._id}>
              <p className="muted">Analysis · {date(report.createdAt)} · Threshold {report.threshold}%</p>
              {report.pairs.length === 0 ? <p>No student pairs to compare yet.</p> : report.pairs.map((pair, index) => <div className="pair" key={index}>
                <span>{pair.studentNameA} ↔ {pair.studentNameB}</span><b>{pair.similarity}%</b>
                <span>Jaccard {pair.jaccard} · Coverage {pair.coverageA}/{pair.coverageB}</span>
                <strong className="status review">{pair.status === 'REVIEW_REQUIRED' ? 'Review required' : 'Not flagged'}</strong>
              </div>)}
            </section>)}
          </section>
          </>
          : <section className="assignment-section">
            <div className="section-heading"><h2>Your submission history</h2></div>
            {submissions.length === 0 ? <div className="empty">No submissions yet.</div> : <div className="table">{submissions.map(submission => <div className="row" key={submission._id}>
              <div><b>Version {submission.version} · {submission.originalFilename}</b><small>Submitted {date(submission.submittedAt)}</small></div>
              <span className={'status ' + (submission.isLate ? 'review' : 'open')}>{submission.isLate ? 'Late' : 'Submitted'}</span>
            </div>)}</div>}
          </section>}
      </>}
    </main>
  </div>;
}

export default App;
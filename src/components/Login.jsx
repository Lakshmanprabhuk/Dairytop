import { useState, useEffect} from 'react';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  
  const [loginAttempts, setLoginAttempts] = useState(() => {
    const saved = sessionStorage.getItem('loginAttempts');
    return saved ? parseInt(saved) : 0;
  });
  
  const [locked, setLocked] = useState(() => {
    const saved = sessionStorage.getItem('loginLocked');
    if (saved) {
      const { expiry } = JSON.parse(saved);
      const remaining = Math.ceil((expiry - new Date().getTime()) / 1000);
      if (remaining > 0) {
        setTimeLeft(remaining);
        return true;
      }
      sessionStorage.removeItem('loginLocked');
      sessionStorage.removeItem('loginAttempts');
    }
    return false;
  });

  useEffect(() => {
    if (!locked || timeLeft <= 0) return;
    
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          sessionStorage.removeItem('loginLocked');
          sessionStorage.removeItem('loginAttempts');
          setLocked(false);
          setLoginAttempts(0);
          setError(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [locked, timeLeft]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins} min ${secs} sec`;
    return `${secs} sec`;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (locked) {
      setError(true);
      return;
    }

    if ((username === 'knitworks' && password === 'knitworks')||
        (username === 'admin' && password === '1234')||
        (username === 'Jan.spiker' && password === 'Janspiker@123')||
        (username === 'Joahan.dairytop' && password === 'Johan@123'))  {
      sessionStorage.removeItem('loginAttempts');
      sessionStorage.removeItem('loginLocked');
      setLoginAttempts(0);
      setLocked(false);
      setTimeLeft(0);
      onLogin();
    } else {
      const attempts = loginAttempts + 1;
      setLoginAttempts(attempts);
      sessionStorage.setItem('loginAttempts', attempts);
      
      if (attempts >= 5) {
        const expiry = new Date().getTime() + 30 * 60 * 1000;
        sessionStorage.setItem('loginLocked', JSON.stringify({ expiry }));
        setLocked(true);
        setTimeLeft(1800);
      }
      setError(true);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-box" style={{ position: 'relative' }}>
        <img 
          src="/favicon.png" 
          alt="KnitWorks Logo" 
          style={{
            position: 'absolute',
            top: '45px',
            right: '24px',
            width: '62px',
            height: '62px',
          }}
        />
        <div className="login-logo">▸ Business Intelligence</div>
        <div className="login-title">Sales Dashboard</div>
        <div className="login-sub">Sign in to access your analytics</div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Username</label>
            <input 
              type="text" 
              value={username} 
              onChange={(e) => { setUsername(e.target.value); setError(false); }} 
              placeholder="Enter username"
              disabled={locked}
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => { setPassword(e.target.value); setError(false); }} 
              placeholder="Enter password"
              disabled={locked}
            />
          </div>
          <button type="submit" className="login-btn" disabled={locked}>
            {locked ? ` Too many attempts - Wait ${formatTime(timeLeft)}` : 'Sign In →'}
          </button>
          {error && <div className="login-err">
            {locked ? `Session locked. Please wait ${formatTime(timeLeft)}.` : 'Invalid credentials. Please try again.'}
          </div>}
        </form>
        <div style={{ textAlign: 'right', marginTop: '24px', fontSize: '13px', color: 'var(--muted)' }}>
          Powered by <strong>Knitworks</strong>
        </div>
      </div>
    </div>
  );
}

export default Login;
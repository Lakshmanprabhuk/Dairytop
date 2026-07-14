import { useState } from 'react';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username === 'knitworks' && password === 'knitworks') {
      onLogin();
    } else {
      setError(true);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="login-logo">▸ KnitWorks Intelligence</div>
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
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => { setPassword(e.target.value); setError(false); }} 
              placeholder="Enter password" 
            />
          </div>
          <button type="submit" className="login-btn">Sign In →</button>
          {error && <div className="login-err">Invalid credentials. Please try again.</div>}
        </form>
      </div>
    </div>
  );
}

export default Login;
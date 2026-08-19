function Sidebar({ currentPage, onNavigate, onLogout, isOpen, onToggle, onClose, totalTransactions, totalClients, dateRange }) {
  const navSections = [
    {
      section: 'Overview',
      items: [
        { id: 'overview',   icon: '▦',  label: 'Dashboard' },
        { id: 'revenue',    icon: '↗',  label: 'Revenue Trends' },
      ]
    },
    {
      section: 'Performance',
      items: [
        { id: 'salesreps',  icon: '◈',  label: 'Sales Team' },
        { id: 'customers',  icon: '⬡',  label: 'Top Customers' },
      ]
    },
    {
      section: 'Catalogue',
      items: [
        { id: 'products',   icon: '◻',  label: 'Products' },
        { id: 'categories', icon: '⊞',  label: 'Categories' },
      ]
    },
    {
      section: 'Channels',
      items: [
        { id: 'channels',   icon: '⇌',  label: 'Channel Mix' },
      ]
    },
  ];

  const handleNavigate = (id) => {
    onNavigate(id);
    onClose();
  };

  return (
    <>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={onToggle}
        aria-label={isOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={isOpen}
      >
        {isOpen ? '✕' : '☰'}
      </button>

      <div
        className={`sidebar-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div className={`sidebar ${isOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="brand">
            <span className="brand-mark">▸</span>
            DairyTop
          </div>
          <div className="tagline">Sales Intelligence</div>
        </div>

        {/* Nav */}
        <nav className="nav">
          {navSections.map((section, idx) => (
            <div key={idx} className="nav-group">
              <div className="nav-section">{section.section}</div>
              {section.items.map(item => (
                <div
                  key={item.id}
                  className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && handleNavigate(item.id)}
                >
                  <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                  {currentPage === item.id && <span className="nav-active-pip" />}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-stats">
            <div className="stat-row">
              <span className="stat-label">Period</span>
              <span className="stat-value">{dateRange}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Transactions</span>
              <span className="stat-value">{totalTransactions?.toLocaleString('en-US')}</span>
            </div>
            <div className="stat-row">
              <span className="stat-label">Clients</span>
              <span className="stat-value">{totalClients?.toLocaleString('en-US')}</span>
            </div>
          </div>
          <button className="logout-btn" onClick={onLogout}>
            <span>↩</span> Sign out
          </button>
        </div>
      </div>
    </>
  );
}

export default Sidebar;

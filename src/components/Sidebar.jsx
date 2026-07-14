function Sidebar({ currentPage, onNavigate, onLogout }) {
  const navSections = [
    {
      section: 'Overview',
      items: [
        { id: 'overview', icon: '⬡', label: 'Dashboard' },
        { id: 'revenue', icon: '📈', label: 'Revenue Trends' },
      ]
    },
    {
      section: 'Performance',
      items: [
        { id: 'salesreps', icon: '👥', label: 'Sales Reps' },
        { id: 'customers', icon: '🏢', label: 'Top Customers' },
      ]
    },
    {
      section: 'Catalogue',
      items: [
        { id: 'products', icon: '📦', label: 'Products' },
        { id: 'categories', icon: '🗂', label: 'Categories' },
      ]
    },
    {
      section: 'Channels',
      items: [
        { id: 'channels', icon: '🔀', label: 'Channel Mix' },
      ]
    },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <div className="brand">▸ KnitWorks</div>
        <div className="tagline">Sales Intelligence Platform</div>
      </div>
      <nav className="nav">
        {navSections.map((section, idx) => (
          <div key={idx}>
            <div className="nav-section">{section.section}</div>
            {section.items.map(item => (
              <div
                key={item.id}
                className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        Data: Jan 2025 – Jul 2026<br />14,317 transactions · 1,349 clients
        <div className="logout-btn" onClick={onLogout}>↩ Sign out</div>
      </div>
    </div>
  );
}

export default Sidebar;